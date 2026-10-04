# GH37 — Design technique : résolution des conflits de merge dans l'outil

Spec : `specs/GH37.md` — Tests : `specs/GH37-tests.md`

## 1. Constats sur l'existant

| Constat | Conséquence pour le design |
|---|---|
| `SyncService.merge`/`mergeInto` appellent `git.merge` (isomorphic-git 1.38) avec `abortOnConflict: true` (défaut) : sur conflit, **ni le working directory ni l'index ne sont touchés** ; `MergeConflictError.data` porte `filepaths`, `bothModified`, `deleteByUs`, `deleteByTheirs`. | La résolution se fait **sur les objets git** (blobs/arbres), jamais dans le WD. Rien à « nettoyer » en cas d'abandon. |
| `mergeTree` d'isomorphic-git n'expose ni le contenu fusionné partiel ni de point d'extension pour les conflits supprimé/modifié (`mergeDriver` n'est appelé que pour deux blobs). Les ajouts des deux côtés passent par `mergeBlobs` avec une base vide. | On **ne réutilise pas** `git.merge` pour finaliser : on reconstruit nous-mêmes l'arbre résultat (walk 3 arbres → `writeBlob`/`writeTree` → `commit` à deux parents). C'est aussi ce qui permet d'appliquer la renumérotation « Garder les deux » à des fichiers non conflictuels. |
| isomorphic-git fusionne le texte avec le paquet `diff3` (dépendance transitive). | Même algorithme pour nos hunks texte → résultats cohérents avec la détection de conflit d'isomorphic. `diff3` devient une dépendance directe. |
| `SyncService.pull` : `git pull --no-rebase` en CLI pour un remote SSH (**écrit des marqueurs** dans le WD sur conflit), `git.pull` sinon (lève `MergeConflictError`, non géré, remonte comme erreur). | `pull` est réécrit : `fetch` + merge local ← `refs/remotes/origin/<branche>` via isomorphic (`abortOnConflict`) + checkout ; renvoie un `MergeResult`. |
| `publishRepo` (`renderer/lib/publishWorkspace.ts`) : le merge en conflit laisse le repo sur `dev-<slug>` ; relancer « Publier » refait un commit (vide) sur `dev-*` puis `mergeInto`. | Après finalisation, on **termine** la publication de ce repo sans repasser par `publishRepo` (sinon commit vide + second merge commit), puis on relance `publishWorkspace` pour les repos restants (ce repo n'a plus de travail → ignoré). |
| `ephemeralBranch` vit dans le state local de chaque `ModificationControl` (un par `ViewHeader`). | Le contexte Publier (branche de travail, intégration, titre) est porté par la **session de résolution** (main), pas par le composant. |
| Pas d'éditeur de code dans le renderer (textarea partout). Pas de framework de tests unitaires dans `apps/desktop`. | Ajout de **CodeMirror 6** pour les panneaux Raw ; la logique de merge pure vit dans un nouveau package `packages/merge-core` testé avec **vitest**. |
| Références d'ID d'objet hors du fichier de l'objet : `links/links.yaml` (`sourceId`/`targetId`), `.polenta/trees/**` (`objectId`), `campaigns/*.yaml` (`testCaseIds`, `runs[].testCaseId`, `requirementId`, `entryId`), `test-runs/<TEST-ID>/*.yaml` (chemin + `testCaseId`, `requirementId`), reviews (`objectId`), mentions texte dans les champs. | Renumérotation = réécriture **textuelle à mot entier** de l'ID dans tous les fichiers du côté gauche + renommage des chemins (§5). |

## 2. Architecture

```
renderer                                    main                               packages/merge-core (pur, partagé)
────────                                    ────                               ──────────────────────────────────
ModificationControl / graph / VersionRepo   MergeResolutionService             classify / mergeObject / mergeKeyed
  └─ « Résoudre les conflits »                ├ open(ctx) → session              mergeText (diff3) / markers
       openTab('/merge-resolve?id=…')         ├ getFile(id, path)                renumberText / nextFreeId
routes/merge-resolve.tsx                      ├ validate(id, path, text)         renderOutput / parseOutput
  ├ ConflictFileList                          ├ saveDraft / renumber             ↑ importé par main ET renderer
  ├ MergeToolbar                              ├ finalize(id, outputs)
  ├ MergePanels (2 ou 3 + sortie)             └ abandon(id)
  │   ├ RawPane (CodeMirror)                SyncService.pull (réécrit), merge/mergeInto (inchangés)
  │   └ RenderedPane (lecture / formulaire)  drafts : userData/merge-drafts/<id>.json
  └ useMergeSession (react-query + IPC)
```

### 2.1 Package `packages/merge-core` (nouveau)

Package source-TS comme `@polenta/zod-schemas` (`main: ./src/index.ts`), dépendances `js-yaml`,
`diff3` ; devDependency `vitest`, script `test` (pris par `turbo test`). Aucune dépendance Node
(utilisable dans le renderer).

```ts
// types.ts
export type Side = 'left' | 'right'
export type FileKind = 'object' | 'links' | 'parameters' | 'text' | 'binary'
export type ConflictKind = 'both-modified' | 'both-added' | 'deleted-left' | 'deleted-right'

/** Un bloc de conflit (champ, lien, paramètre ou hunk). */
export interface MergeBlock {
  key: string                 // 'title' | 'fields.statement' | 'link:<id>' | 'param:<nom>' | 'hunk:<n>'
  base?: string               // fragment YAML/texte, absent si inexistant côté base
  left?: string               // absent = supprimé à gauche
  right?: string
}

/** Résultat d'un merge 3-voies d'un fichier, avant toute action utilisateur. */
export interface FileMerge {
  kind: FileKind
  /** Texte de sortie initial : parties résolues + régions de marqueurs pour les blocs. */
  output: string
  blocks: MergeBlock[]
  /** Clés reprises automatiquement d'un seul côté (affichage « repris de gauche/droite »). */
  auto: { key: string; from: Side | 'both' }[]
}
```

Fonctions :

- `detectKind(path, base, left, right)` — `binary` si un côté contient un octet nul ;
  `links` pour `links/links.yaml` ; `parameters` pour `parameters/parameters.yaml` ; `object` si
  les deux côtés présents parsent en YAML avec `id` + `objectTypeRef` ; sinon `text`.
- `mergeObject(base, left, right)` — unités = clés racine hors `fields` + `fields.<nom>` ; égalité
  par deep-equal sur les valeurs parsées. Règles : inchangé / un seul côté → repris ; même valeur
  des deux côtés → repris ; `version` → `max(left, right)` (pas un conflit) ;
  `needsRevalidation` → `left || right` ; sinon bloc de conflit. Ordre des clés de sortie = ordre
  de droite, puis clés propres à gauche.
- `mergeKeyed(kind, base, left, right)` — `links` : unité = lien par `id` (union des ajouts,
  conflit si modifié/supprimé de façon divergente), ordre = droite puis ajouts de gauche ;
  `parameters` : unité = clé, sortie triée (règle T171 « clés triées »).
- `mergeText(base, left, right)` — `diff3Merge` ; chaque chunk en conflit = un bloc `hunk:<n>`.
- **Marqueurs** : un bloc non résolu est matérialisé dans la sortie par une région

  ```
  <<<<<<< gauche [fields.statement]
    statement: |
      …fragment de gauche, à l'indentation de sa clé…
  =======
    statement: …fragment de droite…
  >>>>>>> droite [fields.statement]
  ```

  La clé entre crochets identifie le bloc. Un côté absent (suppression) donne une section vide.
- `parseOutput(kind, text)` → `{ value?: unknown; unresolved: string[]; error?: string }` : retire
  les régions de marqueurs (chaque région remplace un fragment complet `clé: valeur` ou un élément
  de liste, donc le reste reste du YAML valide), parse le reste. `unresolved` = clés des régions
  restantes.
- `resolveBlock(kind, text, key, choice: Side)` → texte avec la région `key` remplacée par le
  fragment choisi (ou, si le bloc est déjà résolu et que la sortie parse, valeur remplacée puis
  `renderOutput`).
- `renderOutput(kind, value, unresolved: MergeBlock[], order)` → texte canonique :
  `js-yaml.dump(…, { lineWidth: 120 })` (mêmes options que `GitService.writeYaml`), régions de
  marqueurs réinsérées à la place de leur clé.
- `renumberText(text, oldId, newId)` — remplacement à mot entier (`\b<oldId>\b`, sans toucher
  `<oldId>-<n>`… sauf `entryId` `TEST-0042-2`, géré explicitement) ; `renumberPath(path, …)`.
- `nextFreeId(prefix, paths: string[])` — `max` des `<prefix>-NNNN` (fichiers d'objets et
  pierres tombales) + 1, formaté comme `formatCounterId` (extrait de `id-counter.util.ts` vers
  merge-core et réimporté par lui, pour un seul format).

**Source de vérité de la sortie** : le **texte**. Le mode Rendu travaille sur `parseOutput(text)` :
un champ résolu est édité via le formulaire → `value` modifiée → `renderOutput` régénère le texte
(en conservant les régions encore ouvertes) ; un champ non résolu est affiché comme widget de
conflit. Le mode Raw édite le texte directement ; tant qu'il ne parse pas (hors marqueurs), le mode
Rendu est indisponible (message), le texte n'est jamais réécrit sous les doigts de l'utilisateur.

### 2.2 Main : `MergeResolutionService` (nouveau, `main/services/merge-resolution.service.ts`)

Dépendances : `SyncService` (auteur, checkout, status), `SchemaService` (validation), `app`
(chemin `userData`). Enregistré dans `container.ts`.

```ts
// packages/types/src/merge-resolution.ts (nouveau, exporté par @polenta/types)
export type MergeOrigin =
  | { kind: 'publish'; workBranch: string; integrationBranch: string; title: string }
  | { kind: 'merge'; from: string; into: string }          // graphe : merge (into = branche courante) et mergeInto
  | { kind: 'pull'; branch: string; remoteRef: string }

export interface MergeSessionInfo {
  id: string                       // sha1(repoPath + leftOid + rightOid + baseOid)
  repoPath: string
  origin: MergeOrigin
  leftLabel: string; rightLabel: string
  leftOid: string; rightOid: string; baseOid: string | null
  targetRef: string                // ref mise à jour à la finalisation
  targetSide: Side                 // côté dont targetRef est issue (pull : 'left', sinon 'right')
  renumbers: { oldId: string; newId: string }[]
  files: MergeFileEntry[]
  stale?: boolean                  // brouillon trouvé mais oids différents
}

export interface MergeFileEntry {
  path: string                     // chemin de sortie (après renumérotation éventuelle)
  conflict: ConflictKind | 'renumbered'
  kind: FileKind
  objectId?: string; title?: string
  state: 'todo' | 'merged'
}

export interface MergeFileDetail extends MergeFileEntry {
  base: string | null; left: string | null; right: string | null   // null = absent ; binaire : data URL
  merge: FileMerge                 // calcul initial (merge-core)
  draft?: string                   // sortie en cours (brouillon), si différente du calcul initial
  objectTypeRef?: string
}

export type MergeFileOutput = { path: string } & (
  | { content: string }            // texte final (sans marqueurs)
  | { deleted: true }
  | { take: Side }                 // binaire
)
```

Méthodes (une par canal IPC `merge-resolution:*`) :

| Méthode | Rôle |
|---|---|
| `open(repoPath, leftRef, rightRef, origin)` | Résout les oids, `findMergeBase`, walk des 3 arbres (`git.walk` + `TREE`) : pour chaque chemin modifié des deux côtés différemment, `merge-core` décide si c'est un conflit (diff3/champ) ; ajoute supprimé/modifié et ajouté-des-deux-côtés. Recharge le brouillon s'il existe et si les oids concordent, sinon `stale`. Persiste la session. Retourne `MergeSessionInfo`. |
| `get(id)` | Session courante (rechargée depuis le brouillon après redémarrage). |
| `getFile(id, path)` | `MergeFileDetail` (contenus 3 côtés lus via `git.readBlob`, calcul `merge-core`). |
| `saveFile(id, path, { text?, state })` | Brouillon : sortie en cours et état `merged`/`todo`. Appel débouncé côté renderer (500 ms) et à chaque « Merger ». |
| `validate(id, path, text)` | `parseOutput` + validation : YAML valide ; objet → `id` = nom de fichier, `objectTypeRef` existant (`schema-lookup.util`), `status` parmi les statuts du type, `title` non vide, `fields` objet ; avertissements : champs `required` vides, EARS (réutilise la vérification de `bulk-import-validation.util.ts`). Retourne `{ errors: string[]; warnings: string[] }`. |
| `keepBoth(id, path)` | Cas ajouté-des-deux-côtés d'un objet : `nextFreeId` sur l'union base/gauche/droite (dossier de l'objet + `.polenta/tombstones`), ajoute `{oldId,newId}` à `renumbers`, **recalcule** la session (§5) en conservant les sorties déjà mergées des fichiers non impactés. Retourne la session + la liste des fichiers impactés. |
| `finalize(id, outputs)` | §4. Retourne `{ sha }` ou une erreur typée (`stale`, `dirty-worktree`, `unresolved`, `invalid`). Supprime le brouillon en cas de succès. |
| `abandon(id)` | Supprime le brouillon. Ne touche jamais au repo. |

Brouillons : `userData/merge-drafts/<id>.json` (`{ session, files: { [path]: { text?, state } } }`),
écrits via le même helper atomique que `app-settings.service.ts`. Jamais dans le repo.

### 2.3 Classification et calcul de l'arbre (walk)

Pour chaque chemin, avec `L`, `B`, `R` les oids (ou absents) — avant renumérotation, `L` = côté
gauche brut ; après, `L'` = gauche réécrite (§5) :

| Situation | Résultat |
|---|---|
| `L = R` | `L` |
| `L = B` | `R` (y compris suppression) |
| `R = B` | `L` |
| deux blobs différents (ou ajoutés des deux côtés) | `merge-core` : 0 bloc → blob fusionné écrit ; ≥ 1 bloc → **fichier en conflit** (`both-modified` / `both-added`) |
| supprimé d'un côté, modifié de l'autre | **conflit** `deleted-left` / `deleted-right` |
| arbre vs blob | erreur `MergeNotSupported` (comme aujourd'hui, message explicite) |

Un fichier texte que diff3 fusionne proprement n'est pas listé (comportement git). Un objet dont
les changements portent sur des champs différents mais que diff3 signalerait (lignes voisines) est
**fusionné par champ sans conflit** et n'est pas listé (mieux que git ; le cas d'usage 2 de la spec
est donc couvert par « pas de conflit » plutôt que « 0 bloc »).

## 3. Renderer

### 3.1 Route et onglet

- `routes/merge-resolve.tsx`, search `{ id: string }`, ouverte via `useTabs().openTab(path, { repoPath, projectId })`.
  Titre d'onglet (`useSetTabTitle`) : « Conflits — <repo> ». Onglet marqué dirty
  (`useRegisterTabDirty`) tant qu'un fichier est en cours d'édition non sauvegardée (le brouillon
  étant débouncé, en pratique rarement bloquant).
- Ajout dans la table des routes (`SPEC-ELECTRON-DESKTOP.md` §19.3).

### 3.2 Composants (`renderer/components/merge/`)

| Composant | Rôle |
|---|---|
| `MergeResolvePage` | Charge la session (`useMergeSession`), layout : `ConflictFileList` à gauche, zone principale. |
| `ConflictFileList` | Liste des fichiers : chemin, ID/titre, badge du type de conflit, état ; compteur `N / M` ; sélection. |
| `MergeToolbar` | Raw/Rendu, « Afficher l'ancêtre commun », « Tout prendre à gauche/droite », « Merger », « Finaliser le merge », « Abandonner ». |
| `MergePanels` | Rangée haute 2 ou 3 colonnes (gauche · [ancêtre] · droite), séparateur horizontal redimensionnable, sortie en bas. Défilement synchronisé par clé de bloc. |
| `RawPane` | CodeMirror 6 (`@codemirror/state`, `@codemirror/view`, `@codemirror/lang-yaml`) : lecture seule pour les côtés, éditable pour la sortie ; décorations de ligne pour les blocs (couleur gauche/droite/conflit) ; widgets « ← Prendre gauche / Prendre droite → » au-dessus de chaque région de marqueurs. Thème branché sur les tokens (`SPEC-THEMING`). |
| `RenderedObjectPane` | Rendu d'un objet typé à partir de la valeur parsée et du `ObjectTypeDefinition` : en lecture (`RichTextViewer`, valeurs enum, `StepsTable disabled`) pour les côtés ; en édition pour la sortie (`DynamicField`, `StepsTable`), un bloc non résolu affiché en `ConflictFieldCard` (valeur gauche / droite rendues + boutons). **Pas** de réutilisation d'`EditView` (couplé à la persistance, aux liens, au dirty-state). |
| `DeleteModifyCard`, `KeepBothCard`, `BinaryChoiceCard` | Conflits particuliers (§7 de la spec) : choix Garder/Supprimer ; Garder les deux (affiche l'ID proposé et les fichiers impactés avant confirmation) ; aperçu image + choix de côté. |
| `useMergeSession` | react-query sur `merge-resolution:get/get-file`, mutations `save-file`, `validate` (débouncé 300 ms), `keep-both`, `finalize`, `abandon`. |

La préférence « Afficher l'ancêtre commun » et la hauteur du séparateur : `localStorage`
(`polenta:mergeShowBase`, `polenta:mergeSplit`), lecture/écriture en try/catch, comme
`polenta:excelRowMaxLines`.

### 3.3 Points d'entrée

- **Publier** (`ModificationControl.tsx`) : `PublishConflictError` porte déjà `conflicts` et
  `workBranch` ; le bouton « Résolution manuelle » devient « Résoudre les conflits » →
  `merge-resolution:open(repoPath, workBranch, integrationBranch, { kind: 'publish', workBranch, integrationBranch, title })`
  puis ouverture de l'onglet. Le titre de la publication est donc conservé dans la session.
- **Graphe** (`routes/graph.tsx`) : `mergeMut`/`mergeIntoMut` sur `!result.success` affichent le
  message + un bouton « Résoudre les conflits » (au lieu du seul `setMutationError`).
- **Rafraîchir** (`VersionRepoFolder.tsx`) : `api.sync.pull` renvoie désormais `MergeResult` ;
  sur conflit, message + « Résoudre les conflits ».

### 3.4 Après finalisation

`finalize` (main) ne fait que le commit + la mise à jour de ref (+ checkout si la branche cible
est checkoutée, §4). La suite dépend de l'origine et se fait dans le renderer (elle a besoin de
`workspaceDir`/`flatNodes`/`roots`, déjà disponibles côté renderer) :

- **publish** : nouvelle fonction `completeConflictedPublish(repoPath, session, sha)` dans
  `publishWorkspace.ts` = la fin de `publishRepo` (checkout intégration, suppression de
  `dev-<slug>`) + `propagatePinToDependents` + push best-effort ; puis
  `publishWorkspace({ title: origin.title, ephemeral: null, … })` pour les repos restants. Résultat
  et erreurs affichés par le même composant de notification que `ModificationControl` (extraction
  en `PublishResultNotice` si nécessaire). Un nouveau conflit sur un repo suivant rouvre le flux
  « Résoudre les conflits » sur ce repo.
- **merge** : invalidation `status`/`graph`/`branches`.
- **pull** : invalidation `sync:status`/`sync:graph`.

Puis fermeture de l'onglet et message de confirmation.

## 4. Finalisation (main)

1. Recharger la session ; vérifier que `leftRef`/`rightRef` pointent toujours sur
   `leftOid`/`rightOid` (sinon erreur `stale`, la session est marquée périmée).
2. Si `targetRef` est la branche checkoutée : `status` doit être propre (sinon `dirty-worktree`).
   Cas Publier : la cible (intégration) n'est pas checkoutée (on est sur `dev-*`).
3. Chaque fichier en conflit doit avoir une sortie, sans marqueurs, et `validate` sans erreur
   (sinon `unresolved` / `invalid`).
4. Walk base / gauche' / droite (§2.3) en appliquant les sorties : `writeBlob` pour chaque contenu,
   omission pour `deleted`, oid du côté choisi pour `take`. Pierres tombales : `Garder` un objet
   supprimé d'un côté retire `.polenta/tombstones/<ID>` de l'arbre résultat ; `Supprimer` la garde.
   Arbres reconstruits récursivement avec `writeTree` (dossiers vidés supprimés, sauf racine).
5. `git.commit({ tree, parent: [targetOid, otherOid], ref: targetRef, message, author })` — message
   = celui que le merge automatique aurait produit (`Merge branch '<gauche>' into <droite>` pour
   publish/merge, `Merge remote-tracking branch 'origin/<b>'` pour pull).
6. Si `targetRef` est checkoutée : `git.checkout({ ref, force: true })` pour aligner WD et index
   (sûr : vérifié propre à l'étape 2).
7. Supprimer le brouillon.

Aucune étape n'écrit dans le WD avant l'étape 6 ; un échec avant l'étape 5 laisse le repo intact
(seuls des objets git orphelins ont pu être écrits — sans effet).

## 5. « Garder les deux » (renumérotation)

Un objet ajouté des deux côtés n'existe pas dans la base ; **toute occurrence de son ID côté
gauche désigne donc l'objet de gauche**. La renumérotation est une transformation de l'arbre gauche
avant merge :

- `gauche'` = gauche où, pour chaque `{oldId, newId}` : chaque chemin contenant `oldId` comme
  segment ou nom de fichier (`requirements/SYS-0043.yaml`, `test-runs/TEST-0012/…`) est renommé,
  et chaque blob texte **différent de la base** est passé à `renumberText`. Les blobs identiques à
  la base ne contiennent pas l'ID (il n'existait pas), ils ne sont pas lus.
- La session est recalculée sur (base, gauche', droite) : l'ajout des deux côtés disparaît (deux
  fichiers distincts), `links.yaml`, les arbres, les campagnes fusionnent en général proprement.
- Fichiers impactés = blobs réellement modifiés par la transformation ; ceux qui ne sont pas en
  conflit après recalcul sont ajoutés à la liste avec `conflict: 'renumbered'`, état `todo`, sortie
  pré-remplie (merge sans bloc) — l'utilisateur les revoit et clique « Merger ».
- `nextFreeId` : union des fichiers du dossier de l'objet et des pierres tombales dans base,
  gauche et droite (et des `newId` déjà attribués dans la session).
- `KeepBothCard` affiche, avant confirmation, l'ID attribué et la liste des fichiers impactés
  (calculée par un `keepBoth` en mode aperçu : `dryRun: true`).

## 6. `SyncService.pull` réécrit

```
pull(repoPath) → MergeResult
  fetch(repoPath)                                   // existant (CLI pour SSH, isomorphic sinon)
  branch = currentBranch ; remoteRef = refs/remotes/origin/<branch>
  si pas de remoteRef → { success: true, sha: HEAD }
  git.merge({ ours: branch, theirs: remoteRef, abortOnConflict: true })
    conflit → { success: false, conflicts }         // WD intact, même pour SSH
  git.checkout({ ref: branch })                     // aligne WD (arbre propre : garde T153 côté UI)
```

`MergeResult` étendu (rétrocompatible) : `{ success: false; conflicts: string[]; leftRef; rightRef }`
pour que l'appelant puisse ouvrir la session sans recalculer les refs.

## 7. Fichiers à modifier / créer

| Fichier | Changement | Sprint |
|---|---|---|
| `packages/merge-core/**` (nouveau) | §2.1 + tests vitest | 1 (objet, texte, marqueurs) · 2 (rendu : parse/édition) · 3 (links, parameters, renumérotation, nextFreeId) |
| `packages/types/src/merge-resolution.ts` (nouveau) + `index.ts` | Types de session | 1 |
| `packages/api-client/src/types.ts`, `ipc-client.ts` | `mergeResolution.*`, `MergeResult` étendu, `pull` → `MergeResult` | 1 · 3 (pull) |
| `apps/desktop/src/main/services/merge-resolution.service.ts` (nouveau) | §2.2, §4, §5 | 1 · 3 (keepBoth, supprimé/modifié, binaire) |
| `apps/desktop/src/main/container.ts`, `main/ipc/index.ts` | Câblage `merge-resolution:*` | 1 |
| `apps/desktop/src/main/services/sync.service.ts` | `pull` réécrit, `mergeInto`/`merge` renvoient `leftRef`/`rightRef` | 3 (pull) · 1 (refs) |
| `apps/desktop/src/main/services/id-counter.util.ts` | `formatCounterId` importé de merge-core | 3 |
| `apps/desktop/src/renderer/routes/merge-resolve.tsx` (nouveau) | Route | 1 |
| `apps/desktop/src/renderer/components/merge/**` (nouveau) | §3.2 | 1 (Raw, liste, toolbar, Merger/Finaliser/Abandonner) · 2 (Rendu, ancêtre, séparateur, défilement synchronisé) · 3 (cartes spéciales) |
| `apps/desktop/src/renderer/components/layout/ModificationControl.tsx` | Bouton « Résoudre les conflits » | 1 |
| `apps/desktop/src/renderer/lib/publishWorkspace.ts` | `completeConflictedPublish` | 1 |
| `apps/desktop/src/renderer/routes/graph.tsx` | Entrée graphe | 3 |
| `apps/desktop/src/renderer/components/sidebar/version/VersionRepoFolder.tsx` | Entrée Rafraîchir | 3 |
| `apps/desktop/src/renderer/i18n/{fr,en}/*.json` | Libellés `mergeResolve.*` | 1 · 2 · 3 |
| `apps/desktop/package.json` | `@polenta/merge-core`, `@codemirror/*`, `diff3` | 1 |
| Specs (`SPEC-TECH-stack` §2 et §6, `SPEC-FORKS-BRANCHES-BASELINES` §2.4, `SPEC-ELECTRON-DESKTOP` §19.3/§19.15, `SPEC-INDEX`) | Mise à jour fin de ticket | 3 |

## 8. Décisions et alternatives rejetées

| Décision | Alternatives rejetées |
|---|---|
| Résolution sur objets git, sans toucher au WD | `abortOnConflict: false` (marqueurs + index multi-stage dans le WD) : contraire au critère 2, et un repo laissé « en plein merge » est précisément ce qui bloque l'utilisateur. |
| Arbre résultat reconstruit nous-mêmes | `git.merge` + `mergeDriver` renvoyant les sorties : ne couvre pas supprimé/modifié ni la renumérotation de fichiers non conflictuels. |
| Texte = source de vérité de la sortie, avec marqueurs nommés par clé | Modèle structuré seul (perte du texte saisi en Raw tant qu'il est invalide) ; deux états synchronisés (bugs de divergence). |
| Logique pure dans `packages/merge-core` partagé main/renderer | Tout en main (aller-retour IPC à chaque frappe pour parse/rendu) ; tout en renderer (finalize doit revalider côté main de toute façon). |
| CodeMirror 6 | Monaco (lourd, workers à configurer sous Electron) ; textarea + calque (pas de décorations ni de widgets fiables). `@codemirror/merge` non retenu : sa vue 2 panneaux ne correspond pas à la disposition 2/3 + sortie demandée. |
| Granularité champ pour les objets, renumérotation par réécriture du côté gauche | Résolution champ par champ « décrite pour mémoire » en `SPEC-TECH-stack` §6 reprise ; renumérotation par analyse des clés connues (liste fermée, oublierait les mentions texte et les futurs formats). |
| Fin de publication sans repasser par `publishRepo` | Relancer `publishWorkspace` directement : commit vide + second commit de merge sur l'intégration. |

## 9. Découpage en sprints

**Sprint 1 — Publier débloqué, mode Raw** (livrable autonome : un utilisateur bloqué par un
conflit à la publication peut s'en sortir)
- `merge-core` : `detectKind`, `mergeObject`, `mergeText`, marqueurs (`render/parse/resolveBlock`), tests vitest.
- `MergeResolutionService` : `open`, `get`, `getFile`, `saveFile`, `validate`, `finalize`, `abandon` ;
  conflits `both-modified` / `both-added` (sans « Garder les deux ») ; brouillons persistés.
- UI : route, liste des fichiers, panneaux gauche/droite/sortie **Raw** (CodeMirror), prendre
  gauche/droite par bloc et global, édition libre, « Merger », « Finaliser », « Abandonner ».
- Entrée **Publier** + `completeConflictedPublish` + reprise multi-repos.

**Sprint 2 — Mode Rendu et ancêtre commun**
- Bascule Raw/Rendu sur tous les panneaux ; `RenderedObjectPane` (lecture et formulaire), widgets
  de conflit par champ ; synchronisation texte ↔ formulaire ; indisponibilité du Rendu si YAML invalide.
- « Afficher l'ancêtre commun » (3 colonnes), séparateur redimensionnable, défilement synchronisé,
  préférences `localStorage`.
- Avertissements EARS / `required` dans la validation.

**Sprint 3 — Autres entrées et conflits particuliers**
- Entrées graphe (merge, mergeInto) et Rafraîchir (`pull` réécrit, plus aucun marqueur SSH).
- `links.yaml` par lien, `parameters.yaml` par clé.
- Supprimé/modifié (pierres tombales), binaires, « Garder les deux » (renumérotation, aperçu).
- Détection de brouillon périmé (`stale`).
- Mises à jour SPEC + `SPEC-INDEX`.

## 10. Risques / points à vérifier en sprint

- `git.merge` réussi ne met pas à jour le WD (isomorphic-git) : vérifier le comportement actuel de
  `SyncService.merge` (graphe, branche courante). Si le WD est effectivement désynchronisé après un
  merge réussi, ouvrir une issue séparée (hors périmètre GH37) — la finalisation GH37, elle, fait
  le checkout (§4.6).
- Performance du walk sur un gros repo (milliers d'exigences) : le walk ne lit que les oids ; les
  blobs ne sont lus que pour les chemins modifiés des deux côtés. À mesurer sur le projet démo.
- `merge-core` dans le renderer : vérifier que `diff3` et `js-yaml` se bundlent sans polyfill Node.
