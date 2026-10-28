import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * GH63 — valeur à usage unique (clé de sauvegarde, mots de passe temporaires) : masquée par défaut,
 * copie, téléchargement (CSV login;mot de passe pour un import). Jamais conservée par la page : elle
 * disparaît avec le composant ; le service l'a déjà effacée.
 */
export function OneTimeSecret({ secret, jobResult, fileName }: { secret: Record<string, unknown>; jobResult?: Record<string, unknown>; fileName: string }) {
  const { t } = useTranslation()
  const [shown, setShown] = useState(false)
  const entries = Object.entries(secret).map(([path, value]) => ({ path, label: labelOf(path, jobResult), value: String(value) }))

  const asCsv = () => 'login;password\n' + entries.map(e => `${e.label};${e.value}`).join('\n') + '\n'
  const download = () => {
    const blob = new Blob([entries.length > 1 || entries[0]?.label !== entries[0]?.path ? asCsv() : entries[0].value + '\n'], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = entries.length > 1 ? `${fileName}.csv` : `${fileName}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="px-4 pb-3 space-y-2" data-testid="admin-secret">
      <p className="text-xs text-status-warning">{t('admin.job.secretOnce')}</p>
      <dl className="text-sm space-y-1">
        {entries.map(e => (
          <div key={e.path} className="flex items-center gap-2">
            <dt className="text-ink-3 min-w-24">{e.label}</dt>
            <dd className="font-mono text-ink select-all" data-testid="admin-secret-value">{shown ? e.value : '••••••••••••'}</dd>
          </div>
        ))}
      </dl>
      <div className="flex gap-2">
        <button type="button" className="btn-secondary-sm" onClick={() => setShown(s => !s)}>{shown ? t('admin.secret.hide') : t('admin.secret.show')}</button>
        <button type="button" className="btn-secondary-sm" onClick={() => void navigator.clipboard?.writeText(entries.length === 1 ? entries[0].value : asCsv())}>{t('admin.secret.copy')}</button>
        <button type="button" className="btn-secondary-sm" onClick={download}>{t('admin.secret.download')}</button>
      </div>
    </div>
  )
}

/** `created.3.temporaryPassword` → login de la ligne 3 du résultat ; sinon le chemin. */
function labelOf(path: string, result?: Record<string, unknown>): string {
  const m = /^(\w+)\.(\d+)\.\w+$/.exec(path)
  if (m && result && Array.isArray(result[m[1]])) {
    const row = (result[m[1]] as Record<string, unknown>[])[Number(m[2])]
    if (row && typeof row.login === 'string') return row.login
  }
  if (path === 'resticPassword') return typeof result?.instance === 'string' ? result.instance : path
  if (/clientAdmin\.temporaryPassword$/.test(path)) {
    const login = (result?.clientAdmin as { login?: string } | undefined)?.login
    if (login) return login
  }
  return path
}
