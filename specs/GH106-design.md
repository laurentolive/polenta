# GH106 — Design : branche d'intégration explicite

Spec : `specs/GH103.md` §1 (lot A de #103). Issue : #106.

## 1. Synthèse

On remplace l'écriture **non commitée** de `config/project.yaml` (`useBranchCheckout.maybeSetIntegrationBranch`)
par une opération main-side unique, **désigner**. Elle fait dans l'ordre : checkout, commit du seul
fichier, push, branche par défaut de la forge. Le renderer appelle cette opération depuis quatre
endroits :

1. la création d'une `int-*` (panneau Version, `RepoBranchSelector`) ;
2. l'action « Désigner » du bandeau de « Publier » ;
3. le nouveau menu « Intégration » de l'onglet Structure ;
4. « Nouvelle branche d'intégration… ».

Une garde main-side empêche de supprimer la branche désignée ou la dernière `int-*`.

Deux sprints :

| Sprint | Périmètre | Résultat utilisateur |
|---|---|---|
| 1 | Service `IntegrationBranchService`, IPC, branche par défaut de la forge (Forgejo + GitHub), checkout sans écriture, création = désignation, bandeau de « Publier » avec action, gardes de suppression | Le cas PH2 se débloque en un clic depuis « Publier » |
| 2 | Onglet Structure : libellé + menu « Intégration », pastilles, « Nouvelle branche d'intégration… » (depuis l'intégration ou une baseline), messages des gardes dans le panneau Version et le graphe, mises à jour SPEC, e2e | Choix explicite dans l'onglet Structure (§1.1, §1.3 de la spec) |

## 2. Main process

### 2.1 Nouveau service `main/services/integration-branch.service.ts`

```ts
export type IntegrationStatus =
  | 'ok'            // branche courante = intégration désignée, ou branche non int-*
  | 'incoherent'    // branche courante int-X, project.yaml désigne une autre branche (cas PH2)
  | 'nonConvention' // intégration désignée sans préfixe int- (main, repli)
  | 'detached'      // detached HEAD (menu actif, cf. GH106-sprint2.md « Retour de validation »)

export interface IntegrationState {
  currentBranch: string            // '' si detached
  headOid: string                  // commit de HEAD (position de retour en detached)
  configured: string               // project.yaml du WD, repli 'main' (= getIntegrationBranch actuel)
  status: IntegrationStatus
  /** int-* locales + origin/int-*, dédoublonnées, triées ; `remoteOnly` si absente en local. */
  candidates: { name: string; remoteOnly: boolean }[]
}

export interface DesignateOutcome {
  branch: string
  committed: boolean               // false si project.yaml désignait déjà la branche
  commitSha?: string
  push: 'ok' | 'no-remote' | { error: string }        // best-effort, cf. SPEC-FORKS §2.3
  defaultBranch: 'set' | 'unchanged' | 'not-admin' | 'no-forge' | 'push-pending' | { error: string }
}

export class IntegrationBranchService {
  constructor(git: GitService, sync: SyncService, forge: ForgeService, auth: AuthService)

  state(repoPath: string): Promise<IntegrationState>
  /** §1.2 de la spec : checkout si besoin, commit du seul project.yaml, push, branche par défaut. */
  designate(repoPath: string, branch: string): Promise<DesignateOutcome>
  /** §1.3 : crée `int-<suffix>` depuis `from` (intégration courante par défaut, ou un tag), puis designate. */
  createAndDesignate(repoPath: string, suffix: string, from?: { tag: string }): Promise<DesignateOutcome>
  /** §1.5 : lève IntegrationBranchGuardError si la suppression viole l'invariant. */
  assertDeletable(repoPath: string, branch: string, scope: 'local' | 'remote'): Promise<void>
}
```

Instancié dans `main/container.ts` après `forge` (dépendances : `git`, `sync`, `forge`, `auth`).

### 2.2 `designate` en détail

1. **Validation** : le nom commence par `int-` et respecte `isValidRef` (isomorphic-git
   `git.expandRef` / regex des noms de branche déjà utilisée par `dev-*`). Sinon, erreur.
2. **Checkout** si la branche courante ≠ `branch` : `sync.checkoutBranch(repoPath, branch)`.
   isomorphic-git crée la branche locale de suivi quand elle n'existe que sur `origin`
   (comportement natif de `checkout` avec `remote: 'origin'`). La garde « modifications en
   attente » reste côté renderer, comme pour tout checkout (SPEC-FORKS §2.2).
