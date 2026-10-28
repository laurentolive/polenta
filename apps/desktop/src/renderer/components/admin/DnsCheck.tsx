import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { adminApi } from '../../lib/adminApi'

/** GH63 — vérification DNS d'un domaine (lecture seule) avant d'ajouter une instance ou un client web. */
export function DnsCheck() {
  const { t } = useTranslation()
  const [domain, setDomain] = useState('')
  const [result, setResult] = useState<Awaited<ReturnType<typeof adminApi.dns>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function check(e: React.FormEvent) {
    e.preventDefault()
    if (!domain.trim()) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(await adminApi.dns(domain.trim()))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <form className="flex items-end gap-2" onSubmit={check}>
        <label className="text-sm text-ink">
          {t('admin.dns.domain')}
          <input className="input-field mt-1 block w-72 font-mono" placeholder="forge.exemple.fr" value={domain} onChange={e => setDomain(e.target.value)} />
        </label>
        <button type="submit" className="btn-primary" disabled={busy}>{t('admin.dns.check')}</button>
      </form>
      {error && <p className="text-sm text-status-danger" role="alert">{error}</p>}
      {result && (
        <div className="space-y-1" aria-live="polite" data-testid="admin-dns-result">
          <p className={`text-sm ${result.verdict === 'ok' ? 'text-status-success' : 'text-status-warning'}`}>{result.message || result.verdict}</p>
          {result.verdict !== 'ok' && (
            <ul className="text-xs font-mono text-ink-2">
              {result.expected.map(r => <li key={`${r.type}-${r.value}`}>{r.type} {r.name} → {r.value}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
