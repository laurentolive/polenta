# Polenta — Spécification Fonctionnelle

> Application de gestion d'exigences et de tests, inspirée de Siemens Polarion.

---

## 1. Vision du produit

Polenta est un outil de gestion du cycle de vie des exigences et des tests, orienté traçabilité et collaboration. Il couvre la hiérarchie d'exigences, les cas de test, l'exécution, l'analyse d'impact, et le travail en équipe (forks, merges, reviews).

---

## 2. Périmètre fonctionnel

### 2.1 Gestion des exigences

> Spec détaillée : [specs/SPEC-REQ-requirements.md](specs/SPEC-REQ-requirements.md)

- **Types d'exigences configurables par projet** : hiérarchie de types (ex. SYS → SW → COMP), chaque type avec son propre schéma de champs.
- **Champs personnalisés par type** : TEXT, RICHTEXT (avec images), ENUM, MULTI_ENUM, DRAWIO, NUMBER, DATE, USER, REQ_LINK, BOOLEAN.
- **Diagrammes DrawIO** : intégrés dans les champs DRAWIO, versionés avec l'exigence, rendus en SVG.
- **Versionnement entier** : chaque approbation crée une version immuable (1, 2, 3…), avec diff entre versions. Pas de versionnement MAJEUR.MINEUR.
- **Lien Jira par version** : chaque version peut être liée à un ou plusieurs tickets Jira (statut mis en cache, rafraîchissable).
- **Liens entre exigences typés** : DERIVES_FROM, SATISFIES, DEPENDS_ON, CONFLICTS_WITH, REFINES — avec revalidation si la cible évolue.
- **Identifiants stables** : `<PREFIX>-<NUMERO>` (ex. SW-0042), jamais réassignés.

### 2.2 Gestion des cas de test

> Spec détaillée : [specs/SPEC-TESTS.md](specs/SPEC-TESTS.md)

- **Définition versionnée** : même modèle que les exigences (brouillon → version approuvée). Identifiant `TEST-XXXX`.
- **Étapes ordonnées** : chaque étape = `action` (ce que le testeur fait) + `expectedResult` (ce qui doit se passer).
- **Préconditions / postconditions** : contexte requis avant et nettoyage après.
- **Champs configurables** via template (environnement, équipement, `automationId`…).
- **Lien vers exigences** : `full` ou `partial`, avec version ciblée et revalidation si l'exigence évolue.

### 2.3 Exécution des tests

> Spec détaillée : [specs/SPEC-TESTS.md](specs/SPEC-TESTS.md) §3–4

- **TestRun** : exécution concrète d'un TestCase à une version précise. Résultat par étape (PASS / FAIL / BLOCKED / SKIP / NOT_EXECUTED) + résultat global calculé.
- **Exécution manuelle** : le testeur parcourt les étapes, saisit le résultat observé et des notes.
- **Import automatisé** : JUnit XML ou JSON, mappé via le champ `automationId` du TestCase.
- **Campagnes** : sélection de TestCases à exécuter ensemble. Peut être générée automatiquement depuis une sélection d'exigences.
- **CampaignRun** : une exécution d'une campagne (plusieurs possibles par campagne). Tableau de bord : taux d'exécution, taux de succès, répartition par statut.

### 2.4 Traçabilité

> Spec détaillée : [specs/SPEC-TRACEABILITY.md](specs/SPEC-TRACEABILITY.md)

- **Matrice de couverture** : vue croisée exigences × tests. Statuts par cellule : `not_run` / `pass` / `fail` / `blocked` / `needs_revalidation`. Vue hiérarchique agrégeant le pire statut enfant. Filtres par type, tag, statut, campagne.
- **Liens manquants** : exigences sans test, tests orphelins (sans exigence liée), liens marqués `needsRevalidation`. Action rapide "Créer un test" depuis la liste.
- **Analyse d'impact** : à l'ouverture d'un brouillon ou sur demande — liste tous les éléments à revalider (tests couvrant l'exigence, exigences filles, campagnes en cours). Propagation configurable (niveau 1 par défaut). Chaque impact peut être marqué "Vérifié" avec commentaire.
- **Génération de plan de test** : depuis une sélection d'exigences → campagne pré-remplie avec résumé (X tests trouvés, Y exigences non couvertes).
- **Export** : CSV, Excel, PDF audit, `traceability/matrix.yaml` (généré par `scripts/matrix.py` du template, utilisable en CI).

### 2.5 Branches, Forks, Composants et Baselines

