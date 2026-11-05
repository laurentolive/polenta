# GH107 — Sprint 1 : mesure des API de forge

Mesures prévues par `GH107-design.md` §2.2. Elles remplacent les appels « écrits de mémoire » et
alimentent le faux serveur de test.

## 1. Forgejo 15.0.9 (`acme`, 2026-11-05)

Conditions : instance du kit GH45 (`DISABLE_REGULAR_ORG_CREATION=true`,
`DEFAULT_ALLOW_CREATE_ORGANIZATION=false`), organisation de l'instance `acme`. Comptes non admin
`probe107-own` (ajouté à l'équipe Owners d'`acme` par le kit) et `probe107-mem` (hors organisation).
Jetons aux scopes de Polenta (`write:repository`, `read:user`, `write:organization`), plus un jeton
avec `write:user`. Sonde Python ; repos et équipe créés puis supprimés par la sonde.

### 1.1 Résultats

| Fonction | Appel | Mesure |
|---|---|---|
| Propriétaires | `GET /user/orgs` | Organisations dont le compte est membre. Pas de droit de création dans la réponse |
| | `GET /users/{u}/orgs/{org}/permissions` | `{ is_owner, is_admin, can_write, can_read, can_create_repository }` ; non-membre d'une organisation privée : 404 |
| Créer une organisation | `POST /orgs` | 403, message vide, sur une forge du kit : seul un admin crée une organisation |
| Créer, compte personnel | `POST /user/repos` | **403 « required scope(s): [write:user] »** avec les scopes de Polenta ; 201 avec `write:user` |
| Créer, organisation | `POST /orgs/{org}/repos` | 201 avec les scopes de Polenta ; non-membre : 404 |
| Corps de création | `name, description, private, auto_init: false, default_branch` | Repo `empty: true`, `default_branch` = celle demandée (`int-x`) avant tout push |
| Erreurs de création | | Nom pris : 409 ; nom invalide : 422 « [Name]: AlphaDashDot » |
| Existence | `GET /repos/{o}/{r}` | Absent : 404. Repo privé vu par un tiers : 404 aussi |
| Détails | `GET /repos/{o}/{r}` | `private, empty, default_branch, description, permissions: { admin, push, pull }` |
| Modifier | `PATCH /repos/{o}/{r}` `{ description, private: false }` | **422 « cannot change private repository to public »**, et **rien n'est appliqué**, description comprise |
| Branches d'un repo vide | `GET /repos/{o}/{r}/branches` | 200, corps `null` (pas `[]`) |
| Collaborateurs, liste | `GET /repos/{o}/{r}/collaborators` | Objets utilisateur **sans niveau d'accès** ; contient le propriétaire d'un repo personnel ; vide pour un repo d'organisation ; pagination par `X-Total-Count` |
| Niveau d'un collaborateur | `GET …/collaborators/{u}/permission` | `{ permission, role_name, user }`, `read`/`write`/`admin` |
| Ajouter, changer | `PUT …/collaborators/{u}` `{ permission }` | 204 (ajout direct, pas d'invitation) ; `read`→`write`→`admin` par le même appel |
| Erreurs | | Utilisateur inconnu : 422 ; niveau `maintain` : 204, accepté sans erreur ; propriétaire lui-même : 204 |
| Retirer | `DELETE …/collaborators/{u}` | 204, et 204 encore si déjà retiré |
| Équipes, repo personnel | `GET /repos/{o}/{r}/teams` | 405 « repo is not owned by an organization » |
| Équipes de l'organisation | `GET /orgs/{org}/teams` | `{ id, name, permission, includes_all_repositories, can_create_org_repo, units }` |
| Créer une équipe | `POST /orgs/{org}/teams` | 201 pour un Owner, avec `write:organization` |
| Équipes du repo | `GET /repos/{o}/{r}/teams` | Comprend les équipes `includes_all_repositories` (Owners `owner`, et celles du kit) |
| Ajouter une équipe | `PUT /repos/{o}/{r}/teams/{nom}` | 204 ; déjà ajoutée : 422 ; inconnue : 404. Un corps `{ permission }` est ignoré |
| Niveau d'une équipe | | Porté par l'équipe, le même pour tous ses repos |
| Retirer une équipe | `DELETE /repos/{o}/{r}/teams/{nom}` | 204 |

### 1.2 Conséquences pour le design

1. **Scopes** : `POLENTA_TOKEN_SCOPES` reçoit `write:user`, sans quoi la création dans le compte
   personnel échoue. Un jeton existant le garde : la création personnelle refusée pour scope manquant
   est signalée avec la proposition de se reconnecter, comme `read:org` pour GitHub (§2.4).
2. **Propriétaires** : sur une forge du kit, l'utilisateur crée ses repos dans l'organisation de
   l'instance ou dans son compte ; jamais de création d'organisation. `listOwners` garde le filtre
   `can_create_repository` existant.
3. **Visibilité** : privé → public refusé par l'API pour un propriétaire non admin de l'instance.
   `updateRepo` envoie la description et la visibilité dans deux appels, pour qu'un refus de
   visibilité n'annule pas la description. Le cas est à traiter dans `GH108-design.md`.
4. **Collaborateurs** : la liste ne donne pas le niveau. `listCollaborators` lit
   `…/collaborators/{u}/permission` pour chaque collaborateur, et exclut le propriétaire d'un repo
   personnel.
5. **Équipes** : `setRepoTeam` n'a pas de niveau sur Forgejo (l'équipe le porte) ; le widget l'affiche en
   lecture seule. Les équipes `includes_all_repositories` apparaissent sur chaque repo et ne se retirent
   pas repo par repo : elles sont affichées sans action de retrait.