3. **Contenu commité** : lecture de `config/project.yaml` dans le **commit HEAD** (pas dans le WD)
   avec `git.readBlob({ oid: HEAD, filepath })`. Si absent : `{}`. Les clés sont conservées et
   `integrationBranch: branch` est posé. Si la valeur HEAD est déjà `branch` → `committed: false`,
   on saute à l'étape 6.
4. **Commit du seul fichier** (nouvelle méthode `SyncService.commitSingleFile(repoPath, filepath,
   content, message)`) :
   - `writeBlob(content)` → oid ;
   - reconstruction de l'arbre à partir de `readTree(HEAD)` : sous-arbre `config` lu (ou créé),
     entrée `project.yaml` remplacée ou ajoutée en mode `100644`, `writeTree` du sous-arbre puis
     de la racine ;
   - `git.commit({ tree, parent: [HEAD], ref: branch, message, author })`. L'option `tree`
     (isomorphic-git 1.38) commite cet arbre **sans lire l'index** : les modifications en attente,
     indexées ou non, ne sont pas embarquées (critère 3 de la spec).
   - Message : `Branche d'intégration : <branch>`. Auteur : `auth.getAuthor(repoPath)`, comme
     `commit()`.
5. **Réalignement de l'index et du WD sur `config/project.yaml`** :
   - WD = ancien contenu HEAD (cas courant) : on écrit le nouveau contenu dans le WD, puis
     `git.updateIndex({ filepath, oid })` → fichier propre.
   - WD ≠ ancien contenu HEAD (modification en attente du fichier lui-même, point ouvert 1 de la
     spec) : on applique la clé `integrationBranch` au contenu du WD, on écrit, et l'index reçoit
     le blob commité (`updateIndex` avec l'oid de l'étape 4). Les autres modifications du fichier
     restent en attente. Une entrée d'index déjà indexée pour ce fichier est remplacée : c'est
     acceptable, la seule clé réelle du fichier est `integrationBranch` (SPEC-TECH §4).
6. **Push** : `sync.pushBranch(repoPath, branch)` si `origin` existe, en try/catch. Un échec donne
   `push: { error }`, comme pour « Publier ». L'indicateur GH39 et l'auto-pull relancent ensuite
   le push.
7. **Branche par défaut** : seulement si le push a réussi (la forge refuse une branche par défaut
   inexistante ; sinon `push-pending`). Appel de `forge.alignDefaultBranch(repoPath, branch)` (§2.4).
   Les erreurs de la forge ne font jamais échouer `designate`.

Le pin des repos parents n'est pas propagé côté main : le renderer appelle
`propagatePinToDependents` après succès, comme après un checkout (le mécanisme et ses
avertissements existent déjà dans `useBranchCheckout`).

### 2.3 `createAndDesignate`

- `branch = 'int-' + suffix`. Refus si le nom existe en local ou sur `origin`
  (`git.listBranches` + `listBranches({ remote: 'origin' })`), **avant** toute écriture.
- Sans `from` : `sync.createBranch(repoPath, branch)`, qui crée à HEAD sans toucher au WD (T87).
  Le point de départ est la position courante. Si la branche courante n'est pas l'intégration
  désignée, le renderer fait d'abord un checkout de l'intégration (sprint 2, §3.4).
- Avec `from.tag` : `sync.createBranchAt(repoPath, branch, tagSha)` puis checkout (le WD est
  réécrit, sous la garde de confirmation du renderer).
- Puis `designate(repoPath, branch)`, qui fait toujours un commit puisque la valeur héritée diffère.

### 2.4 Forge : `ForgeService.alignDefaultBranch(repoPath, branch)`

Renvoie `'set' | 'unchanged' | 'not-admin' | 'no-forge' | { error }`.

- Résolution du provider **par compte** au lieu de `forgejoProvider` d'office : nouveau helper
  privé `providerFor(account)` (`forgejo` → `forgejoProvider`, `github` → `githubProvider`,
  sinon `null` → `no-forge`). `originTarget` est élargi aux comptes `github`. Les appelants actuels
  (`repoAccess`, `orgMembers`) gardent leur filtre `forgejo` pour ne pas changer leur comportement.
