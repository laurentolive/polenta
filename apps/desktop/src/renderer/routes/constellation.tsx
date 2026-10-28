/**
 * ConstellationPage — GH183
 *
 * Vue « Constellation » des exigences : les exigences de plus haut niveau au centre, chacune
 * ouvrant un pétale vers celles qui la raffinent, anneau par anneau. Les courbes sont les liens
 * exigence ↔ exigence, le halo doré la part des exigences terminales couvertes par un test.
 * Survol : la lignée s'allume ; clic : fiche à droite, avec ouverture de l'exigence.
 *
 * Données : objets et liens du workspace (`useWorkspaceLinks`, GH105) et couverture du moteur
 * de traçabilité (`api.traceability.matrix`) — aucun indicateur stocké.
 *
 * URL: /constellation?projectId=<encoded project id>
 */

import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeftRight, ExternalLink, Loader2, Search } from 'lucide-react'
import { flattenSystemNodes, type ObjectTypeDefinition, type Requirement } from '@polenta/types'
import { api } from '../api'
import { ViewHeader } from '../components/layout/ViewHeader'
import { useTabs } from '../contexts/TabsContext'
import { useWorkspaceLinks } from '../hooks/useWorkspaceLinks'
import { useProjectSchema } from '../hooks/useProjectSchema'
import {
  arcPath, buildConstellation, lineage, linkPath, type ConstellationNode,
} from '../lib/constellationLayout'

export const Route = createFileRoute('/constellation')({
  component: ConstellationPage,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
  }),
})

// Le ciel reste sombre dans les deux thèmes : c'est le parti pris visuel de la vue.
const SKY_0 = 'rgb(16 24 44)'
const SKY_1 = 'rgb(9 14 28)'
const SKY_INK = '226 232 240'
const SKY_INK_2 = '148 163 184'
const GLOW = '253 230 138'
const PALETTE = [1, 2, 3, 5, 6, 7, 8, 4].map(i => `rgb(var(--chart-series-${i}))`)
const NODE_R = [12, 7, 4.6, 3.6, 3, 2.6]
const VIEW = 560
const COLOR_BY_TYPE = '__type__'

