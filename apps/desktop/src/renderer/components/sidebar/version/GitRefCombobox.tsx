import { useState, useRef, useEffect } from 'react'
import { GitBranch, Hash, Tag } from 'lucide-react'
import type { GitRef } from '@polenta/api-client'

interface GitRefComboboxProps {
  refs: GitRef[]
  value: string | undefined
  placeholder: string
  onChange: (sha: string) => void
}

function refLabel(ref: GitRef): string {
  if (ref.type === 'branch') return `⎇ ${ref.name}`
  if (ref.type === 'remote-branch') return `⎇ ${ref.name}`
  if (ref.type === 'tag') return `⊙ ${ref.name}`
  return `# ${ref.short ?? ref.name}`
}

function refDisplayValue(refs: GitRef[], sha: string | undefined): string {
  if (!sha) return ''
  const found = refs.find(r => r.sha === sha)
  if (!found) return sha.slice(0, 7)
  return refLabel(found)
}

export function GitRefCombobox({ refs, value, placeholder, onChange }: GitRefComboboxProps) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) setFilter('')
  }, [open])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const lower = filter.toLowerCase()
  const filtered = filter
    ? refs.filter(r => r.name.toLowerCase().includes(lower) || (r.message ?? '').toLowerCase().includes(lower))
    : refs

  const localBranches = filtered.filter(r => r.type === 'branch')
  const remoteBranches = filtered.filter(r => r.type === 'remote-branch')
  const tags = filtered.filter(r => r.type === 'tag')
  const commits = filtered.filter(r => r.type === 'commit')

  const displayValue = refDisplayValue(refs, value)

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-2 py-1 text-xs border border-edge rounded bg-surface text-ink flex items-center justify-between gap-1 hover:bg-hover transition-colors"
      >
        <span className="truncate font-mono">{displayValue || placeholder}</span>
        <span className="text-ink-3 shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-surface border border-edge rounded shadow-lg max-h-72 flex flex-col">
          <div className="px-2 py-1 border-b border-edge-subtle shrink-0">
            <input
              type="text"
              autoFocus
              placeholder="Filtrer…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="w-full text-xs bg-transparent text-ink outline-none placeholder-ink-3"
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {localBranches.length > 0 && (
              <RefGroup label="Branches locales" icon={<GitBranch size={10} />} items={localBranches} onSelect={sha => { onChange(sha); setOpen(false) }} />
            )}
            {remoteBranches.length > 0 && (
              <RefGroup label="Branches remote" icon={<GitBranch size={10} />} items={remoteBranches} onSelect={sha => { onChange(sha); setOpen(false) }} />
            )}
            {tags.length > 0 && (
              <RefGroup label="Tags" icon={<Tag size={10} />} items={tags} onSelect={sha => { onChange(sha); setOpen(false) }} />
            )}
            {commits.length > 0 && (
              <RefGroup label="Commits récents" icon={<Hash size={10} />} items={commits} onSelect={sha => { onChange(sha); setOpen(false) }} />
            )}
            {filtered.length === 0 && (
              <p className="text-xs text-ink-3 italic px-3 py-2">Aucun résultat</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface RefGroupProps {
  label: string
  icon: React.ReactNode
  items: GitRef[]
  onSelect: (sha: string) => void
}

function RefGroup({ label, icon, items, onSelect }: RefGroupProps) {
  return (
    <div>
      <div className="flex items-center gap-1 px-2 py-1 text-ink-3 text-xs font-medium border-b border-edge-subtle bg-surface-raised sticky top-0">
        {icon}
        {label}
      </div>
      {items.map(ref => (
        <button
          key={ref.sha + ref.name}
          type="button"
          onClick={() => onSelect(ref.sha)}
          className="w-full text-left px-3 py-1 text-xs font-mono text-ink hover:bg-hover transition-colors flex items-center gap-2"
        >
          <span className="truncate">{refLabel(ref)}</span>
          {ref.message && (
            <span className="text-ink-3 truncate text-xs">{ref.message}</span>
          )}
        </button>
      ))}
    </div>
  )
}
