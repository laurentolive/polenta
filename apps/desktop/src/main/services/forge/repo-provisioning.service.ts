import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import * as yaml from 'js-yaml'
import {
  isValidIntegrationSuffix,
  type AdoptRepoRequest, type CreateRepoRequest, type CreateRepoResult, type ProvisionStep, type ProvisionStepId,
  type RepoInspection, type RepoMemberGrant, type RepoMissing, type WorkspaceOpenResult,
} from '@polenta/types'

import { extractAgentsMdVersion } from '../agents-md.template'
import type { IntegrationBranchService } from '../integration-branch.service'
import type { SyncService } from '../sync.service'
import type { WorkspaceService } from '../workspace.service'
import type { ForgeService } from './forge.service'
import { assertRepoName } from './forge-provider'

const ORDER: ProvisionStepId[] = ['remote', 'local', 'push', 'defaultBranch', 'members', 'open']
const INT_PREFIX = 'int-'
const ADMIN_TODO = 'À faire par un administrateur du repo.'

const messageOf = (err: unknown) => err instanceof Error ? err.message : String(err)

/**
 * GH107 — « Ajouter un repo » (spec GH103 §2.2 et §2.3, design §3 et §4) : création d'un repo neuf,
 * inspection et adoption d'un repo existant. Tout est validé avant la première écriture. Le repo
 * distant n'est jamais supprimé : après un échec, les étapes suivantes ne sont pas faites et l'écran
 * indique le repo et comment reprendre.
 */
export class RepoProvisioningService {
  constructor(
    private readonly forge: ForgeService,
    private readonly workspace: WorkspaceService,
    private readonly sync: SyncService,
    private readonly integration: IntegrationBranchService,
  ) {}

  async create(req: CreateRepoRequest): Promise<CreateRepoResult> {
    const branch = `${INT_PREFIX}${req.integrationSuffix}`
    const description = req.description.trim()
    // Validation complète : aucune écriture (distante ou locale) si un champ est refusé.
    assertRepoName(req.name)
    this.assertNewContent(description, req.integrationSuffix)
    this.assertFreeFolder(req)

    // remote — un échec arrête tout, rien n'a été écrit (le nom est revérifié ici).
    const remote = await this.forge.createRemote(req.accountKey, {
      owner: req.owner, ownerKind: req.ownerKind, name: req.name, description, visibility: req.visibility, defaultBranch: branch,
    })
    return this.provisionEmpty(req, remote, branch, description, req.members, [{ id: 'remote', status: 'done', detail: remote.fullName }], ORDER)
  }

