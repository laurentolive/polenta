# T87 — Design technique

## Risque technique principal — vérifié avant de figer ce design

Le mécanisme décrit dans `specs/T87.md` (créer `dev-*` **après coup**, au moment de Publier,
depuis une branche `int-*` déjà éditée) suppose que la création de branche ne touche pas au
répertoire de travail — sinon les modifications non commitées faites pendant que l'utilisateur
était sur `int-*` seraient écrasées au moment même où on tente de les publier.

`SyncService.createBranch` actuel :

```ts
async createBranch(repoPath: string, name: string): Promise<void> {
  await git.branch({ fs, dir: repoPath, ref: name, checkout: true })
}
```

`git.branch({ checkout: true })` d'isomorphic-git délègue en interne à son `checkout()`, qui **par
défaut réécrit les fichiers du répertoire de travail** à partir de l'arbre de la cible — sans la
protection de git natif qui laisse intact un fichier dont le contenu de l'arbre cible est
identique à celui d'avant. Créer `dev-*` à la position courante (donc avec exactement le même
arbre que `int-*`) puis checkout risque donc de réécrire par-dessus les fichiers modifiés en
mémoire/disque, perdant le travail au moment précis où l'utilisateur clique "Publier" — inacceptable.

isomorphic-git expose `checkout({ noCheckout: true })` : *"If true, will update HEAD but won't
update the working directory."* (`index.d.ts` ligne 999/1050, isomorphic-git 1.38.4). C'est
exactement l'opération recherchée : déplacer la branche courante sans toucher un seul fichier.

### Correctif retenu

Remplacer l'implémentation de `createBranch` par une création de ref sans checkout matériel :

```ts
async createBranch(repoPath: string, name: string): Promise<void> {
  await git.branch({ fs, dir: repoPath, ref: name, checkout: false })
  await git.checkout({ fs, dir: repoPath, ref: name, noCheckout: true })
}
```

- `git.branch({ checkout: false })` crée le ref `refs/heads/<name>` pointant sur le HEAD courant,
  sans toucher HEAD ni le répertoire de travail.
- `git.checkout({ ref: name, noCheckout: true })` déplace HEAD vers ce nouveau ref, sans écrire un
  seul fichier — le répertoire de travail (donc les modifications non commitées) reste identique
  au bit près.
- Aucun changement de signature IPC (`sync:create-branch` inchangé) — tous les appelants
  (`useBranchCheckout.ts`, `ModificationControl.tsx`) sont impactés sans modification de leur code.
- Corrige un risque latent préexistant (déjà vrai aujourd'hui pour toute création manuelle de
  branche depuis le panneau Version avec des modifications en attente) — T87 le rend simplement
  systématique (chemin nominal de "Publier"), donc ce correctif doit faire partie du même sprint,
  pas être considéré hors scope.

**Alternative rejetée :** ajouter une garde applicative interdisant de créer une branche quand des
modifications sont en attente. Rejetée — contredit directement l'objectif du ticket (créer `dev-*`
justement pendant qu'il y a des modifications en attente est le cas nominal de "Publier").

## Fichiers à modifier

### `apps/desktop/src/main/services/sync.service.ts`
`createBranch` réimplémenté comme ci-dessus (branch + checkout `noCheckout: true` au lieu de
`branch({ checkout: true })`). Aucun autre changement dans ce fichier.

### `apps/desktop/src/renderer/contexts/VersioningContext.tsx`
```diff
- const isReadonly = branch === '' || branch.startsWith('int-')
+ const isReadonly = branch === ''
```
`isReadonly` ne représente plus que le detached HEAD. Renommage éventuel du champ non fait ici
(`isReadonly` reste un nom correct : "en lecture seule" ⇔ "pas sur une branche") — pas de rename
pour limiter le diff sur tous ses consommateurs (`SystemViewContext`, `VersionPanel`,
`useModificationMode` via son commentaire).

