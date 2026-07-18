# T92 — Scénarios de test

## Scénarios nominaux (golden path)

### T92-01 — Barre de titre uniforme sur les vues sans Publier
1. Ouvrir successivement, dans un projet ouvert : Exigences (`/requirements`), Tests
   (`/tests`), Suivi (`/dashboard`), Requêtes (`/query`), Modèle de données (`/schema`).
2. **Attendu** : chaque vue affiche une barre de titre de même hauteur/padding
   (`px-4 py-2.5 border-b border-edge`) et un titre de même taille/graisse
   (`text-sm font-semibold text-ink`) — plus de `text-xl`/`text-lg`/`text-base` visibles
   sur ces vues.

### T92-02 — Barre de titre + Publier sur la vue Système
1. Ouvrir un projet, repo racine checkouté sur sa branche d'intégration, une
   modification en attente sur une exigence.
2. Aller sur la vue Système (`/product`).
3. **Attendu** : barre de titre identique en taille/padding à T92-01 ; bouton "Publier"
   visible en haut à droite de cette même barre, actif (non grisé) ; aucun élément de la
   vue (toolbar, sélecteur Excel/Word, arbre) n'est recouvert par le bouton ni ne le
   recouvre.

### T92-03 — Barre de titre + Publier sur la vue Version
1. Même contexte que T92-02.
2. Aller sur la vue Version (`/graph`).
3. **Attendu** : bouton "Publier" visible au même endroit visuel (haut-droite de la
   barre de titre) que sur la vue Système ; le nom de branche affiché en sous-titre
   (`subtitle`) reste visible sous le titre "Arbre de versions".

### T92-04 — Publier : popup ancré sous le bouton
1. Suite de T92-02, cliquer sur "Publier".
2. **Attendu** : le popup de saisie du titre apparaît juste sous le bouton, bord droit
   aligné avec le bouton ; le reste de la vue (arbre, toolbar) reste visible et net —
   pas d'assombrissement plein écran.
3. Saisir un titre, valider.
4. **Attendu** : séquence de publication inchangée (cf. T87-02) — seul l'habillage du
   popup a changé, pas son contenu ni son comportement métier.

### T92-05 — Conflit de merge : popup d'erreur ancré
1. Provoquer un conflit de merge (cf. T87-07) puis cliquer "Publier".
2. **Attendu** : le popup "Publication impossible" apparaît ancré au même endroit que
   T92-04 (sous le bouton), avec la liste des fichiers en conflit et le lien
   "Résolution manuelle (Version)", contenu identique à avant ce ticket.