6. **Niveaux** : la forge accepte un niveau inconnu sans erreur. Le provider n'envoie que
   `read`/`write`/`admin`.
7. **Branches d'un repo vide** : corps `null` à traiter comme une liste vide.

Non mesuré : `maintain` accepté, niveau réellement attribué. Public → privé. Invitations : sans objet.

## 2. GitHub (`api.github.com`, 2026-11-05)

Conditions : organisation gratuite `polenta-test-org` (`laurentolive` admin), repos
`polenta-test-probe-*`, second compte `SEB-lolive` hors organisation (invité puis retiré). Jeton `gh` de
`laurentolive` (`repo`, `admin:org`, `delete_repo`). Tout ce que la sonde a créé est supprimé.

### 2.1 Résultats

| Fonction | Appel | Mesure |
|---|---|---|
| Scopes | en-tête `X-OAuth-Scopes` | Présent sur chaque réponse ; `admin:org` contient `read:org` |
| Propriétaires | `GET /user/orgs`, `GET /user/memberships/orgs` | Organisations ; l'appartenance donne `role: admin \| member` et `state` |
| Droit de création | `GET /orgs/{org}` | `members_can_create_repositories`, `…_private_…`, `…_public_…`, `members_allowed_repository_creation_type` : **remplis pour un admin, `null` pour un non-membre** ; non mesuré pour un membre non admin |
| Créer | `POST /user/repos`, `POST /orgs/{org}/repos` `{ name, description, private, auto_init: false }` | 201 ; repo vide (`size: 0`), **`default_branch: main`** quelle que soit la branche voulue |
| Erreurs de création | | Nom pris : 422, `errors[0].message` « name already exists on this account ». Non-membre : 403 « You need admin access to the organization… ». **Nom invalide : aucune erreur, renommé** (`polenta-test-probe bad!` → `polenta-test-probe-bad-`) |
| Existence | `GET /repos/{o}/{r}` | Absent : 404. Privé vu par un tiers : 404 aussi |
| Détails | `GET /repos/{o}/{r}` | `private`, `visibility`, `default_branch`, `description`, `permissions: { admin, maintain, push, triage, pull }` |
| Modifier | `PATCH /repos/{o}/{r}` `{ description, private }` | 200, les deux appliqués, privé → public compris. **Un second changement de visibilité aussitôt après : 422 « A previous visibility change is still in progress »** |
| Branches d'un repo vide | `GET /repos/{o}/{r}/branches` | 200, `[]` |
| Collaborateurs, liste | `GET …/collaborators?affiliation=direct` | `role_name` (`read`, `triage`, `write`, `maintain`, `admin`) et `permissions` dans la liste. Repo personnel : contient le propriétaire. Repo d'organisation : sans les admins de l'organisation (présents sans `affiliation`) |
| Ajouter | `PUT …/collaborators/{u}` `{ permission: pull\|push\|admin\|… }` | **201 + invitation** pour un compte hors organisation ; le collaborateur n'apparaît qu'après acceptation |
| Changer, invitation en attente | `PUT` à nouveau | 201, même invitation, **niveau inchangé**. Changement par `PATCH …/invitations/{id}` `{ permissions }` |
| Changer, collaborateur | `PUT` | 204 |
| Niveau | `GET …/collaborators/{u}/permission` | `permission` est l'ancien niveau (`triage` → `read`, `maintain` → `write`) ; le vrai est `role_name` |
| Erreurs | | Utilisateur inconnu : 404 ; niveau inconnu : 422 ; propriétaire lui-même : 422 « Repository owner cannot be a collaborator » |
| Retirer | `DELETE …/collaborators/{u}` | 204, et 204 encore si déjà retiré |
| Invitations | `GET …/invitations` | `{ id, invitee, permissions: read\|write\|triage\|maintain\|admin, created_at, expired }` |
| Annuler | `DELETE …/invitations/{id}` | 204 ; une seconde fois : 404 |
| Équipes, repo personnel | `GET /repos/{o}/{r}/teams` | 200, `[]` |
| Équipes de l'organisation | `GET /orgs/{org}/teams` | `{ id, name, slug, privacy, permission, … }` ; les appels prennent le `slug` |
| Ajouter, changer | `PUT /orgs/{org}/teams/{slug}/repos/{o}/{r}` `{ permission: pull\|push\|… }` | 204. Niveau par repo, relu dans `GET /repos/{o}/{r}/teams` (`permission`, `permissions`). Niveau inconnu : 422 ; équipe inconnue : 404 |
| Retirer | `DELETE /orgs/{org}/teams/{slug}/repos/{o}/{r}` | 204, et 204 encore si déjà retirée |

