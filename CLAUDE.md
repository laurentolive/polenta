# CLAUDE.md — Système de spécification assisté par IA
# Projet : Produits électroménager sur batterie

### Workflow de developpement 
Les demandes de correction ou d'évolution passent par une **issue GitHub** (repo `laurentolive/polenta`,
CLI `gh`) — `TICKETS.md` n'est plus utilisé.
Pour toute correction de bug ou évolution suivre WORKFLOW.md (méthode de travail, niveaux de
vérification — **la suite e2e complète ne se lance qu'au merge sur `main`, après le « Validé » de
l'humain et juste avant le push**).

Leçons tirées des corrections, à appliquer dès le début de session :

@tasks/lessons.md

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

Un projet Polenta peut être un **repo produit autonome** ou un **repo produit avec composants réutilisables**,
chacun dans son propre repo git. Dans tous les cas, le repo produit est la source de vérité de l'arbre de traçabilité complet.

**Les composants ne sont pas des submodules git** (abandonnés en T69, #333) : Polenta clone lui-même chaque
repo **à plat**, côte à côte, dans le dossier du workspace. Chaque repo déclare ses dépendances directes
(`name`, `url`, `pin` = branche, tag ou commit, `localParent` facultatif) dans `polenta-repo.yaml` à sa racine ;
Polenta reconstruit l'arbre complet en parcourant ces fichiers. Pas de `.gitmodules`, pas de dossier
`components/`, et pas de git CLI requis chez le client.

### Workspace (dossier choisi à la création, hors de tout repo)

```
workspace/
├── .polenta/                        ← marqueur du workspace, NON versionné
│   ├── workspace.yaml               ← repo racine (rootRepo), noms de montage en cas de conflit
│   └── tree.cache.yaml              ← arbre calculé, régénéré à l'ouverture
├── product-aspirateur-v1/           ← repo produit (racine)
├── comp-motor-control/              ← cloné par Polenta (dépendance du produit)
├── comp-bms/
└── iface-can-bus/                   ← interface (dépendance de comp-motor-control)
```

### Repo produit (avec composants)

```
product-aspirateur-v1/               ← repo produit principal
├── polenta-repo.yaml                ← dépendances directes : name, url, pin (branche/tag/commit), localParent
├── requirements/
│   └── SYS/                         ← exigences système propres au produit
├── tests/
│   └── SYS/
├── links/
│   └── links.yaml                   ← tous les ObjectLink du projet (un seul fichier)
├── scripts/
│   ├── check.py                     ← lint des exigences/tests
│   └── export.py                    ← export PDF/HTML
└── .polenta/
    ├── schema.yaml                   ← modèle de données du repo (nodes + objectTypes + linkTypes)
    ├── tombstones/                   ← un fichier vide par ID supprimé physiquement (GH20), jamais supprimé
    ├── views/<nœud>/<type>.yaml      ← vues enregistrées d'équipe du ⚙️ (GH203), maintenu par l'app — ne pas éditer à la main
    └── trees/
        └── root/
            ├── exigence-systeme.yaml ← rangement curaté des SYS (un fichier par type d'objet ; objets absents = non classés)
            └── ...                   ← généré/maintenu par l'app, jamais par un script — ne pas éditer à la main
```

### Repo composant autonome

```
comp-motor-control/
├── polenta-repo.yaml                ← seulement s'il a lui-même des dépendances (ex. une interface)
├── .polenta/
│   └── schema.yaml                  ← schéma propre au composant (autonome)
├── requirements/
│   ├── functional/                  ← REQ-MC-001.yaml, REQ-MC-002.yaml…
│   └── sw/                          ← REQ-MC-SW-001.yaml…
└── tests/
    └── TEST-MC-001.yaml
```

### Repo produit sans composants (projet simple)

```
specs/
├── CLAUDE.md                        ← ce fichier
├── CONTEXT.md                       ← historique des décisions de conception
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
├── versions/                        ← versions du composant (GH201), une par fichier : versions/<ID>.yaml
├── issues/                          ← issues du composant (GH244), une par fichier : issues/<ID>.yaml
├── validations/                     ← validations d'une version (GH204), une par fichier : validations/<ID>.yaml
├── links/
│   └── links.yaml                   ← tous les ObjectLink du projet
├── parameters/
│   └── parameters.yaml              ← base de paramètres du repo (T171), clés triées
├── .polenta/
│   ├── workspace.yaml
│   ├── schema.yaml
│   ├── tombstones/                  ← IDs supprimés physiquement (GH20), un fichier vide par ID
│   └── trees/                       ← un fichier par (nœud, type d'objet), maintenu par l'app
└── scripts/
    ├── check.py
    └── export.py
```

---

## Modèle de données (`.polenta/schema.yaml`)

```yaml
version: 1

preferences:
  autoPropagatePin: false   # si true, le pin (branche/tag/commit) d'une dépendance est mis à jour automatiquement dans le polenta-repo.yaml du repo parent dès que le repo du composant reçoit un commit ; si false, la mise à jour attend une approbation manuelle de l'intégrateur

nodes:
  - name: root               # le repo lui-même
    label: Produit
    readonly: false
    objectTypes:
      - name: exigence-systeme
        label: Exigence Système
        prefix: SYS           # doit être unique sur tout le projet
        category: requirement # requirement | test | campaign | version | issue | validation
        fields:
          - name: priority
            label: Priorité
            type: enum
            values: [high, medium, low]
            required: true
            trackHistory: true  # GH77 — historiser ce champ (history.priority) ; absent = non suivi
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
        # trackStatusHistory: false   # GH77 — statut historisé par défaut (history.status) ; écrit seulement pour le désactiver

    children:                # composants locaux (T123), dans ce même repo, profondeur non limitée
      - name: firmware-moteur
        label: Firmware moteur
        readonly: false
        objectTypes: []      # ses propres types (objectTypeRef firmware-moteur::<type>)

  # Composant en repo séparé : déclaré dans polenta-repo.yaml (url, pin), avec son propre
  # .polenta/schema.yaml. Un nœud n'a jamais d'`url` ni de `branch`. Facultatif : un nœud portant
  # le NOM DE MONTAGE de la dépendance règle son accès depuis ce repo.
  - name: comp-motor-control # = name de la dépendance dans polenta-repo.yaml
    label: Contrôle moteur
    readonly: true           # composant en lecture seule depuis le produit
    # objectTypes absent → le schéma du composant fait foi

linkTypes:
  - name: implementation
    labelSourceToTarget: "est implémenté par"      # label affiché quand l'objet est SOURCE du lien
    labelTargetToSource: "implémente"   # label affiché quand l'objet est CIBLE du lien
    sourceRefs: [requirement]             # catégorie ou "composant::type"
    targetRefs: [requirement]
  - name: verification
    labelSourceToTarget: "vérifie"
    labelTargetToSource: "est vérifiée par"
    sourceRefs: [test]
    targetRefs: [requirement]
```

**Sens d'un lien de couverture test ↔ exigence** : le moteur de traçabilité
(`matchCoverageLink` dans `traceability.service.ts`) apparie un lien à sa paire
test/exigence **quel que soit le sens dans lequel il a été créé** — `sourceId`/`targetId`
peuvent être le test ou l'exigence indifféremment. Ce n'a pas toujours été le cas : une
contrainte antérieure imposait `sourceId: <TEST-ID>` / `targetId: <REQ-ID>` sous peine de
voir l'exigence apparaître `not_covered` sans erreur visible ; elle a été retirée
volontairement (l'utilisateur crée le lien depuis l'éditeur du test ou celui de
l'exigence, selon ce qui lui semble naturel, et n'a pas à connaître cette contrainte
technique). Aucune convention de sens à respecter, donc, pour ce type de lien.

**Préférences projet** (`preferences: {}`) : options globales au niveau du projet, indépendantes des `nodes`/`objectTypes`/`linkTypes`. Portent sur le comportement de l'outil plutôt que sur le modèle de données métier. Ex. `autoPropagatePin` — case à cocher qui contrôle si la mise à jour du `pin` d'une dépendance dans le `polenta-repo.yaml` du repo parent, suite à un commit reçu sur le repo du composant, se fait automatiquement ou attend une approbation manuelle de l'intégrateur.

---

## Convention des IDs

| Préfixe | Domaine              |
|---------|----------------------|
| SYS-XXX | Système              |
| SW-XXX  | Firmware/Logiciel    |
| HW-XXX  | Électronique         |
| MECA-XXX| Mécanique            |
| PRD-XXX | Produit              |

Les IDs sont séquentiels et ne sont jamais réutilisés (même si obsolète). Il n'y a pas de
compteur persistant : le prochain numéro d'un préfixe est déduit des fichiers présents et des
pierres tombales `.polenta/tombstones/<ID>` que l'application pose à chaque suppression
physique (GH20).
Le préfixe correspond à `ObjectTypeDefinition.prefix` dans le schéma.

---

## Format d'une exigence (fichier YAML pur — pas de frontmatter, pas de corps Markdown)

Une exigence est un fichier `requirements/<ID>.yaml` — YAML de bout en bout, sans
délimiteurs `---` et sans section Markdown libre en dessous. Le texte long (énoncé,
justification, critères d'acceptance…) vit dans des champs de `fields:`, typiquement
`richtext`.

```yaml
# requirements/SYS-0001.yaml
id: SYS-0001
projectId: ''
branchId: ''
objectTypeRef: root::exigence-systeme   # <nœud>::<type-objet>
title: Démarrage rapide en mode Eco
status: draft                           # valeur parmi les statuts définis dans le type
version: 1
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
jiraLinks: []
```

Un cas de test suit le même principe (`tests/<ID>.yaml`), avec en plus `preconditions`,
`equipment`, `steps: [{order, action, expectedResult, notes}]`, `postconditions`.

**Champs système fixes** (non configurables) : `id`, `projectId`, `branchId`, `objectTypeRef`, `title`, `status`, `version`, `jiraLinks`, `needsRevalidation` (T172 — écrit uniquement quand vrai : un élément lié a quitté l'approbation, impact à vérifier ; posé par l'application, jamais à la main), `history` (GH77 — historique des champs suivis, une liste par champ : `status` et les champs `trackHistory: true`, entrées `{ value?, at, by, source? }` ; absent tant que vide ; posé par l'application, jamais à la main — y compris dans les campagnes, mais jamais dans une copie `testSnapshot`)
**Champs propres aux versions, issues et validations** (milestone D, posés par l'application, SPEC-REQ §11–§13) :
version (`versions/<ID>.yaml`) — `basedOn`, `components`, `freeze` (`tag`, `sha`, `at`, posé au passage released),
`changes` (`id`, `base`), `impacted`, `analysis` ; issue (`issues/<ID>.yaml`) — `origin` (`runs`, `decisions`) ;
validation (`validations/<ID>.yaml`) — `versionId`, `entries` (une par exigence : `requirementId`, `decision`,
`comment`, `contentHash`, `atSignature`…). Une version released et une validation signée sont figées.
**Champs personnalisés** : tout dans `fields: {}`, définis par le type dans `schema.yaml`
**Liens entre objets** : via `ObjectLink`, dans un fichier séparé `links/links.yaml` (pas dans le fichier de l'exigence) — voir §"Sens d'un lien de couverture test ↔ exigence" plus haut
**Dates de création / modification** (GH340 — exigences, tests, issues) : `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, stockées dans le YAML, posées par l'application (création ; modification seulement si le contenu hors clés de l'application change), jamais à la main ; absentes tant que non reprises (mise en conformité), jamais lues dans git ni écrites à `null`, jamais dans une copie `testSnapshot`

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
6. Pas d'élément `needsRevalidation: true` laissé sans analyse d'impact (le flag est porté par les exigences/tests, plus par les liens — T172)
7. Un repo de composant est autonome : son `schema.yaml` décrit ses propres types, et il ne connaît que ses
   dépendances directes (`polenta-repo.yaml`), jamais ses parents
8. `objectTypeRef` = `<nœud>::<type>`, où le nœud est un nœud du schéma du repo (`root`, composant local :
   `firmware-moteur::exigence-fw-moteur`) ou, en mode workspace, le **nom de montage** d'un composant en repo
   séparé (`name` de sa dépendance dans `polenta-repo.yaml`) — l'objet est alors rangé dans le repo de ce
   composant et son type lu dans le schéma du composant (`SchemaService.resolveComponentRepoPath`)
9. `.polenta/trees/<nœud>/<type>.yaml` est maintenu par l'application — ne jamais l'éditer à la main en dehors d'un projet d'exemple/fixture.
   Il ne contient que le rangement curaté (GH180) : un objet absent est affiché « non classé » en fin de liste, et un élément
   ne porte pas de `name` (le libellé est le `title` de l'objet) — créer un objet n'écrit pas ce fichier
10. `prefix` est unique sur l'ensemble du projet (tous nœuds confondus)
11. Une référence de paramètre `{nom}` / `{<nœud>::nom}` (T171) vise un paramètre existant de
    `parameters/parameters.yaml` (repo de l'élément, ou composant déclaré dans `polenta-repo.yaml`) ;
    une référence locale absente de la base est saisie à la main en campagne, toute autre reste
    littérale — ne pas supprimer un paramètre encore utilisé
12. La valeur courante d'un champ suivi (statut, champ `trackHistory: true`) est la dernière entrée
    de son `history` (GH77). Un écart (YAML modifié à la main, ancienne version de l'app, `git revert`)
    apparaît à la lecture comme une entrée « déduite » (`implicit: true`) et est comblé à la
    prochaine écriture par l'application — ne pas le corriger à la main

---

## Principe données brutes / indicateurs projet (GH79)

Polenta expose les **données brutes** du modèle (objets, champs, liens, campagnes → entrées →
runs, historique) et ne calcule un indicateur **que s'il sert à une de ses propres fonctions**
(couverture test ↔ exigence, `needsRevalidation`, approbation `isApproval`, validation EARS /
champs remplis, resynchronisation des copies de campagne). Tout indicateur **de suivi**
(maturité, étapes d'avancement, état d'une campagne à une date, dernier résultat…) vit **côté
projet** : scripts et bibliothèque dans le repo du client, contenu de départ modifiable — jamais
du code de Polenta. Les écrans de Polenta l'affichent via un mécanisme générique, pas du code dédié.

**Règle de décision** pour tout nouvel indicateur : *sert-il à une fonction de Polenta ?* Oui →
calculé dans Polenta ; non → script côté projet. Détail : `specs/SPEC-TECH-stack.md` §1.1.

---

## Délégation aux subagents (contexte et coûts)

Utiliser largement les subagents pour garder le contexte principal léger : recherche, exploration,
analyses parallèles, exécution de tests — une tâche par subagent. Le modèle se choisit comme suit.

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
1. Lire les exigences/tests qui le référencent avant toute modification
2. Après modification, vérifier que ces références (`champ diagrams` ou bloc `drawio` dans un `richtext`) restent valides
3. Si des nodes sont supprimés, vérifier les références `#node-id` dans les fichiers qui les utilisent

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
- Ne pas modifier un `.drawio` sans lire les exigences/tests qui le référencent
- Ne pas réutiliser un ID même si l'exigence est `obsolete`
- Ne pas écrire ni corriger le champ `history` d'un objet à la main (GH77) — l'application l'alimente à chaque écriture
- Ne pas écrire ni corriger `createdAt` / `createdBy` / `updatedAt` / `updatedBy` à la main (GH340) — même règle
- Ne pas supprimer une pierre tombale `.polenta/tombstones/<ID>`, ni supprimer à la main le fichier d'un objet (passer par l'application, qui pose la pierre tombale)
- Ne pas éditer `.polenta/trees/<nœud>/<type>.yaml` manuellement dans un vrai projet — c'est l'application qui le maintient au fil des actions dans l'UI, pas un script
- Ne pas éditer `.polenta/views/<nœud>/<type>.yaml` à la main (GH203) : même règle ; un fichier invalide bloque toutes les vues d'équipe du type
- **Ne pas traiter les composants comme des submodules git** (#333) : pas de `.gitmodules`, pas de `git submodule`,
  pas de `url` dans un nœud de `schema.yaml` ; un composant en repo séparé se déclare dans `polenta-repo.yaml`
  (par l'application : ajout de repo, pin) et Polenta le clone à plat dans le workspace

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
