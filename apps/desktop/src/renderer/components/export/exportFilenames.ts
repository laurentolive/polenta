const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]+/g

/** Normalise un segment de nom de fichier par défaut (cf. specs/T43.md §4) — retire les
 *  caractères interdits par le système de fichiers plutôt que de laisser le dialogue natif
 *  "Enregistrer sous" échouer silencieusement sur un nom invalide. */
function sanitize(segment: string): string {
  const cleaned = segment.trim().replace(INVALID_FILENAME_CHARS, '-')
  return cleaned || 'sans-nom'
}

/** `{composant}-exigences-{commit}` — cf. specs/T43.md §4. `headSha` est déjà résolu par
 *  l'appelant (aucune baseline sélectionnée dans `requirements.tsx`, toujours le commit HEAD). */
export function requirementsExportBaseName(componentLabel: string, headSha: string): string {
  return `${sanitize(componentLabel)}-exigences-${sanitize(headSha.slice(0, 8))}`
}

/** `{composant}-tests-{commit}` — miroir de `requirementsExportBaseName` (T43 sprint 2). */
export function testsExportBaseName(componentLabel: string, headSha: string): string {
  return `${sanitize(componentLabel)}-tests-${sanitize(headSha.slice(0, 8))}`
}

/** `{composant}-campagne-{nomCampagne}-{commit}` ou `{composant}-rapport-campagne-{nomCampagne}-{commit}`
 *  — cf. specs/T43.md §4. `composant` = `TestCampaign.component` si renseigné (pas de nœud/type
 *  d'appartenance direct comme pour exigences/tests, `campaign.$campaignId.tsx` n'a que la
 *  campagne elle-même). */
export function campaignExportBaseName(
  componentLabel: string,
  campaignTitle: string,
  headSha: string,
  kind: 'plan' | 'report',
): string {
  const prefix = kind === 'report' ? 'rapport-campagne' : 'campagne'
  return `${sanitize(componentLabel)}-${prefix}-${sanitize(campaignTitle)}-${sanitize(headSha.slice(0, 8))}`
}

/** `request-{name}` — cf. specs/T43.md §4 (préfixe anglais repris littéralement du ticket
 *  d'origine, cf. note dans `T43.md`). T43 sprint 3. */
export function queryResultExportBaseName(queryName: string): string {
  return `request-${sanitize(queryName)}`
}

/** `impactAnalisys-{baselineOld}-{baselineNew}` — cf. specs/T43.md §4 (orthographe reprise
 *  littéralement du ticket d'origine). T43 sprint 3. */
export function impactAnalysisExportBaseName(baselineOld: string, baselineNew: string): string {
  return `impactAnalisys-${sanitize(baselineOld)}-${sanitize(baselineNew)}`
}

/** `dashboard-{name}` — cf. specs/T43.md §4. T43 sprint 3. */
export function dashboardExportBaseName(dashboardTitle: string): string {
  return `dashboard-${sanitize(dashboardTitle)}`
}
