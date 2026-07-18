# T101 — Scénarios de test : gestion des onglets (tabs)

## Prérequis

- Un projet Polenta ouvert, avec au moins une exigence, un test et une
  campagne existants (pour naviguer vers des routes de détail).
- Pour les scénarios multi-fenêtre : capacité d'ouvrir une seconde fenêtre
  via "Fichier → Ouvrir dans une nouvelle fenêtre".
- Sprint 2 uniquement : accès à la vue "Modèle de données" (`/schema`) pour
  provoquer un état `isDirty`.

---

## Scénarios nominaux — Sprint 1

### N1 — Barre d'onglets visible et onglet initial

**Étapes :**
1. Ouvrir l'application sur un projet chargé.

**Attendu :**
- Une barre d'onglets est visible au-dessus d'ActivityBar/Sidebar/main
  frame, avec un seul onglet ouvert (page d'accueil).
- La barre n'apparaît ni sur `/login` ni sur une fenêtre d'impression PDF.

---

### N2 — Ouvrir un nouvel onglet via "+"

**Étapes :**
1. Naviguer dans l'onglet courant vers une exigence (`/req/$reqId`).
2. Cliquer le bouton "+" de la barre d'onglets.

**Attendu :**
- Un nouvel onglet est créé et activé, affichant la page d'accueil —
  l'onglet précédent (toujours sur l'exigence) reste dans la liste, non
  activé.

---

### N3 — Ouvrir un nouvel onglet via Ctrl+T

**Étapes :**
1. Depuis n'importe quel panneau (ex. Version), appuyer Ctrl+T.

