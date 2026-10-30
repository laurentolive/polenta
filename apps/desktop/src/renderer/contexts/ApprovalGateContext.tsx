import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApprovalCheck, ModificationCheck, ModificationKind } from '@polenta/types'
import { api } from '../api'
import { AssignToChangeDialog } from '../components/changes/AssignToChangeDialog'

// GH199 §8bis — approbation d'un élément non assigné à un change : avant d'écrire un statut
// `isApproval`, l'interface propose de l'assigner à un change ouvert (ou d'approuver sans change).
// GH200 — création et réouverture (statut qui quitte l'approbation) : l'élément est assigné à un
// changeset. Le main assigne seul quand un seul est ouvert ; sinon l'interface demande lequel (ou en
// crée un) et transmet `changesetId` à l'écriture.

export interface GatedElement {
  id: string
  objectTypeRef: string
  category: 'requirement' | 'test'
}

/** `ok: false` : l'utilisateur a annulé, rien ne doit être écrit. */
export interface GateResult {
  ok: boolean
  /** Changeset choisi, à passer à l'écriture (`changesetId`). */
  changesetId?: string
}

/** Changement de statut d'un élément : approbation (§8bis) ou réouverture / passage terminal (GH200). */
type StatusGate = (repoPath: string, element: GatedElement, toStatus: string) => Promise<GateResult>
/** Création d'éléments : un choix pour tout le lot (P2). */
type CreateGate = (repoPath: string, element: { objectTypeRef: string }) => Promise<GateResult>

interface Gates {
  status: StatusGate
  create: CreateGate
}

const GateContext = createContext<Gates | null>(null)

/** P2 — délai pendant lequel des créations successives forment un lot (un seul choix). */
const BATCH_MS = 3000

type Pending =
  | { kind: 'approve'; repoPath: string; element: GatedElement; check: ApprovalCheck; resolve: (r: GateResult) => void }
  | { kind: ModificationKind; check: ModificationCheck; elementIds: string[]; resolve: (r: GateResult) => void }

export function ApprovalGateProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [pending, setPending] = useState<Pending | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Un dialogue à la fois : deux statuts écrits coup sur coup (autosave de deux lignes)
  // ouvrent leurs dialogues l'un après l'autre, aucun n'est abandonné.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  const enqueue = useCallback(<T,>(step: () => Promise<T>): Promise<T> => {
    const turn = queueRef.current.then(step)
    queueRef.current = turn.catch(() => undefined)
    return turn
  }, [])

  /** GH200 — question posée seulement si la règle s'applique et que le main ne peut pas choisir seul. */
  const modification = useCallback(async (check: ModificationCheck | null, kind: ModificationKind, elementIds: string[]): Promise<GateResult> => {
    // Contrôle indisponible (ancien serveur, erreur de lecture) : on n'empêche pas l'écriture.
    if (!check?.tracking || check.assignedTo) return { ok: true }
    if (check.eligible.length === 1) {
      setNotice(t('changes.modify.auto', { id: check.eligible[0].id }))
      return { ok: true }
    }
    return new Promise<GateResult>(resolve => setPending({ kind, check, elementIds, resolve }))
  }, [t])

  const status = useCallback<StatusGate>((repoPath, element, toStatus) => enqueue(async () => {
    const approval = await api.changesets.approvalCheck(repoPath, element, toStatus).catch(() => null)
    if (approval?.needsAssignment) {
      return new Promise<GateResult>(resolve => setPending({ kind: 'approve', repoPath, element, check: approval, resolve }))
    }
    const check = await api.changesets.modificationCheck(repoPath, { ...element, toStatus }, 'reopen').catch(() => null)
    return modification(check, 'reopen', [element.id])
  }), [enqueue, modification])

  // P2 — créations en lot (coller plusieurs éléments, création en rafale) : une création qui suit la
  // précédente de près, dans le même repo, reprend le changeset choisi sans redemander.
  const lastCreateRef = useRef<{ repoPath: string; changesetId: string; at: number } | null>(null)
  const create = useCallback<CreateGate>((repoPath, element) => enqueue(async () => {
    const check = await api.changesets.modificationCheck(repoPath, { objectTypeRef: element.objectTypeRef }, 'create').catch(() => null)
    const last = lastCreateRef.current
    if (check?.tracking && check.eligible.length > 1 && last && last.repoPath === check.repoPath
      && Date.now() - last.at < BATCH_MS && check.eligible.some(c => c.id === last.changesetId)) {
      lastCreateRef.current = { ...last, at: Date.now() }
      return { ok: true, changesetId: last.changesetId }
    }
    const result = await modification(check, 'create', [])
    if (check && result.changesetId) lastCreateRef.current = { repoPath: check.repoPath, changesetId: result.changesetId, at: Date.now() }
    return result
  }), [enqueue, modification])

  // Valeur stable : les appelants mettent la porte dans les dépendances de leurs callbacks.
  const gates = useMemo<Gates>(() => ({ status, create }), [status, create])

  const settle = (r: GateResult) => {
    pending?.resolve(r)
    setPending(null)
  }

  return (
    <GateContext.Provider value={gates}>
      {children}
      {pending?.kind === 'approve' && (
        <AssignToChangeDialog
          mode="approve"
          repoPath={pending.repoPath}
          elementIds={[pending.element.id]}
          component={pending.check.component}
          openChanges={pending.check.openChanges}
          onDone={() => settle({ ok: true })}
          onCancel={() => settle({ ok: false })}
        />
      )}
      {pending && pending.kind !== 'approve' && (
        <AssignToChangeDialog
          mode={pending.kind === 'create' ? 'create' : 'reopen'}
          repoPath={pending.check.repoPath}
          elementIds={pending.elementIds}
          component={pending.check.component}
          openChanges={pending.check.eligible}
          onDone={changeId => settle({ ok: true, ...(changeId && { changesetId: changeId }) })}
          onCancel={() => settle({ ok: false })}
        />
      )}
      {notice && (
        <div role="status" data-testid="modification-gate-notice"
          className="fixed bottom-10 right-4 z-50 bg-surface border border-edge rounded shadow-lg px-3 py-2 text-xs text-ink">
          {notice}
        </div>
      )}
    </GateContext.Provider>
  )
}

const OPEN_GATES: Gates = { status: async () => ({ ok: true }), create: async () => ({ ok: true }) }

/** Hors provider (impression, tests) : pas de contrôle. */
export function useModificationGate(): Gates {
  return useContext(GateContext) ?? OPEN_GATES
}
