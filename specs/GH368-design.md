# GH368 — Design : complétion du login des membres

Un seul sprint.

## 1. Données

### Types (`packages/types/src/forge.ts`)

```ts
/** GH368 — personne proposée à l'ajout d'un membre : membre d'une des organisations du compte. */
export interface ForgeMemberSuggestion {
  login: string
  /** Nom affiché (Forgejo), ou le login. */
  name: string
  /** Organisations du compte dont la personne est membre, triées. */
  orgs: string[]
}
```

`RepoSettings` (disponible) :
- **ajout** de `accountKey: string`, le compte qui donne accès au repo (la clé du compte, `host:login`) ;
- **retrait** de `orgMembers`. Il ne servait qu'à la `datalist` remplacée. `isOrg` reste déduit de
  l'appel `orgMembers` du provider.

### Provider (`forge-provider.ts`)

```ts
/** GH368 — organisations dont le compte est membre (login de l'organisation). */
listUserOrgs?(baseUrl: string, token: string): Promise<string[]>
```

- **Forgejo** : `GET /api/v1/user/orgs` (paginé), donne `username`.
- **GitHub** : la logique de `listOwners` est extraite dans une fonction `userOrgs(baseUrl, token)`.
  Avec le scope `read:org`, elle lit `/user/memberships/orgs?state=active` ; sans lui,
  `/user/orgs`. `listOwners` et `listUserOrgs` l'utilisent toutes les deux.

`listOwners` n'est pas réutilisé tel quel : il fait aussi un appel de droits par organisation, et il
écarte les organisations où l'on ne peut pas créer de repo. Ces organisations restent pourtant des
sources de suggestions.

### Service (`forge.service.ts`)

```ts
/** GH368 — membres des organisations du compte (spec §1.2, §1.6) ; jamais d'exception. */
async memberSuggestions(accountKey: string): Promise<ForgeMemberSuggestion[]>
```

1. `require(accountKey)`. Si le compte est introuvable, ou si `listUserOrgs` échoue ou manque, la
   méthode rend `[]`.
2. Pour chaque organisation, au plus 4 en parallèle : `provider.orgMembers`, avec le cache existant
   `membersCache`. Le cache est généralisé à tout provider (clé `hôte\norg`, comme aujourd'hui) par
   une méthode privée `cachedOrgMembers`, que `orgMembers(repoPath)` utilise aussi. Une
   organisation en échec, ou qui rend `null`, est ignorée ; un échec n'est pas mis en cache (même
   règle qu'aujourd'hui).
3. Fusion par login sans tenir compte de la casse. Le premier nom différent du login est gardé. Le
   compte lui-même est exclu. Les personnes sont triées par login.

**Pas de `guard`.** Un 401 ne marque pas le compte comme révoqué : c'est une aide silencieuse
(spec §1.6). L'erreur d'accès révoqué remonte déjà par les autres appels de l'écran.

### IPC et client web

- Canal `forge:member-suggestions` (`accountKey`) : `ipc/index.ts`, `api-client` (`types.ts`,
  `ipc-client.ts`).
- `channel-policy.ts` : le canal est ajouté à la liste exposée, à côté de `forge:org-teams`. Il n'a
  pas d'argument de chemin.

## 2. Renderer

### `lib/memberSuggestions.ts` (fonction pure, testée en unitaire)

```ts
export function rankMemberSuggestions(all: ForgeMemberSuggestion[], query: string,
  opts: { ownerOrg?: string; exclude: string[]; limit?: number /* 8 */ }): ForgeMemberSuggestion[]
```

- Texte vide après `trim` : la fonction rend `[]`.
- Normalisation : `NFD`, accents retirés, minuscules. Le texte est cherché dans le login ou le nom.
- `exclude` est comparé sans tenir compte de la casse.
- Tri : membre de `ownerOrg` d'abord, puis login qui commence par le texte, puis login dans l'ordre
  alphabétique.

### `components/repo/MemberLoginInput.tsx`

