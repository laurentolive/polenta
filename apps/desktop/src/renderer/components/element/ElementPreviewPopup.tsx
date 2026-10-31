import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import type { FieldVisibilityPref } from '@polenta/api-client'
import { findSystemNode, type MatrixCell, type ObjectTypeDefinition, type Requirement, type SchemaField, type TestCampaign, type TestCase } from '@polenta/types'
import { api } from '../../api'
import { InPreviewContext, useElementNav, useElementPreviewTarget, type ElementRef } from '../../contexts/ElementNavContext'
import { useProjectSchema } from '../../hooks/useProjectSchema'
import { StaticRichTextViewer } from '../../lib/staticRichText'
import { CATEGORY_CHART_BG } from '../../lib/objectCategoryColors'
import { CoverageBadge } from '../system/CoverageBadge'
import { RevalidationFlag } from '../system/RevalidationFlag'
import { linkColumnLabel, parseLinkColumn } from '../system/linkUtils'
import { ElementLink } from './ElementLink'

/**
 * GH229 — popup d'aperçu d'un élément (specs/GH229.md §5) : une seule à la fois, pilotée par
 * `ElementNavProvider` (survol de 500 ms d'un lien d'élément). En-tête, titre, puis les champs de
 * l'onglet « Popup » du panneau ⚙️ du type (préférence `popup` de l'utilisateur), en lecture seule
 * et affichage dense. Ses propres liens naviguent mais n'ouvrent pas de popup imbriquée.
 */

const WIDTH = 384 // 24rem
const MARGIN = 8

type AnyObject = (Requirement | TestCase | TestCampaign) & { fields?: Record<string, unknown> }

