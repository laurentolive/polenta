# SPEC-TEMPLATES — Système de templates de projet

---

## 1. Principe

Un **template de projet** est un fichier YAML qui préconfigure complètement un projet Polenta pour un domaine métier donné. Il définit :
- les nœuds (composants locaux) et leurs types d'objets (exigences, tests, campagnes)
- les types de liens autorisés entre objets
- des exemples d'exigences optionnels (amorçage)

La séparation est stricte :
- **Polenta** = outil générique, aucune convention métier embarquée
- **Template** = toute la sémantique métier (EARS, domaines, priorités, normes…)

---

## 2. Format du template

```yaml
# templates/<slug>.yaml
name: "Nom du template"
description: "Description courte"
version: "1.0.0"
author: ""
tags: []                          # ex: embedded, medical, automotive

schema:
  version: 1
  preferences:                    # optionnel — options d'outil au niveau du projet, hors modèle métier
    autoPropagatePin: false       # T94 — propagation auto du pin sous-repo → parent au commit, sinon approbation manuelle
  nodes:
    - <SystemNode>                # voir §3
  linkTypes:
    - <LinkTypeDefinition>        # voir §4
```

---

## 3. Configuration d'un nœud et de ses types d'objets

Un `SystemNode` représente un **composant** du système. **Il n'y a qu'une seule notion de
composant** (T123) : un composant est *local* (il vit dans le `schema.yaml` du repo courant,
versionné avec lui) ou possède *son propre repo* (dépendance déclarée dans `polenta-repo.yaml`) —
c'est un simple attribut d'implémentation, pas deux catégories fonctionnelles différentes. Les deux
formes ont exactement les mêmes capacités : leurs propres `objectTypes` (exigences/tests/
campagnes), des composants imbriqués (`children`, voir plus bas), et des interfaces (`roles`/
`implements`, voir §3a-3b). Depuis T69, les composants avec repo séparé sont découverts via
`polenta-repo.yaml` dans le workspace plat — les champs `url` et `branch` sur un `SystemNode` sont
obsolètes et ne doivent plus être utilisés.

