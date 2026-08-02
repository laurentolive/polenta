import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { ComponentTypeOption } from '../../contexts/SystemViewContext'

interface ComponentTypeComboboxProps {
  options: ComponentTypeOption[]
  /** Index into `options` of the current selection, or -1 if none. Position-based rather than a
   *  string key — repo/node names have no character restriction, so a delimited-string identity
   *  is collision-prone (found in review, same lesson as the pre-T129 index-based selection). */
  selectedIndex: number
  onSelect: (option: ComponentTypeOption) => void
}

/** One filtered row, carrying its position in the (unfiltered) `options` array — that position is
 *  this combobox's only notion of identity, used for both the React key and for matching
 *  `selectedIndex`/`highlightedIndex`. */
interface Row {
  option: ComponentTypeOption
  index: number
}

/** Single-select filterable combobox merging the former Composant + Élément comboboxes (T129).
 *  Modeled on BranchCombobox.tsx (input doubles as value display + filter field, dropdown in a
 *  document.body portal to escape SystemPanel's `overflow-hidden` ancestor) rather than
 *  LinkCombobox.tsx (multi-select with chips, not the shape needed here). Adds keyboard
 *  arrow/Enter/Escape navigation with scroll-following — the pieces missing from every existing
 *  combobox in the codebase (cf. specs/T129-design.md §1). */
export function ComponentTypeCombobox({ options, selectedIndex, onSelect }: ComponentTypeComboboxProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])

  const disabled = options.length === 0
  const selected = options[selectedIndex]

  const q = query.trim().toLowerCase()
  const rows: Row[] = q
    ? options
        .map((option, index) => ({ option, index }))
        .filter(({ option }) => option.label.toLowerCase().includes(q))
    : options.map((option, index) => ({ option, index }))

  function openDrop() {
    if (!inputRef.current || disabled) return
    const r = inputRef.current.getBoundingClientRect()
    setDropPos({ top: r.bottom + 4, left: r.left, width: r.width })
    // Only reset the filter/highlight on an actual closed→open transition — re-running this on
    // every click while already open (e.g. clicking inside the text to reposition the caret)
    // would otherwise silently wipe a filter query the user is still typing (found in review).
    if (!open) {
      setQuery('')
      const startAt = rows.findIndex(row => row.index === selectedIndex)
      setHighlightedIndex(Math.max(0, startAt))
    }
    setOpen(true)
  }

  function closeDrop() {
    setOpen(false)
    setQuery('')
  }

  function handleSelect(option: ComponentTypeOption) {
    onSelect(option)
    closeDrop()
    inputRef.current?.blur()
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (
        dropRef.current && !dropRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) {
        closeDrop()
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Recompute position on scroll/resize (same technique as BranchCombobox)
  const recompute = useCallback(() => {
    if (!open || !inputRef.current) return
    const r = inputRef.current.getBoundingClientRect()
    setDropPos({ top: r.bottom + 4, left: r.left, width: r.width })
  }, [open])
  useEffect(() => {
    window.addEventListener('scroll', recompute, true)
    window.addEventListener('resize', recompute)
    return () => {
      window.removeEventListener('scroll', recompute, true)
      window.removeEventListener('resize', recompute)
    }
  }, [recompute])

  // Keep the highlighted index in range whenever the filtered list changes size, and keep the
  // highlighted row scrolled into view (arrow-key navigation past the visible viewport otherwise
  // leaves the user with no indication of which row Enter would commit — found in review).
  useEffect(() => {
    setHighlightedIndex(i => Math.min(i, Math.max(0, rows.length - 1)))
  }, [rows.length])
  useEffect(() => {
    rowRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex, open])

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openDrop() }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(i => Math.min(i + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = rows[highlightedIndex]
      if (row) handleSelect(row.option)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeDrop()
      inputRef.current?.blur()
    }
  }

  // Render with a section header whenever groupLabel changes — entries of a given repo are
  // already contiguous (componentOptions/componentTypeOptions build order), so a single linear
  // pass suffices, same technique as the pre-T129 renderComponentOptions.
  let lastGroupLabel: string | undefined
  const items: React.ReactNode[] = []
  rows.forEach((row, i) => {
    const { option } = row
    if (option.groupLabel && option.groupLabel !== lastGroupLabel) {
      items.push(
        <li key={`group:${option.groupLabel}`} className="px-3 pt-2 pb-0.5">
          <span className="text-[10px] text-ink-3 uppercase tracking-wide font-medium">{option.groupLabel}</span>
        </li>,
      )
    }
    lastGroupLabel = option.groupLabel
    items.push(
      <li key={row.index}>
        <button
          ref={el => { rowRefs.current[i] = el }}
          type="button"
          onMouseDown={e => { e.preventDefault(); handleSelect(option) }}
          onMouseEnter={() => setHighlightedIndex(i)}
          className={`w-full text-left px-3 py-1.5 text-xs truncate ${
            i === highlightedIndex ? 'bg-hover text-ink' : 'text-ink'
          } ${row.index === selectedIndex ? 'font-medium' : ''}`}
        >
          {option.label}
        </button>
      </li>,
    )
  })

  return (
    <div className="flex-1 relative">
      <input
        ref={inputRef}
        type="text"
        value={open ? query : (selected?.label ?? '')}
        placeholder={disabled ? t('sidebar.system.noComponentConfigured') : t('sidebar.system.componentElementPlaceholder')}
        readOnly={!open}
        disabled={disabled}
        onChange={e => { setQuery(e.target.value); setHighlightedIndex(0) }}
        onFocus={openDrop}
        onClick={openDrop}
        onKeyDown={handleKeyDown}
        className="w-full input-field text-xs py-1 disabled:opacity-50 cursor-pointer"
      />

      {open && createPortal(
        <div
          ref={dropRef}
          // Sized to content rather than pinned to the input's width: entries can carry a long
          // component path + type label (nested local components, T123), and this dropdown is a
          // document.body portal specifically so it isn't clipped by SystemPanel's narrower
          // overflow-hidden — no reason to also cap its width at the panel's, just its minimum.
          style={{
            position: 'fixed', top: dropPos.top, left: dropPos.left,
            minWidth: dropPos.width, width: 'max-content', maxWidth: 480, zIndex: 9999,
          }}
          className="bg-surface border border-edge rounded-lg shadow-xl overflow-hidden"
        >
          <ul className="max-h-64 overflow-y-auto py-0.5">
            {items.length === 0 && (
              <li className="px-3 py-2 text-xs text-ink-3 italic">{t('common.noResults')}</li>
            )}
            {items}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  )
}
