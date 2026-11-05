# GH107 — Design : ajouter un repo (création ou adoption)

Spec : `specs/GH103.md` §2 et §4. Issue : #107. Le lot C est décrit dans `specs/GH108-design.md`.

## 1. Synthèse

Un service main-side, `RepoProvisioningService`, crée ou complète un repo sur la forge et rend compte
étape par étape. Un seul assistant renderer, `AddRepoWizard`, l'appelle depuis les trois points d'entrée.

| Sprint | Ticket | Périmètre | Résultat utilisateur |
|---|---|---|---|
| 1 | #107 | Providers GitHub et Forgejo (création, repos, propriétaires, droits, membres, équipes, description, visibilité), `ForgeService` par compte, scope `read:org` | Aucun changement visible, sauf `read:org` demandé à la connexion GitHub |
| 2 | #107 | `RepoProvisioningService.create`, `AddRepoWizard` en mode Nouveau repo, widget Membres, 2 points d'entrée « Créer » | Création complète sur GitHub et Forgejo, sur une `int-*` |
| 3 | #107 | `inspect` et `adopt`, mode Repo existant, point d'entrée « Depuis un repo » | Un repo existant aboutit au même résultat |
| 4 | #108 | Fenêtre « Paramètres du repo » | `specs/GH108-design.md` |

Le widget Membres est construit au sprint 2 parce que la création en a besoin (§2.2 de la spec). Le lot C le
réutilise.

## 2. Providers (sprint 1)

### 2.1 Interface `ForgeProvider`

Méthodes ajoutées, implémentées par `forgejoProvider` et `githubProvider`. Toutes sont paginées si l'API l'est.

```ts
listOwners(baseUrl, token, login): Promise<ForgeOwner[]>            // compte personnel + organisations où créer
repoExists(baseUrl, token, owner, name): Promise<boolean>
createRepo(baseUrl, token, input: CreateRepoInput): Promise<ForgeRepo>
repoDetails(baseUrl, token, owner, repo): Promise<ForgeRepoDetails | null>
updateRepo(baseUrl, token, owner, repo, patch: { description?: string; visibility?: RepoVisibility }): Promise<void>
listCollaborators(...): Promise<ForgeCollaborator[]>
setCollaborator(..., login, level: RepoAccessLevel): Promise<'added' | 'invited'>
removeCollaborator(..., login): Promise<void>
listRepoTeams(...): Promise<ForgeRepoTeam[]>
listOrgTeams(baseUrl, token, org): Promise<ForgeTeam[]>
setRepoTeam(..., team, level?: RepoAccessLevel): Promise<void>
removeRepoTeam(..., team): Promise<void>
listInvitations?(...): Promise<ForgeInvitation[]>                    // GitHub seulement
cancelInvitation?(..., id): Promise<void>
```

`createOrgRepo` et `listCreatableOrgs` sont remplacées par `createRepo` et `listOwners`, puis retirées.

Types dans `packages/types/src/forge.ts` : `RepoVisibility = 'private' | 'public'` ;
`RepoAccessLevel = 'read' | 'write' | 'admin'` ; `ForgeOwner = { name, label, kind: 'user' | 'org' }` ;
`CreateRepoInput = { owner, ownerKind, name, description, visibility }` ;
`ForgeRepoDetails = { description, visibility, defaultBranch, permissions: { pull, push, admin } }` ;
un collaborateur porte `level: RepoAccessLevel | string`, pour afficher tels quels `triage` et `maintain`.

### 2.2 Appels

| Fonction | Forgejo (`/api/v1`) | GitHub (`api.github.com`, `<base>/api/v3`) |
|---|---|---|
| Propriétaires | `GET /user`, `GET /user/orgs` + `can_create_repository` (existant) | `GET /user`, `GET /user/orgs`, droit de création : voir §2.4 |
| Créer | `POST /user/repos` ou `POST /orgs/{org}/repos` | idem |
| Corps | `name, description, private, auto_init: false, default_branch` | `name, description, private, auto_init: false` |
| Détails | `GET /repos/{o}/{r}` | idem |
| Modifier | `PATCH /repos/{o}/{r}` `{ description, private }` | idem |
| Collaborateurs | `GET`, `PUT {permission}`, `DELETE` sur `/repos/{o}/{r}/collaborators[/{u}]` | idem, `affiliation=direct` en lecture |
| Équipes du repo | `GET /repos/{o}/{r}/teams`, `PUT` et `DELETE /repos/{o}/{r}/teams/{team}` | `GET /repos/{o}/{r}/teams`, `PUT` et `DELETE /orgs/{org}/teams/{slug}/repos/{o}/{r}` |
| Invitations | sans objet | `GET`, `DELETE /repos/{o}/{r}/invitations[/{id}]` |

