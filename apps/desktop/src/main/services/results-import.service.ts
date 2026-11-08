import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import * as path from 'path'
import { execFile } from 'child_process'
import git from 'isomorphic-git'
import { prepareRunFields } from '@polenta/types'
import type {
  CampaignTestRun, ProjectSchema, ResultsImportErrorCode, ResultsImportItem, ResultsImportReason, ResultsImportRejection,
  ResultsImportReport, ResultsImportWarning, TestCampaign, TestCase, TestRun, TestRunResult, WorkspaceLink, WorkspaceObject,
} from '@polenta/types'
import type { CampaignsService } from './campaigns.service'
import type { GitService } from './git.service'
import type { TestsService } from './tests.service'
import type { TestsIndexService } from './tests-index.service'
import type { RequirementsIndexService } from './requirements-index.service'
import type { TestedConfigService } from './tested-config.service'
import type { WorkspaceLinksService } from './workspace-links.service'
import type { WorkspaceTreeService } from './workspace-tree.service'
import { resolveWorkspaceRepoPaths } from './workspace-repos.util'
import { repoKey } from './schema-refs.util'
import { TestedVersionError } from './tested-config.service'
import { FieldWriteError } from './field-write.util'
import { findObjectTypeDef, isRefInReadonlyNode } from './schema-lookup.util'
import { matchCoverageLink } from './traceability.service'
import { plainTextToMarkdown } from './plain-text-markdown.util'
import { junitKey, parseJunit, type JunitResult } from './junit-report.util'

/** Champ de correspondance d'un type de test (spec §2.1, Q4). */
export const AUTOMATION_FIELD = 'automationId'

export interface ResultsImportOptions {
  repoPath: string
  workspaceDir?: string
  /** Chemins de fichiers déjà développés (les motifs sont l'affaire de l'appelant). */
  files: string[]
  /** Dossier depuis lequel les fichiers sont affichés dans le rapport (relatifs s'ils y sont). */
  displayBase?: string
  campaignId?: string
  /** GH202 — ID, label ou texte libre (écart non documenté). */
  testedVersion?: string
  /** Absent : `user.name` de la config git du repo, sinon vide. */
  executedBy?: string
  dryRun: boolean
}

/** Erreur globale (spec §4, code 2) : rien n'est écrit, sauf `write_failed` (rapport partiel). */
export class ResultsImportError extends Error {
  constructor(readonly code: ResultsImportErrorCode, message: string, readonly partial?: ResultsImportReport) {
    super(`${code}: ${message}`)
  }
}

interface TestEntry { test: TestCase; repoPath: string; readonly: boolean }

/** Résultats d'une invocation regroupés par cas de test (et entrée de campagne), spec §2.4. */
interface Group {
  target: TestEntry
  entry?: CampaignTestRun
  results: JunitResult[]
}

const VERDICT_RANK: Record<TestRunResult, number> = { FAIL: 3, BLOCKED: 2, INCOMPLETE: 1, PASS: 0 }

function worst(results: JunitResult[]): TestRunResult {
  return results.map(r => r.verdict as TestRunResult)
    .reduce((a, b) => (VERDICT_RANK[b] > VERDICT_RANK[a] ? b : a), 'PASS')
}

const sameInstant = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime()

const sameEntry = (run: TestRun, campaignId?: string, entryId?: string) =>
  (run.campaignEntry?.campaignId ?? null) === (campaignId ?? null) && (run.campaignEntry?.entryId ?? null) === (entryId ?? null)

/**
 * `user.name` de la config git du dépôt qui contient `repoPath` (un projet peut en être un
 * sous-dossier) : `git config` (local, worktree, global), sinon lecture directe du dépôt
 * (isomorphic-git, sans binaire git).
 */