const hash = (s: string) => {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

// Fond étoilé, fixe d'un rendu à l'autre.
const STARS = Array.from({ length: 140 }, (_, i) => {
  const a = hash(`a${i}`) * Math.PI * 2, d = 60 + hash(`d${i}`) * 500
  return { x: Math.cos(a) * d, y: Math.sin(a) * d, r: 0.5 + hash(`r${i}`) * 1.1, delay: hash(`t${i}`) * 4 }
})

function plainText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Énoncé affiché : le champ `statement`, sinon le premier champ texte renseigné du type. */
function statementOf(req: Requirement | undefined, typeDef: ObjectTypeDefinition | undefined): string {
  if (!req) return ''
  const direct = plainText(req.fields?.['statement'])
  if (direct) return direct
  for (const f of typeDef?.fields ?? []) {
    if (f.type !== 'richtext' && f.type !== 'textarea' && f.type !== 'text') continue
    const v = plainText(req.fields?.[f.name])
    if (v) return v
  }
  return ''
}

function ConstellationPage() {
  const { t } = useTranslation()
  const { projectId } = Route.useSearch()
  const { openTab } = useTabs()
  const ws = useWorkspaceLinks(projectId)
  const repoPath = ws.rootRepoPath
  const { data: schema } = useProjectSchema(repoPath)

  const { data: matrix, isPending: matrixPending } = useQuery({
    queryKey: ['traceability-matrix', repoPath, ws.workspaceDir],
    queryFn: () => api.traceability.matrix(repoPath, {}, ws.workspaceDir),
    enabled: !!repoPath,
  })

  const [childIs, setChildIs] = useState<'source' | 'target'>('source')
  const [colorBy, setColorBy] = useState(COLOR_BY_TYPE)
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set())
  const [disabledLinkTypes, setDisabledLinkTypes] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  const typeDefs = useMemo(() => {
    const map = new Map<string, ObjectTypeDefinition>()
    for (const { node } of flattenSystemNodes(schema?.nodes ?? [])) {
      for (const ot of node.objectTypes ?? []) map.set(`${node.name}::${ot.name}`, ot)
    }
    return map
  }, [schema])

  const reqById = useMemo(() => {
    const map = new Map<string, { requirement: Requirement; covered: boolean; status: string }>()
    for (const row of matrix?.requirements ?? []) {
      map.set(row.requirement.id, { requirement: row.requirement, covered: row.coverageStatus !== 'not_covered', status: row.coverageStatus })
    }
    return map
  }, [matrix])

  const requirements = useMemo(() => {
    // Exigences du workspace (tous repos) ; repli sur la matrice tant que les objets ne sont pas lus.
    const objs = ws.objects.filter(o => o.category === 'requirement')
    if (objs.length) return objs.map(o => ({ id: o.id, title: o.title, objectTypeRef: o.objectTypeRef, status: o.status }))
    return [...reqById.values()].map(({ requirement: r }) => ({ id: r.id, title: r.title, objectTypeRef: r.objectTypeRef, status: r.status }))
  }, [ws.objects, reqById])

  const reqIds = useMemo(() => new Set(requirements.map(r => r.id)), [requirements])

  // Liens exigence ↔ exigence, par type (raffinement, implémentation…).
  const reqLinks = useMemo(
    () => ws.links.filter(l => reqIds.has(l.sourceId) && reqIds.has(l.targetId)),
    [ws.links, reqIds],
  )
  const linkTypeNames = useMemo(() => [...new Set(reqLinks.map(l => l.type))].sort(), [reqLinks])
  const linkTypeDef = (name: string) => ws.linkTypes.find(lt => lt.name === name) ?? schema?.linkTypes.find(lt => lt.name === name)

  const layout = useMemo(() => buildConstellation(
    requirements.map(r => ({ id: r.id, title: r.title, objectTypeRef: r.objectTypeRef, covered: reqById.get(r.id)?.covered ?? false })),
    reqLinks.filter(l => !disabledLinkTypes.has(l.type)),
    { childIs },
  ), [requirements, reqById, reqLinks, disabledLinkTypes, childIs])

  const nodes = useMemo(() => [...layout.nodes.values()], [layout])
  const typeRefs = useMemo(() => [...new Set(nodes.map(n => n.objectTypeRef))]
    .sort((a, b) => Math.min(...nodes.filter(n => n.objectTypeRef === a).map(n => n.ring))
      - Math.min(...nodes.filter(n => n.objectTypeRef === b).map(n => n.ring)) || a.localeCompare(b)), [nodes])
  const typeLabel = (ref: string) => typeDefs.get(ref)?.label ?? typeDefs.get(ref)?.name ?? ref.split('::').pop() ?? ref

  // Champs enum communs aux types d'exigence : candidats pour la couleur (service, domaine…).
  const enumFields = useMemo(() => {
    const map = new Map<string, { label: string; values: string[] }>()
    for (const ref of typeRefs) {
      for (const f of typeDefs.get(ref)?.fields ?? []) {
        if (f.type !== 'enum') continue
        const cur = map.get(f.name)
        map.set(f.name, { label: cur?.label ?? f.label ?? f.name, values: [...new Set([...(cur?.values ?? []), ...(f.values ?? [])])] })
      }
    }
    return map
  }, [typeRefs, typeDefs])

  const groupOf = (n: ConstellationNode): string => {
    if (colorBy === COLOR_BY_TYPE) return n.objectTypeRef
    const v = reqById.get(n.id)?.requirement.fields?.[colorBy]
    return typeof v === 'string' && v ? v : ''
  }
  const groups: string[] = colorBy === COLOR_BY_TYPE
    ? typeRefs
    : [...new Set([...(enumFields.get(colorBy)?.values ?? []), ...nodes.map(groupOf)])].filter(g => nodes.some(n => groupOf(n) === g))
  const groupLabel = (g: string) => colorBy === COLOR_BY_TYPE ? typeLabel(g) : (g || t('constellation.noValue'))
  const colorOf = (n: ConstellationNode) => {
    const i = groups.indexOf(groupOf(n))
    return i >= 0 ? PALETTE[i % PALETTE.length] : `rgb(${SKY_INK_2})`
  }

  const q = query.trim().toLowerCase()
  const visible = (n: ConstellationNode) => !hiddenTypes.has(n.objectTypeRef) && (!q || `${n.id} ${n.title}`.toLowerCase().includes(q))
  const focusId = hovered ?? selected
  const focus = useMemo(() => (focusId && layout.nodes.has(focusId) ? lineage(layout.nodes, focusId) : null), [focusId, layout])

  const leaves = nodes.filter(n => n.children.length === 0)
  const coveredLeaves = leaves.filter(n => n.covered).length
  const notRefined = nodes.filter(n => n.ring > 0 && n.children.length === 0 && n.ring < layout.ringRadii.length - 1).length
  const testCount = matrix?.testCases.length ?? 0

  function openRequirement(id: string) {
    const target = ws.objectsById.get(id)
    openTab(`/req/${id}`, { repoPath: target?.repoPath ?? repoPath, projectId })
  }

  function onHover(n: ConstellationNode | null, ev?: ReactMouseEvent) {
    setHovered(n?.id ?? null)
    if (!n || !ev || !stageRef.current) { setTip(null); return }
    const b = stageRef.current.getBoundingClientRect()
    let x = ev.clientX - b.left + 14
    if (x > b.width - 270) x -= 290
    setTip({ x, y: ev.clientY - b.top + 14 })
  }

  const loading = !repoPath || matrixPending || ws.linksPending

  const kpis: { value: string | number; label: string; warn?: boolean }[] = [
    { value: nodes.length, label: typeRefs.map(r => `${nodes.filter(n => n.objectTypeRef === r).length} ${typeLabel(r)}`).join(' · ') || t('constellation.kpi.requirements') },
    { value: layout.links.length, label: t('constellation.kpi.links') },
    { value: notRefined, label: t('constellation.kpi.notRefined'), warn: notRefined > 0 },
    { value: `${leaves.length ? Math.round(100 * coveredLeaves / leaves.length) : 0} %`, label: t('constellation.kpi.coverage'), warn: coveredLeaves === 0 },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader currentProjectId={projectId} title={t('constellation.title')} subtitle={t('constellation.subtitle')} />
      <style>{`
        @keyframes cst-tw { 0%,100% { opacity: .25 } 50% { opacity: .9 } }
        .cst-star { animation: cst-tw 4s ease-in-out infinite }
        .cst-node { cursor: pointer; outline: none }
        .cst-node:focus-visible .cst-core { stroke: rgb(${GLOW}); stroke-width: 2.5 }
        .cst-dim { opacity: .12; transition: opacity .25s }
        @media (prefers-reduced-motion: reduce) { .cst-star { animation: none } }
      `}</style>

      <div className="flex-1 overflow-auto p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {kpis.map(k => (
            <div key={k.label} className="border border-edge bg-surface rounded-lg px-3 py-2 min-w-[112px]">
              <div className={`text-lg font-semibold tabular-nums ${k.warn ? 'text-status-danger' : 'text-ink'}`}>{k.value}</div>
              <div className="text-xs text-ink-2">{k.label}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('constellation.searchPlaceholder')}
              aria-label={t('constellation.searchPlaceholder')}
              className="input-field pl-7 py-1 text-xs w-52"
            />
          </label>
          <span className="w-px h-5 bg-edge" />
          {groups.map(g => {
            const count = nodes.filter(n => groupOf(n) === g).length
            const isType = colorBy === COLOR_BY_TYPE
            const off = isType && hiddenTypes.has(g)
            return (
              <button
                key={g || '∅'}
                type="button"
                aria-pressed={isType ? !off : undefined}
                disabled={!isType}
                onClick={() => setHiddenTypes(prev => { const next = new Set(prev); next.has(g) ? next.delete(g) : next.add(g); return next })}
                className={`inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface px-2.5 py-1 text-xs text-ink-2 ${off ? 'opacity-45' : ''} ${isType ? '' : 'cursor-default'}`}
              >
                <i className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: PALETTE[groups.indexOf(g) % PALETTE.length] }} />
                {groupLabel(g)} <span className="text-ink-3">{count}</span>
              </button>
            )
          })}
          <span className="w-px h-5 bg-edge" />
          <label className="flex items-center gap-1.5 text-xs text-ink-2">
            {t('constellation.colorBy')}
            <select value={colorBy} onChange={e => setColorBy(e.target.value)} className="input-field px-2 py-1 text-xs">
              <option value={COLOR_BY_TYPE}>{t('constellation.colorByType')}</option>
              {[...enumFields].map(([name, f]) => <option key={name} value={name}>{f.label}</option>)}
            </select>
          </label>
          {linkTypeNames.length > 1 && linkTypeNames.map(name => (
            <label key={name} className="flex items-center gap-1 text-xs text-ink-2">
              <input
                type="checkbox"
                checked={!disabledLinkTypes.has(name)}
                onChange={() => setDisabledLinkTypes(prev => { const next = new Set(prev); next.has(name) ? next.delete(name) : next.add(name); return next })}
              />
              {name}
            </label>
          ))}
          <button
            type="button"
            className="btn-secondary-sm inline-flex items-center gap-1"
            title={t('constellation.reverseHint')}
            onClick={() => setChildIs(c => (c === 'source' ? 'target' : 'source'))}
          >
            <ArrowLeftRight size={12} />
            {t('constellation.reverse')}
          </button>
        </div>

        <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div
            ref={stageRef}
            className="relative rounded-xl overflow-hidden min-w-0"
            style={{ background: `radial-gradient(120% 90% at 50% 45%, ${SKY_0}, ${SKY_1})` }}
          >
            {loading ? (
              <div className="flex items-center justify-center gap-2 h-96 text-xs" style={{ color: `rgb(${SKY_INK_2})` }}>
                <Loader2 size={14} className="animate-spin" />
                {t('common.loading')}
              </div>
            ) : nodes.length === 0 ? (
              <div className="flex items-center justify-center h-96 text-sm" style={{ color: `rgb(${SKY_INK_2})` }}>
                {t('constellation.empty')}
              </div>
            ) : (
              <svg
                viewBox={`${-VIEW} ${-VIEW} ${VIEW * 2} ${VIEW * 2}`}
                role="img"
                aria-label={t('constellation.ariaLabel')}
                className="block w-full h-auto max-h-[80vh]"
                onClick={e => { if (e.target === e.currentTarget) setSelected(null) }}
              >
                <g>
                  {STARS.map((s, i) => (
                    <circle key={i} cx={s.x} cy={s.y} r={s.r} fill={`rgb(${SKY_INK})`} className="cst-star" style={{ animationDelay: `${s.delay.toFixed(2)}s` }} />
                  ))}
                </g>
                <g>
                  {layout.ringRadii.map(r => (
                    <circle key={r} r={r} fill="none" stroke={`rgb(${SKY_INK} / .07)`} strokeDasharray="1 6" />
                  ))}
                </g>
                <Petals layout={layout} colorOf={colorOf} focus={focus} />
                <g>
                  {layout.links.map(l => {
                    const child = layout.nodes.get(childIs === 'source' ? l.sourceId : l.targetId)!
                    const parent = layout.nodes.get(childIs === 'source' ? l.targetId : l.sourceId)!
                    const on = focus ? focus.has(child.id) && focus.has(parent.id) : visible(child) && visible(parent)
                    return (
                      <path
                        key={l.id}
                        d={linkPath(parent, child)}
                        fill="none"
                        strokeLinecap="round"
                        stroke={colorOf(layout.nodes.get(parent.root) ?? parent)}
                        strokeWidth={parent.ring === 0 ? 1.3 : 0.9}
                        opacity={focus && on ? 0.95 : 0.45}
                        className={on ? undefined : 'cst-dim'}
                      />
                    )
                  })}
                </g>
                <g>
                  {nodes.map(n => (
                    <StarNode
                      key={n.id}
                      node={n}
                      color={colorOf(n)}
                      selected={n.id === selected}
                      dim={!visible(n) || (!!focus && !focus.has(n.id))}
                      onHover={onHover}
                      onSelect={setSelected}
                    />
                  ))}
                </g>
              </svg>
            )}
            {!loading && nodes.length > 0 && (
              <div className="absolute bottom-3 left-3 right-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] pointer-events-none" style={{ color: `rgb(${SKY_INK_2})` }}>
                <span className="inline-flex items-center gap-1.5">
                  <svg viewBox="-9 -9 18 18" width={18} height={18}><circle r={6.5} fill="none" stroke={`rgb(${GLOW})`} strokeWidth={2} /></svg>
                  {t('constellation.legend.halo')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <svg viewBox="-9 -9 18 18" width={18} height={18}><circle r={6.5} fill="none" stroke={`rgb(${SKY_INK_2})`} strokeDasharray="2 2" /></svg>
                  {t('constellation.legend.uncovered')}
                </span>
                <span>{t('constellation.legend.rings')}</span>
              </div>
            )}
            {hovered && tip && layout.nodes.get(hovered) && (
              <div
                className="absolute pointer-events-none bg-surface text-ink border border-edge rounded-md px-2 py-1.5 text-xs max-w-[260px] shadow-lg"
                style={{ left: tip.x, top: tip.y }}
              >
                <span className="font-mono text-[11px] text-ink-2 mr-1.5">{hovered}</span>
                {layout.nodes.get(hovered)!.title}
              </div>
            )}
          </div>

          <aside className="bg-surface border border-edge rounded-xl p-4 space-y-3 self-start min-w-0" aria-live="polite">
            {selected && layout.nodes.has(selected) ? (
              <NodeCard
                node={layout.nodes.get(selected)!}
                layout={layout}
                childIs={childIs}
                requirement={reqById.get(selected)?.requirement}
                coverageStatus={reqById.get(selected)?.status}
                typeDef={typeDefs.get(layout.nodes.get(selected)!.objectTypeRef)}
                typeLabel={typeLabel}
                linkLabel={(name, asSource) => {
                  const def = linkTypeDef(name)
                  return (asSource ? def?.labelSourceToTarget : def?.labelTargetToSource) ?? name
                }}
                color={colorOf(layout.nodes.get(selected)!)}
                onGo={setSelected}
                onOpen={openRequirement}
              />
            ) : (
              <Overview
                nodes={nodes}
                linkCount={layout.links.length}
                notRefined={notRefined}
                uncoveredLeaves={leaves.length - coveredLeaves}
                testCount={testCount}
                roots={layout.petals.map(p => layout.nodes.get(p.rootId)!)}
                onGo={setSelected}
              />
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

function Petals({ layout, colorOf, focus }: {
  layout: ReturnType<typeof buildConstellation>
  colorOf: (n: ConstellationNode) => string
  focus: Set<string> | null
}) {
  const outer = layout.ringRadii[layout.ringRadii.length - 1] + 42
  return (
    <g>
      {layout.petals.map((p, i) => {
        const root = layout.nodes.get(p.rootId)!
        const mid = (p.start + p.end) / 2
        const flip = Math.sin(mid) > 0.05 // en bas du cercle, le texte suit l'arc à l'envers
        const dim = !!focus && !focus.has(p.rootId)
        const fits = (p.end - p.start) * outer >= root.title.length * 6.4
        return (
          <g key={p.rootId} className={dim ? 'cst-dim' : undefined}>
            <path d={arcPath(outer, p.start, p.end)} stroke={colorOf(root)} strokeWidth={3} strokeLinecap="round" fill="none" opacity={0.7} />
            {fits && (
              <>
                <path id={`cst-tp-${i}`} fill="none" d={arcPath(flip ? outer + 24 : outer + 12, p.start, p.end, flip)} />
                <text fontSize={13} fill={`rgb(${SKY_INK_2})`} fontStyle="italic" style={{ fontFamily: 'Georgia, serif' }}>
                  <textPath href={`#cst-tp-${i}`} startOffset="50%" textAnchor="middle">{root.title}</textPath>
                </text>
              </>
            )}
          </g>
        )
      })}
    </g>
  )
}

function StarNode({ node: n, color, selected, dim, onHover, onSelect }: {
  node: ConstellationNode
  color: string
  selected: boolean
  dim: boolean
  onHover: (n: ConstellationNode | null, ev?: ReactMouseEvent) => void
  onSelect: (id: string) => void
}) {
  const r = NODE_R[Math.min(n.ring, NODE_R.length - 1)] * (selected ? 1.5 : 1)
  const haloR = r + 4
  const share = n.leaves ? n.leavesCovered / n.leaves : 0
  const c = 2 * Math.PI * haloR
  return (
    <g
      className={`cst-node${dim ? ' cst-dim' : ''}`}
      transform={`translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`}
      tabIndex={0}
      role="button"
      aria-label={`${n.id} ${n.title}`}
      onMouseEnter={ev => onHover(n, ev)}
      onMouseMove={ev => onHover(n, ev)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(n.id)}
      onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(n.id) } }}
    >
      <circle r={r + 9} fill="transparent" />
      {share > 0 ? (
        <>
          <circle r={r + 7} fill={`rgb(${GLOW})`} opacity={(0.12 * share).toFixed(2)} />
          <circle r={haloR} fill="none" stroke={`rgb(${GLOW})`} strokeWidth={n.ring === 0 ? 3 : 2} strokeDasharray={`${c * share} ${c}`} transform="rotate(-90)" />
        </>
      ) : (
        <circle r={haloR} fill="none" stroke={`rgb(${SKY_INK_2})`} strokeWidth={n.ring === 0 ? 3 : 2} strokeDasharray="2 2.5" opacity={0.55} />
      )}
      <circle className="cst-core" r={r} fill={color} stroke={SKY_1} strokeWidth={1.2} />
      {n.ring === 0 && n.parents.length === 0 && (
        <text y={4} textAnchor="middle" fontSize={7.5} fontFamily="ui-monospace, monospace" fill={SKY_1} pointerEvents="none">
          {n.id.slice(-2)}
        </text>
      )}
    </g>
  )
}

