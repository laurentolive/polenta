import React, { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { FolderOpen } from 'lucide-react'
import { api } from '../api'
import { encodeProjectId } from '../lib/projectId'
import { consumeProjectJustClosed } from '../lib/projectCloseSignal'

export const Route = createFileRoute('/')({
  component: HomePage,
})

async function pickFolder(setter: (p: string) => void, title?: string) {
  const picked = await api.dialog.pickFolder(title)
  if (picked) setter(picked)
}

function HomePage() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)

  const [openDir, setOpenDir] = useState('')
  const [openError, setOpenError] = useState<string | null>(null)
  const [openLoading, setOpenLoading] = useState(false)

  const [cloneContainerDir, setCloneContainerDir] = useState('')
  const [cloneUrl, setCloneUrl] = useState('')
  const [cloneError, setCloneError] = useState<string | null>(null)
  const [cloneLoading, setCloneLoading] = useState(false)

  const [createContainerDir, setCreateContainerDir] = useState('')
  const [createName, setCreateName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [createLoading, setCreateLoading] = useState(false)

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
        Chargement…
      </div>
    )
  }

  async function goToProject(workspaceDir: string) {
    await api.workspace.markRecent(workspaceDir)
    await navigate({ to: '/schema', search: { repoPath: '', projectId: encodeProjectId(workspaceDir) } })
  }

  const handleOpen = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!openDir) return
    setOpenLoading(true)
    setOpenError(null)
    try {
      const result = await api.workspace.openProject(openDir)
      if (result.status === 'not-a-workspace') {
        setOpenError('Ce dossier n\'est ni un projet Polenta ni un repo git.')
        return
      }
      await goToProject(openDir)
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err))
    } finally {
      setOpenLoading(false)
    }
  }

  const handleCreateFromClone = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cloneContainerDir || !cloneUrl) return
    setCloneLoading(true)
    setCloneError(null)
    try {
      await api.workspace.createFromClone(cloneContainerDir, cloneUrl)
      await goToProject(cloneContainerDir)
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : String(err))
    } finally {
      setCloneLoading(false)
    }
  }

  const handleCreateNew = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!createContainerDir || !createName) return
    setCreateLoading(true)
    setCreateError(null)
    try {
      await api.workspace.createNew(createContainerDir, createName)
      await goToProject(createContainerDir)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreateLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-lg mx-auto space-y-4">
      <form onSubmit={handleOpen} className="bg-surface rounded-xl border border-edge p-4 space-y-3">
        <h2 className="font-medium text-ink">Ouvrir un projet existant</h2>
        <div className="flex gap-2">
          <input value={openDir} onChange={e => setOpenDir(e.target.value)}
            placeholder="Dossier du projet" className="input-field flex-1" disabled={openLoading} />
          <button type="button" onClick={() => pickFolder(setOpenDir, 'Sélectionner le projet')} disabled={openLoading}
            className="btn-secondary px-3 py-2">
            <FolderOpen size={15} />
          </button>
        </div>
        <button type="submit" disabled={openLoading || !openDir} className="btn-primary">
          {openLoading ? 'Ouverture…' : 'Ouvrir'}
        </button>
        {openError && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/60 rounded px-3 py-2">
            {openError}
          </p>
        )}
      </form>

      <form onSubmit={handleCreateFromClone} className="bg-surface rounded-xl border border-edge p-4 space-y-3">
        <h2 className="font-medium text-ink">Ouvrir un projet depuis un repo existant</h2>
        <input value={cloneUrl} onChange={e => setCloneUrl(e.target.value)}
          placeholder="https://github.com/org/projet.git" className="input-field w-full" disabled={cloneLoading} />
        <div className="flex gap-2">
          <input value={cloneContainerDir} onChange={e => setCloneContainerDir(e.target.value)}
            placeholder="Dossier de destination" className="input-field flex-1" disabled={cloneLoading} />
          <button type="button" onClick={() => pickFolder(setCloneContainerDir)} disabled={cloneLoading}
            className="btn-secondary px-3 py-2">
            <FolderOpen size={15} />
          </button>
        </div>
        <button type="submit" disabled={cloneLoading || !cloneUrl || !cloneContainerDir} className="btn-primary">
          {cloneLoading ? 'Clonage…' : 'Cloner'}
        </button>
        {cloneError && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/60 rounded px-3 py-2">
            {cloneError}
          </p>
        )}
      </form>

      <form onSubmit={handleCreateNew} className="bg-surface rounded-xl border border-edge p-4 space-y-3">
        <h2 className="font-medium text-ink">Créer un nouveau projet</h2>
        <input value={createName} onChange={e => setCreateName(e.target.value)}
          placeholder="Nom du projet" className="input-field w-full" disabled={createLoading} />
        <div className="flex gap-2">
          <input value={createContainerDir} onChange={e => setCreateContainerDir(e.target.value)}
            placeholder="Dossier de destination" className="input-field flex-1" disabled={createLoading} />
          <button type="button" onClick={() => pickFolder(setCreateContainerDir)} disabled={createLoading}
            className="btn-secondary px-3 py-2">
            <FolderOpen size={15} />
          </button>
        </div>
        <button type="submit" disabled={createLoading || !createName || !createContainerDir} className="btn-primary">
          {createLoading ? 'Création…' : 'Créer'}
        </button>
        {createError && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/60 rounded px-3 py-2">
            {createError}
          </p>
        )}
      </form>
    </div>
  )
}
