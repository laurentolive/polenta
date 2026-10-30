import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { TerminalKind } from '@polenta/types'
import { api } from '../api'
import { useSelectedRepo } from './SelectedRepoContext'
import { isTerminalToggleShortcut, isVersionRoute, QuietRefresh } from '../components/terminal/terminalShortcut'

/**
 * GH238 — terminal Git Bash du panneau bas des vues Version : une session de pseudo-terminal
 * (main, `terminal.service.ts`) et son émulateur xterm. Monté sous `SelectedRepoProvider`
 * (`key={currentProjectId}`) : un changement de projet démonte ce provider, qui tue la session.
 * Masquer le panneau (×, Ctrl+ù, navigation hors des vues Version) ne touche ni au shell ni au
 * contenu affiché.
 */

export type TerminalStatus = 'idle' | 'detecting' | 'not-found' | 'installing' | 'running' | 'exited'

interface TerminalContextValue {
  open: boolean
  /** Ouvert et sur une vue Version. */
  visible: boolean
  status: TerminalStatus
  winget: boolean
  shellName: string
  /** Repo du shell : celui d'ouverture de la session, ou du dernier « Aller au repo sélectionné ». */
  sessionRepo: string
  selectedRepoPath: string
  height: number
  setHeight: (h: number) => void
  /** Élément hôte de xterm (rendu par `TerminalPanel`). */
  setHost: (el: HTMLDivElement | null) => void
  toggle: () => void
  close: () => void
  clear: () => void
  kill: () => void
  cdToSelected: () => void
  install: () => void
  recheck: () => void
  copySelection: () => void
  paste: () => void
}

const TerminalContext = createContext<TerminalContextValue | null>(null)

/** `null` hors projet ouvert (pas de provider). */
export function useTerminal(): TerminalContextValue | null {
  return useContext(TerminalContext)
}

export const TERMINAL_HEIGHT_DEFAULT = 260
// Hauteur gardée pour la session de l'application, au-delà d'un changement de projet.
let lastHeight = TERMINAL_HEIGHT_DEFAULT

function cssColor(name: string, alpha?: number): string {
  const rgb = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).join(', ')
  return alpha === undefined ? `rgb(${rgb})` : `rgba(${rgb}, ${alpha})`
}

/** Couleurs des tokens du thème ; en clair, blanc et jaune assombris pour rester lisibles. */
function xtermTheme(): ITheme {
  const dark = document.documentElement.classList.contains('dark')
  const base: ITheme = {
    background: cssColor('--surface'),
    foreground: cssColor('--ink'),
    cursor: cssColor('--ink'),
    cursorAccent: cssColor('--surface'),
    selectionBackground: cssColor('--ink-3', 0.4),
  }
  return dark ? base : { ...base, white: '#64748b', brightWhite: '#334155', yellow: '#a16207', brightYellow: '#ca8a04' }
}

