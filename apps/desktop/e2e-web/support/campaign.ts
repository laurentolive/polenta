import type { Session } from './session'
import { testedVersionArg } from './demo-types'

type Result = 'PASS' | 'FAIL' | 'BLOCKED' | 'INCOMPLETE'
interface Entry { entryId: string; testCaseId: string; requirementId?: string }

/**
 * GH73 — enregistre un résultat sur une entrée de campagne comme le fait l'UI : un run rattaché à
 * l'entrée (`campaignEntry`), puis le statut de l'entrée avec ce run (`campaigns:update-run`
 * refuse un statut sans run). Renvoie l'id du run créé.
 */
export async function recordResult(s: Session, campaignId: string, entryId: string, result: Result): Promise<string> {
  const { localPath, workspaceDir } = s.project
  const campaign = await s.invoke<{ runs: Entry[] }>('campaigns:get', localPath, campaignId)
  const entry = campaign.runs.find(r => r.entryId === entryId)
  if (!entry) throw new Error(`Entry ${entryId} not found in campaign ${campaignId}`)
  const run = await s.invoke<{ id: string }>('tests:execute', localPath, entry.testCaseId, {
    stepResults: [],
    result,
    ...(entry.requirementId && { requirementId: entry.requirementId }),
    campaignEntry: { campaignId, entryId },
    ...await testedVersionArg(s),
  }, workspaceDir)
  await s.invoke('campaigns:update-run', localPath, campaignId, entryId, result, run.id)
  return run.id
}

/**
 * GH312 — page d'exécution ouverte : choisit la version testée exigée depuis GH202 quand le repo
 * déclare une version en cours (la démo depuis GH278), sans quoi « Soumettre le résultat » reste
 * sur la page avec « La version testée est obligatoire. ».
 */
export async function chooseTestedVersion(s: Session): Promise<void> {
  const { testedVersion } = await testedVersionArg(s)
  if (testedVersion) await s.page.getByTestId('tested-version-select').selectOption(testedVersion.version)
}
