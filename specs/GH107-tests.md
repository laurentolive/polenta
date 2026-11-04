# GH107 — Scénarios de test

Spec : `specs/GH103.md` §2.4. Design : `specs/GH107-design.md`.

Légende : **U** = vitest, vrai repo git et faux serveur (`fake-forge.test-util.ts`) ; **E** = e2e web
(`e2e-web/gh107-*.spec.ts`), forge locale ; **M** = manuel sur une vraie forge.

Comptes pour le manuel GitHub : `laurentolive` crée, `SEB-lolive` est le second compte. Repos `polenta-test-*`.

## Providers (sprint 1)

| ID | Type | Scénario | Attendu |
|---|---|---|---|
| P-01 | U | `createRepo` compte personnel, Forgejo puis GitHub | `POST /user/repos`, nom, description, visibilité, sans `auto_init` |
| P-02 | U | `createRepo` organisation, Forgejo puis GitHub | `POST /orgs/{org}/repos` |
| P-03 | U | Nom déjà pris, à la création | `RepoNameTakenError` |
| P-04 | U | `listOwners` Forgejo | Compte + organisations avec droit de création seulement |
| P-05 | U | `listOwners` GitHub, jeton sans `read:org` | Compte personnel, `scopeMissing: true` |
| P-06 | U | `repoDetails` : 200, 404, 403 | Détails ; `null` ; erreur |
| P-07 | U | Compte `generic` | Refusé par `ForgeService.require` |
| P-08 | U | `forgeAccounts` et `repoAccounts`, comptes des trois types | Forgejo seul ; GitHub et Forgejo |
| P-09 | M | Mesure de chaque appel du §2.2 du design sur Forgejo et GitHub | Réponses reportées dans le faux serveur |

## Création (sprint 2)

| ID | Type | Critère | Scénario | Attendu |
|---|---|---|---|---|
| C-01 | U | 1 | `create`, projet | Un seul commit sur `int-x`, avec `README.md`, `config/project.yaml`, fichiers Polenta. Aucune branche `main`, en local ni dans la requête de push |
| C-02 | U | 1 | Séquence | `remote`, `local`, `push`, `defaultBranch`, `members`, `open` dans cet ordre |
| C-03 | U | 1 | Membres | Un appel par membre après le push |
| C-04 | U | 6 | Push en échec | Repo distant non supprimé, `push: failed`, suivantes `skipped` |
| C-05 | U | 6 | Un membre en échec | Les suivants sont appliqués, `detail` nomme l'échec |
| C-06 | U | 2 | Nom pris juste avant la création | Refus, aucune écriture |
| C-07 | U | | `create`, composant | Dossier temporaire supprimé, `cloneUrl` et `branch` rendus |
| C-08 | U | | Création locale sans options | Toujours sur `main`, inchangée |
| C-09 | E | 2 | Assistant : nom pris | Signalé pendant la saisie, bouton désactivé |
| C-10 | E | 2 | Description vide, ou branche invalide | Bouton désactivé |
| C-11 | E | 7 | Compte sans droit dans une organisation | Organisation absente de la liste |
| C-12 | E | 1 | Création sur la forge locale | Projet ouvert sur `int-x` |
| C-13 | E | | Composant depuis Structure | Pin `int-x` dans `polenta-repo.yaml` |
| C-14 | M | 1 | GitHub, compte personnel | Repo avec visibilité et description, seule branche `int-x`, par défaut |
| C-15 | M | 1 | GitHub, organisation de test | Idem, membres ayant accès |
| C-16 | M | 1 | Forgejo du VPS, organisation | Idem |

## Adoption (sprint 3)

| ID | Type | Critère | Scénario | Attendu |
|---|---|---|---|---|
| A-01 | U | 3 | Repo vide | `empty`, parcours complet, état final de C-01 |
| A-02 | U | 4 | Repo complet | `missing` vide, aucun commit, aucune question |
| A-03 | U | 5 | Sans `int-*` ni `README.md` | Seuls ces deux éléments dans `missing`, état final conforme |
| A-04 | U | | `int-*` désignée par `project.yaml`, branche par défaut autre | `integration.source = 'project-yaml'`, branche par défaut alignée si admin |
| A-05 | U | | `project.yaml` désigne une `int-*` absente de `origin` | `integration` absente |
| A-06 | U | | Sans `.polenta/`, sans `initPolenta` | Abandon, aucune écriture |
| A-07 | U | | Sans droit d'écriture, repo complet | Ajouté en lecture seule, aucune écriture |
| A-08 | U | | Sans droit d'écriture, incomplet | Refus avec la liste |
| A-09 | U | | Écriture sans admin | Locaux complétés, description et branche par défaut listées |
| A-10 | U | 6 | Reprise après l'échec de C-04 | L'adoption termine, sans nouveau repo |
| A-11 | E | 5 | Assistant sur un repo incomplet | Seules les questions manquantes |
| A-12 | E | | URL d'un autre hôte | Flux actuel, sans inspection |
| A-13 | M | 3, 4, 5 | GitHub : repos `polenta-test-*` vide, complet, incomplet | États de A-01, A-02, A-03 |
| A-14 | M | | Avec `SEB-lolive`, lecture seule puis écriture | A-07, A-08, A-09 |

## Non-régression

| ID | Type | Scénario | Attendu |
|---|---|---|---|
| N-01 | U | `channel-policy.test.ts` | Nouveaux channels classés, chemins déclarés |
| N-02 | E | `forge-p1.spec.ts`, `forge.spec.ts` | À adapter à l'assistant, même résultat |
| N-03 | M | Client web, Forgejo | Création et adoption, comme le desktop |
