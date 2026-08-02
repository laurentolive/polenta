# SPEC-SYSTEM-VIEW — Vue Système

## Contexte

La vue Système permet d'explorer, créer, organiser et éditer les éléments d'un composant. Elle remplace l'ancienne organisation en onglets Exigences / Tests / Campagne par un modèle générique piloté par le data model du composant.

> **Note de nettoyage** : Les références aux domaines (SYS, SW, HW, MECA, BAT, PROD) sont des reliquats de l'ancien modèle et doivent être supprimées du code et des autres specs.

---

## Structure générale

```
┌──────────────────┬────────────────────────────────────────────────────┐
│  Panel Système   │  [Composant X / Élément Y]  [↩][↪][🔍][⚙️][vue]  │
│                  ├────────────────────────────────────────────────────┤
│  [Composant / Élément ▼]  ← un seul combobox filtrable (T129)         │
│                  │                                                    │
│                  │         Vue document                               │
│  🔍 [filtre   ]  │     (Excel / Word / Édition)                       │
│                  │                                                    │
│  ▼ Dossier A     │                                                    │
│    ├ elem 1      │                                                    │
│    └ elem 2      │                                                    │
│  ▷ Dossier B     │                                                    │
└──────────────────┴────────────────────────────────────────────────────┘
```

Le panel système (gauche) contient : le combobox Composant / Élément, le filtre et l'arbre. La
zone principale (droite) contient uniquement la vue document et sa toolbar.

---

## État initial

Au premier chargement : l'entrée correspondant au composant racine et à son premier type
disponible est sélectionnée dans le combobox.

---

## Panel Système (gauche)

### Combobox Composant / Élément (T72+T113+T120+T123, puis fusion Élément — T129)

Un seul combobox **filtrable par texte libre** fixe en une action le contexte d'édition — quel
`SystemNode` et quel type d'élément (`ObjectTypeDefinition`) de ce nœud. Avant T129, cette
sélection nécessitait deux comboboxes séquentiels (Composant, puis Élément) ; ils sont fusionnés
ici en un seul, chaque entrée étant une paire (`SystemNode`, type).

- **Entrées** : produit cartésien de la liste des `SystemNode` (racine + toutes les dépendances
  récursives, composants et interfaces confondus, à n'importe quelle profondeur d'imbrication
  locale — T123, cf. §3 `SPEC-TEMPLATES.md`) × les types d'éléments définis sur chacun. Un
  `SystemNode` **sans aucun type défini ne produit aucune entrée** — il n'est pas sélectionnable
  depuis ce combobox (à configurer via l'onglet Structure). Un composant en repo séparé et un
  composant local sont présentés de la **même manière** — aucune notion de "sous-composant"
  n'est exposée à l'utilisateur (T120).
- **Libellé d'une entrée** : chemin du composant (identique au libellé de l'ancien combobox
  Composant — mount name du repo, `label` du `SystemNode`, chemin `›` séparé par des ancêtres
  locaux pour un composant imbriqué, ex. `Boîtier › Capteurs`) suivi de `" / "` puis du `label`
  du type (ex. `Boîtier › Capteurs / Exigence Système`).
- **Groupement** : dans un workspace à **plusieurs repos**, un séparateur visuel (en-tête de
  section) identifie le repo d'origine, regroupant toutes ses entrées (y compris ses composants
  locaux imbriqués). En **mono-repo**, aucun en-tête n'apparaît (rien à désambiguïser) — le
  chemin `›` des composants imbriqués reste affiché, lui, dans tous les cas.
- **Filtrage** : taper du texte filtre la liste par sous-chaîne insensible à la casse sur le
  libellé complet (repo + chemin composant + type). Aucun résultat → message générique "Aucun
  résultat" (`common.noResults`), distinct du message "Aucun composant configuré" affiché quand
  le workspace entier n'a aucune entrée (combobox alors désactivé, ce message devient le
  placeholder du champ).
- **Navigation clavier** : Flèche haut/bas déplace la sélection surlignée dans la liste filtrée
  (avec défilement automatique si elle sort du cadre visible), Entrée valide, Échap referme sans
  changer la sélection.
- Sélectionner une entrée recharge en une seule action tout le contexte (schéma, arbre, index
  requirements/tests/liens) sur le `SystemNode` et le type choisis — plus d'étape intermédiaire
  "type non encore sélectionné".
- Un repo dont le pin (`polenta-repo.yaml`) résout vers un tag/SHA (HEAD détaché) plutôt qu'une
  branche est affiché en lecture seule (bandeau explicite, actions de création/édition
  désactivées) — le repo racine du projet ouvert reste toujours éditable.
- Persisté dans l'URL (`repo`+`node`/`component`+`type`/`level`) et dans la dernière sélection
  restaurée (T52) — format d'URL inchangé par T129, seule la présentation en un unique combobox
  filtrable change.
