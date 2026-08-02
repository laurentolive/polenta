# SPEC-REVIEWS — Module Reviews

> Référence parent : [SPEC.md](../SPEC.md) §2.6  
> Dépend de : [SPEC-REQ-requirements.md](SPEC-REQ-requirements.md), [SPEC-TESTS.md](SPEC-TESTS.md)

> **T130 — état d'implémentation réel** (`packages/types/src/review.ts`,
> `apps/desktop/src/main/services/reviews.service.ts`) : implémentés — création de review
> (`create`), lecture (`findById`/`list`), approbation/révocation par objet (`approveObject`/
> `revokeObject`), clôture (`close`) ; channels IPC `reviews:list/get/create/approve-object/
> revoke-approval/close`. **Non implémentés** — `milestoneTag` (§2.6), les commentaires de review
> (§3.3-3.4, types `ReviewComment`/`ReviewCommentReply` définis mais aucune méthode de service ni
> stockage), et l'index mémoire dédié `ReviewsIndexService` (§6). Ces sections décrivent un
> comportement prévu, pas l'état actuel — marquées individuellement ci-dessous.

---

## 1. Vue d'ensemble

Une **review** est une session de validation collaborative portant sur un ou plusieurs objets (exigences, cas de test). Elle permet de recueillir des approbations de relecteurs avant qu'un objet puisse transitionner vers un statut approuvé.

### 1.1 Philosophie de conception

| Principe | Détail |
|----------|--------|
| **Pas de refus formel** | Un relecteur peut uniquement approuver ou commenter. Pas de bouton "Refuser" ni "Demander des modifications". Les réserves s'expriment uniquement par commentaire. |
| **Pas de blocage autoritaire** | Le créateur de la review reste maître de la décision finale. Un relecteur qui a des doutes commente — le créateur décide comment y répondre. |
| **Granularité par objet** | Dans une review multi-objets, chaque objet a son propre statut d'approbation indépendant. |
| **Légèreté volontaire** | L'objectif est de favoriser la collaboration, pas de créer des processus conflictuels. |

### 1.2 Objets reviewables

- Exigences (`Requirement`)
- Cas de test (`TestCase`)

---

## 2. Création d'une review

### 2.1 Trois modes de sélection des objets

#### Mode A — Objet unique
Depuis la fiche d'un objet : bouton **"Soumettre en review"**. Crée une review portant sur cet objet seul.

#### Mode B — Sélection multiple
Depuis une liste ou la matrice de traçabilité : cochage de plusieurs objets → **"Soumettre la sélection en review"**. Les objets peuvent être de types mixtes (exigences + tests).

#### Mode C — Groupe hiérarchique
Depuis l'arbre des exigences : clic droit sur un nœud → **"Soumettre ce groupe en review"**. Inclut automatiquement tous les descendants approuvés (brouillons exclus) du nœud sélectionné.

```
SYS-0001  ← nœud sélectionné
  ├── SW-0042  ✓ inclus (approuvé)
  ├── SW-0043  ✓ inclus (approuvé)
  ├── SW-0044  ✗ exclu (brouillon en cours)
  └── HW-0010  ✓ inclus (approuvé)
```

Une **présélection** est affichée avant confirmation : liste des objets inclus, exclus et la raison d'exclusion (brouillon, archivé, déjà en review active).

### 2.2 Attributs d'une review

| Attribut | Type | Description |
|----------|------|-------------|
| `id` | string | Ex. `REVIEW-0001` |
| `title` | TEXT | Titre de la review (ex. "Validation exigences BAT v1.0") |
| `description` | RICHTEXT | Contexte, objectif de la review |
| `status` | ENUM | `open` / `approved` / `closed` |
| `createdBy` | USER | Créateur (auteur / admin) |
| `createdAt` | DATETIME | — |
| `dueDate` | DATE | Échéance optionnelle |
| `reviewers` | list | Utilisateurs assignés comme relecteurs |
| `quorum` | int \| null | Nombre d'approbations requises par objet (null = unanimité) |
| `objects` | list | Objets soumis à review (sélection manuelle à la création, voir §2.3) |

### 2.3 Objet dans une review (ReviewObject)

| Attribut | Type | Description |
|----------|------|-------------|
| `objectId` | string | ID de l'exigence ou du test case |
| `objectType` | ENUM | `requirement` / `test_case` |
| `objectVersion` | int | Version soumise à review (figée à la création) — T130 : bien accepté en entrée (`CreateReviewDto`) et écrit dans le YAML persisté (`reviews.service.ts` `create()`), mais absent de l'interface TypeScript `ReviewObject` (`packages/types/src/review.ts`) — écart de typage, pas de comportement |
| `approvals` | list | Une entrée par relecteur ayant approuvé (voir §3.2) |
| `approvalStatus` | ENUM | `pending` / `quorum_reached` / `unanimous` (calculé) |

