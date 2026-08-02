import type { ProjectSchema } from '@polenta/types'
import type { SchemaService } from './schema.service'
import type { RequirementsService } from './requirements.service'
import type { TestsService } from './tests.service'
import type { TreeService } from './tree.service'

export interface MoveElementResult {
  schema: ProjectSchema
  failed: { kind: 'requirement' | 'test'; id: string; error: string }[]
}

/**
 * Moves an `ObjectTypeDefinition` from one node to another in the same repo's schema, then
 * rewrites `objectTypeRef` on every existing requirement/test that referenced the old node, and
 * moves the type's display-order file (T135 sprint 3 — dragging an element onto a different node
 * in the Structure tab).
 *
 * A dedicated class (constructor-injected, like every other multi-service operation in this
 * codebase — cf. `CampaignsService(git, tests)`, `TraceabilityService(...)` in `container.ts`)
 * rather than a method on `SchemaService`: `RequirementsService`/`TestsService` already depend on
 * `SchemaService` (constructor injection), so composing them the other way around would create a
 * circular dependency. This service depends on all three (plus `TreeService`) instead, and is
 * called from its own IPC handler (`schema:move-element` in `ipc/index.ts`).
 *
 * Ordering: the schema mutation runs first and is the source of truth for `oldRef`/`newRef` — if
 * it throws (`SchemaValidationError`: node/type not found, name collision, readonly node), nothing
 * else runs and no cascade is attempted, so a rejected move never leaves the schema half-changed.
 * Once the schema write has landed, though, there is no way back — every step after it (the
 * requirements/tests cascade, the tree-order move) is best-effort per item, same philosophy as
 * `renameDependency`'s `implements[]` cascade: one failure must not stop the others, and must not
 * throw past this method either — a hard throw here would leave the schema already saved with no
 * indication to the caller that the cascade never ran at all, which is worse than a partial
 * failure the caller can at least report.
 */
export class ElementMoveService {
  constructor(
    private readonly schema: SchemaService,
    private readonly requirements: RequirementsService,
    private readonly tests: TestsService,
    private readonly tree: TreeService,
  ) {}

  async moveElementToNode(
    repoPath: string,
    dto: { fromNodeName: string; toNodeName: string; typeName: string },
  ): Promise<MoveElementResult> {
    const { schema: updatedSchema, oldRef, newRef } = await this.schema.moveObjectType(repoPath, dto)

    if (oldRef === newRef) {
      return { schema: updatedSchema, failed: [] }
    }

    const failed: MoveElementResult['failed'] = []

    try {
      const reqOutcome = await this.requirements.retargetObjectTypeRef(repoPath, oldRef, newRef)
      for (const f of reqOutcome.failed) failed.push({ kind: 'requirement', id: f.id, error: f.error })
    } catch (err) {
      // The whole cascade step failed before any per-file try/catch could run (e.g. the index
      // itself failed to build) — surfaced as a single failure entry rather than left invisible.
      failed.push({ kind: 'requirement', id: oldRef, error: err instanceof Error ? err.message : String(err) })
    }

    try {
      const allTests = await this.tests.findAll(repoPath)
      const matchingTests = allTests.filter((t) => t.objectTypeRef === oldRef)
      for (const test of matchingTests) {
        try {
          await this.tests.update(repoPath, test.id, { objectTypeRef: newRef })
        } catch (err) {
          failed.push({ kind: 'test', id: test.id, error: err instanceof Error ? err.message : String(err) })
        }
      }
    } catch (err) {
      failed.push({ kind: 'test', id: oldRef, error: err instanceof Error ? err.message : String(err) })
    }

    await this.tree.moveTypeTree(repoPath, dto.fromNodeName, dto.toNodeName, dto.typeName)

    return { schema: updatedSchema, failed }
  }
}