export function ElementPreviewPopup() {
  const nav = useElementNav()
  const target = useElementPreviewTarget()
  const ref = target && nav ? nav.resolve(target.id) : null
  const boxRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null)

  // Placement : sous le lien, au-dessus s'il manque la place ; jamais hors de la fenêtre.
  useLayoutEffect(() => {
    if (!target) { setPos(null); return }
    const a = target.anchor
    const left = Math.max(MARGIN, Math.min(a.left, window.innerWidth - WIDTH - MARGIN))
    const below = window.innerHeight - a.bottom
    setPos(below >= Math.min(260, a.top) ? { left, top: a.bottom + 4 } : { left, bottom: window.innerHeight - a.top + 4 })
  }, [target])

  // Échap et défilement de la page sous-jacente : fermeture.
  const close = nav?.closePreview
  useEffect(() => {
    if (!target || !close) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onScroll = (e: Event) => {
      if (boxRef.current && e.target instanceof Node && boxRef.current.contains(e.target)) return
      close()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [target, close])

  if (!nav || !target || !ref || !pos) return null
  return createPortal(
    <div
      ref={boxRef}
      data-testid="element-preview"
      data-element-preview={ref.id}
      className="fixed z-[70] bg-surface border border-edge rounded-md shadow-xl text-ink overflow-auto max-h-[50vh]"
      style={{ width: WIDTH, left: pos.left, top: pos.top, bottom: pos.bottom }}
      onPointerEnter={nav.holdPreview}
      onPointerLeave={nav.leave}
    >
      <InPreviewContext.Provider value={true}>
        <PreviewBody target={ref} />
      </InPreviewContext.Provider>
    </div>,
    document.body,
  )
}

function PreviewBody({ target }: { target: ElementRef }) {
  const { t } = useTranslation()
  const nav = useElementNav()!
  const { repoPath, id, category } = target
  const { data: obj, isPending, isError } = useQuery({
    queryKey: ['element-preview', repoPath, id],
    queryFn: (): Promise<AnyObject> =>
      category === 'campaign' ? api.campaigns.get(repoPath, id)
        : category === 'test' ? api.tests.get(repoPath, id)
        : api.requirements.get(repoPath, id),
    staleTime: 5_000,
  })
  const { data: schema } = useProjectSchema(repoPath)
  const [nodeName, typeName] = target.objectTypeRef.split('::')
  const typeDef = schema ? findSystemNode(schema.nodes, nodeName)?.objectTypes?.find(t => t.name === typeName) : undefined
  const fields = usePopupFields(repoPath, target.objectTypeRef, category !== 'campaign')
  const statusLabel = typeDef?.statuses?.find(s => s.name === target.status)?.label ?? target.status
  const otherRepo = !!target.repoLabel && target.repoPath !== nav.workspace.rootRepoPath

  return (
    <div className="p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={`inline-block w-2 h-2 rounded-full ${CATEGORY_CHART_BG[category]}`} style={typeDef?.color ? { background: typeDef.color } : undefined} />
        <span className="font-mono font-semibold" data-testid="element-preview-id">{id}</span>
        {target.displayId !== id && <span className="font-mono text-ink-2">{target.displayId}</span>}
        <span className="text-ink-3">{typeDef?.label ?? typeDef?.name ?? target.objectTypeRef}</span>
        <span className="px-1 rounded bg-status-neutral-bg text-status-neutral">{statusLabel}</span>
        {otherRepo && <span className="text-[10px] text-ink-3 border border-edge rounded px-1">{target.repoLabel}</span>}
        <RevalidationFlag show={!!(obj as Requirement | undefined)?.needsRevalidation} />
      </div>
      <p className="text-sm font-medium leading-snug" data-testid="element-preview-title">{obj?.title ?? target.title}</p>
      {isPending && <div className="space-y-1" aria-busy="true"><div className="h-2 bg-hover rounded w-3/4" /><div className="h-2 bg-hover rounded w-1/2" /></div>}
      {isError && <p className="text-xs text-status-danger">{t('system.preview.notFound')}</p>}
      {obj && category === 'campaign' && (
        <p className="text-xs text-ink-2">{t('system.preview.campaignTests', { count: (obj as TestCampaign).testCaseIds?.length ?? 0 })}</p>
      )}
      {obj && category !== 'campaign' && fields.map(key => (
        <PreviewField key={key} fieldKey={key} obj={obj} target={target} typeDef={typeDef} />
      ))}
    </div>
  )
}

/** Champs de l'onglet « Popup » du type pour l'utilisateur du repo (défaut : aucun). */
function usePopupFields(repoPath: string, typeKey: string, enabled: boolean): string[] {
  const { data: login, isPending: loginPending } = useQuery({
    queryKey: ['project-username', repoPath],
    queryFn: () => api.auth.projectUsername(repoPath),
    enabled: enabled && !!repoPath,
    retry: false,
  })
  const username = login ?? 'local'
  const { data: prefs } = useQuery({
    queryKey: ['pref-visibility', repoPath, username, typeKey],
    queryFn: (): Promise<FieldVisibilityPref | null> => api.pref.getFieldVisibility(repoPath, username, typeKey),
    enabled: enabled && !!repoPath && !loginPending,
  })
  return prefs?.popup ?? []
}

function PreviewField({ fieldKey, obj, target, typeDef }: {
  fieldKey: string
  obj: AnyObject
  target: ElementRef
  typeDef: ObjectTypeDefinition | undefined
}) {
  const { t } = useTranslation()
  const nav = useElementNav()!
  const linkCol = parseLinkColumn(fieldKey)
  if (linkCol) {
    const lt = nav.workspace.linkTypes.find(l => l.name === linkCol.typeName)
    const peers = (nav.workspace.linksByObjectId.get(target.id) ?? [])
      .filter(l => l.type === linkCol.typeName)
      .filter(l => linkCol.direction === 'both' || (linkCol.direction === 'out' ? l.sourceId === target.id : l.targetId === target.id))
      .map(l => (l.sourceId === target.id ? l.targetId : l.sourceId))
    if (peers.length === 0) return null
    const label = lt ? linkColumnLabel(lt, linkCol.direction, target.objectTypeRef, target.category) : linkCol.typeName
    return (
      <Row label={label || linkCol.typeName}>
        {peers.map((p, i) => <span key={p}>{i > 0 && ', '}<ElementLink id={p} className="font-mono" /></span>)}
      </Row>
    )
  }
  if (fieldKey === 'coverageStatus') return target.category === 'requirement' ? <CoverageRow target={target} /> : null
  if (fieldKey === 'steps') {
    const steps = (obj as TestCase).steps ?? []
    if (steps.length === 0) return null
    return (
      <Row label={t('system.wordView.stepsHeading')}>
        <ol className="list-decimal pl-4 space-y-0.5">
          {steps.map((s, i) => <li key={i}>{s.action}{s.expectedResult ? <span className="text-ink-3"> → {s.expectedResult}</span> : null}</li>)}
        </ol>
      </Row>
    )
  }
  const system = systemValue(fieldKey, obj)
  if (system !== undefined) {
    return system ? <Row label={systemLabel(t, fieldKey)}>{system}</Row> : null
  }
  const def = typeDef?.fields.find(f => f.name === fieldKey)
  const raw = obj.fields?.[fieldKey]
  const rendered = renderValue(raw, def, target.repoPath)
  if (rendered === null) return null
  return <Row label={def?.label ?? fieldKey}>{rendered}</Row>
}

function CoverageRow({ target }: { target: ElementRef }) {
  const { t } = useTranslation()
  const nav = useElementNav()!
  const wsDir = nav.workspace.workspaceDir
  const { data: matrix } = useQuery({
    queryKey: ['traceability-matrix', target.repoPath, wsDir],
    queryFn: () => api.traceability.matrix(target.repoPath, {}, wsDir),
  })
  const row = matrix?.requirements.find(r => r.requirement.id === target.id)
  if (!row) return null
  const testsById = new Map<string, TestCase>()
  for (const o of nav.workspace.objects) if (o.category === 'test') testsById.set(o.id, { id: o.id, title: o.title } as TestCase)
  return (
    <Row label={t('system.fieldConfig.colCoverage')}>
      <CoverageBadge coverage={{ coverageStatus: row.coverageStatus, cells: row.cells as MatrixCell[] }} testsById={testsById} />
    </Row>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-ink-3 leading-tight">{label}</p>
      <div className="text-xs text-ink break-words">{children}</div>
    </div>
  )
}

/** Valeur d'un champ système (`undefined` : pas un champ système). */
function systemValue(key: string, obj: AnyObject): string | undefined {
  const o = obj as Partial<Requirement>
  switch (key) {
    case 'createdAt': return formatDate(o.createdAt)
    case 'updatedAt': return formatDate(o.updatedAt)
    case 'author': return o.createdBy ?? ''
    case 'version': return o.version !== undefined ? String(o.version) : ''
    default: return undefined
  }
}

function systemLabel(t: (k: string) => string, key: string): string {
  const keys: Record<string, string> = {
    createdAt: 'system.fieldConfig.colCreatedAt', updatedAt: 'system.fieldConfig.colUpdatedAt',
    author: 'system.fieldConfig.colAuthor', version: 'system.wordView.colVersion',
  }
  return t(keys[key] ?? key)
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

function renderValue(raw: unknown, def: SchemaField | undefined, repoPath: string): ReactNode | null {
  if (raw === undefined || raw === null || raw === '') return null
  if (Array.isArray(raw)) return raw.length > 0 ? raw.map(String).join(', ') : null
  if (def?.type === 'richtext' && typeof raw === 'string') {
    return raw.trim() ? <StaticRichTextViewer value={raw} repoPath={repoPath} variant="compact" /> : null
  }
  if (typeof raw === 'boolean') return raw ? '✓' : '✗'
  if (typeof raw === 'object') return JSON.stringify(raw)
  const text = String(raw)
  return text.trim() ? <span className="whitespace-pre-wrap">{text}</span> : null
}
