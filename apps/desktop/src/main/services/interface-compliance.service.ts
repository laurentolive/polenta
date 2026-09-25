/**
 * InterfaceComplianceService — T69 Sprint 4, granularité composant depuis T123
 *
 * Responsible for:
 * - Computing the compliance matrix for each interface component in a workspace
 * - Checking component coverage per role
 * - Computing which links need revalidation when an interface requirement changes
 *
 * T123 — un "composant" pour ce service est une paire (repoPath, SystemNode), pas un repo entier
 * (WorkspaceTreeNode) : n'importe quel composant, local ou avec repo séparé, imbriqué ou non, peut
 * exposer des rôles et/ou implémenter une interface (cf. specs/T123.md, specs/T123-design.md §8).
 */

import * as fsP from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'

import type { WorkspaceTreeService } from './workspace-tree.service'
import type { RequirementsIndexService } from './requirements-index.service'
import type {
  ComplianceMatrix,
  ComplianceCell,
  ComplianceCellStatus,
  CoverageResult,
  ComplianceRequirementRow,
  ComplianceComponentColumn,
  WorkspaceTree,
  ProjectSchema,
  SystemNode,
  ImplementsDeclaration,
} from '@polenta/types'
import { flattenSystemNodes } from '@polenta/types'
import type { Requirement, ObjectLink } from '@polenta/types'
import { parseMultiEnumValue } from '@polenta/types'

/** A component this service can reason about: a SystemNode (root, local, or imbriqué) inside a
 *  given repo, identified for display by the path of its local ancestors (cf. §9 du design). */
interface ComponentRef {
  repoPath: string
  node: SystemNode
  /** Nom d'affichage unique dans tout le workspace — le nom du repo mount seul pour `root`,
   *  sinon `<repo> › <ancêtres locaux> › <node>` : un SystemNode n'est unique que dans l'arbre de
   *  son propre repo (T123 §Décisions #1), deux repos différents peuvent avoir un composant local
   *  du même nom — la colonne de la matrice doit rester non ambiguë. */
  displayName: string
}

