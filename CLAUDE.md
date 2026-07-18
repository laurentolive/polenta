# CLAUDE.md — Système de spécification assisté par IA
# Projet : Produits électroménager sur batterie

### Workflow de developpement 
Le demande de correction ou d'evolution passe par un ticket décrit dans TICKETS.md.
Pour toute correction de bug ou évolution suivre WORKFLOW.md. 

## Contexte produit

Ce projet gère les spécifications d'un produit électroménager sur batterie
(ex: aspirateur sans fil). C'est un système multi-domaines avec interfaces fortes entre :
- **Firmware (SW)** — modes de fonctionnement, FSM, watchdog sécurité
- **Électronique (HW)** — BMS, driver moteur, gestion de puissance
- **Mécanique (MECA)** — turbine, filtration, ergonomie
- **Batterie (BAT)** — cellules, charge, thermique
- **Système (SYS)** — chef d'orchestre, exigences transverses
- **Produit (PROD)** — UX, marketing, expérience utilisateur

---

## Structure du projet

Un projet Polenta peut être un **repo produit autonome** ou un **repo produit avec composants réutilisables** (git submodules). Dans tous les cas, le repo produit est la source de vérité de l'arbre de traçabilité complet.

### Repo produit (avec composants)

```
product-aspirateur-v1/               ← repo produit principal
├── .gitmodules                      ← déclare les submodules composants (GÉNÉRÉ)
├── components/
│   ├── motor-control/               ← submodule (repo composant autonome)
│   ├── bms/                         ← submodule
│   └── filtration/                  ← submodule
├── requirements/
│   └── SYS/                         ← exigences système propres au produit
├── tests/
│   └── SYS/
├── tree.yaml                        ← arbre de traçabilité complet (GÉNÉRÉ — ne pas éditer)
├── scripts/
│   ├── check.py                     ← lint des frontmatters
│   ├── update-tree.py               ← régénère tree.yaml (appelé par le hook pre-commit)
│   └── export.py                    ← export PDF/HTML
└── .polenta/
    └── schema.yaml                  ← modèle de données du projet (nodes + objectTypes + linkTypes)
```

### Repo composant autonome

```
comp-motor-control/
├── .polenta/
│   └── schema.yaml                  ← schéma propre au composant (autonome)
├── requirements/
│   ├── functional/                  ← REQ-MC-001, REQ-MC-002…
│   └── sw/                          ← REQ-MC-SW-001…
└── tests/
    └── TEST-MC-001.md
```

### Repo produit sans composants (projet simple)

```
specs/
├── CLAUDE.md                        ← ce fichier
├── CONTEXT.md                       ← historique des décisions de conception
├── TICKETS.md                       ← liste des tickets a traiter et leur status
├── WORKFLOW.md                      ← decrit le process de dev entre les agents AI et le developpeur humain
├── requirements/
│   ├── SYS/
│   ├── SW/
│   ├── HW/
│   ├── MECA/
│   ├── BAT/
│   └── PROD/
├── diagrams/
│   ├── system-context.drawio
│   ├── power-block.drawio
│   ├── fw-state-machine.drawio
│   ├── bms-block.drawio
│   └── meca-assembly.drawio
├── tests/
│   ├── SYS/
│   ├── SW/
│   ├── HW/
│   └── integration/
├── tree.yaml                        ← généré automatiquement par update-tree.py
└── scripts/
    ├── check.py
    ├── update-tree.py
    └── export.py
```

---

## Modèle de données (`.polenta/schema.yaml`)

