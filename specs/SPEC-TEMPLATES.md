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

Un `SystemNode` représente un composant du système (local). Depuis T69, les composants externes sont découverts via `polenta-repo.yaml` dans le workspace plat — les champs `url` et `branch` sur un nœud sont obsolètes et ne doivent plus être utilisés.

**Plusieurs `SystemNode` locaux par repo (T113)** : un repo peut définir plus d'un `SystemNode`
dans son `schema.yaml` — `root` (toujours présent) plus zéro ou plusieurs **sous-composants
locaux**, chacun avec ses propres `objectTypes`. Un sous-composant local vit dans le même repo
git que `root` (même historique, même commits) — il ne passe jamais par `polenta-repo.yaml`. C'est
un pattern de premier ordre, pas un cas hérité : dans l'UI, "+ Composant" (onglet Structure du
Modèle de données) propose une case "Composant local (dans ce repo)" qui, cochée, n'exige qu'un
nom (les champs URL/branche d'un composant en repo séparé sont désactivés). La question de donner
son propre repo à un composant (submodule, via `polenta-repo.yaml`) reste une décision distincte,
à la charge de l'utilisateur selon ses contraintes de gestion de configuration — les deux modes
coexistent et sont pleinement supportés (création/édition/suppression d'objets identique à `root`).

**Exposition MCP (T122)** : un agent IA peut créer un sous-composant local par le
même mécanisme via le tool `add_component` du serveur MCP (`SchemaService.addNode`,
cf. `SPEC-MCP-SERVER.md` §4.3) — strictement le pattern sous-composant local ci-dessus
(aucun repo séparé, `objectTypes: []` au départ) ; la création d'un composant en repo
séparé (submodule) reste hors de portée d'un tool MCP (geste utilisateur explicite
dans l'UI, implique clone/auth git).

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

### 3a. Repos interface (T69 Sprint 4, source unique du catalogue déplacée en T110)

Un repo interface déclare ses rôles dans son `schema.yaml` sous la clé `roles:`. Cette présence marque le repo comme interface dans l'arbre workspace (badge "Interface" violet).

```yaml
# iface-can-bus/.polenta/schema.yaml
roles:
  - name: controller
    label: Contrôleur CAN
  - name: device
    label: Périphérique CAN
```

**Édition (T110)** : ce catalogue s'édite depuis l'onglet **Structure** de `/schema`, dans la popup d'édition de n'importe quel nœud dépendance (section « Rôles exposés par ce repo ») — pas seulement ceux déjà marqués interface, pour permettre à un repo de le devenir. L'ancien onglet « Interfaces » dédié (édition séparée de `roles`/`implements`) a été supprimé ; `roles`/`implements` restent des champs du modèle de données (`ProjectSchema`), seule l'UI dédiée a disparu.

Les exigences de l'interface peuvent être taguées par rôle via un champ `multi_enum` nommé `roles` dans leur frontmatter. Ce champ source désormais ses options depuis ce catalogue (au lieu de `values:` codées en dur dans le `SchemaField`) dès que le catalogue est non vide — voir `SPEC-REQ-requirements.md` §3. Une exigence sans `roles` s'applique à tous les rôles.

### 3b. Repos composant implémenteur (T69 Sprint 4, `version` retiré en T71, édition en T110)

Un composant déclare dans son `schema.yaml` quelles interfaces il implémente et avec quels rôles :

```yaml
# comp-motor-control/.polenta/schema.yaml
implements:
  - interface: iface-can-bus    # nom de montage dans le workspace
    roles: [device]

# comp-bms/.polenta/schema.yaml
implements:
  - interface: iface-can-bus
    roles: [controller, device]   # le BMS joue les deux rôles
```

La version implémentée n'est **pas** déclarée ici : elle est dérivée du `pin` git (SHA/tag/branche) réellement épinglé pour le mount `iface-can-bus` dans l'arbre du workspace courant (voir `WorkspaceTreeNode.pin`). Deux composants du même workspace implémentant des versions différentes de la même interface passent par le mécanisme de diamond-conflict + `MountOverride` (chaque version montée sous un nom distinct) plutôt que par un champ `version` déclaré (T71).

**Édition (T110)** : deux sections dans la popup d'édition de n'importe quel nœud dépendance de l'onglet Structure — « Rôles joués par {parent} » (cases à cocher parmi le catalogue de rôles du nœud édité, plus les rôles hérités hors catalogue le cas échéant) écrit `implements[]` du **parent** ; « Interfaces implémentées » (une ligne par entrée `{interface, roles}`, cases à cocher si le catalogue de l'interface ciblée résout, sinon texte libre) écrit `implements[]` du nœud **édité lui-même** — les deux notions (jouer un rôle pour son parent, implémenter d'autres interfaces qu'on monte soi-même) sont indépendantes et peuvent coexister sur un même nœud.

Cette déclaration active la vérification de couverture par rôle et l'affichage dans la matrice de conformité.

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
| `type` | enum | `text` \| `textarea` \| `number` \| `enum` \| `multi_enum` \| `boolean` \| `date` \| `datetime` \| `richtext` \| `user` |
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
    label: "Vérifié par"
    sourceRefs: [requirement]
    targetRefs: [test]
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

---

## 5. Application d'un template

### 5.1 À la création de projet

L'utilisateur sélectionne un template dans une liste (templates fournis par Polenta + templates custom importés). Le contenu `schema` du template est copié dans `.polenta/schema.yaml` du repo git du projet.

Sans template → projet avec un seul nœud `root` vide, à configurer manuellement dans l'éditeur de modèle de données.

### 5.2 Templates custom

Un template peut être :
- **Fourni par Polenta** : inclus dans le repo Polenta (`templates/` à la racine)
- **Importé** : fichier YAML uploadé par un Admin
- **Exporté depuis un projet existant** : génère un template depuis la config courante du projet

### 5.3 Mise à jour de template

Appliquer une nouvelle version d'un template sur un projet existant est une opération **manuelle et contrôlée** :
- Polenta montre le diff entre la config actuelle et le template
- L'Admin choisit champ par champ ce qu'il fusionne
- Les exigences existantes ne sont jamais modifiées automatiquement

---

## 6. Templates fournis par Polenta

| Slug | Domaine | Normes |
|------|---------|--------|
| `electro-domestic-battery` | Électroménager sur batterie | IEC 60335, IEC 62133 |
| `generic` | Domaine générique | Aucune |

---

## 7. Scripts CI inclus dans un template

Un template peut embarquer des scripts (Python recommandé). Ces scripts opèrent directement sur les fichiers du repo git — sans passer par l'API Polenta — et sont utilisables en CI.

```yaml
# .github/workflows/polenta-check.yml
- name: Valider les exigences
  run: python scripts/check.py

- name: Générer la matrice de traçabilité
  run: python scripts/update-tree.py
```
