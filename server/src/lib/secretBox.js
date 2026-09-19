// src/lib/secretBox.js — 서버 보관용 비밀값 암호화 (AES-256-GCM)
//
// Google Drive OAuth refresh token처럼 "서버만 알아야 하는 값"을 DB에 넣기 전에 여기서 봉인한다.
// 암호화 키는 Render 환경변수 DRIVE_TOKEN_ENC_KEY 하나뿐이고, 코드·DB·API 응답에는 절대 없다.
//
// 형식: v1.<iv-b64url>.<tag-b64url>.<ciphertext-b64url>
//   버전 접두사를 둬야 나중에 키 교체·알고리즘 교체 때 기존 행을 식별할 수 있다.
//
// 키 입력은 base64(44자) / hex(64자) / 임의 문자열 모두 받는다. 임의 문자열은 scrypt로 32바이트로
// 늘린다(평문 키를 그대로 쓰면 길이가 안 맞아 던지는 대신 조용히 약한 키가 되는 편을 막는다).
import crypto from 'node:crypto'

const VERSION = 'v1'
const SCRYPT_SALT = 'dah-drive-token-v1'

export class SecretKeyMissingError extends Error {
  constructor() {
    super('DRIVE_TOKEN_ENC_KEY가 설정되지 않아 Google 연결 토큰을 저장할 수 없습니다.')
    this.status = 503
    this.hint = 'Render 환경변수에 DRIVE_TOKEN_ENC_KEY(32바이트 랜덤값의 base64)를 추가한 뒤 재배포하세요.'
  }
}

function keyMaterial() {
  const raw = process.env.DRIVE_TOKEN_ENC_KEY?.trim()
  if (!raw) throw new SecretKeyMissingError()
  if (/^[A-Fa-f0-9]{64}$/.test(raw)) return Buffer.from(raw, 'hex')
  const b64 = Buffer.from(raw, 'base64')
  if (b64.length === 32) return b64
  return crypto.scryptSync(raw, SCRYPT_SALT, 32)
}

export function isSecretBoxConfigured() {
  try {
    keyMaterial()
    return true
  } catch {
    return false
  }
}

/** 평문 → 봉인 문자열. 빈 값은 봉인하지 않는다(호출부에서 null 저장) */
export function seal(plain) {
  const text = String(plain ?? '')
  if (!text) return null
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', keyMaterial(), iv)
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    enc.toString('base64url'),
  ].join('.')
}

/** 봉인 문자열 → 평문. 키가 바뀌었거나 값이 손상되면 null (호출부가 "재연결 필요"로 처리) */
export function open(sealed) {
  const parts = String(sealed ?? '').split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) return null
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      keyMaterial(),
      Buffer.from(parts[1], 'base64url')
    )
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}