```yaml
version: 1

preferences:
  autoPropagatePin: false   # si true, le pin (branche/tag/commit) est propagé automatiquement dans le manifeste du repo parent dès qu'un sous-repo (submodule) reçoit un commit ; si false, la propagation attend une approbation manuelle de l'intégrateur

nodes:
  - name: root               # nœud local (pas de url) = composant propre au repo produit
    label: Produit
    readonly: false
    objectTypes:
      - name: exigence-systeme
        label: Exigence Système
        prefix: SYS           # doit être unique sur tout le projet
        category: requirement # requirement | test | campaign
        fields:
          - name: priority
            label: Priorité
            type: enum
            values: [high, medium, low]
            required: true
          - name: statement
            label: Énoncé
            type: richtext
            validator: EARS
            required: true
        statuses:
          - name: draft
            label: Brouillon
          - name: review
            label: En review
          - name: approved
            label: Approuvé
            isApproval: true
          - name: obsolete
            label: Obsolète
            isTerminal: true   # masqué des listes par défaut

  - name: motor-control      # nœud submodule (url présente) = repo git externe
    label: Contrôle moteur
    url: git@github.com:org/motor-control.git
    branch: main
    readonly: true
    # objectTypes absent → le schéma du composant fait foi

linkTypes:
  - name: implementation
    labelSourceToTarget: "est implémenté par"      # label affiché quand l'objet est SOURCE du lien
    labelTargetToSource: "implémente"   # label affiché quand l'objet est CIBLE du lien
    sourceRefs: [requirement]             # catégorie ou "composant::type"
    targetRefs: [requirement]
  - name: verification
    labelSourceToTarget: "est vérifié par"
    labelTargetToSource: "vérifie"
    sourceRefs: [requirement]
    targetRefs: [test]
```

**Préférences projet** (`preferences: {}`) : options globales au niveau du projet, indépendantes des `nodes`/`objectTypes`/`linkTypes`. Portent sur le comportement de l'outil plutôt que sur le modèle de données métier. Ex. `autoPropagatePin` — case à cocher qui contrôle si la mise à jour du `pin` d'un sous-repo (submodule) dans le manifeste du repo parent, suite à un commit reçu sur ce sous-repo, se fait automatiquement ou attend une approbation manuelle de l'intégrateur.

---

## Convention des IDs

| Préfixe | Domaine              |
|---------|----------------------|
| SYS-XXX | Système              |
| SW-XXX  | Firmware/Logiciel    |
| HW-XXX  | Électronique         |
| MECA-XXX| Mécanique            |
| PRD-XXX | Produit              |

Les IDs sont séquentiels et ne sont jamais réutilisés (même si obsolète).
Le préfixe correspond à `ObjectTypeDefinition.prefix` dans le schéma.

---

## Format d'une exigence (frontmatter YAML + corps Markdown)

```markdown
---
id: SYS-001
objectTypeRef: root::exigence-systeme   # <nœud>::<type-objet>
status: draft                           # valeur parmi les statuts définis dans le type
fields:
  priority: high
  statement: |
    WHEN the user presses the power button
    THE system SHALL start in Eco mode within 500 ms
  rationale: "Retour terrain : démarrage lent = perception basse qualité"
  acceptanceCriteria: |
    - [ ] Démarrage mesuré < 500 ms à 25°C, batterie > 20%
    - [ ] LED Eco allumée dans les 500 ms
  diagrams:
    - diagrams/system-context.drawio#node-SYS-001
  tags: [startup, performance]
---

## Notes libres

Contraintes d'implémentation, risques, alternatives...
```

**Champs système fixes** (non configurables) : `id`, `objectTypeRef`, `status`
**Champs personnalisés** : tout dans `fields: {}`, définis par le type dans `schema.yaml`
**Liens entre objets** : via ObjectLink (mécanisme séparé du frontmatter, géré par Polenta)

---

## Syntaxe EARS obligatoire pour les énoncés

Utiliser systématiquement l'un des patterns suivants :

```
# Ubiquitaire
THE <système> SHALL <action>

# Événementiel
WHEN <trigger>
THE <système> SHALL <action>

# Conditionnel
WHILE <état système>
THE <système> SHALL <action>

# Optionnel (feature)
WHERE <feature est activée>
THE <système> SHALL <action>

# Réponse indésirable
IF <condition anormale>
THEN THE <système> SHALL <action>
```

---

## Règles de cohérence — à vérifier systématiquement

1. Tout `SHALL` a au moins un critère d'acceptance mesurable
2. Tout fichier `.drawio` référencé pointe vers un `#node-id` précis
3. Toute exigence `approved` a au moins un lien vers un cas de test
4. Le champ `objectTypeRef` référence un type existant dans `schema.yaml`
5. Les exigences à caractère sécurité ont `priority: high` dans leurs champs
6. Pas de liens `needsRevalidation: true` laissés sans traitement
7. **Dans un repo composant** : `schema.yaml` ne déclare pas de `url` sur ses propres nœuds — un composant est autonome
8. **Dans un repo produit** : les `objectTypeRef` cross-composant utilisent le nom du nœud submodule (ex: `motor-control::exigence-fw`)
9. `tree.yaml` est toujours généré — ne jamais l'éditer à la main (utiliser `scripts/update-tree.py`)
10. `prefix` est unique sur l'ensemble du projet (tous nœuds confondus)

