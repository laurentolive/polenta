# GH178 — Sprint 1 : socle et Rendu des exigences / tests

Spec : `specs/GH178.md` · Design : `specs/GH178-design.md` §6 « Sprint 1 » · Tests : `specs/GH178-tests.md`.

## Fichiers modifiés

**Main / API**
- `apps/desktop/src/main/services/read-file-at.util.ts` (nouveau) : `readFileAt(repoPath, ref, filepath)`
  (ref git ou working tree, chemin normalisé, garde hors repo) et `resolveCommitSha`.
- `apps/desktop/src/main/services/sync.service.ts` : `diff`, `commitDiff`, `diffFileBetween` renvoient
  `FileDiffContents` (`oldRef`, `newRef`, `oldMissing`, `newMissing` en plus des contenus).
- `apps/desktop/src/main/services/schema.service.ts` : `getAt(repoPath, ref)` (cache par commit,
  borné à 50 entrées).
- `apps/desktop/src/main/ipc/index.ts` : `schema:get-at` ; `drawio:read` / `image:read` acceptent
  un 3ᵉ argument `ref`.
- `apps/desktop/src/web-server/channel-policy.ts` : `schema:get-at` exposé au client web.
- `packages/api-client/src/{types,ipc-client,index}.ts` : `FileDiffContents`, `schema.getAt`,
  `ref` optionnel de `drawio.read` / `image.read`.

**Renderer**
- `lib/lineDiff.ts`, `components/diff/LineDiffView.tsx` : diff Raw extrait des deux routes
  (inchangé).
- `lib/diffPrefs.ts` : mode (`polenta:diffViewMode`, Rendu par défaut) et « Masquer les
  inchangés » (`polenta:diffHideUnchanged`).
- `lib/objectUnits.ts` : unités, ordre, exclusions (`id`, `projectId`, `branchId`,
  `objectTypeRef`, `history`), libellés.
- `hooks/useSchemaAt.ts` : schéma à une ref.
- `components/diff/FileDiffView.tsx` : sous-en-tête (chemin, bascule, case, `+n / −n`), choix du
  type (schéma Après → Avant → courant), « Rendu indisponible ».
- `components/diff/ObjectDiffView.tsx` : grille Avant | Après, unités marquées (`data-changed`),
  repli des inchangés, fichier absent.
- `components/diff/DiffValue.tsx` : rendu d'une valeur (titre, statut, richtext, champ, étapes,
  brut).
- `lib/staticRichText.tsx`, `lib/staticDrawio.ts` : prop / argument `at` (images et diagrammes
  lus à la version de la colonne).
- `routes/version-diff.tsx`, `routes/diff.tsx` : branchés sur `FileDiffView`.
- `i18n/locales/{fr,en}.json` : clés `diffView.*`.

**Tests**
- `main/services/read-file-at.gh178.test.ts` : `readFileAt`, refs et absences des trois diffs
  (commit initial compris), `SchemaService.getAt`.
- `renderer/lib/objectUnits.test.ts` : ordre et exclusions des unités, `unitChanged`, libellés.
- `e2e-web/gh178-diff-rendered.spec.ts` : G1, G2/G3, G6, G7, L1, L2, L8, L15.

## Comportement implémenté

- Bascule Raw / Rendu sur `/version-diff`, `/diff` (working tree) et `/diff?commitSha` pour une
  exigence ou un test dont le type se résout. Pas de bascule pour les autres fichiers.
- Rendu : deux colonnes alignées dans un seul conteneur défilant. Les unités modifiées ont un fond
  rouge (Avant) et vert (Après). Statut et valeurs d'enum sont affichés par leur libellé, et
  `history` n'apparaît pas.
- Fichier ajouté / supprimé : « Fichier absent de cette version » dans la colonne concernée.
- YAML illisible d'un côté : « Rendu indisponible pour ce contenu — voir Raw ».
- Images et diagrammes des richtext lus à la version de leur colonne (`at`).
- Mode et case mémorisés par poste.

## Divergences par rapport au design

- **Libellés de la colonne Avant** : ils sont résolus d'abord dans le schéma Avant, puis dans le
  schéma Après. L'ordre et la liste des unités restent ceux du schéma Après. Ajouté à la suite de la
  revue de code : un statut renommé entre deux versions s'affichait sinon par son nom technique.
- **Étapes de test** : en attendant `StepsDiff` (sprint 2), elles s'affichent dans un tableau en
  lecture seule (`StaticRichTextViewer` par cellule) plutôt qu'avec `StepsTable`.
- **Unités absentes des deux côtés** (champ du schéma jamais renseigné) : pas de rangée.

## Revue de code (`/code-review`)

Corrigés :
- un `multi_enum` stocké en liste YAML passe par ses libellés ;
- l'état déplié est réinitialisé à chaque changement de fichier ou de refs (`key`) ;
- les chemins `./x`, `a/../b` et `\` sont normalisés pour une lecture à une ref ;
- un SHA en majuscules est mis en minuscules ;
- le garde « hors repo » est précis (`..assets/` accepté) ;
- le cache `getAt` est borné ;
- la JSDoc de `conflictFiles` est remise en place ;
- libellés Avant (ci-dessus).

Écartés :
- **`FileDiffContents` déclaré dans main et dans api-client** : c'est la convention existante
  (`SyncFileStatus` aussi).
- **Lecture d'une ref arbitraire depuis le client web** : `sync:diff-file-between` et
  `sync:commit-diff` le permettent déjà, donc pas d'exposition nouvelle.

## Tests automatiques

- `pnpm typecheck` : OK.
- `pnpm test` : OK (desktop 71 fichiers / 793 tests, merge-core 38).
- e2e `gh178-diff-rendered.spec.ts` : 7/7.
- Suite e2e complète : 157 passés, 2 échecs **hors ticket** :
  - `gh126-split-column` T38/T39 : instable, passe seul ;
  - `gh136-status-label` GH136-1 : échoue aussi sur `main`. Le test attend 2 options dans le select
    de statut, mais GH165 (#166) a ajouté une option vide.

## Mises à jour SPEC

Aucune à ce sprint (mises à jour prévues au sprint final, sprint 2).

## Tester manuellement (desktop)

1. Modifier le titre et le statut d'une exigence, commiter, puis modifier encore le titre sans
   commiter.
2. Panneau Version → section Modifications → clic sur le fichier : Rendu, colonnes
   `Avant · <sha>` / `Après · working tree`, titre marqué.
3. Vue graphe → le commit → le fichier : Avant = parent, titre et statut marqués avec leurs
   libellés.
4. Bascule Raw : diff texte habituel. Fermer, rouvrir : Raw est conservé.
5. « Masquer les inchangés » : les unités inchangées se replient ; un clic les déplie.
6. Ouvrir `links/links.yaml` ou un fichier d'arbre : pas de bascule.
7. Une exigence avec un diagramme draw.io dans un richtext, dont le `.drawio` a changé entre deux
   commits : chaque colonne montre son diagramme. Le cadre de bloc modifié arrive au sprint 2.
