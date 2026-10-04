# GH37 — Sprint 3 : autres entrées, conflits particuliers, SPEC (dernier sprint)

Spec : `specs/GH37.md` — Design : `specs/GH37-design.md` §5, §6, §9 (sprint 3) — Tests : `specs/GH37-tests.md` §5–§7

## Comportement implémenté

- **Graphe** (`/graph`) : un merge (« merger dans la branche courante ») ou un `mergeInto` en
  conflit affiche, sous le message d'erreur du menu, **« Résoudre les conflits »**. Les refs
  arrivent avec le conflit, puisque `MergeResult` porte désormais `leftRef`/`rightRef`. Gauche =
  branche mergée, droite = branche cible ; la finalisation avance la droite, et le working
  directory est réaligné si c'est la branche courante.
- **Rafraîchir** (panneau Version) : `SyncService.pull` est réécrit.
  1. Il vérifie que l'arbre est propre.
  2. `fetch`.
  3. Merge isomorphic-git de `refs/remotes/origin/<branche>` (`abortOnConflict`).
  4. `checkout` pour réaligner le working directory.

  Un conflit **n'écrit plus rien dans le working directory**, remote SSH ou local compris (l'ancien
  `git pull --no-rebase` en CLI y écrivait les marqueurs). Il est renvoyé avec ses refs, et le
  panneau affiche « Conflit avec la branche distante… » + **« Résoudre les conflits »**. Origine
  `pull` : la branche **locale** (gauche) est avancée, avec le message
  `Merge remote-tracking branch 'origin/<b>' into <b>`.
- **Point d'entrée commun** `useOpenMergeResolution` : ouverture de la session, onglet ouvert
  sous `flushSync`, rafraîchissement de la liste « Reprendre ».
- **`links/links.yaml`** : fusion par lien (`id`). Union des ajouts (droite puis gauche) ; un lien
  modifié ou supprimé de façon divergente donne un bloc `link:<id>`.
- **`parameters/parameters.yaml`** : fusion par paramètre, clés triées (T171). Bloc `param:<nom>`.
- **Validation** de ces deux fichiers : forme du fichier, `id` uniques, `type`/`sourceId`/`targetId`
  renseignés.
- **« Garder les deux »** (objet ajouté des deux côtés) :
  - un bandeau au-dessus de la sortie, puis un **aperçu** : ID attribué (prochain libre sur l'union
    des fichiers et pierres tombales des trois versions) et fichiers réécrits ;
  - à la confirmation, le côté gauche est réécrit dans un arbre git synthétique (`leftTreeOid`) et
    la session est recalculée ;
  - les fichiers touchés sans conflit sont listés **« Renuméroté (à relire) »**, sortie pré-remplie ;
  - les brouillons des fichiers non touchés sont conservés, de même que les fichiers renumérotés
    par un « Garder les deux » précédent ;
  - binaires et pins de sous-module : recopiés (binaires renommés si besoin), jamais à relire.
- **Pins de sous-module (gitlinks)** : jamais lus. En conflit, ils se résolvent par choix de côté,
  avec leur type conservé dans l'arbre résultat.
- **Binaires image** : aperçus (data URL) des trois versions dans les panneaux.
- **Brouillons périmés** :
  - une session dont une branche a bougé est signalée par un bandeau, et « Finaliser » est
    désactivé ;
  - **« Recommencer avec l'état actuel »** rouvre le même merge. Pour Publier, l'intégration est
    d'abord fetchée puis avancée en fast-forward (T154) ;
  - l'ancien brouillon est remplacé et la nouvelle session l'indique une fois ;
  - « Reprendre la résolution » liste aussi les sessions périmées, après les sessions à jour.
- **Libellés des refs** en forme courte (`origin/main` plutôt que `refs/remotes/origin/main`) dans
  l'en-tête, les panneaux et les marqueurs.
- **`formatCounterId`** déplacé dans `@polenta/merge-core` (renumérotation) et réexporté par
  `id-counter.util.ts` : un seul format d'ID. Le bundle du serveur MCP se construit.

