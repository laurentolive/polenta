import React, { useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Download, FolderOpen, Plus, Sparkles, type LucideIcon } from 'lucide-react'
import { api } from '../api'
import { encodeProjectId } from '../lib/projectId'
import { consumeProjectJustClosed } from '../lib/projectCloseSignal'
import { DEMO_PROJECT_URL } from '../lib/demoProject'
import { TextPromptModal } from '../components/home/TextPromptModal'

export const Route = createFileRoute('/')({
  component: HomePage,
})

// GH27 — the page is a list of action buttons; each one asks only for what it needs, when it
// needs it: folders through the native picker, text (Git URL, project name) through a one-field
// prompt.
type HomeAction = 'demo' | 'open' | 'clone' | 'create'

function HomePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)

  const [busy, setBusy] = useState<HomeAction | null>(null)
  const [error, setError] = useState<{ action: HomeAction; message: string } | null>(null)
  const [prompt, setPrompt] = useState<'clone' | 'create' | null>(null)
  // Synchronous guard against a double click landing before `busy` re-renders the buttons disabled.
  const running = useRef(false)

  useEffect(() => {
    // T105 — this page briefly mounts on every dip through "/" (including "close project", which
    // navigates here on purpose) and previously had no way to tell "user is genuinely landing on
    // the home page" from "user already navigated on, this mount is about to be torn down".
    // Without `cancelled`, a `getLastOpened()` that still resolves to the project the user just
    // closed (or navigated away from) fired a stale `navigate()` here that clobbered whatever the
    // user's own action had already navigated to — the close-project cross bouncing right back
    // into the project, or a freshly created project landing on /dashboard instead of /schema.
    let cancelled = false
    async function init() {
      const hasAccount = await api.auth.hasAnyAccount()
      if (cancelled) return
      if (!hasAccount) { navigate({ to: '/login' }); return }

      // T105 — a deliberate close just ran `clearLastOpened()` a moment ago; trust that over a
      // fresh disk read, which has been observed (under `pnpm dev`, repeated/rapid clicks) to
      // still see the pre-clear value and redirect straight back into the closed project.
      if (consumeProjectJustClosed()) {
        setReady(true)
        return
      }

      const lastOpened = await api.workspace.getLastOpened()
      if (cancelled) return
      if (lastOpened) {
        await navigate({ to: '/dashboard', search: { projectId: encodeProjectId(lastOpened.workspaceDir), dashboardId: undefined } })
        return
      }

      setReady(true)
    }
    init()
    return () => { cancelled = true }
  }, [navigate])

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-ink-3 text-sm">
        {t('common.loading')}
      </div>
    )
  }

  async function goToProject(workspaceDir: string) {
    await api.workspace.markRecent(workspaceDir)
    await navigate({ to: '/schema', search: { repoPath: '', projectId: encodeProjectId(workspaceDir) } })
  }

  /** Runs one action: `op` returns the project folder to open, or null if the user cancelled. */
  async function run(action: HomeAction, op: () => Promise<string | null>) {
    if (running.current) return
    running.current = true
    setBusy(action)
    setError(null)
    try {
      const dir = await op()
      if (dir) await goToProject(dir)
    } catch (err) {
      setError({ action, message: err instanceof Error ? err.message : String(err) })
    } finally {
      running.current = false
      setBusy(null)
    }
  }

  const handleDemo = () => run('demo', async () => {
    const dir = await api.dialog.pickFolder(t('home.pickDemoFolder'))
    if (!dir) return null
    if (await api.workspace.detect(dir) === 'workspace') {
      await api.workspace.openProject(dir)
      return dir
    }
    if (!(await api.workspace.isEmptyDir(dir))) throw new Error(t('home.demoFolderNotEmpty'))
    await api.workspace.createFromClone(dir, DEMO_PROJECT_URL)
    return dir
  })

  const handleOpen = () => run('open', async () => {
    const dir = await api.dialog.pickFolder(t('home.pickProjectFolder'))
    if (!dir) return null
    const result = await api.workspace.openProject(dir)
    if (result.status === 'not-a-workspace') throw new Error(t('home.notAWorkspace'))
    return dir
  })

  const handleCloneUrl = (url: string) => {
    setPrompt(null)
    run('clone', async () => {
      const dir = await api.dialog.pickFolder(t('home.pickDestinationFolder'))
      if (!dir) return null
      await api.workspace.createFromClone(dir, url)
      return dir
    })
  }

  const handleCreateName = (name: string) => {
    setPrompt(null)
    run('create', async () => {
      const dir = await api.dialog.pickFolder(t('home.pickDestinationFolder'))
      if (!dir) return null
      await api.workspace.createNew(dir, name)
      return dir
    })
  }

  const actions: Array<{ action: HomeAction; icon: LucideIcon; title: string; help: string; busyLabel: string; onClick: () => void }> = [
    { action: 'demo', icon: Sparkles, title: t('home.demoTitle'), help: t('home.demoHelp'), busyLabel: t('home.loadingDemo'), onClick: handleDemo },
    { action: 'open', icon: FolderOpen, title: t('home.openExisting'), help: t('home.openExistingHelp'), busyLabel: t('home.opening'), onClick: handleOpen },
    { action: 'clone', icon: Download, title: t('home.openFromRepo'), help: t('home.openFromRepoHelp'), busyLabel: t('home.cloning'), onClick: () => setPrompt('clone') },
    { action: 'create', icon: Plus, title: t('home.createNew'), help: t('home.createNewHelp'), busyLabel: t('home.creating'), onClick: () => setPrompt('create') },
  ]

  return (
    <div className="p-8 max-w-lg mx-auto space-y-3">
      {actions.map(({ action, icon: Icon, title, help, busyLabel, onClick }) => {
        const featured = action === 'demo'
        return (
          <div key={action} className="space-y-2">
            <button type="button" onClick={onClick} disabled={busy !== null}
              className={`w-full flex items-start gap-3 text-left rounded-xl border p-4 transition-colors
                disabled:opacity-60 disabled:cursor-not-allowed ${featured
                  ? 'bg-prim text-prim-fg border-prim hover:opacity-90'
                  : 'bg-surface text-ink border-edge hover:bg-surface-hover'}`}>
              <Icon size={20} className="mt-0.5 shrink-0" />
              <span className="space-y-0.5">
                <span className="block font-medium">{title}</span>
                <span className={`block text-xs ${featured ? 'opacity-80' : 'text-ink-3'}`}>
                  {busy === action ? busyLabel : help}
                </span>
              </span>
            </button>
            {error?.action === action && (
              <p className="text-sm text-status-danger bg-status-danger-bg border border-status-danger-border rounded px-3 py-2">
                {error.message}
              </p>
            )}
          </div>
        )
      })}

      {prompt === 'clone' && (
        <TextPromptModal title={t('home.openFromRepo')} label={t('home.repoUrlLabel')}
          placeholder="https://github.com/org/projet.git" confirmLabel={t('home.continue')}
          onConfirm={handleCloneUrl} onCancel={() => setPrompt(null)} />
      )}
      {prompt === 'create' && (
        <TextPromptModal title={t('home.createNew')} label={t('home.projectNameLabel')}
          confirmLabel={t('home.continue')} onConfirm={handleCreateName} onCancel={() => setPrompt(null)} />
      )}
    </div>
  )
}
