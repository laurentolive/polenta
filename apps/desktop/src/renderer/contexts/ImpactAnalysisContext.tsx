import { createContext, useContext, useState, type ReactNode } from 'react'

/** T175 — valeur de `activeAnalysisId` désignant l'analyse live des modifications locales
 *  (non persistée, pas d'id de fichier). */
export const LOCAL_IMPACT_ANALYSIS_ID = '__local__'

interface ImpactAnalysisContextValue {
  activeAnalysisId: string | null
  setActiveAnalysisId: (id: string | null) => void
}

const ImpactAnalysisContext = createContext<ImpactAnalysisContextValue>({
  activeAnalysisId: null,
  setActiveAnalysisId: () => {},
})

export function useImpactAnalysis(): ImpactAnalysisContextValue {
  return useContext(ImpactAnalysisContext)
}

interface Props {
  children: ReactNode
}

/** Shared "which analysis is open" state: `VersionImpactSelector` (rendered in the Version
 *  sidebar) owns baseline selection, creation and the list of existing analyses, and writes
 *  here; `/impact-analysis` (main content, a sibling under `AppLayout`, not a child) only
 *  reads `activeAnalysisId` to render the selected analysis' impacted requirements. */
export function ImpactAnalysisProvider({ children }: Props) {
  const [activeAnalysisId, setActiveAnalysisId] = useState<string | null>(null)

  return (
    <ImpactAnalysisContext.Provider value={{ activeAnalysisId, setActiveAnalysisId }}>
      {children}
    </ImpactAnalysisContext.Provider>
  )
}