## Fichiers modifiés / créés

| Fichier | Nature |
|---|---|
| `packages/merge-core/src/keyed.ts` (nouveau) | fusion `links`/`parameters` |
| `packages/merge-core/src/renumber.ts` (nouveau) | `renumberText`/`renumberPath`/`nextFreeId`/`prefixOf`/`formatCounterId`/`shortRef` |
| `packages/merge-core/src/{index,object,types}.ts`, `merge-core.test.ts` | kinds `links`/`parameters`, `mergeFile(…, path)`, 34 tests |
| `packages/types/src/merge-resolution.ts` | origine `pull`, `renumbered`, `leftTreeOid`, `renumbers`, `stale`, `replacedStaleDraft`, `images`, `MergeKeepBothResult` |
| `packages/api-client/src/{types,ipc-client}.ts` | `MergeResult.leftRef/rightRef`, `pull → MergeResult`, `mergeResolution.keepBoth` |
| `apps/desktop/src/main/services/merge-resolution.service.ts` | `keepBoth`/`rewriteLeft`, origine `pull`, brouillons périmés, aperçus, gitlinks, validation links/parameters |
| `apps/desktop/src/main/services/sync.service.ts` | `pull` réécrit, refs dans les conflits de `merge`/`mergeInto` |
| `apps/desktop/src/main/services/id-counter.util.ts` | `formatCounterId` depuis merge-core |
| `apps/desktop/src/main/ipc/index.ts` | `merge-resolution:keep-both` |
| `apps/desktop/src/renderer/components/merge/useOpenMergeResolution.ts` (nouveau) | ouverture commune |
| `apps/desktop/src/renderer/components/merge/{FileResolver,MergeResolvePage}.tsx` | `KeepBothBar`, aperçus image, fichiers renumérotés, bandeaux périmé/remplacé, « Recommencer » |
| `apps/desktop/src/renderer/routes/graph.tsx` | entrée graphe |
| `apps/desktop/src/renderer/components/sidebar/version/VersionRepoFolder.tsx` | entrée Rafraîchir |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | `keepBoth.*`, `staleBanner`, `restart`, `refreshConflict`… |

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `SPEC-TECH-stack.md` §2 | lignes `@polenta/merge-core` + diff3 et CodeMirror 6 |
| `SPEC-TECH-stack.md` §3 | `packages/merge-core` dans l'arborescence |
| `SPEC-TECH-stack.md` §4 | collisions d'ID entre branches → « Garder les deux » |
| `SPEC-TECH-stack.md` §6 | réécrite : détection, §6.1 résolution dans l'outil (origines, service, fusion par unité, sortie, validation, brouillons), §6.2 finalisation, §6.3 suite de Publier, §6.4 « Garder les deux », hors périmètre |
| `SPEC-FORKS-BRANCHES-BASELINES.md` §2 | Rafraîchir : `pull` réécrit ; §2.4 : éditeur de résolution, la vision champ par champ est désormais implémentée |
| `SPEC-ELECTRON-DESKTOP.md` §19.3 | route `/merge-resolve` |
| `SPEC-ELECTRON-DESKTOP.md` §19.15 | « Résoudre » / « Reprendre » dans `ModificationControl`, contrainte `flushSync` sur `openTab` asynchrone |
| `SPEC-INDEX.md` | les 6 lignes correspondantes enrichies, colonne `MAJ` → GH37 |

## Divergences par rapport au design

1. **Brouillons périmés listés par « Reprendre »** (et pas exclus) : c'est ainsi que l'utilisateur
   apprend qu'ils sont périmés et peut « Recommencer ». Sans cela, une résolution Publier
   interrompue puis périmée était introuvable après un redémarrage.
2. **« Recommencer » pour Publier fait d'abord fetch puis fast-forward de l'intégration** (comme
   Publier, T154). Sinon la finalisation créerait un merge sur une intégration en retard sur le
   remote, et le push échouerait.
3. **Pins de sous-module** traités explicitement (choix de côté, recopie). Non prévu au design,
   trouvé en revue de code.
