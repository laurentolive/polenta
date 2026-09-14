# T167 — Scénarios de test

Réf. : `specs/T167.md`, `specs/T167-design.md`.

Tests majoritairement **manuels** (app desktop, pilotée via CDP/Playwright comme
T107/T164). Projet d'essai : `apps/desktop/PL/Product` (volumineux, plusieurs
types + campagnes) ou tout projet avec ≥ 3 exigences, ≥ 2 tests, ≥ 1 campagne
partageant un terme commun.

Le typecheck (`cd apps/desktop && npx tsc --noEmit -p tsconfig.json`) doit rester
à zéro erreur nouvelle à chaque sprint.

---

## Sprint 1 — liste lecture seule + goto + partage d'état

### Golden path

| # | Étapes | Attendu |
|---|--------|---------|
| S1-1 | Ouvrir un projet → activité Recherche, champ vide | Zone principale = état vide actuel (icône loupe + message d'invitation) |
| S1-2 | Saisir un terme présent dans 3 exigences + 2 tests | Panneau : liste hiérarchique inchangée. Zone principale : 5 cartes, ordre = 3 exigences puis 2 tests |
| S1-3 | Observer une carte exigence | En-tête : badge `EX`, id mono, titre, badge statut, `v{n}`. Corps : tous les champs du type rendus en lecture, richtext inclus (pas d'éditeur TipTap) |
| S1-4 | Observer une carte test | Idem + table des étapes en lecture seule (non éditable) |
| S1-5 | Occurrences | Dans chaque carte, le terme recherché est surligné (`<mark>` jaune) dans les champs texte où il apparaît |
| S1-6 | Clic simple sur une ligne de résultat du **panneau** | La zone principale défile jusqu'à la carte correspondante ; contour bleu persistant sur la carte. **Aucune** navigation (`location.pathname` reste `/search`) |
| S1-7 | Clic simple sur une **carte** de la zone principale | Idem S1-6 (scroll — no-op si déjà visible — + contour) |
| S1-8 | Clic sur un autre résultat | Le contour se déplace sur la nouvelle carte |
| S1-9 | Clic dans le vide de la liste (sous les cartes) | Contour effacé |
| S1-10 | Recherche active → aller sur Suivi → revenir sur Recherche | Requête, options, filtres de type et résultats toujours présents (panneau + zone principale) |
| S1-11 | `Tout remplacer` depuis le panneau (terme → autre terme) | Après exécution : cartes de droite rafraîchies, nouveau terme visible, ancien terme absent |
| S1-12 | Décocher le filtre « Tests » | Cartes tests retirées de la zone principale (comme du panneau) |

### Cas limites

| # | Cas | Attendu |
|---|-----|---------|
| S1-13 | Regex invalide (mode `.*` activé, motif `(` ) | Zone principale reste à l'état vide ; message d'erreur regex dans le panneau (inchangé) |
| S1-14 | Terme sans aucun résultat | Zone principale : message « aucun résultat » (`common.noResults`), pas l'invite générique |
| S1-15 | Exigence dont `objectTypeRef` ne résout aucun `typeDef` (schéma modifié) | Carte affichée avec les clés de `fields` brutes ; pas de crash |
| S1-16 | Champ richtext contenant un diagramme draw.io | Diagramme rendu paresseusement (IntersectionObserver) comme en Vue Word ; pas de surbrillance dans le diagramme (best effort) — champ lisible |
| S1-17 | Champ richtext contenant un tableau markdown avec le terme | Champ rendu ; surbrillance best effort (peut manquer dans les cellules) — pas de HTML cassé |
| S1-18 | Ouvrir la Vue Système (Exigences) → Vue Word | Aucune régression : goto au clic simple dans l'arbre, contour, rendu des cartes — `GOTO_OUTLINE_CLASS` / `getStatusClass` déplacés mais identiques |
| S1-19 | Projet jamais ouvert sur Recherche depuis le lancement | Aucune requête réseau `requirements`/`tests`/`campaigns` déclenchée avant la 1ʳᵉ saisie (vérifier via devtools/Network ou logs) |
| S1-20 | Changer de projet (multi-projets) avec une recherche en cours | Recherche réinitialisée (champ vide) sur le nouveau projet (`key={currentProjectId}` sur le provider) |
| S1-21 | Double-clic sur une carte (sprint 1, transitoire) | Ouvre la page détail `/req/$id` ou `/test/$id` (ou `/campaign/$id`) — comportement temporaire documenté, remplacé au sprint 2 |

---

## Sprint 2 — édition inline

### Golden path

| # | Étapes | Attendu |
|---|--------|---------|
| S2-1 | Double-clic sur une carte **exigence** | Zone principale : `EditView` complet (champs éditables, section Liens, badge couverture). `ViewHeader` : titre = type + id, bouton « Retour aux résultats ». `location.pathname` reste `/search` |
| S2-2 | Modifier un champ texte, cliquer ailleurs (blur) | Autosave : la valeur est persistée (vérifier le fichier YAML de l'exigence) |
| S2-3 | Modifier un champ richtext, attendre ~1 s | Autosave debouncé (T159) : valeur persistée sans blur |
| S2-4 | `Ctrl/Cmd+Entrée` dans un champ richtext | Valide le champ (flush) |
| S2-5 | Cliquer « Retour aux résultats » | Retour à la liste ; recherche inchangée ; contour goto préservé ; la carte de l'élément reflète les modifs (recherche recalculée) |
| S2-6 | `Échap` en mode édition | Idem retour |
| S2-7 | Double-clic sur une carte **test** | `EditView` + bloc « Étapes » éditable sous les champs |
| S2-8 | Modifier une étape, attendre ~1 s | Autosave étapes (`api.tests.update({ steps })`) — persisté |
| S2-9 | Double-clic sur une carte **campagne** | Navigation vers `/campaign/$id` (quitte la Vue Recherche) |
| S2-10 | En édition, section Liens → cliquer un identifiant d'objet lié | L'objet lié s'ouvre **dans un nouvel onglet** (`/req/$id` ou `/test/$id`) ; l'onglet Recherche reste en mode édition |
| S2-11 | En édition, ajouter un lien via le combobox | Lien créé ; `traceability-matrix` invalidé ; badge de couverture mis à jour |
| S2-12 | Changer le statut via le sélecteur de statut d'`EditView` | Transition appliquée (`transition` / `update`) ; version incrémentée le cas échéant (comportement `SystemView` inchangé) |
| S2-13 | Éditer une exigence qui, après modif, ne matche plus la recherche, puis retour | La carte disparaît de la liste (résultats recalculés) — pas de crash, pas de carte fantôme |

### Cas limites

| # | Cas | Attendu |
|---|-----|---------|
| S2-14 | Projet figé sur une baseline (lecture seule) | Double-clic ouvre `EditView` en `readOnly` : champs non éditables, pas d'autosave, pas de combobox de lien |
| S2-15 | Double-clic, puis pendant le chargement de l'objet, cliquer « Retour » | Retour propre à la liste ; pas d'écriture parasite |
| S2-16 | Édition en cours → clic sur une autre activité (barre latérale) | `EditView` se démonte : flush T159 des champs non sauvegardés (richtext) exécuté ; au retour sur Recherche, la liste est réaffichée (pas l'éditeur) |
| S2-17 | Édition → `Tout remplacer` déclenché depuis le panneau pendant l'édition | Pas de conflit d'écriture visible ; au retour la carte reflète l'état à jour |
| S2-18 | Ouvrir l'éditeur alors qu'un contour goto est actif | Le contour est effacé à l'ouverture de l'éditeur (cohérent `SystemView`) |
| S2-19 | Double-clic sur un résultat dont l'objet a été supprimé entre-temps | `EditView` affiche l'état « introuvable » / formulaire vide (comme `SystemView` sur nœud orphelin) — pas de blocage sur « Chargement… » |
| S2-20 | Element `title` modifié via le champ « Nom » d'`EditView` | `api.<cat>.update({ title })` ; titre à jour dans la carte et dans le panneau au retour |

### Non-régression transverse

| # | Cas | Attendu |
|---|-----|---------|
| S2-21 | Vue Système → double-clic dans l'arbre → `EditView` | Comportement identique à avant T167 (aucun handler partagé cassé) |
| S2-22 | Pages détail `/req/$id`, `/test/$id`, `/campaign/$id` ouvertes directement | Inchangées |
| S2-23 | `SearchPanel` : navigation clavier, expand/collapse des occurrences, bouton ↻ « Remplacer dans cet élément » | Inchangés |

---

## Vérifications automatiques disponibles

- `npx tsc --noEmit` (apps/desktop) — zéro erreur nouvelle (chaque sprint).
- Pas de suite de tests unitaires renderer dans ce repo pour ces composants ;
  la validation reste manuelle + pilotage CDP.
- `lib/searchQuery.ts` : si le temps le permet, un petit test unitaire des
  fonctions pures extraites (`buildRegex`, `replaceInText`, `findMatches`)
  serait un plus (aucune régression sur le remplacement existant) — optionnel.
