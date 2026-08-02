# T138 — Sprint 1 (dernier et seul sprint)

## Fichiers modifiés

- `apps/desktop/src/renderer/components/system/CoverageBadge.tsx` — **nouveau**, composant partagé
  (icône + tooltip natif, non éditable).
- `apps/desktop/src/renderer/components/system/SystemView.tsx` — nouveau `useQuery` sur
  `api.traceability.matrix`, `coverageByReqId`/`testsById` (useMemo), `coverageStatus` ajouté à
  `systemFields`/`systemFieldLabels` du panneau ⚙️ (filtré pour n'apparaître que sur les types
  `requirement`), props passées aux 3 vues, invalidation de la nouvelle query dans les 3
  `onLinkChange`.
- `apps/desktop/src/renderer/components/system/WordView.tsx` — badge dans l'en-tête de carte
  (`ItemCard`), à côté du badge de statut ; `coverageStatus` ajouté à `isSystemField()` et
  `fieldsAlreadyInHeader`.
- `apps/desktop/src/renderer/components/system/ExcelView.tsx` — colonne dédiée (branche avant le
  fallback `InlineCell`, comme `steps`/`link::`) ; exclue du filtre de colonne générique
  (`isFilterableColumn`) faute de valeur texte brute.
- `apps/desktop/src/renderer/components/system/EditView.tsx` — badge fixe au-dessus des champs,
  hors du pipeline `orderedFields`/`FieldRow`, toujours visible pour une exigence.
