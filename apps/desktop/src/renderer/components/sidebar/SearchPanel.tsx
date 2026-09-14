import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { CATEGORY_CHART_BG } from '../../lib/objectCategoryColors'
import { useSearch } from '../../contexts/SearchContext'
import type { SearchResult } from '../../lib/searchQuery'

interface Props {
  currentProjectId: string
  projectId: string
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
        active ? 'bg-status-info-solid text-status-info-fg' : 'text-ink-3 hover:text-ink hover:bg-hover',
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
      <mark className="bg-status-warning-solid/70 text-inherit rounded-sm px-px not-italic">
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
  onGoto,
  onOpen,
  onReplace,
}: {
  result: SearchResult
  showReplace: boolean
  canReplace: boolean
  onGoto: () => void
  onOpen: () => void
  onReplace: () => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)

  const badgeCls =
    result.itemType === 'requirement'
      ? CATEGORY_CHART_BG.requirement
      : result.itemType === 'test'
        ? CATEGORY_CHART_BG.test
        : CATEGORY_CHART_BG.campaign
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
          onClick={onGoto}
          onDoubleClick={onOpen}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
          title={t('sidebar.search.clickToGoto')}
        >
          <span className={`text-[9px] font-bold text-status-info-fg px-1 py-px rounded shrink-0 ${badgeCls}`}>
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
            title={t('sidebar.search.replaceInItem')}
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

export function SearchPanel({ projectId }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const {
    query, setQuery,
    replaceQuery, setReplaceQuery,
    showReplace, setShowReplace,
    opts, setOpts,
    types, setTypes,
    repoPath,
    regex,
    regexInvalid,
    results,
    totalMatches,
    replacing,
    replaceError,
    handleReplaceOne,
    handleReplaceAll,
    setGoto,
    openEditor,
  } = useSearch()

  // Double-clic : exigence / test → édition inline dans la zone principale (sans
  // quitter /search) ; campagne (pas d'endpoint d'édition générique) → page campagne.
  function handleOpen(result: SearchResult) {
    if (result.itemType === 'campaign') {
      if (!repoPath) return
      navigate({
        to: '/campaign/$campaignId',
        params: { campaignId: result.id },
        search: { repoPath, projectId, component: undefined, level: undefined },
      })
      return
    }
    openEditor(result)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-edge shrink-0 space-y-2">
        <p className="section-label">{t('sidebar.search.title')}</p>

        {/* Search row */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowReplace((v) => !v)}
            className="text-ink-3 hover:text-ink p-0.5 shrink-0"
            title={showReplace ? t('sidebar.search.hideReplace') : t('sidebar.search.showReplace')}
          >
            {showReplace ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <div className="relative flex-1">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('sidebar.search.searchPlaceholder')}
              autoFocus
              className={[
                'input-field w-full text-xs py-1 pr-[5rem]',
                regexInvalid ? 'border-status-danger focus:ring-status-danger/30' : '',
              ].join(' ')}
            />
            <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-0.5">
              <ToggleBtn
                active={opts.caseSensitive}
                onClick={() => setOpts((o) => ({ ...o, caseSensitive: !o.caseSensitive }))}
                title={t('sidebar.search.caseSensitive')}
              >
                Aa
              </ToggleBtn>
              <ToggleBtn
                active={opts.wholeWord}
                onClick={() => setOpts((o) => ({ ...o, wholeWord: !o.wholeWord }))}
                title={t('sidebar.search.wholeWord')}
              >
                ab|
              </ToggleBtn>
              <ToggleBtn
                active={opts.isRegex}
                onClick={() => setOpts((o) => ({ ...o, isRegex: !o.isRegex }))}
                title={t('sidebar.search.regex')}
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
                placeholder={t('sidebar.search.replacePlaceholder')}
                className="input-field w-full text-xs py-1 pr-8"
              />
              <div className="absolute right-1 top-1/2 -translate-y-1/2">
                <ToggleBtn
                  active={opts.preserveCase}
                  onClick={() => setOpts((o) => ({ ...o, preserveCase: !o.preserveCase }))}
                  title={t('sidebar.search.preserveCase')}
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
              title={t('sidebar.search.replaceAll')}
            >
              {replacing ? '…' : t('sidebar.search.replaceAllShort')}
            </button>
          </div>
        )}

        {/* Type filters */}
        <div className="flex gap-3 text-xs text-ink-3">
          {(['requirements', 'tests', 'campaigns'] as const).map((kind) => (
            <label key={kind} className="flex items-center gap-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={types[kind]}
                onChange={(e) => setTypes((prev) => ({ ...prev, [kind]: e.target.checked }))}
                className="w-3 h-3 accent-status-info-solid"
              />
              {kind === 'requirements' ? t('sidebar.search.requirementsFilter') : kind === 'tests' ? t('sidebar.search.testsFilter') : t('sidebar.search.campaignsFilter')}
            </label>
          ))}
        </div>

        {/* Status line */}
        {regexInvalid && (
          <p className="text-xs text-status-danger">{t('sidebar.search.invalidRegex')}</p>
        )}
        {replaceError && <p className="text-xs text-status-danger">{replaceError}</p>}
        {regex && (
          <p className="text-xs text-ink-3">
            {totalMatches === 0
              ? t('common.noResults')
              : `${t('sidebar.search.resultsMatches', { count: totalMatches })} ${t('sidebar.search.resultsItems', { count: results.length })}`}
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
            onGoto={() => setGoto(result.id)}
            onOpen={() => handleOpen(result)}
            onReplace={() => handleReplaceOne(result)}
          />
        ))}
      </div>
    </div>
  )
}
