// ImageUpload.jsx — 파일 업로드 필드 (POST /upload → URL). 이미지·HWP 공용.

import { useRef, useState } from 'react'
import { Paperclip, Trash2, Upload } from 'lucide-react'
import { api } from '../../hooks/useApi'
import { ErrorText, GhostButton } from './FormControls'
import GoogleDriveIcon from '../common/GoogleDriveIcon'

/**
 * @param {{
 *   value: string, onChange: Function, accept?: string,
 *   preview?: boolean, buttonLabel?: string, usage?: string,
 *   onUploadingChange?: Function, formSlug?: string, fieldId?: string, driveEnabled?: boolean, formValues?: object,
 *   uploadDisabled?: boolean, disabledMessage?: string, noteText?: string
 * }} props - preview false면 이미지 미리보기 대신 파일 링크 표시(HWP 등).
 *   usage: 서버 리사이즈 정책(general 1600 | poster 2400 | showcase 1920x1080 | exhibition)
 *   onUploadingChange(active): 업로드 진행 중 여부를 상위에 전파 — 저장 버튼이 업로드 완료를
 *     기다리게 해, 업로드가 URL을 form에 넣기 전에 저장돼 빈 값이 저장되는 레이스를 막는다.
 */
function ImageUpload({
  value = '',
  onChange,
  accept = 'image/*',
  preview = true,
  buttonLabel = '파일 선택',
  usage = 'general',
  onUploadingChange,
  formSlug,
  fieldId,
  driveEnabled = false,
  formValues = {},
  uploadDisabled = false,
  disabledMessage = '',
  noteText = '',
}) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const handleFile = async (event) => {
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setError(null)
    onUploadingChange?.(true)
    try {
      // 폼 업로드는 저장 위치를 서버가 판단한다 — formSlug·fieldId를 항상 보내고,
      // 과목 폴더 판정에 쓸 현재 입력값도 함께 보낸다(서버가 보기 목록과 대조한다).
      const res = await api.upload(file, {
        usage,
        ...(formSlug && fieldId ? { formSlug, fieldId, formValues: JSON.stringify(formValues) } : {}),
      })
      if (!res?.url) throw new Error('업로드 응답에 url이 없습니다.')
      onChange(res.url)
    } catch (err) {
      // 업로드 실패(콜드 스타트·네트워크·서버 오류)를 명확히 노출 — 실패 시 URL은 저장하지 않음
      setError(err.message)
    } finally {
      setBusy(false)
      onUploadingChange?.(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-8">
      {value && preview && (
        /* H7.1: 원본 비율 유지(contain) — 찌그러짐 방지. 포스터는 세로 2:3 프레임 */
        <img
          src={value}
          alt="업로드 미리보기"
          className={`w-full rounded-md border border-border-subtle bg-bg-elev object-contain ${
            usage === 'poster' ? 'aspect-[2/3] max-w-[240px]' : 'aspect-video max-w-sm'
          }`}
        />
      )}
      {value && !preview && (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-8 font-mono text-small-m text-text-sec underline underline-offset-4 hover:text-text-pri"
        >
          <Paperclip size={16} aria-hidden="true" />
          {value.split('/').pop()}
        </a>
      )}
      <div className="flex flex-wrap items-center gap-8">
        <GhostButton onClick={() => inputRef.current && inputRef.current.click()} disabled={busy || uploadDisabled}>
          {driveEnabled ? <GoogleDriveIcon /> : <Upload size={16} aria-hidden="true" />}
          {busy ? '업로드 중' : driveEnabled ? 'Google Drive로 업로드' : buttonLabel}
        </GhostButton>
        {value && (
          <GhostButton onClick={() => onChange('')} aria-label="파일 제거">
            <Trash2 size={16} aria-hidden="true" />
            제거
          </GhostButton>
        )}
      </div>
      {busy && (
        <p className="font-mono text-caption-m text-text-meta">
          업로드 중 — 완료된 뒤 저장하세요
        </p>
      )}
      {driveEnabled && uploadDisabled && (
        <p className="font-mono text-caption-m text-[#7a5b1f]">
          {disabledMessage || '필수 항목을 먼저 선택하세요.'}
        </p>
      )}
      {noteText && !busy && !uploadDisabled && (
        <p className="font-mono text-caption-m text-text-meta">{noteText}</p>
      )}
      <ErrorText>{error}</ErrorText>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleFile}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  )
}

export default ImageUpload
