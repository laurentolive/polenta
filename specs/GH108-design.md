# GH108 — Design : paramètres du repo

Spec : `specs/GH103.md` §3. Issue : #108. S'appuie sur les providers et sur `RepoMembersEditor` livrés par #107
(`specs/GH107-design.md`, sprints 1 et 2). Un sprint : le sprint 4 du découpage de #107.

## 1. Main

`ForgeService`, à partir de `originTarget(repoPath, ['forgejo', 'github'])` :

```ts
repoSettings(repoPath): Promise<RepoSettings | null>   // null : sans objet (generic, sans compte)
updateRepoSettings(repoPath, patch): Promise<void>
setCollaborator(repoPath, login, level) / removeCollaborator(repoPath, login)
setRepoTeam(repoPath, team, level?) / removeRepoTeam(repoPath, team)
cancelInvitation(repoPath, id)
```

`RepoSettings = { available: true; details; collaborators; teams; invitations; orgTeams; isOrg; scopeMissing } | { available: false; reason: 'offline' }`.
Chaque écriture exige `permissions.admin`, revérifié côté main : l'interface n'est pas la seule barrière.

**Gardes du §3.2 de la spec**, dans le service : retrait du dernier admin direct refusé quand aucune équipe admin
n'existe sur le repo, avec un marqueur traduit comme pour les gardes de GH106. Le retrait de son propre accès admin
n'est pas refusé, sa confirmation se fait côté renderer.

Le `README.md` suit la description : commit par `commitSingleFile` sur l'intégration, après confirmation, en
remplaçant le paragraphe qui suit le titre. Un `README.md` sans cette forme n'est pas réécrit : la fenêtre le dit.

## 2. Renderer

- **Accès** : icône sur `RepoRow`, affichée si `forge:repo-settings-available(repoPath)` est vrai. Sans appel réseau :
  compte connecté de type `github` ou `forgejo` pour l'hôte d'`origin`.
- `components/repo/RepoSettingsModal.tsx` : sections **Général** et **Membres**, en portail comme les fenêtres de GH106.
- **Non admin** : sections en lecture seule, mention « Réservé aux administrateurs du repo ».
- **Hors ligne** : « indisponible hors ligne ».
- **Passage en public** : confirmation qui rappelle que tout le contenu, historique compris, devient lisible.
- `RepoMembersEditor` en mode direct : chaque action est appliquée à la forge, l'erreur s'affiche sur sa ligne.

| Channel | Web |
|---|---|
| `forge:repo-settings-available`, `forge:repo-settings` | exposés, chemin `[0]` |
| `forge:update-repo-settings`, `forge:set-collaborator`, `forge:remove-collaborator`, `forge:set-repo-team`, `forge:remove-repo-team`, `forge:cancel-invitation` | exposés, chemin `[0]` |

## 3. Niveau d'une équipe sur Forgejo (mesuré)

Mesure du 2026-11-05 (`specs/GH107-sprint1.md` §1) : `PUT /repos/{o}/{r}/teams/{team}` n'a pas de niveau, celui-ci
appartient à l'équipe pour tous ses repos. Donc :

- GitHub : niveau choisi et modifiable par repo ;
- Forgejo : niveau affiché en lecture, attribution et retrait seulement, avec un lien vers les équipes sur la forge.
  Une équipe `includes_all_repositories` n'a pas d'action de retrait.

Le critère 1 du §3.3 de la spec est amendé en ce sens, comme le critère 2 pour `FORCE_PRIVATE` (§6).

## 3bis. Écarts au moment du code

- **Autocomplétion** : les membres sont rendus par `repoSettings` (`orgMembers`), `githubProvider.orgMembers` ajouté.
  `forge:org-members`, qui sert le champ `user`, reste limité à Forgejo.
- **Gardes** : refus en texte français, comme les autres erreurs de forge, sans marqueur traduit. La rétrogradation
  du dernier admin direct est refusée comme son retrait.
- **Lecteur** : une liste que la forge refuse (403, 404) reste vide, avec une mention (`membersRestricted`).
- **README** : `forge:readme-state` et `forge:sync-readme`, `RepoSettingsService`. Hors intégration ou avec une
  modification en attente sur ce fichier, rien n'est écrit et la fenêtre le dit. README absent : créé.

## 4. Mises à jour SPEC

`SPEC-PROJECT-MANAGEMENT` §9.4, `SPEC-TEMPLATES` §3, `SPEC-INDEX`.

## 5. Scénarios de test

Légende : voir `specs/GH107-tests.md`.

| ID | Type | Critère | Scénario | Attendu |
|---|---|---|---|---|
| S-01 | U | 1 | Collaborateur : ajouter, changer, retirer, Forgejo et GitHub | Bons appels, niveaux traduits |
| S-02 | U | 1 | GitHub : ajout d'un non-membre | `invited`, listé parmi les invitations, annulable |
| S-03 | U | 1 | Équipe, Forgejo et GitHub | Selon le §3 |
| S-04 | U | | Retrait du dernier admin direct, aucune équipe admin | Refusé |
| S-05 | U | | Retrait du dernier admin direct, équipe admin présente | Accepté |
| S-06 | U | 3 | Écriture sans droit admin | Refusée côté main, sans appel à la forge |
| S-07 | U | | Niveau `maintain` sur GitHub | Affiché tel quel, pas proposé |
| S-08 | U | | Description modifiée, `README.md` de forme standard | Commit du seul `README.md` |
| S-09 | U | | `README.md` de forme libre | Non réécrit, signalé |
| S-10 | E | 2 | Passage en public | Confirmation exigée |
| S-11 | E | 3 | Compte non admin | Lecture seule, sans erreur |
| S-12 | E | 4 | Forge injoignable | La fenêtre s'ouvre, « indisponible hors ligne » |
| S-13 | E | | Repo `generic` ou sans compte | Pas d'icône |
| S-14 | E | | Retrait de son propre accès admin | Confirmation |
| S-15 | M | 1, 2 | GitHub : `laurentolive` admin, `SEB-lolive` collaborateur | La forge suit chaque action |
| S-16 | M | 3 | GitHub, connecté en `SEB-lolive` non admin | Lecture seule |
| S-17 | M | 1, 2 | Forgejo du VPS | La forge suit chaque action |
| S-18 | M | 1 | Équipe, sur une organisation GitHub de test et sur Forgejo | Selon le §3 |

## 6. Forge du kit : pas de repo public

`deploy/polenta-host.sh` fixe `repository__FORCE_PRIVATE=true`. Mesuré sur `acme` : `POST /user/repos` avec
`private: false` répond 201 et crée un repo privé ; `PATCH { private: false }` répond 422. La fenêtre affiche le refus
(`VisibilityChangeError`). Défaut de #107 corrigé ici : l'assistant signale un repo créé privé alors que public était
demandé (étape `remote`, statut `admin`).
