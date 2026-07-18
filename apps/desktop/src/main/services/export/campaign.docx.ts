import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'
import * as fsP from 'fs/promises'
import type { CampaignExportPayload, TestRunStatus } from '@polenta/types'

// Copie locale plutôt qu'un import de valeur depuis `@polenta/types` (qui exporte la même table
// pour le renderer, cf. `print.campaign-report.tsx`) : le main process externalise ses dépendances
// (`externalizeDepsPlugin`, `electron.vite.config.ts`) et `@polenta/types` n'a pas de build
// compilé — un import de valeur (pas seulement `import type`, qui est effacé à la compilation)
// fait planter le process principal au démarrage (`require` d'un fichier .ts brut). Constaté en
// test interactif : jamais vu par le typecheck ni le build silencieux (electron-vite avale l'échec
// de génération de route mais pas celui-ci, qui ne surgit qu'à l'exécution réelle de l'app).
const TEST_RUN_STATUS_LABELS: Record<TestRunStatus, string> = {
  pending: 'En attente',
  PASS: 'Passé',
  FAIL: 'Échoué',
  BLOCKED: 'Bloqué',
  INCOMPLETE: 'Incomplet',
}

/** Cahier de campagne — export docx (T43 sprint 2) : plan des tests inclus, sans statut
 *  d'exécution. */
export async function exportCampaignPlanDocx(
  payload: CampaignExportPayload,
  destPath: string,
): Promise<void> {
  const { campaign, entries } = payload
  const children: Paragraph[] = [
    new Paragraph({ text: `Cahier de campagne — ${campaign.title}`, heading: HeadingLevel.TITLE }),
    new Paragraph({
      children: [new TextRun({ text: `${campaign.id} — statut : ${campaign.status}`, italics: true })],
    }),
  ]

  for (const { test: t } of entries) {
    children.push(new Paragraph({ text: `${t.id} — ${t.title}`, heading: HeadingLevel.HEADING_2 }))
    children.push(new Paragraph({
      children: [new TextRun({ text: `Type : ${t.objectTypeRef}    Statut : ${t.status}`, italics: true })],
    }))
  }

  await writeDoc(children, destPath)
}

/** Rapport de campagne — export docx (T43 sprint 2) : résultat d'exécution par test (libellés FR
 *  via `TEST_RUN_STATUS_LABELS`, cohérents avec l'affichage écran de `campaign.$campaignId.tsx`),
 *  pas d'équivalent xlsx (cf. `campaign.xlsx.ts`). */
export async function exportCampaignReportDocx(
  payload: CampaignExportPayload,
  destPath: string,
): Promise<void> {
  const { campaign, entries } = payload
  const children: Paragraph[] = [
    new Paragraph({ text: `Rapport de campagne — ${campaign.title}`, heading: HeadingLevel.TITLE }),
    new Paragraph({
      children: [new TextRun({ text: `${campaign.id} — statut : ${campaign.status}`, italics: true })],
    }),
  ]

  for (const { run, test: t } of entries) {
    const status = run.status
    children.push(new Paragraph({ text: `${t.id} — ${t.title}`, heading: HeadingLevel.HEADING_2 }))
    children.push(new Paragraph({
      children: [new TextRun({ text: `Résultat : ${TEST_RUN_STATUS_LABELS[status]}`, bold: true })],
    }))
    if (run.executedAt) {
      children.push(new Paragraph({
        text: `Exécuté le ${run.executedAt}${run.executedBy ? ' par ' + run.executedBy : ''}`,
      }))
    }
  }

  await writeDoc(children, destPath)
}

async function writeDoc(children: Paragraph[], destPath: string): Promise<void> {
  const doc = new Document({ sections: [{ children }] })
  const buffer = await Packer.toBuffer(doc)
  await fsP.writeFile(destPath, buffer)
}
