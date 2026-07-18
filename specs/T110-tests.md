## Sprint 1 — Catalogue de rôles (popup d'édition, tout nœud)

### Nominaux

1. **Créer un catalogue sur une interface existante** : ouvrir l'édition d'un nœud interface déjà monté (sans rôles), ajouter 2 rôles (`controller`, `device`) avec labels, enregistrer → `schema.roles` du repo interface contient les 2 entrées ; rouvrir la popup → catalogue pré-rempli à l'identique.
2. **Sélectionner des rôles joués depuis le catalogue** : sur le même nœud, avec le catalogue rempli, cocher `device` dans « Rôles joués », enregistrer → `schema.implements[].roles` du parent contient `['device']` ; le catalogue de l'interface n'est pas modifié par cette action seule.
3. **Modifier le label d'un rôle du catalogue** : renommer le `label` d'un rôle existant sans toucher son `name`, enregistrer → seul le `label` change dans `schema.roles` ; les `parentRoles` déjà cochés (référencés par `name`) restent cochés.
4. **Supprimer un rôle du catalogue** : supprimer un rôle non utilisé par aucun `parentRoles`, enregistrer → disparaît de `schema.roles`, aucun effet sur `implements`.

### Cas limites

5. **Nouveau repo jamais marqué interface** (`schema.roles` absent/vide, `node.isInterface === false` avant édition) : ouvrir la popup d'édition de ce nœud (monté normalement comme composant) → la section « Rôles exposés par ce repo » est bien présente (pas de gating par `kind`), ajouter un premier rôle et enregistrer → `schema.roles` du repo devient non vide ; recharger l'arbre (fermer/rouvrir Structure ou rafraîchir la query workspace) → `node.isInterface` passe à `true`, le badge « Interface » apparaît. Confirme que la promotion composant→interface est possible exclusivement via Structure.
6. **Rôle hérité hors catalogue** : préparer un projet où `implements[].roles` contient une valeur absente du catalogue courant de l'interface (ex. catalogue modifié après coup ailleurs) → à l'ouverture de la popup, ce rôle apparaît en lecture seule avec badge « hors catalogue » et une case à cocher pour le retirer ; le laisser coché et enregistrer → il est préservé tel quel dans `implements[].roles`.
7. **Catalogue vide** : ouvrir l'édition d'une interface sans rôles déclarés → section « Rôles joués » affiche un état vide explicite (pas de case à cocher), pas d'erreur.
8. **Nom de rôle dupliqué dans le catalogue** : ajouter deux rôles avec le même `name` → comportement identique à l'ancien onglet (pas de déduplication forcée, laissé tel quel — hors scope T110).

---

## Sprint 2 — Interfaces implémentées (popup d'édition, tout nœud)

### Nominaux

9. **Ajouter une implémentation avec rôles sourcés du catalogue** : éditer un composant qui monte une interface avec catalogue `[controller, device]`, ajouter une ligne `implements` référençant cette interface, cocher `device` → enregistrer → `schema.implements` du composant contient `{ interface: <nom>, roles: ['device'] }`.
10. **Plusieurs implémentations sur le même composant** : ajouter 2 lignes référençant 2 interfaces différentes, chacune avec ses propres rôles cochés → les deux entrées sont enregistrées indépendamment dans `schema.implements`.
11. **Supprimer une ligne d'implémentation** : retirer une ligne existante, enregistrer → l'entrée correspondante disparaît de `schema.implements`, les autres lignes intactes.
12. **Version implémentée affichée en lecture seule** : pour une ligne dont l'interface est résolvable dans l'arbre courant, le pin résolu s'affiche à côté (comme l'ancien onglet) sans être éditable.

### Cas limites

13. **Interface non montée localement (fallback texte libre)** : saisir un nom d'interface qui ne correspond à aucun mount connu → le champ rôles de cette ligne bascule en `<input>` texte libre (pas de cases à cocher), la version affiche « non résolu » — enregistrement fonctionne quand même.
14. **Renommage d'un mount interface pendant l'édition** (cas déjà géré par `renameDependency`, T74 sprint 2) : vérifier que la cascade de renommage existante continue de fonctionner sans régression après l'ajout de la section « Interfaces implémentées » (non-régression, pas de nouveau comportement attendu ici).
15. **Composant sans aucune implémentation** : section affiche un état vide explicite, ajout de la première ligne fonctionne.

---

## Sprint 3 — Champ `roles` d'exigence + suppression onglet

### Nominaux

16. **Champ `roles` sourcé du catalogue** : dans un repo interface avec catalogue `[controller, device]` et un type d'exigence ayant un champ `multi_enum` nommé `roles` (avec ou sans `values:` existantes), ouvrir l'édition d'une exigence → les cases à cocher affichées sont exactement `controller`/`device` (pas les `values:` du champ, si divergentes).
17. **Cocher un rôle sur une exigence** : cocher `controller`, enregistrer → `req.fields.roles` contient `['controller']`, comportement de sauvegarde inchangé (même mécanisme que les autres `multi_enum`).
18. **Matrice de conformité toujours fonctionnelle** (non-régression) : avec une exigence taguée `controller` (via le nouveau sélecteur) et un composant déclarant jouer `controller` (via Sprint 1/2), la matrice de conformité (`interface-compliance.service.ts`) montre la cellule correspondante comme applicable — même résultat qu'avant T110 pour des données équivalentes.
19. **Onglet Interfaces absent** : ouvrir `/schema` sur n'importe quel repo → la barre d'onglets affiche uniquement « Structure » et « Liens », plus d'onglet « Interfaces ».

### Cas limites

20. **Projet existant sans catalogue** (`schema.roles` vide) mais avec un champ `roles` ayant des `values:` codées en dur : ouvrir une exigence de ce type → les cases à cocher affichent les `values:` du champ (fallback), comme avant T110 — aucune régression.
21. **Champ `multi_enum` qui ne s'appelle pas `roles`** : comportement générique inchangé, ne source jamais depuis un catalogue quel qu'il soit.
22. **Champ `roles` sur un repo qui n'est pas une interface** (`multi_enum` nommé `roles` par coïncidence dans un repo composant) : `schema.roles` absent/vide sur ce repo → fallback sur `field.values`, comportement identique à un `multi_enum` normal.

## Critères d'acceptation globaux (cf. `T110.md`)

Repris tels quels dans `T110.md` — chaque sprint clôt un sous-ensemble des 7 critères ; le sprint 3 clôt les critères 4, 5, 6, 7 et valide rétroactivement que les critères 1-3 (sprints 1-2) n'ont pas régressé après la suppression de l'onglet.
