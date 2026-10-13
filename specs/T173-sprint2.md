# T173 — Sprint 2 : liste de repli « Impact à vérifier », i18n, mises à jour SPEC

Réf. : `specs/T173.md`, `specs/T173-design.md`, `specs/T173-tests.md`, `specs/T173-sprint1.md`.
Travail sur `main`. Sprint final.

## Fichiers modifiés

**Renderer**
- `contexts/ImpactAnalysisContext.tsx` — sentinelle `REVALIDATION_IMPACT_ID = '__revalidation__'`.
- `components/impact/RepoBadge.tsx` (nouveau) — extrait de `routes/impact-analysis.tsx`.
- `components/impact/RevalidationList.tsx` (nouveau) — liste des éléments marqués : chevron,
  case, badge EX/TC, id cliquable, ⚠, titre, badge de repo, statut, « Lever le flag » ; dépliage
  sur les éléments liés (id cliquable, titre, type de lien, `v{version}`, statut, « non approuvé »
  en couleur d'alerte) ; en-tête « Tout sélectionner » (indéterminé si sélection partielle).
- `components/sidebar/version/VersionImpactSelector.tsx` — entrée « Impact à vérifier (N) » au-dessus
  de « Modifications locales », jamais auto-sélectionnée ; retour à « aucune analyse » quand N tombe
  à 0 ; « Aucune analyse » masqué si l'entrée est présente.
- `routes/impact-analysis.tsx` — mode `isRevalidation` : titre, sous-titre (compteur), Rafraîchir
  (refetch de `revalidation:flagged`), contenu `RevalidationList` (chargement / erreur / liste),
  query `impact-analysis:get` désactivée ; retour à « aucune analyse » aussi porté par la page.
- `i18n/locales/fr.json`, `en.json` — `impactAnalysisPage.revalidation.{listTitle, listSubtitle,
  selectAll, linked, notApproved, notApprovedHint, empty, loadError}`,
  `sidebar.version.{revalidationEntry, revalidationCount}`.

**Main**
- `services/agents-md.template.ts` — « le flag se lève depuis la vue Analyse d'impact (bouton
  Lever le flag), jamais à la main dans le YAML ».

**Tests / doc**
- `e2e-web/t173-revalidation.spec.ts` (nouveau) — N14, N3 (levée depuis la liste, diff limité à la
  clé), N15 ; `e2e-web/README.md` (table « Contenu actuel »).

## Comportement implémenté

Conforme à `T173.md` §2.3 : entrée affichée ssi N > 0 (N = éléments marqués du workspace), sans
sélection automatique ; liste de tous les éléments marqués (tri du service : exigences puis tests,
par id) ; dépliage sur les éléments liés avec mise en évidence des pairs hors approbation ; levée
unitaire sans confirmation, levée de la sélection avec la confirmation du sprint 1 ; retour à
« aucune analyse » quand le dernier flag est levé. Rafraîchissement : invalidation par
`useLiveFileSync` (sprint 1), retour du focus, bouton Rafraîchir.

## Divergences par rapport au design

- La levée de la sélection de la liste de repli utilise le bouton d'en-tête de la page
  (« Lever le flag de la sélection (N) ») déjà posé au sprint 1, au lieu d'un second bouton dans
  l'en-tête de la liste : une seule action, une seule confirmation, quel que soit le contexte.
- Le statut est affiché par son nom (`draft`, `approved`…), comme dans les arbres d'analyse.
- L'entrée reste visible tant qu'elle est active, même si la lecture échoue (sinon impossible de la
  désélectionner) ; un échec de lecture s'affiche dans la page au lieu d'une liste vide.

## Revue de code (`/code-review` medium)

Corrigé : état d'erreur/chargement de la liste (plus de « aucun élément » trompeur), sous-titre sans
compteur avant lecture, retour à « aucune analyse » porté aussi par la page (panneau non monté),
clé i18n de compteur dédiée, case « Tout sélectionner » indéterminée, ternaire Rafraîchir factorisé.
Non retenu (cosmétique, hors périmètre) : passer la liste par le contexte `RevalidationTreeContext`,
composant partagé pour le badge EX/TC (trois copies).

## Mises à jour SPEC

- `SPEC-TRACEABILITY.md` §3.3 — renvoi vers §4.8, `revalidationItems` n'est pas la source de la liste.
- `SPEC-TRACEABILITY.md` §4.8 (nouvelle) — « Levée du flag `needsRevalidation` (T173) » : règle
  d'écriture, arbres d'analyse, liste de repli, invalidations.
- `SPEC-REQ-requirements.md` §5.3 — levée effective décrite + renvoi §4.8.
- `SPEC-AUDIT.md` §3 — « implémentée par T173 ».
- `SPEC-INDEX.md` — lignes SPEC-TRACEABILITY §3+ (mots-clés `lever, levée, flag, impact à
  vérifier`), SPEC-REQ §5, SPEC-AUDIT : `MAJ` → T173.

## Vérifications

- `tsc --noEmit` (`apps/desktop`) : 0 erreur.
- `pnpm test` : 345/345.
- e2e web : `t173-revalidation.spec.ts` 3/3 ; suite complète 52 passés, 13 ignorés (OIDC / instance
  déployée, non configurés).

Non couvert automatiquement (manuel) : N9–N13, N16, N17, L10–L14, R2, R3 de `T173-tests.md`.

## Tester manuellement

1. Rouvrir en brouillon une exigence approuvée liée à des éléments (T172) — ou modifier un paramètre
   utilisé par une exigence approuvée (T171, N16).
2. Vue Analyse d'impact : l'entrée « Impact à vérifier (N) » apparaît au-dessus de « Modifications
   locales », N exact, non sélectionnée d'office.
3. Cliquer l'entrée : titre « Impact à vérifier », liste des N éléments. Déplier une ligne : éléments
   liés, le déclencheur signalé « non approuvé » ; cliquer un id (élément d'un composant compris) →
   popup dans le bon repo (N17).
4. « Lever le flag » sur une ligne : elle disparaît, N décroît ; `git diff` = une ligne en moins.
5. « Tout sélectionner » puis « Lever le flag de la sélection (N) » → confirmation → l'entrée
   disparaît, la page revient à l'invite (N15).
6. Passer l'app en anglais : libellés traduits (L14).
