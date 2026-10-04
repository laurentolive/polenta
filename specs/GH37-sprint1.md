# GH37 — Sprint 1 : Publier débloqué, mode Raw

Spec : `specs/GH37.md` — Design : `specs/GH37-design.md` §9 (sprint 1) — Tests : `specs/GH37-tests.md`

## Comportement implémenté

- **Point d'entrée Publier** : sur conflit, la popup « Publication impossible » propose
  **« Résoudre les conflits »** (remplace « Résolution manuelle (Version) »). Le bouton ouvre la
  session de résolution du repo en échec dans un nouvel onglet « Conflits — <repo> ».
- **Bouton « Reprendre la résolution des conflits »** à côté de « Publier », affiché tant qu'une
  résolution est en cours sur un repo du workspace (brouillon non périmé). C'est le seul chemin de
  retour après un redémarrage de l'app : l'état « branche éphémère » de Publier (T87) ne survit pas
  au redémarrage, et « Publier » reste désactivé sur la branche `dev-*` sans modification.
- **Éditeur** (`/merge-resolve`) :
  - à gauche, la liste des fichiers en conflit (ID/titre, chemin, type de conflit, état) ;
  - en haut, mes modifications | destination, en lecture seule, avec les lignes changées depuis
    l'ancêtre commun surlignées ;
  - en bas, la **sortie** éditable (CodeMirror 6), avec une région de marqueurs nommée par bloc et,
    au-dessus de chaque région, les boutons « ← Prendre gauche / Prendre droite → » ;
  - en-tête de fichier : « Tout prendre à gauche / à droite » et **Merger** ;
  - « Merger » n'est actif que si aucun bloc n'est ouvert et que la validation (main) ne remonte
    aucune erreur. Erreurs vérifiées : YAML, id = nom de fichier, type existant, statut existant
    pour le type, titre non vide, `fields` objet.
- **Fusion par champ** des objets (exigences, tests, campagnes) : seuls les champs modifiés
  différemment des deux côtés font un bloc. `version` prend le max, `needsRevalidation` le OU
  logique. Les autres fichiers sont fusionnés en hunks de lignes (`diff3`, comme isomorphic-git).
  Un fichier dont la fusion par champ ne laisse aucun bloc n'est pas listé.
- **Supprimé d'un côté / modifié de l'autre, et binaires** : choix d'un côté (Garder / Supprimer,
  ou Prendre mes modifications / la destination). Garder un objet supprimé retire sa pierre
  tombale de l'arbre résultat.
- **Finaliser le merge** (main) : vérifie que les deux branches n'ont pas bougé (sinon refus
  `stale`), que le working directory est propre (branche cible checkoutée, et toujours en cas
  Publier), que tout est mergé et valide. Ensuite :
  - reconstruit l'arbre résultat (fichiers non conflictuels repris ou fusionnés, sorties validées) ;
  - crée le commit de merge à deux parents sur la branche cible ;
  - supprime le brouillon.

  Le working directory n'est jamais touché avant le commit.
- **Suite de Publier** (`resumePublishAfterResolution`) :
  - retour sur la branche d'intégration et suppression de la branche éphémère (seulement si elle
    était éphémère) ;
  - propagation du pin, puis publication des repos restants sous le même titre ;
  - raccrochage du repo résolu s'il est resté en HEAD détaché (cas diamant) ;
  - push best-effort.

  Un écran de fin affiche le résultat. Si un repo suivant entre en conflit, il propose
  « Résoudre les conflits » pour ce repo. Si la suite échoue, il propose « Réessayer ».
- **Abandonner** : supprime le brouillon (confirmation si au moins un fichier est mergé), ne
  touche jamais au repo.
- **Brouillons** : `userData/merge-drafts/<id>.json`, avec id = hash(repo, oid gauche,
  oid droite). Rouvrir le même merge retrouve l'avancement (sorties en cours sauvegardées après
  500 ms, immédiatement quand un fichier mergé est modifié).

## Fichiers modifiés / créés

| Fichier | Nature |
|---|---|
| `packages/merge-core/**` | nouveau package : fusion par champ, hunks diff3, marqueurs, parse, diff de lignes, 20 tests vitest |
| `packages/types/src/merge-resolution.ts`, `index.ts` | types de session |
| `packages/api-client/src/types.ts`, `ipc-client.ts` | `mergeResolution.{open,list,get,getFile,saveFile,validate,finalize,abandon}` |
| `apps/desktop/src/main/services/merge-resolution.service.ts` | nouveau service (walk 3 arbres, classification, validation, finalisation, brouillons) |
| `apps/desktop/src/main/container.ts`, `main/ipc/index.ts` | câblage `merge-resolution:*` |
| `apps/desktop/src/renderer/routes/merge-resolve.tsx` | route |
| `apps/desktop/src/renderer/components/merge/*` | `MergeResolvePage`, `FileResolver`, `RawPane` (CodeMirror), `useMergeSession` |
| `apps/desktop/src/renderer/components/layout/ModificationControl.tsx` | « Résoudre les conflits », « Reprendre la résolution » |
| `apps/desktop/src/renderer/lib/publishWorkspace.ts` | `PublishConflictError.ephemeral`, `resumePublishAfterResolution`, `leaveWorkBranch` |
| `apps/desktop/src/renderer/contexts/TabsContext.tsx` | titre d'onglet par défaut de `/merge-resolve` |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | `mergeResolve.*`, `layout.modificationControl.{resolveConflicts,resumeResolution}` (retrait de `manualResolution`) |
| `apps/desktop/electron.vite.config.ts`, `package.json`, `pnpm-lock.yaml` | `@polenta/merge-core` (alias + bundlé dans main), `diff3`, `@codemirror/*` |

