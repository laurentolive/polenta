import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import {
  isValidIntegrationSuffix,
  type CreateRepoRequest, type CreateRepoResult, type ProvisionStep, type ProvisionStepId, type WorkspaceOpenResult,
} from '@polenta/types'

import type { SyncService } from '../sync.service'
import type { WorkspaceService } from '../workspace.service'
import type { ForgeService } from './forge.service'
import { assertRepoName } from './forge-provider'

const ORDER: ProvisionStepId[] = ['remote', 'local', 'push', 'defaultBranch', 'members', 'open']

/**
 * GH107 — « Ajouter un repo » en mode Nouveau repo (spec GH103 §2.2, design §3.1). Tout est validé
 * avant la première écriture. Le repo distant n'est jamais supprimé : après un échec, les étapes
 * suivantes sont `skipped` et l'écran indique le repo créé et comment reprendre.
 */
export class RepoProvisioningService {
  constructor(
    private readonly forge: ForgeService,
    private readonly workspace: WorkspaceService,
    private readonly sync: SyncService,
  ) {}

  async create(req: CreateRepoRequest): Promise<CreateRepoResult> {
    const branch = `int-${req.integrationSuffix}`
    const description = req.description.trim()
    // Validation complète : aucune écriture (distante ou locale) si un champ est refusé.
    assertRepoName(req.name)
    if (!description) throw new Error('La description est obligatoire.')
    if (!isValidIntegrationSuffix(req.integrationSuffix)) {
      throw new Error(`« ${branch} » : après « int- », lettres, chiffres, « - », « _ » et « . » seulement.`)
    }
    const projectDir = req.target.kind === 'project' ? path.join(req.target.containerDir, req.name) : null
    if (projectDir && fs.existsSync(projectDir) && (await fsPromises.readdir(projectDir)).length > 0) {
      throw new Error(`Le dossier « ${projectDir} » existe déjà et n'est pas vide : choisissez un autre emplacement.`)
    }

    // 1. remote — un échec arrête tout, rien n'a été écrit (le nom est revérifié ici).
    const remote = await this.forge.createRemote(req.accountKey, {
      owner: req.owner, ownerKind: req.ownerKind, name: req.name, description, visibility: req.visibility, defaultBranch: branch,
    })
    const steps: ProvisionStep[] = [{ id: 'remote', status: 'done', detail: remote.fullName }]
    const result = (open?: WorkspaceOpenResult): CreateRepoResult => ({
      steps: ORDER.map(id => steps.find(s => s.id === id) ?? { id, status: 'skipped' }),
      fullName: remote.fullName, cloneUrl: remote.cloneUrl, branch, ...(open ? { open } : {}),
    })
    const failed = (id: ProvisionStepId, err: unknown): CreateRepoResult => {
      steps.push({ id, status: 'failed', detail: err instanceof Error ? err.message : String(err) })
      return result()
    }

    const tmp = projectDir ? null : await fsPromises.mkdtemp(path.join(os.tmpdir(), 'polenta-composant-'))
    const dir = projectDir ?? path.join(tmp!, req.name)
    try {
      // 2. local — contenu d'un nouveau projet, premier commit sur int-x (aucune branche main).
      try {
        await this.workspace.initProjectRepo(dir, { integrationBranch: branch, name: req.name, description })
        await git.addRemote({ fs, dir, remote: 'origin', url: remote.cloneUrl, force: true })
        if (req.target.kind === 'project') await this.workspace.initWorkspace(req.target.containerDir, dir)
        steps.push({ id: 'local', status: 'done' })
      } catch (err) {
        return failed('local', err)
      }

      // 3. push
      try {
        await this.sync.pushBranch(dir, branch)
        steps.push({ id: 'push', status: 'done' })
      } catch (err) {
        return failed('push', err)
      }

      // 4. defaultBranch — seulement après un push réussi ; un refus n'arrête pas la suite.
      const aligned = await this.forge.alignDefaultBranch(dir, branch)
      if (aligned === 'set' || aligned === 'unchanged') steps.push({ id: 'defaultBranch', status: 'done' })
      else {
        steps.push({
          id: 'defaultBranch', status: 'failed',
          detail: aligned === 'not-admin' ? 'Droit administrateur requis sur le repo.'
            : aligned === 'no-forge' ? 'Compte de la forge introuvable.'
              : aligned === 'push-pending' ? `La branche ${branch} n'est pas encore sur le serveur.` : aligned.error,
        })
      }

      // 5. members — un échec n'arrête pas les suivants.
      if (req.members.length > 0) {
        const errors: string[] = []
        const invited: string[] = []
        for (const grant of req.members) {
          try {
            if (await this.forge.grantMember(req.accountKey, req.owner, req.name, grant) === 'invited') invited.push(grant.name)
          } catch (err) {
            errors.push(`${grant.name} : ${err instanceof Error ? err.message : String(err)}`)
          }
        }
        const notes = [...errors, ...(invited.length ? [`Invitation à accepter : ${invited.join(', ')}`] : [])]
        steps.push({ id: 'members', status: errors.length ? 'failed' : 'done', ...(notes.length ? { detail: notes.join('\n') } : {}) })
      } else {
        steps.push({ id: 'members', status: 'done' })
      }

      // 6. open — projet ouvert ; composant : URL et branche rendues à la fenêtre d'ajout.
      if (req.target.kind === 'project') {
        try {
          const open = await this.workspace.openWorkspace(req.target.containerDir)
          steps.push({ id: 'open', status: 'done' })
          return result(open)
        } catch (err) {
          return failed('open', err)
        }
      }
      steps.push({ id: 'open', status: 'done' })
      return result()
    } finally {
      if (tmp) await fsPromises.rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
  }
}
