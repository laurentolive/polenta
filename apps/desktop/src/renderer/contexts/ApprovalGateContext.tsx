import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import type { ApprovalCheck } from '@polenta/types'
import { api } from '../api'
import { AssignToChangeDialog } from '../components/changes/AssignToChangeDialog'

// GH199 §8bis — approbation d'un élément non assigné à un change : avant d'écrire un statut
// `isApproval`, l'interface propose de l'assigner à un change ouvert (ou d'approuver sans change).

export interface GatedElement {
  id: string
  objectTypeRef: string
  category: 'requirement' | 'test'
}

/** `true` : le statut peut être écrit ; `false` : l'utilisateur a annulé. */
type Gate = (repoPath: string, element: GatedElement, toStatus: string) => Promise<boolean>

const ApprovalGateContext = createContext<Gate | null>(null)

interface Pending {
  repoPath: string
  element: GatedElement
  check: ApprovalCheck
  resolve: (ok: boolean) => void
}

export function ApprovalGateProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  // Une approbation à la fois : deux statuts écrits coup sur coup (autosave de deux lignes)
  // ouvrent leurs dialogues l'un après l'autre, aucun n'est abandonné.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())

  const gate = useCallback<Gate>((repoPath, element, toStatus) => {
    const turn = queueRef.current.then(async () => {
      // Contrôle indisponible (ancien serveur, erreur de lecture) : on n'empêche pas l'écriture.
      const check = await api.changes.approvalCheck(repoPath, element, toStatus).catch(() => null)
      if (!check?.needsAssignment) return true
      return new Promise<boolean>(resolve => setPending({ repoPath, element, check, resolve }))
    })
    queueRef.current = turn
    return turn
  }, [])

  const settle = (ok: boolean) => {
    pending?.resolve(ok)
    setPending(null)
  }

  return (
    <ApprovalGateContext.Provider value={gate}>
      {children}
      {pending && (
        <AssignToChangeDialog
          mode="approve"
          repoPath={pending.repoPath}
          elementIds={[pending.element.id]}
          component={pending.check.component}
          openChanges={pending.check.openChanges}
          onDone={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </ApprovalGateContext.Provider>
  )
}

const OPEN_GATE: Gate = async () => true

/** Hors provider (impression, tests) : pas de contrôle. */
export function useApprovalGate(): Gate {
  return useContext(ApprovalGateContext) ?? OPEN_GATE
}
