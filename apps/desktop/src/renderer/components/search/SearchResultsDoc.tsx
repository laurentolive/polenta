/**
 * SearchResultsDoc — zone principale de la Vue Recherche (T167).
 *
 * Liste plate des éléments résultats, une carte par élément, en **lecture seule**,
 * dans la présentation de la Vue Word (`WordView.ItemCard`) mais sans édition inline.
 * Types hétérogènes (exigence / test / campagne) → pas de vue Tableau.
 *
 * - clic simple sur une carte  → « goto » (scroll + contour persistant), comme le
 *   clic simple dans l'arbre des vues Exigences/Tests (T164) ;
 * - double-clic                 → `onOpen` (édition inline au sprint 2 ; navigation
 *   vers la page détail au sprint 1).
 */
import { useMemo, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectSchema, getReqTypeDef, getTestTypeDef, getCampaignTypeDef } from '../../hooks/useProjectSchema'
import { useScrollToNode } from '../../hooks/useScrollToNode'
import { normalizeObject } from '../../lib/normalizeObject'
import { CATEGORY_CHART_BG } from '../../lib/objectCategoryColors'
import { StaticRichTextViewer } from '../../lib/staticRichText'
import { ParamRefText } from '../parameters/ParamRefText'
import type { SearchResult } from '../../lib/searchQuery'
import type {
  ObjectTypeDefinition,
  Requirement,
  TestCase,
  TestCampaign,
} from '@polenta/types'

// Aligné sur `WordView.GOTO_OUTLINE_CLASS` (anneau bleu plein, distinct de la sélection).
const GOTO_OUTLINE_CLASS = 'ring-2 ring-inset ring-status-info-solid rounded'

function getStatusClass(status: string): string {
  switch (status) {
    case 'approved': return 'bg-status-success-bg text-status-success'
    case 'review':   return 'bg-status-warning-bg text-status-warning'
    case 'obsolete': return 'bg-status-danger-bg text-status-danger'
    default:         return 'bg-status-neutral-bg text-status-neutral'
  }
}

interface Props {
  repoPath: string
  results: SearchResult[]
  requirements: Requirement[]
  tests: TestCase[]
  campaigns: TestCampaign[]
  regex: RegExp | null
  gotoId: string | null
  gotoSeq: number
  onGoto: (id: string) => void
  onClearGoto: () => void
  onOpen: (result: SearchResult) => void
}

export function SearchResultsDoc({
  repoPath,
  results,
  requirements,
  tests,
  campaigns,
  regex,
  gotoId,
  gotoSeq,
  onGoto,
  onClearGoto,
  onOpen,
}: Props) {
  const { data: schema } = useProjectSchema(repoPath)
  const containerRef = useRef<HTMLDivElement>(null)
  useScrollToNode(containerRef, gotoId, gotoSeq)

  const reqById = useMemo(() => new Map(requirements.map((r) => [r.id, r])), [requirements])
  const testById = useMemo(() => new Map(tests.map((t) => [t.id, t])), [tests])
  const campById = useMemo(() => new Map(campaigns.map((c) => [c.id, c])), [campaigns])

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClearGoto() }}
    >
      <div className="px-6 py-4 space-y-3">
        {results.map((result) => {
          if (result.itemType === 'requirement') {
            const obj = reqById.get(result.id)
            return obj ? (
              <ResultCard
                key={result.id}
                result={result}
                typeDef={getReqTypeDef(schema, obj.objectTypeRef)}
                normalized={normalizeObject(obj)}
                rawFields={obj.fields}
                repoPath={repoPath}
                regex={regex}
                isGoto={gotoId === result.id}
                onGoto={onGoto}
                onOpen={onOpen}
              />
            ) : null
          }
          if (result.itemType === 'test') {
            const obj = testById.get(result.id)
            return obj ? (
              <ResultCard
                key={result.id}
                result={result}
                typeDef={getTestTypeDef(schema, obj.objectTypeRef)}
                normalized={normalizeObject(obj)}
                rawFields={obj.fields}
                steps={(obj.steps ?? []).slice().sort((a, b) => a.order - b.order).map((s) => ({ action: s.action, expectedResult: s.expectedResult }))}
                repoPath={repoPath}
                regex={regex}
                isGoto={gotoId === result.id}
                onGoto={onGoto}
                onOpen={onOpen}
              />
            ) : null
          }
          const camp = campById.get(result.id)
          return camp ? (
            <ResultCard
              key={result.id}
              result={result}
              typeDef={getCampaignTypeDef(schema, camp.objectTypeRef)}
              normalized={{ id: camp.id, title: camp.title, status: camp.status, version: '' }}
              rawFields={camp.fields}
              repoPath={repoPath}
              regex={regex}
              isGoto={gotoId === result.id}
              onGoto={onGoto}
              onOpen={onOpen}
            />
          ) : null
        })}
      </div>
    </div>
  )
}

// ── ResultCard ────────────────────────────────────────────────────────────────