### `apps/desktop/src/renderer/contexts/SystemViewContext.tsx`
Aucun changement de code : `readOnly = (effectiveNode?.readonly ?? false) || isBranchReadonly ||
isRepoReadonly` continue de fonctionner tel quel — `isBranchReadonly` (via `useVersioning`) et
`isRepoReadonly` (déjà scopé au detached HEAD d'un composant, ligne 389) reflètent désormais tous
les deux uniquement le detached HEAD. `effectiveNode?.readonly` reste dans la formule : c'est un
champ de schéma (`SystemNode.readonly`) systématiquement initialisé à `false`
(`schema.service.ts:12`) et sans aucune UI pour le passer à `true` — mort en pratique, aucun risque
à le laisser, son retrait n'apporte rien et sort du scope de ce ticket (déjà noté hors-scope dans
`T87.md`).
Seul un commentaire (lignes 380-382, obsolète — mentionne un cas "read-only" qui n'existe plus
sous cette forme) est mis à jour pour refléter que la seule condition restante est le detached
HEAD.

### `apps/desktop/src/renderer/hooks/useModificationMode.ts`
Remplace `'view' | 'edit' | 'other'` par un modèle à 3 états qui porte directement la logique de
routage décrite dans `T87.md` (table "Ce qui change dans Publier") :

```diff
- export type ModificationMode = 'view' | 'edit' | 'other'
+ export type ModificationMode = 'active' | 'blocked' | 'other'
```

```diff
- let mode: ModificationMode = 'other'
- if (repoPath && branch && integrationBranch !== undefined) {
-   if (branch === integrationBranch && branch.startsWith('int-')) mode = 'view'
-   else if (branch.startsWith('dev-')) mode = 'edit'
- }
+ let mode: ModificationMode = 'other'
+ if (repoPath && branch && integrationBranch !== undefined) {
+   mode = branch.startsWith('int-') && branch !== integrationBranch ? 'blocked' : 'active'
+ }
```

- `'active'` : `branch === integrationBranch` (cas nominal) **ou** `branch` ne commence pas par
  `int-` (branche `dev-*`/libre — cas avancé). "Publier" actionnable dans les deux cas, la
  différence de comportement (créer `dev-*` ou committer directement) est décidée dans
  `ModificationControl` au moment de publier, pas dans le mode lui-même.
- `'blocked'` : `branch` commence par `int-` mais diffère de `integrationBranch` — nouveau,
  remplace ce qui aurait été un `'other'` (composant cité) par un état visible-mais-non-actionnable
  (cf. section `ModificationControl` ci-dessous — le composant reste affiché pour expliquer
  pourquoi, au lieu de disparaître silencieusement).
- `'other'` : `repoPath`/`branch` non résolus, ou detached HEAD (`branch === ''`) — composant
  masqué, comme aujourd'hui.

Portée de "Publier" élargie à **toute** branche non-`int-*` (pas seulement `dev-*`, contrairement à
avant où seul `dev-*` déclenchait le mode `'edit'`) : une branche à nom libre créée manuellement
depuis le panneau Version (§2.3 SPEC-FORKS-BRANCHES-BASELINES.md — le backend n'impose aucune
contrainte de préfixe) devient elle aussi publiable, cohérent avec la description utilisateur de
l'usage avancé ("créer sa propre branche ... publier depuis n'importe quelle branche").

