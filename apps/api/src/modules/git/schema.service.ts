import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as path from 'path'
import * as fs from 'fs/promises'
import * as yaml from 'js-yaml'
import type { ProjectSchema } from '@polenta/types'

/**
 * SchemaService — lit et met en cache le schéma .polenta/schema.yaml de chaque projet.
 *
 * Pour un SystemNode avec `url` (submodule), le repo du composant est cloné localement
 * dans `<GIT_REPOS_BASE_PATH>/<projectId>/components/<nodeName>`.
 * Pour un nœud local (pas d'url), on retourne le repo produit lui-même.
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
   * - Nœud local (pas d'url) → repo produit
   * - Nœud submodule (url présente) → composant cloné sous components/<nodeName>
   */
  async repoPathForNode(projectId: string, nodeName: string): Promise<string> {
    const schema = await this.getSchema(projectId)
    if (!schema) {
      // Pas de schéma = projet simple, tout va dans le repo produit
      return this.productRepoPath(projectId)
    }

    const node = schema.nodes.find((n: import('@polenta/types').SystemNode) => n.name === nodeName)
    if (!node) {
      this.logger.warn(`Node "${nodeName}" not found in schema of project ${projectId} — falling back to product repo`)
      return this.productRepoPath(projectId)
    }

    if (!node.url) {
      // Nœud local : on écrit dans le repo produit
      return this.productRepoPath(projectId)
    }

    // Nœud submodule : repo cloné localement
    return path.join(this.productRepoPath(projectId), 'components', nodeName)
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