**Plusieurs composants locaux par repo (T113)** : un repo peut définir plus d'un `SystemNode` dans
son `schema.yaml` — `root` (toujours présent, lui-même un composant comme les autres) plus zéro ou
plusieurs composants locaux, chacun avec ses propres `objectTypes`. Un composant local vit dans le
même repo git que `root` (même historique, même commits) — il ne passe jamais par
`polenta-repo.yaml`. C'est un pattern de premier ordre, pas un cas hérité : dans l'UI, "+
Composant" (onglet Structure du Modèle de données) propose une case "Composant local (dans ce
repo)" qui, cochée, n'exige qu'un nom (les champs URL/branche d'un composant en repo séparé sont
désactivés). La question de donner son propre repo à un composant (submodule, via
`polenta-repo.yaml`) reste une décision distincte, à la charge de l'utilisateur selon ses
contraintes de gestion de configuration — les deux modes coexistent et sont pleinement supportés
(création/édition/suppression d'objets identique à `root`).

**Imbrication de composants locaux, profondeur non limitée (T123)** : un composant local peut lui-
même contenir d'autres composants locaux, via le champ `children?: SystemNode[]` — récursif, sans
limite de profondeur a priori. Dans l'UI, la ligne d'un composant local gagne une action
"+ Composant local" (en plus de "+ élément") qui imbrique le nouveau composant dans ses propres
`children[]`. **Un composant en repo séparé ne peut en revanche jamais être imbriqué sous un
composant local** — limite technique, pas fonctionnelle : un composant en repo séparé est un git
submodule déclaré dans `polenta-repo.yaml`, un fichier par repo, résolu au niveau du repo
lui-même, jamais au niveau d'un `SystemNode` particulier à l'intérieur d'un `schema.yaml` — seules
les lignes de repo (racine du workspace ou dépendance déclarée) peuvent porter une nouvelle
dépendance en repo séparé. Un nom de composant (`SystemNode.name`) reste unique sur l'ensemble de
l'arbre local d'un repo, quelle que soit sa profondeur d'imbrication — deux composants ne peuvent
pas partager un nom même sous des parents différents ; `objectTypeRef` continue de désigner un
composant par son seul nom (`nodeName::typeName`), jamais par un chemin.

**Collapse/expand des lignes de composant local (T131)** : dans l'onglet Structure, chaque ligne de
composant local (`LocalNodeRow`, `StructureTab.tsx`) a un chevron repliable/dépliable, comme les
lignes de repo (`RepoRow`) l'ont déjà. Cliquer sur la ligne (hors boutons d'action `+`/crayon/
corbeille) bascule l'affichage de ses éléments, de ses composants locaux imbriqués et de ses
dépendances repo-séparées imbriquées. Par défaut, tout composant local est **ouvert**, à n'importe
quelle profondeur — contrairement à `RepoRow` (`depth < 2`), pour ne masquer aucun contenu déjà
visible sans action de l'utilisateur. Cet état n'est pas persisté (redevient ouvert à chaque
remontage de l'arbre Structure), cohérent avec l'absence de persistance équivalente sur `RepoRow`
et sur l'arbre de la Vue Système (`ElementTree`, `SPEC-SYSTEM-VIEW.md` §Arbre).

```yaml
nodes:
  - name: root
    label: Produit
    readonly: false
    objectTypes: []
  - name: boitier               # composant local, frère de root
    label: Boîtier
    readonly: false
    objectTypes: []
    children:                   # composants locaux imbriqués sous "boitier" (T123)
      - name: capteurs
        label: Capteurs
        readonly: false
        objectTypes: []
```

**Combobox "Composant" (Vue Système, T120/T123)** : reste une liste à plat (T120 a volontairement
supprimé toute notion de sous-composant dans cette liste), mais le libellé d'une entrée imbriquée
devient le chemin de ses ancêtres locaux jusqu'au nœud, séparés par `›` (ex. `Boîtier › Capteurs`)
— `root` n'apparaît jamais dans ce chemin, son identité est déjà portée par le nom du repo (`groupLabel`). Voir `SPEC-SYSTEM-VIEW.md`.

**Exposition MCP (T122, `parentName` en T123)** : un agent IA peut créer un composant local par le
même mécanisme via le tool `add_component` du serveur MCP (`SchemaService.addNode`,
cf. `SPEC-MCP-SERVER.md` §4.3) — un paramètre optionnel `parentName` imbrique le nouveau composant
dans les `children[]` du composant local désigné (même repo uniquement) au lieu de l'ajouter au
niveau racine de `nodes[]`. La création d'un composant en repo séparé (submodule) reste hors de
portée d'un tool MCP (geste utilisateur explicite dans l'UI, implique clone/auth git).

```yaml
nodes:
  - name: root
    label: Produit
    readonly: false
    objectTypes:
      - name: exigence-systeme
        label: Exigence Système
        prefix: SYS              # unique sur tout le projet
        category: requirement    # requirement | test | campaign
        fields:
          - name: statement
            label: Énoncé
            type: richtext
            required: true
            validator: EARS
          - name: rationale
            label: Justification
            type: richtext
          - name: acceptanceCriteria
            label: Critères d'acceptance
            type: richtext
          - name: priority
            label: Priorité
            type: enum
            values: [high, medium, low]
            required: true
          - name: tags
            label: Tags
            type: multi_enum
            values: [safety, battery, motor, ux, performance]
          - name: diagrams
            label: Diagrammes
            type: text
        statuses:
          - name: draft
            label: Brouillon
            color: "#6b7280"
          - name: review
            label: En review
            color: "#f59e0b"
          - name: approved
            label: Approuvé
            color: "#10b981"
            isApproval: true
          - name: obsolete
            label: Obsolète
            color: "#ef4444"
            isTerminal: true    # masqué des listes par défaut
```

### 3a. Composants interface (T69 Sprint 4, catalogue en T110, porté par SystemNode depuis T123)

