# GH163 — Sprint 1 (unique)

Voir `specs/GH163-design.md` (fichiers, décisions, limites) et `specs/GH163-tests.md`.

## Mises à jour SPEC

- `SPEC-REQ-requirements.md` §4.4 : attribut `comment` des entrées d'historique.
- `SPEC-MCP-SERVER.md` §4.6 : `modificationComment` exposé, `warning`.
- `SPEC-INDEX.md` : ligne §4, `MAJ` → GH163.

## Vérification

Portable (Node 20) : `pnpm typecheck` OK ; `pnpm test` : tous les tests au vert après régénération de
`polenta.d.ts` et du manifeste de la bibliothèque (L8, L11).