function LinkButtons({ ids, layout, empty, onGo }: {
  ids: string[]
  layout: ReturnType<typeof buildConstellation>
  empty: string
  onGo: (id: string) => void
}) {
  if (!ids.length) return <p className="text-xs italic text-ink-3">{empty}</p>
  return (
    <div className="grid gap-1">
      {ids.map(id => (
        <button
          key={id}
          type="button"
          onClick={() => onGo(id)}
          className="flex items-baseline gap-2 text-left border border-edge rounded-md px-2 py-1.5 text-sm text-ink hover:bg-surface-hover"
        >
          <code className="font-mono text-[11px] text-ink-2 shrink-0">{id}</code>
          <span className="truncate">{layout.nodes.get(id)?.title}</span>
        </button>
      ))}
    </div>
  )
}

function NodeCard({ node: n, layout, childIs, requirement, coverageStatus, typeDef, typeLabel, linkLabel, color, onGo, onOpen }: {
  node: ConstellationNode
  layout: ReturnType<typeof buildConstellation>
  childIs: 'source' | 'target'
  requirement: Requirement | undefined
  coverageStatus: string | undefined
  typeDef: ObjectTypeDefinition | undefined
  typeLabel: (ref: string) => string
  linkLabel: (type: string, asSource: boolean) => string
  color: string
  onGo: (id: string) => void
  onOpen: (id: string) => void
}) {
  const { t } = useTranslation()
  const status = typeDef?.statuses?.find(s => s.name === (requirement?.status ?? ''))
  const statement = statementOf(requirement, typeDef)
  const share = n.leaves ? n.leavesCovered / n.leaves : 0
  // Liens du nœud regroupés par libellé du schéma (« raffine », « est raffinée par »…).
  const groups = new Map<string, string[]>()
  for (const l of layout.links) {
    const asSource = l.sourceId === n.id
    if (!asSource && l.targetId !== n.id) continue
    const label = linkLabel(l.type, asSource)
    const peer = asSource ? l.targetId : l.sourceId
    const list = groups.get(label) ?? []
    if (!list.includes(peer)) list.push(peer)
    groups.set(label, list)
  }
  const parentsLabel = n.parents.length ? null : t('constellation.card.topLevel')
  const childrenLabel = n.children.length ? null : t('constellation.card.notRefined')

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-ink-2">
        {n.id}
        {requirement && (
          <span
            className="font-sans text-[11px] px-2 py-0.5 rounded-full"
            style={status?.color ? { background: status.color, color: '#fff' } : undefined}
          >
            {status?.label ?? requirement.status}
          </span>
        )}
        <span className="font-sans text-[11px] px-2 py-0.5 rounded-full bg-surface-hover" style={{ boxShadow: `inset 3px 0 0 ${color}` }}>
          {typeLabel(n.objectTypeRef)}
        </span>
      </div>
      <h2 className="text-lg font-medium text-ink leading-snug">{n.title}</h2>
      {statement && <p className="text-sm text-ink-2 leading-relaxed">{statement}</p>}

      <p className="section-label">{t('constellation.card.coverage')}</p>
      <div className="h-1.5 rounded bg-surface-hover overflow-hidden">
        <i className="block h-full bg-status-success-solid" style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      <p className="text-xs text-ink-3">
        {t('constellation.card.leavesCovered', { covered: n.leavesCovered, count: n.leaves })}
        {coverageStatus && n.children.length === 0 && ` · ${t(`system.coverage.status.${coverageStatus}`)}`}
      </p>

      {[...groups].map(([label, ids]) => (
        <div key={label} className="space-y-1">
          <p className="section-label">{label}</p>
          <LinkButtons ids={ids.sort()} layout={layout} empty="" onGo={onGo} />
        </div>
      ))}
      {(parentsLabel || childrenLabel) && (
        <p className="text-xs italic text-ink-3">{[parentsLabel, childrenLabel].filter(Boolean).join(' · ')}</p>
      )}
      {childIs === 'target' && <p className="text-xs text-ink-3">{t('constellation.card.reversed')}</p>}

      <button type="button" className="btn-primary-sm inline-flex items-center gap-1.5" onClick={() => onOpen(n.id)}>
        <ExternalLink size={12} />
        {t('constellation.card.open', { id: n.id })}
      </button>
    </>
  )
}

