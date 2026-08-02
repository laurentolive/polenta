import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ImplementsDeclaration, RoleDefinition } from '@polenta/types'
import { RolesExposedFields, ImplementedInterfacesFields } from './RolesImplementsFields'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'

export interface AddDependencyValues {
  url: string
  name: string
  branch: string
  /** Edit mode only (T110) — catalogue de rôles exposés par ce repo. Non vide = le marque
   *  comme interface (recalculé au prochain rechargement de l'arbre via node.isInterface). */
  catalogRoles: RoleDefinition[]
  /** Edit mode only (T110) — rôles joués par le parent parmi catalogRoles, plus les rôles
   *  hérités hors catalogue (saisis en texte libre avant T110) préservés tels quels. */
  parentRoles: string[]
  /** Edit mode only (T110 sprint 2) — interfaces que ce nœud implémente lui-même (il peut à la
   *  fois exposer son propre catalogue ET implémenter d'autres interfaces qu'il monte). */
  implementsList: ImplementsDeclaration[]
  /** Edit mode only (T74) — the component/interface's own displayed label & description,
   *  merged into this modal instead of a separate "rename repo" dialog. Ignored when adding. */
  label: string
  description: string
  /** T113 — "Composant local" checkbox (add mode, kind === 'component' only): the component
   *  lives as a plain SystemNode in the current repo's own schema.yaml instead of a separate
   *  git repo. `url`/`branch` are meaningless in that case and left blank. */
  isLocal: boolean
  /** Which default ObjectTypeDefinition categories to seed the new component with (checked
   *  by default) — applies whether it's added as a local component or a remote git dependency.
   *  Only meaningful when adding a component (kind === 'component', add mode); ignored (and not
   *  rendered) otherwise. */
  includeRequirements: boolean
  includeTests: boolean
  includeCampaigns: boolean
}

interface Props {
  kind: 'component' | 'interface'
  parentLabel: string
  isSaving: boolean
  error: string | null
  onSubmit: (values: AddDependencyValues) => void
  onClose: () => void
  /**
   * Present → edit mode: fields pre-filled, url read-only (changing the URL is out of scope —
   * that's a new dependency, not an edit). Name (mount) is editable — renaming a dependency
   * cascades to every implements[].interface referencing it (T74 sprint 2).
   */
  initialValues?: AddDependencyValues
  /** T110 sprint 2 — résout le nom de montage d'une interface (ligne "Interfaces implémentées")
   *  vers son catalogue de rôles. `null` si non montée localement (fallback texte libre), liste
   *  vide si montée mais sans catalogue (fallback texte libre aussi — rien à cocher). */
  resolveInterfaceRoles?: (mountName: string) => RoleDefinition[] | null
  /** T110 sprint 2 — résout le nom de montage vers son pin affiché ("Version implémentée"),
   *  même troncature que l'arbre Structure. `null` si non résolvable. */
  resolveInterfacePin?: (mountName: string) => string | null
}

