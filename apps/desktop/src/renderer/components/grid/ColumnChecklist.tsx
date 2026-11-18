import type { ReactNode } from 'react'

export interface ChecklistGroup {
  /** Titre du groupe ; absent : liste sans titre. */
  label?: string
  columns: { key: string; label: string }[]
}

/**
 * GH389 — case d'une colonne dans un panneau de colonnes (👁 des grilles, ⚙️ de la Vue Excel) :
 * colonne verrouillée (toujours affichée) cochée et grisée, avec son infobulle (`lockedHint`).
 */
export function ColumnCheckItem({ label, checked, onToggle, lockedHint, title, suffix, indent = false, testId }: {
  label: ReactNode
  checked: boolean
  onToggle: () => void
  /** Colonne verrouillée : infobulle, case désactivée et cochée. */
  lockedHint?: string
  /** Infobulle d'une colonne non verrouillée (ex. colonne calculée). */
  title?: string
  /** Après le libellé : « (sys) », « (calc) », ⚠… */
  suffix?: ReactNode
  /** Sous-colonne d'un groupe (colonne éclatée GH126). */
  indent?: boolean
  testId?: string
}) {
  const isLocked = lockedHint !== undefined
  return (
    <label
      title={lockedHint ?? title}
      className={`flex items-center gap-2 text-xs text-ink ${isLocked ? 'cursor-default' : 'cursor-pointer'} hover:bg-hover ${indent ? 'pl-6 pr-1' : 'px-1'} py-0.5 rounded`}
    >
      <input
        type="checkbox"
        checked={isLocked || checked}
        disabled={isLocked}
        onChange={onToggle}
        className="h-3 w-3 accent-ink"
        data-testid={testId}
      />
      <span>{label}</span>
      {suffix}
    </label>
  )
}

/**
 * GH389 — liste à cocher des colonnes d'une grille, par groupes : colonnes verrouillées (toujours
 * affichées) cochées et grisées, avec leur infobulle. Mêmes cases que le panneau ⚙️ de la Vue Excel
 * (`FieldConfigModal`, `ColumnCheckItem`).
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
          {group.columns.map(c => (
            <ColumnCheckItem
              key={c.key}
              label={c.label}
              checked={isChecked(c.key)}
              lockedHint={locked[c.key]}
              onToggle={() => onToggle(c.key)}
              testId={`${testIdPrefix}-${c.key}`}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