**Attendu :**
- Même effet que N2 (nouvel onglet actif sur la page d'accueil), quel que
  soit le panneau affiché au moment de l'appui.

---

### N4 — Naviguer à l'intérieur d'un onglet ne crée pas de nouvel onglet

**Étapes :**
1. Dans l'onglet actif, cliquer successivement sur 3 exigences différentes
   depuis la liste Produit.

**Attendu :**
- Un seul onglet dans la barre pendant toute la séquence ; son URL/titre se
  met à jour à chaque clic (pas d'accumulation d'onglets).

---

### N5 — Changer d'onglet restitue l'URL exacte et le panneau associé

**Étapes :**
1. Onglet A : naviguer vers `/graph` (panneau Version) pour un repo donné.
2. Ctrl+T : onglet B, naviguer vers `/req/$reqId` d'une exigence précise
   (panneau Produit/Composants).
3. Cliquer sur l'onglet A dans la barre.

**Attendu :**
- Le main frame réaffiche `/graph` sur le même repo qu'avant, et
  l'ActivityBar/Sidebar basculent automatiquement sur le panneau Version
  (dérivé de l'URL restaurée) — sans reclic manuel sur l'icône Version.
- Cliquer ensuite sur l'onglet B restaure exactement l'exigence précédente.

---

### N6 — Fermer un onglet via la croix

**Étapes :**
1. Avoir 3 onglets ouverts (A actif au milieu, B, C).
2. Cliquer la croix de l'onglet A (actif).

**Attendu :**
- L'onglet A disparaît de la barre, un onglet voisin (B ou C) devient actif
  et son contenu s'affiche.

---

### N7 — Fermer l'onglet actif via Ctrl+W

**Étapes :**
1. Avoir 2 onglets ouverts, aucun dirty (sprint 1 : notion pas encore
   câblée ; sprint 2 : vérifier explicitement l'absence de brouillon).
2. Appuyer Ctrl+W.

**Attendu :**
- L'onglet actif se ferme immédiatement (sprint 1 : toujours ; sprint 2 :
  sans popup puisque non dirty), l'autre onglet devient actif.
- "Fermer le projet" ne se déclenche pas (vérifier que le projet reste
  chargé après l'appui).

---

### N8 — Menu déroulant : liste et filtre

**Étapes :**
1. Ouvrir 4-5 onglets sur des vues différentes.
2. Cliquer la flèche vers le bas de la barre d'onglets.
3. Taper un fragment du titre d'un des onglets dans le champ de filtre.

**Attendu :**
- Le menu liste tous les onglets ouverts.
- Le filtre réduit la liste aux entrées dont le titre contient le fragment
  tapé (insensible à la casse).
- Cliquer une entrée filtrée active l'onglet correspondant et ferme le menu.

---

### N9 — Récemment fermés — réouverture

**Étapes :**
1. Fermer un onglet B (croix) alors que 2 autres onglets restent ouverts.
2. Ouvrir le menu déroulant.

**Attendu :**
- B apparaît dans une section "Récemment fermés" du menu.
- Cliquer B le rouvre : nouvel onglet actif sur la même URL/titre que
  l'onglet fermé, retiré de "Récemment fermés".

---

### N10 — Deux fenêtres, deux jeux d'onglets indépendants

**Étapes :**
1. Fenêtre 1 : ouvrir 3 onglets sur des vues distinctes.
2. "Fichier → Ouvrir dans une nouvelle fenêtre" → Fenêtre 2.
3. Dans la Fenêtre 2, ouvrir 2 onglets différents de ceux de la Fenêtre 1.

**Attendu :**
- La barre d'onglets de chaque fenêtre est indépendante : aucun onglet de
  la Fenêtre 1 n'apparaît dans la Fenêtre 2 et inversement.

---

## Scénarios nominaux — Sprint 2

### N11 — Fermeture sans confirmation quand rien n'est modifié

**Étapes :**
1. Ouvrir `/schema` dans un onglet, ne rien modifier.
2. Ctrl+W (ou croix).

**Attendu :**
- Fermeture immédiate, aucune popup.

---

### N12 — Confirmation sur `/schema` avec brouillon non enregistré

**Étapes :**
1. Ouvrir `/schema` dans un onglet, modifier un champ du modèle de données
   (le `*` apparaît dans le titre `ViewHeader`, comportement existant
   inchangé).
2. Ctrl+W.

**Attendu :**
- Une popup de confirmation apparaît ("Fermer sans enregistrer ?").
- "Annuler" : l'onglet reste ouvert, le brouillon est intact.
- Confirmer : l'onglet se ferme, le brouillon est perdu (comportement
  attendu, comme `schema.tsx` le fait déjà pour Escape/`CancelConfirmModal`).

---

### N13 — Filet de sécurité : champ en cours de frappe

**Étapes :**
1. Ouvrir une exigence en édition, cliquer dans un champ texte (ex.
   `statement`), taper du texte sans cliquer ailleurs (pas de blur).
2. Ctrl+W immédiatement.

**Attendu :**
- Le champ se blur automatiquement avant l'évaluation dirty (le mécanisme
  d'autosave au blur existant s'exécute) — si l'autosave committe avec
  succès, fermeture sans popup ; observer dans le réseau/logs que la
  sauvegarde a bien eu lieu avant la fermeture.

---

### N14 — Titre d'onglet affiné pour une route de détail

**Étapes :**
1. Ouvrir une exigence SYS-001 "Démarrage rapide" dans un onglet.

**Attendu :**
- Le titre de l'onglet affiche le nom réel de l'exigence (ex.
  "SYS-001 — Démarrage rapide"), pas un libellé générique "Exigence".

---

## Cas limites

### L1 — Fermer le dernier onglet

**Étapes :**
1. Fermer tous les onglets sauf un.
2. Fermer ce dernier onglet (croix ou Ctrl+W).

**Attendu :**
- Aucune fenêtre ne se ferme, aucun état "zéro onglet" n'est atteignable :
  l'onglet restant bascule sur la page d'accueil.

---

### L2 — Fermeture/changement de projet réinitialise les onglets

**Étapes :**
1. Ouvrir plusieurs onglets sur des vues du projet courant.
2. Fermer le projet (panneau Projet ou menu Fichier).
3. Ouvrir un autre projet.

**Attendu :**
- La barre d'onglets retombe à un onglet unique sur la page d'accueil ; la
  liste "Récemment fermés" est vidée (pas d'entrées d'un projet précédent
  visibles après changement de projet).

---

### L3 — Ctrl+T / Ctrl+W pendant une saisie dans un champ

**Étapes :**
1. Placer le focus dans un champ texte quelconque (ex. champ de filtre
   sidebar) et taper "t" ou "w" seuls (sans Ctrl) — vérifier absence de
   régression.
2. Puis, focus toujours dans le champ, appuyer Ctrl+T.

**Attendu :**
- Taper "t"/"w" seuls dans le champ produit bien la lettre (aucune
  interception intempestive).
- Ctrl+T ouvre bien un nouvel onglet même avec le focus dans un champ de
  saisie (raccourci global).

---

### L4 — Dernier onglet + dirty en cours (sprint 2)

**Étapes :**
1. Un seul onglet ouvert, sur `/schema` avec un brouillon non enregistré.
2. Ctrl+W.

**Attendu :**
- La popup de confirmation apparaît malgré tout (la règle "dernier onglet
  retombe sur l'accueil" ne contourne pas la garde dirty).
- Confirmer : l'onglet bascule sur la page d'accueil (comme L1), brouillon
  perdu. Annuler : rien ne change.

---

### L5 — Réouverture d'un onglet "Récemment fermés" pointant vers une
entité supprimée entre-temps

**Étapes :**
1. Fermer un onglet ouvert sur une exigence donnée.
2. Supprimer cette exigence (ou revenir à un état où elle n'existe plus).
3. Rouvrir cet onglet depuis "Récemment fermés".

**Attendu :**
- Pas de crash : la route de détail affiche son état "introuvable" habituel
  (comportement déjà existant hors T101 pour un ID invalide dans l'URL),
  pas une erreur JS non gérée.

---

### L6 — Filtre du menu déroulant sans résultat

**Étapes :**
1. Ouvrir le menu déroulant, taper un fragment ne correspondant à aucun
   titre d'onglet ouvert ni récemment fermé.

**Attendu :**
- Liste vide, pas d'erreur, message ou état vide cohérent avec le reste de
  l'app (pas nécessairement un message dédié, mais pas de crash/`undefined`
  affiché).

---

## Critères d'acceptation vérifiables manuellement

| # | Critère | Vérification |
|---|---------|-------------|
| CA1 | Barre d'onglets visible partout sauf `/login`/`/print/*` | N1 |
| CA2 | "+" et Ctrl+T ouvrent un nouvel onglet sur la page d'accueil | N2, N3 |
| CA3 | Navigation interne à un onglet ne crée pas de nouvel onglet | N4 |
| CA4 | Changer d'onglet restitue l'URL exacte et le panneau associé | N5 |
| CA5 | Croix et Ctrl+W ferment l'onglet actif et activent un voisin | N6, N7 |
| CA6 | Ctrl+W ne ferme plus le projet | N7 |
| CA7 | Menu déroulant liste + filtre fonctionnent | N8 |
| CA8 | Récemment fermés permet la réouverture | N9 |
| CA9 | Onglets scopés par fenêtre | N10 |
| CA10 | Pas de confirmation si rien n'est modifié | N11 |
| CA11 | Confirmation affichée et respectée (annuler/confirmer) sur `/schema` dirty | N12 |
| CA12 | Filet de sécurité : blur avant évaluation dirty | N13 |
| CA13 | Titre d'onglet affiné sur les routes de détail | N14 |
| CA14 | Impossible d'atteindre zéro onglet | L1 |
| CA15 | Changement/fermeture de projet réinitialise onglets + récemment fermés | L2 |
| CA16 | Raccourcis globaux actifs même avec focus dans un champ, sans casser la saisie normale | L3 |
| CA17 | Dernier onglet dirty : garde de confirmation toujours appliquée | L4 |
| CA18 | Réouverture d'un onglet vers une entité disparue ne crashe pas | L5 |
| CA19 | Filtre sans résultat ne crashe pas | L6 |
| CA20 | Zéro nouvelle erreur TypeScript (`tsc --noEmit`) | CI ou local |
| CA21 | `/code-review` passé sur le diff de chaque sprint | Lancer `/code-review` sur la branche T101 |
