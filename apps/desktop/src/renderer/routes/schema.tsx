import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { useProjectSchema } from '../hooks/useProjectSchema'
import { useVersioning } from '../contexts/VersioningContext'
import { decodeProjectId } from '../lib/projectId'
import { StructureTab } from '../components/schema/StructureTab'
import { ConfirmDelete, CancelConfirmModal } from '../components/schema/objectTypeEditor'
import { ViewHeader } from '../components/layout/ViewHeader'
import { useRegisterTabDirty, useTabs } from '../contexts/TabsContext'
import type {
  ProjectSchema,
  LinkTypeDefinition,
  SystemNode,
  RoleDefinition,
  ImplementsDeclaration,
} from '@polenta/types'
import { flattenSystemNodes } from '@polenta/types'

export const Route = createFileRoute('/schema')({
  component: SchemaEditorPage,
  validateSearch: (search: Record<string, unknown>) => ({
    repoPath: (search['repoPath'] as string) ?? '',
    projectId: (search['projectId'] as string) ?? '',
  }),
})

// ── Editable state types ──────────────────────────────────────────────────────
// Only Liens (linkTypes) is edited through this deferred draft + explicit "Enregistrer" flow.
// `roles`/`implements` (T110) are edited from the Structure tab's dependency edit popup and from
// EditView's `roles` field — kept here only as a pass-through so saving Liens never clobbers them
// (round-tripped unchanged, cf. schemaToEditable/editableToSchema below). The Structure tab
// persists its own changes (object types) immediately via api.schema.save, and always reads/writes
// the live schema.nodes — see StructureTab.tsx.

interface EditableLinkType {
  name: string; labelSourceToTarget: string; labelTargetToSource: string; sourceRefs: string[]; targetRefs: string[]
}

interface EditorState {
  linkTypes: EditableLinkType[]
  /** Role declarations for interface repos — edited in Structure (T110), round-tripped here. */
  roles: RoleDefinition[]
  /** Implements declarations for component repos — edited in Structure (T110), round-tripped here. */
  implements: ImplementsDeclaration[]
}

// ── Converters ────────────────────────────────────────────────────────────────

function schemaToEditable(schema: ProjectSchema): EditorState {
  return {
    linkTypes: (schema.linkTypes ?? []).map(l => ({
      name: l.name,
      labelSourceToTarget: l.labelSourceToTarget ?? '',
      labelTargetToSource: l.labelTargetToSource ?? '',
      sourceRefs: l.sourceRefs ?? [], targetRefs: l.targetRefs ?? [],
    })),
    roles: schema.roles ?? [],
    // Rebuild explicitly rather than passing the parsed YAML array through as-is —
    // schema.yaml written before T71 may still carry a stale `version` key on each
    // entry, which we don't want silently round-tripped back to disk on next save.
    implements: (schema.implements ?? []).map(i => ({ interface: i.interface, roles: i.roles })),
  }
}

/**
 * `nodes` is always the live schema.nodes — Structure tab owns writes to it, this page never
 * edits it. `preferences` is likewise owned elsewhere (sidebar Projet panel, T95) — passed
 * through unchanged so a save from this page never clobbers it.
 */
function editableToSchema(state: EditorState, nodes: SystemNode[], preferences: ProjectSchema['preferences']): ProjectSchema {
  const schema: ProjectSchema = {
    version: 1,
    nodes,
    linkTypes: state.linkTypes.map(l => {
      const result: LinkTypeDefinition = {
        name: l.name,
        labelSourceToTarget: l.labelSourceToTarget,
        labelTargetToSource: l.labelTargetToSource,
      }
      if (l.sourceRefs.length > 0) result.sourceRefs = l.sourceRefs
      if (l.targetRefs.length > 0) result.targetRefs = l.targetRefs
      return result
    }),
  }
  if (state.roles.length > 0) schema.roles = state.roles
  if (state.implements.length > 0) schema.implements = state.implements
  if (preferences) schema.preferences = preferences
  return schema
}

// Collect all available refs for link type selectors — flattened so local components
// nested at any depth (T123) contribute their object types too, not just top-level nodes.
function getAllRefs(nodes: SystemNode[]): string[] {
  const refs = ['requirement', 'test', 'campaign']
  for (const { node } of flattenSystemNodes(nodes)) {
    for (const ot of node.objectTypes ?? []) {
      if (ot.name) refs.push(`${node.name}::${ot.name}`)
    }
  }
  return refs
}