  /** Ce qui existe dans le repo, sans rien écrire (design §4.1, tableau du §2.3 de la spec). */
  async inspect(accountKey: string, owner: string, name: string): Promise<RepoInspection> {
    const details = await this.forge.repoDetails(accountKey, owner, name)
    if (!details) throw new Error(`Dépôt ${owner}/${name} introuvable (ou inaccessible avec ce compte).`)
    const fullName = `${owner}/${name}`
    const hasDescription = !!details.description.trim()
    const heads = await this.sync.remoteHeads(details.cloneUrl)
    if (heads.length === 0) {
      return { fullName, details, empty: true, integration: null, hasReadme: false, hasDescription, isPolentaProject: false, missing: [] }
    }
    const defaultBranch = heads.includes(details.defaultBranch) ? details.defaultBranch : (heads.find(h => h.startsWith(INT_PREFIX)) ?? heads[0])
    const tmp = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'polenta-inspection-'))
    try {
      const defaultDir = path.join(tmp, 'default')
      await this.sync.cloneBranchShallow(details.cloneUrl, defaultDir, defaultBranch)
      const designated = await readIntegrationBranch(defaultDir)
      const integration: RepoInspection['integration'] = defaultBranch.startsWith(INT_PREFIX)
        ? { branch: defaultBranch, source: 'default' }
        : designated?.startsWith(INT_PREFIX) && heads.includes(designated) ? { branch: designated, source: 'project-yaml' } : null
      // Présence vérifiée sur l'intégration, quand elle n'est pas la branche par défaut.
      let dir = defaultDir
      if (integration && integration.branch !== defaultBranch) {
        dir = path.join(tmp, 'integration')
        await this.sync.cloneBranchShallow(details.cloneUrl, dir, integration.branch)
      }
      const hasReadme = (await fsPromises.readdir(dir)).some(f => /^readme(\.md)?$/i.test(f))
      const isPolentaProject = await looksLikePolentaProject(dir)
      const missing: RepoMissing[] = [
        ...(integration ? [] : ['integration' as const]),
        ...(hasDescription && hasReadme ? [] : ['description' as const]),
        ...(isPolentaProject ? [] : ['polenta' as const]),
      ]
      return { fullName, details, empty: false, integration, hasReadme, hasDescription, isPolentaProject, missing }
    } finally {
      await fsPromises.rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
  }

  /** Complète un repo existant : seul ce qui manque, selon les droits du compte (design §4.2). */
  async adopt(req: AdoptRepoRequest): Promise<CreateRepoResult> {
    assertRepoName(req.name)
    this.assertFreeFolder(req)
    const found = await this.inspect(req.accountKey, req.owner, req.name)
    const { details, fullName } = found
    const canPush = details.permissions.push
    const description = (req.description ?? '').trim()

    if (found.empty) return this.adoptEmpty(req, found, description)
    if (!canPush) {
      // Rien n'est écrit (spec §2.3). Un projet Polenta s'ouvre tel quel, en lecture seule, même
      // incomplet (décision de l'humain, 2026-11-05) ; un autre repo incomplet est refusé.
      if (!found.isPolentaProject) throw new Error(`Vous n'avez pas le droit d'écriture sur ${fullName}, et il lui manque : ${found.missing.map(missingLabel).join(', ')}.`)
      return this.addAsIs(req, found)
    }
    if (found.missing.includes('polenta') && !req.initPolenta) {
      throw new Error(`${fullName} n'est pas un projet Polenta : confirmez son initialisation, ou abandonnez l'ajout.`)
    }
    const suffix = req.integrationSuffix ?? ''
    if (found.missing.includes('integration')) {
      if (!isValidIntegrationSuffix(suffix)) throw new Error(`« ${INT_PREFIX}${suffix} » : après « int- », lettres, chiffres, « - », « _ » et « . » seulement.`)
      if ((await this.sync.remoteHeads(details.cloneUrl)).includes(`${INT_PREFIX}${suffix}`)) throw new Error(`La branche ${INT_PREFIX}${suffix} existe déjà sur le serveur.`)
    }
    if (found.missing.includes('description') && !description) throw new Error('La description est obligatoire.')

    const branch = found.integration?.branch ?? `${INT_PREFIX}${suffix}`
    const steps: ProvisionStep[] = []
    const result = (open?: WorkspaceOpenResult): CreateRepoResult => ({ steps, fullName, cloneUrl: details.cloneUrl, branch, ...(open ? { open } : {}) })
    const failed = (id: ProvisionStepId, err: unknown) => {
      steps.push({ id, status: 'failed', detail: messageOf(err) })
      return result()
    }

    const { dir, cleanup } = await this.destination(req)
    try {
      try {
        await fsPromises.mkdir(dir, { recursive: true })
        await this.sync.clone(details.cloneUrl, dir)
        steps.push({ id: 'local', status: 'done' })
      } catch (err) {
        // Rien sur le serveur n'a changé : pas de dossier laissé, l'erreur reste dans l'assistant.
        await fsPromises.rm(dir, { recursive: true, force: true }).catch(() => {})
        throw err
      }

      // Intégration : créée et désignée, ou désignée (commit seulement si project.yaml diffère) ;
      // la désignation pousse et aligne la branche par défaut.
      let pushError: string | undefined
      let defaultBranch: Awaited<ReturnType<ForgeService['alignDefaultBranch']>> | undefined
      try {
        const outcome = found.integration
          ? await this.integration.designate(dir, found.integration.branch)
          : await this.integration.createAndDesignate(dir, suffix)
        if (!found.integration || outcome.committed) steps.push({ id: 'integration', status: 'done', detail: branch })
        if (typeof outcome.push === 'object') pushError = outcome.push.error
        defaultBranch = outcome.defaultBranch
      } catch (err) {
        return failed('integration', err)
      }

      // Description : sur la forge si admin, sinon signalée ; README.md commité sur l'intégration.
      if (found.missing.includes('description')) {
        try {
          let forgeTodo = false
          if (!found.hasDescription) {
            if (details.permissions.admin) await this.forge.updateRepo(req.accountKey, req.owner, req.name, { description })
            else forgeTodo = true
          }
          if (!found.hasReadme) await this.commitFile(dir, 'README.md', `# ${req.name}\n\n${description}\n`, 'Ajout du README')
          steps.push(forgeTodo ? { id: 'description', status: 'admin', detail: ADMIN_TODO } : { id: 'description', status: 'done' })
        } catch (err) {
          return failed('description', err)
        }
      }

      // Initialisation Polenta : seulement sur confirmation, sans écraser un fichier existant.
      if (found.missing.includes('polenta')) {
        try {
          for (const [file, content] of Object.entries(this.workspace.polentaInitFiles())) {
            if (!fs.existsSync(path.join(dir, file))) await this.commitFile(dir, file, content, `Initialisation ${file}`)
          }
          steps.push({ id: 'polenta', status: 'done' })
        } catch (err) {
          return failed('polenta', err)
        }
      }

      // Push de ce qui a été commité après la désignation.
      if (pushError) return failed('push', new Error(pushError))
      try {
        await this.sync.pushBranch(dir, branch)
        steps.push({ id: 'push', status: 'done' })
      } catch (err) {
        return failed('push', err)
      }
      const aligned = defaultBranch ?? await this.forge.alignDefaultBranch(dir, branch)
      steps.push(defaultBranchStep(aligned, branch))

      return await this.finish(req, dir, steps, result)
    } finally {
      await cleanup()
    }
  }

  /** Repo vide : parcours de création, sans l'étape `remote` (design §4.2). */
  private async adoptEmpty(req: AdoptRepoRequest, found: RepoInspection, description: string): Promise<CreateRepoResult> {
    const { details, fullName } = found
    if (!details.permissions.push) throw new Error(`Vous n'avez pas le droit d'écriture sur ${fullName}, et ce repo est vide.`)
    this.assertNewContent(description, req.integrationSuffix ?? '')
    const branch = `${INT_PREFIX}${req.integrationSuffix}`
    const steps: ProvisionStep[] = []
    const order: ProvisionStepId[] = ['description', ...ORDER.filter(id => id !== 'remote')]
    const visibility = req.visibility && req.visibility !== details.visibility ? req.visibility : undefined
    const newDescription = description !== details.description.trim() ? description : undefined
    if (visibility || newDescription !== undefined) {
      if (details.permissions.admin) {
        try {
          await this.forge.updateRepo(req.accountKey, req.owner, req.name, { description: newDescription, visibility })
          steps.push({ id: 'description', status: 'done' })
        } catch (err) {
          // Un refus (privé → public sur Forgejo) n'empêche pas de remplir le repo.
          steps.push({ id: 'description', status: 'failed', detail: messageOf(err) })
        }
      } else {
        steps.push({ id: 'description', status: 'admin', detail: ADMIN_TODO })
      }
    }
    const remote = { fullName, cloneUrl: details.cloneUrl }
    return this.provisionEmpty(req, remote, branch, description, req.members ?? [], steps, order.filter(id => id !== 'description' || steps.length > 0))
  }

  /** Clone simple, rien n'est écrit : lecture seule d'un projet Polenta. */
  private async addAsIs(req: AdoptRepoRequest, found: RepoInspection): Promise<CreateRepoResult> {
    const branch = found.integration?.branch ?? found.details.defaultBranch
    const steps: ProvisionStep[] = []
    const result = (open?: WorkspaceOpenResult): CreateRepoResult => ({
      steps, fullName: found.fullName, cloneUrl: found.details.cloneUrl, branch, ...(open ? { open } : {}),
    })
    if (req.target.kind === 'component') return result()
    const open = await this.workspace.createFromClone(req.target.containerDir, found.details.cloneUrl)
    steps.push({ id: 'local', status: 'done' }, { id: 'open', status: 'done' })
    return result(open)
  }

  /** Remplit un repo distant vide : local, push, branche par défaut, membres, ouverture. */
  private async provisionEmpty(
    req: Pick<CreateRepoRequest, 'accountKey' | 'owner' | 'name' | 'target'>,
    remote: { fullName: string; cloneUrl: string }, branch: string, description: string, members: RepoMemberGrant[],
    steps: ProvisionStep[], order: ProvisionStepId[],
  ): Promise<CreateRepoResult> {
    const result = (open?: WorkspaceOpenResult): CreateRepoResult => ({
      steps: order.map(id => steps.find(s => s.id === id) ?? { id, status: 'skipped' }),
      fullName: remote.fullName, cloneUrl: remote.cloneUrl, branch, ...(open ? { open } : {}),
    })
    const failed = (id: ProvisionStepId, err: unknown): CreateRepoResult => {
      steps.push({ id, status: 'failed', detail: messageOf(err) })
      return result()
    }

    const { dir, cleanup } = await this.destination(req)
    try {
      // local — contenu d'un nouveau projet, premier commit sur int-x (aucune branche main).
      try {
        await this.workspace.initProjectRepo(dir, { integrationBranch: branch, name: req.name, description })
        await git.addRemote({ fs, dir, remote: 'origin', url: remote.cloneUrl, force: true })
        steps.push({ id: 'local', status: 'done' })
      } catch (err) {
        return failed('local', err)
      }

      try {
        await this.sync.pushBranch(dir, branch)
        steps.push({ id: 'push', status: 'done' })
      } catch (err) {
        return failed('push', err)
      }

      // defaultBranch — seulement après un push réussi ; un refus n'arrête pas la suite.
      steps.push(defaultBranchStep(await this.forge.alignDefaultBranch(dir, branch), branch))

      // members — un échec n'arrête pas les suivants.
      const errors: string[] = []
      const invited: string[] = []
      for (const grant of members) {
        try {
          if (await this.forge.grantMember(req.accountKey, req.owner, req.name, grant) === 'invited') invited.push(grant.name)
        } catch (err) {
          errors.push(`${grant.name} : ${messageOf(err)}`)
        }
      }
      const notes = [...errors, ...(invited.length ? [`Invitation à accepter : ${invited.join(', ')}`] : [])]
      steps.push({ id: 'members', status: errors.length ? 'failed' : 'done', ...(notes.length ? { detail: notes.join('\n') } : {}) })

      return await this.finish(req, dir, steps, result)
    } finally {
      await cleanup()
    }
  }

  /** open — projet ouvert ; composant : URL et branche rendues à la fenêtre d'ajout. */
  private async finish(
    req: Pick<CreateRepoRequest, 'target'>, dir: string, steps: ProvisionStep[], result: (open?: WorkspaceOpenResult) => CreateRepoResult,
  ): Promise<CreateRepoResult> {
    if (req.target.kind === 'component') {
      steps.push({ id: 'open', status: 'done' })
      return result()
    }
    try {
      await this.workspace.initWorkspace(req.target.containerDir, dir)
      const open = await this.workspace.openWorkspace(req.target.containerDir)
      steps.push({ id: 'open', status: 'done' })
      return result(open)
    } catch (err) {
      steps.push({ id: 'open', status: 'failed', detail: messageOf(err) })
      return result()
    }
  }

  /** Dossier du projet, ou dossier temporaire d'un composant (supprimé à la fin). */
  private async destination(req: Pick<CreateRepoRequest, 'name' | 'target'>): Promise<{ dir: string; cleanup: () => Promise<void> }> {
    if (req.target.kind === 'project') return { dir: path.join(req.target.containerDir, req.name), cleanup: async () => {} }
    const tmp = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'polenta-composant-'))
    return { dir: path.join(tmp, req.name), cleanup: () => fsPromises.rm(tmp, { recursive: true, force: true }).catch(() => {}) }
  }

  private assertNewContent(description: string, suffix: string): void {
    if (!description) throw new Error('La description est obligatoire.')
    if (!isValidIntegrationSuffix(suffix)) throw new Error(`« ${INT_PREFIX}${suffix} » : après « int- », lettres, chiffres, « - », « _ » et « . » seulement.`)
  }

  private assertFreeFolder(req: Pick<CreateRepoRequest, 'name' | 'target'>): void {
    if (req.target.kind !== 'project') return
    const dir = path.join(req.target.containerDir, req.name)
    if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
      throw new Error(`Le dossier « ${dir} » existe déjà et n'est pas vide : choisissez un autre emplacement.`)
    }
  }

  /** Commit d'un seul fichier sur la branche courante, copie de travail alignée. */
  private async commitFile(dir: string, file: string, content: string, message: string): Promise<void> {
    await this.sync.commitSingleFile(dir, file, content, message)
    await fsPromises.writeFile(path.join(dir, file), content, 'utf-8')
  }
}