- `ForgeProvider` reçoit deux méthodes optionnelles :
  - `repoInfo?(baseUrl, token, owner, repo): Promise<{ defaultBranch: string; admin: boolean } | null>`
  - `setDefaultBranch?(baseUrl, token, owner, repo, branch): Promise<void>`
- Forgejo : `GET /api/v1/repos/{o}/{r}` (`default_branch`, `permissions.admin`) et
  `PATCH /api/v1/repos/{o}/{r}` `{ default_branch }`.
- GitHub : `GET https://api.github.com/repos/{o}/{r}` (`default_branch`, `permissions.admin`) et
  `PATCH` idem. Le scope `repo` actuel suffit. URL fixe, `fixedUrl: true` comme le reste du provider.
- Pas admin → `not-admin`, sans appel PATCH. Déjà alignée → `unchanged`. 401 ou révocation : on
  applique la règle de `guard()` (bannière de reconnexion) mais on renvoie `{ error }` au lieu de
  lever d'erreur.

### 2.5 Gardes de suppression (§1.5)

`assertDeletable(repoPath, branch, scope)` lève une `IntegrationBranchGuardError` (message i18n côté
renderer par code : `designated` | `lastIntegration`) si :

- `branch === state.configured` (lu sur la branche courante) ;
- ou `branch` commence par `int-` et aucune autre `int-*` n'existe (locale ou `origin/*`).

Appelée **dans les handlers IPC** `sync:delete-branch` et `sync:delete-remote-branch`, avant
d'appeler `SyncService`, pour que toutes les UIs (panneau Version, graphe) soient couvertes.
**Exception** : la branche éphémère `dev-*` supprimée par « Publier » ne commence pas par `int-`,
donc la garde ne la touche pas.

### 2.6 IPC et client web

| Channel | Handler | Web |
|---|---|---|
| `integration:state` | `state(repoPath)` | exposé, arg chemin `[0]` |
| `integration:designate` | `designate(repoPath, branch)` | exposé, `[0]` ; ajouté à `GRAPH_WRITE_CHANNELS` (checkout possible) |
| `integration:create` | `createAndDesignate(repoPath, suffix, from?)` | exposé, `[0]` ; `GRAPH_WRITE_CHANNELS` |

`baseline:set-integration-branch` **reste enregistré** mais n'a plus d'appelant renderer. Il est
marqué déprécié en commentaire, pour ne pas casser `channel-policy.test.ts` ni le serveur MCP
éventuel. Typage dans `packages/api-client/src/ipc-client.ts` (namespace `integration`) et types
`IntegrationState` / `DesignateOutcome` dans `packages/types`.

## 3. Renderer

### 3.1 `useBranchCheckout` (sprint 1)

- `maybeSetIntegrationBranch` est **supprimé** du `onSuccess` du checkout : un checkout ne
  commite ni n'écrit rien (spec §1.4).
- `createBranchMutation` : si le nom commence par `int-` →
  `api.integration.create(repoPath, name.slice(4))` au lieu de `sync.createBranch` + écriture,
  puis `propagatePinToDependents`. Sinon, comportement inchangé.
- Invalidation commune : `sync:status`, `sync:branches`, `baseline:integration-branch`,
  `integration:state`, `workspace-open`.

### 3.2 Hook `useDesignateIntegration(repoPath, workspaceDir, flatNodes)` (sprint 1)

Mutation partagée par le bandeau de « Publier » et l'onglet Structure :

- garde « modifications en attente » si un checkout est nécessaire (même modale que
  `RepoBranchSelector`, extraite en `CheckoutConfirmModal`) ;
- appel de `api.integration.designate` puis `propagatePinToDependents` ;
- le `DesignateOutcome` est transformé en un message de résultat court. Rien n'est affiché si tout
  est `ok`/`set`/`unchanged`. Une ligne est ajoutée pour un push en échec ou une branche par
  défaut non alignée (`not-admin`, `push-pending`, erreur).

### 3.3 « Publier » (sprint 1)

