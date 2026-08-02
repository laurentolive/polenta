import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export type Candidate = { id: string; title: string; objectTypeRef: string; category?: string }

export function LinkCombobox({
  label,
  existingLinks,
  candidates,
  onAdd,
  onRemove,
  onNavigateToObject,
}: {
  label?: string
  existingLinks: { linkId: string; peerId: string }[]
  candidates: Candidate[]
  onAdd: (peerId: string) => Promise<void>
  onRemove: (linkId: string) => Promise<void>
  onNavigateToObject?: (peerId: string, opts?: { newTab?: boolean }) => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const existingIds = useMemo(() => new Set(existingLinks.map(l => l.peerId)), [existingLinks])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const available = candidates.filter(c => !existingIds.has(c.id))
    if (!q) return available.slice(0, 10)
    return available
      .filter(c => c.id.toLowerCase().includes(q) || c.title.toLowerCase().includes(q))
      .slice(0, 10)
  }, [query, candidates, existingIds])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = async (candidate: Candidate) => {
    setLoading(true)
    await onAdd(candidate.id)
    setLoading(false)
    inputRef.current?.focus()
  }

  const handleRemove = async (linkId: string) => {
    setLoading(true)
    await onRemove(linkId)
    setLoading(false)
  }

  return (
    <div className="space-y-1.5">
      {label && <span className="text-xs text-ink-2">{label}</span>}
      <div className="flex flex-wrap gap-1 mb-1">
        {existingLinks.map(({ linkId, peerId }) => (
          <span
            key={linkId}
            className="inline-flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 bg-hover rounded border border-edge text-ink"
          >
            <span
              title={t('system.shared.clickToNavigate')}
              onClick={e => onNavigateToObject?.(peerId, { newTab: e.ctrlKey || e.metaKey })}
              className={onNavigateToObject ? 'cursor-pointer hover:underline' : ''}
            >
              {peerId}
            </span>
            <button
              type="button"
              disabled={loading}
              onClick={() => handleRemove(linkId)}
              className="text-ink-3 hover:text-status-danger leading-none"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          disabled={loading}
          autoFocus
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={t('system.linkCombobox.searchPlaceholder')}
          className="w-full text-xs border border-edge rounded px-2 py-1 bg-surface text-ink outline-none focus:border-status-info placeholder:text-ink-3"
        />
        {open && filtered.length > 0 && (
          <div
            ref={dropdownRef}
            className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-surface border border-edge rounded shadow-lg max-h-48 overflow-y-auto"
          >
            {filtered.map(c => (
              <button
                key={c.id}
                type="button"
                onMouseDown={e => { e.preventDefault(); handleSelect(c) }}
                className="w-full text-left px-2 py-1.5 text-xs hover:bg-hover flex items-baseline gap-2"
              >
                <span className="font-mono text-ink shrink-0">{c.id}</span>
                <span className="text-ink-3 truncate">{c.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
