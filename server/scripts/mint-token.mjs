// 로컬 테스트용 로그인 토큰 발급(스태프=users, 게스트=public_users). 출력값은 쿠키 값이다. 커밋 금지 아님(비밀값 없음, .env의 JWT_SECRET 사용).
// 사용: node scripts/mint-token.mjs staff 1 smmilk2378@gmail.com 주현호 owner  → dah_access 쿠키 값
//       node scripts/mint-token.mjs guest 123 someone@gmail.com 이름           → dah_pub_access 쿠키 값
import 'dotenv/config'
import jwt from 'jsonwebtoken'
const [kind, id, email, name, role] = process.argv.slice(2)
const s = process.env.JWT_SECRET
if (kind === 'staff') console.log(jwt.sign({ sub: Number(id), email, name, role: role || 'owner', type: 'access' }, s, { expiresIn: 3600 * 6 }))
else console.log(jwt.sign({ sub: Number(id), email, name, kind: 'public', type: 'access' }, s, { expiresIn: 3600 * 6 }))
