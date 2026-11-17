import { useMemo, useRef } from 'react'
import { checkboxClick, checkboxRowClick, selectRow } from './rowSelection'

export type RowSelectionMode = 'rows' | 'checkbox'

/**
 * GH389 — gestes de sélection d'une grille, stables (lisent l'état courant par une ref) : clic,
 * Maj / Ctrl+clic, Maj+↑↓ (`extendTo`), ↑↓ (`only`), cases (`checkbox`). `displayed` : lignes
 * affichées, dans l'ordre.
 */
export function useRowSelection(
  mode: RowSelectionMode, selected: ReadonlySet<string>, onChange: (next: Set<string>) => void, displayed: readonly string[],
) {
  const anchor = useRef<string | null>(null)
  const latest = useRef({ mode, selected, onChange, displayed })
  latest.current = { mode, selected, onChange, displayed }

  return useMemo(() => ({
    click(target: string, mods: { shift?: boolean; ctrl?: boolean }) {
      const { mode: m, selected: sel, onChange: change, displayed: shown } = latest.current
      if (m === 'checkbox') {
        const r = checkboxRowClick({ selected: sel, displayed: shown, anchor: anchor.current, target, shift: !!mods.shift })
        anchor.current = r.anchor
        change(r.selected)
        return
      }
      // Ancre hors de la sélection (sélection posée ailleurs : arbre, lien suivi, Ctrl+clic qui l'a
      // retirée) : Maj part de la dernière ligne sélectionnée, comme la Vue Excel avant GH389.
      if (mods.shift && sel.size > 0 && (anchor.current === null || !sel.has(anchor.current))) anchor.current = [...sel][sel.size - 1]
      const r = selectRow({ selected: sel, displayed: shown, anchor: anchor.current, target, shift: mods.shift, ctrl: mods.ctrl })
      anchor.current = r.anchor
      if (r.selected) change(r.selected)
    },
    checkbox(target: string, shift: boolean) {
      const { selected: sel, onChange: change, displayed: shown } = latest.current
      const r = checkboxClick({ selected: sel, displayed: shown, anchor: anchor.current, target, shift })
      anchor.current = r.anchor
      change(r.selected)
    },
    /** Maj+↑↓ : plage de l'ancre à `target` (mode lignes). */
    extendTo(target: string) {
      const { mode: m, selected: sel, onChange: change, displayed: shown } = latest.current
      if (m !== 'rows') return
      if (anchor.current === null) anchor.current = [...sel][0] ?? target
      const r = selectRow({ selected: sel, displayed: shown, anchor: anchor.current, target, shift: true })
      if (r.selected) change(r.selected)
    },
    /** ↑↓ : la ligne devient la sélection (mode lignes). */
    only(target: string) {
      const { mode: m, selected: sel, onChange: change } = latest.current
      if (m !== 'rows') return
      anchor.current = target
      if (sel.size === 1 && sel.has(target)) return
      change(new Set([target]))
    },
    clear() {
      const { mode: m, selected: sel, onChange: change } = latest.current
      if (m !== 'rows' || sel.size === 0) return false
      anchor.current = null
      change(new Set())
      return true
    },
  }), [])
}