function ResultCard({
  result,
  typeDef,
  normalized,
  rawFields,
  steps,
  repoPath,
  regex,
  isGoto,
  onGoto,
  onOpen,
}: {
  result: SearchResult
  typeDef: ObjectTypeDefinition | undefined
  normalized: Record<string, string>
  rawFields: Record<string, unknown> | undefined
  steps?: { action: string; expectedResult: string }[]
  repoPath: string
  regex: RegExp | null
  isGoto: boolean
  onGoto: (id: string) => void
  onOpen: (result: SearchResult) => void
}) {
  const { t } = useTranslation()

  const badgeCls =
    result.itemType === 'requirement'
      ? CATEGORY_CHART_BG.requirement
      : result.itemType === 'test'
        ? CATEGORY_CHART_BG.test
        : CATEGORY_CHART_BG.campaign
  const badgeLabel =
    result.itemType === 'requirement' ? 'EX' : result.itemType === 'test' ? 'TC' : 'CA'

  const status = normalized['status'] ?? ''
  const version = normalized['version'] ?? ''
  const statusDef = typeDef?.statuses?.find((s) => s.name === status)

  // `fields` peut être absent selon la source (campagne sans champs, index d'exigence…) —
  // même prudence que `normalizeObject` / `SearchContext` (`fields ?? {}`).
  const fields = rawFields ?? {}

  // Champs affichés : ceux du type (ordre du schéma) ; repli sur les clés brutes de
  // `fields` si le type n'est pas résolvable (schéma modifié après coup).
  const fieldRows: { key: string; label: string; type: string; value: string }[] = typeDef
    ? typeDef.fields.map((f) => ({
        key: f.name,
        label: f.label ?? f.name,
        type: f.type,
        value: result.itemType === 'campaign'
          ? stringOf(fields[f.name])
          : (normalized[f.name] ?? stringOf(fields[f.name])),
      }))
    : Object.entries(fields).map(([k, v]) => ({ key: k, label: k, type: 'text', value: stringOf(v) }))

  return (
    <div
      data-node-id={result.id}
      onClick={() => onGoto(result.id)}
      onDoubleClick={() => onOpen(result)}
      className={`border border-edge rounded p-2.5 bg-surface cursor-default ${isGoto ? GOTO_OUTLINE_CLASS : ''}`}
    >
      {/* Header */}
      <div className="flex items-center flex-wrap gap-x-1.5 gap-y-1 mb-1.5">
        <span className={`text-[9px] font-bold text-status-info-fg px-1 py-px rounded shrink-0 ${badgeCls}`}>
          {badgeLabel}
        </span>
        <HighlightedText text={result.id} regex={regex} className="font-mono text-xs text-ink-3" />
        <HighlightedText
          text={normalized['title'] || result.title}
          regex={regex}
          className="text-sm font-semibold text-ink"
        />
        {status && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${getStatusClass(status)}`}>
            {statusDef?.label ?? status}
          </span>
        )}
        {version && <span className="text-[10px] font-mono text-ink-3 shrink-0">v{version}</span>}
      </div>

      {/* Body */}
      <div className="space-y-0.5">
        {fieldRows.length === 0 && (
          <p className="text-xs text-ink-3 italic">{t('search.doc.noField')}</p>
        )}
        {fieldRows.map((row) => (
          <div key={row.key} className="flex items-start gap-2 py-0.5">
            <span className="text-xs text-ink-3 w-28 shrink-0 mt-0.5">{row.label}</span>
            <div className="flex-1 min-w-0 text-sm text-ink">
              {row.value
                ? (row.type === 'richtext'
                    ? <StaticRichTextViewer value={row.value} repoPath={repoPath} highlightRegex={regex ?? undefined} />
                    : (result.itemType === 'requirement' && (row.type === 'text' || row.type === 'textarea')
                        // T171 — une référence de paramètre prime sur la surbrillance de la recherche.
                        ? <ParamRefText text={row.value} fallback={<HighlightedText text={row.value} regex={regex} />} />
                        : <HighlightedText text={row.value} regex={regex} />))
                : <span className="text-ink-3 italic text-xs">—</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Steps (test cases) */}
      {steps !== undefined && steps.length > 0 && (
        <div className="mt-3 pt-3 border-t border-edge">
          <p className="text-xs font-medium text-ink-2 mb-2">{t('system.wordView.stepsHeading')}</p>
          <ol className="space-y-1.5">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm text-ink">
                <span className="text-xs text-ink-3 font-mono shrink-0 mt-0.5">{i + 1}.</span>
                <div className="flex-1 min-w-0">
                  <StaticRichTextViewer value={s.action} repoPath={repoPath} highlightRegex={regex ?? undefined} />
                  {s.expectedResult && (
                    <div className="mt-0.5 pl-2 border-l-2 border-edge">
                      <span className="text-[10px] text-ink-3 uppercase tracking-wide">{t('search.doc.expectedResult')}</span>
                      <StaticRichTextViewer value={s.expectedResult} repoPath={repoPath} highlightRegex={regex ?? undefined} />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

// ── HighlightedText ───────────────────────────────────────────────────────────

function HighlightedText({
  text,
  regex,
  className = 'break-words whitespace-pre-wrap',
}: {
  text: string
  regex: RegExp | null
  className?: string
}): ReactNode {
  if (!regex) return <span className={className}>{text}</span>
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g')
  const parts: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue }
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(
      <mark key={i++} className="bg-status-warning-solid/70 text-inherit rounded-sm px-px not-italic">
        {m[0]}
      </mark>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <span className={className}>{parts}</span>
}

function stringOf(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join(', ')
  return String(v)
}