Niveaux : Forgejo `read`/`write`/`admin`, GitHub `pull`/`push`/`admin`.

Mesurés le 2026-11-05 (`specs/GH107-sprint1.md`, qui fait foi pour le détail). Ce qui change par rapport
au tableau ci-dessus :

- **Forgejo, compte personnel** : `POST /user/repos` exige le scope `write:user` ; `POLENTA_TOKEN_SCOPES`
  le reçoit. Un jeton antérieur sans ce scope : refus 403 « required scope(s) » rendu comme
  `ScopeMissingError`, l'assistant propose de se reconnecter.
- **GitHub, nom** : un nom invalide est renommé sans erreur. `createRepo` valide le nom avant l'appel
  (`[A-Za-z0-9._-]`, ni `.` ni `-` en tête) et compare le `name` rendu.
- **GitHub, branche par défaut** : ignorée à la création (`main`) ; l'étape `defaultBranch` l'aligne.
- **Modifier** : `updateRepo` envoie la description puis la visibilité, en deux `PATCH`. Forgejo refuse
  privé → public à un non-admin de l'instance et annule tout le `PATCH` ; GitHub refuse un second
  changement de visibilité tant que le premier est en cours (« still in progress »). Les deux refus sont
  rendus avec leur message (`VisibilityChangeError`).
- **Collaborateurs** : Forgejo ne donne pas le niveau dans la liste, `listCollaborators` lit
  `…/collaborators/{u}/permission` par collaborateur (`role_name`) ; GitHub le donne (`role_name`). Le
  propriétaire d'un repo personnel est exclu. `setCollaborator` sur GitHub : 201 = `'invited'` ; si une
  invitation est en attente, le niveau passe par `PATCH …/invitations/{id}`.
- **Équipes** : GitHub, `slug` et niveau par repo ; Forgejo, niveau porté par l'équipe
  (`ForgeRepoTeam.levelEditable: false`) et équipes `includes_all_repositories` non retirables
  (`removable: false`). Équipes d'un repo personnel : Forgejo 405, GitHub `[]` ; les deux rendent `[]`.
- **Branches d'un repo vide** : Forgejo rend `null`, traité comme `[]`.

### 2.3 `ForgeService`

- `require(accountKey)` n'exige plus `forgejo` mais une forge ayant un provider, et rend ce provider.
- `AuthService.repoAccounts()` (nouveau) : comptes `github` et `forgejo` avec jeton. `forgeAccounts()` reste
  limité à Forgejo pour ses appelants actuels, qui n'ont pas à proposer GitHub (`TeamProjects`, GH45).
- `listRepos`, `creatableOrgs` : passent par le provider du compte. `CONFIG_REPO` reste filtré.
- `repoAccess`, `orgMembers` : même filtre `forgejo` qu'aujourd'hui, inchangé par ce ticket.
- `MachineConfig.hideGithub` : sans effet ici, un compte GitHub n'existe alors pas.

### 2.4 Scope GitHub

`startGithubDeviceFlow` demande `repo user:email read:org`. Un jeton existant n'est pas invalidé : il garde
ses droits.

Sans `read:org`, `GET /user/orgs` peut ne pas lister les organisations. L'en-tête `X-OAuth-Scopes` est lu par
`githubProvider` (`forgeRequest` doit exposer les en-têtes de la réponse). S'il manque le scope :
`listOwners` rend le compte personnel et `scopeMissing: true` ; l'assistant propose de se reconnecter, sans
bloquer. Droit de création dans une organisation GitHub (mesuré) : admin (`/user/memberships/orgs`,
`role: admin`) → oui ; membre → `members_can_create_repositories` de `GET /orgs/{org}` s'il est rempli,
sinon l'organisation est proposée (`ForgeOwner.canCreate: 'unknown'`). Un refus 403 à la création devient
`OwnerCreateForbiddenError`, affiché avec un message explicatif (critère 7 amendé, décision de l'humain
du 2026-11-05).

## 3. Création (sprint 2)

### 3.1 `main/services/forge/repo-provisioning.service.ts`

