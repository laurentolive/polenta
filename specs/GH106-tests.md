# GH106 — Scénarios de test

Spec : `specs/GH103.md` §1.6. Design : `specs/GH106-design.md`.

Légende : **U** = vitest (`pnpm test`, vrai repo git dans un dossier temporaire, fausse forge
`fake-forge.test-util.ts`) ; **E** = e2e web (`e2e-web/gh106-*.spec.ts`) ; **M** = manuel.

## Golden path

| ID | Sprint | Type | Scénario | Attendu |
|---|---|---|---|---|
| T-01 | 1 | U | Repo sur `int-B` créée depuis `int-A` (`project.yaml` = `int-A`), aucune modification. `designate(int-B)` | Un commit `Branche d'intégration : int-B` sur `int-B`, diff = `config/project.yaml` seul, valeur `int-B`. `git status` propre. `state().status = 'ok'` |
| T-02 | 1 | U | Même situation, avec `requirements/X.yaml` modifié et **indexé**, et `tests/Y.yaml` modifié non indexé. `designate(int-B)` | Le commit ne contient que `project.yaml`. X reste indexé, Y reste modifié, contenus intacts |
| T-03 | 1 | U | `designate(int-B)` alors que `project.yaml` vaut déjà `int-B` | `committed: false`, aucun commit, push tenté |
| T-04 | 1 | U | Repo sur `main`, `int-B` n'existe que sur `origin` (fausse remote locale). `designate(int-B)` | Branche locale créée en suivi d'`origin/int-B`, checkout, commit si nécessaire |
| T-05 | 1 | U | Fausse forge Forgejo, compte admin, push OK | `PATCH /api/v1/repos/o/r` avec `{"default_branch":"int-B"}`, `defaultBranch: 'set'` |
| T-06 | 1 | U | Même chose, compte non admin | Aucun PATCH, `defaultBranch: 'not-admin'`, `designate` réussit |
| T-07 | 1 | U | Provider GitHub (fausse API `api.github.com` via `forgeRequest` mocké) | `GET` puis `PATCH /repos/o/r`, `defaultBranch: 'set'` |
| T-08 | 1 | U | `createAndDesignate('PH2')` depuis `int-VE22D` | Branche `int-PH2` à la même position, puis commit de désignation, `project.yaml` = `int-PH2` |
| T-09 | 1 | E | Workspace e2e sur `int-B` incohérente : le bandeau de « Publier » affiche « Désigner `int-B` ». Clic | Le bandeau disparaît, « Publier » est actif |
| T-10 | 1 | M | **Cas PH2 réel** (`hmi-PH2`, `int-PH2` / `int-VE22D`) : bouton « Désigner `int-PH2` » | Critère 1 de la spec ; `origin/int-PH2` existe après coup |
| T-11 | 2 | E | Onglet Structure : menu « Intégration » d'un repo, choix d'une autre `int-*` | Libellé mis à jour, branche courante changée, commit présent si nécessaire |
| T-13 | 2 | E | « Nouvelle branche d'intégration… », saisie `v2` depuis l'intégration actuelle | `int-v2` créée, désignée, libellé « Intégration : `int-v2` » |
| T-14 | 2 | U/E | Même chose depuis une baseline (tag `v1.0`) | `int-v2` pointe sur le commit du tag + commit de désignation |
| T-15 | 1 | E | Panneau Version : création d'une branche `int-x` | Désignée et commitée sans autre action (critère 4) |

## Cas limites

| ID | Sprint | Type | Scénario | Attendu |
|---|---|---|---|---|
| T-12 | 1 | U | Deux clones désignent chacun une `int-*` différente sur des branches différentes puis s'échangent ces branches | Aucune corruption : chaque `int-*` se désigne elle-même, pas de conflit (fichiers sur des branches distinctes) |
| T-16 | 1 | U | `project.yaml` modifié en attente (clé ajoutée à la main) puis `designate(int-B)` | Commit = contenu HEAD + clé. WD = contenu modifié + clé. Le fichier reste « modifié » pour la seule clé ajoutée |
| T-17 | 1 | U | `project.yaml` et `config/` absents (repo `main` historique), `designate(int-B)` | `config/project.yaml` créé dans le commit, ne contient que `integrationBranch: int-B` |
| T-18 | 1 | U | Pas de remote `origin` | `push: 'no-remote'`, `defaultBranch: 'no-forge'`, `designate` réussit |
| T-19 | 1 | U | Push refusé (remote en erreur) | `push: { error }`, `defaultBranch: 'push-pending'`, commit local présent |
| T-20 | 1 | U | Forge en 401 au PATCH | `defaultBranch: { error }`, hôte marqué révoqué, `designate` réussit |
| T-21 | 1 | U | `designate('main')` ou `designate('int-a b')` | Erreur de validation, aucune écriture |
| T-22 | 1 | U | `createAndDesignate('A')` alors que `origin/int-A` existe | Erreur « nom pris » avant toute écriture |
| T-23 | 1 | U | Detached HEAD | `state().status = 'readonly'`, `designate` d'une branche fait le checkout puis fonctionne |
| T-24 | 1 | U | Checkout d'une `int-*` par `sync:checkout-branch` | Aucun commit, `project.yaml` inchangé |

## Gardes de suppression (§1.5)

| ID | Sprint | Type | Scénario | Attendu |
|---|---|---|---|---|
| T-25 | 1 | U | `sync:delete-branch` de la branche désignée (depuis une autre branche checkoutée) | `IntegrationBranchGuardError('designated')`, branche intacte |
| T-26 | 1 | U | Suppression de la seule `int-*` du repo (non désignée, intégration = `main`) | `IntegrationBranchGuardError('lastIntegration')` |
| T-27 | 1 | U | Suppression d'une `int-*` non désignée alors qu'il en reste une autre | Suppression effectuée |
| T-28 | 1 | U | `sync:delete-remote-branch` de la branche désignée | Refusée, aucun push `delete` envoyé |
| T-29 | 1 | U | « Publier » cas nominal : suppression de la `dev-*` éphémère | Non concernée par la garde, supprimée comme avant |
| T-30 | 2 | E | Panneau Version : supprimer la branche désignée | Message « Branche d'intégration de <repo> : désignez-en une autre avant de la supprimer » |

## Non-régression

| ID | Sprint | Type | Scénario | Attendu |
|---|---|---|---|---|
| T-31 | 1 | U | Repo en `main` sans `project.yaml` | `state().configured = 'main'`, `status = 'nonConvention'`, « Publier » inchangé |
| T-32 | 1 | U | `channel-policy.test.ts` | Les trois channels `integration:*` sont classés, args chemin déclarés |
| T-33 | 1 | E | Publication multi-repo (GH38) avec un repo incohérent | Le popover liste le repo avec « Désigner ». Après désignation, la publication repasse |
| T-34 | 2 | M | Client web : désignation depuis l'onglet Structure | Même résultat qu'en desktop |

## Critères d'acceptation (rappel spec §1.6 → scénarios)

| Critère | Scénarios |
|---|---|
| 1 | T-01, T-10 |
| 2 | T-09, T-33 |
| 3 | T-02, T-16 |
| 4 | T-08, T-13, T-15 |
| 5 | T-24 |
| 6 | T-25 – T-28, T-30 |
| 7 | T-31 |
| 8 | T-19 |