- `ModificationControl`, `mode === 'blocked'` : le texte devient
  `layout.modificationControl.notDesignated` (« `int-PH2` n'est pas désignée comme branche
  d'intégration (le fichier indique `int-VE22D`) »), suivi d'un bouton « Désigner `int-PH2` »
  (`useDesignateIntegration`). La clé `blockedBranch` est retirée de `fr.json` et `en.json`.
- Popover `PublishBlockedError` (multi-repo, GH38) : chaque ligne bloquée reçoit son bouton
  « Désigner ». Après la désignation, l'erreur est effacée et l'utilisateur relance « Publier ».
- `useModificationMode` ne change pas : le mode `blocked` disparaît naturellement quand
  `project.yaml` désigne la branche courante.

### 3.4 Onglet Structure (sprint 2)

Nouveau composant `components/schema/IntegrationBranchMenu.tsx`, rendu dans `RepoRow` juste après
`RepoBranchSelector`. Il n'est pas rendu pour `LocalNodeRow` (même repo que le parent).

- Données : `useQuery(['integration:state', repoPath])`, rafraîchie à l'ouverture du menu et
  toutes les 10 s quand la ligne est visible. On ne fait pas de polling 3 s par repo (même
  raison que `RepoBranchSelector`).
- Libellé : `Intégration : <configured>`. Pastille `status-warning` pour `incoherent`, pastille
  `ink-3` pour `nonConvention`, menu actif en `detached` (choisir une branche en fait le checkout).
- Menu : `candidates` (cochée = `configured`, mention « distante » si `remoteOnly`), séparateur,
  « Nouvelle branche d'intégration… ». En `incoherent`, l'action « Désigner `<currentBranch>` » est
  en tête du menu.
- `NewIntegrationBranchModal.tsx` : préfixe `int-` fixe à gauche du champ, validation en direct
  (caractères, nom pris : liste `candidates` + erreur serveur), choix du point de départ
  « Branche d'intégration actuelle » / « Baseline » (liste `sync:tags`). Si la branche courante
  n'est pas l'intégration et que le départ est l'intégration actuelle, un checkout est fait
  d'abord, sous la garde des modifications en attente.

### 3.5 Messages des gardes (sprint 2)

`BranchCombobox` (suppression) et `graph.tsx` (suppression locale et distante) affichent l'erreur
`IntegrationBranchGuardError` traduite au lieu d'une erreur générique. On ne masque pas le bouton
préventivement : la garde main-side fait foi, et l'erreur est explicite.

## 4. Mises à jour SPEC (dernier sprint)

- `SPEC-FORKS-BRANCHES-BASELINES.md` §2.1 : ligne « `int-*` ≠ intégration » → bandeau + action
  Désigner. §2.2 : remplacer le paragraphe `IntegrationBranchSelector` par le menu « Intégration »
  et la règle « désigner = commit + push ». §2.3 : création manuelle d'une `int-*` = désignation ;
  suppression gardée.
- `SPEC-TECH-stack.md` §4 : invariant « sur `int-X`, `project.yaml` désigne `int-X` », commit
  d'un seul fichier.
- `SPEC-ELECTRON-DESKTOP.md` §20 : onglet Structure, `IntegrationBranchMenu`, IPC `integration:*`.
- `SPEC-WEB.md` : channels exposés.
- `SPEC-INDEX.md` : colonne MAJ → GH106.

## 5. Décisions et alternatives rejetées

| Décision | Alternative rejetée | Raison |
|---|---|---|
| Commit construit par arbre (`tree` + `parent`), index non lu | `stage(project.yaml)` + `commit()` | `commit()` embarque tout l'index : des modifications déjà indexées partiraient dans le commit de désignation |
| Désignation main-side en une opération | Orchestration renderer (stage, commit, push en IPC séparés) | Une seule erreur à gérer, testable en vitest sur un vrai repo, et le même comportement pour le client web |
| Checkout d'une `int-*` sans effet de bord | Garder la désignation au checkout (avec commit) | Un checkout ne doit pas créer de commit (spec §1.4) |
| Garde de suppression dans les handlers IPC | Garde dans chaque UI | Le panneau Version et le graphe (local et distant) sont couverts d'un coup, comme le client web |
| Branche par défaut alignée après un push réussi seulement | Alignement avant le push | La forge refuse une branche par défaut qui n'existe pas encore sur le serveur |
| `baseline:set-integration-branch` conservé, déprécié | Suppression | Évite de casser la liste blanche web et un éventuel appelant MCP ; suppression dans un ticket de nettoyage |

## 6. Hors périmètre du design

Lots B et C (#107, #108). Conflit entre deux postes qui désignent en même temps : il passe par les
flux de merge existants (GH37). Le point ouvert 2 de la spec n'est donc pas traité par un mécanisme
dédié, seulement par un scénario de test (T-12).