export function TerminalProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const pathname = useRouterState({ select: s => s.location.pathname })
  const { selectedRepoPath } = useSelectedRepo()
  const onVersionRoute = isVersionRoute(pathname)

  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<TerminalStatus>('idle')
  const [winget, setWinget] = useState(false)
  const [shellName, setShellName] = useState('')
  const [sessionRepo, setSessionRepo] = useState('')
  const [height, setHeightState] = useState(lastHeight)
  const [host, setHost] = useState<HTMLDivElement | null>(null)

  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionRef = useRef<{ id: string; kind: TerminalKind } | null>(null)
  const statusRef = useRef(status)
  statusRef.current = status
  const selectedRef = useRef(selectedRepoPath)
  selectedRef.current = selectedRepoPath
  const sessionRepoRef = useRef(sessionRepo)
  sessionRepoRef.current = sessionRepo

  const setHeight = useCallback((h: number) => {
    lastHeight = h
    setHeightState(h)
  }, [])

  // Statut, graphe, branches, tags, état d'intégration… : toute requête `sync:*` / `git*` du repo
  // du shell ou du repo sélectionné, sans liste de clés à maintenir.
  const refresh = useCallback(() => {
    const repos = [sessionRepoRef.current, selectedRef.current].filter(Boolean)
    void queryClient.invalidateQueries({
      predicate: q => {
        const [head, ...rest] = q.queryKey
        return typeof head === 'string' && (head.startsWith('sync:') || head.startsWith('git'))
          && rest.some(k => typeof k === 'string' && repos.includes(k))
      },
    })
  }, [queryClient])
  const quietRef = useRef<QuietRefresh | null>(null)
  quietRef.current ??= new QuietRefresh(() => refresh())

  const startSession = useCallback(async (kind: TerminalKind, repo: string) => {
    const term = termRef.current
    if (!term) return
    setStatus(kind === 'shell' ? 'running' : 'installing')
    try {
      const { id, name } = await api.terminal.start(kind, repo, term.cols, term.rows)
      sessionRef.current = { id, kind }
      if (kind === 'shell') {
        setShellName(name)
        setSessionRepo(repo)
      }
      term.focus()
    } catch (err) {
      term.write(`\r\n${err instanceof Error ? err.message : String(err)}\r\n`)
      setStatus('exited')
    }
  }, [])

  /** Détecte le shell : trouvé → démarré ; absent → état « introuvable » ; échec de l'appel →
   *  message dans le terminal (jamais bloqué sur « Chargement… »). */
  const detectAndStart = useCallback(async () => {
    setStatus('detecting')
    try {
      const result = await api.terminal.detect()
      if (result.status === 'found') {
        termRef.current?.reset()
        await startSession('shell', selectedRef.current)
        return
      }
      setWinget(result.winget)
      setStatus('not-found')
      return result
    } catch (err) {
      termRef.current?.write(`\r\n${err instanceof Error ? err.message : String(err)}\r\n`)
      setStatus('exited')
    }
  }, [startSession])
  // Installation de Git interrompue par « Tuer » : pas de page de téléchargement ouverte d'office.
  const installKilledRef = useRef(false)

  // Première ouverture : xterm attaché une fois le panneau visible (mesure de la taille), puis
  // détection du shell et démarrage.
  useEffect(() => {
    if (!open || !onVersionRoute || !host) return
    if (termRef.current) {
      // Panneau remonté (nouvel élément hôte) : on y déplace le terminal existant.
      const el = termRef.current.element
      if (el && el.parentElement !== host) {
        host.appendChild(el)
        fitRef.current?.fit()
      }
      return
    }
    const term = new Terminal({
      fontFamily: "Consolas, 'Cascadia Mono', ui-monospace, Menlo, monospace",
      fontSize: 13,
      scrollback: 5000,
      cursorBlink: true,
      theme: xtermTheme(),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    term.attachCustomKeyEventHandler(ev => {
      if (ev.type !== 'keydown' || !ev.ctrlKey || ev.altKey || ev.metaKey) return true
      const k = ev.key.toLowerCase()
      // Ctrl+C avec une sélection, ou Ctrl+Maj+C : copie (sans sélection, Ctrl+C interrompt).
      if (k === 'c' && (ev.shiftKey || term.hasSelection())) {
        void navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
        ev.preventDefault()
        return false
      }
      // Ctrl+V / Ctrl+Maj+V : laissés au collage natif du navigateur, que xterm reçoit.
      if (k === 'v') return false
      return true
    })

    term.onData(data => {
      const session = sessionRef.current
      if (!session) {
        // Shell terminé : Entrée relance un shell dans le repo sélectionné à ce moment.
        if (statusRef.current === 'exited' && data.includes('\r')) {
          term.reset()
          void startSession('shell', selectedRef.current)
        }
        return
      }
      void api.terminal.write(session.id, data)
      quietRef.current?.onInput(data)
    })
    term.onResize(({ cols, rows }) => {
      const session = sessionRef.current
      if (session) void api.terminal.resize(session.id, cols, rows)
    })

    void detectAndStart()
  }, [open, onVersionRoute, host, detectAndStart, startSession])

  // Sortie et fin des sessions poussées par le main.
  useEffect(() => {
    const offData = window.polenta.on('terminal:data', (id: unknown, chunk: unknown) => {
      if (id !== sessionRef.current?.id) return
      termRef.current?.write(String(chunk))
      quietRef.current?.onOutput()
    })
    const offExit = window.polenta.on('terminal:exit', (id: unknown, code: unknown) => {
      const session = sessionRef.current
      if (!session || id !== session.id) return
      sessionRef.current = null
      if (session.kind === 'install-git') {
        const killed = installKilledRef.current
        installKilledRef.current = false
        void detectAndStart().then(notFound => {
          if (notFound && code !== 0 && !killed) void api.terminal.openGitDownload()
        })
        return
      }
      termRef.current?.write(`\r\n\x1b[2m${t('terminal.exited', { code: String(code) })}\x1b[0m\r\n`)
      setStatus('exited')
      refresh()
    })
    return () => {
      offData()
      offExit()
    }
  }, [t, refresh, detectAndStart])

  // Thème clair / sombre de Polenta.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (termRef.current) termRef.current.options.theme = xtermTheme()
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  // Taille : colonnes/lignes suivent le panneau (y compris quand il réapparaît après masquage).
  useEffect(() => {
    if (!host) return
    const observer = new ResizeObserver(() => {
      if (host.clientWidth > 0 && host.clientHeight > 0) fitRef.current?.fit()
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [host])

  // Changement de projet (démontage) : la session ne lui survit pas.
  useEffect(() => () => {
    const session = sessionRef.current
    if (session) void api.terminal.kill(session.id)
    sessionRef.current = null
    quietRef.current?.dispose()
    termRef.current?.dispose()
    termRef.current = null
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    if (termRef.current?.textarea === document.activeElement) termRef.current?.blur()
    refresh()
  }, [refresh])

  const toggle = useCallback(() => {
    if (open) {
      close()
      return
    }
    setOpen(true)
    requestAnimationFrame(() => termRef.current?.focus())
  }, [open, close])

  // Ctrl+ù en capture : avant xterm et avant les raccourcis des vues ; seulement sur une vue Version.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!onVersionRoute || !isTerminalToggleShortcut(e)) return
      e.preventDefault()
      e.stopPropagation()
      toggle()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onVersionRoute, toggle])

  const value: TerminalContextValue = {
    open,
    visible: open && onVersionRoute,
    status,
    winget,
    shellName,
    sessionRepo,
    selectedRepoPath,
    height,
    setHeight,
    setHost,
    toggle,
    close,
    clear: () => termRef.current?.clear(),
    kill: () => {
      const session = sessionRef.current
      if (!session) return
      if (session.kind === 'install-git') installKilledRef.current = true
      void api.terminal.kill(session.id)
    },
    cdToSelected: () => {
      const session = sessionRef.current
      if (!session || session.kind !== 'shell') return
      void api.terminal.cd(session.id, selectedRepoPath)
      setSessionRepo(selectedRepoPath)
      termRef.current?.focus()
    },
    install: () => {
      if (!winget) {
        void api.terminal.openGitDownload()
        return
      }
      void startSession('install-git', '')
    },
    recheck: () => { void detectAndStart() },
    copySelection: () => {
      const term = termRef.current
      if (term?.hasSelection()) void navigator.clipboard.writeText(term.getSelection())
    },
    paste: () => {
      void navigator.clipboard.readText().then(text => {
        if (text) termRef.current?.paste(text)
        termRef.current?.focus()
      })
    },
  }

  return <TerminalContext.Provider value={value}>{children}</TerminalContext.Provider>
}
