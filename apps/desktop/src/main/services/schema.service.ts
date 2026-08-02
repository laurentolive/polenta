import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import git from 'isomorphic-git'
import type {
  LinkTypeDefinition,
  ObjectTypeDefinition,
  ProjectSchema,
  SchemaField,
  SchemaStatus,
  SystemNode,
} from '@polenta/types'
import { findSystemNode, flattenSystemNodes, mapSystemNode } from '@polenta/types'
import type { AuthService } from './auth.service'
import type { WorkspaceTreeService } from './workspace-tree.service'

const DEFAULT_SCHEMA: ProjectSchema = {
  version: 1,
  nodes: [{ name: 'root', label: 'Produit', readonly: false, objectTypes: [] }],
  linkTypes: [],
}

/**
 * Codes d'erreur des mutations ciblées de schéma (T122 sprint 3 —
 * specs/T122-design.md §4.1). Un code par invariant refusé, pour que l'appelant
 * (tool MCP) distingue programmatiquement le cas plutôt que de parser un message.
 */
export type SchemaValidationErrorCode =
  | 'NODE_NAME_TAKEN'
  | 'NODE_NOT_FOUND'
  | 'NODE_READONLY'
  | 'TYPE_NAME_TAKEN'
  | 'TYPE_NOT_FOUND'
  | 'PREFIX_TAKEN'
  | 'FIELD_NAME_TAKEN'
  | 'STATUS_NAME_TAKEN'
  | 'LINK_TYPE_NAME_TAKEN'

/**
 * Levée par les méthodes `addNode`/`addObjectType`/`addField`/`addStatus`/
 * `addLinkType` quand un invariant est violé — AVANT tout appel à `save()`, jamais
 * après (cf. specs/T122-design.md §4.1 : "Aucune n'écrit si la validation échoue").
 */
export class SchemaValidationError extends Error {
  constructor(
    public readonly code: SchemaValidationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SchemaValidationError'
  }
}

export class SchemaService {
  private cache = new Map<string, ProjectSchema>()

  constructor(
    private readonly auth: AuthService,
    private readonly workspaceTree?: WorkspaceTreeService,
  ) {}

  async get(repoPath: string): Promise<ProjectSchema> {
    if (this.cache.has(repoPath)) return this.cache.get(repoPath)!
    const schema = await this.readFromDisk(repoPath)
    this.cache.set(repoPath, schema)
    return schema
  }