### 2.2 Conséquences pour le design

1. **Droit de création dans une organisation** (§2.4) : admin de l'organisation → oui. Membre non admin :
   les champs `members_can_create_*` ne sont garantis que pour un admin, à mesurer avec un membre non admin.
   S'ils sont `null`, l'organisation est proposée et le refus de la forge affiché, ce qui **ne respecte pas
   le critère 7 du §2.4 de la spec : à arbitrer par l'humain**.
2. **Nom du repo** : validé côté Polenta (`[A-Za-z0-9._-]`, pas de `.` ni `-` en tête comme Forgejo) avant
   la création, sinon GitHub crée sous un autre nom sans le dire. Le provider compare le `name` rendu
   au nom demandé.
3. **Branche par défaut** : GitHub ignore la branche voulue à la création ; `alignDefaultBranch` après le
   push (étape `defaultBranch`) reste nécessaire. Forgejo la prend dès la création.
4. **Visibilité** : un changement de visibilité est asynchrone. #108 ne renvoie pas un second
   changement tant que la forge répond « still in progress ».
5. **Collaborateurs** : le niveau vient de `role_name`. Un ajout rend `'invited'` si la réponse est 201 ;
   changer le niveau d'une invitation passe par `PATCH …/invitations/{id}`, `setCollaborator` le fait
   quand une invitation est en attente. Le propriétaire est exclu de la liste.
6. **Niveaux** : `read`/`write`/`admin` ↔ `pull`/`push`/`admin` en écriture ; `triage`, `maintain` lus
   tels quels (`level: string`, comme prévu).
7. **Équipes** : identifiées par `slug` ; niveau par repo, contrairement à Forgejo.
8. **Scopes** : `startGithubDeviceFlow` demande `read:org` comme prévu ; `X-OAuth-Scopes` est lu sans
   tenir compte de la casse de l'en-tête.

## 3. Écarts avec `GH107-design.md` §2

| § | Écrit | Mesuré |
|---|---|---|
| 2.2 Forgejo, créer | scopes inchangés | `write:user` requis pour un repo personnel |
| 2.2 Collaborateurs | même appel de liste | Forgejo : un appel de niveau par collaborateur ; GitHub : `role_name` |
| 2.2 Équipes | `setRepoTeam(…, level?)` | Forgejo : niveau porté par l'équipe, équipes « tous les repos » non retirables |
| 2.2 Modifier | un `PATCH` | Forgejo : privé → public refusé, tout le `PATCH` annulé ; GitHub : changement asynchrone |
| 2.4 | droit de création à mesurer | Non garanti pour un membre non admin (point 1 ci-dessus) |
