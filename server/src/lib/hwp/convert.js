// 형식 변환: docx → hwpx, hwpx → docx, 한글 → 문서(Tiptap). 클라이언트와 같은 IR 변환기(lib/docIR 복사본)를 쓴다.
import { readDocx } from '../docIR/readDocx.js'
import { writeHwpx } from '../docIR/writeHwpx.js'
import { readHwpx } from '../docIR/readHwpx.js'
import { writeDocx } from '../docIR/writeDocx.js'
import { irToTiptap } from '../docIR/irToTiptap.js'
import { HwpError, loadKordoc } from './kordoc.js'

export async function docxToHwpx(bytes) {
  try {
    const ir = await readDocx(bytes)
    return { bytes: await writeHwpx(ir), ir }
  } catch (e) {
    throw new HwpError('CORRUPTED', `워드 파일을 한글로 바꾸지 못했습니다: ${String(e.message || e).slice(0, 120)}`, 422)
  }
}

/** HWPX 는 IR 로 바로, HWP(5.x)는 내용(마크다운)을 공문 HWPX 로 다시 만든 뒤 IR 로 옮긴다(서식은 근사) */
export async function toIR(bytes, format) {
  if (format === 'hwpx') return { ir: await readHwpx(bytes), approximate: false }
  const k = await loadKordoc()
  const r = await k.parse(Buffer.from(bytes), { images: false })
  if (!r.success) throw new HwpError('CORRUPTED', '파일을 읽지 못했습니다.', 422)
  const hwpx = await k.markdownToHwpx(r.markdown)
  return { ir: await readHwpx(new Uint8Array(hwpx)), approximate: true }
}

export async function toDocx(bytes, format) {
  const { ir, approximate } = await toIR(bytes, format)
  return { bytes: await writeDocx(ir), approximate }
}

export async function toTiptap(bytes, format) {
  const { ir, approximate } = await toIR(bytes, format)
  const issues = []
  const doc = irToTiptap(ir, { issues })
  return { doc, issues, approximate }
}
