## Sprint 1 — DynamicField + 9 écrans formulaire + backend

### Nominaux

1. **Créer une exigence avec un champ `multi_enum` générique** : sur un type d'exigence ayant un champ `multi_enum` non nommé `roles` (avec `values: [a, b, c]`), ouvrir `req.new.tsx`, cocher `a` et `c` → sauvegarder → `fields.<nom>` vaut `"a, c"` dans le fichier YAML de l'exigence. Rouvrir l'exigence (`req.$reqId.tsx`) → `a` et `c` apparaissent cochés, `b` non coché.
2. **Répéter le scénario 1 sur les 8 autres écrans** (`test.new.tsx`, `test.$testId.tsx`, `campaign.new.tsx`, `campaign.$campaignId.tsx`, `RequirementEditModal.tsx`, `TestCaseEditModal.tsx`) pour le type d'objet concerné — même comportement, cases à cocher au lieu du champ texte CSV actuel.
3. **Champ `roles` sourcé du catalogue depuis un formulaire** : sur un repo dont `schema.roles` contient `[controller, device]`, ouvrir `req.new.tsx` pour un type d'exigence ayant un champ `multi_enum` nommé `roles` → les cases à cocher affichées sont `controller`/`device` (pas les `values:` codées en dur du champ, si divergentes) — même résultat qu'en Vue Système (`EditView.tsx`).
4. **Correction du bug CSV/array côté matrice de conformité** : préparer un composant déclarant `implements[].roles: ['host']` et une exigence taguée `roles: 'ghost'` (via le champ `multi_enum`) → la matrice de conformité (`interface-compliance.service.ts`) ne considère PAS cette exigence comme applicable à ce composant (avant le correctif, `.includes()` sur la sous-chaîne aurait matché à tort).

### Cas limites

5. **`field.values` vide et champ non `roles`** : champ `multi_enum` sans `values:` définies → cases à cocher absentes, message d'état vide affiché (clé i18n `system.editView.noConfiguredValue`), pas d'erreur, formulaire reste sauvegardable.
6. **Champ `roles` sans catalogue** (`schema.roles` vide/absent) : fallback sur `field.values` du champ, comportement générique inchangé (non-régression du fallback documenté en T110 §3.2d).
7. **Valeur existante contenant des espaces irréguliers** (ex. `"a,b ,  c"` écrite par une version antérieure ou modifiée à la main) : à l'ouverture, `parseMultiEnumValue` normalise correctement en `['a', 'b', 'c']` (trim + filtre des vides) — les 3 cases apparaissent cochées, pas de doublon ni de case fantôme pour une chaîne vide.
8. **Décocher toutes les valeurs** : partir d'un champ avec 2 valeurs cochées, décocher les deux → valeur sauvegardée devient chaîne vide `""`, rouverture affiche 0 case cochée (pas d'erreur de parsing sur chaîne vide).
9. **Champ `multi_enum` en lecture seule** (objet en statut non éditable / `disabled=true`) : les cases à cocher sont désactivées (pas de toggle possible), valeurs actuelles restent visibles.

---

## Sprint 2 — Popover à cases à cocher (WordView + ExcelView)

### Nominaux

10. **ExcelView — édition inline via popover** : dans une vue Tableau, cliquer sur une cellule d'un champ `multi_enum` → un popover s'ouvre ancré sous la cellule avec les cases à cocher ; cocher une valeur → persistée immédiatement (visible dans la cellule après fermeture) sans qu'il soit nécessaire de valider explicitement.
11. **WordView — édition inline via popover** : même scénario dans la vue Document — clic sur la valeur du champ ouvre le même popover (composant partagé `MultiEnumPopover`), comportement de persistance identique.
12. **Fermeture par clic extérieur** : popover ouvert (ExcelView ou WordView), clic en dehors du popover → se ferme, dernière sélection (déjà commitée à chaque toggle) reste affichée dans la cellule/le champ.
13. **Champ `roles` en édition inline** : sur un repo avec catalogue de rôles renseigné, ouvrir le popover d'un champ `roles` depuis ExcelView ou WordView → mêmes options que dans `EditView.tsx`/`DynamicField.tsx` (cohérence inter-écrans totale pour ce ticket).

### Cas limites

14. **Échap ferme le popover** : popover ouvert, appuyer sur Échap → se ferme (les toggles déjà effectués avant l'appui restent commités — pas de notion de brouillon à annuler pour ce type de champ, contrairement au richtext).
15. **Deux popovers multi_enum ne s'ouvrent jamais simultanément** : ouvrir le popover d'une cellule, puis cliquer sur une autre cellule `multi_enum` avant de fermer la première → la première se ferme, la seconde s'ouvre (même comportement que `activeRichtextPopover`/`activeLinkPopover` existants, un seul état actif à la fois).
16. **Popover proche du bord de la fenêtre** (dernière colonne à droite / dernière ligne en bas du tableau) : le popover reste visible et cliquable, pas de positionnement hors écran (non-régression sur le calcul `top`/`left` déjà utilisé pour richtext/link, réutilisé tel quel).
17. **Vue en lecture seule** (`isSystem` ou objet non éditable) : clic sur la cellule/le champ `multi_enum` n'ouvre pas de popover, affichage de la chaîne CSV brute comme aujourd'hui.

### Non-régression

18. **Champ `enum` (simple sélection)** dans les 4 endroits touchés par ce ticket (DynamicField, EditView, WordView, ExcelView) : comportement `<select>` strictement inchangé.
19. **TypeScript / lint** : `npx tsc --noEmit` sur `apps/desktop` et `packages/types` — zéro nouvelle erreur.

## Critères d'acceptation globaux (cf. `specs/T126.md`)

- Les 6 critères listés dans `specs/T126.md` § Critères d'acceptation sont couverts respectivement par : (1)→#1-3, (2)→#3/#13, (3)→#10-12, (4)→#4, (5)→#18, (6)→#19.