export function AddDependencyModal({
  kind, parentLabel, isSaving, error, onSubmit, onClose, initialValues, resolveInterfaceRoles, resolveInterfacePin,
}: Props) {
  const { t } = useTranslation()
  const isEdit = !!initialValues
  const [url, setUrl] = useState(initialValues?.url ?? '')
  const [name, setName] = useState(initialValues?.name ?? '')
  const [branch, setBranch] = useState(initialValues?.branch ?? 'main')
  const [catalogRoles, setCatalogRoles] = useState<RoleDefinition[]>(initialValues?.catalogRoles ?? [])
  const [parentRoles, setParentRoles] = useState<string[]>(initialValues?.parentRoles ?? [])
  const [implementsList, setImplementsList] = useState<ImplementsDeclaration[]>(initialValues?.implementsList ?? [])
  const [label, setLabel] = useState(initialValues?.label ?? '')
  const [description, setDescription] = useState(initialValues?.description ?? '')
  const [isLocal, setIsLocal] = useState(false)
  const [includeRequirements, setIncludeRequirements] = useState(initialValues?.includeRequirements ?? true)
  const [includeTests, setIncludeTests] = useState(initialValues?.includeTests ?? true)
  const [includeCampaigns, setIncludeCampaigns] = useState(initialValues?.includeCampaigns ?? true)
  const [formError, setFormError] = useState<string | null>(null)

  // Only offered when creating a component (not editing — an interface inherently needs a
  // separate repo to declare roles/implements against, cf. T113). Same modal, same checkbox,
  // whether triggered from a repo row or from a local component's row (T123 follow-up) — the
  // caller only ever varies which node the result nests under (parentName/localParent), never
  // whether the choice itself is offered.
  const canBeLocal = !isEdit && kind === 'component'

  // Rôles hérités hors catalogue (T110) — présents côté parent mais ne correspondant à aucune
  // entrée du catalogue en cours d'édition (legacy texte libre pré-T110, ou catalogue vidé
  // depuis) : jamais purgés silencieusement, affichés séparément avec leur propre retrait explicite.
  const legacyParentRoles = parentRoles.filter(r => !catalogRoles.some(cr => cr.name === r))
  const showPlayedRoles = catalogRoles.length > 0 || parentRoles.length > 0

  const title = isEdit
    ? (kind === 'component' ? t('schema.addDependency.editComponentTitle') : t('schema.addDependency.editInterfaceTitle'))
    : (kind === 'component' ? t('schema.addDependency.addComponentTitle') : t('schema.addDependency.addInterfaceTitle'))

  const toggleParentRole = (roleName: string) =>
    setParentRoles(prev => prev.includes(roleName) ? prev.filter(r => r !== roleName) : [...prev, roleName])

  const handleSubmit = () => {
    if (isLocal) {
      if (!name.trim()) {
        setFormError(t('schema.addDependency.nameRequired'))
        return
      }
    } else if (!url.trim() || !name.trim() || !branch.trim()) {
      setFormError(t('schema.addDependency.fieldsRequired'))
      return
    }
    setFormError(null)
    onSubmit({
      url: url.trim(), name: name.trim(), branch: branch.trim(), catalogRoles, parentRoles, implementsList,
      label: label.trim(), description: description.trim(), isLocal,
      includeRequirements, includeTests, includeCampaigns,
    })
  }

  useModalHotkeys(onClose, handleSubmit, isSaving)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={onClose}>
      <div className="bg-surface border border-edge rounded-lg shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-edge">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <p className="text-xs text-ink-3 mt-0.5">
            {isEdit ? t('schema.addDependency.dependencyOf') : t('schema.addDependency.addedAsDependencyOf')} {parentLabel}.
          </p>
        </div>

        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-xs text-ink-2 mb-0.5">{t('schema.addDependency.mountName')}</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="input-field w-full font-mono text-xs py-1.5"
              placeholder={kind === 'component' ? 'comp-motor-control' : 'iface-can-bus'}
            />
          </div>
          {canBeLocal && (
            <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
              <input type="checkbox" checked={isLocal} onChange={e => setIsLocal(e.target.checked)} />
              {t('schema.addDependency.localComponentLabel')}
            </label>
          )}
          {isEdit && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-ink-2 mb-0.5">{t('schema.addDependency.displayLabel')}</label>
                <input value={label} onChange={e => setLabel(e.target.value)} className="input-field w-full text-xs py-1.5" placeholder={name} />
              </div>
              <div>
                <label className="block text-xs text-ink-2 mb-0.5">{t('schema.addDependency.description')}</label>
                <input value={description} onChange={e => setDescription(e.target.value)} className="input-field w-full text-xs py-1.5" placeholder={t('schema.addDependency.descriptionPlaceholder')} />
              </div>
            </div>
          )}
          {!isLocal && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-ink-2 mb-0.5">{t('schema.addDependency.repoUrl')}</label>
                <input
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  disabled={isEdit}
                  className="input-field w-full font-mono text-xs py-1.5 disabled:opacity-60"
                  placeholder="git@github.com:org/repo.git"
                />
              </div>
              <div>
                <label className="block text-xs text-ink-2 mb-0.5">{t('schema.addDependency.branch')}</label>
                <input
                  value={branch}
                  onChange={e => setBranch(e.target.value)}
                  className="input-field w-full font-mono text-xs py-1.5"
                  placeholder="main"
                />
              </div>
            </div>
          )}
          {canBeLocal && (
            <div>
              <p className="text-xs text-ink-2 mb-1">{t('schema.addDependency.defaultObjectTypesLabel')}</p>
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
                  <input type="checkbox" checked={includeRequirements} onChange={e => setIncludeRequirements(e.target.checked)} />
                  {t('schema.addDependency.includeRequirementsLabel')}
                </label>
                <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
                  <input type="checkbox" checked={includeTests} onChange={e => setIncludeTests(e.target.checked)} />
                  {t('schema.addDependency.includeTestsLabel')}
                </label>
                <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
                  <input type="checkbox" checked={includeCampaigns} onChange={e => setIncludeCampaigns(e.target.checked)} />
                  {t('schema.addDependency.includeCampaignsLabel')}
                </label>
              </div>
            </div>
          )}
          {/* Rôles exposés (T110, extrait en composant partagé T123) — édition réservée au mode
              édition, visible pour tout nœud (pas seulement kind === 'interface') : un repo
              jamais encore marqué interface doit pouvoir le devenir en lui déclarant un premier
              rôle ici. */}
          {isEdit && (
            <RolesExposedFields catalogRoles={catalogRoles} onCatalogRolesChange={setCatalogRoles} />
          )}

          {/* Rôles joués par le parent (T110) — sélection parmi le catalogue ci-dessus, plus les
              rôles hérités hors catalogue préservés et retirables explicitement. */}
          {isEdit && showPlayedRoles && (
            <div>
              <label className="block text-xs text-ink-2 mb-1">{t('schema.addDependency.rolesPlayedByLabel', { parentLabel })}</label>
              <div className="space-y-1">
                {catalogRoles.filter(r => r.name.trim()).map((role, i) => (
                  <label key={i} className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
                    <input type="checkbox" checked={parentRoles.includes(role.name)} onChange={() => toggleParentRole(role.name)} />
                    <span className="font-mono">{role.name}</span>
                    {role.label && <span className="text-ink-3">— {role.label}</span>}
                  </label>
                ))}
                {legacyParentRoles.map(roleName => (
                  <label key={roleName} className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
                    <input type="checkbox" checked onChange={() => toggleParentRole(roleName)} />
                    <span className="font-mono">{roleName}</span>
                    <span className="text-[11px] text-status-warning">{t('schema.addDependency.outOfCatalog')}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Interfaces implémentées (T110 sprint 2, extrait en composant partagé T123) — un
              nœud peut à la fois exposer son propre catalogue (section ci-dessus) ET implémenter
              d'autres interfaces qu'il monte lui-même, les deux notions sont indépendantes. */}
          {isEdit && (
            <ImplementedInterfacesFields
              implementsList={implementsList}
              onImplementsListChange={setImplementsList}
              resolveInterfaceRoles={resolveInterfaceRoles}
              resolveInterfacePin={resolveInterfacePin}
            />
          )}

          {(formError || error) && <p className="text-xs text-status-danger">{formError ?? error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-edge">
          <button type="button" onClick={onClose} disabled={isSaving} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <button type="button" onClick={handleSubmit} disabled={isSaving} className="btn-primary">
            {isSaving ? (isEdit ? t('schema.addDependency.saving') : t('schema.addDependency.adding')) : (isEdit ? t('common.save') : t('schema.addDependency.add'))}
          </button>
        </div>
      </div>
    </div>
  )
}
