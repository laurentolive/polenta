## New

### T154 — Évolution : sécuriser "Publier" (fetch + fast-forward de l'intégration, échec réseau explicite)

**Statut** : coding sprint 1 — implémenté et testé (hors UI, tests directs du service), en attente de validation humaine (branche `T154`, worktree `../polenta-T154`)

**Description** : suite à T153 (bouton "Rafraîchir"), préparation de l'auto-pull périodique (T155) :
un auto-pull en tâche de fond n'est sûr que si la branche d'intégration locale ne peut jamais
diverger silencieusement de `origin`. Audit de `ModificationControl.tsx` : le workflow "Publier"
mergeait sur l'intégration locale sans fetch préalable, et le push final était best-effort/non
attendu — une divergence silencieuse était possible en cas de publication concurrente. Ajout d'un
`fetch` en tout début de "Publier" (avant toute création de branche/commit — échec réseau bloque
proprement, sans effet de bord) puis d'un fast-forward de l'intégration locale si elle est
simplement en retard, avant le merge. Voir `specs/T154.md` et `specs/T154-sprint1.md`.

### T153 — Évolution : bouton "Rafraîchir" (git pull) dans le panneau Version

**Statut** : coding sprint 1 — implémenté et testé manuellement, en attente de validation humaine (branche `T153`, worktree `../polenta-T153`)

**Description** : `SyncService.pull()` (`apps/desktop/src/main/services/sync.service.ts:291`) est
déjà exposé de bout en bout (IPC `sync:pull`, `api.sync.pull()`) mais jamais déclenché depuis
l'UI — aucun bouton pull n'existe dans le panneau Version. Ajout d'un bouton "Rafraîchir" à côté
du nom de chaque repo dans `VersionRepoFolder.tsx` (root, composant ou intégration), qui déclenche
un `git pull`. Le bouton est désactivé (avec tooltip explicatif) tant que le repo a des
modifications en attente (`isDirty` — même calcul déjà utilisé pour bloquer le checkout direct) :
le pull ne doit être lançable que sur un checkout propre. Voir `specs/T153.md`.

### T151 — Évolution : menu contextuel (élément / dossier) sur le bouton + du panneau latéral

**Statut** : coding sprint 1 — implémenté et testé manuellement, en attente de validation humaine (branche `T151`, non committé)

**Description** : Dans les vues Exigences et Tests, le bouton `+` du panneau latéral
(bas de l'arbre `ElementTree`, et variante « Créer le premier élément » sur arbre vide)
crée directement un élément, sans possibilité de créer un dossier au même endroit —
seul le clic droit dans le vide (menu `BgContextMenu`) proposait déjà les deux choix.
Le bouton `+` doit ouvrir un petit menu contextuel « Créer un élément / Créer un dossier »
(réutilisant les actions existantes), au lieu de créer un élément directement.
Hors scope (décision utilisateur) : vue Campagnes — `CampaignNavList` est une liste
plate sans notion de dossier dans le modèle de données actuel ; son bouton `+` reste
inchangé.

## Done

### T157 — Évolution : afficher l'adresse du repo GitHub sous le nom du projet

**Statut** : Done — mergé sur master

**Description** : dans le panneau latéral "Projet" (`ProjectPanel.tsx`), seul le nom
d'affichage du projet était visible. Ajout d'une ligne secondaire sous ce nom, affichant
l'URL du remote `origin` du repo root (adresse GitHub) quand un remote est configuré —
nouveau champ `ProjectInfo.remoteUrl`, lu dans `WorkspaceService.resolve()` via
`git.listRemotes` (même pattern que `sync.service.ts`/`workspace-tree.service.ts`).
Voir `specs/T157.md`.

### T156 — Bug : `.polenta/tree.cache.yaml` versionné par erreur, bloque les gardes "repo propre"

**Statut** : Done — mergé sur master

**Description** : découvert en testant T155 — `WorkspaceTreeService.writeCache()` écrit
`.polenta/tree.cache.yaml` (chemins absolus locaux, timestamp changeant à chaque écriture) sans
jamais garantir qu'un `.gitignore` l'exclut. `createNewProject`/`openProject`
(`workspace.service.ts`) ne protégeaient ce fichier que par accident dans un seul cas, jamais dans
le cas d'adoption d'un repo existant — d'où un repo qui apparaît "modifié" en permanence peu après
ouverture, bloquant le bouton Rafraîchir (T153) et l'auto-pull (T155). Correctif centralisé dans
`writeCache()` elle-même (garantit le `.gitignore` avant chaque écriture, quel que soit
l'appelant) + nettoyage du fichier déjà suivi dans ce repo (`apps/desktop/PL/.polenta/tree.cache.yaml`).
Voir `specs/T156.md`.

### T155 — Évolution : auto-pull périodique en tâche de fond

**Statut** : Done — mergé sur master

**Description** : suite à T153 (bouton "Rafraîchir") et T154 (sécurisation de "Publier") — un
utilisateur non git-initié ne devrait jamais avoir à connaître l'existence d'un pull. Ajout d'un
auto-pull en tâche de fond (`useAutoPull`, monté dans `AppLayout.tsx`), qui tourne toutes les
5 minutes tant qu'un projet est ouvert (indépendamment de l'onglet actif, pas de pull à l'ouverture
du projet elle-même). Utilise une nouvelle méthode `SyncService.pullFastForwardOnly` (jamais de
vrai merge — une opération silencieuse ne doit jamais pouvoir écrire de marqueurs de conflit).
Ignore tout repo avec des modifications en attente. Voir `specs/T155.md`.

### T152 — Bug : ECONNRESET au clone d'un repo distant derrière un proxy d'entreprise

**Statut** : Done — mergé sur master

**Description** : Sur un poste d'entreprise derrière un proxy, le login GitHub (Device
Flow) fonctionnait mais le clone d'un projet échouait avec `read ECONNRESET`. Root cause :
le commit `7701f1f` (« organization proxy support ») n'avait rendu proxy-aware que
`auth.service.ts`, pas le transport git (`isomorphic-git/http/node`, basé sur les modules
`http`/`https` natifs de Node, sans connaissance du proxy). Voir `specs/T152.md` pour le
détail et le correctif (`git-http.ts`).

### T150 — Bug : version non incrémentée au retour approved → draft

**Statut** : Done — mergé sur master

**Description** : Une fois qu'une exigence est passée en statut `approved`, si elle repasse
en `draft` (retrait d'approbation / nouvelle itération), son champ `version` doit s'incrémenter.
Ce n'était pas le cas via la colonne Statut de la vue Excel (chemin `transition()`),
contrairement au bouton dédié « Reopen draft » de la vue Word (chemin `openDraft()`).
Voir `specs/T150.md` pour le détail.
