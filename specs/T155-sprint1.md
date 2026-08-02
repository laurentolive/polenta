# T155 — Sprint 1 (final)

## Fichiers modifiés

- `apps/desktop/src/main/services/sync.service.ts` : `pullFastForwardOnly(repoPath, remote?)`
  (nouveau) — `git pull --ff-only` (remote non-http) ou `git.pull({ fastForwardOnly: true })`
  (isomorphic-git), no-op si aucun remote configuré.
- `apps/desktop/src/main/ipc/index.ts` : handler `sync:pull-fast-forward-only`.
- `packages/api-client/src/types.ts` / `ipc-client.ts` : `sync.pullFastForwardOnly`.
- `apps/desktop/src/renderer/hooks/useAutoPull.ts` (nouveau) : hook d'auto-pull périodique
  (5 minutes), ignore les repos avec modifications en attente, appelle `pullFastForwardOnly` par
  repo (jamais `pull` — voir raison dans le fichier), invalide `sync:status` en cas de succès,
  échecs journalisés en silence (`console.warn`).
- `apps/desktop/src/renderer/components/layout/AppLayout.tsx` : appel de `useAutoPull(currentProjectId)`,
  monté une fois au niveau du layout (indépendant du panneau actif).
- `specs/SPEC-FORKS-BRANCHES-BASELINES.md` (nouvelle §2.5), `specs/SPEC-INDEX.md`.

## Comportement implémenté

- Auto-pull tourne toutes les 5 minutes tant qu'un projet est ouvert, quel que soit l'onglet actif.
- Aucun appel au moment de l'ouverture du projet (le premier tick n'arrive qu'après 5 minutes).
- Repo avec modifications en attente → ignoré pour ce tick, aucune erreur visible.
- Repo propre et simplement en retard → mis à jour sur disque sans action de l'utilisateur.
- Repo propre mais divergé (commits locaux non poussés, cas préexistant rare — cf. T154) → échec
  silencieux, retenté au tick suivant, **aucun marqueur de conflit écrit** (garanti par le choix de
  `fastForwardOnly: true`/`--ff-only`, jamais de vrai merge en tâche de fond).

## Pourquoi une méthode dédiée (`pullFastForwardOnly`) plutôt que réutiliser `pull()` (T153)

`SyncService.pull()` (utilisé par le bouton manuel "Rafraîchir") fait un vrai merge
(`fastForwardOnly: false`) — acceptable pour un clic explicite de l'utilisateur (qui peut voir
l'erreur et comprendre qu'il a cliqué sur quelque chose). Totalement inacceptable pour une
opération silencieuse en tâche de fond : un vrai merge en conflit écrit des marqueurs de conflit
dans les fichiers de travail, ce qui corromprait silencieusement le travail de l'utilisateur sans
qu'il ait rien demandé. `pullFastForwardOnly` élimine structurellement ce risque — un
fast-forward-only refuse et ne touche à rien s'il ne peut pas avancer proprement.

## Tests effectués

### Backend (`SyncService`), avec deux clones locaux d'un dépôt bare (remote non-http → chemin
`git pull --ff-only` réellement exercé, pas seulement le chemin isomorphic-git) :

1. **Clean + en retard** : `pullFastForwardOnly` met effectivement à jour le fichier sur disque
   (vérifié par lecture du fichier après coup, contrairement à `fastForwardBranch` de T154 qui ne
   touche jamais le disque — ici c'est le comportement voulu puisqu'on est sur la branche
   checkoutée).
2. **Divergé** (commit local non poussé + remote avancé ailleurs) : `pullFastForwardOnly` échoue
   proprement (`git pull --ff-only` refuse), fichier de travail **inchangé, aucun marqueur de
   conflit**, `git status` confirme qu'aucun merge n'est en cours.

### Application réelle (driver Playwright), avec un vrai projet Polenta pointant vers un remote local :

- Confirmé que l'auto-pull ne se déclenche pas à l'ouverture (premier tick après l'intervalle).
- Confirmé qu'un repo dirty/divergé au moment d'un tick ne provoque aucune corruption (fichier
  inchangé, statut propre après coup) — cohérent avec les tests backend.
- **Limite rencontrée** : reproduire en conditions réelles le cas "propre + simplement en retard"
  via l'app complète s'est révélé impossible à isoler proprement, à cause d'une découverte faite en
  cours de route (voir ci-dessous) — `WorkspaceTreeService` réécrit `.polenta/tree.cache.yaml` avec
  un timestamp `generatedAt` à chaque ouverture/régénération de l'arbre, et ce fichier est suivi
  par git : le repo apparaît quasi systématiquement "modifié" peu après l'ouverture, ce qui bloque
  la garde "propre" de l'auto-pull (et du bouton Rafraîchir de T153) avant même le premier tick
  utile. Le comportement du **service** sous-jacent (`pullFastForwardOnly`) a néanmoins été validé
  directement et de façon concluante (voir Backend ci-dessus) ; c'est la mise en scène end-to-end
  via l'UI complète qui n'a pas pu isoler ce cas précis à cause de ce problème préexistant et sans
  rapport.

## Découverte signalée, non corrigée ici

Voir `specs/T155.md` §"Découverte pendant les tests" et `SPEC-FORKS-BRANCHES-BASELINES.md` §2.5 —
`tree.cache.yaml` versionné avec un timestamp changeant à chaque régénération. Recommandation :
ticket dédié, soit l'ignorer via `.gitignore`, soit ne le réécrire que si son contenu utile a
changé (hors `generatedAt`).

`pnpm run typecheck` (turbo, 6 packages) : 0 erreur.

## Mises à jour SPEC

- `SPEC-FORKS-BRANCHES-BASELINES.md` : nouvelle §2.5 "Auto-pull périodique (T155)".
- `SPEC-INDEX.md` : ligne `SPEC-FORKS-BRANCHES-BASELINES.md` §1–2 — mots-clés et colonne MAJ.
