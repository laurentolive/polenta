import { createHash } from 'node:crypto'
import { withoutHistory } from '@polenta/types'
import type { TestCase } from '@polenta/types'

/**
 * GH81 — empreinte du contenu d'une version de test (copie de campagne ou test live) : sha256 de sa
 * forme canonique — sans `history` ni champs non stockés ou posés par l'application (dates/auteurs
 * dérivés du `git log`, `needsRevalidation`), ni `status` / `version` (approuver un test sans en
 * changer le contenu ne périme pas un classeur exporté) ; clés `undefined` retirées, clés d'objet
 * triées, ordre des tableaux conservé. Une modification à la main ou un `git revert` change
 * l'empreinte ; un simple commit ou un changement de statut, non.
 */
export function testFingerprint(test: TestCase): string {
  const {
    createdAt: _ca, createdBy: _cb, updatedAt: _ua, updatedBy: _ub, needsRevalidation: _nr,
    status: _status, version: _version, ...content
  } = withoutHistory(test) as TestCase
  return createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex')
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(v => (v === undefined ? null : canonical(v)))
  if (value && typeof value === 'object') {
    const plain = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(plain).sort()
        .filter(k => plain[k] !== undefined)
        .map(k => [k, canonical(plain[k])]),
    )
  }
  return value
}
