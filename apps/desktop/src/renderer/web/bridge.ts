/**
 * GH44 — `window.polenta` pour le navigateur (specs/GH44-design.md §4.4) : même contrat que le
 * preload Electron (`invoke` / `on` / `off`), transporté en HTTP (`POST /rpc/:channel`) et
 * WebSocket (`/events`). Les channels qui ouvrent un dialogue natif sur le desktop sont traités
 * ici (sélecteur de fichiers du navigateur, upload, téléchargement) : les composants ne changent pas.
 *
 * Doit être importé avant `../main` (cf. `web/main.tsx`).
 */
import type { UpdateState } from '@polenta/types'
import { EVENTS_RECONNECTED } from '../lib/webEvents'
import { CSRF_HEADER_NAME, csrfToken } from '../lib/webSession'

type Listener = (...args: unknown[]) => void

const LOGIN_URL = '/auth/login'
/** GH44 S3 — accès révoqué par la forge : page d'explication, puis reconnexion. */
const REVOKED_URL = '/auth/revoked'
const NOT_AVAILABLE = 'Non disponible dans la version web.'

class SessionExpiredError extends Error {}

/** Une seule redirection : la première (révocation, expiration) l'emporte sur les suivantes. */
let leaving = false

function redirectTo(url: string): never {
  if (!leaving) {
    leaving = true
    window.location.href = url
  }
  throw new SessionExpiredError('Session expirée, reconnexion…')
}

function redirectToLogin(): never {
  return redirectTo(LOGIN_URL)
}

async function readResult(res: Response): Promise<unknown> {
  let body: { ok?: boolean; value?: unknown; error?: { message?: string; revoked?: boolean } } | null = null
  try {
    body = await res.json()
  } catch {
    if (res.status === 401) redirectToLogin()
    throw new Error(`Erreur serveur (${res.status})`)
  }
  if (res.status === 401) {
    if (body?.error?.revoked) redirectTo(REVOKED_URL)
    redirectToLogin()
  }
  if (!body?.ok) throw new Error(body?.error?.message ?? `Erreur serveur (${res.status})`)
  return body.value
}