  async save(repoPath: string, schema: ProjectSchema): Promise<void> {
    this.assertUniquePrefixes(schema)
    const toWrite = this.mirrorRootRolesImplements(schema)
    const dir = path.join(repoPath, '.polenta')
    await fsP.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, 'schema.yaml')
    await fsP.writeFile(filePath, yaml.dump(toWrite, { lineWidth: 120 }), 'utf-8')
    this.cache.set(repoPath, toWrite)
  }

  /**
   * Règle 10 CLAUDE.md : un `prefix` doit être unique sur tout le projet. `addObjectType`
   * le valide déjà, mais l'UI (StructureTab) sauvegarde par réécriture complète du schéma
   * via `save()` directement, sans jamais passer par `addObjectType` — sans ce check ici,
   * ce chemin (le seul que l'UI emprunte réellement) laissait deux types partager le même
   * prefix, ce qui fait collisionner leurs IDs générés (`nextCounterId` clé
   * `config/counters.yaml` par prefix seul, cf. `id-counter.util.ts`). Même limitation
   * documentée sur `findNodeUsingPrefix` : ne porte que sur `schema.nodes` du repo courant.
   */
  private assertUniquePrefixes(schema: ProjectSchema): void {
    const ownerByPrefix = new Map<string, string>()
    for (const { node } of flattenSystemNodes(schema.nodes)) {
      for (const type of node.objectTypes ?? []) {
        if (!type.prefix) continue
        const owner = ownerByPrefix.get(type.prefix)
        if (owner) {
          throw new SchemaValidationError(
            'PREFIX_TAKEN',
            `Le prefix "${type.prefix}" est utilisé par plusieurs types (nœuds "${owner}" et "${node.name}").`,
          )
        }
        ownerByPrefix.set(type.prefix, node.name)
      }
    }
  }

  /**
   * T123 — miroir, à CHAQUE sauvegarde, de `nodes[root].roles`/`.implements` vers les champs
   * dépréciés `ProjectSchema.roles`/`.implements` (niveau racine du fichier). Contrepartie de
   * `migrateRootRolesImplements` (lecture) : celle-ci ne copie le fichier vers le node qu'une
   * fois (idempotente, jamais destructive) ; celle-ci maintient l'inverse à jour en continu, pour
   * que `workspace-tree.service.ts`/`interface-compliance.service.ts` (qui lisent encore le
   * fichier directement, sans passer par SchemaService, cf. specs/T123-sprint1.md) voient toujours
   * la valeur la plus récente — y compris après une édition qui n'écrit plus que sur le node root
   * (StructureTab.tsx `handleSaveNodeLabel`/`handleSubmitEditDependency`,
   * `workspaceActions.ts::updateInterfaceRoles`, toutes T123). Centralisé ici plutôt que dupliqué
   * dans chacun de ces appelants — un seul choke point, jamais oublié par un futur appelant.
   * `root` absent (ne devrait jamais arriver) : no-op, le schema est écrit tel quel.
   */
  private mirrorRootRolesImplements(schema: ProjectSchema): ProjectSchema {
    const root = findSystemNode(schema.nodes, 'root')
    if (!root) return schema
    return {
      ...schema,
      roles: root.roles?.length ? root.roles : undefined,
      implements: root.implements?.length ? root.implements : undefined,
    }
  }

  invalidate(repoPath: string): void {
    this.cache.delete(repoPath)
  }

  private mutationQueues = new Map<string, Promise<unknown>>()

  /**
   * Sérialise les mutations de schéma pour un `repoPath` donné (trouvé en revue de
   * code) : un agent MCP peut enchaîner plusieurs `add_*` sur le même `repoPath` sans
   * attendre la réponse précédente (le protocole JSON-RPC stdio autorise le
   * pipelining) — sans sérialisation, deux `get()` concurrents liraient le même
   * schéma AVANT que l'un ou l'autre `save()` n'écrive, et le second `save()`
   * écraserait silencieusement la mutation du premier (perte de données, aucune
   * erreur). Même classe de bug que celle corrigée par T118 pour `counters.yaml`
   * (cf. `id-counter.util.ts`) — même remède (file de promesses par `repoPath`),
   * appliqué ici au niveau service plutôt qu'utilitaire partagé, car le graphe
   * get→mutate→save est spécifique à chaque méthode `add*` et n'a pas d'équivalent
   * générique déjà exporté.
   */
  private withMutationQueue<T>(repoPath: string, run: () => Promise<T>): Promise<T> {
    const prev = this.mutationQueues.get(repoPath) ?? Promise.resolve()
    const next = prev.then(run, run)
    this.mutationQueues.set(
      repoPath,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }

  // ── Mutations ciblées (T122 sprint 3 — specs/T122-design.md §4.1) ──────────────
  //
  // Chaque méthode : `get(repoPath)` → valide (jamais d'écriture si la validation
  // échoue, lève `SchemaValidationError` avant tout `save()`) → construit une copie
  // immuable du schéma avec la mutation appliquée → `save(repoPath, schema)`
  // (réécriture complète du fichier — atomicité au niveau du fichier, pas de nouveau
  // format, exactement ce que demande le spec T122). Les tableaux existants
  // (`schema.nodes`, `node.objectTypes`, `type.fields`, `type.statuses`,
  // `schema.linkTypes`) ne sont jamais mutés en place — l'objet en cache
  // (`this.cache`, potentiellement partagé avec d'autres appelants de `get()`)
  // reste intact tant que `save()` n'a pas remplacé l'entrée de cache par la copie.

  /**
   * Ajoute un `SystemNode` (composant local — pas de repo séparé, T113). Avec `parentName`
   * (T123), le nouveau nœud est imbriqué dans `children[]` du composant local désigné, à
   * n'importe quelle profondeur, plutôt qu'au niveau racine de `schema.nodes[]`.
   */
  async addNode(
    repoPath: string,
    dto: { name: string; label: string; description?: string; readonly?: boolean; parentName?: string },
  ): Promise<ProjectSchema> {
    return this.withMutationQueue(repoPath, async () => {
      const schema = await this.get(repoPath)
      // Unicité du nom sur tout l'arbre (T123 — pas seulement le premier niveau), décision
      // validée : un composant local ne peut pas partager son nom avec un autre composant du
      // même repo, même sous un parent différent (cf. specs/T123.md §Décisions #1).
      if (findSystemNode(schema.nodes, dto.name)) {
        throw new SchemaValidationError(
          'NODE_NAME_TAKEN',
          `Le nom de composant "${dto.name}" est déjà utilisé dans ce projet.`,
        )
      }
      const newNode: SystemNode = {
        name: dto.name,
        label: dto.label,
        readonly: dto.readonly ?? false,
        objectTypes: [],
        ...(dto.description ? { description: dto.description } : {}),
      }
      let nodes: SystemNode[]
      if (dto.parentName) {
        const parent = findSystemNode(schema.nodes, dto.parentName)
        if (!parent) {
          throw new SchemaValidationError(
            'NODE_NOT_FOUND',
            `Composant parent "${dto.parentName}" introuvable dans ce projet.`,
          )
        }
        nodes = mapSystemNode(schema.nodes, dto.parentName, (p) => ({
          ...p,
          children: [...(p.children ?? []), newNode],
        }))
      } else {
        nodes = [...schema.nodes, newNode]
      }
      const updated: ProjectSchema = { ...schema, nodes }
      await this.save(repoPath, updated)
      return updated
    })
  }

  /**
   * Ajoute un `ObjectTypeDefinition` à un nœud existant. `objectType.prefix` (si
   * fourni) doit être unique sur l'ensemble du projet, tous nœuds confondus — règle
   * 10 de CLAUDE.md. Limite connue (cf. `specs/T122-sprint3.md`) : ce scan ne porte
   * que sur `schema.nodes` DU REPO COURANT — les prefixes utilisés par un vrai
   * composant submodule (nœud avec `url`, dont le `schema.yaml` vit dans un autre
   * repo, non chargé ici) ne sont pas visibles, exactement comme le reste du serveur
   * MCP de ce ticket (mode mono-repo par défaut, cf. specs/T122-design.md §2.3).
   */
  async addObjectType(
    repoPath: string,
    dto: { nodeName: string; objectType: ObjectTypeDefinition },
  ): Promise<ProjectSchema> {
    return this.withMutationQueue(repoPath, async () => {
      const schema = await this.get(repoPath)
      const node = this.requireNode(schema, dto.nodeName)
      this.requireNotReadonly(node)
      if (node.objectTypes?.some((t) => t.name === dto.objectType.name)) {
        throw new SchemaValidationError(
          'TYPE_NAME_TAKEN',
          `Le type "${dto.objectType.name}" existe déjà dans le nœud "${dto.nodeName}".`,
        )
      }
      if (dto.objectType.prefix) {
        const takenBy = this.findNodeUsingPrefix(schema, dto.objectType.prefix)
        if (takenBy) {
          throw new SchemaValidationError(
            'PREFIX_TAKEN',
            `Le prefix "${dto.objectType.prefix}" est déjà utilisé par un type du nœud "${takenBy}".`,
          )
        }
      }
      const updated: ProjectSchema = {
        ...schema,
        nodes: mapSystemNode(schema.nodes, node.name, (n) => ({
          ...n,
          objectTypes: [...(n.objectTypes ?? []), dto.objectType],
        })),
      }
      await this.save(repoPath, updated)
      return updated
    })
  }

  /**
   * Déplace un `ObjectTypeDefinition` de `fromNodeName` vers `toNodeName`, dans le MÊME schéma
   * (T135 sprint 3 — drag & drop d'un élément vers un autre nœud). `prefix`/`name` du type ne
   * changent jamais — seul le nœud porteur change, donc `objectTypeRef` (`<nœud>::<type>`) change
   * de valeur ; l'appelant est responsable de la cascade de réécriture sur les
   * requirements/tests existants (délibérément pas fait ici : `RequirementsService`/
   * `TestsService` dépendent déjà de `SchemaService`, l'inverse créerait une dépendance
   * circulaire — cf. `element-move.service.ts`, seule dépendance des trois). No-op idempotent (pas
   * d'erreur, mêmes refs en entrée/sortie) si `fromNodeName === toNodeName`, pour que l'appelant
   * n'ait pas à filtrer ce cas lui-même.
   */
  async moveObjectType(
    repoPath: string,
    dto: { fromNodeName: string; toNodeName: string; typeName: string },
  ): Promise<{ schema: ProjectSchema; oldRef: string; newRef: string }> {
    return this.withMutationQueue(repoPath, async () => {
      const schema = await this.get(repoPath)
      const fromNode = this.requireNode(schema, dto.fromNodeName)
      const oldRef = `${dto.fromNodeName}::${dto.typeName}`
      const newRef = `${dto.toNodeName}::${dto.typeName}`
      if (dto.fromNodeName === dto.toNodeName) {
        this.requireObjectType(fromNode, dto.typeName) // still validate it exists, for a consistent contract
        return { schema, oldRef, newRef }
      }
      const toNode = this.requireNode(schema, dto.toNodeName)
      this.requireNotReadonly(fromNode)
      this.requireNotReadonly(toNode)
      const type = this.requireObjectType(fromNode, dto.typeName)
      if (toNode.objectTypes?.some((t) => t.name === dto.typeName)) {
        throw new SchemaValidationError(
          'TYPE_NAME_TAKEN',
          `Le type "${dto.typeName}" existe déjà dans le nœud "${dto.toNodeName}".`,
        )
      }
      const nodes = mapSystemNode(
        mapSystemNode(schema.nodes, dto.fromNodeName, (n) => ({
          ...n,
          objectTypes: (n.objectTypes ?? []).filter((t) => t.name !== dto.typeName),
        })),
        dto.toNodeName,
        (n) => ({ ...n, objectTypes: [...(n.objectTypes ?? []), type] }),
      )
      const updated: ProjectSchema = { ...schema, nodes }
      await this.save(repoPath, updated)
      return { schema: updated, oldRef, newRef }
    })
  }

  /** Ajoute un `SchemaField` à un type d'objet existant. */
  async addField(
    repoPath: string,
    dto: { nodeName: string; typeName: string; field: SchemaField },
  ): Promise<ProjectSchema> {
    return this.withMutationQueue(repoPath, async () => {
      const schema = await this.get(repoPath)
      const node = this.requireNode(schema, dto.nodeName)
      this.requireNotReadonly(node)
      const type = this.requireObjectType(node, dto.typeName)
      // `?? []` défensif : `ObjectTypeDefinition.fields` est typé non-optionnel, mais
      // `readFromDisk()` caste le YAML brut sans validation runtime — un schema.yaml
      // édité à la main sans `fields:` sur un type planterait sinon ici avec une
      // TypeError non catchée au lieu d'une `SchemaValidationError` propre (trouvé en revue).
      const fields = type.fields ?? []
      if (fields.some((f) => f.name === dto.field.name)) {
        throw new SchemaValidationError(
          'FIELD_NAME_TAKEN',
          `Le champ "${dto.field.name}" existe déjà dans le type "${dto.typeName}".`,
        )
      }
      const updatedType: ObjectTypeDefinition = { ...type, fields: [...fields, dto.field] }
      const updated = this.replaceObjectType(schema, node, type, updatedType)
      await this.save(repoPath, updated)
      return updated
    })
  }

  /** Ajoute un `SchemaStatus` à un type d'objet existant. */
  async addStatus(
    repoPath: string,
    dto: { nodeName: string; typeName: string; status: SchemaStatus },
  ): Promise<ProjectSchema> {
    return this.withMutationQueue(repoPath, async () => {
      const schema = await this.get(repoPath)
      const node = this.requireNode(schema, dto.nodeName)
      this.requireNotReadonly(node)
      const type = this.requireObjectType(node, dto.typeName)
      if (type.statuses?.some((s) => s.name === dto.status.name)) {
        throw new SchemaValidationError(
          'STATUS_NAME_TAKEN',
          `Le statut "${dto.status.name}" existe déjà dans le type "${dto.typeName}".`,
        )
      }
      const updatedType: ObjectTypeDefinition = {
        ...type,
        statuses: [...(type.statuses ?? []), dto.status],
      }
      const updated = this.replaceObjectType(schema, node, type, updatedType)
      await this.save(repoPath, updated)
      return updated
    })
  }

  /** Ajoute un `LinkTypeDefinition` au projet (pas rattaché à un nœud particulier). */
  async addLinkType(repoPath: string, dto: { linkType: LinkTypeDefinition }): Promise<ProjectSchema> {
    return this.withMutationQueue(repoPath, async () => {
      const schema = await this.get(repoPath)
      if (schema.linkTypes.some((lt) => lt.name === dto.linkType.name)) {
        throw new SchemaValidationError(
          'LINK_TYPE_NAME_TAKEN',
          `Le type de lien "${dto.linkType.name}" existe déjà dans ce projet.`,
        )
      }
      const updated: ProjectSchema = { ...schema, linkTypes: [...schema.linkTypes, dto.linkType] }
      await this.save(repoPath, updated)
      return updated
    })
  }

  private requireNode(schema: ProjectSchema, nodeName: string): SystemNode {
    const node = findSystemNode(schema.nodes, nodeName)
    if (!node) {
      throw new SchemaValidationError('NODE_NOT_FOUND', `Nœud "${nodeName}" introuvable dans ce projet.`)
    }
    return node
  }

  private requireNotReadonly(node: SystemNode): void {
    if (node.readonly) {
      throw new SchemaValidationError('NODE_READONLY', `Le nœud "${node.name}" est en lecture seule — écriture refusée.`)
    }
  }

  private requireObjectType(node: SystemNode, typeName: string): ObjectTypeDefinition {
    const type = node.objectTypes?.find((t) => t.name === typeName)
    if (!type) {
      throw new SchemaValidationError(
        'TYPE_NOT_FOUND',
        `Type "${typeName}" introuvable dans le nœud "${node.name}".`,
      )
    }
    return type
  }

  /** Cherche si `prefix` est déjà utilisé par un type de N'IMPORTE QUEL nœud du projet, à
   *  n'importe quelle profondeur d'imbrication (règle 10 CLAUDE.md, T123 pour la récursion) —
   *  retourne le nom du nœud en cause, ou `undefined`. */
  private findNodeUsingPrefix(schema: ProjectSchema, prefix: string): string | undefined {
    return flattenSystemNodes(schema.nodes).find(
      ({ node }) => node.objectTypes?.some((t) => t.prefix === prefix),
    )?.node.name
  }

  /** Construit une copie immuable de `schema` avec `type` remplacé par `updatedType` dans `node`.
   *  Localise `node` par son nom via `mapSystemNode` (T123) — `node` peut être imbriqué à
   *  n'importe quelle profondeur, un `.map()` de premier niveau sur `schema.nodes` ne le
   *  retrouverait pas. */
  private replaceObjectType(
    schema: ProjectSchema,
    node: SystemNode,
    type: ObjectTypeDefinition,
    updatedType: ObjectTypeDefinition,
  ): ProjectSchema {
    return {
      ...schema,
      nodes: mapSystemNode(schema.nodes, node.name, (n) => ({
        ...n,
        objectTypes: (n.objectTypes ?? []).map((t) => (t === type ? updatedType : t)),
      })),
    }
  }

  /**
   * Resolve the actual repo directory for a given objectTypeRef.
   *
   * - If objectTypeRef has no `::` separator, or the node name is "root" → returns null (use product repo).
   * - T69 workspace: if a workspace tree cache is available, looks up the component by name in the tree.
   * - Otherwise: returns null (mono-repo mode, component not found).
   *
   * Uses the in-memory cache synchronously; callers must ensure `get()` has
   * already been awaited at least once for this repoPath before calling this.
   *
   * @param workspaceDir optional workspace directory — if provided, the workspace
   *   tree cache is used to resolve the component repo path.
   */
  async resolveComponentRepoPath(
    repoPath: string,
    objectTypeRef: string,
    workspaceDir?: string,
  ): Promise<string | null> {
    if (!objectTypeRef || !objectTypeRef.includes('::')) return null

    const nodeName = objectTypeRef.split('::')[0]
    if (!nodeName || nodeName === 'root') return null

    // If a workspace directory is provided, look up the component in the tree cache
    if (workspaceDir && this.workspaceTree) {
      const tree = await this.workspaceTree.readCache(workspaceDir)
      if (tree) {
        const node = tree.nodes.find(n => n.name === nodeName)
        if (node) {
          // Ensure directory exists (in case the repo was just cloned)
          const dotGit = path.join(node.repoPath, '.git')
          const hasGit = await fsP.stat(dotGit).then(() => true).catch(() => false)
          if (!hasGit) {
            console.log('[SchemaService] initialising empty git repo for workspace component:', nodeName)
            await fsP.mkdir(node.repoPath, { recursive: true })
            await git.init({ fs, dir: node.repoPath, defaultBranch: 'main' })
            await fsP.writeFile(path.join(node.repoPath, '.gitignore'), '*.pref\n', 'utf-8')
          }
          return node.repoPath
        }
      }
    }

    // No workspace tree available or component not found in tree — mono-repo mode
    return null
  }

  private async readFromDisk(repoPath: string): Promise<ProjectSchema> {
    try {
      const filePath = path.join(repoPath, '.polenta', 'schema.yaml')
      const raw = await fsP.readFile(filePath, 'utf-8')
      const parsed = yaml.load(raw) as ProjectSchema
      if (!parsed || !parsed.nodes) return DEFAULT_SCHEMA
      return this.migrateRootRolesImplements(parsed)
    } catch {
      return DEFAULT_SCHEMA
    }
  }

  /**
   * T123 — un `schema.yaml` écrit avant ce ticket porte `roles`/`implements` au niveau racine
   * du fichier (décrivant "ce repo est une interface"/"ce repo implémente X"). On les recopie
   * sur le node `root` (côté lecture, en mémoire), pour qu'un composant local ait exactement le
   * même mécanisme d'interface que `root` (cf. specs/T123.md §Décisions #4) — idempotente,
   * n'ajoute la copie que si `root` ne l'a pas déjà.
   *
   * Contrepartie côté écriture : `save()` fait l'inverse à chaque sauvegarde
   * (`mirrorRootRolesImplements`, Sprint 3) — root devient la source de vérité, le niveau racine
   * du fichier n'est plus qu'un miroir tenu à jour automatiquement pour
   * `workspace-tree.service.ts`/`interface-compliance.service.ts`, qui lisent encore le fichier
   * directement sans passer par `SchemaService` (cf. specs/T123-sprint1.md). Cette fonction-ci ne
   * sert donc plus qu'à peupler `root` en mémoire pour un `schema.yaml` jamais resauvegardé depuis
   * ce ticket (première lecture d'un projet legacy) — sans elle, la popup d'édition d'un composant
   * jamais encore retouché montrerait un catalogue de rôles vide pour un repo interface existant.
   */
  private migrateRootRolesImplements(schema: ProjectSchema): ProjectSchema {
    if (!schema.roles?.length && !schema.implements?.length) return schema
    const root = findSystemNode(schema.nodes, 'root')
    if (root?.roles?.length || root?.implements?.length) return schema // déjà migré sur root
    return {
      ...schema,
      nodes: mapSystemNode(schema.nodes, 'root', (r) => ({
        ...r,
        roles: r.roles ?? schema.roles,
        implements: r.implements ?? schema.implements,
      })),
    }
  }
}
