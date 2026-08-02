import { useTranslation } from 'react-i18next'
import type { ImplementsDeclaration, RoleDefinition } from '@polenta/types'
import { ConfirmDelete, tdClass, thClass } from './objectTypeEditor'

/**
 * T123 — Extrait de AddDependencyModal.tsx (T110), en deux composants indépendants réutilisables
 * pour N'IMPORTE QUEL composant (root ou local, imbriqué ou non, cf. specs/T123.md) :
 * `RolesExposedFields` (le catalogue de rôles que ce composant expose) et
 * `ImplementedInterfacesFields` (les interfaces que ce composant implémente lui-même).
 *
 * Volontairement SANS la section "Rôles joués par le parent" d'AddDependencyModal — celle-ci est
 * spécifique à la relation de montage d'une dépendance en repo séparé (le PARENT déclare quels
 * rôles il joue POUR ce montage, cf. specs/T123-design.md §Rejected alternatives) : elle n'a pas
 * d'équivalent pour un composant local imbriqué, qui n'est jamais "monté" par son parent au sens
 * polenta-repo.yaml. Reste propre à AddDependencyModal.tsx, non extraite.
 */
export function RolesExposedFields({
  catalogRoles, onCatalogRolesChange,
}: {
  catalogRoles: RoleDefinition[]
  onCatalogRolesChange: (roles: RoleDefinition[]) => void
}) {
  const { t } = useTranslation()

  const addCatalogRole = () => onCatalogRolesChange([...catalogRoles, { name: '', label: '' }])
  const updateCatalogRole = (i: number, patch: Partial<RoleDefinition>) =>
    onCatalogRolesChange(catalogRoles.map((r, j) => j === i ? { ...r, ...patch } : r))
  const removeCatalogRole = (i: number) => onCatalogRolesChange(catalogRoles.filter((_, j) => j !== i))

  return (
    <div>
      <label className="block text-xs text-ink-2 mb-1">{t('schema.addDependency.rolesExposedLabel')}</label>
      {catalogRoles.length > 0 && (
        <table className="w-full text-xs border-collapse mb-1">
          <thead>
            <tr>
              <th className={thClass}>{t('schema.addDependency.colRoleName')}</th>
              <th className={thClass}>{t('schema.addDependency.displayLabel')}</th>
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
      <button type="button" onClick={addCatalogRole} className="text-xs text-status-info hover:underline">
        {t('schema.addDependency.addRole')}
      </button>
    </div>
  )
}

export function ImplementedInterfacesFields({
  implementsList, onImplementsListChange, resolveInterfaceRoles, resolveInterfacePin,
}: {
  implementsList: ImplementsDeclaration[]
  onImplementsListChange: (list: ImplementsDeclaration[]) => void
  /** Résout le nom de montage d'une interface vers son catalogue de rôles. `null` si non
   *  résolvable (fallback texte libre). */
  resolveInterfaceRoles?: (mountName: string) => RoleDefinition[] | null
  /** Résout le nom de montage vers son pin affiché ("Version implémentée"). `null` si non
   *  résolvable. */
  resolveInterfacePin?: (mountName: string) => string | null
}) {
  const { t } = useTranslation()

  const addImplements = () => onImplementsListChange([...implementsList, { interface: '', roles: [] }])
  const updateImplements = (i: number, patch: Partial<ImplementsDeclaration>) =>
    onImplementsListChange(implementsList.map((impl, j) => j === i ? { ...impl, ...patch } : impl))
  const removeImplements = (i: number) => onImplementsListChange(implementsList.filter((_, j) => j !== i))
  const toggleImplementsRole = (i: number, roleName: string) => {
    const current = implementsList[i].roles
    updateImplements(i, { roles: current.includes(roleName) ? current.filter(r => r !== roleName) : [...current, roleName] })
  }

  return (
    <div>
      <label className="block text-xs text-ink-2 mb-1">{t('schema.addDependency.implementedInterfacesLabel')}</label>
      {implementsList.length > 0 && (
        <div className="space-y-2 mb-1">
          {implementsList.map((impl, i) => {
            const catalog = resolveInterfaceRoles?.(impl.interface) ?? null
            const pin = resolveInterfacePin?.(impl.interface) ?? null
            return (
              <div key={i} className="border border-edge rounded p-2 bg-surface">
                <div className="grid grid-cols-2 gap-2 mb-1.5">
                  <div>
                    <label className="block text-xs text-ink-2 mb-0.5">{t('schema.addDependency.interfaceMountNameLabel')}</label>
                    <input value={impl.interface} onChange={e => updateImplements(i, { interface: e.target.value })}
                      className="input-field w-full font-mono text-xs py-1" placeholder="iface-can-bus" />
                  </div>
                  <div>
                    <label className="block text-xs text-ink-2 mb-0.5">{t('schema.addDependency.implementedVersionLabel')}</label>
                    <code className="block text-xs text-ink-2 font-mono py-1">
                      {pin ?? <span className="text-ink-3 italic font-sans">{t('schema.addDependency.unresolved')}</span>}
                    </code>
                  </div>
                </div>
                <label className="block text-xs text-ink-2 mb-0.5">{t('schema.addDependency.rolesPlayedLabel')}</label>
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
                  <ConfirmDelete onConfirm={() => removeImplements(i)} className="text-xs text-status-danger hover:opacity-80" />
                </div>
              </div>
            )
          })}
        </div>
      )}
      <button type="button" onClick={addImplements} className="text-xs text-status-info hover:underline">
        {t('schema.addDependency.addImplementation')}
      </button>
    </div>
  )
}