function defaultBranchStep(aligned: Awaited<ReturnType<ForgeService['alignDefaultBranch']>>, branch: string): ProvisionStep {
  if (aligned === 'set' || aligned === 'unchanged') return { id: 'defaultBranch', status: 'done' }
  if (aligned === 'not-admin') return { id: 'defaultBranch', status: 'admin', detail: ADMIN_TODO }
  return {
    id: 'defaultBranch', status: 'failed',
    detail: aligned === 'no-forge' ? 'Compte de la forge introuvable.'
      : aligned === 'push-pending' ? `La branche ${branch} n'est pas encore sur le serveur.` : aligned.error,
  }
}

function missingLabel(m: RepoMissing): string {
  return m === 'integration' ? 'une branche d\'intégration' : m === 'description' ? 'une description et un README' : 'l\'initialisation Polenta'
}

async function readIntegrationBranch(dir: string): Promise<string | undefined> {
  try {
    const raw = await fsPromises.readFile(path.join(dir, 'config', 'project.yaml'), 'utf-8')
    const value = (yaml.load(raw) as { integrationBranch?: unknown } | null)?.integrationBranch
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Projet Polenta : `.polenta/`, `integrationBranch` dans `config/project.yaml`, ou `AGENTS.md` généré
 * par Polenta — un projet neuf n'a pas de `.polenta/` tant que son schéma n'est pas enregistré.
 */
async function looksLikePolentaProject(dir: string): Promise<boolean> {
  if (fs.existsSync(path.join(dir, '.polenta'))) return true
  if (await readIntegrationBranch(dir)) return true
  const agents = await fsPromises.readFile(path.join(dir, 'AGENTS.md'), 'utf-8').catch(() => '')
  return extractAgentsMdVersion(agents) !== undefined
}
