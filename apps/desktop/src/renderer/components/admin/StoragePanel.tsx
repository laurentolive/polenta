import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { adminApi, type PurgeInventory, type S3Info } from '../../lib/adminApi'
import { ConfirmByName } from './ConfirmByName'
import { JobView } from './JobView'
import { useLaunch } from './useLaunch'

const purgePhrase = (name: string) => `supprimer définitivement les sauvegardes de ${name}`

/**
 * GH63 — stockage S3 des sauvegardes (niveau hôte) : remplacement de la clé (testée d'abord, retour
 * arrière automatique) et purge des sauvegardes d'une instance supprimée, en deux temps (inventaire,
 * puis clé de purge et phrase exacte). Les clés saisies ne sont ni affichées ni conservées.
 */
export function StoragePanel() {
  const { t } = useTranslation()
  const [s3, setS3] = useState<S3Info | null | undefined>(undefined)
  const [rotate, setRotate] = useState({ endpoint: '', bucket: '', accessKey: '', secretKey: '' })
  const [purgeName, setPurgeName] = useState('')
  const [inventory, setInventory] = useState<PurgeInventory | null>(null)
  const [purgeKeys, setPurgeKeys] = useState({ purgeAccessKey: '', purgeSecretKey: '' })
  const [withoutExport, setWithoutExport] = useState(false)
  const [confirmPurge, setConfirmPurge] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { jobId, error: launchError, launch, clear } = useLaunch()

  useEffect(() => {
    adminApi.hostS3().then(setS3, () => setS3(null))
  }, [jobId])

  async function submitRotate(e: React.FormEvent) {
    e.preventDefault()
    const params: Record<string, string> = { accessKey: rotate.accessKey, secretKey: rotate.secretKey }
    if (rotate.endpoint.trim()) params.endpoint = rotate.endpoint.trim()
    if (rotate.bucket.trim()) params.bucket = rotate.bucket.trim()
    if (await launch({ operation: 's3.rotate', params })) setRotate({ endpoint: '', bucket: '', accessKey: '', secretKey: '' })
  }

  async function loadInventory(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInventory(null)
    try {
      setInventory(await adminApi.purgePreview(purgeName.trim()))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-6">
      {jobId && <JobView jobId={jobId} onClose={clear} />}
      {(launchError || error) && <p className="text-sm text-status-danger" role="alert">{launchError ?? error}</p>}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">{t('admin.storage.current')}</h3>
        {s3 === undefined && <p className="text-sm text-ink-3">{t('common.loading')}</p>}
        {s3 === null && <p className="text-sm text-ink-3">{t('admin.storage.none')}</p>}
        {s3 && (
          <dl className="grid grid-cols-[10rem_1fr] gap-1 text-sm" data-testid="admin-s3">
            <dt className="text-ink-3">{t('admin.storage.endpoint')}</dt><dd className="font-mono">{s3.endpoint}</dd>
            <dt className="text-ink-3">{t('admin.storage.bucket')}</dt><dd className="font-mono">{s3.bucket}</dd>
            <dt className="text-ink-3">{t('admin.storage.key')}</dt><dd className="font-mono">{s3.accessKeyHint}</dd>
            <dt className="text-ink-3">{t('admin.storage.rotatedAt')}</dt><dd>{s3.rotatedAt ? new Date(s3.rotatedAt).toLocaleString() : '—'}</dd>
          </dl>
        )}
      </section>

      <form className="space-y-2" onSubmit={submitRotate} autoComplete="off">
        <h3 className="text-sm font-semibold text-ink">{t('admin.storage.rotateTitle')}</h3>
        <p className="text-xs text-ink-3">{t('admin.storage.rotateHint')}</p>
        <div className="grid grid-cols-2 gap-2 max-w-2xl">
          <input className="input-field" placeholder={t('admin.storage.endpointPlaceholder')} aria-label={t('admin.storage.endpoint')} value={rotate.endpoint} onChange={e => setRotate(r => ({ ...r, endpoint: e.target.value }))} />
          <input className="input-field" placeholder={t('admin.storage.bucketPlaceholder')} aria-label={t('admin.storage.bucket')} value={rotate.bucket} onChange={e => setRotate(r => ({ ...r, bucket: e.target.value }))} />
          <input className="input-field" type="password" aria-label={t('admin.storage.accessKey')} placeholder={t('admin.storage.accessKey')} value={rotate.accessKey} onChange={e => setRotate(r => ({ ...r, accessKey: e.target.value }))} />
          <input className="input-field" type="password" aria-label={t('admin.storage.secretKey')} placeholder={t('admin.storage.secretKey')} value={rotate.secretKey} onChange={e => setRotate(r => ({ ...r, secretKey: e.target.value }))} />
        </div>
        <button type="submit" className="btn-primary" disabled={!rotate.accessKey || !rotate.secretKey}>{t('admin.storage.rotate')}</button>
      </form>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">{t('admin.storage.purgeTitle')}</h3>
        <p className="text-xs text-ink-3">{t('admin.storage.purgeHint')}</p>
        <form className="flex items-end gap-2" onSubmit={loadInventory}>
          <label className="text-sm text-ink">
            {t('admin.storage.purgeName')}
            <input className="input-field mt-1 block w-56 font-mono" value={purgeName} onChange={e => { setPurgeName(e.target.value); setInventory(null) }} />
          </label>
          <button type="submit" className="btn-secondary" disabled={!purgeName.trim()}>{t('admin.storage.inventory')}</button>
        </form>
        {inventory && (
          <div className="space-y-2 border border-edge rounded-lg p-3" data-testid="admin-purge-inventory">
            <p className="text-sm">
              {t('admin.storage.inventoryLine', { snapshots: inventory.snapshots, objects: inventory.objects, mb: (inventory.bytes / (1 << 20)).toFixed(1), oldest: inventory.oldest ?? '—', newest: inventory.newest ?? '—' })}
            </p>
            <div className="grid grid-cols-2 gap-2 max-w-2xl" role="group" aria-label={t('admin.storage.purgeKey')}>
              <input className="input-field" type="password" autoComplete="off" placeholder={t('admin.storage.purgeAccessKey')} aria-label={t('admin.storage.purgeAccessKey')} value={purgeKeys.purgeAccessKey} onChange={e => setPurgeKeys(k => ({ ...k, purgeAccessKey: e.target.value }))} />
              <input className="input-field" type="password" autoComplete="off" placeholder={t('admin.storage.purgeSecretKey')} aria-label={t('admin.storage.purgeSecretKey')} value={purgeKeys.purgeSecretKey} onChange={e => setPurgeKeys(k => ({ ...k, purgeSecretKey: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={withoutExport} onChange={e => setWithoutExport(e.target.checked)} />
              {t('admin.storage.withoutExport')}
            </label>
            {withoutExport && <p className="text-xs text-status-warning" role="alert">{t('admin.storage.withoutExportWarning')}</p>}
            <button type="button" className="btn-danger" disabled={!purgeKeys.purgeAccessKey || !purgeKeys.purgeSecretKey} onClick={() => setConfirmPurge(true)}>
              {t('admin.storage.purge')}
            </button>
          </div>
        )}
      </section>

      {confirmPurge && inventory && (
        <ConfirmByName
          title={t('admin.storage.purgeConfirmTitle', { name: inventory.instance })}
          message={t('admin.storage.purgeConfirmMessage')}
          expected={purgePhrase(inventory.instance)}
          danger
          confirmLabel={t('admin.storage.purge')}
          onCancel={() => setConfirmPurge(false)}
          onConfirm={async typed => {
            setConfirmPurge(false)
            const ok = await launch({ operation: 's3.purge', params: { name: inventory.instance, ...purgeKeys, withoutExport }, confirm: typed })
            if (ok) {
              setPurgeKeys({ purgeAccessKey: '', purgeSecretKey: '' })
              setInventory(null)
            }
          }}
        />
      )}
    </div>
  )
}
