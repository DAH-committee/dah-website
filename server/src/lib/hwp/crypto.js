// 파일 바이트 암호화(AES-256-GCM). 파일마다 무작위 32바이트 키를 만들고, 그 키는 secretBox(DRIVE_TOKEN_ENC_KEY)로 봉인해 DB에 둔다.
// 저장 형식: iv(12) | tag(16) | 암호문. 같은 파일의 여러 버전은 같은 키를 쓰되 iv 는 매번 새로 만든다.
// Vercel Blob 저장소는 공개 전용이라 8MB 넘는 암호문을 Blob에 둘 때도 평문은 나가지 않는다.
import crypto from 'node:crypto'
import { seal, open } from '../secretBox.js'

export function newFileKey() {
  const raw = crypto.randomBytes(32)
  return { raw, sealed: seal(raw.toString('base64')) }
}
export function openFileKey(sealed) {
  const b64 = open(sealed)
  if (!b64) return null
  return Buffer.from(b64, 'base64')
}
export function encryptBytes(key, bytes) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([c.update(bytes), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), enc])
}
export function decryptBytes(key, blob) {
  const b = Buffer.from(blob)
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12))
  d.setAuthTag(b.subarray(12, 28))
  return Buffer.concat([d.update(b.subarray(28)), d.final()])
}
export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
