# T129 — Scénarios de test

## Scénarios nominaux

1. **Sélection en une action.** Ouvrir la Vue Système sur un projet mono-repo avec ≥2 types
   d'éléments définis sur le composant racine. Cliquer/focus sur le combobox fusionné → la liste
   complète (tous types du composant racine) s'affiche. Sélectionner une entrée autre que la
   courante → l'arbre et la vue document se rechargent immédiatement sur ce type, sans étape
   intermédiaire ni écran vide.
2. **Filtrage texte.** Taper une sous-chaîne présente dans le libellé du type (ex. "Test") →
   seules les entrées dont le libellé contient "test" (insensible à la casse) restent affichées.
   Effacer le texte → la liste complète réapparaît.
3. **Composant imbriqué (T123).** Sur un repo avec un composant local imbriqué à 2 niveaux (ex.
   `Boîtier › Capteurs`), l'entrée du combobox pour ce composant affiche
   `Boîtier › Capteurs / <Type>` pour chacun de ses types.
4. **Groupement multi-repo.** Sur un workspace avec ≥2 repos, la liste affiche un en-tête de
   section par repo ; les entrées d'un même repo (y compris ses composants locaux imbriqués)
   restent groupées sous cet en-tête après filtrage.
5. **Mono-repo, pas de groupe.** Sur un workspace à un seul repo, aucun en-tête de section
   n'apparaît, même si ce repo a plusieurs composants locaux — cohérent avec le combobox Composant
   actuel.
6. **Navigation clavier.** Ouvrir le combobox, taper un filtre réduisant la liste à plusieurs
   entrées, utiliser Flèche bas/haut pour surligner une entrée puis Entrée → cette entrée est
   sélectionnée, le contexte se recharge. Échap referme le dropdown sans changer la sélection.
7. **Persistance / restauration (T52).** Sélectionner une entrée, fermer et rouvrir l'application
   (ou naviguer ailleurs puis revenir à la Vue Système) → la même entrée (repo + composant + type)
   est restaurée.
8. **URL.** Sélectionner une entrée → les paramètres d'URL `repo`/`node` (ou `component`) et
   `type` (ou `level`) reflètent la sélection, au même format qu'avant ce ticket.
9. **Titre contextuel.** Après sélection, le titre `ViewHeader` affiche `"<Composant> /
   <Élément>"` correspondant à l'entrée choisie.

## Cas limites

10. **Composant sans type configuré.** Un `SystemNode` dont `objectTypes` est vide (ou absent)
    n'apparaît dans **aucune** entrée du combobox fusionné — vérifier qu'il n'y a pas d'entrée
    "orpheline" avec un libellé de type vide, et que ce composant reste néanmoins visible/gérable
    depuis l'onglet Structure.
11. **Aucune entrée du tout.** Workspace où aucun `SystemNode` n'a de type configuré (projet
    fraîchement créé sans schéma rempli) → le combobox affiche l'état vide existant
    (`sidebar.system.noComponentConfigured`) et reste désactivé ; l'arbre affiche le message vide
    déjà existant (`SystemPanel.tsx:407-412`).
12. **Filtre sans résultat.** Taper un texte ne correspondant à aucune entrée → dropdown vide ou
    message "aucun résultat" (à définir visuellement en Dev), sans erreur JS, le champ reste
    éditable pour corriger la saisie.
13. **Repo en lecture seule (HEAD détaché).** Sélectionner une entrée d'un repo dont le pin résout
    vers un tag/SHA plutôt qu'une branche → le bandeau "lecture seule" s'affiche comme aujourd'hui,
    les actions de création/édition restent désactivées.
14. **Beaucoup d'entrées.** Sur un workspace avec plusieurs repos × plusieurs composants imbriqués
    × plusieurs types chacun (≥50 entrées au total), vérifier que le dropdown reste utilisable
    (scroll interne, pas de dépassement visuel hors de l'écran) — le portail `document.body`
    (cf. design §3) doit éviter le rognage par l'ancêtre `overflow-hidden` du panneau.
15. **Clic extérieur.** Ouvrir le dropdown puis cliquer en dehors (ex. dans l'arbre en dessous) →
    le dropdown se ferme sans changer la sélection, le champ réaffiche le libellé de la sélection
    courante (pas le texte de filtre résiduel).
16. **Changement de sélection alors que le dropdown est en cours de filtrage sur un ancien
    `query`.** Sélectionner une entrée par clic pendant que `query` contient du texte résiduel →
    à la fermeture, l'input réaffiche le libellé de la nouvelle sélection, pas l'ancien `query`.

## Critères d'acceptation vérifiables

Repris et affinés depuis `specs/T129.md` :

- [ ] Un seul combobox visible dans `SystemPanel.tsx`, plus aucun `<select>` "Composant"/"Élément"
  séparé dans le DOM.
- [ ] Scénarios nominaux 1 à 9 passent manuellement.
- [ ] Cas limites 10 à 16 passent manuellement.
- [ ] `tsc --noEmit` (ou équivalent projet) : zéro nouvelle erreur.
- [ ] Aucune régression sur la `FilterBar` de filtrage des éléments dans l'arbre (sous le
  combobox), ni sur la création d'un nouvel élément (bouton "+ Nouvel élément", cf.
  `SPEC-SYSTEM-VIEW.md:133-135`) qui doit continuer à utiliser le type actuellement sélectionné.