**`roles`/`implements` sont des champs de `SystemNode`** (T123) — `root` compris — pas de
`ProjectSchema` : n'importe quel composant, local ou avec repo séparé, imbriqué ou non, peut
exposer un catalogue de rôles et/ou implémenter une ou plusieurs interfaces. `ProjectSchema.roles`/
`.implements` (niveau racine du fichier) sont **dépréciés** — un `schema.yaml` écrit avant T123 y
porte encore ces clés, lues en repli pour le node `root` (migration transparente, jamais destructive) et tenues à jour en miroir à chaque sauvegarde tant que des lecteurs externes à `SchemaService`
en dépendent encore. Un composant qui expose des rôles est marqué "interface" dans l'arbre
Structure (badge violet) — plus seulement au niveau d'un repo entier.

```yaml
# schema.yaml d'un composant interface — root d'un repo séparé, OU un composant local quelconque
roles:
  - name: controller
    label: Contrôleur CAN
  - name: device
    label: Périphérique CAN
```

**Édition** : ce catalogue s'édite depuis l'onglet **Structure** de `/schema`, dans la popup
d'édition de n'importe quel composant — repo, dépendance, ou composant local (section « Rôles
exposés par ce composant ») — pas seulement ceux déjà marqués interface, pour permettre à un
composant de le devenir. L'ancien onglet « Interfaces » dédié a été supprimé (T110) ; `roles`/
`implements` restent des champs du modèle de données, plus jamais une UI séparée.

Les exigences de l'interface peuvent être taguées par rôle via un champ `multi_enum` nommé `roles` dans leur frontmatter. Ce champ source désormais ses options depuis ce catalogue (au lieu de `values:` codées en dur dans le `SchemaField`) dès que le catalogue est non vide — voir `SPEC-REQ-requirements.md` §3. Une exigence sans `roles` s'applique à tous les rôles.

### 3b. Composants implémenteurs (T69 Sprint 4, `version` retiré en T71, édition en T110, SystemNode T123)

Un composant déclare dans son `schema.yaml` (sur son propre `SystemNode`, T123) quelles interfaces il implémente et avec quels rôles :

```yaml
# SystemNode d'un composant implémenteur — root d'un repo séparé, OU un composant local quelconque
implements:
  - interface: iface-can-bus    # nom du composant interface (mount name de repo, OU nom d'un
                                 # composant local — unique seulement dans son propre repo, T123
                                 # §Décisions #1 : deux repos différents peuvent en théorie avoir
                                 # chacun un composant local de même nom, cas non désambiguïsé)
    roles: [device]
```

La version implémentée n'est déclarée que pour un composant en repo séparé — dérivée du `pin` git (SHA/tag/branche) réellement épinglé pour ce mount dans l'arbre du workspace courant (voir `WorkspaceTreeNode.pin`) ; sans équivalent pour un composant local (versionné avec son repo parent, pas de pin indépendant). Deux composants du même workspace implémentant des versions différentes de la même interface (repo séparé) passent par le mécanisme de diamond-conflict + `MountOverride` (chaque version montée sous un nom distinct) plutôt que par un champ `version` déclaré (T71).

**Édition** : pour un composant en repo séparé, deux sections dans la popup d'édition de n'importe quel nœud dépendance de l'onglet Structure — « Rôles joués par {parent} » (cases à cocher parmi le catalogue de rôles du nœud édité, plus les rôles hérités hors catalogue le cas échéant) écrit `implements[]` du **parent** ; « Interfaces implémentées » (une ligne par entrée `{interface, roles}`, cases à cocher si le catalogue de l'interface ciblée résout, sinon texte libre) écrit `implements[]` du nœud **édité lui-même**. Pour un composant local (T123), seule la section « Interfaces implémentées » a un sens — « Rôles joués par le parent » est spécifique à la relation de montage d'un repo séparé (le parent déclare quels rôles il joue pour CE montage précis), sans équivalent pour un composant local qui n'est jamais "monté" au sens `polenta-repo.yaml`. Les deux notions (jouer un rôle pour son parent, implémenter d'autres interfaces qu'on monte soi-même) restent indépendantes et peuvent coexister sur un même nœud.

