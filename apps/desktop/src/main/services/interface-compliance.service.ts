/**
 * InterfaceComplianceService — T69 Sprint 4
 *
 * Responsible for:
 * - Computing the compliance matrix for each interface repo in a workspace
 * - Checking component coverage per role
 * - Computing which links need revalidation when an interface requirement changes
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
  WorkspaceTreeNode,
  ProjectSchema,
  ImplementsDeclaration,
} from '@polenta/types'
import type { Requirement, ObjectLink } from '@polenta/types'

export class InterfaceComplianceService {
  constructor(
    private readonly workspaceTree: WorkspaceTreeService,
    private readonly reqIndex: RequirementsIndexService,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Compute the compliance matrix for all interface repos in the workspace.
   * Returns one ComplianceMatrix per interface repo.
   */
  async getComplianceMatrix(workspaceDir: string): Promise<ComplianceMatrix[]> {
    const tree = await this.workspaceTree.readCache(workspaceDir)
    if (!tree) return []

    const matrices: ComplianceMatrix[] = []

    // Find all interface repos (repos with roles declared)
    for (const node of tree.nodes) {
      if (!node.isInterface) continue

      const matrix = await this.buildMatrix(node, tree, workspaceDir)
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
      } else if (link.needsRevalidation) {
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

  /**
   * Given an interface requirement that was modified (or approved), return the
   * IDs of all links in all component repos of the workspace that should be
   * marked `needsRevalidation`.
   *
   * Only components whose declared roles intersect the requirement's roles
   * are affected.
   */
  async computeNeedsRevalidation(
    interfaceReqId: string,
    reqRoles: string[],
    workspaceDir: string,
  ): Promise<{ componentRepoPath: string; linkId: string }[]> {
    const tree = await this.workspaceTree.readCache(workspaceDir)
    if (!tree) return []

    const affected: { componentRepoPath: string; linkId: string }[] = []

    for (const node of tree.nodes) {
      if (node.isInterface) continue
      if (!node.implements || node.implements.length === 0) continue

      for (const impl of node.implements) {
        const declaredRoles = impl.roles ?? []

        // If reqRoles is empty → applies to all; otherwise check intersection
        const applies = reqRoles.length === 0 || declaredRoles.some(r => reqRoles.includes(r))
        if (!applies) continue

        // Find the implements-interface link pointing to this requirement
        const links = await this.reqIndex.findAllLinks(node.repoPath)
        for (const link of links) {
          if (link.type === 'implements-interface' && link.targetId === interfaceReqId) {
            affected.push({ componentRepoPath: node.repoPath, linkId: link.id })
          }
        }
      }
    }

    return affected
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async buildMatrix(
    interfaceNode: WorkspaceTreeNode,
    tree: WorkspaceTree,
    _workspaceDir: string,
  ): Promise<ComplianceMatrix | null> {
    // Read the interface schema to get declared roles
    const interfaceSchema = await this.readSchema(interfaceNode.repoPath)
    const interfaceRoles = interfaceSchema?.roles?.map(r => r.name) ?? []

    // Get approved requirements from the interface repo
    const interfaceReqs = await this.reqIndex.findAll(interfaceNode.repoPath, { status: 'approved' })
    if (interfaceReqs.length === 0) return null

    // Find all component repos that declare implementing this interface
    const implementors: Array<{
      node: WorkspaceTreeNode
      impl: ImplementsDeclaration
    }> = []

    for (const node of tree.nodes) {
      if (node.isInterface) continue
      if (!node.implements) continue

      for (const impl of node.implements) {
        if (impl.interface === interfaceNode.name) {
          implementors.push({ node, impl })
        }
      }
    }

    const requirements: ComplianceRequirementRow[] = interfaceReqs.map(r =>
      this.toRowDescriptor(r),
    )

    const components: ComplianceComponentColumn[] = implementors.map(({ node, impl }) => ({
      name: node.name,
      roles: impl.roles ?? [],
      repoPath: node.repoPath,
    }))

    const cells: ComplianceCell[] = []

    for (const req of requirements) {
      for (const comp of components) {
        const applicable = this.isRequirementApplicable(
          { id: req.id, fields: { roles: req.roles } } as unknown as Requirement,
          comp.roles,
        )

        if (!applicable) {
          cells.push({
            requirementId: req.id,
            componentName: comp.name,
            status: 'na',
          })
          continue
        }

        // Look for a link in the component repo
        const links = await this.reqIndex.findAllLinks(comp.repoPath)
        const link = links.find(
          l => l.type === 'implements-interface' && l.targetId === req.id,
        )

        let status: ComplianceCellStatus
        if (!link) {
          status = 'missing'
        } else if (!link.needsRevalidation) {
          status = 'validated'
        } else {
          status = 'covered'
        }

        cells.push({
          requirementId: req.id,
          componentName: comp.name,
          status,
          linkId: link?.id,
        })
      }
    }

    return {
      interfaceName: interfaceNode.name,
      requirements,
      components,
      cells,
    }
  }

  /**
   * A requirement is applicable to a component if:
   * - The requirement has no `roles` field (or empty) → applies to all
   * - OR the intersection of req.roles and declaredRoles is non-empty
   */
  private isRequirementApplicable(req: Requirement, declaredRoles: string[]): boolean {
    const reqRoles = (req.fields?.['roles'] as string[] | undefined) ?? []
    if (reqRoles.length === 0) return true
    return declaredRoles.some(r => reqRoles.includes(r))
  }

  private toRowDescriptor(req: Requirement): ComplianceRequirementRow {
    const reqRoles = (req.fields?.['roles'] as string[] | undefined) ?? []
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
