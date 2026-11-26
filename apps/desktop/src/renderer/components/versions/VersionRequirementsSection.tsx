import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { VersionRequirementRow } from '@polenta/types'
import { useElementNav } from '../../contexts/ElementNavContext'
import { DataGrid } from '../grid/DataGrid'
import { useGridScrollKey } from '../grid/useGridScrollKey'
import { SectionToggle } from './SectionToggle'
import { useSectionOpen, versionErrorText } from './useVersions'
import { useVersionRequirements } from './useVersionRequirements'
import { buildVersionRequirementColumns, versionRequirementDefaults, versionRequirementRowId } from './versionRequirementColumns'

/**
 * GH439 §2.3 — exigences de la version : celles du repo à l'état de la version (figé au tag pour une version
 * released, disque pour une version en cours), en grille commune en lecture seule, avec leur statut de
 * vérification (figé à la release). Fermée par défaut ; ne lit rien tant qu'elle est fermée.
 */
export function VersionRequirementsSection({ repoPath, projectId, versionId, versionLabel }: {
  repoPath: string
  projectId: string
  versionId: string
  /** Titre de la grille (fenêtre de la grille, accessibilité). */
  versionLabel: string
}) {
  const { t, i18n } = useTranslation()
  const nav = useElementNav()
  const [open, setOpen] = useSectionOpen('requirements', false)
  const { data, error, isLoading } = useVersionRequirements(repoPath, versionId, projectId, open)
  const scrollKey = useGridScrollKey('version-requirements')

  const columns = useMemo(() => (data ? buildVersionRequirementColumns({ page: data, t }) : []), [data, t])
  const prefs = useMemo(() => ({
    repoPath, prefKey: 'grid::version-requirements', view: 'columns',
    defaults: versionRequirementDefaults(data?.requirementFields ?? []),
  }), [repoPath, data?.requirementFields])
  const onActivate = useCallback((r: VersionRequirementRow) => nav?.follow(r.requirementId), [nav])

  const freeze = data?.version.freeze
  const infoText = !data ? '' : data.verification === 'live'
    ? t('versions.requirements.info.live')
    : t(data.verification === 'frozen' ? 'versions.requirements.info.frozen' : 'versions.requirements.info.missing', {
      tag: freeze?.tag ?? '', when: freeze ? new Date(freeze.at).toLocaleString(i18n.language) : '',
    })

  return (
    <section className="flex flex-col gap-2" data-testid="version-requirements-section">
      <SectionToggle open={open} onToggle={() => setOpen(o => !o)} label={t('versions.requirements.title')} count={data?.rows.length} testId="version-requirements-toggle" />
      {open && (error
        ? <p className="text-xs text-status-danger" role="alert" data-testid="version-requirements-error">{versionErrorText(t, error)}</p>
        : isLoading || !data ? <p className="text-xs text-ink-3 italic">{t('common.loading')}</p>
          : (
            <>
              <p className="text-xs text-ink-3" data-testid="version-requirements-info" data-verification={data.verification}>{infoText}</p>
              {data.rows.length === 0
                ? <p className="text-xs text-ink-3 italic" data-testid="version-requirements-empty">{t('versions.requirements.empty')}</p>
                : (
                  <div className="flex flex-col max-h-[60vh] min-h-0" data-testid="version-requirements">
                    {/* `key` : une autre version est une autre liste sur la même route — la grille est remontée (sinon la
                        restauration du défilement se calcule sur les lignes de la version quittée). */}
                    <DataGrid
                      key={versionId}
                      gridId="version-requirements"
                      title={`${t('versions.requirements.title')} ${versionLabel}`}
                      rows={data.rows}
                      getRowId={versionRequirementRowId}
                      columns={columns}
                      prefs={prefs}
                      onActivate={onActivate}
                      scrollMemoryKey={scrollKey}
                      noExport
                    />
                  </div>
                )}
            </>
          ))}
    </section>
  )
}