> Spec détaillée : [specs/SPEC-FORKS-BRANCHES-BASELINES.md](specs/SPEC-FORKS-BRANCHES-BASELINES.md)

- **Branches** : travail parallèle intra-projet (feature, variant, fix). Merge avec résolution de conflits champ par champ.
- **Forks** : clone complet d'un projet pour une variante longue durée ou un dérivé OEM. Merge inter-projets via wizard guidé.
- **Composants** : projets Polenta réutilisables en sous-module (ex: spécifications BMS partagées entre plusieurs produits). Référencés avec version pinnée sur une baseline du composant. Read-only dans le projet parent. Mise à jour avec analyse d'impact automatique.
- **Baselines** : snapshot immuable posé à chaque jalon (release, audit, certification). Tag git + fichier de métadonnées avec stats de couverture. Consultable en lecture seule. Comparaison diff entre deux baselines.

### 2.6 Reviews

> Spec détaillée : [specs/SPEC-REVIEWS.md](specs/SPEC-REVIEWS.md)

- **Sélection des objets** : objet unique, sélection multiple, ou groupe hiérarchique (tous les descendants d'un nœud).
- **Assignation de relecteurs** : par utilisateur ou par rôle. Ajout possible après ouverture.
- **Actions du relecteur** : approuver (par objet ou "Approuver tout") et commenter. **Pas de refus ni de demande de modifications formelle** — les réserves passent uniquement par les commentaires.
- **Commentaires richtext** à 3 niveaux : review / objet / champ précis. Threads avec replies. Résolution manuelle.
- **Quorum configurable** : N approbations requises par objet (null = unanimité).
- **Clôture manuelle** par le créateur : `approved` (déverrouille les transitions de workflow) ou `closed` (abandonnée).
- **Stockage** : un fichier YAML par review + un fichier par commentaire (évite les conflits git).

### 2.7 Dashboards et requêtes personnalisées

> Spec détaillée : [specs/SPEC-DASHBOARDS.md](specs/SPEC-DASHBOARDS.md)

- **Requêtes façon SQL** sur l'index en mémoire (moteur AlaSQL, pas de moteur de stockage) — query builder guidé par `schema.yaml` ou SQL avancé en lecture seule, portant sur le repo courant et les composants submodules agrégés.
- **Requêtes sauvegardées** (privées ou partagées) + **historique** (toujours privé, purge automatique des entrées devenues invalides).
- **Dashboards** : grille de **widgets** à tailles prédéfinies (barres, camembert, courbe, tuile KPI, table), type de widget jamais contraint par la forme du résultat de la requête, aperçu live à la configuration.
- **Visibilité privé/partagé** en cascade : un widget ne peut être partagé que si sa requête l'est, un dashboard que si tous ses widgets le sont — rétrogradation et suppression bloquées si des dépendants partagés existent.
- **Trois dashboards pré-configurés** (Couverture, Avancement, Maturité) seedés automatiquement au premier accès si le dossier `dashboards/` est vide.
- **Critères de maturité d'une exigence** : champs `required` remplis, syntaxe EARS du/des champ(s) `validator: EARS`, au moins un critère d'acceptance mesurable, lien de vérification si `approved`, aucun lien `needsRevalidation`.
- Remplace l'ancien "Tableau de bord" statique de la page Projet (StatCards/répartitions/récemment modifiées), retiré sans reprise.

---

## 3. Entités du domaine (modèle de données haut niveau)

```
Project (repo git local cloné)
  ├── Branch dev-* ──────────────────────── unité de travail = branche git ("faire une modification")
  │     └── "Publier" (stage + commit + merge automatique) → Branch intégration
  ├── Branch intégration (int-*, configurée par repo — branche de référence)
  │     ├── Requirement (hiérarchie, liens, versions)
  │     │     └── TestCase (lié à 0..n exigences)
  │     ├── Campaign (sélection de tests)
  │     │     └── CampaignRun → TestRun (résultat par cas de test)
  │     └── Review (REVIEW-XXXX, indépendante — créée sur n'importe quelle branche)
  └── Baseline (snapshot immuable = git tag)
```

---

## 4. Rôles utilisateurs

| Rôle | Droits |
|---|---|
| Admin | Tout, configuration du projet |
| Auteur | Créer/modifier exigences et cas de test |
| Testeur | Exécuter les tests, saisir résultats |
| Relecteur | Commenter et approuver en review |
| Observateur | Lecture seule |

---

## 5. Contraintes techniques

- **Client lourd Electron** — pas de serveur HTTP embarqué. Voir [specs/SPEC-TECH-stack.md](specs/SPEC-TECH-stack.md) et [specs/SPEC-ELECTRON-DESKTOP.md](specs/SPEC-ELECTRON-DESKTOP.md).
- **Remote git** (GitHub, Gitea, auto-hébergé) = seul serveur. Sync via push/pull explicite.
- **Stockage : git + YAML** — pas de base de données relationnelle. Index en mémoire reconstruit depuis le working tree.
- **Chaque modification passe par une branche `dev-*` dédiée** (bouton "faire une modification"). "Publier" commit et merge automatiquement vers la branche d'intégration configurée du repo — pas de review obligatoire avant merge. Voir [specs/SPEC-FORKS-BRANCHES-BASELINES.md](specs/SPEC-FORKS-BRANCHES-BASELINES.md) §2.
- Export : PDF (rapports), Excel (matrices), JUnit XML (résultats)
- Import : exigences depuis CSV/Excel, résultats de test JUnit XML

---

## 6. Hors périmètre

Les fonctionnalités Polarion suivantes sont explicitement **exclues** :

- Gestion de portefeuille / planning Agile (boards, sprints)
- Intégration ALM complète (Jira, GitLab CI natif)
- Documents Word live
- Wikis
- Gestion des risques
- Reporting OOTB avancé (Velocity, burndown, etc.)

### 2.7 Interface — Vue tableau (ExcelView)

#### Sélection de lignes (T14)

- **Clic simple** sur une ligne (item ou dossier) → sélection simple (une seule ligne sélectionnée).
- **Ctrl/Cmd + clic** → basculement (ajout ou retrait de la ligne dans la sélection).
- **Shift + clic** → sélection de plage contiguë depuis la dernière ligne sélectionnée jusqu'à la ligne cliquée.
- **Clic sur zone vide** (espace sous le tableau) → désélection complète.
- **Comportement des dossiers** : clic simple sur la ligne = sélection. L'icône chevron dans la colonne bouton déclenche collapse/expand (stopPropagation). Double-clic sur la ligne dossier = bascule collapse/expand.
- **Visuel** : ligne sélectionnée surlignée `bg-blue-100 dark:bg-blue-900/20`.
- La sélection est gérée localement dans `ExcelView` (état interne). Les props optionnelles `selectedIds` et `onSelect` permettront de la remonter au parent pour T15.
- Compatible avec l'édition inline (double-clic sur cellule) et le drag & drop de lignes.

#### Coloration des lignes dossier (T17)

- Les lignes dossier ont un fond permanent `bg-hover`, identique au header du tableau — elles sont ainsi visuellement distinguées des lignes item sans survol nécessaire.
- La sélection (`bg-blue-100 dark:bg-blue-900/20`) override ce fond comme pour les lignes item.
- Pas de changement de fond au survol sur une ligne dossier (comportement identique au header).

#### Copie / Coller / Suppression (T15)

- **Raccourcis clavier** (actifs quand le tableau a le focus, ignorés si une cellule est en édition) :
  - `Ctrl+C` — copier les lignes sélectionnées dans le presse-papier interne
  - `Ctrl+X` — couper (les nœuds source sont marqués et retirés de l'arbre à la pose)
  - `Ctrl+V` — coller après/dans la première ligne sélectionnée ; si cible = dossier : colle à l'intérieur ; si cible = item : colle après
  - `Delete` / `Backspace` — supprimer les lignes sélectionnées (confirmation si dossier non vide)
  - `Escape` — annule le mode couper ou ferme la modale de confirmation
- **Menu contextuel** (clic droit sur une ligne) : Copier, Couper, Coller (si presse-papier), separator, Supprimer. Le nœud cliqué-droit est ajouté à la sélection s'il n'y est pas déjà.
- **Nœuds coupés** : affichés en `opacity-50` tant qu'ils n'ont pas été collés.
- **Suppression** : dossiers vides et items → directe. Dossiers non vides → modale de confirmation identique à l'ElementTree.
- **Prop `generateId`** : requise pour coller (deep-copy avec nouveaux IDs). Si absente, Coller est désactivé.
- La sélection est mise à jour après chaque opération (cleared après delete, set aux copies après paste).

#### Drag & drop de lignes

- Items **et** dossiers sont déplaçables (le dossier emporte ses enfants).
- Le changement de parent est autorisé — un nœud peut être déposé dans un dossier différent ou à la racine.
- **Déclencheur** : glisser-déposer. Clic simple = sélection, double-clic = édition inline (inchangé).
- **Zones de drop** sur la ligne cible :
  - Haut (0–33 %) → insérer avant
  - Bas (67–100 %) → insérer après
  - Centre (33–67 %), cible = dossier → insérer à l'intérieur (comme premier enfant)
  - Centre, cible = item → insérer après
- Drop ignoré si cible = soi-même ou descendant du nœud en cours de drag.
- **Persistance immédiate** via `api.tree.save` ; les numéros de section sont recalculés automatiquement.
- **Feedback visuel** : identique à l'`ElementTree` du panneau — ligne bleue horizontale avant/après, ring bleu pour drop à l'intérieur d'un dossier, ligne en cours de drag à `opacity-50`.
- Désactivé en mode `readOnly` et quand un filtre texte est actif.

#### Drag & drop de colonnes 

- Toutes les colonnes sont réordonnables sauf la colonne **N°** (`section`) et la colonne d'actions (icône crayon).
- **Déclencheur** : glisser le header `<th>`. Moitié gauche du header = insérer avant, moitié droite = insérer après (permet de déposer en dernière position). La zone de resize (4 px bord droit) n'est pas affectée.
- L'ordre des colonnes est porté par le tableau `visibleFields` existant — réordonner les colonnes = changer l'ordre de ce tableau.
- **Persistance** : même mécanisme que la visibilité des champs (`api.pref.setFieldVisibility`).
- **Feedback visuel** : header dragué à `opacity-50`, ligne bleue verticale sur le bord gauche de la colonne cible.
- Disponible même en mode `readOnly` (préférence d'affichage, pas de mutation de données).

#### Architecture 

**Lignes**
- `ExcelView` : nouvelle prop `onRootChange?(root)` + état `draggingNodeId` / `dropIndicator` + `draggable` sur chaque `<tr>` + handlers DnD. Réutilise `treeRemoveMany`, `treeInsert`, `treeInsertAtBeginning`, `treeFindNode`, `treeFindParentId` depuis `useTreeState`.
- `SystemView` : câble `onRootChange` → `setRoot` + `api.tree.save` (pattern identique à `handleRenameNode`).

**Colonnes**
- `ExcelView` : nouvelle prop `onColumnsReorder?(newOrder)` + état `draggingCol` / `dropColTarget` + `draggable` sur chaque `<th>`.
- `SystemView` : câble `onColumnsReorder` → `handleChangeExcel` (persistance via `api.pref.setFieldVisibility`).

---

## Changelog

### T10 — 2026-06-18
- [CORRECTION] Suppression du bouton "Enregistrer" dans la toolbar de `SystemView` : toutes les mutations de l'arbre (rename, DnD lignes/colonnes, création, copie/colle/suppression) appellent déjà `api.tree.save` directement. Le bouton était un relic. Ctrl+S reste fonctionnel pour sauvegarder après undo/redo.

### T17 — 2026-06-18
- [ÉVOLUTION] Lignes dossier dans la vue Excel : fond permanent `bg-hover` (comme le header), pas de changement au survol. Sélection `bg-blue-100/bg-blue-900/20` reste prioritaire.

### T15 — 2026-06-18
- [ÉVOLUTION] Copie/Coller/Suppression dans la vue Excel : raccourcis Ctrl+C/X/V, Delete, menu contextuel clic droit. Nœuds coupés en opacity-50. Confirmation pour dossiers non vides. Prop `generateId` requise pour coller.

### T14 — 2026-06-17
- [ÉVOLUTION] Sélection de lignes dans la vue Excel : clic simple, Ctrl+clic (multi), Shift+clic (plage), clic vide = désélection. Dossiers : chevron = toggle, double-clic ligne = toggle, clic simple = sélection.

### T9 — 2026-06-17
- [ÉVOLUTION] Drag & drop de lignes dans la vue Excel : items et dossiers déplaçables, changement de parent autorisé, persistance immédiate via `api.tree.save`, désactivé si filtre actif ou `readOnly`.
- [ÉVOLUTION] Drag & drop de colonnes : moitié gauche = insérer avant, moitié droite = insérer après. Colonne N° (`section`) non déplaçable. Persistance via `api.pref.setFieldVisibility`.
- [CORRECTION] Ordre des colonnes désormais fidèle à `visibleFields` (suppression du tri système-en-premier forcé).

---

## 7. Questions ouvertes

1. Nombre d'utilisateurs simultanés visés (dimensionnement du remote git) ?
2. Auth Jira : OAuth vs Personal Access Token ?
3. Verrouillage concurrent d'un brouillon (deux utilisateurs ouvrent une Action sur la même exigence) ?
