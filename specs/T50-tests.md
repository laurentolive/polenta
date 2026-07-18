# T50 — Scénarios de test

Voir [T50.md](T50.md) (spec) et [T50-design.md](T50-design.md) (design).

## Scénarios nominaux (golden path)

1. **Créer un type de campagne avec champ richtext** — dans l'éditeur de schéma, créer un
   objectType `category: campaign` avec un champ `description` de type `richtext`. Ouvrir
   "Nouvelle campagne" : le type est sélectionnable, le champ `description` s'affiche comme un
   éditeur richtext (barre d'outils, saisie de texte formaté).
2. **Créer une campagne avec le champ rempli** — remplir titre + description richtext (gras,
   lien), sélectionner des tests, créer. La page de détail affiche la description rendue en
   richtext (formatage conservé), pas de champ "Description" hardcodé résiduel.
3. **Modifier les champs personnalisés après création** — depuis la page de détail, cliquer sur
   "Modifier", changer le texte richtext, enregistrer. Rafraîchir la page : la nouvelle valeur est
   persistée (relecture du YAML).
4. **Aucun type de campagne défini** — projet sans objectType `category: campaign` dans son
   schéma : le formulaire de création n'affiche aucune section "champs personnalisés" ni champ
   "Description", la création fonctionne normalement (titre + tests + baseline).

## Cas limites

- **Campagne créée avant ce ticket** (YAML avec `description:` et sans `fields`/`objectTypeRef`) :
  se charge sans erreur ; `fields` est traité comme `{}` ; aucune section champs personnalisés
  affichée (pas de `typeDef` résolu) ; l'ancienne `description` n'est plus visible nulle part
  (comportement accepté, documenté hors scope).
- **`objectTypeRef` invalide ou type supprimé du schéma depuis la création** : la page de détail
  ne plante pas — si `getCampaignTypeDef` ne trouve rien, ne rien afficher (pas de section champs).
- **Champ requis vide à la création** : comportement identique à `test.new.tsx` — pas de blocage
  supplémentaire imposé par ce ticket (les règles de champ requis restent celles du schéma/`DynamicField`,
  non durcies ici).
- **Plusieurs types de campagne définis** : le `<select>` de type liste tous les objectTypes
  `category: campaign` toutes composantes/nœuds confondus (mirroring `test.new.tsx`), l'utilisateur
  choisit celui pertinent.
- **Édition concurrente** (deux fenêtres modifient la même campagne) : dernier `update()` gagne
  (pas de verrou, comportement préexistant identique à `updateRun`/`close`/`addTests`, non traité
  par ce ticket).
- **Annuler l'édition en cours** : le bouton "Annuler" du mode édition des champs restaure l'état
  affiché sans appeler `api.campaigns.update`.

## Critères d'acceptation vérifiables

- [ ] TypeScript compile sans nouvelle erreur (`packages/types`, `packages/api-client`,
      `packages/zod-schemas`, `apps/desktop`).
- [ ] Aucune référence résiduelle à `TestCampaign.description` dans le code (grep clean après
      implémentation, hors historique/spec).
- [ ] Scénarios nominaux 1-4 ci-dessus rejoués manuellement en Electron avec succès.
- [ ] Régression : ajout de tests à une campagne, clôture, suppression, filtre par
      `component`/`level` fonctionnent toujours comme avant (page `campaign.$campaignId.tsx`).
- [ ] `/code-review` passé sur le diff, corrections appliquées.