Cette déclaration active la vérification de couverture par rôle et l'affichage dans la matrice de conformité — à la granularité du composant (`SystemNode`) depuis T123, pas seulement du repo : deux composants locaux d'un même repo implémentant chacun une interface apparaissent comme deux colonnes distinctes.

### 3.1 Attributs d'un `ObjectTypeDefinition`

| Attribut | Type | Description |
|----------|------|-------------|
| `name` | string | Identifiant unique dans le nœud (ex. `"exigence-systeme"`) |
| `label` | string | Nom affiché dans l'UI |
| `prefix` | string | Préfixe des identifiants (ex. `"SYS"`) — **unique sur tout le projet** |
| `color` | string | Couleur d'affichage (hex) |
| `category` | enum | `requirement` \| `test` \| `campaign` |
| `fields` | list | Champs personnalisés (voir §3.2) |
| `statuses` | list | Statuts configurables (voir §3.3) |

### 3.2 Définition d'un champ (`SchemaField`)

| Attribut | Type | Description |
|----------|------|-------------|
| `name` | string | Identifiant du champ (ex. `"priority"`) |
| `label` | string | Libellé affiché |
| `type` | enum | `text` \| `textarea` \| `number` \| `enum` \| `multi_enum` \| `boolean` \| `date` \| `datetime` \| `richtext` \| `user` \| `drawio` |
| `values` | list | Valeurs possibles (pour `enum` et `multi_enum` uniquement) |
| `required` | bool | Champ obligatoire à la soumission en review |
| `default` | any | Valeur par défaut à la création |
| `placeholder` | string | Texte indicatif dans le champ vide |
| `validator` | string | `EARS` ou `regex:<pattern>` — voir §3.4 |

### 3.3 Définition d'un statut (`SchemaStatus`)

| Attribut | Type | Description |
|----------|------|-------------|
| `name` | string | Identifiant du statut (ex. `"approved"`) |
| `label` | string | Libellé affiché |
| `color` | string | Couleur badge (hex) |
| `isApproval` | bool | Atteindre ce statut "valide" l'objet (utile pour la traçabilité) |
| `isTerminal` | bool | L'objet est masqué des listes par défaut (ex: obsolète, archivé) |

Toutes les transitions entre statuts sont autorisées — il n'y a pas de graphe de transitions à définir.

### 3.4 Paramètre `validator`

| Valeur | Comportement |
|--------|-------------|
| `EARS` | La première ligne non vide du champ doit correspondre à un pattern EARS valide |
| `regex:<pattern>` | Expression régulière custom |
| *(absent)* | Pas de validation syntaxique |

**Patterns EARS reconnus :**

| Pattern | Syntaxe obligatoire |
|---------|-------------------|
| Ubiquitaire | `THE <système> SHALL <action>` |
| Événementiel | `WHEN <trigger> THE <système> SHALL <action>` |
| Conditionnel | `WHILE <état> THE <système> SHALL <action>` |
| Optionnel | `WHERE <feature> THE <système> SHALL <action>` |
| Réponse indésirable | `IF <condition> THEN THE <système> SHALL <action>` |

---

## 4. Types de liens (`LinkTypeDefinition`)

```yaml
linkTypes:
  - name: derives-from
    label: "Dérive de"
    sourceRefs: [requirement]          # catégorie ou "nœud::type"
    targetRefs: [requirement]
  - name: verified-by
    label: "Vérifie"
    sourceRefs: [test]
    targetRefs: [requirement]
  - name: root::exigence-systeme--derives-from--motor-control::req-fw
    label: "Dérive de (cross-composant)"
    sourceRefs: ["root::exigence-systeme"]
    targetRefs: ["motor-control::req-fw"]
```

