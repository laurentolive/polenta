import { createHash } from 'node:crypto'
import { withoutHistory } from '@polenta/types'
import type { TestCase } from '@polenta/types'
import { canonical } from '@polenta/merge-core'
import { withoutAuditFields } from './audit-fields.util'

/** GH340 — copie d'un test dans une campagne (`testSnapshot`) : sans historique ni dates du fichier. */
export function snapshotOf(test: TestCase): TestCase {
  return withoutAuditFields(withoutHistory(test)) as TestCase
}

/**
 * GH81 — empreinte du contenu d'une version de test (copie de campagne ou test live) : sha256 de sa
 * forme canonique — sans `history` ni champs posés par l'application (dates de création /
 * modification, `needsRevalidation`), ni `status` / `version` (approuver un test sans en
 * changer le contenu ne périme pas un classeur exporté) ; clés `undefined` retirées, clés d'objet
 * triées, ordre des tableaux conservé. Une modification à la main ou un `git revert` change
 * l'empreinte ; un simple commit ou un changement de statut, non.
 */
export function testFingerprint(test: TestCase): string {
  const {
    createdAt: _ca, createdBy: _cb, updatedAt: _ua, updatedBy: _ub, needsRevalidation: _nr,
    status: _status, version: _version, ...content
  } = withoutHistory(test) as TestCase
  return createHash('sha256').update(canonical(content)).digest('hex')
}
