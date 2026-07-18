import { useState } from 'react'
import type { ImplementsDeclaration, RoleDefinition } from '@polenta/types'
import { ConfirmDelete, tdClass, thClass } from './objectTypeEditor'

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
  const [formError, setFormError] = useState<string | null>(null)

  // Only offered when creating a component (not editing, not an interface — an interface
  // inherently needs a separate repo to declare roles/implements against, cf. T113).
  const canBeLocal = !isEdit && kind === 'component'

  // Rôles hérités hors catalogue (T110) — présents côté parent mais ne correspondant à aucune
  // entrée du catalogue en cours d'édition (legacy texte libre pré-T110, ou catalogue vidé
  // depuis) : jamais purgés silencieusement, affichés séparément avec leur propre retrait explicite.
  const legacyParentRoles = parentRoles.filter(r => !catalogRoles.some(cr => cr.name === r))
  const showPlayedRoles = catalogRoles.length > 0 || parentRoles.length > 0

  const title = isEdit
    ? (kind === 'component' ? 'Modifier le composant' : "Modifier l'interface")
    : (kind === 'component' ? 'Ajouter un composant' : 'Ajouter une interface')

  const addCatalogRole = () => setCatalogRoles([...catalogRoles, { name: '', label: '' }])
  const updateCatalogRole = (i: number, patch: Partial<RoleDefinition>) =>
    setCatalogRoles(catalogRoles.map((r, j) => j === i ? { ...r, ...patch } : r))
  const removeCatalogRole = (i: number) => setCatalogRoles(catalogRoles.filter((_, j) => j !== i))

  const toggleParentRole = (roleName: string) =>
    setParentRoles(prev => prev.includes(roleName) ? prev.filter(r => r !== roleName) : [...prev, roleName])

  const addImplements = () => setImplementsList([...implementsList, { interface: '', roles: [] }])
  const updateImplements = (i: number, patch: Partial<ImplementsDeclaration>) =>
    setImplementsList(implementsList.map((impl, j) => j === i ? { ...impl, ...patch } : impl))
  const removeImplements = (i: number) => setImplementsList(implementsList.filter((_, j) => j !== i))
  const toggleImplementsRole = (i: number, roleName: string) => {
    const current = implementsList[i].roles
    updateImplements(i, { roles: current.includes(roleName) ? current.filter(r => r !== roleName) : [...current, roleName] })
  }

  const handleSubmit = () => {
    if (isLocal) {
      if (!name.trim()) {
        setFormError('Le nom est obligatoire.')
        return
      }
    } else if (!url.trim() || !name.trim() || !branch.trim()) {
      setFormError('Repo, nom et branche sont obligatoires.')
      return
    }
    setFormError(null)
    onSubmit({
      url: url.trim(), name: name.trim(), branch: branch.trim(), catalogRoles, parentRoles, implementsList,
      label: label.trim(), description: description.trim(), isLocal,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-surface border border-edge rounded-lg shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-edge">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <p className="text-xs text-ink-3 mt-0.5">
            {isEdit ? 'Dépendance de' : 'Ajouté comme dépendance de'} {parentLabel}.
          </p>
        </div>

        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {canBeLocal && (
            <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
              <input type="checkbox" checked={isLocal} onChange={e => setIsLocal(e.target.checked)} />
              Composant local (dans ce repo) — pas de repo git séparé
            </label>
          )}
          {isEdit && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-ink-2 mb-0.5">Label affiché</label>
                <input value={label} onChange={e => setLabel(e.target.value)} className="input-field w-full text-xs py-1.5" placeholder={name} />
              </div>
              <div>
                <label className="block text-xs text-ink-2 mb-0.5">Description</label>
                <input value={description} onChange={e => setDescription(e.target.value)} className="input-field w-full text-xs py-1.5" placeholder="Description optionnelle" />
              </div>
            </div>
          )}
          {!isLocal && (
            <div>
              <label className="block text-xs text-ink-2 mb-0.5">Repo (URL git)</label>
              <input
                value={url}
                onChange={e => setUrl(e.target.value)}
                disabled={isEdit}
                className="input-field w-full font-mono text-xs py-1.5 disabled:opacity-60"
                placeholder="git@github.com:org/repo.git"
              />
            </div>
          )}
          <div className={isLocal ? '' : 'grid grid-cols-2 gap-3'}>
            <div>
              <label className="block text-xs text-ink-2 mb-0.5">Nom (montage)</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                className="input-field w-full font-mono text-xs py-1.5"
                placeholder={kind === 'component' ? 'comp-motor-control' : 'iface-can-bus'}
              />
            </div>
            {!isLocal && (
              <div>
                <label className="block text-xs text-ink-2 mb-0.5">Branche</label>
                <input
                  value={branch}
                  onChange={e => setBranch(e.target.value)}
                  className="input-field w-full font-mono text-xs py-1.5"
                  placeholder="main"
                />
              </div>
            )}
          </div>

          {/* Rôles exposés par ce repo (T110) — édition réservée au mode édition, visible pour
              tout nœud (pas seulement kind === 'interface') : un repo jamais encore marqué
              interface doit pouvoir le devenir en lui déclarant un premier rôle ici. */}
          {isEdit && (
            <div>
              <label className="block text-xs text-ink-2 mb-1">Rôles exposés par ce repo</label>
              {catalogRoles.length > 0 && (
                <table className="w-full text-xs border-collapse mb-1">
                  <thead>
                    <tr>
                      <th className={thClass}>Nom (identifiant)</th>
                      <th className={thClass}>Label affiché</th>
                      <th className={thClass}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalogRoles.map((role, i) => (
                      <tr key={i} className="hover:bg-hover">
                        <td className={tdClass}>
                          <input value={role.name} onChange={e => updateCatalogRole(i, { name: e.target.value })}
                            className="w-full px-1 py-0.5 text-xs border-0 focus:outline-none bg-transparent text-ink font-mono" placeholder="controller" />
                        </td>
                        <td className={tdClass}>
                          <input value={role.label ?? ''} onChange={e => updateCatalogRole(i, { label: e.target.value })}
                            className="w-full px-1 py-0.5 text-xs border-0 focus:outline-none bg-transparent text-ink" placeholder="Contrôleur CAN" />
                        </td>
                        <td className={tdClass}>
                          <ConfirmDelete onConfirm={() => removeCatalogRole(i)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <button type="button" onClick={addCatalogRole} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                + Ajouter un rôle
              </button>
            </div>
          )}

          {/* Rôles joués par le parent (T110) — sélection parmi le catalogue ci-dessus, plus les
              rôles hérités hors catalogue préservés et retirables explicitement. */}
          {isEdit && showPlayedRoles && (
            <div>
              <label className="block text-xs text-ink-2 mb-1">Rôles joués par {parentLabel}</label>
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
                    <span className="text-[11px] text-amber-600 dark:text-amber-400">hors catalogue</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Interfaces implémentées (T110 sprint 2) — un nœud peut à la fois exposer son propre
              catalogue (sections ci-dessus) ET implémenter d'autres interfaces qu'il monte
              lui-même, les deux notions sont indépendantes. Reprise de l'ancienne section
              "Implémentations" de l'onglet Interfaces (schema.tsx), sans le champ éditable de
              version — la version implémentée reste résolue depuis le pin du montage. */}
          {isEdit && (
            <div>
              <label className="block text-xs text-ink-2 mb-1">Interfaces implémentées</label>
              {implementsList.length > 0 && (
                <div className="space-y-2 mb-1">
                  {implementsList.map((impl, i) => {
                    const catalog = resolveInterfaceRoles?.(impl.interface) ?? null
                    const pin = resolveInterfacePin?.(impl.interface) ?? null
                    return (
                      <div key={i} className="border border-edge rounded p-2 bg-surface">
                        <div className="grid grid-cols-2 gap-2 mb-1.5">
                          <div>
                            <label className="block text-xs text-ink-2 mb-0.5">Interface (nom de montage)</label>
                            <input value={impl.interface} onChange={e => updateImplements(i, { interface: e.target.value })}
                              className="input-field w-full font-mono text-xs py-1" placeholder="iface-can-bus" />
                          </div>
                          <div>
                            <label className="block text-xs text-ink-2 mb-0.5">Version implémentée</label>
                            <code className="block text-xs text-ink-2 font-mono py-1">
                              {pin ?? <span className="text-ink-3 italic font-sans">non résolu</span>}
                            </code>
                          </div>
                        </div>
                        <label className="block text-xs text-ink-2 mb-0.5">Rôles joués</label>
                        {catalog && catalog.length > 0 ? (
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {catalog.map(role => (
                              <label key={role.name} className="flex items-center gap-1.5 text-xs text-ink-2 cursor-pointer">
                                <input type="checkbox" checked={impl.roles.includes(role.name)} onChange={() => toggleImplementsRole(i, role.name)} />
                                <span className="font-mono">{role.name}</span>
                              </label>
                            ))}
                          </div>
                        ) : (
                          <input value={impl.roles.join(', ')}
                            onChange={e => updateImplements(i, { roles: e.target.value.split(',').map(r => r.trim()).filter(Boolean) })}
                            className="input-field w-full text-xs py-1" placeholder="device, controller" />
                        )}
                        <div className="flex justify-end mt-1">
                          <ConfirmDelete onConfirm={() => removeImplements(i)} className="text-xs text-red-400 hover:text-red-600" />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              <button type="button" onClick={addImplements} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                + Déclarer une implémentation
              </button>
            </div>
          )}

          {(formError || error) && <p className="text-xs text-red-500">{formError ?? error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-edge">
          <button type="button" onClick={onClose} disabled={isSaving} className="text-sm px-4 py-1.5 border border-edge rounded text-ink-2 hover:text-ink transition-colors disabled:opacity-50">
            Annuler
          </button>
          <button type="button" onClick={handleSubmit} disabled={isSaving} className="btn-primary px-4 py-1.5 disabled:opacity-50">
            {isSaving ? (isEdit ? 'Enregistrement…' : 'Ajout…') : (isEdit ? 'Enregistrer' : 'Ajouter')}
          </button>
        </div>
      </div>
    </div>
  )
}
