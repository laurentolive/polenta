import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { parseLinkError } from './linkUtils'

export type Candidate = {
  id: string
  title: string
  objectTypeRef: string
  category?: string
  /** GH105 — repo de l'objet et son libellé (candidats de tout le workspace). */
  repoPath?: string
  repoLabel?: string
  /** GH105 — repo en lecture seule : l'objet ne peut pas être la source d'un nouveau lien. */
  readonly?: boolean
}

/** Lien existant affiché en pastille. Les champs GH105 sont optionnels (appelants historiques). */
export type ExistingLinkChip = {
  linkId: string
  peerId: string
  /** Titre de l'objet lié, résolu quel que soit son repo. */
  peerTitle?: string
  /** Libellé du repo de l'objet lié, quand il diffère du repo courant. */
  peerRepoLabel?: string
  /** Objet lié introuvable dans le workspace. */
  missing?: boolean
  /** Lien stocké dans un repo en lecture seule : pas de suppression. */
  readonly?: boolean
  /** Libellé du repo qui stocke le lien (infobulle de la suppression désactivée). */
  storedInLabel?: string
}

export function LinkCombobox({
  label,
  existingLinks,
  candidates,
  onAdd,
  onRemove,
  onNavigateToObject,
  autoFocus = true,
}: {
  label?: string
  existingLinks: ExistingLinkChip[]
  candidates: Candidate[]
  onAdd: (peerId: string) => Promise<void>
  onRemove: (linkId: string) => Promise<void>
  onNavigateToObject?: (peerId: string, opts?: { newTab?: boolean }) => void
  /** Focus l'input au montage. `true` par défaut (popovers Excel/Word ouverts au clic),
   *  passé à `false` dans la vue Édition d'exigence pour ne pas voler le focus au chargement. */
  autoFocus?: boolean
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const existingIds = useMemo(() => new Set(existingLinks.map(l => l.peerId)), [existingLinks])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const available = candidates.filter(c => !existingIds.has(c.id))
    if (!q) return available.slice(0, 10)
    return available
      .filter(c => c.id.toLowerCase().includes(q) || c.title.toLowerCase().includes(q) || (c.repoLabel ?? '').toLowerCase().includes(q))
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

  // GH105 — une écriture refusée (lecture seule, doublon…) est affichée sous le champ ; avant, le
  // rejet laissait le combobox bloqué en chargement.
  const run = async (action: () => Promise<void>) => {
    setLoading(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      const { code, reason } = parseLinkError(err)
      setError(code ? t(`system.linkCombobox.errors.${code}`, { reason }) : reason)
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = async (candidate: Candidate) => {
    await run(() => onAdd(candidate.id))
    inputRef.current?.focus()
  }

  return (
    <div className="space-y-1.5">
      {label && <span className="text-xs text-ink-2">{label}</span>}
      <div className="flex flex-wrap gap-1 mb-1">
        {existingLinks.map(({ linkId, peerId, peerTitle, peerRepoLabel, missing, readonly, storedInLabel }) => (
          <span
            key={linkId}
            data-link-chip={peerId}
            className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 bg-hover rounded border border-edge text-ink max-w-full"
          >
            <span
              title={missing ? t('system.linkCombobox.notFoundHint') : t('system.shared.clickToNavigate')}
              onClick={e => { if (!missing) onNavigateToObject?.(peerId, { newTab: e.ctrlKey || e.metaKey }) }}
              className={['font-mono', onNavigateToObject && !missing ? 'cursor-pointer hover:underline' : ''].join(' ')}
            >
              {peerId}
            </span>
            {peerTitle && <span className="text-ink-3 truncate max-w-[16rem]">{peerTitle}</span>}
            {peerRepoLabel && <span className="text-[10px] text-ink-3 border border-edge rounded px-1">{peerRepoLabel}</span>}
            {missing && <span className="text-[10px] text-status-danger border border-status-danger rounded px-1">{t('system.linkCombobox.notFound')}</span>}
            <button
              type="button"
              disabled={loading || readonly}
              title={readonly ? t('system.linkCombobox.readonlyStorage', { repo: storedInLabel ?? '' }) : undefined}
              onClick={() => run(() => onRemove(linkId))}
              className="text-ink-3 hover:text-status-danger leading-none disabled:opacity-40 disabled:hover:text-ink-3"
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
          autoFocus={autoFocus}
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
                {c.repoLabel && <span className="ml-auto shrink-0 text-[10px] text-ink-3">{c.repoLabel}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-status-danger">{error}</p>}
    </div>
  )
}
