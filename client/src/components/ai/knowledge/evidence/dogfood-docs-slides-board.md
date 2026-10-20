# 도그푸딩 기록: 문서·발표·보드 AI (담당 ED)

방법: mock 제공업체의 `/mock {"events":[...]}` 로 도구 호출만 흘려 보내고, 결과는 패널 기록(localStorage `dah-ai:v1:*`)의 role tool 내용으로 읽었다.
주의: 같은 에이전트가 도구를 만들고 시험했으므로 구현을 모르는 상태의 시험은 아니다. 호출 인자는 도구 설명만 보고 정했고, 결과 글만 보고 다음 호출을 정했다. 한 번의 mock 차례에 여러 도구를 넣는 방식이라 "호출 수"는 차례 수가 아니라 도구 호출 수로 센다.

범위 안내: 목표는 편집기당 12개(총 36개)였으나 시간 제한 안에서 아래 18개 시나리오(문서 7, 발표 6, 보드 5)만 끝까지 돌렸다. 나머지 18개는 미수행이다(문서: 맞춤법과 번호 통일, 표 아래 요약, 영어 번역 등 기존 도구로 가능한 요청은 단위 테스트만 돌림).

## 문서
| # | 요청 | 쓴 도구 | 결과 | 막힌 점과 고친 것 |
|---|---|---|---|---|
| D1 | 빈 문서에 사업 개요 초안 | insert_blocks | 6개 블록 | 없음 |
| D2 | 구조와 문제 점검 | get_outline, check_document, find_in_document | 5건 감지(연속 공백, 문장부호 반복, 제목 단계 건너뜀, 빈 목록 항목, 번호 방식 섞임) | get_outline 에 표 정보가 없어 표 번호를 알 수 없었다. 고침: tables(t, 행x열, 머리글 여부, 첫 문단), images 추가 |
| D3 | 제목 단계 고치고 일부 글 강조 | apply_format x2 | 제목2 로, 굵게·빨강·형광펜 | 없음 |
| D4 | 검토 의견 달기 | add_comment, read_comments | 인용 글에 댓글이 달리고 [AI] 표시 | 서버가 작성자를 로그인 사용자로 정해 author 가 "AI" 가 아님(known gap). 본문 앞 [AI] 로 대신함 |
| D5 | 가로 용지, 쪽 번호 | set_page_setup | 값 반영, 현재값 반환 | 없음 |
| D6 | 표 행 추가, 칸 채우기, 머리글 꾸미기 | table_ops(add_row, fill), set_cell_style | 4행 2열, 노랑 머리글 | 없음 |
| D7 | 공문 형식으로 | switch_mode, set_gongmun_fields | 한글 모드 기안문, 두문(수신, 제목)과 자료값 | 없음. 인자 없이 부르면 현재 칸을 읽는 동작이 유용했다 |

## 발표
| # | 요청 | 쓴 도구 | 결과 | 막힌 점과 고친 것 |
|---|---|---|---|---|
| S1 | 개요로 4장 발표 | create_deck_from_outline | 4장 | 없음 |
| S2 | 디자인 점검 | check_deck | 빈 자리 표시, 목록 7개 | 메시지가 요소 id 만 보여 어떤 상자인지 알 수 없었다. 고침: 역할과 글 앞 14자를 함께 표시 |
| S3 | 글자 작은 곳, 대비 문제 고치기 | style_text, set_background, check_deck, fix_deck | 어두운 배경에서 대비 1.0:1 4곳을 한 번에 고침 | check_deck 의 고침 안내가 "@text 로" 였는데 어두운 배경에서는 같은 어두운 색이라 틀린 안내였다. 고침: 실제로 읽히는 색(#FFFFFF 등)을 계산해 안내하고 fix_deck 도 같은 계산 사용 |
| S4 | 도형, 이미지, 표 넣기 | add_shape, add_image(https, http 거부), add_table | 넣어짐, http 는 오류와 이유 | 없음 |
| S5 | 정렬 맞추기 | arrange_elements(stack_column, center_h) | boxes 로 새 자리 확인 | 없는 id 일 때 오류가 read_slide 로 다시 확인하라고 안내함(적절) |
| S6 | 슬라이드 복제, 전환 효과 | duplicate_slide, set_transition | 5장, 전환 5장 | 없음 |

## 보드
| # | 요청 | 쓴 도구 | 결과 | 막힌 점과 고친 것 |
|---|---|---|---|---|
| B1 | 아이디어 스티커 12개 | add_sticky_notes, read_canvas | 12장, spatial 요약 | 프레임이 없을 때 spatial.orphans 목록이 items 와 같아 토큰 낭비. 고침: 프레임이 없으면 개수만 |
| B2 | 주제별로 묶기 | cluster_items(group_into_frames 의 새 이름) | 프레임 3개, 12개 이동 | 없음 |
| B3 | KPT 틀에 내용 채우기 | add_frame_template, fill_template | 틀 21개 항목, 4칸 채움 | 없는 칸 "Stop" 은 errors 로 있는 프레임과 칸 제목 목록을 함께 돌려줘 바로 고칠 수 있었다 |
| B4 | 색 바꾸기, 검토 댓글 | set_item_style, add_comment_on_item | 반영, 댓글 author "AI" | 없음 |
| B5 | 타임라인 배치 | layout_items(timeline) | 3개 이동 | 다른 프레임의 항목과 겹쳐 놓였다. 고침: 겹치면 묶음 전체를 다른 항목들 오른쪽 빈 곳으로 옮기고 relocated 로 알림. 테스트 추가 |

## 남은 일
- 36개 중 18개 미수행.
- 모델 실제 호출(Claude 등)로는 돌려 보지 못했다. 도구 선택 품질은 mock 이 아니라 실제 모델로 다시 봐야 한다.
- LB 의 knowledge/{docs,slides,board}.md 는 아직 자리표시 글이라 프롬프트에 붙지 않는다(글이 채워지면 자동으로 붙는다).
