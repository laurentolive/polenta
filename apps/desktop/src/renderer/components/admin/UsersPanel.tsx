import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdminMe } from '@polenta/types'
import { adminApi, type AccessRow, type ImportPreview, type InstanceRow } from '../../lib/adminApi'
import { JobView } from './JobView'
import { useLaunch } from './useLaunch'

const MAX_BYTES = 5 * 1024 * 1024

/**
 * GH63 — utilisateurs (fonctions sans équivalent Forgejo, spec UC5) : import CSV avec aperçu puis
 * mots de passe à usage unique, rapport d'accès croisé (CSV identique à l'affichage), message
 * d'invitation, et lien vers l'administration de la forge pour tout le reste.
 */
export function UsersPanel({ me, rows }: { me: AdminMe; rows: InstanceRow[] }) {
  const { t } = useTranslation()
  const [instance, setInstance] = useState(me.instance)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<AccessRow[] | null>(null)
  const [filter, setFilter] = useState('')
  const [login, setLogin] = useState('')
  const [invite, setInvite] = useState<{ message: string; inviteLink: string } | null>(null)
  const { jobId, error: launchError, launch, clear } = useLaunch()
  const domain = rows.find(r => r.name === instance)?.domain

  useEffect(() => {
    setReport(null)
    adminApi.accessReport(instance).then(r => setReport(r.rows), e => setError(String(e.message ?? e)))
  }, [instance, jobId])

  async function onFile(file: File | undefined) {
    setPreview(null)
    setError(null)
    if (!file) return
    if (file.size > MAX_BYTES) return setError(t('admin.users.tooBig'))
    try {
      setPreview(await adminApi.importPreview(await file.text(), instance))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return (report ?? []).filter(r => !f || r.user.toLowerCase().includes(f) || r.repo.toLowerCase().includes(f))
  }, [report, filter])

  function reportCsv() {
    const csv = 'user;repo;permission\n' + shown.map(r => `${r.user};${r.repo};${r.permission}`).join('\n') + '\n'
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `acces-${instance}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        {me.level === 'host' && (
          <label className="text-sm text-ink">
            {t('admin.backups.instance')}
            <select className="input-field mt-1 block" value={instance} onChange={e => { setInstance(e.target.value); setPreview(null) }}>
              {rows.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
            </select>
          </label>
        )}
        {domain && (
          <a className="btn-secondary" href={`https://${domain}/`} target="_blank" rel="noopener noreferrer">{t('admin.users.forgeAdmin')}</a>
        )}
      </div>
      {jobId && <JobView jobId={jobId} onClose={clear} />}
      {(launchError || error) && <p className="text-sm text-status-danger" role="alert">{launchError ?? error}</p>}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">{t('admin.users.importTitle')}</h3>
        <p className="text-xs text-ink-3">{t('admin.users.importHint')}</p>
        <input type="file" accept=".csv,text/csv" aria-label={t('admin.users.importFile')} onChange={e => void onFile(e.target.files?.[0])} />
        {preview && (
          <div className="space-y-2 border border-edge rounded-lg p-3" data-testid="admin-import-preview">
            <p className="text-sm">{t('admin.users.previewLine', { valid: preview.rows.length, rejected: preview.rejected.length })}</p>
            {preview.rejected.length > 0 && (
              <ul className="text-xs text-status-danger">
                {preview.rejected.map(r => <li key={r.line}>{t('admin.users.rejectedLine', { line: r.line, login: r.login ?? '', cause: r.cause })}</li>)}
              </ul>
            )}
            {preview.unknownTeams.length > 0 && <p className="text-xs text-status-warning">{t('admin.users.unknownTeams', { teams: preview.unknownTeams.join(', ') })}</p>}
            <button
              type="button"
              className="btn-primary"
              disabled={preview.rows.length === 0}
              onClick={async () => {
                if (await launch({ operation: 'users.import', instance: preview.instance, params: { uploadId: preview.uploadId } })) setPreview(null)
              }}
            >
              {t('admin.users.import', { count: preview.rows.length })}
            </button>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">{t('admin.users.inviteTitle')}</h3>
        <form
          className="flex items-end gap-2"
          onSubmit={async e => {
            e.preventDefault()
            setInvite(null)
            try {
              setInvite(await adminApi.invite(login.trim(), instance))
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err))
            }
          }}
        >
          <label className="text-sm text-ink">
            {t('admin.users.login')}
            <input className="input-field mt-1 block w-48 font-mono" value={login} onChange={e => setLogin(e.target.value)} />
          </label>
          <button type="submit" className="btn-secondary" disabled={!login.trim()}>{t('admin.users.inviteBuild')}</button>
        </form>
        {invite && (
          <div className="space-y-1" data-testid="admin-invite">
            <pre className="text-xs whitespace-pre-wrap border border-edge rounded p-2 select-all">{invite.message}</pre>
            <button type="button" className="btn-secondary-sm" onClick={() => void navigator.clipboard?.writeText(invite.message)}>{t('admin.secret.copy')}</button>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-end gap-2">
          <h3 className="text-sm font-semibold text-ink flex-1">{t('admin.users.reportTitle')}</h3>
          <input className="input-field text-xs py-1 w-48" placeholder={t('common.filterPlaceholder')} aria-label={t('admin.users.reportFilter')} value={filter} onChange={e => setFilter(e.target.value)} />
          <button type="button" className="btn-secondary-sm" disabled={!shown.length} onClick={reportCsv}>{t('admin.journal.exportCsv')}</button>
        </div>
        {!report && !error && <p className="text-sm text-ink-3">{t('common.loading')}</p>}
        {report && (
          <table className="w-full text-xs" data-testid="admin-access-report">
            <thead>
              <tr className="text-left text-ink-3 border-b border-edge">
                <th className="py-1.5 pr-3">{t('admin.users.user')}</th>
                <th className="py-1.5 pr-3">{t('admin.users.repo')}</th>
                <th className="py-1.5">{t('admin.users.permission')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={`${r.user}-${r.repo}`} className="border-b border-edge">
                  <td className="py-1 pr-3 font-mono">{r.user}</td>
                  <td className="py-1 pr-3 font-mono">{r.repo}</td>
                  <td className="py-1">{r.permission}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