Champ combobox ARIA. Il remplace l'`<input>` du login dans les deux écrans.

Props : `accountKey`, `ownerOrg?`, `exclude`, `value`, `onChange`, `onSubmit(login)`, plus
`aria-label`, `placeholder` et `className` repris des champs actuels.

- Données : `useQuery(['forge-member-suggestions', accountKey], …, { staleTime: Infinity, retry: false })`.
- État : `open`, `active` (index, -1 = aucune sélection).
- `onChange` ouvre la liste et remet `active` à -1.
- Touches :
  - `↓` et `↑` déplacent la sélection, en boucle ;
  - `Entrée` appelle `onSubmit(choix ou texte)` puis ferme la liste ;
  - `Échap`, liste ouverte, la ferme et arrête la propagation (`stopPropagation` sur l'événement
    natif), si bien que `useModalHotkeys` ne ferme pas la fenêtre. Liste fermée, rien n'est fait.
- La liste se ferme quand le champ perd le focus.
- Option : `onMouseDown` + `preventDefault`, pour garder le focus, puis `onSubmit(login)`.
- Rendu : liste en position absolue sous le champ, `role="listbox"`. Chaque option, `role="option"`
  et `aria-selected`, montre le login, le nom s'il diffère, et les organisations en `text-ink-3`.
- `aria-label` de la liste : `repoWizard.members.suggestions` (« Suggestions »).

### Écrans

- `RepoMembersEditor` :
  - `ownerOrg` vaut `owner` si `ownerKind === 'org'` ;
  - `exclude` = les logins des lignes `user` déjà présentes ;
  - `onSubmit` appelle `add('user', login)` et vide le champ.
- `RepoSettingsModal` :
  - la `datalist` est retirée ;
  - `ownerOrg` vaut le propriétaire (`fullName` avant `/`) si `isOrg` ;
  - `exclude` = les logins des collaborateurs et des invitations ;
  - `onSubmit` déclenche l'ajout existant (le bouton « Ajouter »).

## 3. Fichiers

| Fichier | Changement |
|---|---|
| `packages/types/src/forge.ts` | `ForgeMemberSuggestion` ; `RepoSettings.accountKey` ajouté, `orgMembers` retiré |
| `apps/desktop/src/main/services/forge/forge-provider.ts` | `listUserOrgs?` |
| `apps/desktop/src/main/services/forge/forgejo.provider.ts` | `listUserOrgs` |
| `apps/desktop/src/main/services/forge/github.provider.ts` | `userOrgs` extrait, `listUserOrgs` |
| `apps/desktop/src/main/services/forge/forge.service.ts` | `memberSuggestions`, `cachedOrgMembers`, `repoSettings` (`accountKey`) |
| `apps/desktop/src/main/ipc/index.ts`, `packages/api-client/src/{types,ipc-client}.ts`, `apps/desktop/src/web-server/channel-policy.ts` | canal `forge:member-suggestions` |
| `apps/desktop/src/renderer/lib/memberSuggestions.ts` (+ test) | classement |
| `apps/desktop/src/renderer/components/repo/MemberLoginInput.tsx` | combobox |
| `apps/desktop/src/renderer/components/repo/RepoMembersEditor.tsx`, `RepoSettingsModal.tsx` | utilisation |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | `repoWizard.members.suggestions` |
| `apps/desktop/e2e-web/support/fake-forgejo-api.ts` | membres propres à chaque organisation : `e2e-org` → ann, bob ; `lecture` → carol (« Carol Martín ») |
| tests | voir `GH368-tests.md` |

## 4. Alternatives rejetées

- **Recherche côté serveur à chaque frappe** : écartée par la spec (débit limité, annuaire complet).
- **`datalist` native enrichie** : elle ne permet ni de mettre des groupes en tête, ni de limiter à
  8 suggestions, ni d'afficher les organisations, et son rendu dépend du navigateur.
- **Réutiliser `listOwners`** : il fait des appels en trop et écarte des organisations utiles (§1).
