import { useState, useRef, useEffect, useCallback, type RefObject, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Plus, Trash2, Tag, GitCommitHorizontal } from 'lucide-react'
import type { BranchInfo } from '@polenta/api-client'

/** Same rule as WorkspaceTreeService.repoExistsAtPin's SHA detection — a short or full SHA-1. */
const SHA_RE = /^[0-9a-f]{7,40}$/i

interface FooterActionProps {
  icon: ReactNode
  label: string
  placeholder: string
  show: boolean
  onShow: () => void
  onHide: () => void
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  isValid: boolean
  inputRef: RefObject<HTMLInputElement>
}

/** One fixed footer item of the dropdown: a toggle button that reveals an inline text input
 *  (Enter to submit, Escape to cancel). Shared shape for "Nouvelle branche…" and "Checkout un
 *  commit…" (T82) — they differ only in icon/label/placeholder/validation/submit action. */
function FooterAction({ icon, label, placeholder, show, onShow, onHide, value, onChange, onSubmit, isValid, inputRef }: FooterActionProps) {
  return (
    <div className="border-t border-edge-subtle">
      {!show ? (
        <button
          type="button"
          onClick={onShow}
          className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-ink-2 hover:bg-hover transition-colors"
        >
          {icon}
          {label}
        </button>
      ) : (
        <div className="flex items-center gap-1 px-2 py-1.5">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onSubmit()
              if (e.key === 'Escape') onHide()
            }}
            placeholder={placeholder}
            className="flex-1 input-field text-xs py-0.5 font-mono"
          />
          <button
            type="button"
            onClick={onSubmit}
            disabled={!isValid}
            className="shrink-0 p-1 text-green-600 hover:text-green-700 disabled:opacity-30"
            title="Valider"
          >
            <Check size={13} />
          </button>
          <button
            type="button"
            onClick={onHide}
            className="shrink-0 p-1 text-ink-3 hover:text-ink"
            title="Annuler"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

interface BranchComboboxProps {
  branches: BranchInfo[]
  tags: string[]
  currentBranch: string
  onCheckout: (name: string) => void
  onCheckoutCommit: (sha: string) => void
  onDelete: (name: string) => void
  onCreateNew: (name: string) => void
  isPending: boolean
  /** Notified when the dropdown opens/closes — lets a caller lazily enable its branches/tags
   *  fetch only while the list is actually visible (T86), instead of polling continuously. */
  onOpenChange?: (open: boolean) => void
}

export function BranchCombobox({ branches, tags, currentBranch, onCheckout, onCheckoutCommit, onDelete, onCreateNew, isPending, onOpenChange }: BranchComboboxProps) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [showCheckoutCommit, setShowCheckoutCommit] = useState(false)
  const [commitSha, setCommitSha] = useState('')
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  const newNameRef = useRef<HTMLInputElement>(null)
  const commitShaRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const filteredBranches = branches.filter(b =>
    !filter || b.name.toLowerCase().includes(filter.toLowerCase())
  )
  const filteredTags = tags.filter(t =>
    !filter || t.toLowerCase().includes(filter.toLowerCase())
  )

  function openDrop() {
    if (!inputRef.current) return
    const r = inputRef.current.getBoundingClientRect()
    setDropPos({ top: r.bottom + 4, left: r.left, width: r.width })
    setOpen(true)
    setDeleteConfirm(null)
    setShowCreate(false)
    setNewName('')
    setShowCheckoutCommit(false)
    setCommitSha('')
    onOpenChange?.(true)
  }

  function closeDrop() {
    setOpen(false)
    setFilter('')
    setDeleteConfirm(null)
    setShowCreate(false)
    setNewName('')
    setShowCheckoutCommit(false)
    setCommitSha('')
    onOpenChange?.(false)
  }

  function handleSelect(name: string) {
    if (name !== currentBranch) onCheckout(name)
    closeDrop()
  }

  function handleCreate() {
    const name = newName.trim()
    if (!name) return
    onCreateNew(name)
    closeDrop()
  }

  function handleShowCreate() {
    setShowCreate(true)
    setDeleteConfirm(null)
    setShowCheckoutCommit(false)
    setTimeout(() => newNameRef.current?.focus(), 0)
  }

  function handleCheckoutCommit() {
    const sha = commitSha.trim()
    if (!SHA_RE.test(sha)) return
    onCheckoutCommit(sha)
    closeDrop()
  }

  function handleShowCheckoutCommit() {
    setShowCheckoutCommit(true)
    setDeleteConfirm(null)
    setShowCreate(false)
    setTimeout(() => commitShaRef.current?.focus(), 0)
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

  // Recompute position on scroll/resize
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

  return (
    <div className="flex-1 relative">
      <input
        ref={inputRef}
        type="text"
        value={open ? filter : currentBranch}
        placeholder="branche…"
        readOnly={!open}
        onChange={e => setFilter(e.target.value)}
        onFocus={openDrop}
        onClick={openDrop}
        disabled={isPending}
        className="w-full input-field text-xs py-1 font-mono pr-6 disabled:opacity-50 cursor-pointer"
      />
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none text-[10px]">▾</span>

      {open && createPortal(
        <div
          ref={dropRef}
          style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 9999 }}
          className="bg-surface border border-edge rounded-lg shadow-xl overflow-hidden"
        >
          <ul className="max-h-52 overflow-y-auto py-0.5">
            {filteredBranches.length === 0 && filteredTags.length === 0 && (
              <li className="px-3 py-2 text-xs text-ink-3 italic">Aucune branche</li>
            )}
            {filteredBranches.map(b => (
              <li key={b.name} className="flex items-center group">
                <button
                  type="button"
                  onClick={() => handleSelect(b.name)}
                  className={`flex-1 flex items-center gap-2 px-3 py-1.5 text-left text-xs font-mono hover:bg-hover transition-colors ${
                    b.isCurrent ? 'text-blue-500 dark:text-blue-400' : 'text-ink'
                  }`}
                >
                  {b.isCurrent && <Check size={11} className="shrink-0" />}
                  {!b.isCurrent && <span className="w-[11px] shrink-0" />}
                  <span className="truncate">{b.name}</span>
                  {b.type === 'int' && (
                    <span className="ml-auto shrink-0 text-[10px] text-ink-3 font-sans">int</span>
                  )}
                </button>
                {!b.isCurrent && deleteConfirm !== b.name && (
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm(b.name)}
                    className="shrink-0 px-2 py-1.5 text-ink-3 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Supprimer la branche"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
                {!b.isCurrent && deleteConfirm === b.name && (
                  <span className="flex items-center gap-1 px-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => { onDelete(b.name); setDeleteConfirm(null) }}
                      className="text-[10px] text-red-600 hover:underline font-medium"
                    >Suppr.</button>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(null)}
                      className="text-[10px] text-ink-3 hover:underline"
                    >✕</button>
                  </span>
                )}
              </li>
            ))}

            {/* ── Tags ── */}
            {filteredTags.length > 0 && (
              <>
                {filteredBranches.length > 0 && (
                  <li className="px-3 pt-2 pb-0.5">
                    <span className="text-[10px] text-ink-3 uppercase tracking-wide font-medium">Tags</span>
                  </li>
                )}
                {filteredTags.map(t => (
                  <li key={`tag:${t}`} className="flex items-center">
                    <button
                      type="button"
                      onClick={() => handleSelect(t)}
                      className="flex-1 flex items-center gap-2 px-3 py-1.5 text-left text-xs font-mono text-ink hover:bg-hover transition-colors"
                    >
                      <span className="w-[11px] shrink-0" />
                      <span className="truncate">{t}</span>
                      <span className="ml-auto shrink-0 flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400 font-sans">
                        <Tag size={9} />
                        tag
                      </span>
                    </button>
                  </li>
                ))}
              </>
            )}
          </ul>

          {/* ── Item fixe : Nouvelle branche ── */}
          <FooterAction
            icon={<Plus size={11} className="shrink-0 text-ink-3" />}
            label="Nouvelle branche…"
            placeholder="nom-de-branche"
            show={showCreate}
            onShow={handleShowCreate}
            onHide={() => { setShowCreate(false); setNewName('') }}
            value={newName}
            onChange={setNewName}
            onSubmit={handleCreate}
            isValid={!!newName.trim()}
            inputRef={newNameRef}
          />

          {/* ── Item fixe : Checkout un commit (T82) ── */}
          <FooterAction
            icon={<GitCommitHorizontal size={11} className="shrink-0 text-ink-3" />}
            label="Checkout un commit…"
            placeholder="sha…"
            show={showCheckoutCommit}
            onShow={handleShowCheckoutCommit}
            onHide={() => { setShowCheckoutCommit(false); setCommitSha('') }}
            value={commitSha}
            onChange={setCommitSha}
            onSubmit={handleCheckoutCommit}
            isValid={SHA_RE.test(commitSha.trim())}
            inputRef={commitShaRef}
          />
        </div>,
        document.body
      )}
    </div>
  )
}
