# GH20 — Design : IDs par parsing + pierres tombales

Spec : `specs/GH20.md`. Tests : `specs/GH20-tests.md`.

## 1. Vue d'ensemble

Un seul module, `apps/desktop/src/main/services/id-counter.util.ts` (conservé sous ce
nom pour limiter le diff des imports), porte toute l'attribution et la pose des pierres
tombales. Les services ne manipulent plus jamais `config/counters.yaml`.

```
create()  ──► nextCounterId(git, repo, prefix, dir) ──► [file sérialisée par repo]
                                                          ├─ migrateCountersIfPresent(repo)
                                                          └─ max(disque, tombstones, mémoire) + 1
delete()  ──► deleteWithTombstone(git, repo, relPath, id)
                ├─ écrit .polenta/tombstones/<id> (vide)
                └─ git.deleteFile(repo, relPath)
dryRun    ──► peekNextCounterId(...)  — même calcul, lecture seule, sans migration
```

## 2. API du module `id-counter.util.ts`

```ts
/** Dossier des pierres tombales, relatif à la racine du repo. */
export const TOMBSTONES_DIR = '.polenta/tombstones'

/** Inchangé (signature) : attribue le prochain ID de `prefix` dans `repoPath`. */
export function nextCounterId(git: GitService, repoPath: string, prefix: string, dir: string): Promise<string>

/** Inchangé (signature) : numéro que `nextCounterId` attribuerait maintenant, sans rien écrire. */
export function peekNextCounterId(git: GitService, repoPath: string, prefix: string, dir: string): Promise<number>

/** Nouveau : pose la pierre tombale de `id` puis supprime `relPath`. */
export function deleteWithTombstone(git: GitService, repoPath: string, relPath: string, id: string): Promise<void>

export function formatCounterId(prefix: string, num: number): string   // inchangé
```

### 2.1 Calcul

```
next(P) = max( maxNum(listFiles(repo, dir),            /^P-(\d+)\.yaml$/ sur le basename),
               maxNum(listFiles(repo, TOMBSTONES_DIR), /^P-(\d+)$/),
               counters.yaml[P] si le fichier existe encore (peek uniquement, cf. §2.3),
               issued(repo, P) ) + 1
```

`issued(repo, P)` : **plus haut numéro attribué pendant la session** pour ce couple,
conservé en mémoire (`Map<string, number>`, clé `${path.resolve(repo)}\0${P}`), mis à
jour à chaque attribution.

### 2.2 Pourquoi une mémoire de session (décision)

Sans `counters.yaml`, rien ne réserve un ID entre son attribution et l'écriture du
fichier de l'objet par l'appelant (qui fait parfois des lectures longues entre les deux :
`CampaignsService.create` calcule snapshots et aperçus). Deux `create()` rapprochés
obtiendraient le même ID. La mémoire `issued` joue le rôle de réservation.

Alternative rejetée : `withNextId(..., write: (id) => Promise<T>)` qui garde la file
verrouillée jusqu'à l'écriture de l'objet. Plus stricte (aucun trou), mais elle impose
de restructurer les six `create()` et les deux `setScope()`, et verrouille le repo
pendant des opérations longues.

Conséquences assumées de la mémoire :
- un trou dans la séquence si l'objet n'est finalement pas écrit (erreur), ou après un
  changement de branche dans la session (le max mémorisé dépasse le disque de la
  nouvelle branche). Les trous sont admis (SPEC-REQ §6.1) et ne sont jamais des
  collisions ;
- la mémoire est propre au process : desktop et serveur MCP ouverts en même temps sur le
  même repo peuvent se croiser. C'était déjà le cas avec `counters.yaml`
  (lecture-écriture non atomique entre process) ; le garde-fou `fileExists` de
  `RequirementsService`/`TestsService.create` est conservé, et ajouté aux autres
  `create()` (§3).

### 2.3 Migration (`migrateCountersIfPresent`, privée)

Appelée dans la section sérialisée de `nextCounterId`, avant le calcul :

1. Lire `config/counters.yaml` ; absent → rien à faire.
2. Pour chaque clé `K` à valeur numérique entière `v > 0` (les clés `nextId`,
   `prefixes` et toute valeur non numérique sont ignorées) : si aucun fichier
   `K-<formatCounterId>.yaml` n'existe dans `requirements/`, `tests/`, `campaigns/`,
   `reviews/`, `dashboards/`, `queries/` du repo, créer `TOMBSTONES_DIR/<K-v formaté>`
   (si déjà présente : rien).
3. Supprimer `config/counters.yaml`.

Idempotente : une interruption entre 2 et 3 laisse des pierres tombales déjà posées, que
l'étape 2 ne recrée pas à la relance.

Recherche de `K-v.yaml` : via `listFiles` (récursif) sur les six dossiers, comparaison
des basenames — pas de chemin supposé, les exigences pouvant être rangées en
sous-dossiers.

