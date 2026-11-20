# GH343 — Scénarios de test

Légende : **U** unitaire (vitest), **W** e2e web (`e2e-web/gh343-*.spec.ts`), **D** e2e desktop
(`e2e-desktop/gh343-*.spec.ts`, Electron, plusieurs fenêtres), **M** manuel.

## Sprint 1 — Deux projets

| # | Scénario | Attendu | Type |
|---|----------|---------|------|
| T1 | `consumeStartupJump` : autorisé une fois, puis faux ; non autorisé : toujours faux | | U |
| T2 | `isRestorableRoute('/')` vrai ; `/login`, `/account` faux ; page de projet vrai | | U |
| T3 | `parseSavedWindows` garde une entrée `route: '/'` | | U |
| T4 | `clearLastOpened(dir)` : efface si le pointeur vaut `dir`, sinon le garde ; sans paramètre efface | | U |
| T5 | `currentAccount(remoteUrl)` : compte connecté de l'hôte du remote ; hôte sans compte → compte par défaut ; sans URL → compte par défaut | | U |
| T6 | `logout(key)` déconnecte ce compte, le compte par défaut reste ; `logout()` inchangé | | U |
| T7 | `pathScope` : repo dans le workspace (séparateurs, casse Windows), repo hors workspace mais dans la liste, repo d'un autre projet | | U |
| T8 | Premier lancement (profil vierge, dernier projet connu) : la fenêtre saute dans le projet | | D |
| T9 | Ctrl+Shift+N depuis l'accueil : nouvelle fenêtre sur l'accueil, pas de saut | CA8 | D |
| T10 | « Nouvelle fenêtre » du panneau Projet (fenêtre sur un projet) : nouvelle fenêtre sur l'accueil | CA8 | D |
| T11 | Clic droit sur un projet récent → « Ouvrir dans une nouvelle fenêtre » : nouvelle fenêtre sur ce projet | CA8 | D |
| T12 | Fenêtre 1 projet A, fenêtre 2 projet B : « Fermer le projet » dans 1 → 1 reste sur l'accueil, 2 inchangée | CA9 | D |
| T13 | Fenêtres A et A : fermer le projet dans l'une → le dernier projet ouvert reste A (relance de l'app vierge de disposition : saut vers A) | | D |
| T14 | Fenêtres A, B, accueil ; quitter, relancer : trois fenêtres, A, B, accueil (sans saut) | CA10 | D |
| T15 | Disposition dont la 2e page est un projet supprimé : la 2e fenêtre rouvre sur l'accueil sans saut | | D |
| T16 | Écriture dans le projet A (fichier modifié sur disque) : aucune requête de relecture dans la fenêtre B (compteur d'appels IPC de lecture) | CA12 | D |
| T17 | Web : « Nouvelle fenêtre » → nouvel onglet du navigateur sur l'accueil, sans saut ; premier chargement de `/` → saut | | W |
| T18 | Web : « Fermer le projet » → accueil, sans saut, dans cet onglet seulement | | W |
| T19 | Deux projets sur deux forges, un compte sur chacune : menu de compte de chaque fenêtre = compte de sa forge ; publier / tirer dans les deux | CA11 | M |

## Sprint 2 — Glisser un onglet

| # | Scénario | Attendu | Type |
|---|----------|---------|------|
| T20 | `tab-drag` : prise par la source refusée ; prise par une fenêtre d'un autre projet refusée ; fenêtre sans projet acceptée ; expiration 60 s ; second glisser remplace le premier | | U |
| T21 | `tab-drag` : `take` attend `ready` (≤ 2,5 s) puis transfère ; `app:tab-moved` envoyé à la source | | U |
| T22 | `tabDraft` : restauration une seule fois, seulement pour la même clé ; attente jetée à la navigation | | U |
| T23 | `useDraftForm` `exportState` / `importState` + nouvel instantané serveur → conflit détecté | | U |
| T24 | Réordonner : glisser le 3e onglet avant le 1er → ordre mis à jour, onglet actif inchangé | CA7 | W |
| T25 | Protocole entre fenêtres (appels pilotés) : onglet avec historique de 3 pages transféré dans la fenêtre 2 → présent, actif, Précédent ramène à la page 2 ; disparu de la fenêtre 1 | CA2, CA4 | D |
| T26 | Idem avec exigence modifiée non enregistrée : saisie et point « modifié » présents dans la fenêtre 2 ; « Enregistrer » écrit le fichier | CA3 | D |
| T27 | Saisie transférée pour test, Schéma, campagne, diff (même contrôle, une page par cas) | CA3 | D |
| T28 | Dernier onglet transféré : la fenêtre 1 se ferme | CA5 | D |
| T29 | Fenêtre 2 sur le projet B : `tab-drag-info` → refus ; `take` refusé ; l'onglet reste dans la fenêtre 1 | CA6 | D |
| T30 | Fenêtre 2 à l'accueil : dépôt accepté, elle ouvre le projet A sur la page de l'onglet | CA6 | D |
| T31 | `tab-drag-end` curseur hors fenêtres : nouvelle fenêtre avec l'onglet, historique et saisie | CA1 | D |
| T32 | `tab-drag-end` avec un seul onglet : rien ne se passe | | D |
| T33 | Geste réel : glisser un onglet sur le bureau, sur une autre fenêtre, sur une fenêtre d'un autre projet (curseur interdit), sur le contenu d'une fenêtre (rien) | CA1, CA4, CA6 | M |
| T34 | Vue Édition modifiée (enregistrement automatique en attente) puis glisser : valeur enregistrée, visible dans la fenêtre d'arrivée | | M |
| T35 | Élément modifié dans une autre fenêtre pendant le glisser : bandeau « modifié ailleurs » à l'arrivée | | M |

## Critères d'acceptation → scénarios

CA1 T31 T33 · CA2 T25 · CA3 T26 T27 · CA4 T25 T33 · CA5 T28 · CA6 T29 T30 T33 · CA7 T24 ·
CA8 T9–T11 · CA9 T12 · CA10 T14 · CA11 T19 · CA12 T16.