export async function gitUserName(repoPath: string): Promise<string> {
  const viaCli = await new Promise<string | null>(resolve => {
    execFile('git', ['config', 'user.name'], { cwd: repoPath, timeout: 5000, windowsHide: true }, (err, stdout) => {
      // Code 1 : clé absente, réponse fiable ; autre échec (git absent…) : repli.
      if (err) resolve((err as { code?: unknown }).code === 1 ? '' : null)
      else resolve(stdout.trim())
    })
  })
  if (viaCli !== null) return viaCli
  try {
    const dir = await git.findRoot({ fs, filepath: repoPath })
    const name = await git.getConfig({ fs, dir, path: 'user.name' })
    return typeof name === 'string' ? name.trim() : ''
  } catch {
    return ''
  }
}

/**
 * GH129 — import de résultats JUnit sans interface (specs/GH129.md, design §3). Même écriture que
 * l'exécution dans l'outil et l'import du classeur : `TestsService.execute`, puis
 * `CampaignsService.updateRun` pour une entrée de campagne. Jamais de commit.
 */
export class ResultsImportService {
  constructor(
    private readonly deps: {
      git: Pick<GitService, 'readYaml'>
      tests: Pick<TestsService, 'execute' | 'typeDefFor' | 'findRuns'>
      testsIndex: Pick<TestsIndexService, 'invalidate' | 'findAll'>
      reqIndex: Pick<RequirementsIndexService, 'invalidate'>
      campaigns: Pick<CampaignsService, 'get' | 'updateRun' | 'approvalPredicate' | 'effectiveTests'>
      workspaceLinks: Pick<WorkspaceLinksService, 'listObjects' | 'listLinks'>
      workspaceTree?: WorkspaceTreeService
      testedConfig?: Pick<TestedConfigService, 'resolve'>
    },
  ) {}