async function rpc(channel: string, args: unknown[]): Promise<unknown> {
  const res = await fetch(`/rpc/${encodeURIComponent(channel)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', [CSRF_HEADER_NAME]: csrfToken() },
    // `undefined` n'existe pas en JSON (il deviendrait `null`, et un paramètre par défaut ne
    // s'appliquerait plus) : ses positions voyagent à part et le serveur le restaure.
    body: JSON.stringify({ args, undefinedArgs: args.flatMap((a, i) => (a === undefined ? [i] : [])) }),
  })
  return readResult(res)
}

// ── Fichiers ────────────────────────────────────────────────────────────────────

/** Sélecteur de fichier du navigateur ; `null` si l'utilisateur annule. */
function pickFile(accept: string): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    let done = false
    const finish = (file: File | null) => {
      if (done) return
      done = true
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => finish(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => finish(null))
    document.body.appendChild(input)
    input.click()
  })
}

async function upload(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file, file.name)
  const res = await fetch('/upload', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { [CSRF_HEADER_NAME]: csrfToken() },
    body: form,
  })
  const value = (await readResult(res)) as { uploadId: string }
  return value.uploadId
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error ?? new Error('Lecture du fichier impossible'))
    reader.readAsDataURL(file)
  })
}

function download(downloadId: string): void {
  const a = document.createElement('a')
  a.href = `/download/${encodeURIComponent(downloadId)}`
  a.download = ''
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

type WebDownloadResult = { status: 'ok'; downloadId: string; fileName: string } | { status: 'error'; message: string }

/** Export généré côté serveur puis téléchargé : même résultat qu'« Enregistrer sous ». */
async function exportAndDownload(channel: string, args: unknown[]) {
  const result = (await rpc(channel, args)) as WebDownloadResult
  if (result.status !== 'ok') return result
  download(result.downloadId)
  return { status: 'ok' as const, filePath: result.fileName }
}

const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.gif,.svg,.webp'

/** Channels interceptés avant le réseau (desktop : dialogues natifs, fenêtres, shell). */
const adapters: Record<string, (...args: unknown[]) => Promise<unknown>> = {
  'dialog:pick-image-file': async () => {
    const file = await pickFile(IMAGE_ACCEPT)
    if (!file) return null
    return { mimeType: file.type || 'image/png', base64: await readAsBase64(file) }
  },
  'image:pick-file': async (repoPath) => {
    const file = await pickFile(IMAGE_ACCEPT)
    if (!file) return { status: 'canceled' }
    return rpc('web:image-import', [repoPath, await upload(file)])
  },
  'dialog:pick-drawio-file': async (repoPath) => {
    const file = await pickFile('.drawio')
    if (!file) return { status: 'canceled' }
    return rpc('web:drawio-import', [repoPath, await upload(file)])
  },
  'campaigns:execution-sheet-preview': async (repoPath, campaignId) => {
    const file = await pickFile('.xlsx')
    if (!file) return { canceled: true }
    return rpc('web:execution-sheet-preview', [repoPath, campaignId, await upload(file)])
  },
  'export:save': (...args) => exportAndDownload('web:export', args),
  'campaigns:execution-sheet-export': (...args) => exportAndDownload('web:execution-sheet-export', args),
  'app:set-title': async (title) => { document.title = String(title) },
  // Le serveur est mis à jour par l'exploitant : jamais de mise à jour côté navigateur.
  'update:get-state': async (): Promise<UpdateState> => ({
    status: 'idle', currentVersion: String(await rpc('app:get-version', [])),
  }),
  // Signal de fin de rendu d'une route `/print/*` : relayé au Chromium headless du serveur (sprint 4).
  'export:print-ready': async (...args) => callPrintHook('__polentaPrintReady', args),
  'export:drawio-snapshot-ready': async (...args) => callPrintHook('__polentaDrawioSnapshotReady', args),
}

async function callPrintHook(name: string, args: unknown[]): Promise<unknown> {
  const hook = (window as unknown as Record<string, unknown>)[name]
  return typeof hook === 'function' ? (hook as (...a: unknown[]) => unknown)(...args) : undefined
}

/** Channels propres au poste local : l'interface web les masque ; un appel résiduel échoue net. */
const UNAVAILABLE = new Set([
  'dialog:pick-folder', 'drawio:open-external', 'export:show-in-folder', 'export:open-file',
  'app:open-release-page', 'update:install', 'auth:device-flow-start', 'auth:device-flow-poll',
])

// ── Événements ──────────────────────────────────────────────────────────────────

const listeners = new Map<string, Set<Listener>>()

function emit(channel: string, args: unknown[]): void {
  for (const cb of listeners.get(channel) ?? []) {
    try { cb(...args) } catch (err) { console.error(`[polenta] listener ${channel}`, err) }
  }
}


function connectEvents(): void {
  let retry = 0
  let revoked = false
  let hadConnection = false
  const open = () => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/events`)
    ws.onopen = () => {
      if (hadConnection) emit(EVENTS_RECONNECTED, [])
      hadConnection = true
      retry = 0
    }
    ws.onmessage = (ev) => {
      try {
        const { channel, args } = JSON.parse(String(ev.data)) as { channel: string; args: unknown[] }
        // GH44 S3 — le serveur a invalidé la session (accès révoqué par la forge).
        if (channel === 'auth:session-revoked') {
          revoked = true
          try { redirectTo(REVOKED_URL) } catch { /* redirection en cours */ }
          return
        }
        emit(channel, args)
      } catch { /* message invalide ignoré */ }
    }
    ws.onclose = (ev) => {
      if (revoked) return
      if (ev.code === 4402) {
        try { redirectTo(REVOKED_URL) } catch { /* redirection en cours */ }
        return
      }
      if (ev.code === 4401) return redirectToLoginSafe()
      retry = Math.min(retry + 1, 6)
      setTimeout(open, 500 * 2 ** retry)
    }
  }
  open()
}

function redirectToLoginSafe(): void {
  try { redirectToLogin() } catch { /* redirection en cours */ }
}

// ── window.polenta ──────────────────────────────────────────────────────────────

window.polenta = Object.assign({
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const adapter = adapters[channel]
    if (adapter) return adapter(...args)
    if (UNAVAILABLE.has(channel)) {
      console.warn(`[polenta] ${channel} appelé dans la version web`)
      return Promise.reject(new Error(NOT_AVAILABLE))
    }
    return rpc(channel, args)
  },
  on(channel: string, cb: Listener): () => void {
    let set = listeners.get(channel)
    if (!set) {
      set = new Set()
      listeners.set(channel, set)
    }
    set.add(cb)
    return () => { listeners.get(channel)?.delete(cb) }
  },
  off(channel: string, cb: Listener): void {
    listeners.get(channel)?.delete(cb)
  },
}, { platform: 'web' as const })

connectEvents()