Le hook garde son test `integrationBranch !== undefined` (attend la résolution avant de sortir de
`'other'`, comme aujourd'hui) — nécessaire pour connaître la cible du merge et pour la comparaison
`branch !== integrationBranch` du cas `'blocked'`.

### `apps/desktop/src/renderer/components/layout/ModificationControl.tsx`
Réécriture ciblée — un seul état actionnable (`'active'`) + un état informatif non actionnable
(`'blocked'`) au lieu de `'view'`/`'edit'` :

- **Supprimé** : bloc `mode === 'view'` (badge "Lecture" + bouton "Faire une modification" + sa
  popup), bloc `mode === 'edit'` badge "Édition", bouton "Annuler" + `confirmCancel` + sa popup +
  `cancelMutation`.
- **Nouveau** : bloc `mode === 'blocked'` — message informatif non actionnable (ex. "Cette branche
  (`int-x`) n'est pas la branche d'intégration configurée de ce repo (`int-v1`) — publication
  impossible depuis ici"), pas de bouton. L'édition reste possible (n'est pas gérée par ce
  composant, cf. `SystemViewContext`/`VersioningContext`).
- **`createMutation`** (création `dev-<slug>`, logique de slug/anti-collision inchangée) n'est plus
  déclenchée par un bouton séparé — elle devient une étape conditionnelle de la mutation composite
  `publishMutation`.
- **`publishMutation` (nouvelle séquence)**, déclenchée par la validation de la popup titre
  (affichée dès que `mode === 'active' && pendingChangesCount > 0` et qu'on clique "Publier") :
  1. **Résolution du mode de publication** (calculée à partir de `branch`/`integrationBranch` déjà
     disponibles, pas un nouveau champ du hook) :
     - `branch === integrationBranch` → **mode nominal** : créer `dev-<slug>` (résolution de
       collision identique à l'actuel `createMutation`), l'utiliser comme branche de travail.
     - `branch !== integrationBranch` (donc forcément hors `int-*`, `mode === 'blocked'` couvrant
       déjà l'autre cas) → **mode avancé** : utiliser `branch` telle quelle comme branche de
       travail, aucune branche supplémentaire créée.
  2. `sync:stage-all` puis `sync:commit` (message = titre saisi, fallback `Modification sur
     ${branch}` — inchangé) sur la branche de travail résolue à l'étape 1.
  3. `sync:merge-into` la branche de travail vers `integrationBranch`.
  4. Succès :
     - Mode nominal → `sync:checkout-branch` vers `integrationBranch` + `sync:delete-branch` de
       `dev-<slug>` (elle a été créée par ce flux, elle lui appartient).
     - Mode avancé → **aucun checkout, aucune suppression** — le repo reste sur `branch`. Décision
       explicite de l'utilisateur (feedback direct) : une branche créée par l'utilisateur reste sous
       sa responsabilité, ce flux ne la supprime jamais.
     - Dans les deux cas ensuite : `sync:push-branch(repoPath, integrationBranch)` (nouvel appel —
       IPC déjà exposé, utilisé aujourd'hui par `graph.tsx` pour un usage différent). Échec de push
       → `publishError`-like non bloquant distinct (ne pas réutiliser le même état que l'échec de
       merge, le merge a réussi) affichant l'erreur brute, pas de retry automatique. Puis
       propagation de pin (T82, logique `propagatePinToDependents` inchangée, sur `integrationBranch`
       comme SHA cible) + reset `title`.
  5. Échec du merge (conflit) → comportement inchangé : reste sur la branche de travail,
     `publishError` avec liste des fichiers, lien vers `/version-diff` — **pas de tentative de
     push**.
- **Popup titre** : devient la seule popup du composant. Affichée au clic sur "Publier" (au lieu
  d'être liée à "Faire une modification"). Mêmes champs/comportement (Enter valide, Escape annule).
- **Badge d'état** : supprimé entièrement, comme validé. `ModificationControl` n'affiche plus que
  le bouton "Publier" (désactivé si `pendingChangesCount === 0`, absent en mode `'blocked'` au
  profit du message informatif) + les popups titre / erreur de merge / erreur de push /
  avertissement de propagation de pin.

### `apps/desktop/src/renderer/components/sidebar/VersionPanel.tsx`
Aucun changement de logique (`isReadonly` continue de piloter l'icône `Lock`). Seul le `title`
de l'icône (`"Lecture seule"`, ligne 42) est reformulé pour ne plus laisser croire qu'une branche
`int-*` déclenche ce badge — proposition : `"État figé — aucune branche extraite"`.

## Nouvelles interfaces / types

Aucun nouveau type. `ModificationMode` passe de 3 à 2 valeurs (breaking pour tout code externe qui
matcherait `'view'`/`'edit'` — recherche effectuée, aucun autre consommateur que
`ModificationControl.tsx`).

## Découpage en sprints

Tient dans un seul sprint : le périmètre est cohérent (un hook, un composant, un contexte, un
service backend) et les fichiers touchés sont peu nombreux et déjà bien identifiés. Pas de
découpage proposé.

## Refs SPEC consultées pour ce design

- `SPEC-FORKS-BRANCHES-BASELINES.md` §2.1–2.3 (à réécrire en sprint final)
- `SPEC-TECH-stack.md` §4 (mapping git/cycle de vie — `integrationBranch`, `dev-*`, `Publier`)
