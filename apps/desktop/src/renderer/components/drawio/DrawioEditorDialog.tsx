import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import { editorSrc, exportMessage, isFromEditor, loadMessage, parseEditorEvent } from '../../lib/drawioEmbedProtocol'

/**
 * GH46 — édition d'un diagramme `.drawio` dans le client web, avec l'éditeur draw.io embarqué
 * (`drawio-editor/`, voir `specs/GH46-design.md`). Fenêtre modale plein écran.
 *
 * - Ouverture : le XML et son empreinte viennent du serveur (`api.drawio.openForEdit`) ; l'éditeur
 *   les reçoit par `load` dès qu'il signale `init`.
 * - Référence « non modifié » : le XML que l'éditeur réexporte juste après `load` (sa forme
 *   canonique). Fermer compare à cette référence : une simple réécriture de l'éditeur ne compte pas.
 * - Enregistrer : demande le XML (`export`), l'envoie avec l'empreinte d'ouverture. `conflict` si le
 *   fichier a changé entre-temps : rien n'est écrit, l'utilisateur choisit de recharger.
 * - Pendant que la fenêtre est ouverte, `beforeunload` demande confirmation (AC5 nuancé, design §3.3).
 */

interface Props {
  repoPath: string
  relativePath: string
  onClose: () => void
  /** Appelé après un enregistrement réussi (le bloc du document relit le diagramme). */
  onSaved?: () => void
}

/** Délai d'attente de l'éditeur (chargement de la page et réponses à `export`). */
const INIT_TIMEOUT_MS = 20_000
const EXPORT_TIMEOUT_MS = 10_000

