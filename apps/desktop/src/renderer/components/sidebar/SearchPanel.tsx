import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { api } from '../../api'
import { decodeProjectId } from '../../lib/projectId'
import type { Requirement, TestCase, TestCampaign } from '@polenta/types'

interface Props {
  currentProjectId: string
  projectId: string
}

interface SearchOpts {
  caseSensitive: boolean
  wholeWord: boolean
  isRegex: boolean
  preserveCase: boolean
}

interface SearchTypes {
  requirements: boolean
  tests: boolean
  campaigns: boolean
}

type ItemType = 'requirement' | 'test' | 'campaign'

interface MatchedField {
  key: string
  excerpt: string
  matchStart: number
  matchLength: number
}

interface SearchResult {
  itemType: ItemType
  id: string
  title: string
  matches: MatchedField[]
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildRegex(query: string, opts: SearchOpts): RegExp | null {
  if (!query.trim()) return null
  try {
    let pattern = opts.isRegex ? query : escapeRegex(query)
    if (opts.wholeWord) pattern = `\\b${pattern}\\b`
    return new RegExp(pattern, 'g' + (opts.caseSensitive ? '' : 'i'))
  } catch {
    return null
  }
}

function applyPreserveCase(original: string, replacement: string): string {
  if (!replacement) return replacement
  if (original === original.toUpperCase()) return replacement.toUpperCase()
  if (original[0] === original[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1)
  }
  return replacement.toLowerCase()
}

function replaceInText(text: string, regex: RegExp, replacement: string, preserveCase: boolean): string {
  const freshRe = new RegExp(regex.source, regex.flags)
  return text.replace(freshRe, (match) =>
    preserveCase ? applyPreserveCase(match, replacement) : replacement,
  )
}

function getStringFields(fields: Record<string, unknown>): Array<{ key: string; value: string }> {
  return Object.entries(fields).flatMap(([key, val]) => {
    if (typeof val === 'string' && val.trim()) return [{ key, value: val }]
    if (Array.isArray(val)) {
      const joined = val.filter((v): v is string => typeof v === 'string').join(' ')
      if (joined) return [{ key, value: joined }]
    }
    return []
  })
}

function findMatches(
  fields: Array<{ key: string; value: string }>,
  regex: RegExp,
): MatchedField[] {
  const matched: MatchedField[] = []
  for (const { key, value } of fields) {
    regex.lastIndex = 0
    const m = regex.exec(value)
    if (m) {
      const CTX = 35
      const from = Math.max(0, m.index - CTX)
      const to = Math.min(value.length, m.index + m[0].length + CTX)
      const prefix = from > 0 ? '…' : ''
      const suffix = to < value.length ? '…' : ''
      matched.push({
        key,
        excerpt: prefix + value.slice(from, to) + suffix,
        matchStart: m.index - from + prefix.length,
        matchLength: m[0].length,
      })
    }
  }
  return matched
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ToggleBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={[
        'text-[10px] font-mono px-1 py-0.5 rounded transition-colors leading-none select-none',
        active ? 'bg-blue-600 text-white' : 'text-ink-3 hover:text-ink hover:bg-hover',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function ExcerptView({
  excerpt,
  matchStart,
  matchLength,
}: {
  excerpt: string
  matchStart: number
  matchLength: number
}) {
  return (
    <span className="text-xs text-ink-2 break-all font-mono">
      <span>{excerpt.slice(0, matchStart)}</span>
      <mark className="bg-yellow-300 dark:bg-yellow-700/60 text-inherit rounded-sm px-px not-italic">
        {excerpt.slice(matchStart, matchStart + matchLength)}
      </mark>
      <span>{excerpt.slice(matchStart + matchLength)}</span>
    </span>
  )
}

function ResultItem({
  result,
  showReplace,
  canReplace,
  onNavigate,
  onReplace,
}: {
  result: SearchResult
  showReplace: boolean
  canReplace: boolean
  onNavigate: () => void
  onReplace: () => void
}) {
  const [expanded, setExpanded] = useState(true)

  const badgeCls =
    result.itemType === 'requirement'
      ? 'bg-blue-600'
      : result.itemType === 'test'
        ? 'bg-green-600'
        : 'bg-amber-500'
  const badgeLabel =
    result.itemType === 'requirement' ? 'EX' : result.itemType === 'test' ? 'TC' : 'CA'

  return (
    <div className="border-b border-edge-subtle last:border-0">
      {/* Item header */}
      <div className="flex items-center gap-1 px-2 py-1 hover:bg-hover group">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-ink-3 hover:text-ink p-0.5 shrink-0"
        >
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>
        <button
          type="button"
          onClick={onNavigate}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
        >
          <span className={`text-[9px] font-bold text-white px-1 py-px rounded shrink-0 ${badgeCls}`}>
            {badgeLabel}
          </span>
          <span className="font-mono text-xs text-ink-3 shrink-0">{result.id}</span>
          <span className="text-xs text-ink-2 truncate">{result.title}</span>
        </button>
        {showReplace && canReplace && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onReplace()
            }}
            className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-ink shrink-0 border border-edge rounded px-1 text-[10px] transition-opacity"
            title="Remplacer dans cet élément"
          >
            ↻
          </button>
        )}
      </div>

      {/* Matches */}
      {expanded && (
        <div className="pb-0.5">
          {result.matches.map((m, i) => (
            <div key={i} className="flex items-start gap-1.5 px-2 py-0.5 pl-9 hover:bg-hover">
              <span className="text-[9px] text-ink-3 shrink-0 pt-px font-mono min-w-[3rem] truncate">
                {m.key}
              </span>
              <ExcerptView
                excerpt={m.excerpt}
                matchStart={m.matchStart}
                matchLength={m.matchLength}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SearchPanel({ currentProjectId, projectId }: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [query, setQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [opts, setOpts] = useState<SearchOpts>({
    caseSensitive: false,
    wholeWord: false,
    isRegex: false,
    preserveCase: false,
  })
  const [types, setTypes] = useState<SearchTypes>({
    requirements: true,
    tests: true,
    campaigns: true,
  })
  const [replacing, setReplacing] = useState(false)
  const [replaceError, setReplaceError] = useState<string | null>(null)

  const { data: project } = useQuery({
    queryKey: ['workspace', currentProjectId],
    queryFn: () => api.workspace.resolve(decodeProjectId(currentProjectId)),
  })
  const repoPath = project?.localPath ?? ''

  const regex = useMemo(() => buildRegex(query, opts), [query, opts])
  const regexInvalid = opts.isRegex && !!query && !regex

  const { data: requirements = [] } = useQuery({
    queryKey: ['requirements', repoPath],
    queryFn: () => api.requirements.list(repoPath),
    enabled: !!repoPath && types.requirements && !!regex,
  })

  const { data: tests = [] } = useQuery({
    queryKey: ['tests', repoPath],
    queryFn: () => api.tests.list(repoPath),
    enabled: !!repoPath && types.tests && !!regex,
  })

  const { data: campaigns = [] } = useQuery({
    queryKey: ['campaigns', repoPath],
    queryFn: () => api.campaigns.list(repoPath),
    enabled: !!repoPath && types.campaigns && !!regex,
  })

  const results = useMemo((): SearchResult[] => {
    if (!regex) return []
    const out: SearchResult[] = []

    if (types.requirements) {
      for (const req of requirements as Requirement[]) {
        const fields = [
          { key: 'id', value: req.id },
          { key: 'title', value: req.title },
          ...getStringFields(req.fields),
        ]
        const matches = findMatches(fields, regex)
        if (matches.length) out.push({ itemType: 'requirement', id: req.id, title: req.title, matches })
      }
    }

    if (types.tests) {
      for (const test of tests as TestCase[]) {
        const fields = [
          { key: 'id', value: test.id },
          { key: 'title', value: test.title },
          ...getStringFields(test.fields),
        ]
        const matches = findMatches(fields, regex)
        if (matches.length) out.push({ itemType: 'test', id: test.id, title: test.title, matches })
      }
    }

    if (types.campaigns) {
      for (const camp of campaigns as TestCampaign[]) {
        const fields = [
          { key: 'id', value: camp.id },
          { key: 'title', value: camp.title },
          ...Object.entries(camp.fields ?? {})
            .filter(([, v]) => typeof v === 'string' && v)
            .map(([k, v]) => ({ key: k, value: v as string })),
        ]
        const matches = findMatches(fields, regex)
        if (matches.length) out.push({ itemType: 'campaign', id: camp.id, title: camp.title, matches })
      }
    }

    return out
  }, [regex, requirements, tests, campaigns, types])

  const totalMatches = results.reduce((acc, r) => acc + r.matches.length, 0)

  async function replaceInItem(result: SearchResult): Promise<void> {
    if (!regex || !repoPath) return

    if (result.itemType === 'requirement') {
      const req = (requirements as Requirement[]).find((r) => r.id === result.id)
      if (!req) return
      const newTitle = result.matches.some((m) => m.key === 'title')
        ? replaceInText(req.title, regex, replaceQuery, opts.preserveCase)
        : req.title
      const newFields: Record<string, unknown> = { ...req.fields }
      for (const m of result.matches) {
        if (m.key !== 'id' && m.key !== 'title') {
          const v = req.fields[m.key]
          if (typeof v === 'string') {
            newFields[m.key] = replaceInText(v, regex, replaceQuery, opts.preserveCase)
          }
        }
      }
      await api.requirements.update(repoPath, result.id, { title: newTitle, fields: newFields })
      queryClient.invalidateQueries({ queryKey: ['requirements', repoPath] })
    } else if (result.itemType === 'test') {
      const test = (tests as TestCase[]).find((t) => t.id === result.id)
      if (!test) return
      const newTitle = result.matches.some((m) => m.key === 'title')
        ? replaceInText(test.title, regex, replaceQuery, opts.preserveCase)
        : test.title
      const newFields: Record<string, unknown> = { ...test.fields }
      for (const m of result.matches) {
        if (m.key !== 'id' && m.key !== 'title') {
          const v = test.fields[m.key]
          if (typeof v === 'string') {
            newFields[m.key] = replaceInText(v, regex, replaceQuery, opts.preserveCase)
          }
        }
      }
      await api.tests.update(repoPath, result.id, { title: newTitle, fields: newFields })
      queryClient.invalidateQueries({ queryKey: ['tests', repoPath] })
    }
    // campaigns: pas de endpoint update générique
  }

  async function handleReplaceOne(result: SearchResult) {
    setReplaceError(null)
    try {
      await replaceInItem(result)
    } catch (e) {
      setReplaceError(e instanceof Error ? e.message : 'Erreur de remplacement')
    }
  }

  async function handleReplaceAll() {
    if (!regex || !repoPath || replacing || results.length === 0) return
    setReplacing(true)
    setReplaceError(null)
    try {
      for (const result of results) {
        if (result.itemType !== 'campaign') {
          await replaceInItem(result)
        }
      }
    } catch (e) {
      setReplaceError(e instanceof Error ? e.message : 'Erreur de remplacement')
    } finally {
      setReplacing(false)
    }
  }

  function navigateTo(result: SearchResult) {
    if (!repoPath) return
    const s = { repoPath, projectId, component: undefined, level: undefined }
    if (result.itemType === 'requirement') {
      navigate({ to: '/req/$reqId', params: { reqId: result.id }, search: s })
    } else if (result.itemType === 'test') {
      navigate({ to: '/test/$testId', params: { testId: result.id }, search: s })
    } else {
      navigate({ to: '/campaign/$campaignId', params: { campaignId: result.id }, search: s })
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-edge shrink-0 space-y-2">
        <p className="section-label">Recherche</p>

        {/* Search row */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowReplace((v) => !v)}
            className="text-ink-3 hover:text-ink p-0.5 shrink-0"
            title={showReplace ? 'Masquer le remplacement' : 'Afficher le remplacement'}
          >
            {showReplace ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <div className="relative flex-1">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher…"
              autoFocus
              className={[
                'input-field w-full text-xs py-1 pr-[5rem]',
                regexInvalid ? 'border-red-500 focus:ring-red-400/30' : '',
              ].join(' ')}
            />
            <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-0.5">
              <ToggleBtn
                active={opts.caseSensitive}
                onClick={() => setOpts((o) => ({ ...o, caseSensitive: !o.caseSensitive }))}
                title="Respecter la casse"
              >
                Aa
              </ToggleBtn>
              <ToggleBtn
                active={opts.wholeWord}
                onClick={() => setOpts((o) => ({ ...o, wholeWord: !o.wholeWord }))}
                title="Mot entier"
              >
                ab|
              </ToggleBtn>
              <ToggleBtn
                active={opts.isRegex}
                onClick={() => setOpts((o) => ({ ...o, isRegex: !o.isRegex }))}
                title="Expression régulière"
              >
                .*
              </ToggleBtn>
            </div>
          </div>
        </div>

        {/* Replace row */}
        {showReplace && (
          <div className="flex items-center gap-1">
            <div className="w-5 shrink-0" />
            <div className="relative flex-1">
              <input
                value={replaceQuery}
                onChange={(e) => setReplaceQuery(e.target.value)}
                placeholder="Remplacer par…"
                className="input-field w-full text-xs py-1 pr-8"
              />
              <div className="absolute right-1 top-1/2 -translate-y-1/2">
                <ToggleBtn
                  active={opts.preserveCase}
                  onClick={() => setOpts((o) => ({ ...o, preserveCase: !o.preserveCase }))}
                  title="Conserver la casse"
                >
                  AB
                </ToggleBtn>
              </div>
            </div>
            <button
              type="button"
              onClick={handleReplaceAll}
              disabled={!query || !repoPath || replacing || results.length === 0}
              className="btn-sm shrink-0 whitespace-nowrap"
              title="Tout remplacer"
            >
              {replacing ? '…' : 'Tout'}
            </button>
          </div>
        )}

        {/* Type filters */}
        <div className="flex gap-3 text-xs text-ink-3">
          {(['requirements', 'tests', 'campaigns'] as const).map((t) => (
            <label key={t} className="flex items-center gap-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={types[t]}
                onChange={(e) => setTypes((prev) => ({ ...prev, [t]: e.target.checked }))}
                className="w-3 h-3 accent-blue-600"
              />
              {t === 'requirements' ? 'Exig.' : t === 'tests' ? 'Tests' : 'Camp.'}
            </label>
          ))}
        </div>

        {/* Status line */}
        {regexInvalid && (
          <p className="text-xs text-red-500">Expression régulière invalide</p>
        )}
        {replaceError && <p className="text-xs text-red-500">{replaceError}</p>}
        {regex && (
          <p className="text-xs text-ink-3">
            {totalMatches === 0
              ? 'Aucun résultat'
              : `${totalMatches} occurrence${totalMatches > 1 ? 's' : ''} dans ${results.length} élément${results.length > 1 ? 's' : ''}`}
          </p>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {results.map((result) => (
          <ResultItem
            key={result.id}
            result={result}
            showReplace={showReplace}
            canReplace={result.itemType !== 'campaign'}
            onNavigate={() => navigateTo(result)}
            onReplace={() => handleReplaceOne(result)}
          />
        ))}
      </div>
    </div>
  )
}
