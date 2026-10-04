#!/usr/bin/env node
/**
 * Copies every object from one public Vercel Blob store to another and, only
 * when explicitly requested, replaces the old Blob hostname throughout the
 * public schema. It is intentionally a two-stage operation:
 *
 *   1. --copy      copies objects and writes a manifest (no database writes)
 *   2. --rewrite-db --apply --manifest <file> updates URL references
 *
 * Secrets are read from environment variables so they never need to be put in
 * a shell command or committed to the repository.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { list, head, put } from '@vercel/blob'
import pg from 'pg'

const execFileAsync = promisify(execFile)

const args = new Set(process.argv.slice(2))
const argValue = (name) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const has = (name) => args.has(name)
const usage = () => {
  console.log(`
Usage:
  SOURCE_BLOB_READ_WRITE_TOKEN=... TARGET_VERCEL_CWD=/path/to/linked/dah-blob-bridge node scripts/migrate-blob-store.mjs --copy --manifest /safe/path/blob-manifest.json
  DATABASE_URL=... node scripts/migrate-blob-store.mjs --rewrite-db --apply --manifest /safe/path/blob-manifest.json

Options:
  --copy             Copy old-store blobs to the new store; database is untouched.
  --rewrite-db       Preview URL-reference changes in the new database.
  --apply            Required together with --rewrite-db to actually change DB URLs.
  --manifest <path>  File written by --copy and consumed by --rewrite-db.
`)
}

const manifestPath = argValue('--manifest')
if ((!has('--copy') && !has('--rewrite-db')) || !manifestPath || (has('--copy') && has('--rewrite-db'))) {
  usage()
  process.exitCode = 1
} else if (has('--copy')) {
  await copyBlobs(manifestPath)
} else {
  await rewriteDatabase(manifestPath, has('--apply'))
}

async function allSourceBlobs(token) {
  const blobs = []
  let cursor
  do {
    const page = await list({ token, cursor, limit: 1000 })
    blobs.push(...page.blobs)
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return blobs
}

async function copyBlobs(destination) {
  const sourceToken = process.env.SOURCE_BLOB_READ_WRITE_TOKEN
  const targetToken = process.env.TARGET_BLOB_READ_WRITE_TOKEN
  const targetVercelCwd = process.env.TARGET_VERCEL_CWD
  if (!sourceToken || (!targetToken && !targetVercelCwd)) {
    throw new Error('SOURCE_BLOB_READ_WRITE_TOKEN and either TARGET_BLOB_READ_WRITE_TOKEN or TARGET_VERCEL_CWD are required.')
  }

  const sourceBlobs = await allSourceBlobs(sourceToken)
  if (sourceBlobs.length === 0) throw new Error('The source store is empty. Stop here and check the source token.')

  console.log(`Found ${sourceBlobs.length} source blob(s). Copying without changing the database…`)
  const copied = []
  for (const [index, blob] of sourceBlobs.entries()) {
    const metadata = await head(blob.url, { token: sourceToken })
    const response = await fetch(blob.url)
    if (!response.ok) throw new Error(`Could not download ${blob.pathname}: HTTP ${response.status}`)
    const content = Buffer.from(await response.arrayBuffer())
    const result = targetToken
      ? await put(blob.pathname, content, {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: metadata.contentType,
        token: targetToken,
        multipart: blob.size > 4 * 1024 * 1024,
      })
      : await putWithSchoolVercelOidc(blob.pathname, content, metadata.contentType, targetVercelCwd)
    copied.push({ pathname: blob.pathname, oldUrl: blob.url, newUrl: result.url, bytes: blob.size })
    console.log(`[${index + 1}/${sourceBlobs.length}] ${blob.pathname}`)
  }

  const oldHost = new URL(copied[0].oldUrl).host
  const newHost = new URL(copied[0].newUrl).host
  const manifest = {
    createdAt: new Date().toISOString(),
    oldHost,
    newHost,
    count: copied.length,
    copied,
  }
  await fs.mkdir(path.dirname(path.resolve(destination)), { recursive: true })
  await fs.writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  console.log(`\nCopy complete. Manifest saved to ${destination}`)
  console.log(`Old host: ${oldHost}\nNew host: ${newHost}`)
  console.log('Next: inspect a few copied files in Vercel, then run --rewrite-db (without --apply) for a safe preview.')
}

/**
 * New Vercel Blob connections use short-lived OIDC credentials instead of a
 * visible read/write token. The Vercel CLI reads those credentials from a
 * linked project directory, so this keeps the school credential out of both
 * the terminal command and this repository.
 */
