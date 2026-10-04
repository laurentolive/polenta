# GH39 — Sprint 1 : backend, "Publier", auto-pull

## Fichiers modifiés

- `apps/desktop/src/main/services/sync.service.ts` — `integrationState`, `canMergeRemoteIntoIntegration`,
  `isMergedInto`, `resyncIntegration` (+ `setAside` privé), `autoSync` ; types
  `IntegrationRemoteState`, `ResyncOutcome`, constante `RESYNC_BRANCH_PREFIX`.
- `apps/desktop/src/main/ipc/index.ts`, `packages/api-client/src/{types,ipc-client,index}.ts` — IPC
  `sync:integration-state`, `sync:can-merge-remote`, `sync:resync-integration`, `sync:auto-sync`,
  `sync:is-merged`.
- `apps/desktop/src/renderer/lib/publishWorkspace.ts` — `PublishDivergedError`, pré-contrôle de
  divergence avant écriture, merge d'`origin/<int>` dans une intégration divergée, `dev-resync`
  publiable (`isResyncBranch`), plus de commit vide.
- `apps/desktop/src/renderer/components/layout/ModificationControl.tsx` — message pour
  `PublishDivergedError`, dernière erreur de push mémorisée par repo (`['sync:last-error', repoPath]`),
  bouton actif pour un repo sur `dev-resync`.
- `apps/desktop/src/renderer/hooks/useModificationMode.ts` — `PendingRepo.setAside`.
- `apps/desktop/src/renderer/hooks/useAutoPull.ts` — un `autoSync` par repo et par tick.
- `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` — `divergedRepos`, `setAsideCommits`.

## Comportement implémenté

- **Auto-pull** (5 min, inchangé) : fetch même si le repo est sale ; fast-forward de la branche
  courante si propre ; relance du push si l'intégration est seulement en avance ; dernière erreur
  conservée tant que l'intégration reste en avance/divergée.
- **Publier** : intégration divergée → simulation du merge d'origin avant toute écriture ; conflit →
  refus global (`divergedRepos`, liste repo : fichiers) ; sinon origin est fusionné dans
  l'intégration avant le merge de la modification. Une branche `dev-resync[-n]` non fusionnée est
  publiée comme une branche éphémère (retour sur l'intégration + suppression).
- **Resynchroniser** (backend seulement, bouton au sprint 2) : fast-forward / push / merge + push ;
  conflit → `dev-resync[-n]`, intégration réalignée sur origin ; refus `integration-dirty` si
  l'intégration checkoutée a des modifications en attente.

## Divergences par rapport au design / à la spec

- Spec §3.2 et critère 5 précisés : dans le cas en conflit, si l'intégration est checkoutée, la
  garde « modifications en attente » s'applique aussi (le repo est donc propre quand `HEAD` passe
  sur `dev-resync`). Les modifications en attente ne « suivent » que si l'utilisateur était sur une
  autre branche.
- Revue de code : `isResyncBranch` restreint aux noms exacts `dev-resync` / `dev-resync-<n>` ;
  l'auto-pull n'efface plus la dernière erreur tant que l'intégration est en alerte.
- `pullFastForwardOnly` n'est plus utilisé par l'auto-pull ; conservé (IPC existant).

## Mises à jour SPEC

Aucune (sprint final = sprint 2).

## Vérifications

- `pnpm typecheck` : 0 erreur (pas de config ESLint pour l'app desktop).
- Scénarios exécutés sur de vrais repos git (bare local + 2 clones) contre `SyncService` :
  N1–N7, L2–L5, L7 de `GH39-tests.md` + set-aside depuis une autre branche (sale) — **tous OK**.
  La séquence "Publier" (N4) a été rejouée avec les mêmes appels que `publishRepo`.

## Tester manuellement

Sans UI d'indicateur (sprint 2), via l'état git :
1. Projet cloné ; collègue pousse une modification de `x.yaml` ; localement, modifier le même
   fichier et faire un commit sur l'intégration sans push (`git commit` en CLI). Modifier une
   exigence dans l'app → "Publier" → refus « l'intégration de ces repos a divergé… » ; `git status` /
   `git branch` inchangés.
2. Même chose avec des fichiers différents → "Publier" réussit ; `git log --graph` montre le merge
   d'`origin/<int>` puis celui de la modification ; `git status -sb` sans `ahead`/`behind`.
3. Commit local non poussé, origin inchangé, attendre un tick d'auto-pull (5 min) → poussé.
