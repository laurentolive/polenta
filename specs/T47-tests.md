# T47 — Scénarios de test

Réf. `specs/T47.md`, `specs/T47-design.md`.

## Sprint 1 — Affichage + fix bouton

### Golden path

1. Un champ richtext contient le Markdown :
   ````
   ```drawio
   diagrams/system-context.drawio
   ```
   ````
   Ouvrir la vue (Excel/System/Edit) affichant ce champ en lecture (`RichTextViewer`)
   → le diagramme s'affiche visuellement (rendu SVG), pas de texte brut du bloc
   fenced visible.
2. Même contenu, ouvrir en édition (`RichTextField`) → même rendu visuel, le node
   n'est pas éditable en place (atom) mais le reste du document richtext autour
   reste éditable normalement.
3. Avec une ancre `diagrams/system-context.drawio#node-SYS-001` où `node-SYS-001`
   est l'id d'une cellule existante dans une page → la page contenant cette cellule
   s'affiche, la cellule est visuellement mise en évidence.
4. Double-clic sur le diagramme rendu → l'application draw.io externe (si installée
   sur le poste de test) s'ouvre sur le fichier.
5. Modifier le fichier `.drawio` référencé dans l'app externe, sauvegarder, revenir
   sur la fenêtre Polenta (alt-tab ou clic) → le rendu inline se met à jour sans
   action supplémentaire.
6. Champ `drawio` autonome (`EditView.tsx`) : cliquer sur "Ouvrir dans Draw.io" avec
   un chemin valide renseigné → le fichier s'ouvre réellement dans l'app externe
   (avant T47 : ne faisait rien).

### Cas limites

7. `diagrams/inexistant.drawio` référencé → état d'erreur inline explicite
   ("diagramme introuvable"), pas de crash de l'éditeur, le reste du document reste
   utilisable.
8. Fichier `.drawio` présent mais XML corrompu/non parsable → état d'erreur inline
   explicite ("diagramme invalide"), pas de crash.
9. `#node-id` qui ne correspond à aucune cellule ni aucune page → fallback sur la
   première page du fichier, pas d'erreur bloquante (l'ancre est juste ignorée).
10. Aucune application associée aux fichiers `.drawio` sur le poste de test →
    double-clic n'ouvre rien, aucune erreur visible ne casse l'UI (comportement
    standard `shell.openPath`).
11. Fichier `.drawio` dans un composant submodule non cloné dans le workspace
    courant → état "introuvable" (pas de résolution de chemin qui remonte une
    exception non gérée).
12. Rendu vérifié **sans connexion réseau active** (couper le réseau du poste de
    test) → le diagramme s'affiche identiquement (preuve du offline).

## Sprint 2 — Insertion

### Golden path

13. Dans un champ richtext (mode standalone, `RichTextField` sans contexte),
    cliquer "Insérer un diagramme draw.io", choisir un fichier `.drawio` à page
    unique → le diagramme s'insère au point du curseur, le Markdown généré contient
    le bloc `drawio` avec le bon chemin relatif.
14. Même flux dans le mode avec contexte (`RichTextToolbar`, ex. depuis `EditView`
    ou une popup d'édition d'élément).
15. Choisir un fichier `.drawio` contenant plusieurs `<diagram>` (pages) → une liste
    de pages s'affiche, sélectionner l'une d'elles → le node inséré référence le bon
    id de page.
16. Sauvegarder l'objet après insertion, fermer/rouvrir l'objet → le diagramme
    inséré s'affiche toujours correctement (round-trip Markdown stable).
17. Copier un bloc de texte contenant un diagramme inséré et le coller dans un autre
    champ richtext (même objet ou objet différent) → la référence fichier est
    préservée telle quelle, le diagramme s'affiche à l'identique dans la nouvelle
    position.

### Cas limites

18. Annuler la sélection de fichier (dialogue natif fermé sans choix) → aucune
    insertion, pas d'état d'erreur résiduel.
19. Insérer un diagramme puis supprimer le fichier `.drawio` référencé sur disque
    (hors app) → au prochain rendu, le bloc inséré affiche l'état d'erreur "diagramme
    introuvable" (pas de suppression automatique du bloc, cf. spec).

## Critères de non-régression

- Les diagrammes `.drawio` déjà référencés via un champ de type `drawio` autonome
  (hors richtext) continuent de fonctionner comme avant, en mieux (bouton
  fonctionnel).
- L'insertion d'images (flux existant, `handleInsertImage`) n'est pas affectée par
  l'ajout du bouton diagramme dans les mêmes toolbars.
- Le mode "raw markdown" (`toggleRaw` dans `RichTextField`/`RichTextToolbar`)
  affiche le bloc fenced `drawio` tel quel en texte brut, cohérent avec le reste du
  Markdown du champ.
