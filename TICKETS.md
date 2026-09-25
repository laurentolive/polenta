## New

### T174 — Évolution : l'analyse d'impact sort du panneau Version et a sa propre icône dans la barre d'activité

**Statut** : coding sprint 1 — branche `T174`, worktree `../polenta-T174`

**Demande** : l'analyse d'impact est aujourd'hui une sous-vue du panneau Version (bouton
`ListTree` dans son en-tête). La sortir en entrée à part entière de la barre d'activité à
gauche, avec une icône dédiée (document + cases cochées + crayon, cf. maquette utilisateur).
Le panneau latéral affiche le sélecteur de baselines / liste des analyses
(`VersionImpactSelector`) ; le bouton correspondant disparaît de l'en-tête Version.

### T173 — Évolution : analyse d'impact — lever le flag `needsRevalidation` des éléments

**Statut** : New — dépend de T172

**Demande** : T172 marque `needsRevalidation: true` les éléments (exigences, tests) liés à un
élément `approved` modifié, et affiche une icône ⚠ « Impact à vérifier » à côté de leur statut.
Rien ne remet ce flag à `false`. Dans la vue Analyse d'impact, permettre à l'utilisateur de
traiter l'impact sur un élément marqué et de lever le flag (`needsRevalidation` retiré du YAML
de l'élément). Périmètre (action unitaire / en masse, trace de qui a levé le flag et quand, lien
avec les pré-vérifications de baseline SPEC-TRACEABILITY §5.2) à préciser en phase Spec.

### T171 — Évolution : base de paramètres partagés entre exigences et tests

**Statut** : coding sprint 3 (dernier) — implémenté (`specs/T171-sprint3.md`), `tsc` propre, scripts de service OK, parcours campagne vérifié dans l'app, SPEC mises à jour ; en attente de validation humaine ; travail sur `main`

**Demande** : un test générique (partagé entre plusieurs produits) prend des valeurs que le
testeur va aujourd'hui chercher à la main dans les exigences (colonne « objectifs » remplie par
la qualité), et une même information (ex. modes d'aspiration et puissances) sert à plusieurs
tests et exigences. Introduire une base de paramètres (nom → valeur texte), portée par chaque
repo (produit et composants), référencée par `{nom}` / `{<nœud>::nom}` dans le texte des
exigences et des tests, indépendamment des liens. Unifiée avec les paramètres T97 (repli en
saisie manuelle). Résolution et gel des valeurs à l'ajout en campagne, à la baseline de la
campagne si elle existe. Les variantes de jeux de valeurs passent par les branches git.
**Dépend de T172** (livré, archivé). Spec réalignée sur T172 (flag porté par les éléments). Voir `specs/T171.md`.

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

### T162 — Évolution : afficher/masquer les titres de dossiers dans les vues Excel et Word (densité d'affichage)

**Statut** : Done — mergé sur master

**Description** : dans les vues Excel et Word de la Vue Système, les titres de dossiers
(lignes de groupe en Excel, sections H1–H6 en Word) étaient toujours affichés. Ajout d'une
case à cocher **« Afficher les titres des dossiers »** dans la roue crantée ⚙️
(`FieldConfigModal`), par onglet (Tableau / Document), cochée par défaut. Décochée : liste
plate, plus de lignes de groupe ni de sections `Hn`, collapse ignoré, numérotation de
section conservée sur les éléments. Persistée avec la config des colonnes
(`fieldVisibility["<nœud>::<type>"]` gagne `showFoldersExcel` / `showFoldersWord` ; pref
pré-T162 ⇒ affichés). « Réinitialiser » remet aussi la case cochée. En Excel, titres
masqués, le drag & drop de réordonnancement reste possible entre éléments de même dossier
parent uniquement. Doc : `SPEC-SYSTEM-VIEW` §Vue Excel / §Vue Word / §Configuration des
champs / §Persistance. Voir `specs/T162.md`, `specs/T162-design.md`, `specs/T162-sprint1.md`.

### T159 — Bug : modifs d'un champ richtext perdues en vue Édition (+ T161 : titre/desc d'une exigence créée depuis l'arbre)

**Statut** : Done — mergé sur master

**Description** : en vue Édition, un champ `richtext` n'avait aucun autosave (contrairement
aux vues Excel/Word) ; sa seule persistance était un *flush* à la navigation
(`handleBack` + cleanup de démontage T127), absent dès qu'`EditView` reste monté et que
seul `editingNodeId` change (double-clic sur un autre élément de l'arbre, navigation vers
un objet lié, bascule Exigences/Tests). Vecteur additionnel : un refetch de la query
`['object']` pendant l'édition (blur d'un autre champ, retour de focus fenêtre) écrasait
`localValuesRef` via l'effet `[objectData]`.

Volet **T161** absorbé (signalé sur `handstickProduct` / `VE22D`) : une exigence créée
depuis l'arbre de la Vue Système s'ouvrait vide — `title: "Sans titre"` et `fields: {}` —
faute de synchro titre ↔ nom d'arbre au renommage inline (course avec la création async de
`createItemObject`) et pour la même root cause richtext que T159.

Correctif : autosave debouncé du richtext, miroir `localValuesRef` propriété exclusive de
l'effet `[objectData]` (protégé des refetch), flush ciblé de l'objet sortant au changement
d'élément, `handleFlushEditValues` async avec retry sur échec, sérialisation des écritures
par fichier côté main (`withKeyLock` dans `RequirementsService`/`TestsService` — ferme
aussi la course latente pré-existante d'Excel/Word), synchro titre via
`ElementTree.onItemRenamed` / `SystemPanel.handleItemRenamed` + rattrapage dans
`createItemObject`. Voir `specs/T159.md`.

### T158 — Évolution : Ctrl+Entrée valide la saisie dans un champ richtext

**Statut** : Done — mergé sur master

**Description** : dans un champ `richtext` (`RichTextField.tsx`, éditeur TipTap),
`Ctrl/Cmd+Entrée` n'avait aucun effet métier — l'extension `HardBreak` de starter-kit
mappe `Mod-Enter` sur un saut de ligne et consomme l'évènement. Ajout d'une extension
TipTap `submitOnModEnter` (`priority: 1000`) + prop `RichTextField.onSubmit`, câblée sur
l'action primaire de chaque contexte d'édition richtext : popover Vue Tableau (ferme),
champ inline Vue Document (`commit`), `EditView` (flush), formulaires de création
(submit), pages détail req/test (« Enregistrer »), cellules `StepsTable`, édition des
champs de campagne, commentaires d'exécution. `Maj+Entrée` reste le saut de ligne ; sans
`onSubmit` le comportement TipTap par défaut est préservé (lecture seule incluse). Doc :
`SPEC-REQ` §3.2e. Voir `specs/T158.md`.

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