- Chaque type possède sa propre arborescence indépendante (inchangé).

### Filtre

- Barre de filtre sous les combobox, avec les options de la vue Recherche existante : sensibilité à la casse, mot entier, expression régulière.
- Quand un filtre est actif :
  - Seuls les éléments correspondants sont affichés dans l'arbre, **avec leurs dossiers parents** (hiérarchie préservée).
  - Les groupes collapsés contenant des résultats s'auto-expandent.
  - Les éléments non visibles ne peuvent pas être sélectionnés.
  - La vue document n'affiche que les résultats filtrés.
- **État vide** : si aucun élément ne correspond, afficher `Aucun élément`.

### Filtre par colonne (vue Tableau uniquement — T51)

- Chaque colonne filtrable de la vue Tableau (toutes sauf `Étapes`) porte une icône
  discrète dans son en-tête. Cliquer dessus ouvre un popover ancré sous l'en-tête,
  avec un champ texte et les mêmes 3 options que la barre de filtre globale
  (sensibilité à la casse, mot entier, expression régulière).
- Le filtre se réévalue en direct à la frappe ou au changement d'option (recherche
  "contient" par défaut). Une expression régulière invalide n'exclut aucune ligne
  (pas d'erreur affichée).
- Plusieurs filtres de colonnes actifs simultanément se combinent en **ET** entre eux,
  et en **ET** avec le filtre global de la barre de recherche.
- Les dossiers restent toujours affichés, comme pour le filtre global.
- L'icône d'une colonne filtrée se distingue visuellement (couleur active) de celle
  d'une colonne sans filtre, y compris popover fermé.
- `Échap` dans le popover vide le texte du filtre de la colonne (les options sont
  conservées) et ferme le popover ; un clic en dehors ferme le popover sans vider
  le texte.
- État local à la vue Tableau, non persisté : réinitialisé au changement de
  composant/type, ou à la fermeture du projet. Un filtre sur une colonne masquée
  (via la configuration des colonnes visibles) est oublié.
- Non disponible dans la vue Document — celle-ci ne conserve que le filtre global.

### Arbre

#### Structure

- Arborescence hiérarchique de **dossiers** et d'**éléments**, profondeur illimitée.
- Hétérogène : un dossier peut contenir à la fois d'autres dossiers et des éléments.
- Les noms peuvent être identiques ; l'unicité est garantie par l'**ID**, généré automatiquement à la création et immuable.

#### Création

Le bouton **`+`** est contextuel et apparaît au survol :
- Au survol d'un **dossier** : crée un élément à l'intérieur.
- Au survol de l'**espace entre deux éléments** : insère un élément à cette position.

Un bouton **`+ Nouvel élément`** permanent est affiché en fin d'arbre (création à la racine).

Le type de l'élément créé est celui sélectionné dans le combobox Composant / Élément. Disponible aussi via clic droit.

#### Menu contextuel (clic droit)

**Sur dossier ou élément :**

| Action | Comportement |
|--------|-------------|
| Créer un élément | À la racine de l'emplacement sélectionné |
| Créer un dossier | À la racine de l'emplacement sélectionné |
| Renommer | Édition inline du nom |
| Supprimer | Avec confirmation (voir ci-dessous) |
| Copier | Ctrl+C |
| Couper | Ctrl+X — remplace le déplacement |
| Coller | Après Copier ou Couper, sur dossier ou élément destination (Ctrl+V) |

**Sur zone vide de l'arbre :**

| Action | Comportement |
|--------|-------------|
| Créer un élément | À la racine |
| Créer un dossier | À la racine |
| Coller | Si presse-papier non vide |

**Règles du Coller**
- Disponible uniquement sur une destination dossier ou élément (pas zone vide).
- Ctrl+V fonctionne si le focus est dans l'arbre et qu'un dossier ou élément est sélectionné.
- Copier un élément : génère un nouvel ID unique.
- Copier un dossier : deep copy avec nouveaux IDs pour le dossier et tous ses enfants.
- Couper : déplace avec tout le contenu.

**Règles de Suppression**
- Élément seul : confirmation simple.
- Dossier non vide : confirmation explicite (suppression en cascade).
- Dossier vide : suppression directe sans confirmation.
- Suppression multi-sélection : opération atomique — un Ctrl+Z restaure l'intégralité.

#### Sélection

La sélection dans l'arbre n'a **aucun impact** sur le contenu de la vue document.

| Geste | Comportement |
|-------|-------------|
| Clic simple | Sélection simple |
| Shift + Clic | Sélection contiguë |
| Ctrl + Clic | Sélection discrète (toggle) |
| Double-clic | Ouvre la Vue Édition (sélection simple uniquement) |
| Clic droit | Menu contextuel |
| Clic dans zone vide | Désélectionne tout |

#### Drag & Drop

- Déplacer un ou plusieurs éléments ou dossiers (avec tout leur contenu).
- **Restriction** : drag & drop uniquement si tous les éléments sélectionnés sont au **même niveau**.
- **Feedback** : image fantôme semi-transparente + badge compteur (ex. `3 éléments`) ; ligne indicatrice pour la position de dépôt.
- **Ordre de dépôt** : suit l'ordre de l'arbre (pas l'ordre de sélection).
- Dépôt sur un dossier : déplace à l'intérieur.
- Dépôt entre deux éléments : réordonne à cette position.
- Dépôt sur un élément non-dossier : aucune action.
- Pas de drag & drop entre composants.
- **Echap** annule le drag.

#### Navigation clavier

| Touche | Action |
|--------|--------|
| ↑ / ↓ | Naviguer entre les éléments visibles |
| → | Expand dossier |
| ← | Collapse dossier |
| Entrée | Vue Édition (sélection simple uniquement) |
| F2 | Renommer inline |
| Suppr | Supprimer la sélection |
| Ctrl+C/X/V | Copier / Couper / Coller |
| Ctrl+Z/Y | Annuler / Rétablir (Ctrl+Z natif prioritaire dans les champs) |
| Echap | Annuler l'opération en cours |

---

## Toolbar de la vue document

Ligne unique en haut de la zone principale, maximisant la densité de la vue document.

```
[Composant X / Élément Y]        [↩] [↪] [🔍] [⚙️] [vue]
```

| Élément | Rôle |
|---------|------|
| **Composant X / Élément Y** | Titre contextuel — nom du composant sélectionné et nom du type d'élément sélectionné |
| **← Retour** | Visible uniquement si une navigation par lien interne a eu lieu (pile `backHistory`). Revient à l'élément précédent. Masqué en vue Édition. |
| **↩ ↪** | Undo / Redo |
| **🔍** | Activer / désactiver le filtre dans le panel gauche |
| **⚙️** | Configuration des champs visibles |
| **[vue]** | Sélecteur de vue : Excel / Word (le mode Édition s'active par double-clic ou icône inline, pas par ce sélecteur) |
| **Enregistrer** | Apparaît uniquement si des modifications sont en attente |

---

## Undo / Redo

- **Ctrl+Z** : annule. Les Ctrl+Z natifs des champs texte sont prioritaires.
- **Ctrl+Y** : rétablit.
- **Portée** : toutes les opérations sur l'arbre (créer, renommer, supprimer, copier/couper/coller, drag & drop) + éditions inline Excel et Word.
- **Vue Édition** : pile interne propre. Une fois enregistré, le delta entre dans la pile globale.
- **La pile est conservée après sauvegarde.**
- **Profondeur** : 20 actions.

---

## Vue document (zone principale)

Le contenu reflète l'état du filtre. **La sélection dans l'arbre n'a aucun impact.**

| État | Contenu affiché |
|------|----------------|
| Pas de filtre | Tous les éléments de l'arbre (lazy load) |
| Filtre actif | Résultats du filtre uniquement (lazy load) |

### Vue Excel

- Tableau : une ligne par élément, une colonne par champ visible.
- Les dossiers sont des **lignes de groupe collapsables**.
- Édition inline : double-clic sur une cellule.
- Champs système (ID, date de création, auteur…) : lecture seule, visuellement distincts.
- **Sélection multiple de lignes** : clic simple (sélection simple), Shift+clic (sélection contiguë), Ctrl+clic (sélection discrète/toggle) — indépendante de la sélection de l'arbre du panel gauche.
- **Édition en masse (T149)** : si plusieurs lignes sont sélectionnées et que l'une d'elles fait l'objet d'une édition inline (statut, énumération, texte, richtext, case `multi_enum`), le changement est propagé à toutes les lignes sélectionnées. Pour `multi_enum`, seule la valeur cochée/décochée est basculée sur chaque ligne — les autres valeurs déjà cochées sur les autres lignes ne sont pas écrasées. Les colonnes de lien (`link::`) ne sont pas concernées (mécanisme dédié, par ligne).

### Vue Word

- Document continu : éléments affichés les uns à la suite des autres.
- Les dossiers deviennent des **sections** :
  - Niveau 1 → H1, … niveau 6 → H6.
  - Au-delà du niveau 6 : style H6 avec indentation croissante.
- Édition inline : clic sur un champ (curseur `text` au survol).
- Champs système : lecture seule, visuellement distincts.

### Vue Édition

- Affiche les champs configurés via ⚙️ pour la vue Édition (réglages indépendants des vues Excel et Word).
- Chaque champ visible est éditable, sauf les champs système (ID, date de création, auteur…) affichés en lecture seule.
- Le rendu est celui du formulaire de création : un champ par ligne, label + contrôle adapté au type (`text`, `richtext`, `enum`, `date`, `boolean`, `drawio`…).
- **Déclencheur** : double-clic sur un élément dans l'arbre (sélection simple uniquement) ou icône Éditer dans les vues Excel / Word — désactivée si multi-sélection.
- Remplace la vue courante dans la zone principale.
- Bouton **Enregistrer** visible si dirty. Bouton **Annuler** / Echap pour revenir (confirmation si modifications en attente).
- Pile Undo interne propre pendant l'édition ; le delta entre dans la pile globale après enregistrement.

---

## Configuration des champs — ⚙️

- Choisir les champs à afficher parmi les champs du type d'élément + les champs système.
- **Réglages indépendants par vue** : Excel, Word et Édition ont chacun leur propre sélection de champs.
- Sauvegardé **par vue** (Excel / Word / Édition), **par type d'élément**, **par utilisateur**.
- Stockage : fichier local `.{githubaccount}.pref`.
- Option **Réinitialiser par défaut** disponible par vue.

**`coverageStatus` (T138)** — champ système représentant le statut de couverture de test d'une
exigence (`not_covered`/`covered`/`validated`/`failing`/`needs_revalidation`, cf.
[SPEC-TRACEABILITY.md](SPEC-TRACEABILITY.md) §2.2), affiché en icône non éditable (jamais de champ
texte/liste éditable). Proposé dans le panneau ⚙️ uniquement pour les types d'objet de catégorie
`requirement` (absent du panneau pour les cas de test), désactivé par défaut. En Excel c'est une
colonne à part entière ; en Word l'icône s'affiche dans l'en-tête de carte, à côté du badge de
statut de cycle de vie. **En Édition, contrairement à ce que dit le paragraphe ci-dessus** — l'onglet
"Édition" du panneau ⚙️ n'existe en réalité pas et `visibleFieldsEdit` n'est pas branché au rendu de
cette vue (écart déjà relevé dans [SPEC-AUDIT.md](SPEC-AUDIT.md) §"Configuration des champs ⚙️",
antérieur à ce ticket) — le badge y est donc affiché **en permanence** pour les exigences plutôt que
d'être désactivable, plutôt que d'élargir ce ticket pour combler cet écart plus général.

---

## Persistance de l'état

| État | Mécanisme | Clé |
|------|-----------|-----|
| Mode de vue (Excel / Word) | `localStorage` | `polenta:viewMode:${repoPath}` |
| Repo du workspace sélectionné (T72) | URL (TanStack Router search params) | `repo` (`/product` et `/components`) |
| `SystemNode` (repo ou composant local, imbriqué ou non — T113/T123) et type sélectionnés | URL (TanStack Router search params) | `node`/`type` (`/product`), `component`/`type` (`/components`) |
| Configuration des champs ⚙️ | Fichier `.{githubaccount}.pref` dans le repo | par vue + par type |
| Dernier repo/composant/élément consulté (T52) | `localStorage`, par projet | `polenta:lastSelection:${projectId}` |

Absence de `repo` dans l'URL (lien généré avant T72) : résolution sur le repo racine par défaut,
sans erreur.

La persistance via URL permet de partager un lien direct vers un composant/type précis.

**T52 — restauration au retour sur la vue** : quand l'URL arrive sans aucun `repo` (retour depuis
un autre panneau, redémarrage de l'app, ancien lien pré-T72), la dernière sélection valide
(repo + composant + type) est relue depuis `localStorage` et réappliquée au lieu du repo racine /
premier élément — à condition que le repo, le composant et le type existent toujours dans le
schéma courant (sinon, retour silencieux au comportement par défaut). Un lien qui précise déjà un
`repo` explicite (même sans `node`) n'est **pas** concerné : il garde son comportement de défaut
« premier élément de ce repo », la restauration ne s'applique qu'à l'entrée totalement vide sur
l'URL. La sélection restaurée est propre à chaque projet (clé indexée par `projectId`).

---

## État vide général

| Situation | Comportement |
|-----------|-------------|
| Premier chargement | Composant racine + premier type sélectionnés automatiquement |
| Composant sans type configuré | N'apparaît pas dans le combobox (aucune entrée pour ce nœud) — configurable via l'onglet Structure |
| Workspace sans aucun type configuré nulle part | Combobox désactivé, placeholder `Aucun composant configuré` |
| Recherche du combobox sans résultat | `Aucun résultat` dans la liste déroulante |
| Arbre sans élément | `Aucun élément` |
| Filtre (barre sous le combobox) sans résultat | `Aucun élément` dans l'arbre et dans la vue document |
