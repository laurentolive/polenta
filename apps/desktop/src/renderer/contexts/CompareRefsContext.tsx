import { createContext, useContext, useState, type ReactNode } from 'react'

interface CompareRefsContextValue {
  sha1: string | undefined
  sha2: string | undefined
  selectedFile: string | null
  setSha1: (sha: string | undefined) => void
  setSha2: (sha: string | undefined) => void
  setSelectedFile: (path: string | null) => void
}

const CompareRefsContext = createContext<CompareRefsContextValue>({
  sha1: undefined,
  sha2: undefined,
  selectedFile: null,
  setSha1: () => {},
  setSha2: () => {},
  setSelectedFile: () => {},
})

export function useCompareRefs(): CompareRefsContextValue {
  return useContext(CompareRefsContext)
}

interface Props {
  children: ReactNode
}

/** Shared "commits being compared" state (T-sidebar-compare): `VersionCompareSelector`
 *  (rendered in the Sidebar) owns the repo/commit comboboxes and the modified-files list,
 *  and writes here; `/version-diff` (main content, a sibling under `AppLayout`, not a child)
 *  only reads sha1/sha2/selectedFile to render the diff of the currently selected file. */
export function CompareRefsProvider({ children }: Props) {
  const [sha1, setSha1Raw] = useState<string | undefined>(undefined)
  const [sha2, setSha2Raw] = useState<string | undefined>(undefined)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  // Changing either side of the comparison invalidates whatever file was selected in the
  // previous diff's file list.
  function setSha1(sha: string | undefined) {
    setSha1Raw(sha)
    setSelectedFile(null)
  }

  function setSha2(sha: string | undefined) {
    setSha2Raw(sha)
    setSelectedFile(null)
  }

  return (
    <CompareRefsContext.Provider value={{ sha1, sha2, selectedFile, setSha1, setSha2, setSelectedFile }}>
      {children}
    </CompareRefsContext.Provider>
  )
}
