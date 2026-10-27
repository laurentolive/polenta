import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { ObjectTypeDefinition, LinkTypeDefinition } from '@polenta/types'
import type { ComputedColumn, ComputedColumnPanelEntry } from '../../hooks/useComputedColumns'
import { getRelevantLinkTypes, getLinkTypeLabel, isLinkTypeValid } from './linkUtils'

// ── FieldConfig modal (⚙) — onglets Tableau / Document indépendants ─────────

export type ConfigTab = 'excel' | 'word'

/** Panneau ⚙️ « Champs visibles » de la Vue Système, réutilisé par le sélecteur de tests d'une
 *  campagne (GH176 : un seul onglet, Statut verrouillé, Réinitialiser propre, au-dessus de la modale). */

export function FieldConfigModal({
  typeDef,
  objectTypeRef,
  linkTypes,
  activeTab,
  visibleFieldsExcel,
  visibleFieldsWord,
  onChangeExcel,
  onChangeWord,
  showFoldersExcel,
  showFoldersWord,
  onChangeShowFoldersExcel,
  onChangeShowFoldersWord,
  onClose,
  computedColumns,
  computedPanel,
  tabs = ['excel', 'word'],
  lockedFields = {},
  onReset,
  layer = 'page',
}: {
  typeDef: ObjectTypeDefinition | undefined
  objectTypeRef?: string
  linkTypes: LinkTypeDefinition[]
  activeTab: ConfigTab
  visibleFieldsExcel: string[]
  visibleFieldsWord?: string[]
  onChangeExcel: (fields: string[]) => void
  onChangeWord?: (fields: string[]) => void
  showFoldersExcel: boolean
  showFoldersWord?: boolean
  onChangeShowFoldersExcel: (v: boolean) => void
  onChangeShowFoldersWord?: (v: boolean) => void
  onClose: () => void
  /** GH70 — colonnes calculées applicables au type (requêtes partagées du projet), à plat. */
  computedColumns: ComputedColumn[]
  /** GH126 — mêmes colonnes en entrées du panneau (colonnes simples, groupes de colonnes éclatées). */
  computedPanel: ComputedColumnPanelEntry[]
  /** GH176 — onglets proposés ; un seul ⇒ pas de barre d'onglets. */
  tabs?: ConfigTab[]
  /** GH176 — champs toujours affichés : case cochée et désactivée, avec cette infobulle. */
  lockedFields?: Record<string, string>
  /** GH176 — remplace l'action par défaut de « Réinitialiser ». */
  onReset?: () => void
  /** GH176 — `modal` : rendu au-dessus d'une modale (portail), `Échap` ferme le panneau seul. */
  layer?: 'page' | 'modal'
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<ConfigTab>(activeTab)

  const systemFieldLabels: Record<string, string> = {
    section: t('system.fieldConfig.colSection'), name: t('schema.editor.colLabel'), id: t('system.wordView.colId'), status: t('system.wordView.colStatus'), version: t('system.wordView.colVersion'),
    createdAt: t('system.fieldConfig.colCreatedAt'), updatedAt: t('system.fieldConfig.colUpdatedAt'), author: t('system.fieldConfig.colAuthor'),
    steps: t('system.wordView.stepsHeading'), coverageStatus: t('system.fieldConfig.colCoverage'),
  }

  const systemFields = ['section', 'name', 'id', 'status', 'version', 'createdAt', 'author', 'coverageStatus']
  const customFields = (typeDef?.fields ?? []).map(f => f.name)
  const category = typeDef?.category
  const relevantLinkTypes = getRelevantLinkTypes(linkTypes, objectTypeRef, category).map(r => r.lt)
  // section / name / id / status / version sont toujours affichés dans l'en-tête de la carte en vue
  // Document (cf. WordView.ItemCard) — les proposer à cocher là n'aurait aucun effet visible
  const fieldsAlwaysInWordHeader = new Set(['section', 'name', 'id', 'status', 'version'])
  // coverageStatus (T138) n'a de sens que pour les exigences — un TestCase n'a pas de statut de
  // couverture, ne pas le proposer à cocher pour ce type d'objet.
  const allFields = [...new Set([...systemFields, ...customFields])]
    .filter(f => tab !== 'word' || !fieldsAlwaysInWordHeader.has(f))
    .filter(f => f !== 'coverageStatus' || category === 'requirement')
  const hasSteps = category === 'test'

  const currentFields = tab === 'excel' ? visibleFieldsExcel : (visibleFieldsWord ?? [])
  const onChangeCurrent = tab === 'excel' ? onChangeExcel : (onChangeWord ?? (() => {}))
  const showFolders = tab === 'excel' ? showFoldersExcel : (showFoldersWord ?? true)
  const onChangeShowFolders = tab === 'excel' ? onChangeShowFoldersExcel : (onChangeShowFoldersWord ?? (() => {}))
  const isChecked = (f: string) => f in lockedFields || currentFields.includes(f)

  // Ordre canonique = celui de la liste affichée dans ce panneau (champs système, puis custom,
  // puis étapes, puis liens). Recocher un champ le remet à sa place plutôt qu'en fin de liste.
  const canonicalOrder = [
    ...allFields,
    ...computedColumns.map(c => c.key),
    ...(hasSteps ? ['steps'] : []),
    ...relevantLinkTypes.map(lt => `link::${lt.name}`),
  ]

  const toggle = (f: string) => {
    if (f in lockedFields) return
    const next = currentFields.includes(f)
      ? currentFields.filter(x => x !== f)
      : [...currentFields, f]
    const ordered = canonicalOrder.filter(x => next.includes(x))
    const extra = next.filter(x => !canonicalOrder.includes(x))
    onChangeCurrent([...ordered, ...extra])
  }

  const defaultFields = ['section', 'name', 'id', 'status', ...(typeDef?.fields.slice(0, 3).map(f => f.name) ?? [])]

  const tabLabels: Record<ConfigTab, string> = {
    excel: t('system.fieldConfig.tabExcel'),
    word: t('system.fieldConfig.tabWord'),
  }

  // GH176 — au-dessus d'une modale, `Échap` ferme le panneau sans atteindre la modale (dont les
  // raccourcis écoutent `window` en phase bulle).
  useEffect(() => {
    if (layer !== 'modal') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [layer, onClose])

  const panel = (
    <div
      className={`fixed inset-0 ${layer === 'modal' ? 'z-[60]' : 'z-50'} flex items-start justify-end pt-12 pr-4`}
      onClick={onClose}
      data-testid="field-config-panel"
    >
      <div
        className="bg-surface border border-edge rounded-lg shadow-xl p-4 w-72"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-ink">{t('system.fieldConfig.visibleFields')}</p>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-3 hover:text-ink text-xs"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        {tabs.length > 1 && <div className="flex border border-edge rounded overflow-hidden mb-3 text-xs">
          {tabs.map(configTab => (
            <button
              key={configTab}
              type="button"
              onClick={() => setTab(configTab)}
              className={[
                'flex-1 py-1 transition-colors',
                tab === configTab
                  ? 'bg-ink text-prim-fg font-medium'
                  : 'text-ink-3 hover:text-ink hover:bg-hover',
              ].join(' ')}
            >
              {tabLabels[configTab]}
            </button>
          ))}
        </div>}

        {/* T162 — afficher / masquer les titres de dossiers (par vue) */}
        <label className="flex items-center gap-2 text-xs text-ink cursor-pointer hover:bg-hover px-1 py-0.5 rounded mb-2 pb-2 border-b border-edge">
          <input
            type="checkbox"
            checked={showFolders}
            data-testid="field-config-show-folders"
            onChange={e => onChangeShowFolders(e.target.checked)}
            className="h-3 w-3 accent-ink"
          />
          <span>{t('system.fieldConfig.showFolders')}</span>
        </label>

        {/* Scrollable field list */}
        <div className="overflow-y-auto max-h-80 space-y-1.5">
          {allFields.map(f => (
            <label
              key={f}
              title={lockedFields[f]}
              className={`flex items-center gap-2 text-xs text-ink ${f in lockedFields ? 'cursor-default' : 'cursor-pointer'} hover:bg-hover px-1 py-0.5 rounded`}
            >
              <input
                type="checkbox"
                checked={isChecked(f)}
                disabled={f in lockedFields}
                onChange={() => toggle(f)}
                className="h-3 w-3 accent-ink"
                data-testid={`field-config-field-${f}`}
              />
              <span>{systemFieldLabels[f] ?? typeDef?.fields.find(cf => cf.name === f)?.label ?? f}</span>
              {systemFields.includes(f) && (
                <span className="text-ink-3">(sys)</span>
              )}
            </label>
          ))}

          {/* GH70 — colonnes calculées définies par le projet (requêtes partagées) */}
          {computedPanel.length > 0 && (
            <div className="pt-2 mt-1 border-t border-edge" data-testid="field-config-computed">
              <p className="text-xs text-ink-3 font-medium mb-1">{t('system.fieldConfig.computedColumns')}</p>
              <div className="space-y-1.5">
                {computedPanel.map(entry => entry.kind === 'column' ? (
                  <label
                    key={entry.column.key}
                    title={entry.column.headerTitle}
                    className="flex items-center gap-2 text-xs text-ink cursor-pointer hover:bg-hover px-1 py-0.5 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked(entry.column.key)}
                      onChange={() => toggle(entry.column.key)}
                      className="h-3 w-3 accent-ink"
                    />
                    <span>{entry.column.label}</span>
                    <span className="text-ink-3">(calc)</span>
                  </label>
                ) : (
                  // GH126 — colonne éclatée : titre du groupe, puis une case par sous-colonne.
                  <div key={entry.queryId} data-testid="field-config-computed-group" data-query-id={entry.queryId}>
                    <p className="flex items-center gap-2 text-xs text-ink px-1 py-0.5" title={`${entry.queryId} — ${entry.queryTitle}`}>
                      <span>{entry.label}</span>
                      <span className="text-ink-3">(calc)</span>
                      {entry.error && (
                        <span className="text-status-warning cursor-help" title={entry.error} data-testid="field-config-computed-group-error">⚠</span>
                      )}
                    </p>
                    {entry.pending && (
                      <p className="pl-6 text-xs text-ink-3 italic">{t('system.fieldConfig.computedGroupPending')}</p>
                    )}
                    {!entry.pending && !entry.error && entry.columns.length === 0 && (
                      <p className="pl-6 text-xs text-ink-3 italic">{t('system.fieldConfig.computedGroupEmpty')}</p>
                    )}
                    <div className="space-y-1.5 mt-1">
                      {entry.columns.map(c => (
                        <label
                          key={c.key}
                          title={`${entry.queryId} — ${entry.queryTitle} · ${c.split?.value ?? ''}`}
                          className="flex items-center gap-2 text-xs text-ink cursor-pointer hover:bg-hover pl-6 pr-1 py-0.5 rounded"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked(c.key)}
                            onChange={() => toggle(c.key)}
                            className="h-3 w-3 accent-ink"
                          />
                          <span>{c.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Steps column (test types only) */}
          {hasSteps && (
            <div className="pt-2 mt-1 border-t border-edge">
              <p className="text-xs text-ink-3 font-medium mb-1">{t('system.fieldConfig.testCase')}</p>
              <label className="flex items-center gap-2 text-xs text-ink cursor-pointer hover:bg-hover px-1 py-0.5 rounded">
                <input
                  type="checkbox"
                  checked={isChecked('steps')}
                  onChange={() => toggle('steps')}
                  className="h-3 w-3 accent-ink"
                />
                <span>{t('system.wordView.stepsHeading')}</span>
              </label>
            </div>
          )}

          {/* Link type columns */}
          <div className="pt-2 mt-1 border-t border-edge">
            <p className="text-xs text-ink-3 font-medium mb-1">{t('system.fieldConfig.links')}</p>
            {relevantLinkTypes.length === 0 ? (
              <p className="text-xs text-ink-3 italic">{t('system.fieldConfig.noLinkTypeForType')}</p>
            ) : (
              <div className="space-y-1.5">
                {relevantLinkTypes.map(lt => {
                  const key = `link::${lt.name}`
                  const displayLabel = getLinkTypeLabel(lt, objectTypeRef, category)
                  return (
                    <label
                      key={key}
                      className="flex items-center gap-2 text-xs text-ink cursor-pointer hover:bg-hover px-1 py-0.5 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked(key)}
                        data-testid={`field-config-field-${key}`}
                        onChange={() => toggle(key)}
                        className="h-3 w-3 accent-ink"
                      />
                      <span>{displayLabel || lt.name}</span>
                      {!isLinkTypeValid(lt) && (
                        <span className="text-status-warning" title={t('system.fieldConfig.missingRefs')}>⚠</span>
                      )}
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        </div>



        {/* Reset */}
        <button
          type="button"
          onClick={onReset ?? (() => { onChangeCurrent(defaultFields); onChangeShowFolders(true) })}
          data-testid="field-config-reset"
          className="mt-3 text-xs text-ink-3 hover:text-ink underline"
        >
          {t('system.fieldConfig.reset')}
        </button>
      </div>
    </div>
  )

  return layer === 'modal' ? createPortal(panel, document.body) : panel
}