### 2.4 Assignation des relecteurs

Les relecteurs sont assignés **à la review** (pas objet par objet). Ils reçoivent une notification et ont accès à tous les objets de la review.

Possibilités d'assignation :
- **Utilisateurs individuels** — sélecteur depuis la liste des membres du projet
- **Rôle** — tous les utilisateurs ayant un rôle donné (ex. `SAFETY_OFFICER`) sont ajoutés

Des relecteurs peuvent être ajoutés après l'ouverture de la review (sans invalider les approbations existantes).

### 2.5 Lien avec le workflow des objets

Quand une transition de statut a `requiresReview: true` dans sa configuration :
- Polenta vérifie qu'il existe une review `approved` couvrant cet objet avant d'autoriser la transition
- La review doit couvrir la **version courante** de l'objet
- Une review sur une version antérieure ne compte pas

```
Exigence SW-0042 v1
  └── Review REVIEW-0001 → approved  ✓ transition autorisée vers "Approuvé"

Exigence SW-0042 (brouillon ouvert = v2 en cours)
  └── Review REVIEW-0001 couvre v1   ✗ une nouvelle review doit être créée pour v2
```

### 2.6 Lien avec les jalons (baselines)

**T130 : `milestoneTag` n'existe pas.** Absent de l'interface `Review` réelle
(`packages/types/src/review.ts`) et de `CreateReviewDto` (`reviews.service.ts`) — aucun champ
n'accepte ni ne persiste de lien vers un tag de jalon. Tout ce qui suit dans cette sous-section
décrit un comportement prévu, non implémenté.

La review est **découplée des branches git**. Elle s'attache aux objets (exigences, tests) et s'inscrit dans le cycle de vie des jalons projet :

```
Jalon PDR (Preliminary Design Review)
  │
  ├── Créer une review "Validation exigences SYS v1.0"
  │     objects: [SYS-001, SYS-002, SW-042, ...]  ← sélectionnés manuellement
  │     milestoneTag: "baseline/v1.0-PDR"         ← optionnel, lien informatif
  │
  ├── Relecteurs approuvent les objets
  │
  ├── Créateur clôture → review.status = 'approved'
  │     → déverrouille les transitions "draft → approved" sur les objets couverts
  │
  └── Poser le tag git : git tag baseline/v1.0-PDR
        → snapshot immuable de l'état approuvé
```

**Règle :** le merge d'une branche **ne requiert pas** de review approuvée — c'est une opération git pure. La review est une validation de contenu des exigences/tests, indépendante du flux de branches.

---

## 3. Actions du relecteur

### 3.1 Navigation dans la review

Le relecteur accède à une **vue dédiée** listant tous les objets de la review avec leur statut d'approbation courant :

```
REVIEW-0001 — "Validation exigences BAT v1.0"

  BAT-0001  Surcharge cellule           [en attente de ma réponse]  2 commentaires
  BAT-0002  Sur-décharge cellule        [approuvé par moi ✓]
  BAT-0003  Température pack batterie   [en attente de ma réponse]  0 commentaire
  BAT-0004  Détection court-circuit     [approuvé par moi ✓]
```

Clic sur un objet → fiche complète de l'objet (version soumise à review) avec le panneau de review affiché en colonne latérale.

### 3.2 Approbation

Deux niveaux d'approbation disponibles :

| Action | Effet |
|--------|-------|
| **"Approuver cet objet"** | Enregistre l'approbation du relecteur pour cet objet précis |
| **"Approuver tout"** | Raccourci : approuve tous les objets de la review en un clic |

Une approbation est **réversible** : le relecteur peut retirer son approbation tant que la review n'est pas clôturée (si un commentaire tardif lui fait changer d'avis).

**Structure d'une approbation (ReviewApproval) :**

```yaml
reviewerId: user-456
approvedAt: "2026-06-01T14:30:00Z"
objectId: BAT-0001
```

T130 : `ReviewApproval` réel n'a que ces 3 champs — pas d'`objectVersion` (contrairement à
`ReviewObject`, voir §2.3).

### 3.3 Commentaires — non implémenté (T130)

