// 짧은 공유 주소(/s/코드)를 편집기 주소로 바꿔 준다. 링크 키(?k=)는 여기서 붙인다.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../../hooks/useApi'
import NoAccess from '../../components/common/NoAccess'

export default function ShortLink() {
  const { code } = useParams()
  const navigate = useNavigate()
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let live = true
    api.get(`/workspace/s/${encodeURIComponent(code)}`)
      .then((r) => {
        if (!live) return
        if (!r?.path) return setMissing(true)
        navigate(r.k ? `${r.path}?k=${encodeURIComponent(r.k)}` : r.path, { replace: true })
      })
      .catch(() => live && setMissing(true))
    return () => { live = false }
  }, [code, navigate])

  if (missing) return <NoAccess notFound />
  return null
}
