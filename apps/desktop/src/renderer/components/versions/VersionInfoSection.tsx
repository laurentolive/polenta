import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { UpdateVersionDto, VersionPage } from '@polenta/types'
import { fieldValueToText } from '@polenta/types'
import { DynamicField } from '../DynamicField'
import { PageLink } from '../element/PageLink'
import { SectionToggle } from './SectionToggle'
import { STATE_BADGE, statusLabel, useSectionOpen } from './useVersions'

/**
 * GH439 §4 — section « Informations » d'une version : libellé, statut, « basée sur », tag et commit figés,
 * champs du type version (Enregistrer / Annuler). Le contenu de l'ancien en-tête repliable, sans changement
 * de comportement ; seul le repli passe par le même en-tête de section que les autres.
 */
export function VersionInfoSection({ page, repoPath, projectId, editable, onUpdate }: {
  page: VersionPage
  repoPath: string
  projectId: string
  editable: boolean
  onUpdate: (dto: UpdateVersionDto) => Promise<void>
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useSectionOpen('info')
  const { version, typeDef, state } = page
  const [title, setTitle] = useState('')
  const [fields, setFields] = useState<Record<string, unknown>>({})
  useEffect(() => {
    setTitle(version.title)
    setFields(version.fields ?? {})
  }, [version])
  const fieldsDirty = JSON.stringify(fields) !== JSON.stringify(version.fields ?? {})
  // Statuts proposés : jamais le statut released (passage dédié) ; une version figée ne propose que l'abandon.
  const statusOptions = (typeDef.statuses ?? []).filter(s => s.name === version.status || (!s.isApproval && (!version.freeze || s.isTerminal)))

  return (
    <section className="flex flex-col gap-2" data-testid="version-info-section">
      <SectionToggle open={open} onToggle={() => setOpen(o => !o)} label={t('versions.info.title')} testId="version-info-toggle" />
      {open && (
        <div className="flex flex-col gap-5" data-testid="version-info">
          <section className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-xs items-center max-w-3xl">
            <span className="text-ink-3">{t('versions.label')}</span>
            {editable ? (
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                onBlur={() => { if (title.trim() && title !== version.title) void onUpdate({ title }) }}
                className="input-field text-sm max-w-xs"
                data-testid="version-title"
              />
            ) : <span className="text-sm text-ink">{version.title}</span>}

            <span className="text-ink-3">{t('versions.status')}</span>
            <span className="flex items-center gap-2">
              <span className={`px-1.5 rounded text-[10px] ${STATE_BADGE[state]}`}>{t(`versions.state.${state}`)}</span>
              {!page.component.readonly && statusOptions.length > 1 ? (
                <select value={version.status} onChange={e => void onUpdate({ status: e.target.value })} className="input-field text-xs" data-testid="version-status">
                  {statusOptions.map(s => <option key={s.name} value={s.name}>{s.label || s.name}</option>)}
                </select>
              ) : <span className="text-ink">{statusLabel(typeDef, version.status)}</span>}
            </span>

            <span className="text-ink-3">{t('versions.basedOn')}</span>
            {editable ? (
              <select value={version.basedOn ?? ''} onChange={e => void onUpdate({ basedOn: e.target.value || null })} className="input-field text-xs max-w-xs" data-testid="version-based-on">
                <option value="">{t('versions.none')}</option>
                {page.basedOnOptions.map(v => <option key={v.id} value={v.id}>{v.title} ({v.id}){v.state !== 'released' ? ` — ${t(`versions.state.${v.state}`)}` : ''}</option>)}
              </select>
            ) : page.basedOn ? (
              <span>
                <PageLink id={page.basedOn.id} repoPath={repoPath} className="text-prim text-left"
                  onFallback={() => void navigate({ to: '/version/$versionId', params: { versionId: page.basedOn!.id }, search: { projectId, repoPath } })}>
                  {page.basedOn.title} ({page.basedOn.id})
                </PageLink>
              </span>
            ) : <span className="text-ink-3">{t('versions.none')}</span>}

            {version.freeze && (
              <>
                <span className="text-ink-3">{t('versions.release.tag')}</span>
                <span className="font-mono text-ink">{version.freeze.tag} <span className="text-ink-3">@ {version.freeze.sha.slice(0, 7)}</span></span>
              </>
            )}
          </section>

          {(typeDef.fields ?? []).length > 0 && (
            <section className="flex flex-col gap-3 max-w-3xl">
              {(typeDef.fields ?? []).map(f => (
                <DynamicField
                  key={f.name}
                  field={f}
                  value={fieldValueToText(fields[f.name])}
                  onChange={v => setFields(prev => ({ ...prev, [f.name]: v }))}
                  disabled={!editable}
                  repoPath={repoPath}
                />
              ))}
              {editable && fieldsDirty && (
                <div className="flex gap-2">
                  <button type="button" onClick={() => void onUpdate({ fields })} className="btn-primary-sm" data-testid="version-save-fields">{t('common.save')}</button>
                  <button type="button" onClick={() => setFields(version.fields ?? {})} className="btn-secondary-sm">{t('common.cancel')}</button>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </section>
  )
}