Cas connu : le `counters.yaml` d'un repo produit peut contenir la clé d'un prefix de
composant (IDs attribués côté produit avant GH20, cf. §3.1). Le fichier correspondant
vit dans le composant, donc la migration pose une pierre tombale superflue dans le
produit. Elle est inoffensive : seule l'attribution la lit, et le produit n'attribue ce
prefix que si le composant est introuvable (repli mono-repo), auquel cas elle évite une
collision.

`peekNextCounterId` ne migre pas : il lit `counters.yaml[P]` s'il est présent et
l'inclut dans le max (valeur = dernier numéro attribué), pour prévoir le même ID que
l'attribution réelle qui suivra la migration.

### 2.4 Pierre tombale

`deleteWithTombstone` : `fsP.mkdir(TOMBSTONES_DIR, { recursive: true })`, écriture d'un
fichier vide `TOMBSTONES_DIR/<id>`, puis `git.deleteFile(repo, relPath)`. Pas de
sérialisation nécessaire (création de fichier idempotente). Passe par une méthode
`GitService.writeText(repoPath, filePath, content)` ajoutée à côté de `writeYaml`
(même création de dossier parent), pour ne pas écrire du YAML `''`/`null`.

## 3. Fichiers modifiés

| Fichier | Modification |
|---|---|
| `main/services/id-counter.util.ts` | réécriture : calcul §2.1, mémoire `issued`, migration §2.3, `deleteWithTombstone`, `TOMBSTONES_DIR` ; plus aucune écriture de `counters.yaml` |
| `main/services/git.service.ts` | suppression de `nextCounterId` ; ajout de `writeText` |
| `main/services/reviews.service.ts` | `nextReviewId` et `CountersConfig` supprimés → `nextCounterId(git, repo, 'REVIEW', 'reviews')` |
| `main/services/dashboards.service.ts` | `git.nextCounterId(repo,'DASHBOARD','DASHBOARD')` → `nextCounterId(git, repo, 'DASHBOARD', 'dashboards')` (create, setScope) ; `deleteFile` partagé → `deleteWithTombstone` (delete, setScope → privé) |
| `main/services/saved-queries.service.ts` | idem avec `'QUERY'`, `'queries'` |
| `main/services/campaigns.service.ts` | `delete` → `deleteWithTombstone` |
| `main/services/requirements.service.ts` | `nextId` attribue dans **`targetRepo`** (§3.1) |
| `main/services/tests.service.ts` | `nextTestId` attribue dans **`targetRepo`** (§3.1) |
| `mcp-server/tools/bulk-import.tools.ts` | l'aperçu `dryRun` résout le repo cible par prefix (§3.1) |
| `CLAUDE.md` | arborescence : `.polenta/tombstones/` ; règle « ne jamais supprimer une pierre tombale » |
| specs `SPEC-*` | cf. `## Refs SPEC` de `GH20.md` (dernier sprint) |

Garde-fou `fileExists` avant écriture : déjà présent dans `RequirementsService` et
`TestsService` ; ajouté dans `CampaignsService.create`, `ReviewsService.create`,
`DashboardsService.create/setScope` et `SavedQueriesService.create/setScope` (branche
partagée), avec le même message `… already exists`.

### 3.1 Correctif associé : attribuer dans le repo qui reçoit le fichier

Aujourd'hui `RequirementsService.create` calcule l'ID dans `repoPath` (repo produit) et
écrit le fichier dans `targetRepo` (repo du composant, via `resolveComponentRepoPath`).
Cela ne fonctionnait que grâce à `counters.yaml` du produit. Par parsing, le produit ne
verrait jamais les fichiers du composant et réattribuerait toujours le même ID.

→ `nextId(repoPath, targetRepo, objectTypeRef)` : le schéma (pour résoudre le prefix)
reste lu dans `repoPath`, l'attribution se fait dans `targetRepo`. Idem pour
`TestsService.nextTestId`. Les campagnes, revues, dashboards et requêtes sont toujours
écrits dans `repoPath` : inchangés.

Bulk import (`makeSchemaBackedIdPreview`) : pour chaque prefix, le repo cible est
obtenu par `container.schema.resolveComponentRepoPath(repoPath, objectTypeRef,
workspaceDir) ?? repoPath` (à partir du premier `objectTypeRef` de l'entrée portant ce
prefix), puis `peekNextCounterId` sur ce repo. Nouveau paramètre `resolveRepo` passé
par l'appelant du tool.

## 4. Découpage

**Un seul sprint** : le module est petit, les huit appelants ne changent que d'une ou
deux lignes, et la migration n'est cohérente que si toutes les attributions passent par
le nouveau module en même temps (sinon un appelant restant réécrirait `counters.yaml`
après migration).

Ordre d'implémentation conseillé : `git.service` (`writeText`) → `id-counter.util` →
services → bulk import → docs → vérifications (`GH20-tests.md`).

## 5. Vérification

Pas de framework de test dans le repo. Comme pour GH16, un script `tsx` jetable
(scratchpad, non commité) exécute les scénarios de `GH20-tests.md` sur des repos
temporaires en appelant directement les services et `id-counter.util`, plus
`pnpm typecheck` et `pnpm lint`. Les scénarios UI sont vérifiés à la main.
