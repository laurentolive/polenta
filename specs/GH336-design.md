# GH336 — Design

Spec : `specs/GH336.md`. Développé directement sur `main` (demande de l'humain, 2026-11-09).

## Sprint 1 — checkout sûr, fichiers initiaux, plus d'ajouts silencieux

- **`safe-checkout.util.ts` → `safeCheckout(args)`** remplace `checkoutKeepingEol` (GH335) chez tous
  ses appelants. Sur `CheckoutConflictError` (levée par isomorphic-git *avant* toute écriture),
  chaque fichier en cause est classé :
  - ne diffère de HEAD que par les fins de ligne → réécrit tel que dans HEAD (GH335) ;
  - ignoré, non suivi, `*.pref` (Q1) → contenu gardé en mémoire, fichier retiré, checkout, contenu
    restauré ;
  - sinon → `LocalChangesError`, message en clair, un fichier par ligne avec sa raison : « modifié »,
    « non suivi, existe sur `<ref>` », « ignoré ici, versionné sur `<ref>` ».
  Si les deux premiers cas couvrent tout, le checkout est relancé.
- **Atomicité (§5.3)** : une erreur *autre* qu'un conflit, une fois le checkout commencé (écritures
  faites), déclenche un retour forcé sur la position de départ (`force: true`, sans risque puisque
  le contrôle préalable a établi qu'il n'y a pas de modification locale), puis l'erreur est
  relancée. La copie mise de côté d'un `*.pref` est restaurée dans tous les cas (`finally`).
- **Fichiers initiaux** : `polentaInitFiles` (création de projet) ajoute
  `.gitattributes` = `* text=auto eol=lf`. Le dépôt composant initialisé par `schema.service`
  reçoit le même `.gitignore` complet (`.polenta/tree.cache.yaml`, `*.pref`) et `.gitattributes`.
  Constantes partagées : `repo-conformity.util.ts` (`GITIGNORE_LINES`, `GITATTRIBUTES_LINE`).
- **Plus d'ajout silencieux à `.gitignore`** : `ensurePrefIgnored` (pref-store) et
  `ensureCacheIgnored` (workspace-tree) sont supprimés. Un repo non conforme le voit (fichiers non
  suivis dans Modifications) ; la correction passe par le sprint 2.

## Sprint 2 — mise en conformité d'un repo (D)

- **`RepoConformityService`** (main) :
  - `check(repoPath)` → liste d'éléments `{ id, label, files[] }` :
    - `gitattributes` : absent, ou sans la ligne ;
    - `gitignore` : lignes manquantes ;
    - `tracked-local` : fichiers suivis qui devraient être locaux (`*.pref`,
      `.polenta/tree.cache.yaml`) ;
    - `agent-files` : `AGENTS.md` / `.mcp.json` absents ou périmés (logique de
      `ensureVersionedFile`, désormais en lecture seule à l'ouverture).
  - `apply(repoPath)` — conditions : arbre propre, branche d'intégration checkoutée, intégration à
    jour avec `origin` (fast-forward d'abord si en retard ; divergée → refus, message « à
    resynchroniser d'abord »). Puis :
    1. écrit les fichiers ;
    2. retire de l'index les fichiers locaux suivis (sans les supprimer du disque) ;
    3. repasse en LF les fichiers qui ne diffèrent de git que par les fins de ligne ;
    4. commit `[polenta] Mise en conformité du dépôt (<éléments>)` qui ne contient que ces
       fichiers ;
    5. push de l'intégration.
    Un échec du push est rendu comme pour Publier (dernière erreur de synchronisation).
- **IPC** : `conformity:check`, `conformity:apply` (web : exposés, chemin = arg 0).
- **UI** : dans le panneau Version, sous l'en-tête de chaque repo, une ligne d'avertissement
  « Polenta doit mettre à jour ce dépôt » + détail dépliable + **Valider** / **Plus tard**. « Plus
  tard » masque la ligne jusqu'à la prochaine ouverture du workspace (état renderer, non persisté —
  Q3). Masquée si le repo est en lecture seule.
- `ensureAgentFiles` à l'ouverture devient une simple vérification (plus d'écriture).

## Sprint 3 — seed des dashboards sous D

- `dashboards:list` n'écrit plus de fichier versionné : le seed partagé (Status, `dashboards/lib`,
  marqueur `.seeded.yaml`) et `upgradeLegacySeeds` deviennent des éléments de conformité
  (`dashboards-seed`, `dashboards-upgrade`) appliqués par `apply`. Le seed privé (`.pref`) reste
  automatique (local).
- Tant que ce n'est pas validé, le panneau Dashboards affiche « Dashboards par défaut : à valider
  dans le panneau Version ».

## Tests

- Unitaires : `safe-checkout.gh336.test.ts` (fins de ligne, `*.pref` mis de côté et restauré,
  message de blocage, retour arrière sur erreur injectée) ; `repo-conformity.gh336.test.ts` (check
  / apply : commit limité aux fichiers, retrait de l'index, normalisation LF, refus si sale ou
  divergé) ; mise à jour des tests existants qui supposaient les ajouts silencieux et les écritures
  à l'ouverture.
- e2e web : la ligne de conformité dans le panneau Version (Valider → repo propre, commit
  `[polenta]`).