export function DrawioEditorDialog({ repoPath, relativePath, onClose, onSaved }: Props) {
  const { i18n } = useTranslation()
  const src = useMemo(() => editorSrc(i18n.language), [i18n.language])
  const frameRef = useRef<HTMLIFrameElement>(null)
  /** XML ouvert ou dernièrement enregistré (ce que le fichier contient). */
  const savedXmlRef = useRef<string | null>(null)
  /** Empreinte SHA-256 du fichier tel qu'il a été lu (base de l'enregistrement conditionnel). */
  const baseHashRef = useRef<string | null>(null)
  /** XML canonique de l'éditeur juste après `load` : référence pour « modifié ou non ». */
  const baselineRef = useRef<string | null>(null)
  const editorReadyRef = useRef(false)
  const pendingExportRef = useRef<((xml: string) => void) | null>(null)
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)

  const post = (data: string) => frameRef.current?.contentWindow?.postMessage(data, window.location.origin)

  /** Requête XML à l'éditeur ; rejet au bout de `EXPORT_TIMEOUT_MS`. */
  const requestXml = (): Promise<string> => new Promise((resolve, reject) => {
    if (!frameRef.current?.contentWindow) return reject(new Error('éditeur absent'))
    const timer = setTimeout(() => {
      pendingExportRef.current = null
      reject(new Error('délai dépassé'))
    }, EXPORT_TIMEOUT_MS)
    pendingExportRef.current = xml => {
      clearTimeout(timer)
      resolve(xml)
    }
    post(exportMessage())
  })

  // Ouverture : XML et empreinte depuis le serveur, puis chargement dans l'éditeur quand il est prêt.
  useEffect(() => {
    let cancelled = false
    readyTimerRef.current = setTimeout(() => {
      if (!editorReadyRef.current) {
        setPhase('failed')
        setError('L’éditeur ne répond pas. Fermez cette fenêtre et réessayez.')
      }
    }, INIT_TIMEOUT_MS)
    void api.drawio.openForEdit(repoPath, relativePath).then(result => {
      if (cancelled) return
      if (result.status !== 'ok') {
        setPhase('failed')
        setError(result.message)
        return
      }
      savedXmlRef.current = result.xml
      baseHashRef.current = result.baseHash
      if (editorReadyRef.current) post(loadMessage(result.xml))
    }, () => {
      if (cancelled) return
      setPhase('failed')
      setError('Impossible d’ouvrir le diagramme : session expirée ou réseau indisponible.')
    })
    return () => {
      cancelled = true
      if (readyTimerRef.current) clearTimeout(readyTimerRef.current)
    }
    // Une fois par ouverture : repoPath / relativePath ne changent pas tant que la fenêtre est ouverte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Messages de l'éditeur : seulement de son iframe, seulement de la même origine.
  useEffect(() => {
    const origin = window.location.origin
    const onMessage = (event: MessageEvent) => {
      if (!isFromEditor(event, frameRef.current?.contentWindow ?? null, origin)) return
      const ev = parseEditorEvent(event.data)
      if (!ev) return
      if (ev.type === 'init') {
        editorReadyRef.current = true
        if (readyTimerRef.current) clearTimeout(readyTimerRef.current)
        if (savedXmlRef.current !== null) post(loadMessage(savedXmlRef.current))
      } else if (ev.type === 'load') {
        // Référence « non modifié » : la forme canonique que l'éditeur donne au diagramme chargé à
        // l'ouverture ou au rechargement. Un `load` ultérieur (autre chargement) ne la remplace pas :
        // sinon les modifications seraient prises pour la référence.
        if (baselineRef.current !== null) {
          setPhase('ready')
          return
        }
        void requestXml().then(xml => {
          if (baselineRef.current === null) baselineRef.current = xml
          setPhase('ready')
        }, () => {
          setPhase('ready')
        })
      } else if (ev.type === 'export') {
        const resolve = pendingExportRef.current
        pendingExportRef.current = null
        resolve?.(ev.xml)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
    // requestXml et post ne dépendent d'aucun état : l'écouteur n'est posé qu'une fois.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pendant l'édition, le navigateur demande confirmation avant de quitter la page.
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])

  const handleSave = async () => {
    if (phase !== 'ready' || saving || baseHashRef.current === null) return
    setSaving(true)
    setMessage(null)
    try {
      const xml = await requestXml()
      const result = await api.drawio.saveEdit(repoPath, relativePath, xml, baseHashRef.current)
      if (result.status === 'ok') {
        baseHashRef.current = result.baseHash
        savedXmlRef.current = xml
        baselineRef.current = xml
        setMessage('Enregistré.')
        onSaved?.()
      } else if (result.status === 'conflict') {
        setConflict(true)
        setMessage('Le diagramme a été modifié depuis son ouverture. Rien n’a été écrasé. Rechargez-le pour voir la version enregistrée : vos modifications non enregistrées seront perdues.')
      } else {
        setMessage(result.message)
      }
    } catch {
      setMessage('Enregistrement impossible : l’éditeur n’a pas répondu, ou la session a expiré. Rien n’a été écrit.')
    } finally {
      setSaving(false)
    }
  }

  const handleReload = async () => {
    setMessage(null)
    const result = await api.drawio.openForEdit(repoPath, relativePath)
    if (result.status !== 'ok') {
      setMessage(result.message)
      return
    }
    savedXmlRef.current = result.xml
    baseHashRef.current = result.baseHash
    baselineRef.current = null
    setConflict(false)
    setPhase('loading')
    post(loadMessage(result.xml))
    // La prochaine réponse `load` de l'éditeur remet la référence à jour.
    setMessage('Diagramme rechargé.')
  }

  /** Fermer : sans demander si rien n'a changé ; sinon confirmation. */
  const handleClose = async () => {
    if (phase !== 'ready' || baselineRef.current === null) {
      if (phase === 'ready') setConfirmClose(true)
      else onClose()
      return
    }
    try {
      const xml = await requestXml()
      if (xml === baselineRef.current) onClose()
      else setConfirmClose(true)
    } catch {
      setConfirmClose(true)
    }
  }

  const statusLabel = phase === 'loading' ? 'Chargement…' : phase === 'ready' ? 'Éditeur prêt' : ''

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-surface"
      role="dialog"
      aria-modal="true"
      aria-label="Éditeur draw.io"
      data-testid="drawio-editor-dialog"
      onKeyDown={event => {
        if (event.key === 'Escape') void handleClose()
      }}
    >
      <div className="flex items-center gap-3 px-3 py-2 border-b border-edge shrink-0">
        <span className="text-sm font-medium text-ink truncate" title={relativePath}>{relativePath}</span>
        <span className="text-xs text-ink-3">{statusLabel}</span>
        <div className="flex-1" />
        {message && <span role="status" className="text-xs text-ink-2 max-w-xl">{message}</span>}
        {conflict && (
          <button type="button" onClick={() => void handleReload()} className="text-xs px-3 py-1.5 border border-edge rounded hover:bg-hover text-ink-2 shrink-0">
            Recharger
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={phase !== 'ready' || saving}
          className="text-xs px-3 py-1.5 border border-edge rounded hover:bg-hover text-ink-2 disabled:opacity-40 shrink-0"
        >
          Enregistrer
        </button>
        <button
          type="button"
          onClick={() => void handleClose()}
          className="text-xs px-3 py-1.5 border border-edge rounded hover:bg-hover text-ink-2 shrink-0"
        >
          Fermer
        </button>
      </div>

      {error ? (
        <div className="p-6 text-sm text-ink-2">{error}</div>
      ) : (
        <iframe
          ref={frameRef}
          src={src}
          title="Éditeur draw.io"
          className="flex-1 w-full border-0"
        />
      )}

      {confirmClose && (
        <div role="alertdialog" aria-label="Quitter sans enregistrer" className="absolute inset-x-0 bottom-4 mx-auto w-fit flex items-center gap-3 px-4 py-3 bg-surface border border-edge rounded shadow-lg">
          <span className="text-sm text-ink">Quitter sans enregistrer les modifications ?</span>
          <button type="button" onClick={() => setConfirmClose(false)} className="text-xs px-3 py-1.5 border border-edge rounded hover:bg-hover text-ink-2">
            Continuer l’édition
          </button>
          <button type="button" onClick={onClose} className="text-xs px-3 py-1.5 border border-edge rounded hover:bg-hover text-ink-2">
            Quitter sans enregistrer
          </button>
        </div>
      )}
    </div>,
    document.body,
  )
}