  async importJunit(options: ResultsImportOptions): Promise<ResultsImportReport> {
    const { deps } = this
    const o = { ...options, repoPath: path.resolve(options.repoPath) }
    const isRoot = (p: string) => repoKey(p) === repoKey(o.repoPath)
    if (o.files.length === 0) throw new ResultsImportError('no_files', 'no JUnit file given')

    // 1. Lecture de tous les fichiers avant toute écriture.
    const results: JunitResult[] = []
    const label = (file: string) => {
      if (!o.displayBase) return file
      const rel = path.relative(o.displayBase, file)
      return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : file
    }
    for (const file of o.files) {
      let xml: string
      try {
        xml = await fsPromises.readFile(file, 'utf-8')
      } catch (err) {
        throw new ResultsImportError('file_unreadable', `${file}: ${err instanceof Error ? err.message : String(err)}`)
      }
      const parsed = parseJunit(xml, label(file))
      if ('fatal' in parsed) throw new ResultsImportError('invalid_xml', `${file}: ${parsed.fatal}`)
      results.push(...parsed)
    }

    // 2. Objets et liens du workspace, relus (process sans watcher).
    const repoPaths = await resolveWorkspaceRepoPaths(deps.workspaceTree, o.repoPath, o.workspaceDir)
    for (const p of repoPaths) {
      deps.testsIndex.invalidate(p)
      deps.reqIndex.invalidate(p)
    }
    const [objects, links, schemaList]: [WorkspaceObject[], WorkspaceLink[], Array<ProjectSchema | null>] = await Promise.all([
      deps.workspaceLinks.listObjects(o.repoPath, o.workspaceDir),
      deps.workspaceLinks.listLinks(o.repoPath, o.workspaceDir, true),
      Promise.all(repoPaths.map(p => deps.git.readYaml<ProjectSchema>(p, '.polenta/schema.yaml').catch(() => null))),
    ])
    const schemas = new Map<string, ProjectSchema | null>(repoPaths.map((p, i) => [repoKey(p), schemaList[i]]))

    const testRepo = new Map(objects.filter(x => x.category === 'test').map(x => [x.id, x]))
    const requirementIds = new Set(objects.filter(x => x.category === 'requirement').map(x => x.id))
    const tests: TestEntry[] = []
    for (const p of [...new Set([...testRepo.values()].map(x => x.repoPath))]) {
      for (const test of await deps.testsIndex.findAll(p)) {
        const obj = testRepo.get(test.id)
        if (!obj || obj.repoPath !== p) continue
        const schema = schemas.get(repoKey(p)) ?? null
        const typeDef = schema ? findObjectTypeDef(schema, test.objectTypeRef, 'test') : null
        const status = typeDef && typeDef !== 'unresolvable' ? typeDef.statuses?.find(s => s.name === test.status) : undefined
        if (status?.isTerminal) continue
        tests.push({ test, repoPath: p, readonly: obj.readonly || (!!schema && isRefInReadonlyNode(schema, test.objectTypeRef)) })
      }
    }
    const automationOf = (t: TestCase) => {
      const v = t.fields?.[AUTOMATION_FIELD]
      return typeof v === 'string' ? v : ''
    }
    const byAutomation = new Map<string, TestEntry[]>()
    for (const t of tests) {
      const key = automationOf(t.test)
      if (key) byAutomation.set(key, [...(byAutomation.get(key) ?? []), t])
    }
    const hasAutomationField = [...schemas.values()].some(s => s?.nodes.some(n => (n.objectTypes ?? [])
      .some(ty => ty.category === 'test' && ty.fields?.some(f => f.name === AUTOMATION_FIELD))))
    // Exigence → tests qui la couvrent (lien dans un sens ou dans l'autre, `matchCoverageLink`).
    const testIds = new Set(tests.map(t => t.test.id))
    const coveredBy = new Map<string, Set<string>>()
    for (const link of links) {
      const m = matchCoverageLink(link, testIds, requirementIds)
      if (m) coveredBy.set(m.reqId, (coveredBy.get(m.reqId) ?? new Set<string>()).add(m.testId))
    }

    const warnings: ResultsImportWarning[] = []
    if (!o.campaignId && o.testedVersion?.trim()) {
      warnings.push({ code: 'tested_version_ignored', detail: 'the tested version is recorded on campaign runs only (--campaign)' })
    }
    if (!hasAutomationField) warnings.push({ code: 'no_automation_field', detail: `no test type declares the field ${AUTOMATION_FIELD}` })

    // 3. Campagne et version testée, contrôlées avant toute écriture.
    let campaign: TestCampaign | undefined
    let effective: Map<string, { test: TestCase }> | undefined
    if (o.campaignId) {
      try {
        campaign = await deps.campaigns.get(o.repoPath, o.campaignId)
      } catch (err) {
        // Seule l'absence du fichier est « introuvable » ; un YAML illisible remonte tel quel.
        if (err instanceof Error && err.message.startsWith('Campaign not found')) {
          throw new ResultsImportError('campaign_not_found', `campaign ${o.campaignId} not found`)
        }
        throw err
      }
      if (campaign.status === 'completed' || campaign.status === 'abandoned') {
        throw new ResultsImportError('campaign_closed', `campaign ${o.campaignId} is ${campaign.status}`)
      }
      effective = await deps.campaigns.effectiveTests(o.repoPath, campaign)
      if (deps.testedConfig) {
        try {
          const config = await deps.testedConfig.resolve(
            o.repoPath, o.testedVersion?.trim() ? { version: o.testedVersion.trim() } : undefined, o.workspaceDir, { required: true },
          )
          if (config?.undocumented) {
            warnings.push({ code: 'tested_version_undocumented', detail: `"${config.undocumented}" is not a version of the repository` })
          }
        } catch (err) {
          if (err instanceof TestedVersionError) {
            throw new ResultsImportError('tested_version_required', 'the campaign repository has a selectable version: pass --tested-version')
          }
          throw err
        }
      }
    }

    // 4. Correspondance.
    const notImported: ResultsImportRejection[] = []
    const reject = (r: JunitResult, reason: ResultsImportReason, extra: Partial<ResultsImportRejection> = {}) =>
      notImported.push({ file: r.file, testcase: junitKey(r), reason, ...extra })
    const groups = new Map<string, Group>()
    let skipped = 0
    const undated = new Set<string>()
    const now = new Date().toISOString()

    for (const r of results) {
      if (r.verdict === 'SKIPPED') { skipped++; continue }
      if (!r.executedAt && !undated.has(r.file)) {
        undated.add(r.file)
        warnings.push({ code: 'no_timestamp', file: r.file, detail: 'no testsuite timestamp: the import date is used and a re-import is not detected' })
      }

      let candidates = (r.classname && byAutomation.get(`${r.classname}.${r.name}`)) || byAutomation.get(r.name) || []
      let byRequirement = false
      if (candidates.length === 0 && r.requirements.length > 0) {
        const known = r.requirements.filter(id => requirementIds.has(id))
        for (const id of r.requirements.filter(id => !requirementIds.has(id))) {
          warnings.push({ code: 'unknown_requirement', file: r.file, testcase: junitKey(r), detail: id })
        }
        const linked = new Set(known.flatMap(id => [...(coveredBy.get(id) ?? [])]))
        candidates = tests.filter(t => linked.has(t.test.id) && !automationOf(t.test))
        byRequirement = candidates.length > 0
      }
      if (candidates.length === 0) { reject(r, 'unmapped'); continue }
      if (candidates.length > 1) { reject(r, 'ambiguous', { candidates: candidates.map(c => c.test.id).sort() }); continue }
      const target = candidates[0]
      if (byRequirement) {
        warnings.push({ code: 'mapped_by_requirement', file: r.file, testcase: junitKey(r), testId: target.test.id, detail: `set ${AUTOMATION_FIELD} on ${target.test.id}` })
      }

      let entry: CampaignTestRun | undefined
      if (campaign) {
        const entries = isRoot(target.repoPath) ? campaign.runs.filter(e => e.testCaseId === target.test.id) : []
        const picked = entries.length > 1 ? entries.filter(e => e.requirementId && r.requirements.includes(e.requirementId)) : entries
        if (entries.length === 0) { reject(r, 'not_in_campaign', { candidates: [target.test.id] }); continue }
        if (picked.length !== 1) { reject(r, 'ambiguous', { candidates: entries.map(e => e.entryId) }); continue }
        entry = picked[0]
      }
      if (target.readonly) { reject(r, 'readonly_node', { candidates: [target.test.id] }); continue }

      const key = `${repoKey(target.repoPath)}|${target.test.id}|${entry?.entryId ?? ''}`
      const group = groups.get(key) ?? { target, ...(entry && { entry }), results: [] }
      group.results.push(r)
      groups.set(key, group)
    }

    // 5–6. Agrégation et contrôles, identiques en dry run.
    const approvals = new Map<string, (t: TestCase) => boolean>()
    const executedBy = o.executedBy ?? await gitUserName(o.repoPath)
    const planned: Array<{ group: Group; result: TestRunResult; executedAt: string; duration: number; notes: string }> = []
    const alreadyImported: ResultsImportReport['alreadyImported'] = []

    for (const group of groups.values()) {
      const { target, entry } = group
      const result = worst(group.results)
      // Date la plus récente des résultats datés ; aucun daté : instant de l'import.
      const executedAt = group.results.map(r => r.executedAt).filter((d): d is string => !!d).sort().at(-1) ?? now
      const duration = group.results.reduce((s, r) => s + r.duration, 0)

      const runs = await deps.tests.findRuns(target.repoPath, target.test.id)
      const previous = runs.find(run => run.origin === 'junit-import' && sameInstant(run.executedAt, executedAt)
        && sameEntry(run, entry && campaign?.id, entry?.entryId))
      if (previous) {
        alreadyImported.push({ testId: target.test.id, ...(entry && { entryId: entry.entryId }), runId: previous.id })
        // Run écrit mais entrée restée sans résultat (import interrompu entre les deux écritures) :
        // l'entrée est complétée avec ce run.
        if (entry && campaign && entry.status === 'pending' && !o.dryRun) {
          await deps.campaigns.updateRun(o.repoPath, campaign.id, entry.entryId, previous.result, previous.id, {
            executedAt: previous.executedAt, ...(previous.executedBy && { executedBy: previous.executedBy }),
          })
        }
        continue
      }

      const typeDef = await deps.tests.typeDefFor(target.repoPath, target.test.objectTypeRef).catch(() => null)
      const fields = prepareRunFields(typeDef, { result, stepResults: [] })
      if (!fields.ok) {
        for (const r of group.results) reject(r, 'required_field_missing', { candidates: [target.test.id], field: fields.field })
        continue
      }

      if (!approvals.has(target.repoPath)) approvals.set(target.repoPath, await deps.campaigns.approvalPredicate(target.repoPath))
      const shown = (entry && effective?.get(entry.entryId)?.test) || target.test
      if (!approvals.get(target.repoPath)!(shown)) warnings.push({ code: 'test_not_approved', testId: target.test.id })

      planned.push({ group, result, executedAt, duration, notes: notesOf(group.results) })
    }

    const imported: ResultsImportItem[] = []
    const report = (): ResultsImportReport => {
      const ambiguous = notImported.filter(n => n.reason === 'ambiguous').length
      const unmapped = notImported.filter(n => n.reason === 'unmapped').length
      return {
        dryRun: o.dryRun,
        files: o.files.map(label),
        counts: {
          results: results.length, imported: imported.length, alreadyImported: alreadyImported.length, skipped,
          unmapped, ambiguous, rejected: notImported.length - unmapped - ambiguous,
        },
        imported, alreadyImported, notImported, warnings,
        exitCode: notImported.length > 0 ? 1 : 0,
      }
    }

    // 7. Écriture séquentielle.
    for (const { group, result, executedAt, duration, notes } of planned) {
      const { target, entry } = group
      const item: ResultsImportItem = {
        testId: target.test.id,
        ...(!isRoot(target.repoPath) && { repo: target.repoPath }),
        ...(entry && { entryId: entry.entryId }),
        result,
        sources: group.results.map(r => `${r.file} · ${junitKey(r)}`),
      }
      if (!o.dryRun) {
        let written = false
        try {
          const run = await deps.tests.execute(target.repoPath, target.test.id, {
            stepResults: [],
            result,
            executedAt,
            ...(executedBy && { executedBy }),
            duration,
            notes,
            origin: 'junit-import',
            ...(entry && campaign && { campaignEntry: { campaignId: campaign.id, entryId: entry.entryId } }),
            ...(entry?.requirementId && { requirementId: entry.requirementId }),
            ...(entry && o.testedVersion?.trim() && { testedVersion: { version: o.testedVersion.trim() } }),
          }, o.workspaceDir)
          item.runId = run.id
          written = true
          if (entry && campaign) {
            await deps.campaigns.updateRun(o.repoPath, campaign.id, entry.entryId, result, run.id, {
              executedAt, ...(executedBy && { executedBy }),
            })
          }
        } catch (err) {
          // Champ d'exécution refusé par `execute` (type lu autrement qu'au contrôle) : ce résultat seul.
          if (!written && err instanceof FieldWriteError) {
            for (const r of group.results) reject(r, 'required_field_missing', { candidates: [target.test.id], field: err.field })
            continue
          }
          // Run écrit, entrée non mise à jour : le run figure dans le rapport partiel.
          if (written) imported.push(item)
          throw new ResultsImportError('write_failed', `${target.test.id}: ${err instanceof Error ? err.message : String(err)}`, report())
        }
      }
      imported.push(item)
    }
    return report()
  }
}

/** Notes du run : une ligne par résultat source, puis les propriétés de suite (texte brut échappé). */
function notesOf(results: JunitResult[]): string {
  const lines = results.map(r => [r.file, r.suite, junitKey(r), r.verdict, r.message.split('\n')[0]].filter(Boolean).join(' · '))
  // Propriétés de suite par fichier : deux fichiers peuvent porter des valeurs différentes.
  const props = new Map<string, string>()
  for (const r of results) {
    for (const [k, v] of r.suiteProperties) props.set(`${results.length > 1 ? `${r.file}: ` : ''}${k}`, v)
  }
  const details = results.filter(r => r.message.includes('\n')).map(r => `${junitKey(r)}:\n${r.message}`)
  return plainTextToMarkdown([
    'JUnit import',
    ...lines,
    ...[...props].map(([k, v]) => `${k} = ${v}`),
    ...details,
  ].join('\n'))
}
