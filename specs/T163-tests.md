# T163 — Scénarios de test

Réf. : `specs/T163.md`, `specs/T163-design.md`.

> Pas de runner de test automatisé dans le repo (`apps/desktop` et `packages/*`
> n'ont ni vitest ni jest). Validation = `pnpm typecheck` + `pnpm lint` + les
> scénarios manuels ci-dessous.

## Pré-requis

- Un projet Polenta ouvert avec un **repo** (chemin repo résolu — sinon on est
  dans le cas « repoPath absent », scénario E3).
- Au moins un type d'objet avec un champ `richtext` visible en Vue Word.
- Des fichiers `.drawio` dans `diagrams/` (multi-pages de préférence).
- Plusieurs éléments (idéalement 50+) pour vérifier la paresse ; PL/Product
  (~280 items) pour le test de charge S7.

Préparer des champs richtext contenant :
- **D-A** : un bloc `drawio` simple `{"path":"diagrams/X.drawio"}` (1 page, pas de
  taille, pas de crop).
- **D-B** : un bloc avec ancre page `{"path":"…","nodeId":"<id-page-2>"}`.
- **D-C** : un bloc avec ancre cellule `{"path":"…","nodeId":"<id-mxCell>"}`.
- **D-D** : un bloc redimensionné `{"path":"…","width":240,"height":160}`.
- **D-E** : un bloc rogné `{"path":"…","width":300,"height":180,"crop":{"x":20,"y":10,"width":260,"height":150}}`.
- **D-F** : un bloc pointant un fichier **inexistant** `{"path":"diagrams/nope.drawio"}`.
- **D-G** : un champ mélangeant texte, une image repo, et deux blocs `drawio`.

## 1. Golden path

| # | Étapes | Résultat attendu |
|---|--------|------------------|
| S1 | Ouvrir la Vue Word, faire défiler jusqu'à l'élément portant **D-A** | Le diagramme s'affiche rendu (moteur mxGraph, formes/connecteurs fidèles), à la place de l'ancienne étiquette `📐 X.drawio`. Rendu visuellement identique à la Vue Édition du même champ. |
| S2 | Depuis S1, cliquer une fois sur le diagramme | Le champ passe en **mode édition** (`RichTextField`), le `DrawioEmbedView` interactif apparaît (bordure de sélection au clic, poignées, menu contextuel au clic droit). Aucune lightbox, aucune ouverture de draw.io externe. |
| S3 | Sortir de l'édition (clic ailleurs / Échap), rescroller sur l'élément | Le diagramme est de nouveau rendu en lecture, sans clignotement anormal. |
| S4 | Élément avec **D-B** (ancre page) | La **page 2** du fichier est affichée (pas la page 1). |
| S5 | Élément avec **D-C** (ancre cellule) | La page **contenant la cellule** est affichée. (v1 : pas d'encadré de surlignage — QO1.) |
| S6 | Élément avec **D-D** (240×160) | Le diagramme est affiché à 240×160 px. Élément avec **D-E** (crop) : le cadrage pan/zoom est appliqué — même portion visible qu'en Vue Édition. |

## 2. Paresse / performance

| # | Étapes | Résultat attendu |
|---|--------|------------------|
| S7 | Ouvrir la Vue Word sur PL/Product (~280 items, diagrammes répartis dans le document). Chronométrer l'affichage initial. | Affichage initial sans gel perceptible, comparable à l'état actuel (étiquettes). Seuls les diagrammes proches du viewport sont rendus. |
| S8 | DevTools → onglet Network / ou point d'arrêt sur `api.drawio.read`. Charger la Vue Word sans scroller. | `api.drawio.read` n'est appelé que pour les diagrammes visibles ou à < ~200 px du viewport, pas pour les ~280. |
| S9 | Scroller lentement vers le bas | Chaque diagramme se rend juste avant/au moment d'entrer à l'écran. Un diagramme déjà rendu **ne se re-rend pas** au re-scroll (un seul appel `read` par diagramme sur toute la session de la vue). |
| S10 | Revenir en haut, quitter la fenêtre Polenta puis y revenir (focus) | Les diagrammes **ne se rechargent pas** au retour de focus (contrairement à `DrawioEmbedView`). |

## 3. Contenu mixte / rendu

| # | Étapes | Résultat attendu |
|---|--------|------------------|
| M1 | Élément avec **D-G** (texte + image + 2 diagrammes) | Texte et image rendus comme aujourd'hui ; les 2 diagrammes rendus à leur position dans le flux, indépendamment. |
| M2 | Thème sombre | Fond du cadre du diagramme lisible (`--print-bg`), contraste correct. |
| M3 | Inspecter le DOM d'un champ avec un seul bloc `drawio` | Pas de `<div>` invalide dans un `<p>` ; le `.static-drawio` est un `span inline-block`, pas de `<p>` vide parasite au-dessus/dessous. |
| M4 | Largeur de fenêtre réduite | Le diagramme ne pousse pas la largeur du document au-delà du conteneur (pas de scroll horizontal de page). |

## 4. Cas limites / erreurs

| # | Étapes | Résultat attendu |
|---|--------|------------------|
| E1 | Élément avec **D-F** (fichier inexistant) | Message inline discret « Diagramme introuvable : diagrams/nope.drawio » (rouge, petit). Pas de crash. Le reste du champ s'affiche. |
| E2 | Fichier `.drawio` présent mais corrompu (XML invalide) | Message « Diagramme invalide : … ». Pas de crash. |
| E3 | Ouvrir un contexte **sans repo résolu** (si reproductible) et une Vue Word avec des blocs `drawio` | Repli sur l'étiquette `📐 nom-de-fichier` (comportement actuel), pas d'erreur, pas de tentative de lecture. |
| E4 | Payload `drawio` avec JSON illisible (édition manuelle du markdown) | Repli `📐 <contenu brut>` ou rien, pas de crash. |
| E5 | Éditer le texte d'un champ richtext contenant un diagramme rendu, puis annuler / naviguer | Pas d'`IntersectionObserver` ni de `ResizeObserver` fuités (vérif : `performance` / pas d'accumulation), pas de viewers fantômes empilés. |
| E6 | Basculer plusieurs fois Word → Édition → Word rapidement sur le même élément | Aucun double-montage du viewer, aucune exception console. |
| E7 | Filtrer la Vue Word (barre de recherche) pour masquer puis réafficher un élément avec diagramme | Le diagramme se re-rend correctement à la réapparition. |

## 5. Non-régression

| # | Vérification |
|---|--------------|
| N1 | Vue Édition d'un champ richtext avec diagramme : inchangée (poignées, rognage, menu, double-clic → draw.io externe, refresh au focus). |
| N2 | `RichTextViewer` (routes campagne : exécution, run, détail campagne) : diagrammes toujours rendus comme avant. |
| N3 | Vue Tableau : cellule richtext = aperçu 1 ligne, inchangé. |
| N4 | Images dans un champ richtext en Vue Word : toujours rendues (résolution `data:`). |
| N5 | `pnpm typecheck` et `pnpm lint` : zéro nouvelle erreur. |
| N6 | Champ richtext **sans** diagramme en Vue Word : aucun `IntersectionObserver` créé (early-return sur `placeholders.length === 0`). |

## 6. Critères d'acceptation (rappel spec §Critères)

1–10 de `specs/T163.md` couverts respectivement par : S1 (1), S8/S9 (2), S7 (3),
S6 (4), S4/S5 (5), S2 (6), E1 (7), E3 (8), E5/E6 (9), N5 (10).
