# GH305 — Sprint 1 (unique)

## Fichiers modifiés

- `.github/workflows/release.yml` — job `web-image`.
- `deploy/lib/common.sh`, `deploy/polenta-host.sh` — image par défaut publiée, `instance web update`,
  `webVersion` dans `instance list --json`, code 14 pour une image introuvable à l'activation.
- `deploy/RUNBOOK.md` — A15 (image publiée, visibilité du paquet, mise à jour, migration), A17
  (`web.update`).
- `apps/admin-service/src/jobs/registry.ts`, `packages/types/src/admin.ts` — opération `web.update`.
- `apps/desktop/src/renderer/components/layout/WebReleaseUpdate.tsx` (nouveau), `UpdateBadge.tsx`.
- `apps/desktop/src/renderer/components/admin/InstancesPanel.tsx`, `useLaunch.ts`, `lib/adminApi.ts`.
- `apps/desktop/src/shared/version-compare.ts` (nouveau, `isNewer` déplacé), `web-server/release-check.ts`.
- i18n `fr.json`, `en.json`.
- Tests : `apps/admin-service/test/app.test.ts` (GH305), `e2e-web/gh305-web-update.spec.ts` (nouveau),
  `e2e-web/gh302-update.spec.ts` (E2), `e2e-web/support/fake-admin-service.mjs` (paramètres des
  travaux, `/__jobs`, échec pilotable, `webVersion`).

## Comportement implémenté

Conforme à `specs/GH305.md`, décisions Q1-Q3 appliquées. La CI publie
`ghcr.io/laurentolive/polenta-web:X.Y.Z` après un contrôle `/healthz`. L'administrateur met à jour le
client web de son instance depuis le popover W2. L'exploitant le fait pour n'importe quelle instance
depuis Administration › Instances.

## Divergences par rapport à la spec initiale

- Commande `instance web update` (nouvelle) au lieu de `instance web enable --version` : chemin
  minimal, avec retour arrière automatique (code 17, `rolled-back`). Spec et design mis à jour ; la
  ligne « Hors scope : retour arrière » est retirée.
- Pas d'étapes affichées pour le travail.
- Revue de code (`/code-review`) : corrigés — retour arrière, effets de bord d'`enable`,
  préremplissage d'une version plus ancienne, suivi perdu dans la vue « Recharger », étapes trompeuses,
  sonde `/healthz` sans contrôle du statut, placeholder figé. Écartés : préremplissage desktop
  (administration absente du desktop, garde `platform === 'web'` ajoutée quand même), `me.instance`
  absent (toujours renseigné), tags de pré-version (le job desktop les refuse déjà).

## Mises à jour SPEC

- `SPEC-WEB.md` §9 — `instance web update` ; §12 — mise à jour du client web (opération, deux entrées,
  `webVersion`).
- `SPEC-TECH-stack.md` §9 — image publiée par `release.yml`.
- `SPEC-INDEX.md` — colonne MAJ → GH305 pour ces deux lignes.

## Vérifications

- `pnpm typecheck` : OK. `pnpm lint` : aucune tâche définie dans le repo (rien à exécuter).
- `pnpm test` : desktop 1588/1588, admin-service 119 (+3 ignorés), merge-core 79. Une exécution a vu
  `repo-adoption.gh107` A-02 dépasser 20 s sous charge ; repassé seul 22/22 puis dans la suite complète.
- e2e web : `gh305-`, `gh302-`, `gh63-` : 17/17 (une exécution a échoué au clonage GitHub de la démo,
  erreur réseau, repassée).
- Kit sur le VPS de test (copie temporaire, `acme`) : K1, K2, K3, K5 de `GH305-tests.md` OK ; état
  d'origine rétabli (`gh44-s4`), copie et étiquette de test supprimées.
- Non lancés : K4 (retour arrière réel, refusé par le contrôle de permissions de la session), job CI
  (premier tag réel), suite e2e complète (niveau 3, après « Validé »).

## Comment tester manuellement

1. Client web (`pnpm --filter @polenta/desktop dev:web` avec le faux service d'administration, ou une
   instance) en administrateur, release plus récente détectée : bouton de mise à jour → « Mettre à jour
   vers vX » → confirmation → suivi → « Recharger ».
2. Administration › Instances (niveau hôte) : formulaire « Client web » des seules instances avec
   client web, prérempli.
3. Après le premier tag : job `web-image` vert ; rendre le paquet `polenta-web` public ; sur l'hôte,
   migrer une instance (`web enable --image ghcr.io/laurentolive/polenta-web --version X.Y.Z`).