`ReviewComment`/`ReviewCommentReply` sont définis dans `packages/types/src/review.ts`, mais
`ReviewsService` n'expose aucune méthode de création/lecture/résolution de commentaire, et aucun
channel IPC `reviews:add-comment`/`reviews:resolve-comment` n'est enregistré (ils apparaissent dans
`SPEC-ELECTRON-DESKTOP.md` §11.2 marqués "⚠ non implémenté"). Ce qui suit décrit le comportement
prévu.

Les commentaires sont **toujours en richtext** (images, tableaux, liens internes vers d'autres exigences).

Trois niveaux de commentaire :

| Niveau | Portée | Usage typique |
|--------|--------|--------------|
| **Review** | Toute la review | Observation générale, remarque de processus |
| **Objet** | Un objet spécifique (req ou test) | "Cette exigence est incomplète sur le cas nominal" |
| **Champ** | Un champ précis d'un objet | "L'énoncé EARS manque la condition de température" |

**Structure d'un commentaire (ReviewComment) :**

```yaml
id: comment-abc123
reviewId: REVIEW-0001
objectId: BAT-0001          # null si commentaire au niveau review
fieldId: statement          # null si commentaire au niveau objet
author: user-456
createdAt: "2026-06-01T14:25:00Z"
content: "<p>L'énoncé EARS est incomplet : il manque la condition de température ambiante.</p>"
resolvedAt: null            # null = commentaire ouvert
resolvedBy: null
replies:
  - author: user-123
    createdAt: "2026-06-01T15:00:00Z"
    content: "<p>Corrigé dans le brouillon en cours. Merci.</p>"
```

**Résolution des commentaires :** le créateur de la review (ou l'auteur de l'objet) peut marquer un commentaire comme **résolu** (avec horodatage). Les commentaires résolus sont masqués par défaut, accessibles via "Afficher les résolus".

### 3.4 Ce que le relecteur NE peut PAS faire

- ❌ Refuser formellement un objet
- ❌ Bloquer une transition de workflow
- ❌ Exiger des modifications (pas de statut "Changes requested")
- ❌ Modifier l'objet lui-même (lecture seule pendant la review)

Si un relecteur a des réserves importantes, il commente. L'auteur décide de la suite (modifier l'objet et ouvrir une nouvelle review, ou procéder malgré les réserves).

---

## 4. Décision finale

### 4.1 Quorum

Le quorum est défini à la création de la review :

| Quorum | Signification |
|--------|--------------|
| `null` (défaut) | Unanimité requise — tous les relecteurs doivent approuver chaque objet |
| `N` | N approbations suffisent par objet |

### 4.2 Statut calculé par objet

| Statut | Condition |
|--------|-----------|
| `pending` | Quorum non atteint sur cet objet |
| `quorum_reached` | Quorum atteint mais pas unanimité |
| `unanimous` | Tous les relecteurs ont approuvé |

### 4.3 Clôture de la review

La review est clôturée **manuellement** par son créateur. Deux statuts possibles :

| Statut final | Déclenchement |
|--------------|--------------|
| `approved` | Le créateur clôture avec "Approuver la review" — le quorum est atteint sur tous les objets |
| `closed` | Le créateur clôture sans approbation globale (ex. : review abandonnée, objets retirés) |

Une review `approved` **déverrouille** les transitions de workflow sur les objets couverts.  
Une review `closed` ne déverrouille rien — il faudra en créer une nouvelle si besoin.

Une review `approved` n'est **pas rouvrissable**. Si l'objet est modifié ensuite, une nouvelle review est nécessaire.

---

## 5. Stockage Git

```
<project-git-repo>/
├── reviews/
│   ├── REVIEW-0001.yaml         ← métadonnées + statut des objets
│   └── ...
└── review-comments/
    ├── REVIEW-0001/
    │   ├── COMMENT-abc123.yaml  ← un fichier par commentaire (évite les conflits git)
    │   ├── COMMENT-def456.yaml
    │   └── ...
    └── ...
```

Les commentaires sont stockés dans des **fichiers séparés** : quand deux relecteurs ajoutent un commentaire simultanément sur des branches différentes ou au même moment, chaque commentaire est un fichier distinct → pas de conflit git.

**Format `reviews/REVIEW-0001.yaml` :**

```yaml
id: REVIEW-0001
title: "Validation exigences BAT v1.0"
description: "<p>Review pré-release pour les exigences batterie.</p>"
status: open
createdBy: user-123
createdAt: "2026-05-28T09:00:00Z"
dueDate: "2026-06-10"
quorum: null
reviewers:
  - user-456
  - user-789
  - user-321
objects:
  - objectId: BAT-0001
    objectType: requirement
    objectVersion: 1
    approvals:
      - reviewerId: user-456
        approvedAt: "2026-06-01T14:30:00Z"
      - reviewerId: user-789
        approvedAt: "2026-06-02T10:00:00Z"
  - objectId: BAT-0002
    objectType: requirement
    objectVersion: 2
    approvals:
      - reviewerId: user-456
        approvedAt: "2026-06-01T14:32:00Z"
  - objectId: BAT-0003
    objectType: requirement
    objectVersion: 1
    approvals: []
```

