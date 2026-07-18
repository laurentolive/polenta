import { createContext, useContext, useState, type ReactNode } from 'react'
import { useVersioning } from './VersioningContext'

interface SelectedRepoContextValue {
  selectedRepoPath: string
  rootRepoPath: string
  selectRepo: (repoPath: string) => void
}

const SelectedRepoContext = createContext<SelectedRepoContextValue>({
  selectedRepoPath: '',
  rootRepoPath: '',
  selectRepo: () => {},
})

export function useSelectedRepo(): SelectedRepoContextValue {
  return useContext(SelectedRepoContext)
}

interface Props {
  children: ReactNode
}

/** Shared "selected repo" state (T80): the Version panel's tree and `/version-diff`
 *  both read/write this so the diff page follows whichever repo is selected in the
 *  tree, live, without a re-navigation. Defaults to the workspace root — reads
 *  `repoPath` from `VersioningContext` (already resolved one level up in `AppLayout`)
 *  rather than re-querying `api.workspace.resolve` itself. Mounted with
 *  `key={currentProjectId}` in `AppLayout` so a project switch remounts it fresh
 *  (back to the new root) instead of needing its own reset effect — no cross-session
 *  persistence. */
export function SelectedRepoProvider({ children }: Props) {
  const { repoPath: rootRepoPath } = useVersioning()
  const [selection, setSelection] = useState<string | null>(null)
  const selectedRepoPath = selection ?? rootRepoPath

  return (
    <SelectedRepoContext.Provider value={{ selectedRepoPath, rootRepoPath, selectRepo: setSelection }}>
      {children}
    </SelectedRepoContext.Provider>
  )
}
