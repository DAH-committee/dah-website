// 새 발표 템플릿 목록(허브의 템플릿 줄이 쓴다). 서버는 같은 내용의 server/src/lib/slideTemplates.js로 만든다.
//   import { SLIDE_TEMPLATES } from '../slides/templates'
//   SLIDE_TEMPLATES: [{ id, name, sub, build: () => content }]
//   새 발표: POST /workspace/files { kind: 'slide', template: id }
// 미리보기가 필요하면 SlideView(scale, mode='thumb')에 build().slides[0]과 build().theme을 넘긴다.
import { SLIDE_TEMPLATE_LIST, SLIDE_TEMPLATE_META } from './deckCore'

export const SLIDE_TEMPLATES = SLIDE_TEMPLATE_LIST
export { SLIDE_TEMPLATE_META }
export { default as SlideView } from './SlideView'
export default SLIDE_TEMPLATES