4. **Défaut existant hors périmètre, trouvé pendant ce sprint et signalé dans l'issue #42** : un
   merge **réussi** depuis le graphe dans la branche courante laisse le working directory
   désynchronisé (suppressions stagées). Un commit ultérieur annulerait donc le merge. Il n'est pas
   corrigé ici : seule la finalisation GH37 réaligne le WD.

## Vérifications effectuées

- `tsc --noEmit` (apps/desktop, merge-core) : 0 erreur. `vitest` merge-core : 34/34 (U15–U20 +
  cas complémentaires). Bundle du serveur MCP : OK.
- **Service sur repos git temporaires** (scripts hors repo) :
  - Garder les deux : SYS-0002 = Bob, SYS-0003 = Alice ; L2 → SYS-0003, L3 → SYS-0002 ; l'arbre
    d'affichage est réécrit, les paramètres (union) et l'image (côté choisi) sont corrects, le pin
    de sous-module est conservé, `git fsck` est propre.
  - Rafraîchir en conflit (remote local, chemin CLI) : WD intact, session `pull` (cible = gauche),
    finalisation → commit `Merge remote-tracking branch 'origin/main' into main`, WD réaligné.
  - Brouillon périmé : `stale` détecté, finalisation refusée, réouverture → nouvelle session
    (`replacedStaleDraft`), notice effacée au premier travail.
- **App (driver Playwright, remote bare + second clone)** :
  - Rafraîchir sur un repo divergent → conflit → « Résoudre les conflits » → éditeur
    (`main` | `origin/main`, priorité reprise automatiquement) ;
  - même ID créé des deux côtés → Publier → Résoudre → « Garder les deux… » → aperçu `SYS-0011`
    + fichiers → Renuméroter → fichiers « Renuméroté (à relire) » → Merger ×2 → Finaliser.
    Résultat : publication terminée, `SYS-0010` = Bob, `SYS-0011` = Alice, lien d'Alice →
    `SYS-0011`.
- **`/code-review` (medium)** : 3 constats, corrigés.
  - Un gitlink faisait échouer « Garder les deux » → recopié tel quel.
  - Un second « Garder les deux » perdait les fichiers renumérotés du premier → conservés.
  - `MC-SW-0001` renuméroté avec `SW-0001` → un `-` devant l'ID bloque le remplacement.

## Comment tester manuellement

1. **Graphe** : deux branches modifiant le même champ → menu de la branche → merger → conflit →
   « Résoudre les conflits » → résoudre → Finaliser. La branche courante contient le merge et
   `git status` est propre.
2. **Rafraîchir** : un collègue pousse une modification du même champ, vous committez localement
   → Rafraîchir → aucun marqueur dans les fichiers → « Résoudre les conflits » → Finaliser →
   `git log` montre `Merge remote-tracking branch 'origin/…'`.
3. **Liens / paramètres** : liens et paramètres ajoutés des deux côtés → pas de conflit, union.
   Le même lien modifié des deux côtés → un bloc `link:<id>`.
4. **Même ID** : `SYS-00xx` créé des deux côtés → « Garder les deux… » → aperçu → Renuméroter →
   relire et merger les fichiers renumérotés → Finaliser.
5. **Supprimé / modifié** : un côté supprime une exigence (pierre tombale), l'autre la modifie.
   « Garder » donne un fichier présent sans pierre tombale ; « Supprimer » garde la pierre tombale.
6. **Image** modifiée des deux côtés : aperçus des 3 versions, choix d'un côté.
7. **Périmé** : commencer une résolution Publier, fermer l'app, faire avancer l'intégration (push
   d'un collègue + fetch), relancer → « Reprendre » → bandeau périmé → « Recommencer ».
8. **Non-régression** : Publier sans conflit (mono/multi-repos), auto-pull (fast-forward only),
   `/version-diff` depuis le panneau Version, rebase en conflit (abort inchangé).

Scénarios de `GH37-tests.md` couverts par ce sprint : U15–U20, M30–M42, M45, M48.