---

## Délégation aux subagents (maîtrise des coûts)

Pour toute tâche **simple et mécanique** — recherche/grep sur plusieurs fichiers, lecture de statut, copie de fichiers, exécution d'un build/typecheck avec rapport des erreurs, vérification ponctuelle — déléguer via l'outil Agent en passant `model: "haiku"`, plutôt que d'exécuter la tâche directement dans la session principale (modèle haute performance) ou de laisser un subagent hériter de ce modèle par défaut.

Réserver le modèle par défaut (hérité, ex. Sonnet) aux tâches qui demandent un vrai jugement : édition de code non triviale, résolution de conflits, décisions de conception/architecture, rédaction ou révision d'exigences EARS.

Ne pas déléguer un aller-retour trivial d'un seul appel d'outil — le coût de démarrage du subagent dépasserait l'économie réalisée ; dans ce cas, exécuter directement.

Ne pas définir la variable d'environnement `CLAUDE_CODE_SUBAGENT_MODEL` : elle forcerait le même modèle pour tous les subagents et empêcherait ce choix au cas par cas selon la complexité de la tâche.

---


## Workflow standard

### Créer une nouvelle exigence
1. Lire les exigences parentes candidates avant de créer
2. Vérifier qu'il n'existe pas déjà une exigence couvrant le même besoin
3. Choisir l'`objectTypeRef` adapté dans `schema.yaml`
4. Rédiger l'énoncé du champ `statement` en EARS
5. Créer les ObjectLinks vers les exigences parentes et les tests

### Modifier un diagramme `.drawio`
1. Lire le `.md` associé avant toute modification
2. Après modification, mettre à jour les `.md` qui référencent ce diagramme
3. Si des nodes sont supprimés, vérifier les références dans les frontmatters

### Passer une exigence en statut `review`
- Tous les champs `required: true` du type sont remplis
- L'énoncé passe la validation EARS
- Au moins un critère d'acceptance existe

### Passer une exigence en statut `approved`
- Statut `review` validé par un humain
- Au moins un ObjectLink vers un cas de test
- Pas de contradiction avec les exigences liées

---

## Ce que tu ne dois PAS faire

- Ne pas inventer des IDs sans vérifier qu'ils n'existent pas déjà dans le repo
- Ne pas marquer `approved` sans lien vers un cas de test
- Ne pas créer d'exigence sans syntaxe EARS dans le champ `statement`
- Ne pas modifier un `.drawio` sans lire le `.md` associé
- Ne pas réutiliser un ID même si l'exigence est `obsolete`
- Ne pas régénérer `tree.yaml` manuellement — utiliser `scripts/update-tree.py`
- **Ne pas éditer `.gitmodules` manuellement** — il est généré par Polenta depuis `schema.nodes` (nœuds avec `url`) via `schema:save`
- **Ne pas ajouter de `url` dans `schema.yaml` d'un repo composant** — un composant ne se référence pas lui-même comme submodule
- **Ne pas utiliser de `objectTypeRef` cross-composant dans un repo composant** — uniquement dans le repo produit

---

## Domaines métier prioritaires pour ce type de produit

### Sécurité batterie (critique)
- Surcharge / sur-décharge cellules
- Surintensité moteur
- Température pack batterie (charge et décharge)
- Détection court-circuit

### Modes firmware (central)
- Standby / Veille
- Démarrage
- Modes aspiration (Eco / Normal / Turbo)
- Charge
- Défaut / Safe state

### Performance
- Autonomie par mode
- Temps de charge
- Débit d'air / dépression
- Niveau sonore

### Normes à considérer
- IEC 60335-1 / 60335-2-2 (sécurité électroménager)
- IEC 62133 (sécurité batteries Li-ion)
- EN 55014 (compatibilité électromagnétique)
