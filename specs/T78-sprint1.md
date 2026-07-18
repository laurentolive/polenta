# T78 — Sprint 1 (dernier sprint)

## Fichiers modifiés

- `apps/desktop/src/renderer/components/sidebar/VersionPanel.tsx` — réécrit : header inchangé
  (titre, Lock readonly, navigation Baselines/Historique/Comparer) + orchestration de l'arbre
  via `useWorkspaceStructure`, rendu d'un `VersionRepoFolder` par nœud racine, message dédié si
  `conflicts` (conflit diamant) est renvoyé par le hook. Bouton "Publier" (placeholder T30-E)
  supprimé.
- `apps/desktop/src/renderer/components/sidebar/version/BranchCombobox.tsx` — **nouveau**,
  extraction à l'identique (aucun changement de logique) de l'ancien `BranchCombobox` interne à
  `VersionPanel.tsx`.
- `apps/desktop/src/renderer/components/sidebar/version/VersionRepoFolder.tsx` — **nouveau**,
  composant récursif : ligne dossier (chevron, icône composant/interface, nom, badge dirty,
  vignette checkout si fermé) + contenu ouvert (Checkout/Stagés/Modifications + modales commit/
  checkout-confirm/discard), toutes les queries et mutations `api.sync.*` scopées par
  `node.repoPath`. Récursif sur `node.children`.

## Comportement implémenté

Conforme à `specs/T78.md` et `specs/T78-design.md` : l'arbre liste tous les repos du workspace
(root + composants + interfaces), tous ouverts par défaut, root mis en évidence
(texte bleu/gras). Chaque dossier fermé affiche sa réf courante et un point ambre si des
modifications sont en attente (stagées ou non), sans avoir besoin d'être ouvert — la requête
`sync:status` de chaque repo tourne en continu tant que le panneau Version est monté (montée/
démontée avec les composants de l'arbre, donc plus de polling résiduel après avoir quitté
l'onglet Version). Ouvrir un dossier affiche Checkout (combobox branches/tags), Stagés et
Modifications scopés uniquement à ce repo ; toutes les actions (stage/unstage/discard/commit/
checkout/créer-supprimer branche) et leurs modales sont indépendantes d'un dossier à l'autre.

## Divergences par rapport au design

Trois ajustements identifiés pendant `/code-review high` (voir commit `ab3b5c8`), tous des
corrections de bugs introduits par l'extraction plutôt que des changements de périmètre :

1. **Garde `enabled: !!repoPath` réintroduite** sur les 3 queries `sync:*` de
   `VersionRepoFolder` — le design ne la mentionnait pas explicitement ; son absence aurait fait
   partir `api.sync.status('')` tant que la query `['workspace', currentProjectId]` (résolution
   du root) n'est pas encore résolue, pour le cas d'un repo simple (non-workspace).
2. **`isRoot` simplifié** : le design proposait `node.repoPath === repoPath` ; ce calcul est
   racial (faux tant que la query `project` n'a pas résolu `repoPath`). `useWorkspaceStructure`
   ne renvoie jamais plus d'un nœud de premier niveau (le root logique, ou un nœud synthétique
   unique en mode repo simple) — `isRoot` est donc simplement `true` pour tout élément de
   `tree.map(...)` au niveau racine, sans dépendre de `repoPath`.
3. **Conflit diamant affiché** : non prévu explicitement dans le design (qui référençait
   `useWorkspaceStructure` sans détailler le champ `conflicts`) — sans ce message, un workspace
   en conflit de dépendances affichait un panneau Version totalement vide, sans indice. Un
   message renvoie désormais vers l'onglet Structure (qui porte déjà la résolution de conflit
   via `DiamondConflictModal`) plutôt que de dupliquer cette UI dans le panneau Version.

Un quatrième point corrige une régression par rapport au comportement **avant** T78 (pas une
divergence du design lui-même) : l'ancien `VersionPanel.tsx` appelait `refetch()` de
`useVersioning()` après un checkout/création/suppression de branche réussi, pour rafraîchir
immédiatement l'icône readonly du header. La première extraction avait perdu cet appel ;
`VersionRepoFolder` le refait désormais, mais seulement quand `isRoot` (checkout sur un
composant n'a pas de raison de invalider l'état du root).

## Mises à jour SPEC

Aucune. `## Refs SPEC` de `T78.md` citait `SPEC-SYSTEM-VIEW.md` §global (référence de style
pour le pattern d'arbre, sans rapport direct avec le panneau Version — vérifié : aucune mention
de `VersionPanel` dans ce fichier, rien à mettre à jour) et
`SPEC-FORKS-BRANCHES-BASELINES.md` §1–2 (déjà noté comme potentiellement obsolète en phase
Spec : décrit un modèle `BranchService`/IPC `branches:create`/workflow PR-avant-merge qui ne
correspond pas à l'implémentation actuelle `api.sync.*` — un écart préexistant, non introduit
ni aggravé par T78, dont la réconciliation dépasse le périmètre de ce ticket). Colonne `MAJ` de
`SPEC-INDEX.md` inchangée.

## Comment tester manuellement

1. Ouvrir un projet Polenta mono-repo (pas de composant) : l'arbre Version doit afficher un
   seul dossier "root", ouvert, en évidence — comportement identique à l'ancien panneau
   (stage/unstage/discard/commit/checkout/créer-supprimer branche).
2. Ouvrir un workspace avec au moins un composant : vérifier que tous les dossiers sont ouverts
   par défaut, que seul le root est mis en évidence.
3. Modifier un fichier dans le repo d'un composant hors de l'app (éditeur externe), attendre
   ~3s : le badge ambre doit apparaître sur son dossier même fermé.
4. Ouvrir ce dossier, stager le fichier, committer : le badge disparaît, la liste se vide.
5. Depuis le dossier ouvert d'un composant, checkout une autre branche via le combobox :
   vérifier que seule la vignette de ce dossier change (root et autres composants inchangés).
6. Ouvrir deux dossiers en parallèle avec des modifications différentes : vérifier qu'agir sur
   l'un (stage, modale de commit) n'affecte pas l'autre.
7. Changer d'onglet sidebar (quitter Version) puis revenir : l'état repart à "tout ouvert, root
   en évidence" (pas de persistance attendue).
8. Vérifier qu'aucun bouton "Publier" n'apparaît plus dans le panneau.