| Attribut | Type | Description |
|----------|------|-------------|
| `name` | string | Identifiant unique du type de lien |
| `label` | string | Libellé affiché |
| `sourceRefs` | list | Sources autorisées : catégorie (`"requirement"`, `"test"`, `"campaign"`) ou ref précise `"nœud::type"`. Absent = non contraint. |
| `targetRefs` | list | Cibles autorisées (même format). Absent = non contraint. |

**Sens d'un lien de couverture** : aucune contrainte de sens sur `sourceRefs`/`targetRefs`
— `matchCoverageLink` (voir [SPEC-TRACEABILITY.md](SPEC-TRACEABILITY.md) §2.2) apparie le
lien à sa paire test/exigence quel que soit le côté (source ou cible) sur lequel se trouve
chacun. Une contrainte antérieure imposait le test en source ; elle a été retirée pour ne
pas imposer à l'utilisateur une convention technique sans rapport avec son usage (le lien
peut être créé depuis l'éditeur du test ou celui de l'exigence indifféremment).

---

## 5. Application d'un template

**T130 — non implémenté.** Ce qui suit (§5.1-5.3) décrit un comportement **prévu**, pas l'état
actuel de l'application : il n'existe aucun channel IPC `templates:*`, aucun sélecteur de template
dans le renderer (recherche exhaustive de `template` dans `apps/desktop/src/renderer` → aucune
occurrence pertinente), et le dossier `templates/` n'existe plus (voir §6 — le seul fichier qu'il
contenait, obsolète et non consommé par aucun code, a été supprimé à T130 plutôt que réécrit).
Créer un projet (`workspace:create-new`) produit aujourd'hui systématiquement un `schema.yaml` avec
un seul nœud `root` vide — jamais pré-rempli depuis un template.

### 5.1 À la création de projet (prévu)

L'utilisateur sélectionnerait un template dans une liste (templates fournis par Polenta + templates
custom importés). Le contenu `schema` du template serait copié dans `.polenta/schema.yaml` du repo
git du projet.

Sans template → projet avec un seul nœud `root` vide, à configurer manuellement dans l'éditeur de
modèle de données — c'est le comportement réel et unique aujourd'hui, template ou non.

### 5.2 Templates custom (prévu)

Un template pourrait être :
- **Fourni par Polenta** : inclus dans le repo Polenta (`templates/` à la racine)
- **Importé** : fichier YAML uploadé par un Admin
- **Exporté depuis un projet existant** : génère un template depuis la config courante du projet

### 5.3 Mise à jour de template (prévu)

Appliquer une nouvelle version d'un template sur un projet existant serait une opération **manuelle
et contrôlée** :
- Polenta montre le diff entre la config actuelle et le template
- L'Admin choisit champ par champ ce qu'il fusionne
- Les exigences existantes ne sont jamais modifiées automatiquement

---

## 6. Templates fournis par Polenta

**T130 : aucun template fourni actuellement.** L'unique fichier qu'a jamais contenu `templates/`
(`electro-domestic-battery.yaml`) utilisait un format entièrement obsolète (`requirementTypes`,
`ComponentDefinition`, `transitions` — voir historique du ticket T130) et n'était de toute façon
consommé par aucun mécanisme d'application de template (§5) : supprimé plutôt que réécrit, faute
d'utilité tant que §5 reste à construire. Le `generic` autrefois référencé dans cette table n'a
jamais existé comme fichier.

---

## 7. Scripts CI inclus dans un template

Un template peut embarquer des scripts (Python recommandé). Ces scripts opèrent directement sur les fichiers du repo git — sans passer par l'API Polenta — et sont utilisables en CI.

```yaml
# .github/workflows/polenta-check.yml
- name: Valider les exigences
  run: python scripts/check.py

- name: Exporter un rapport PDF/HTML
  run: python scripts/export.py
```

**T130 :** l'exemple précédent référençait `scripts/update-tree.py`, qui évoquait l'ancien
mécanisme `tree.yaml` unique, remplacé par `.polenta/trees/<nœud>/<type>.yaml` maintenu par
l'application elle-même (voir `SPEC-ELECTRON-DESKTOP.md` §22.2), jamais par un script
de repo projet.