// ── Tab: Liens ────────────────────────────────────────────────────────────────

function RefChips({ refs, allRefs, onChange }: {
  refs: string[]; allRefs: string[]; onChange: (refs: string[]) => void
}) {
  const toggle = (ref: string) => {
    if (refs.includes(ref)) onChange(refs.filter(r => r !== ref))
    else onChange([...refs, ref])
  }
  return (
    <div className="flex flex-wrap gap-1">
      {allRefs.map(ref => (
        <button key={ref} type="button" onClick={() => toggle(ref)}
          className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${
            refs.includes(ref)
              ? 'bg-status-info-bg border-status-info-border text-status-info'
              : 'border-edge text-ink-3 hover:border-ink-2 hover:text-ink'
          }`}>
          {ref}
        </button>
      ))}
    </div>
  )
}

function LiensTab({ state, setState, nodes }: {
  state: EditorState; setState: React.Dispatch<React.SetStateAction<EditorState | null>>; nodes: SystemNode[]
}) {
  const { t } = useTranslation()
  const allRefs = getAllRefs(nodes)

  const setLink = (i: number, patch: Partial<EditableLinkType>) =>
    setState(s => s ? { ...s, linkTypes: s.linkTypes.map((l, j) => j === i ? { ...l, ...patch } : l) } : s)
  const deleteLink = (i: number) =>
    setState(s => s ? { ...s, linkTypes: s.linkTypes.filter((_, j) => j !== i) } : s)

  return (
    <div>
      {state.linkTypes.length > 0 && (
        <div className="space-y-2 mb-3">
          {state.linkTypes.map((l, i) => (
            <div key={i} className="border border-edge rounded p-3 bg-surface">
              <div className="grid grid-cols-3 gap-3 mb-2">
                <div>
                  <label className="block text-xs text-ink-2 mb-0.5">{t('schema.page.linkNameId')}</label>
                  <input value={l.name} onChange={e => setLink(i, { name: e.target.value })}
                    className="input-field w-full font-mono text-xs py-1" placeholder="verifies" />
                </div>
                <div>
                  <label className="block text-xs text-ink-2 mb-0.5">{t('schema.page.linkLabelSourceToTarget')}</label>
                  <input value={l.labelSourceToTarget} onChange={e => setLink(i, { labelSourceToTarget: e.target.value })}
                    className="input-field w-full text-xs py-1" placeholder="est vérifié par" />
                </div>
                <div>
                  <label className="block text-xs text-ink-2 mb-0.5">{t('schema.page.linkLabelTargetToSource')}</label>
                  <input value={l.labelTargetToSource} onChange={e => setLink(i, { labelTargetToSource: e.target.value })}
                    className="input-field w-full text-xs py-1" placeholder="vérifie" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-ink-2 mb-1">{t('schema.page.sources')}</label>
                  <RefChips refs={l.sourceRefs} allRefs={allRefs} onChange={sourceRefs => setLink(i, { sourceRefs })} />
                </div>
                <div>
                  <label className="block text-xs text-ink-2 mb-1">{t('schema.page.targets')}</label>
                  <RefChips refs={l.targetRefs} allRefs={allRefs} onChange={targetRefs => setLink(i, { targetRefs })} />
                </div>
              </div>
              <div className="flex justify-end mt-2">
                <ConfirmDelete onConfirm={() => deleteLink(i)} className="text-xs text-status-danger hover:opacity-80" />
              </div>
            </div>
          ))}
        </div>
      )}
      <button type="button"
        onClick={() => setState(s => s ? { ...s, linkTypes: [...s.linkTypes, { name: '', labelSourceToTarget: '', labelTargetToSource: '', sourceRefs: [], targetRefs: [] }] } : s)}
        className="text-sm text-status-info hover:underline">
        {t('schema.page.addLinkType')}
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = 'structure' | 'liens'

function SchemaEditorPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { repoPath: repoPathParam, projectId } = Route.useSearch()
  const workspaceDir = projectId ? decodeProjectId(projectId) : repoPathParam

  // /schema is the default landing page for a project (T86) — some entry points (ActivityBar,
  // cold-start restore, "Récents"…) only know the encoded `projectId`, not its resolved
  // `repoPath` yet. VersioningContext already resolves the same projectId → repoPath mapping for
  // the whole app chrome (AppLayout mounts it whenever a project is open) — reuse it instead of a
  // second, independent resolution.
  const { repoPath: contextRepoPath } = useVersioning()
  const repoPath = repoPathParam || contextRepoPath

  useEffect(() => {
    if (workspaceDir) api.workspace.markRecent(workspaceDir)
  }, [workspaceDir])

  const { data: schema, isLoading } = useProjectSchema(repoPath)
  const [state, setState] = useState<EditorState | null>(null)
  const [savedState, setSavedState] = useState<EditorState | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('structure')
  const [saved, setSaved] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  useEffect(() => {
    if (schema && !state) {
      const editable = schemaToEditable(schema)
      setState(editable)
      setSavedState(editable)
    }
  }, [schema, state])

  const isDirty = savedState !== null && JSON.stringify(state) !== JSON.stringify(savedState)
  useRegisterTabDirty(isDirty)
  const { pendingCloseId } = useTabs()

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!state || !schema) throw new Error('no state')
      return api.schema.save(repoPath, editableToSchema(state, schema.nodes, schema.preferences))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schema', repoPath] })
      setSavedState(state)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // The tab-close confirmation (ConfirmCloseTabModal) already owns this Escape press —
        // without this guard, closing a dirty tab via Ctrl+W/croix would stack this view's own
        // CancelConfirmModal on top of it the moment the user tries to dismiss with Escape.
        if (pendingCloseId) return
        if (showCancelConfirm) { setShowCancelConfirm(false); return }
        if (isDirty) setShowCancelConfirm(true)
      }
      if (e.key === 'Enter' && !showCancelConfirm) {
        if (document.activeElement?.closest('.fixed.inset-0')) return
        if (isDirty && !saveMutation.isPending) saveMutation.mutate()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isDirty, showCancelConfirm, saveMutation, pendingCloseId])

  if (isLoading || !state || !schema) {
    return <div className="text-sm text-ink-3 p-4">{t('schema.page.loading')}</div>
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'structure', label: t('schema.page.tabStructure') },
    { key: 'liens', label: t('schema.page.tabLinks') },
  ]

  function handleCancelConfirmed() {
    setState(savedState)
    setShowCancelConfirm(false)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {showCancelConfirm && (
        <CancelConfirmModal onConfirm={handleCancelConfirmed} onClose={() => setShowCancelConfirm(false)} />
      )}
      <ViewHeader
        currentProjectId={projectId}
        title={
          <>
            {t('schema.page.title')}{isDirty && <span className="text-status-warning ml-1">*</span>}
          </>
        }
        actions={
          <>
            {saved && <span className="text-xs text-status-success">✓ {t('schema.page.saved')}</span>}
            {saveMutation.isError && (
              <span className="text-xs text-status-danger">
                {saveMutation.error instanceof Error ? saveMutation.error.message : t('schema.page.error')}
              </span>
            )}
            {isDirty && (
              <button
                type="button"
                onClick={() => setShowCancelConfirm(true)}
                className="btn-secondary-sm"
              >
                {t('common.cancel')}
              </button>
            )}
            {isDirty && (
              <button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
                className="btn-primary-sm">
                {saveMutation.isPending ? t('schema.page.saving') : t('common.save')}
              </button>
            )}
          </>
        }
      />

      <div className="flex-1 overflow-y-auto">
      <div className={activeTab === 'structure' ? 'max-w-3xl p-6' : 'max-w-4xl p-6'}>
      {/* Tabs */}
      <div className="flex gap-1 border-b border-edge mb-6">
        {TABS.map(tab => (
          <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm transition-colors -mb-px border-b-2 ${
              activeTab === tab.key
                ? 'border-ink font-medium text-ink'
                : 'border-transparent text-ink-2 hover:text-ink'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'structure' && <StructureTab workspaceDir={workspaceDir} repoPath={repoPath} projectId={projectId} />}
      {activeTab === 'liens' && <LiensTab state={state} setState={setState} nodes={schema.nodes} />}
      </div>
      </div>
    </div>
  )
}
