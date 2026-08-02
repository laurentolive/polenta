import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as path from 'path'
import * as fs from 'fs/promises'
import * as yaml from 'js-yaml'
import type { ProjectSchema } from '@polenta/types'
import { findSystemNode } from '@polenta/types'

/**
 * SchemaService — lit et met en cache le schéma .polenta/schema.yaml de chaque projet.
 *
 * Depuis T69/T123, `SystemNode` n'a plus de champ `url` : les composants en repo séparé
 * sont déclarés via `polenta-repo.yaml` (workspace tree), pas dans schema.yaml. Ce module
 * n'implémente pas la lecture du workspace tree (pas de WorkspaceTreeService côté API) —
 * `repoPathForNode` ne sait donc résoudre que des nœuds locaux (root + enfants imbriqués,
 * `SystemNode.children`) et retourne toujours le repo produit.
 */
@Injectable()
export class SchemaService {
  private readonly logger = new Logger(SchemaService.name)
  private readonly reposBasePath: string
  private readonly schemaCache = new Map<string, ProjectSchema>()

  constructor(private readonly config: ConfigService) {
    this.reposBasePath = config.getOrThrow('GIT_REPOS_BASE_PATH')
  }

  /** Chemin racine du repo produit */
  private productRepoPath(projectId: string): string {
    return path.join(this.reposBasePath, projectId)
  }

  /**
   * Lit le schéma depuis le repo produit (branche `main` par défaut).
   * Le résultat est mis en cache (invalidé uniquement explicitement via `invalidate`).
   */
  async getSchema(projectId: string): Promise<ProjectSchema | null> {
    if (this.schemaCache.has(projectId)) {
      return this.schemaCache.get(projectId)!
    }
    return this.loadSchema(projectId)
  }

  /** Force la relecture du schéma (après un commit qui touche schema.yaml). */
  invalidate(projectId: string): void {
    this.schemaCache.delete(projectId)
  }

  /**
   * Retourne le chemin absolu du repo git à utiliser pour lire/écrire un objet
   * appartenant au nœud `nodeName`.
   *
   * Sans support du workspace tree (polenta-repo.yaml) côté API, tout nœud — local ou,
   * faute de mieux, non résolu — retombe sur le repo produit. Un vrai composant en repo
   * séparé nécessiterait la même résolution que `WorkspaceTreeService` côté desktop.
   */
  async repoPathForNode(projectId: string, nodeName: string): Promise<string> {
    const schema = await this.getSchema(projectId)
    if (!schema) {
      // Pas de schéma = projet simple, tout va dans le repo produit
      return this.productRepoPath(projectId)
    }

    const node = findSystemNode(schema.nodes, nodeName)
    if (!node) {
      this.logger.warn(`Node "${nodeName}" not found in schema of project ${projectId} — falling back to product repo`)
    }

    return this.productRepoPath(projectId)
  }

  /**
   * Parse le nodeName depuis un objectTypeRef au format "nodeName::typeName".
   * Si le format ne contient pas "::", on retourne "root" (nœud local par défaut).
   */
  parseNodeName(objectTypeRef: string): string {
    const sep = objectTypeRef.indexOf('::')
    if (sep < 0) return 'root'
    return objectTypeRef.slice(0, sep)
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private async loadSchema(projectId: string): Promise<ProjectSchema | null> {
    const schemaPath = path.join(this.productRepoPath(projectId), '.polenta', 'schema.yaml')
    try {
      const raw = await fs.readFile(schemaPath, 'utf-8')
      const schema = yaml.load(raw) as ProjectSchema
      this.schemaCache.set(projectId, schema)
      this.logger.debug(`Schema loaded for project ${projectId} (${schema.nodes.length} nodes)`)
      return schema
    } catch {
      this.logger.debug(`No schema.yaml found for project ${projectId}`)
      return null
    }
  }
}