function Overview({ nodes, linkCount, notRefined, uncoveredLeaves, testCount, roots, onGo }: {
  nodes: ConstellationNode[]
  linkCount: number
  notRefined: number
  uncoveredLeaves: number
  testCount: number
  roots: ConstellationNode[]
  onGo: (id: string) => void
}) {
  const { t } = useTranslation()
  const stat = (value: number, label: string) => (
    <div className="flex gap-2 text-sm"><code className="font-mono text-xs text-ink-2 w-8 shrink-0 text-right">{value}</code><span>{label}</span></div>
  )
  return (
    <>
      <p className="font-mono text-xs text-ink-2">{t('constellation.overview.label')}</p>
      <h2 className="text-lg font-medium text-ink leading-snug">
        {t('constellation.overview.title', { count: nodes.length, links: linkCount })}
      </h2>
      <p className="text-sm text-ink-2 leading-relaxed">{t('constellation.overview.help')}</p>
      <p className="section-label">{t('constellation.overview.watch')}</p>
      <div className="grid gap-1">
        {stat(notRefined, t('constellation.overview.notRefined'))}
        {stat(uncoveredLeaves, t('constellation.overview.uncoveredLeaves'))}
        {stat(testCount, t('constellation.overview.tests'))}
      </div>
      <p className="section-label">{t('constellation.overview.petals')}</p>
      <div className="grid gap-1">
        {roots.map(r => (
          <button
            key={r.id}
            type="button"
            onClick={() => onGo(r.id)}
            className="flex items-baseline gap-2 text-left border border-edge rounded-md px-2 py-1.5 text-sm text-ink hover:bg-surface-hover"
          >
            <code className="font-mono text-[11px] text-ink-2 shrink-0">{r.id}</code>
            <span className="truncate">{r.title}</span>
          </button>
        ))}
      </div>
    </>
  )
}
