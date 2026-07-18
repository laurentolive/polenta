# T51 — Scénarios de test

Voir [T51.md](T51.md) (spec) et [T51-design.md](T51-design.md) (design).

## Scénarios nominaux (golden path)

1. **Filtre simple "contient" sur une colonne** — dans la vue Excel d'un type
   d'exigence, ouvrir le popover de la colonne `status` (icône d'en-tête),
   saisir `draft`. Seules les lignes dont le statut affiché contient `draft`
   restent visibles ; les dossiers restent tous affichés. L'icône de la
   colonne `status` passe en couleur active.
2. **Deux filtres de colonnes combinés (ET)** — en plus du filtre `status` du
   scénario 1, ouvrir le popover de la colonne `priority`, saisir `high`.
   Seules les lignes dont le statut contient `draft` **et** dont la priorité
   contient `high` restent visibles.
3. **Filtre colonne + filtre global combinés (ET)** — avec le filtre `status`
   du scénario 1 actif, saisir un texte dans la barre de recherche globale
   (au-dessus de l'arbre) qui ne correspond qu'à une partie des lignes déjà
   filtrées par colonne. Seule l'intersection reste visible.
4. **Option "mot entier"** — filtrer la colonne `name` sur `pompe` avec
   l'option mot entier activée : une ligne nommée "pompe à eau" apparaît,
   une ligne nommée "pompes" (pluriel, sans limite de mot) n'apparaît pas.
5. **Option "regex"** — filtrer une colonne `id` avec l'option regex activée
   et le motif `^SYS-0(1|2)`. Seules les lignes dont l'ID commence par
   `SYS-01` ou `SYS-02` restent visibles.
6. **Option "casse sensible"** — filtrer une colonne texte sur `Pompe` avec
   casse sensible activée : une ligne contenant "Pompe" apparaît, une ligne
   contenant seulement "pompe" (minuscule) n'apparaît pas.
7. **Effacer un filtre de colonne** — avec un filtre actif sur une colonne,
   rouvrir son popover, cliquer sur `✕` (ou vider le champ) : la colonne
   redevient neutre (icône non active), les lignes précédemment masquées par
   ce filtre réapparaissent (sous réserve des autres filtres actifs).
8. **Fermeture du popover** — ouvrir un popover de filtre colonne, cliquer en
   dehors : le popover se ferme, le filtre saisi reste actif. Rouvrir avec
   `Échap` cette fois : le texte du filtre est vidé et le popover se ferme.

## Cas limites

- **Regex invalide** (ex. `[abc`) saisie avec l'option regex activée :
  aucune ligne n'est exclue par ce filtre (pas de crash, pas d'écran blanc,
  comportement équivalent à filtre inactif — cf. `buildFilterRegex` retourne
  `null` sur erreur `try/catch`).
- **Colonne `link::<type>`** : le filtre matche sur la même valeur texte que
  celle affichée dans la cellule (IDs concaténés des objets liés côté source
  et cible), pas sur le libellé du type de lien.
- **Colonne `steps`** : aucune icône de filtre affichée.
- **Colonne masquée après avoir été filtrée** (retirée de `visibleFields` via
  le sélecteur de colonnes ou le drag & drop de réorganisation) : son filtre
  est oublié — la réafficher plus tard ne réactive pas l'ancien filtre.
- **Changement de composant/type sélectionné** (combobox Composant/Élément) :
  tous les filtres de colonnes sont réinitialisés (nouvel arbre de colonnes,
  état local repart à vide).
- **Fermeture puis réouverture du projet** : filtres de colonnes non
  persistés, repartent à vide (comme `colWidths`/`collapsedFolders`
  aujourd'hui).
- **Aucune ligne ne correspond à la combinaison des filtres actifs** :
  message `Aucun élément` affiché (état vide déjà existant), sans erreur.
- **Vue Word** : aucune icône ni popover de filtre colonne — le filtre global
  reste seul disponible, comportement inchangé.
- **Filtre colonne actif puis édition inline de la valeur filtrée** (ex.
  modifier le statut d'une ligne visible pour qu'il ne corresponde plus au
  filtre de sa colonne) : la ligne disparaît de l'affichage au prochain
  rendu, sans confirmation ni blocage — comportement attendu d'un filtre live
  (cohérent avec le filtre global existant).
- **Régression filtre global** : le comportement actuel du filtre global
  (barre au-dessus de l'arbre, dossiers toujours visibles, état vide `Aucun
  élément`) reste identique en l'absence de tout filtre de colonne.
- **Régression `FilterBar`/`CampaignListView`** : après extraction de
  `buildFilterRegex`/`FilterOptionsToggle`, le filtre de l'arbre (sidebar) et
  le filtre de la liste de campagnes se comportent exactement comme avant
  (aucun changement visuel ni fonctionnel attendu de ce côté).

## Critères d'acceptation vérifiables

- [ ] TypeScript compile sans nouvelle erreur (`apps/desktop`).
- [ ] Scénarios nominaux 1-8 ci-dessus rejoués manuellement en Electron avec
      succès.
- [ ] Tous les cas limites ci-dessus vérifiés manuellement, en particulier
      regex invalide (pas de crash) et purge de filtre sur colonne masquée.
- [ ] Aucune régression sur le filtre global (vue Excel et Word) ni sur le
      filtre de l'arbre sidebar / liste de campagnes.
- [ ] `/code-review` passé sur le diff, corrections appliquées.