- `apps/desktop/src/renderer/lib/exportColumns.ts` — libellé `coverageStatus: 'Couverture'` ajouté
  (label partagé écran/export) mais **exclu** de `buildExportRows` (pas de valeur stockée sur
  l'objet → aurait produit une colonne vide dans les exports).
- `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` — `system.fieldConfig.colCoverage`,
  `system.coverage.noLinkedTest`.
- `specs/SPEC-TRACEABILITY.md`, `specs/SPEC-SYSTEM-VIEW.md`, `specs/SPEC-INDEX.md` — voir §Mises à
  jour SPEC ci-dessous.

## Comportement implémenté

Conforme à `specs/T138.md`/`specs/T138-design.md` : champ système optionnel, désactivé par défaut
dans Excel/Word (coché via ⚙️), toujours affiché en Édition (écart pré-existant sur l'onglet
"Édition" du panneau, non comblé par ce ticket). Réutilise `computeCoverage()`/
`computeCoverageStatus()` via `api.traceability.matrix` — aucune logique de calcul dupliquée côté
renderer. Icônes : `Circle` (not_covered, neutre), `AlertCircle` (covered, warning atténué),
`CheckCircle2` (validated), `XCircle` (failing), `AlertTriangle` (needs_revalidation) — tranché en
dev, le design laissait ce choix ouvert.

## Divergences par rapport au design

Deux ajouts trouvés en auto-revue (`/code-review`, effort medium), absents de
`specs/T138-design.md`, corrigés avant ce commit :

1. **Rafraîchissement en direct incomplet** — le design ne précisait pas d'invalidation de la
   nouvelle query au moment où un lien test↔exigence est ajouté/retiré depuis l'une des 3 vues ;
   sans ça, le badge restait périmé après une modification de lien dans la même session (violait le
   comportement attendu #7/#9 de `specs/T138.md`). Les 3 `onLinkChange` invalident maintenant aussi
   `['traceability-matrix', repoPath]` en plus de `['links-all', repoPath]`.
2. **Coût non nécessaire en Édition** — la condition d'activation de la query (`coverageNeeded`)
   se déclenchait pour **tout** objet ouvert en vue Édition, pas seulement les exigences ; ouvrir un
   cas de test en édition recalculait inutilement la couverture de tout le repo alors qu'`EditView`
   n'affiche jamais le badge pour un objet de catégorie `test`. Condition resserrée à
   `viewMode === 'edit' && effectiveType?.category === 'requirement'`.

Aucune autre divergence fonctionnelle par rapport au design validé.

## Mises à jour SPEC (dernier sprint)

- `specs/SPEC-TRACEABILITY.md` §2.2 — note ajoutée : `coverageStatus` est désormais aussi consommé
  par les vues Excel/Word/Édition (troisième point de consommation de `computeCoverage()`, après la
  matrice et les dashboards).
- `specs/SPEC-SYSTEM-VIEW.md` §"Configuration des champs — ⚙️" — paragraphe ajouté documentant le
  nouveau champ système `coverageStatus` : proposé uniquement pour les types `requirement`,
  placement par vue (colonne Excel / en-tête Word / badge fixe Édition), et rappel explicite (avec
  renvoi vers `SPEC-AUDIT.md`) que le paragraphe existant de cette section sur "Édition a sa propre
  sélection de champs indépendante" ne correspond pas à l'implémentation réelle — écart pré-existant,
  non introduit ni corrigé par ce ticket.
- `specs/SPEC-INDEX.md` — colonne `MAJ` mise à jour (`T77` → `T138`) pour la ligne
  `SPEC-TRACEABILITY.md §1–2` ; nouvelle ligne ajoutée pour `SPEC-SYSTEM-VIEW.md §Configuration des
  champs` (absente de l'index jusqu'ici, alors que la section existe depuis longtemps).

## Comment tester manuellement

1. Ouvrir un projet avec au moins une exigence liée à un test, une exigence non couverte, et si
   possible un lien marqué à revalider.
2. Vue Système → Tableau (Excel) → icône ⚙️ → cocher `coverageStatus` : une colonne "Couverture"
   apparaît avec l'icône attendue par ligne ; décocher la fait disparaître.
3. Idem en vue Document (Word) : icône dans l'en-tête de carte, à côté du badge de statut.
4. Ouvrir une exigence en Édition : badge visible sans avoir besoin de le cocher nulle part.
5. Survoler le badge : tooltip listant les tests liés et leur statut (ou "Aucun test lié").
6. Avec le badge visible, ajouter/retirer un lien test↔exigence via le combobox de liens dans la
   même vue : l'icône se met à jour sans changer de panneau ni recharger.
7. Ouvrir un cas de test en Édition : pas de badge, et vérifier (devtools réseau/IPC) qu'aucun appel
   `traceability:matrix` n'est déclenché pour cet objet.
8. Exporter en Word/Excel avec `coverageStatus` coché : vérifier qu'aucune colonne "Couverture" vide
   n'apparaît dans le document généré.

## Critères d'acceptation (`specs/T138.md`)

Tous cochés — cf. `specs/T138-tests.md` pour le détail des scénarios couverts par le test manuel
ci-dessus. TypeScript : `pnpm --filter @polenta/desktop typecheck` → 0 erreur. Pas de script `lint`
configuré dans ce package (rien à exécuter). Pas de suite de tests automatisés existante pour
`components/system/*` (rien à étendre dans ce sprint).

## Post-merge — retour utilisateur après test sur projet réel

Après merge dans `main` et test sur un vrai projet (`C:\Dev\polenta_ws\PL`), retour direct : afficher
le **libellé texte** du statut plutôt que l'icône seule. `CoverageBadge.tsx` modifié en conséquence —
`<Icon>` remplacé par un `<span>` textuel coloré (mêmes couleurs par statut), texte traduit via les
nouvelles clés `system.coverage.status.*` (`fr.json`/`en.json` : "Non couvert"/"Couvert"/"Validé"/
"En échec"/"À revalider"). Tooltip inchangé. Colonne Excel repassée en alignement par défaut (le
`text-center` avait du sens pour une icône, pas pour un mot). Vérifié dans l'app buildée sur les 3
vues (Excel : "Couvert" dans la colonne ; Word : "Couvert" dans l'en-tête de carte ; Édition :
"Couvert" au-dessus des champs) — `tsc --noEmit` toujours à 0 erreur.