**Format `review-comments/REVIEW-0001/COMMENT-abc123.yaml` :**

```yaml
id: COMMENT-abc123
reviewId: REVIEW-0001
objectId: BAT-0001
fieldId: statement
author: user-789
createdAt: "2026-06-01T11:15:00Z"
content: "<p>L'énoncé ne couvre pas le cas de charge rapide (&gt; 1C). Voir IEC 62133 §7.3.5.</p>"
resolvedAt: null
resolvedBy: null
replies:
  - author: user-123
    createdAt: "2026-06-01T14:00:00Z"
    content: "<p>Bonne remarque, je l'ajoute dans la prochaine version.</p>"
```

---

## 6. Index mémoire — extension — non implémenté (T130)

Il n'existe pas de `ReviewsIndexService` : aucune occurrence dans `apps/desktop/src/main/services/`.
`ReviewsService` lit/écrit directement les fichiers `reviews/*.yaml` via `GitService`, sans index
en mémoire ni méthode `findReviewsForObject`/`findReviewsForMilestone`/`hasApprovedReview`. Ce qui
suit décrit une extension prévue, jamais construite.

Un `ReviewsIndexService` serait ajouté à l'index en mémoire :

```
ReviewsIndex (par repoPath)
  ├── reviews         : Map<id, Review>
  ├── comments        : Map<reviewId, ReviewComment[]>
  ├── byObject        : Map<objectId, Review[]>   ← reviews couvrant cet objet
  └── byMilestone     : Map<milestoneTag, Review[]> ← reviews liées à un jalon
```

**Requêtes clés :**

```typescript
// Vérifier si un objet peut transitionner (workflow)
hasApprovedReview(repoPath: string, objectId: string, objectVersion: number): boolean

// Toutes les reviews couvrant un objet
findReviewsForObject(repoPath: string, objectId: string): Review[]

// Reviews liées à un jalon
findReviewsForMilestone(repoPath: string, milestoneTag: string): Review[]

// Commentaires sur un objet dans une review (groupés par champ)
findComments(repoPath: string, reviewId: string, objectId: string): ReviewComment[]

// Statut d'approbation calculé
approvalStatus(review: Review, objectId: string): 'pending' | 'quorum_reached' | 'unanimous'
```

---

## 7. Notifications

| Événement | Destinataires |
|-----------|--------------|
| Review créée / relecteur assigné | Tous les relecteurs assignés |
| Nouveau commentaire sur un objet | Relecteurs ayant approuvé ou commenté cet objet + créateur |
| Objet approuvé par tous | Créateur de la review |
| Review clôturée | Tous les relecteurs |
| Relecteur ajouté après ouverture | Le nouvel assigné |

Les notifications sont **in-app** via les événements IPC push (`window.polenta.on('notifications:new', cb)`). L'email est optionnel et configurable par utilisateur.

---

## 8. Décisions de conception

| Point | Décision |
|-------|----------|
| Refus formel | **Interdit** — uniquement approbation ou commentaire |
| Demande de modification formelle | **Interdite** — les réserves passent par les commentaires |
| Approbation granularité | **Par objet** + raccourci "Approuver tout" |
| Révocabilité de l'approbation | **Oui** — tant que la review n'est pas clôturée |
| Clôture | **Manuelle** par le créateur — pas d'auto-clôture au quorum |
| Commentaires | **Richtext** à 3 niveaux : review / objet / champ |
| Stockage commentaires | **Fichiers séparés** (un par commentaire) pour éviter les conflits git — T130 : non implémenté, voir §3.3 |
| Réouverture d'une review approved | **Impossible** — nouvelle review nécessaire si l'objet change |
| Lien avec les branches git | **Aucun** — le merge d'une branche ne requiert pas de review. La review est un workflow de validation de contenu, indépendant du flux git |
| Lien avec les jalons | **Optionnel** — `milestoneTag` peut référencer le tag git du jalon cible, à titre informatif — T130 : non implémenté, voir §2.6 |
| Pré-remplissage des objets | **Manuel** — l'utilisateur sélectionne les items depuis la fiche d'un objet ou via une sélection multiple dans la liste |
