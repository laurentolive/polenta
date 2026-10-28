# GH133 — Design : publier hors de la branche d'intégration

Spec : `specs/GH133.md` (Q1–Q4 tranchées). Un seul sprint. Benoit a demandé le 28/10 d'enchaîner
directement design et code.

## Fichiers

| Fichier | Changement |
|---|---|
| `renderer/lib/publishWorkspace.ts` | `isOffIntegration(state)` (branche libre ou `dev-*` de l'utilisateur ; pas l'intégration, pas `int-*`, pas l'éphémère, pas `dev-resync*` ni `dev-auto`) ; `planCandidates()` extrait de `publishWorkspace` ; `offIntegrationRepos(roots, ephemeral)` pour le popup ; option `merge` de `publishWorkspace` et `publishRepo` ; `PublishedRepo.pushBranch` / `merged`. |
| `renderer/components/layout/ModificationControl.tsx` | Avertissement par repo, case « Fusionner dans … », choix initial lu dans le `.pref`, écrit à la publication ; push de `pushBranch` ; notification « Publié sur … (non fusionné dans …) ». |
| `renderer/components/merge/MergeResolvePage.tsx` | Push de `pushBranch` (identique à l'intégration pour un repo fusionné). |
| `main/ipc/pref.handlers.ts` | `pref:get-publish-merge` / `pref:set-publish-merge` (`publishMerge[branch]` du `.pref` du repo). |
| `packages/api-client` (`types.ts`, `ipc-client.ts`), `web-server/channel-policy.ts` | Exposition des deux canaux. |
| `i18n/locales/fr.json`, `en.json` | Textes de l'avertissement, de la case et de la notification. |

## Décisions

- **Sans fusion** : `publishRepo` fait seulement stage + commit sur la branche courante et renvoie le SHA
  du commit ; aucun fast-forward de l'intégration (le contrôle de divergence GH39 est sauté pour ce repo).
- **Push** : `api.sync.pushBranch(repo, pushBranch)` existant (`git push origin <branche>`), qui crée la
  branche distante si absente et refuse un non fast-forward : pas de nouveau code côté main.
- **Épinglage (Q4)** : pas de `propagatePinToDependents` pour un repo publié sans fusion.
- **Choix mémorisé (Q2/Q3)** : une valeur par branche dans le `.pref` de chaque repo publié hors
  intégration ; à l'ouverture, la case est décochée seulement si tous ces repos ont `false`.
- **Reprise après conflit** (éditeur de fusion) : la suite de la publication se fait avec fusion, comme
  aujourd'hui. Un conflit ne survient que sur un repo fusionné ; publier sans fusion les repos restants
  d'une publication interrompue n'est pas couvert (cas rare, limite connue).

## Alternatives écartées

- Nouveau canal main « publier sans fusion » : tout le flux Publier vit dans le renderer, les briques
  (`commit`, `pushBranch`) existent déjà.
- Épingler la branche dans les parents (`pin: toolTest`) : écarté par Q4.
