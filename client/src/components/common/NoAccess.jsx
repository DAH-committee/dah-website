// 액세스 권한이 없을 때 보여 주는 화면(구글 독스의 "액세스 권한 필요" 화면과 같은 구성).
// 다른 계정으로 로그인하거나 계정을 바꿀 수 있다.
import { Link, useLocation } from 'react-router-dom'
import AccountMenu, { GoogleG, startGoogleLogin, useMe } from './AccountMenu'
import { HOME_BY_FILE_KIND, ICON_BY_FILE_KIND } from '../../pages/workspace/icons'
import './noAccess.css'

export default function NoAccess({ kind = 'doc', notFound = false, hub = false, message = '' }) {
  // kind를 따로 넘기지 않는 편집기(보드·슬라이드가 'doc'을 넘기는 경우)는 주소로 제품을 알아낸다
  const { pathname } = useLocation()
  const byPath = /^\/boards\//.test(pathname) ? 'board' : /^\/slides\//.test(pathname) ? 'slide' : null
  const product = kind === 'doc' && byPath ? byPath : ICON_BY_FILE_KIND[kind] ? kind : 'doc'
  const Icon = ICON_BY_FILE_KIND[product]
  const { me } = useMe()
  return (
    <div className="noacc">
      <div className="noacc__top">
        <Link to={HOME_BY_FILE_KIND[product]} className="ed-icon" aria-label="작업공간으로"><Icon size={40} /></Link>
        <div className="noacc__acct"><AccountMenu size={40} /></div>
      </div>
      <div className="noacc__box">
        <h1>{notFound ? '파일을 찾을 수 없습니다' : '액세스 권한이 필요합니다'}</h1>
        <p>
          {message || (hub
            ? '구글 계정으로 로그인하면 열 수 있습니다.'
            : notFound
              ? '주소가 바르지 않거나 삭제된 파일입니다.'
              : '이 파일을 열 권한이 없습니다. 소유자에게 이메일 주소를 알려 권한을 요청하거나, 권한이 있는 다른 계정으로 로그인하세요.')}
        </p>
        {me && !me.user && !notFound && (
          <button type="button" className="gbtn" onClick={() => startGoogleLogin()}><GoogleG size={22} /> 구글 계정으로 로그인</button>
        )}
        <p className="noacc__hint">오른쪽 위 프로필에서 다른 계정으로 로그인할 수 있습니다.</p>
      </div>
    </div>
  )
}
