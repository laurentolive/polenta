import type { ImpactAnalysisStatus } from '@polenta/types'

/** Libellés i18n des 8 statuts d'impact (analyse entre baselines, changes GH198). */
export const STATUS_LABEL_KEY: Record<ImpactAnalysisStatus, string> = {
  impact_non_verifie: 'impactAnalysisPage.status.impactNonVerifie',
  pas_d_impact_reel: 'impactAnalysisPage.status.pasDImpactReel',
  impact_a_tester: 'impactAnalysisPage.status.impactATester',
  impact_teste: 'impactAnalysisPage.status.impactTeste',
  modification_a_faire: 'impactAnalysisPage.status.modificationAFaire',
  modification_faite: 'impactAnalysisPage.status.modificationFaite',
  modification_a_tester: 'impactAnalysisPage.status.modificationATester',
  modification_verifiee: 'impactAnalysisPage.status.modificationVerifiee',
}

// Statuts "clos" pour l'indicateur de complétude (point 6 de la spec) — ne contraint pas les
// transitions, sert uniquement à compter ouverts/clos.
export const CLOSED_STATUSES = new Set<ImpactAnalysisStatus>(['pas_d_impact_reel', 'impact_teste', 'modification_verifiee'])