export class InterfaceComplianceService {
  constructor(
    private readonly workspaceTree: WorkspaceTreeService,
    private readonly reqIndex: RequirementsIndexService,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Compute the compliance matrix for all interface components in the workspace.
   * Returns one ComplianceMatrix per component exposing at least one role.
   */
  async getComplianceMatrix(workspaceDir: string): Promise<ComplianceMatrix[]> {
    const tree = await this.workspaceTree.readCache(workspaceDir)
    if (!tree) return []

    const components = await this.listAllComponents(tree)
    const matrices: ComplianceMatrix[] = []

    for (const comp of components) {
      if (!comp.node.roles || comp.node.roles.length === 0) continue

      const matrix = await this.buildMatrix(comp, components)
      if (matrix) matrices.push(matrix)
    }

    return matrices
  }

  /**
   * Compute the coverage result for a single component × interface pair.
   */
  async checkComponentCoverage(
    componentRepoPath: string,
    interfaceRepoPath: string,
    declaredRoles: string[],
  ): Promise<CoverageResult> {
    const componentName = path.basename(componentRepoPath)
    const interfaceName = path.basename(interfaceRepoPath)

    // Get approved requirements from the interface repo
    const allInterfaceReqs = await this.reqIndex.findAll(interfaceRepoPath, { status: 'approved' })

    // Filter applicable requirements based on declared roles
    const applicable = allInterfaceReqs.filter(req =>
      this.isRequirementApplicable(req, declaredRoles),
    )

    // Get all links from the component repo
    const allLinks = await this.reqIndex.findAllLinks(componentRepoPath)
    const implementsLinks = allLinks.filter(l => l.type === 'implements-interface')

    const covered: string[] = []
    const missing: string[] = []
    const validated: string[] = []

    for (const req of applicable) {
      const link = implementsLinks.find(l => l.targetId === req.id)
      if (!link) {
        missing.push(req.id)
      } else if (await this.hasImpactToCheck(req, link, componentRepoPath)) {
        covered.push(req.id)
      } else {
        validated.push(req.id)
      }
    }

    return {
      componentName,
      interfaceName,
      declaredRoles,
      applicable: applicable.map(r => this.toRowDescriptor(r)),
      covered,
      missing,
      validated,
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /** T172 — un lien `implements-interface` reste « covered » (non validé) tant que l'une de ses
   *  extrémités est marquée `needsRevalidation` : l'exigence d'interface, ou l'élément du
   *  composant qui l'implémente (celui qui est marqué quand l'exigence d'interface est rouverte). */
  private async hasImpactToCheck(
    interfaceReq: Requirement | undefined,
    link: ObjectLink,
    componentRepoPath: string,
  ): Promise<boolean> {
    if (interfaceReq?.needsRevalidation) return true
    const source = await this.reqIndex.findById(componentRepoPath, link.sourceId)
    return !!source?.needsRevalidation
  }

  /** T123 — énumère tous les composants (root + composants locaux à toute profondeur) de tous
   *  les repos du workspace, avec un nom d'affichage garanti unique. */
  private async listAllComponents(tree: WorkspaceTree): Promise<ComponentRef[]> {
    const out: ComponentRef[] = []
    for (const repoNode of tree.nodes) {
      const schema = await this.readSchema(repoNode.repoPath)
      if (!schema) continue
      for (const { node, ancestors } of flattenSystemNodes(schema.nodes)) {
        const localAncestors = ancestors.filter(a => a.name !== 'root')
        const displayName = node.name === 'root'
          ? repoNode.name
          : [repoNode.name, ...localAncestors.map(a => a.label || a.name), node.label || node.name].join(' › ')
        out.push({ repoPath: repoNode.repoPath, node, displayName })
      }
    }
    return out
  }

  /** T123 — un `objectTypeRef` ("nodeName::typeName", ou sans préfixe = root) appartient-il au
   *  composant `nodeName` ? Même convention que `findObjectTypeDef`/`schema-lookup.util.ts`. */
  private objectTypeRefBelongsToNode(objectTypeRef: string, nodeName: string): boolean {
    const refNodeName = objectTypeRef.includes('::') ? objectTypeRef.split('::')[0] : 'root'
    return refNodeName === nodeName
  }

  /** Exigences approuvées appartenant spécifiquement à `nodeName` dans `repoPath` — un repo peut
   *  avoir plusieurs composants (T113/T123), `reqIndex.findAll` retourne tout le repo sans
   *  distinction de composant, filtré ici par `objectTypeRef`. */
  private async findApprovedReqsForNode(repoPath: string, nodeName: string): Promise<Requirement[]> {
    const all = await this.reqIndex.findAll(repoPath, { status: 'approved' })
    return all.filter(r => this.objectTypeRefBelongsToNode(r.objectTypeRef, nodeName))
  }

  /** Liens dont la source appartient spécifiquement à `nodeName` dans `repoPath` — même
   *  raisonnement que `findApprovedReqsForNode`, mais sur les liens (`ObjectLink.sourceId` ne
   *  porte pas directement l'info de composant, il faut la retrouver via l'exigence source). */
  private async findLinksForNode(repoPath: string, nodeName: string): Promise<ObjectLink[]> {
    const [allLinks, allReqs] = await Promise.all([
      this.reqIndex.findAllLinks(repoPath),
      this.reqIndex.findAll(repoPath),
    ])
    const idsForNode = new Set(
      allReqs.filter(r => this.objectTypeRefBelongsToNode(r.objectTypeRef, nodeName)).map(r => r.id),
    )
    return allLinks.filter(l => idsForNode.has(l.sourceId))
  }

  private async buildMatrix(
    interfaceComp: ComponentRef,
    allComponents: ComponentRef[],
  ): Promise<ComplianceMatrix | null> {
    // Get approved requirements belonging specifically to this component
    const interfaceReqs = await this.findApprovedReqsForNode(interfaceComp.repoPath, interfaceComp.node.name)
    if (interfaceReqs.length === 0) return null

    // Find all components that declare implementing this interface component
    const implementors: Array<{
      comp: ComponentRef
      impl: ImplementsDeclaration
    }> = []

    for (const comp of allComponents) {
      if (!comp.node.implements) continue
      for (const impl of comp.node.implements) {
        if (impl.interface === interfaceComp.node.name) {
          implementors.push({ comp, impl })
        }
      }
    }

    const requirements: ComplianceRequirementRow[] = interfaceReqs.map(r =>
      this.toRowDescriptor(r),
    )
    const interfaceReqById = new Map(interfaceReqs.map(r => [r.id, r]))

    const components: ComplianceComponentColumn[] = implementors.map(({ comp, impl }) => ({
      name: comp.displayName,
      roles: impl.roles ?? [],
      repoPath: comp.repoPath,
    }))

    const cells: ComplianceCell[] = []

    for (const req of requirements) {
      for (let i = 0; i < implementors.length; i++) {
        const { comp, impl } = implementors[i]
        const column = components[i]
        const applicable = this.rolesApplicable(req.roles, impl.roles ?? [])

        if (!applicable) {
          cells.push({
            requirementId: req.id,
            componentName: column.name,
            status: 'na',
          })
          continue
        }

        // Look for a link among this component's own links (not every link of its repo).
        const links = await this.findLinksForNode(comp.repoPath, comp.node.name)
        const link = links.find(
          l => l.type === 'implements-interface' && l.targetId === req.id,
        )

        let status: ComplianceCellStatus
        if (!link) {
          status = 'missing'
        } else if (!(await this.hasImpactToCheck(interfaceReqById.get(req.id), link, comp.repoPath))) {
          status = 'validated'
        } else {
          status = 'covered'
        }

        cells.push({
          requirementId: req.id,
          componentName: column.name,
          status,
          linkId: link?.id,
        })
      }
    }

    return {
      interfaceName: interfaceComp.displayName,
      requirements,
      components,
      cells,
    }
  }

  private isRequirementApplicable(req: Requirement, declaredRoles: string[]): boolean {
    const reqRoles = parseMultiEnumValue(req.fields?.['roles'])
    return this.rolesApplicable(reqRoles, declaredRoles)
  }

  /**
   * A requirement (via its already-parsed `roles`) is applicable to a component if:
   * - The requirement has no roles → applies to all
   * - OR the intersection of reqRoles and declaredRoles is non-empty
   */
  private rolesApplicable(reqRoles: string[], declaredRoles: string[]): boolean {
    if (reqRoles.length === 0) return true
    return declaredRoles.some(r => reqRoles.includes(r))
  }

  private toRowDescriptor(req: Requirement): ComplianceRequirementRow {
    const reqRoles = parseMultiEnumValue(req.fields?.['roles'])
    const title = (req.fields?.['statement'] as string | undefined)?.split('\n')[0]
      ?? req.title
      ?? req.id
    return {
      id: req.id,
      title,
      roles: reqRoles,
      status: req.status,
    }
  }

  private async readSchema(repoPath: string): Promise<ProjectSchema | null> {
    try {
      const schemaPath = path.join(repoPath, '.polenta', 'schema.yaml')
      const raw = await fsP.readFile(schemaPath, 'utf-8')
      return (yaml.load(raw) as ProjectSchema) ?? null
    } catch {
      return null
    }
  }
}