async function putWithSchoolVercelOidc(pathname, content, contentType, cwd) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'dah-blob-migration-'))
  const tempFile = path.join(tempDirectory, 'upload')
  try {
    await fs.writeFile(tempFile, content, { mode: 0o600 })
    const { stdout, stderr } = await execFileAsync('npx', [
      '--yes', 'vercel@latest', 'blob', 'put', tempFile,
      '--pathname', pathname,
      '--access', 'public',
      '--content-type', contentType || 'application/octet-stream',
      '--allow-overwrite',
    ], { cwd, maxBuffer: 10 * 1024 * 1024 })
    // The CLI writes its successful upload URL to stderr in some terminal
    // modes, so inspect both streams. Allowing overwrite makes a stopped
    // migration safely resumable from the first file.
    const urls = `${stdout}\n${stderr}`.match(/https:\/\/[^\s]+\.public\.blob\.vercel-storage\.com\/[^\s]+/g)
    const url = urls?.at(-1)
    if (!url) throw new Error(`Vercel did not return a destination URL for ${pathname}.`)
    return { url }
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true })
  }
}

async function rewriteDatabase(manifestFile, apply) {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required for --rewrite-db.')
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'))
  if (!manifest.oldHost || !manifest.newHost || manifest.oldHost === manifest.newHost) {
    throw new Error('The manifest does not contain distinct oldHost and newHost values.')
  }

  const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const { rows: columns } = await client.query(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND data_type IN ('text', 'character varying', 'jsonb')
      ORDER BY table_name, ordinal_position
    `)

    const affected = []
    for (const column of columns) {
      const { table_name: table, column_name: columnName, data_type: type } = column
      const identifier = `"${table.replaceAll('"', '""')}"."${columnName.replaceAll('"', '""')}"`
      const query = type === 'jsonb'
        ? `SELECT count(*)::int AS count FROM "public"."${table.replaceAll('"', '""')}" WHERE ${identifier}::text LIKE '%' || $1 || '%'`
        : `SELECT count(*)::int AS count FROM "public"."${table.replaceAll('"', '""')}" WHERE ${identifier} LIKE '%' || $1 || '%'`
      const { rows } = await client.query(query, [manifest.oldHost])
      if (rows[0].count > 0) affected.push({ table, column: columnName, type, count: rows[0].count })
    }

    if (affected.length === 0) {
      console.log('No database URLs reference the old Blob host. No changes made.')
      return
    }
    console.table(affected)
    console.log(`\n${affected.reduce((sum, item) => sum + item.count, 0)} row(s) reference ${manifest.oldHost}.`)
    if (!apply) {
      console.log('Preview only. Re-run with --apply after checking copied images.')
      return
    }

    await client.query('BEGIN')
    for (const item of affected) {
      const table = item.table.replaceAll('"', '""')
      const column = item.column.replaceAll('"', '""')
      const identifier = `"${column}"`
      if (item.type === 'jsonb') {
        await client.query(
          `UPDATE "public"."${table}" SET ${identifier} = replace(${identifier}::text, $1, $2)::jsonb WHERE ${identifier}::text LIKE '%' || $1 || '%'`,
          [manifest.oldHost, manifest.newHost],
        )
      } else {
        await client.query(
          `UPDATE "public"."${table}" SET ${identifier} = replace(${identifier}, $1, $2) WHERE ${identifier} LIKE '%' || $1 || '%'`,
          [manifest.oldHost, manifest.newHost],
        )
      }
    }
    await client.query('COMMIT')
    console.log(`Updated Blob URL host references from ${manifest.oldHost} to ${manifest.newHost}.`)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}
