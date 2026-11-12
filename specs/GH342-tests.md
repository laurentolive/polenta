# GH342 — Scénarios de test

Légende : **U** unitaire (vitest), **ED** e2e desktop (`e2e-desktop/gh342-*.spec.ts`),
**EW** e2e web (`e2e-web/gh342-*.spec.ts`), **M** manuel (non automatisable ici).

## Fenêtres (sprint 1)

| # | Scénario | Attendu | Type |
|---|----------|---------|------|
| F1 | Projet ouvert sur la vue Exigences, composant A, élément X ; Ctrl+Shift+N | 2e fenêtre, même URL (composant A, élément X), un seul onglet | ED |
| F2 | Clic droit sur un onglet inactif → « Ouvrir dans une nouvelle fenêtre » | Nouvelle fenêtre sur la page de cet onglet ; l'onglet reste dans la 1re | ED |
| F3 | Fenêtre 2 : passer au composant B, ouvrir un onglet | Fenêtre 1 inchangée (URL, onglets) | ED |
| F4 | Clic droit → « Fermer l'onglet » sur un onglet non sauvegardé | Confirmation habituelle | EW |
| F5 | Nouvelle fenêtre décalée de +30/+30 près du bord droit de l'écran | Entièrement visible | U (`offsetPlacement`) |
| F6 | Relance de l'exécutable avec Polenta ouvert | Fenêtre existante au premier plan, pas de nouvelle fenêtre | M (inchangé) |

## Restauration (sprint 1)

| # | Scénario | Attendu | Type |
|---|----------|---------|------|
| R1 | Deux fenêtres (positions, pages différentes), fermeture de l'app, relance | Deux fenêtres aux mêmes positions / tailles, sur leurs pages | ED |
| R2 | Fenêtre 2 fermée en cours de session, puis l'app | Une seule fenêtre au lancement suivant | ED |
| R3 | Fenêtre hors de tout écran (placement enregistré invalide) | Recentrée sur l'écran principal, entièrement visible | U (`fitToDisplays`) + ED (fichier forgé) |
| R4 | Fenêtre maximisée | Rouvre maximisée, taille restaurée conservée | ED |
| R5 | Page mémorisée sur un projet supprimé | Démarrage habituel (accueil) | ED |
| R6 | `windows-state.json` absent, vide, JSON invalide, entrées partielles | Une fenêtre par défaut, pas d'erreur | U (`parseSavedWindows`) |
| R7 | Page `/login` ou `/` mémorisée | Démarrage habituel | U |
| R8 | Deux écrans physiques, une fenêtre par écran, relance ; puis écran 2 débranché, relance | Chaque fenêtre sur son écran ; puis fenêtre 2 sur l'écran principal | M |

## Données partagées (sprints 1–2)

| # | Scénario | Attendu | Type |
|---|----------|---------|------|
| D1 | Champ modifié et enregistré dans la fenêtre 1 | Visible dans la fenêtre 2 en < 3 s | ED |
| D2 | Deux appels `autoSync` simultanés / à 10 s d'intervalle sur un même repo | Un seul fetch réseau | U (`SyncService`) |
| D3 | Appel `autoSync` 40 s après le précédent | Nouveau fetch | U |

## Événements par fenêtre, fermeture (sprint 2)

| # | Scénario | Attendu | Type |
|---|----------|---------|------|
| P1 | Terminal ouvert dans la fenêtre 1 | La fenêtre 2 ne reçoit aucun `terminal:data` | ED |
| P2 | Dialogue « choisir un dossier » depuis la fenêtre 2 | Parent = fenêtre 2 | U (handler, `parentOf`) |
| P3 | Invitation reçue avec deux fenêtres, la 2 active en dernier | Seule la fenêtre 2 la traite | U |
| P4 | Fermer une fenêtre avec un onglet non sauvegardé | Confirmation ; « Annuler » la garde ouverte ; « Fermer quand même » la ferme | ED |
| P5 | Fermer une fenêtre pendant une saisie richtext non encore enregistrée (< 800 ms) | La saisie est enregistrée sur disque | ED |
| P6 | Fermer la fenêtre 2 sur deux | L'app reste ouverte | ED |
| P7 | Fermer le projet dans la fenêtre 2 | La fenêtre 1 reste sur le projet | ED |
| P8 | Installation d'une mise à jour avec un onglet non sauvegardé | Pas de seconde confirmation (celle de GH302 suffit) | M |

## Édition concurrente (sprint 3)

| # | Scénario | Attendu | Type |
|---|----------|---------|------|
| C1 | `externalConflicts` / `adoptExternal` / `changedKeys` : clé changée seulement ailleurs, seulement ici, des deux côtés à l'identique, des deux côtés différemment | adoptée / gardée / sans conflit / conflit | U |
| C2 | Page exigence ouverte dans 2 onglets web ; champ X enregistré dans l'onglet 1, champ Y dans l'onglet 2 | Les deux valeurs dans le fichier | EW |
| C3 | Même champ en cours de saisie dans l'onglet 2, enregistré dans l'onglet 1 | Bandeau dans l'onglet 2 ; « Recharger » → valeur de l'onglet 1 | EW |
| C4 | Idem, « Garder ma saisie » puis Enregistrer | Valeur de l'onglet 2 sur disque | EW |
| C5 | Champ non saisi modifié ailleurs | Mis à jour sans bandeau, point « modifié » absent | EW |
| C6 | Page test : statut non touché, titre modifié, enregistrer | Seul `title` envoyé (statut modifié ailleurs entre-temps conservé) | EW |
| C7 | Vue Édition (EditView) : champ texte en cours de saisie modifié dans l'autre onglet | Bandeau ; « Recharger » remplace la saisie | EW |

## Web (sprint 1)

| # | Scénario | Attendu | Type |
|---|----------|---------|------|
| W1 | Menu d'onglet → « Ouvrir dans une nouvelle fenêtre » | Nouvel onglet navigateur sur la même URL, page affichée | EW |
| W2 | URL d'une page collée dans un nouvel onglet | Cette page s'affiche (pas l'accueil) | EW |
| W3 | F5 sur une page | Même page après rechargement | EW |
| W4 | Onglet Polenta non sauvegardé, fermeture de l'onglet navigateur | Confirmation générique du navigateur | M (Playwright : `beforeunload` vérifiable via `page.on('dialog')`) → EW si stable |
| W5 | Ctrl+Shift+N dans le navigateur | Aucune action Polenta | M |

## Non-régression
- Suites `e2e-desktop` existantes qui relancent l'app (restauration de la dernière page).
- gh228 (historique d'onglet), gh237 (zoom appliqué aux nouvelles fenêtres), gh238 (terminal),
  gh338 (titre par fenêtre), export PDF / instantané draw.io (fenêtres cachées hors registre).