### T92-06 — Panneaux latéraux : en-têtes manquants ajoutés
1. Ouvrir le panneau "Système" (icône `Layers` de l'`ActivityBar`).
2. **Attendu** : un en-tête `section-label` "Système" apparaît en haut du panneau,
   au-dessus du combobox composant/élément, dans un conteneur `px-4 py-3 border-b
   border-edge` identique aux autres panneaux.
3. Ouvrir le panneau "Suivi".
4. **Attendu** : idem avec le libellé "Suivi", au-dessus des sections
   Dashboards/Requêtes.

### T92-07 — `RichTextToolbar` positionnée de façon cohérente
1. Ouvrir un cas de test (`/test/$testId`), placer le focus dans un champ richtext.
2. Noter la position verticale de la barre d'outils richtext dans l'en-tête.
3. Répéter sur : nouveau cas de test, détail de campagne, nouvelle campagne, exécution
   de test (`campaign.$campaignId.execute.$testId`), vue Système (un champ richtext
   d'exigence).
4. **Attendu** : la barre d'outils richtext apparaît à la même position verticale et
   avec le même espacement dans l'en-tête sur les 6 vues — plus de décalage entre
   `h-8 mb-4 pb-2` (test), `mb-1` (campagne), `px-6 py-3` (exécution), etc.

## Cas limites

### T92-08 — Vue sans contexte projet (`/account`)
1. Ouvrir le panneau "Compte".
2. **Attendu** : la barre de titre de `/account` est uniformisée (taille/padding) mais
   n'affiche aucun bouton "Publier" (pas de `currentProjectId` pertinent) — pas
   d'erreur, pas d'espace vide anormal réservé à droite.

### T92-09 — Titre éditable inline (Suivi)
1. Ouvrir un dashboard existant depuis le panneau Suivi.
2. Cliquer dans le titre, le modifier, sortir du champ (`onBlur`).
3. **Attendu** : renommage toujours fonctionnel (comportement `dashboard.tsx` inchangé),
   l'`<input>` de titre a simplement la même taille de police que les titres statiques
   des autres vues.

### T92-10 — Redimensionnement fenêtre avec popup Publier ouvert
1. Ouvrir le popup "Publier" (T92-04) sans valider.
2. Redimensionner la fenêtre de l'application (agrandir/réduire).
3. **Attendu** : le popup reste ancré sous le bouton (suit le bouton, ne se retrouve pas
   à une position fixe du viewport devenue incohérente).

### T92-11 — Fermeture au clavier du popup d'erreur
1. Provoquer un conflit (T92-05) pour afficher le popup "Publication impossible".
2. Appuyer sur Échap.
3. **Attendu** : le popup se ferme (nouveau comportement — avant ce ticket, seul le clic
   sur le fond plein écran le fermait ; `publishError` repasse à `null`).

### T92-12 — Navigation pendant qu'un popup Publier est ouvert
1. Ouvrir le popup "Publier" sur la vue Système (T92-04), sans valider.
2. Naviguer vers une autre vue (ex. Exigences) via le panneau latéral.
3. **Attendu** : pas de popup ni de couche de capture de clic invisible qui persiste
   après la navigation (l'ancien `ModificationControl` est démonté avec la vue, un
   nouveau est monté proprement sur la vue suivante — cf. décision §4.1 du design).

### T92-13 — `diff.tsx` : dérogation typographique du titre
1. Ouvrir une comparaison de fichier (`/diff`).
2. **Attendu** : le chemin de fichier reste affiché en `font-mono`, dans une barre de
   titre de même hauteur/padding que les autres vues — seule la police du contenu du
   titre diffère (dérogation assumée, cf. design §4.4), pas sa taille de base ni le
   conteneur.

### T92-14 — Page d'exécution de campagne : pas de régression sans `RichTextToolbar`
1. Ouvrir `campaign.$campaignId.run.$testId` (lecture seule, pas de champ richtext).
2. **Attendu** : barre de titre uniformisée (padding/taille), aucune barre d'outils
   richtext n'apparaît (comportement identique à avant ce ticket — cette vue n'en avait
   pas).

### T92-15 — Non-régression T87 (délégué)
1. Rejouer T87-02 (Publier mode nominal), T87-03 (mode avancé), T87-03b (bloqué sur
   `int-*` non concordante).
2. **Attendu** : résultat métier strictement identique à `T87-tests.md` — seul
   l'habillage visuel (popup ancré au lieu de centré, bouton dans la barre au lieu de
   flottant) a changé.

## Critères d'acceptation vérifiables

- [ ] CA1 (T92.md) — plus aucune vue migrée ne définit son propre titre `<h1>`/`<span>`
      avec une taille de police différente — T92-01, T92-02
- [ ] CA2 — même classe de taille/graisse et même padding de conteneur sur toutes les
      vues migrées — T92-01
- [ ] CA3 — `ModificationControl` ne contient plus de `position: fixed` — inspection de
      code + T92-02/T92-03 (le bouton suit la vue, pas le viewport)
- [ ] CA4 — bouton Publier sans chevauchement sur la vue Système — T92-02
- [ ] CA5 — plus d'`Overlay` plein écran pour le flux Publier — T92-04, T92-05
- [ ] CA6 — `SystemPanel`/`DashboardPanel` affichent un `section-label` — T92-06
- [ ] CA7 — padding uniforme sur tous les panneaux latéraux — T92-06 (+ inspection
      visuelle rapide des panneaux déjà conformes, non régressés)
- [ ] CA8 — `RichTextToolbar` positionnée de façon cohérente sur les 6 vues — T92-07
- [ ] CA9 — aucune régression du flux Publier (T87) — T92-15
- [ ] Cas limites T92-08 à T92-14 passent sans erreur ni incohérence visuelle