```ts
export type ProvisionStepId = 'remote' | 'local' | 'push' | 'defaultBranch' | 'members' | 'open'
export type ProvisionStep = { id: ProvisionStepId; status: 'done' | 'failed' | 'skipped'; detail?: string }

export interface CreateRepoRequest extends CreateRepoInput {
  accountKey: string
  integrationSuffix: string              // « x » de int-x
  members: RepoMemberGrant[]
  target: { kind: 'project'; containerDir: string } | { kind: 'component' }
}

create(req): Promise<{ steps: ProvisionStep[]; cloneUrl?: string; branch: string; open?: WorkspaceOpenResult }>
```

Séquence (§2.2 de la spec). Validation complète avant tout appel d'écriture, dont `repoExists` une dernière fois.

1. `remote` : `createRepo`. Un échec arrête tout, rien n'a été écrit.
2. `local` : dossier du projet, ou dossier temporaire pour un composant (comme `createComponentOnServer`).
3. `push` : `sync.pushBranch(dir, int-x)`.
4. `defaultBranch` : `forge.alignDefaultBranch` (existant). Seulement si `push` a réussi.
5. `members` : un appel par membre. Un échec n'arrête pas les suivants ; `detail` les nomme.
6. `open` : accueil, ouverture du workspace ; composant, `cloneUrl` et `branch` rendus à la fenêtre d'ajout.

Un échec après l'étape 1 ne supprime jamais le repo distant : les étapes restantes sont `skipped`, la fenêtre
indique le repo créé et le moyen de reprendre.

### 3.2 Contenu local

`WorkspaceService.initProjectRepo(dir, options?)` reçoit `{ integrationBranch, name, description }`. Avec
`options` : `git.init` sur cette branche, et dans le **même premier commit** `README.md` (titre = nom,
paragraphe = description) et `config/project.yaml` (`integrationBranch`). Sans `options` : comportement actuel
sur `main`, pour la création locale, qui reste hors de ce ticket.

`createNewProject(containerDir, name, options?)` transmet les options. `publishMain`,
`createProjectOnServer` et `createComponentOnServer` sont retirés, avec leurs channels
(`workspace:create-on-server`, `workspace:create-component-on-server`) une fois l'assistant branché.

### 3.3 Composant

Au retour de `create`, la fenêtre d'ajout reçoit l'URL **et** la branche, et inscrit `int-x` comme pin de
`polenta-repo.yaml`. `CreateRepoOnServer` ne rendait que l'URL et est retiré.

### 3.4 Channels

| Channel | Web |
|---|---|
| `forge:repo-accounts` | exposé |
| `forge:owners(accountKey)` | exposé |
| `forge:name-available(accountKey, owner, name)` | exposé |
| `forge:create-repo(req)` | exposé. `containerDir` de la requête vérifié comme chemin du serveur, ajouté à `GRAPH_WRITE_CHANNELS` |
| `forge:org-teams(accountKey, org)` | exposé |

`channel-policy.ts` et son test sont à compléter. Point ouvert 4 de la spec : le client web passe par les mêmes
channels ; `forge:repo-accounts` y rend le compte de la session OIDC. À vérifier en e2e web, Forgejo seulement.

## 4. Adoption (sprint 3)

### 4.1 `inspect(accountKey, owner, repo)`

Rend ce qui existe, sans rien écrire :

```ts
export interface RepoInspection {
  details: ForgeRepoDetails
  empty: boolean
  integration: { branch: string; source: 'default' | 'project-yaml' } | null
  hasReadme: boolean
  hasDescription: boolean
  isPolentaProject: boolean
  missing: Array<'integration' | 'description' | 'polenta'>
}
```

Lecture par un **clone partiel** de la branche par défaut dans un dossier temporaire (`depth: 1`,
`singleBranch`), le même pour toute forge, sans API de contenu par forge. Un repo vide est reconnu à l'absence
de ref (`git.getRemoteInfo`). Écarté : l'API de contenu de chaque forge, deux implémentations pour un résultat
identique sur des repos de YAML et de drawio.

Présence selon le tableau du §2.3 de la spec. `integration` : branche par défaut en `int-*`, sinon `integrationBranch`
de son `project.yaml` si cette `int-*` existe sur `origin`.

### 4.2 `adopt(req)`

`req` porte les réponses demandées : `integrationSuffix?`, `description?`, `initPolenta?: true`. Repo vide : parcours
de création du §3, sans l'étape `remote`.

