/** Device-pairing gate for installed mobile web-app contexts with isolated storage. */
import { type FormEvent, useState } from 'react'
import { acceptMobilePair, mobilePairPath, parseMobilePairInput } from './pairing.ts'

export interface PairRequiredViewProps {
  initialError?: string
  onPaired(path: string): void
}

/** Collect a fresh desktop-issued pairing link when this client has no paired cookie. */
export function PairRequiredView({ initialError, onPaired }: PairRequiredViewProps) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | undefined>(initialError)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const input = parseMobilePairInput(value)
    if (input === undefined) {
      setError('请输入有效的配对链接。')
      return
    }

    setSubmitting(true)
    setError(undefined)
    const result = await acceptMobilePair(input.token)
    setSubmitting(false)
    if (!result.ok) {
      setError(result.message)
      return
    }

    onPaired(mobilePairPath(input.workspaceId))
  }

  return (
    <main className="mobile mobile-pair" aria-labelledby="mobile-pair-title">
      <form className="mobile-pairCard" onSubmit={(event) => { void submit(event) }}>
        <h1 id="mobile-pair-title" className="mobile-title">设备配对</h1>
        <p className="mobile-muted">粘贴桌面端复制的配对链接以连接此设备。</p>
        <label className="mobile-pairLabel" htmlFor="mobile-pair-link">配对链接</label>
        <input
          id="mobile-pair-link"
          className="mobile-pairInput"
          value={value}
          onChange={(event) => { setValue(event.target.value) }}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        {error === undefined ? null : <p className="mobile-error" role="alert">{error}</p>}
        <button className="mobile-new mobile-pairSubmit" type="submit" disabled={submitting}>
          {submitting ? '正在配对' : '配对'}
        </button>
      </form>
    </main>
  )
}
