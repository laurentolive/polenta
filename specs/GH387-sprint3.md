# GH387 — Sprint 3 : pistes restantes, robustesse, documentation

## Fichiers modifiés

- `apps/desktop/e2e-web/support/global-setup.ts` — repo nu de la démo en cache entre exécutions
  (`%TEMP%/polenta-e2e-web/cache`) : clone si absent (dossier propre au process puis renommage, sûr
  entre worktrees), `fetch` au plus toutes les 10 min, copie en cache utilisée si GitHub ne répond pas ;
  copié directement dans la forge de chaque pile.
- `apps/desktop/e2e-web/support/stack.ts` — ports planifiés en série, jamais deux fois le même ; port
  forcé vérifié libre (sinon une pile répondrait par le serveur d'une autre exécution).
- `apps/desktop/e2e-web/support/session.ts` — modèle copié juste après l'ouverture côté serveur, avant
  le chargement de la page, sans fichiers `*.lock` ; ancien modèle supprimé quand il est remplacé ;
  `networkidle` des helpers essayé puis rétabli (voir divergences).
- `apps/desktop/e2e-web/gh108-repo-settings.spec.ts`, `gh368-member-suggestions.spec.ts` — chemin de
  `auth.json` calculé à l'appel (`--list` sans global setup).
- `apps/desktop/e2e-web/gh342-windows.spec.ts` — W1 attend l'URL complète de la vue Exigences.
- `apps/desktop/e2e-web/README.md`, `WORKFLOW.md`, `specs/SPEC-WEB.md` §10 — workers, ports, mesure,
  architecture par pile, durée.

## Comportement

Décision par piste et mesures : `specs/GH387.md` § 6. En bref : clone modèle et workers gardés ;
`networkidle`, build sauté et `waitForTimeout` abandonnés avec justification ; GH246-1 allégé.

## Divergences par rapport au design

- Piste 2 : le design prévoyait de retirer `networkidle` des helpers. Fait, puis rétabli : gain mural
  de 16 s seulement à 4 workers, et deux courses réelles (gh361 : écritures IPC du `beforeAll` avant le
  chargement initial de l'application ; gh342 : URL complétée après l'ouverture de la vue).
- Ajout : cache de la démo, après deux passages perdus sur une coupure DNS passagère du poste.
- Revue de code (`/code-review`, niveau medium) : 9 constats ; corrigés : copie du modèle pendant les
  écritures de la page, ports dupliqués ou déjà pris, cache non sûr entre worktrees, `--list` cassé,
  modèles jamais supprimés. Écartés : invalidation du modèle limitée aux refs du repo racine (les
  composants viennent de github.com, pas de la forge locale) ; course de `openView` (préexistante,
  l'attente qui suit le clic est inchangée) ; process orphelins hors Windows (cible : poste Windows).

## Mises à jour SPEC

- `SPEC-WEB.md` §10 — exécution parallèle : une pile par worker, projet de départ copié d'un modèle.
- `SPEC-INDEX.md` — colonne MAJ de SPEC-WEB §global → GH387.

## Comment tester

```bash
cd apps/desktop
pnpm test:e2e:web                         # ≈ 6-7 min build compris, 4 workers
npx playwright test --list                # 398 tests
POLENTA_E2E_WORKERS=1 npx playwright test e2e-web/parity.spec.ts
```
Deux worktrees peuvent lancer la suite en même temps sans variable de port.