Repo non vide, dans un clone complet (dossier du projet, ou temporaire pour un composant) :

1. `integration` absente : création de `int-x` depuis la branche par défaut, puis `integration.designate`
   (GH106), qui commite, pousse et aligne la branche par défaut.
2. `description` : `updateRepo` si admin ; `README.md` absent : commit sur l'intégration, par
   `commitSingleFile` (GH106).
3. `polenta` : commit de l'initialisation sur l'intégration, seulement si `initPolenta` est vrai. L'assistant
   exige cette confirmation, sinon il abandonne.
4. Push de l'intégration, puis ouverture ou retour à la fenêtre d'ajout, comme au §3.

Droits (§2.3 de la spec) :

| Droit | Comportement |
|---|---|
| Sans écriture | Rien n'est écrit. Repo complet : ajouté en lecture seule. Sinon : refus avec la liste de ce qui manque |
| Écriture sans admin | Éléments locaux complétés ; description et branche par défaut listées « à faire par un administrateur du repo » |

### 4.3 Saisie d'une URL

Une URL sur l'hôte d'un compte connecté passe par `inspect`. Une URL d'un autre hôte, ou un compte `generic`,
garde le flux actuel, sans complétion : Polenta n'a pas d'API à interroger.

## 5. Renderer

`components/repo/AddRepoWizard.tsx`, avec `mode: 'project' | 'component'` :

- **Étape 1** : Nouveau repo ou Repo existant (liste du compte avec recherche, `RepoPickerModal` réutilisé, ou URL).
- **Nouveau repo** : service, propriétaire, nom, visibilité, description, branche, membres. Bouton désactivé tant
  que le critère 2 du §2.4 de la spec n'est pas rempli.
- **Disponibilité** : `forge:name-available` à la pause de frappe (400 ms), le résultat d'une frappe dépassée est ignoré.
- **Branche** : préfixe `int-` fixe, pré-remplie avec le nom, validée par `isValidIntegrationSuffix` (GH106).
- **Repo existant** : affiche ce qui a été trouvé, puis ne demande que `missing`.
- **Résultat** : liste des étapes (`ProvisionStep`), avec la reprise possible en cas d'échec.

`components/repo/RepoMembersEditor.tsx` : collaborateurs et équipes, autocomplétion sur les membres de
l'organisation. En mode création, il n'accumule que des demandes, appliquées à l'étape `members`.

`CreateProjectModal` garde le choix « Local » et ouvre l'assistant pour le serveur. `AddDependencyModal` remplace
`CreateRepoOnServer` par l'assistant. `routes/index.tsx` : « Depuis un repo » ouvre l'assistant s'il y a un compte
éligible, sinon garde `TextPromptModal`.

## 6. Mises à jour SPEC (dernier sprint de #107)

`SPEC-PROJECT-MANAGEMENT` §9, `SPEC-TEMPLATES` §3, `SPEC-ELECTRON-DESKTOP` §16 et §20, `SPEC-ACCOUNTS-AUTH` §4 et
§8, `SPEC-WEB` (channels), `SPEC-FORKS-BRANCHES-BASELINES` si le comportement de désignation change,
`SPEC-INDEX`.

## 7. Décisions et alternatives rejetées

| Décision | Alternative rejetée | Raison |
|---|---|---|
| `repoAccounts()` à côté de `forgeAccounts()` | Élargir `forgeAccounts()` | Ses appelants ne doivent pas se mettre à proposer GitHub |
| Inspection par clone partiel | API de contenu de chaque forge | Une seule implémentation |
| Étapes rendues en résultat | Exception au premier échec | La spec demande les étapes réussies et échouées |
| Premier commit unique avec README et `project.yaml` | Init puis `designate` | Sinon `main` existerait, et la spec n'en veut aucune |
| Le pin d'un composant créé vaut `int-x` | Pin laissé vide | Le composant serait sinon sur une branche implicite |

## 8. Risques

- **Niveau d'une équipe sur Forgejo** : voir `specs/GH108-design.md` §3, qui peut amender la spec.
- **Droit de création en organisation GitHub** : §2.4.
- **Jeton GitHub sans `read:org`** : l'utilisateur doit se reconnecter pour voir ses organisations privées.
- **Organisation GitHub restreignant les OAuth Apps** : elle peut refuser le jeton même avec les bons scopes.
  Le message de la forge est alors affiché tel quel.