## Divergences par rapport au design

1. **Supprimé/modifié et binaires livrés dès le sprint 1** (prévus au sprint 3), en version
   minimale : des boutons de choix, sans aperçu d'image. Sans eux, un tel conflit aurait bloqué la
   finalisation. Restent au sprint 3 : « Garder les deux » (renumérotation) et l'aperçu d'image.
2. **Bouton « Reprendre la résolution des conflits »** (non prévu) : voir plus haut, nécessaire
   pour M44 après un redémarrage. Il utilise un nouveau canal `merge-resolution:list`, qui exclut
   les brouillons dont une branche a bougé.
3. **L'onglet ne se ferme pas tout seul après finalisation** : il affiche un écran de fin (résultat
   de la publication, erreurs de push/pin, « Réessayer », conflit suivant), fermé par
   « Fermer l'onglet ». La spec §9 disait « l'éditeur se ferme et un message confirme » ; il
   fallait un endroit où lire ce message.
4. **Finaliser refuse si le working directory est sale dans le cas Publier** (et pas seulement
   quand la cible est checkoutée) : sinon le retour sur l'intégration échouerait après le commit de
   merge (issu de la revue de code).
5. **`flushSync` autour de `openTab`** dans `ModificationControl` : appelé depuis un callback
   asynchrone, `openTab` réécrivait l'onglet *précédent* vers `/merge-resolve` (la mise à jour de
   location du routeur est rendue avant le changement d'onglet actif). **Défaut latent de
   `TabsContext`** pour tout appel à `openTab` hors événement utilisateur, pas corrigé à la source :
   à traiter dans une issue dédiée si d'autres appelants asynchrones apparaissent.
6. **Chunk renderer `merge-resolve` d'environ 800 kB** (CodeMirror + lezer + js-yaml), chargé à
   la demande (route splittée), donc sans effet sur le démarrage.

## Mises à jour SPEC

Aucune à ce sprint (prévues au sprint 3, dernier sprint).

## Vérifications effectuées

- `tsc --noEmit` (apps/desktop, packages/merge-core) : 0 erreur. Pas de script lint pour `apps/desktop`.
- `vitest` (`packages/merge-core`) : 20/20.
- **Test de bout en bout du service** sur un repo git temporaire (script hors repo), avec 3 conflits :
  - les conflits sont bien détectés (texte, objet par champ, supprimé/modifié), et un fichier
    fusionnable par champ n'est pas listé ;
  - rouvrir le même merge retrouve la session ;
  - après finalisation : commit à 2 parents, contenu attendu, pierre tombale retirée, WD intact,
    `git fsck` propre, brouillon supprimé.
- **Parcours réel dans l'app** (driver Playwright, projet + remote bare + second clone) :
  - Publier → conflit → « Résoudre les conflits » → « Prendre gauche » → Merger → Finaliser :
    merge poussé, repo revenu sur `main`, `dev-*` supprimée, WD propre ;
  - variante avec redémarrage de l'app en cours de résolution → « Reprendre la résolution des
    conflits » → sortie retrouvée → Finaliser : OK.
- `/code-review` (medium) : 4 constats, tous corrigés :
  - suite de Publier non rattrapable après le commit → refus si WD sale + « Réessayer » ;
  - édition après « Merger » perdue si « Finaliser » est cliqué dans les 500 ms → sauvegarde
    immédiate ;
  - repo résolu laissé en HEAD détaché → raccroché ;
  - brouillon périmé proposé par « Reprendre » → exclu de la liste.

## Comment tester manuellement

1. Projet avec un remote (un repo bare local suffit) et deux clones A et B. B modifie le
   `statement` de `SYS-0001`, puis commit + push.
2. Dans l'app sur A, modifier le `statement` de `SYS-0001` autrement (et `priority`), puis
   « Publier ».
3. Popup « Publication impossible » → **Résoudre les conflits**. L'onglet « Conflits — <repo> »
   s'ouvre :
   - `priority` est déjà reprise de gauche ;
   - une région de conflit `[fields.statement]` est présente.
4. Essayer « ← Prendre gauche », « Prendre droite → », puis une édition libre :
   - un marqueur laissé ou un YAML cassé doit désactiver « Merger » ;
   - changer l'`id` doit faire apparaître une erreur.
5. Merger → Finaliser le merge. Vérifier :
   - l'écran de fin ;
   - `git log --graph` (merge à 2 parents) ;
   - le retour sur `main` et la suppression de `dev-*` ;
   - le push ;
   - le contenu du fichier.
6. Reprise : refaire 1–3, prendre un côté sans « Merger », fermer l'app, la relancer, puis
   « Reprendre la résolution des conflits ». L'avancement doit être retrouvé.
7. Abandonner : le repo ne doit pas bouger (`git status`, branches).

Scénarios de `GH37-tests.md` couverts par ce sprint : U1–U13, M1–M16, M18, M43, M44, M46, M47,
M47b, M47c.
