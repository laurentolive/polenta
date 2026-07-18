# T75 — Scénarios de test

Réf. `specs/T75.md`, `specs/T75-design.md`.

## Sprint 1 — Redimensionnement + menu contextuel de base

### Golden path

1. Insérer une image dans un champ richtext (`RichTextField`), cliquer dessus
   pour la sélectionner → des poignées de redimensionnement apparaissent aux
   coins.
2. Glisser une poignée de coin → l'image change de taille en conservant son
   ratio largeur/hauteur d'origine.
3. Relâcher la poignée, sauvegarder l'objet, fermer/rouvrir → l'image conserve
   la taille définie (round-trip Markdown stable).
4. Même scénario (1-3) sur un bloc drawio déjà inséré (`T47`).
5. Clic droit sur une image → menu contextuel avec au moins Redimensionner,
   Remplacer le fichier, Supprimer.
6. Clic droit sur un bloc drawio → menu contextuel avec en plus "Ouvrir dans
   draw.io".
7. "Ouvrir dans draw.io" depuis le menu contextuel ouvre le fichier dans
   l'application externe (même effet que le double-clic existant, qui reste
   fonctionnel en parallèle).
8. "Remplacer le fichier" sur une image : rouvre le sélecteur de fichier
   image, la nouvelle image remplace l'ancienne en conservant la taille
   affichée actuelle.
9. "Remplacer le fichier" sur un bloc drawio : rouvre le sélecteur `.drawio`
   (avec choix de page si plusieurs), le nouveau fichier remplace l'ancien en
   conservant la taille affichée actuelle.
10. "Supprimer" retire le bloc (image ou drawio) du document.
11. Après un redimensionnement, `Ctrl+Z` annule et restitue la taille
    précédente ; `Ctrl+Y`/`Ctrl+Shift+Z` la rétablit.

### Cas limites

12. Tenter de redimensionner en dessous de la taille plancher (40px) → le
    redimensionnement est clampé, pas de bloc à taille nulle ou négative.
13. Ouvrir le même document en lecture seule (`RichTextViewer`, ex. vue Excel
    non éditée) → l'image/le diagramme s'affiche à la taille définie, sans
    poignées ni menu contextuel au clic droit.
14. Un bloc drawio en état d'erreur (fichier introuvable/invalide, `T47`) :
    le menu contextuel reste accessible pour Remplacer/Supprimer.
15. Copier un bloc image ou drawio redimensionné et le coller dans un autre
    champ richtext → la taille définie est préservée dans le bloc collé.

## Sprint 2 — Rognage (crop) + changement de page/node-id

### Golden path

16. Clic droit sur une image → "Rogner" → un cadre de sélection ajustable
    apparaît par-dessus l'image ; ajuster ses poignées puis "Valider" → le
    rendu affiché se limite à la région sélectionnée.
17. Sauvegarder, fermer/rouvrir l'objet → le rognage image est restitué à
    l'identique (round-trip Markdown stable).
18. Même scénario (16-17) sur un bloc drawio : "Rogner" cadre le viewport
    affiché du diagramme (zoom/pan) sans modifier le fichier `.drawio`
    référencé sur disque (vérifier : ouvrir le fichier dans l'app draw.io
    externe après rognage, contenu inchangé).
19. Pendant le mode rognage, cliquer "Annuler" → le bloc reste inchangé (pas
    de crop appliqué).
20. Sur un bloc drawio ayant un `nodeId` déjà défini, utiliser "Changer de
    page/node-id" depuis le menu contextuel → liste des pages du même
    fichier, sélectionner une autre page → le bloc référence la nouvelle page
    sans ré-ouvrir le sélecteur de fichier.
21. Après un changement de page (point 20) sur un bloc qui avait un crop
    défini → le crop précédent est réinitialisé (pas de cadrage hérité
    incohérent avec la nouvelle page).
22. "Remplacer le fichier" sur un bloc image ayant un crop défini, avec une
    nouvelle image de dimensions différentes → le même rognage relatif
    (fractions) est réappliqué à la nouvelle image, pas de crop hors bornes.

### Cas limites

23. Pendant le rognage, tenter de réduire le cadre à une largeur ou hauteur
    nulle, ou de le faire sortir des bornes de l'image/diagramme → le cadre
    est clampé, "Valider" ne peut pas produire un crop vide ou hors bornes.
24. "Rogner" sur un bloc drawio en état d'erreur → l'action est désactivée
    dans le menu contextuel (rien à cadrer).
25. Undo/redo après un rognage suit le même comportement standard que le
    redimensionnement (point 11).

## Critères de non-régression

- L'insertion d'image et de diagramme draw.io (`T47`) fonctionne exactement
  comme avant pour un bloc jamais redimensionné/rogné (pas de changement de
  représentation Markdown).
- Tout document contenant des images stockées en syntaxe Markdown standard
  (`![alt](src)`, créées avant ce ticket) continue de s'afficher et de
  s'éditer normalement (compatibilité ascendante du parsing).
- Le mode "raw markdown" (`toggleRaw`) affiche le bloc fenced `image` (avec
  métadonnées) ou la syntaxe standard (sans métadonnées) selon le cas, tel
  quel en texte brut.
- Le surlignage de cellule mxGraph existant (`T47`) continue de fonctionner
  sur un bloc drawio n'ayant pas de crop défini.
