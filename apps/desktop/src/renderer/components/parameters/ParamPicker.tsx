import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import type { Parameter } from '@polenta/types'
import { formatParamValue } from '@polenta/types'

export interface ParamCandidate {
  /** Référence à insérer (sans accolades) : `nom` ou `<nœud>::nom`. */
  key: string
  parameter: Parameter
  repoLabel: string
}

/** T171 — sélecteur d'insertion d'un paramètre (bouton de la barre d'outils ou saisie de `{`).
 *  Positionné en `fixed` sous `anchor` ; Échap / clic extérieur ferment, Entrée choisit. */
export function ParamPicker({ anchor, candidates, canCreate, onPick, onCreate, onClose }: {
  anchor: DOMRect
  candidates: ParamCandidate[]
  canCreate: boolean
  onPick: (key: string) => void
  onCreate: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  const needle = query.trim().toLowerCase()
  const shown = useMemo(() => candidates.filter(c => !needle
    || [c.key, c.parameter.value, c.parameter.unit ?? '', c.repoLabel, c.parameter.description ?? '']
      .some(s => s.toLowerCase().includes(needle))), [candidates, needle])

  useEffect(() => { setActive(0) }, [needle])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const top = Math.min(anchor.bottom + 4, window.innerHeight - 320)
  const left = Math.min(anchor.left, window.innerWidth - 360)

  return (
    <div
      ref={rootRef}
      className="fixed z-50 w-[340px] bg-surface border border-edge rounded-lg shadow-xl flex flex-col"
      style={{ top, left }}
      onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); onClose() }
        else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, shown.length - 1)) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
        else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) onPick(shown[active].key) }
      }}
    >
      <input
        autoFocus
        className="input-field m-2 text-xs"
        placeholder={t('parameters.picker.search')}
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <ul className="max-h-60 overflow-y-auto text-xs">
        {shown.length === 0 && <li className="px-3 py-2 text-ink-3 italic">{t('common.noResults')}</li>}
        {shown.map((c, i) => (
          <li key={c.key}>
            <button
              type="button"
              className={`w-full text-left px-3 py-1.5 flex items-baseline gap-2 ${i === active ? 'bg-hover' : 'hover:bg-hover'}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(c.key)}
            >
              <span className="font-mono text-ink truncate">{c.key}</span>
              <span className="text-ink-2 shrink-0">{formatParamValue(c.parameter) ?? t('parameters.emptyValue')}</span>
              <span className="ml-auto text-ink-3 shrink-0 truncate max-w-[30%]">{c.repoLabel}</span>
            </button>
          </li>
        ))}
      </ul>
      {canCreate && (
        <button type="button" className="border-t border-edge px-3 py-2 text-xs text-left flex items-center gap-1 hover:bg-hover text-prim" onClick={onCreate}>
          <Plus size={12} />{t('parameters.picker.create')}
        </button>
      )}
    </div>
  )
}
