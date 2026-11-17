export interface ChecklistGroup {
  /** Titre du groupe ; absent : liste sans titre. */
  label?: string
  columns: { key: string; label: string }[]
}

/**
 * GH389 — liste à cocher des colonnes d'une grille, par groupes : colonnes verrouillées (toujours
 * affichées) cochées et grisées, avec leur infobulle. Même rendu que les listes du panneau ⚙️ de la
 * Vue Excel (`FieldConfigModal`).
 */
export function ColumnChecklist({ groups, isChecked, locked, onToggle, testIdPrefix }: {
  groups: ChecklistGroup[]
  isChecked: (key: string) => boolean
  /** Colonne verrouillée → infobulle. */
  locked: Readonly<Record<string, string>>
  onToggle: (key: string) => void
  testIdPrefix: string
}) {
  return (
    <div className="overflow-y-auto max-h-80 space-y-1.5">
      {groups.map((group, i) => (
        <div key={group.label ?? i} className={i > 0 ? 'pt-2 mt-1 border-t border-edge space-y-1.5' : 'space-y-1.5'} data-testid={`${testIdPrefix}-group-${i}`}>
          {group.label && <p className="text-xs text-ink-3 font-medium mb-1">{group.label}</p>}
          {group.columns.map(c => {
            const isLocked = c.key in locked
            return (
              <label
                key={c.key}
                title={locked[c.key]}
                className={`flex items-center gap-2 text-xs text-ink ${isLocked ? 'cursor-default' : 'cursor-pointer'} hover:bg-hover px-1 py-0.5 rounded`}
              >
                <input
                  type="checkbox"
                  checked={isLocked || isChecked(c.key)}
                  disabled={isLocked}
                  onChange={() => onToggle(c.key)}
                  className="h-3 w-3 accent-ink"
                  data-testid={`${testIdPrefix}-${c.key}`}
                />
                <span>{c.label}</span>
              </label>
            )
          })}
        </div>
      ))}
    </div>
  )
}
