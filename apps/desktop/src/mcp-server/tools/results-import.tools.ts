import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContainer } from '../container'
import { errorToolResult, jsonToolResult } from '../mcp-types'
import { ResultsImportError } from '../../main/services/results-import.service'
import { expandResultFiles } from '../../main/services/results-import-files.util'

/**
 * GH129 — import de résultats JUnit (specs/GH129.md §5) : même service et même rapport que la commande
 * `polenta import-results --json`. Dry run par défaut ; jamais de commit.
 */
export function registerResultsImportTools(server: McpServer, container: McpContainer): void {
  server.registerTool(
    'import_test_results',
    {
      title: 'Import test results (JUnit)',
      description:
        'Importe des rapports JUnit XML comme exécutions (TestRun) des cas de test : correspondance par le champ ' +
        '`automationId` du test (`classname.name` puis `name`), secours par la propriété JUnit `requirement` ' +
        '(un seul test sans automationId couvrant l’exigence). `campaignId` : rattache les runs aux entrées de la ' +
        'campagne (`testedVersion` exigée si le repo a une version sélectionnable). DRY RUN PAR DÉFAUT : relire le ' +
        'rapport (non mappés, ambigus, avertissements) puis relancer avec `dryRun: false`. Aucun commit.',
      inputSchema: {
        files: z.array(z.string()).min(1).describe('Fichiers ou motifs glob (absolus, ou relatifs au repo)'),
        campaignId: z.string().optional(),
        testedVersion: z.string().optional().describe('Version testée : ID, label, ou texte libre (écart non documenté)'),
        executedBy: z.string().optional().describe('Testeur ; absent : --user du serveur, sinon user.name git'),
        dryRun: z.boolean().optional().describe('Défaut true : rien n’est écrit'),
      },
    },
    async ({ files, campaignId, testedVersion, executedBy, dryRun }) => {
      try {
        const paths = await expandResultFiles(files, container.repoPath)
        const tester = executedBy ?? container.user
        return jsonToolResult(await container.resultsImport.importJunit({
          repoPath: container.repoPath,
          workspaceDir: container.workspaceDir,
          files: paths,
          displayBase: container.repoPath,
          dryRun: dryRun ?? true,
          ...(campaignId && { campaignId }),
          ...(testedVersion && { testedVersion }),
          ...(tester && { executedBy: tester }),
        }))
      } catch (err) {
        if (err instanceof ResultsImportError) {
          return errorToolResult(err.partial ? `${err.message}\n${JSON.stringify(err.partial)}` : err.message)
        }
        throw err
      }
    },
  )
}
