# GH68 — Sprint 2 : renderer

Design : `specs/GH68-design.md` §5–§7 (sprint 2).

## Fichiers modifiés

| Fichier | Changement |
|---------|------------|
| `renderer/hooks/useProjectSchema.ts` | `isTestApproved(test, schema)` (déplacé de la page campagne, sur `isApprovalStatus`) ; `testStatusLabel(test, schema)` |
| `renderer/lib/campaignApproval.ts` (nouveau) + `.test.ts` | Logique pure : `isResyncable`, `approvalSubject`, `unapprovedTestOf`, `unapprovedPendingRuns` |
| `renderer/components/campaign/NotApproved.tsx` (nouveau) | `NotApprovedBadge` (pastille + infobulle du statut), `NotApprovedRunsBanner` |
| `renderer/routes/campaign.$campaignId.tsx` | Filtre d'approbation retiré (onglet Tests et report) ; pastille par instance ; bandeau des pending non approuvées |
| `renderer/components/campaign/TestPickerModal.tsx` | Message vide unique `noTestCaseAvailable` ; schéma passé au panneau de report |
| `renderer/components/campaign/TestPickerGrid.tsx` | Colonne Statut forcée (`withStatusColumn`), préférences non réécrites |
| `renderer/components/campaign/CampaignCarryPanel.tsx` | Pastille « Non approuvé » sur une entrée dont le test live n'est pas approuvé |
| `renderer/lib/carryOver.ts` (+ test) | Motif `notApproved` retiré de `CarryEligibility` / `CarryUnavailable` |
| `renderer/routes/campaign.$campaignId_.execute.$testId.tsx` | `refreshEntries` à l'ouverture (instance pending avec copie, campagne ouverte ; page en chargement pendant l'appel) ; bandeau d'avertissement ; confirmation « Exécuter quand même » à la première saisie (bouton et Ctrl+Entrée) |
| `renderer/routes/impact-analysis.tsx` | `testCaseFilter: 'include_draft'` |
| `renderer/i18n/locales/{fr,en}.json` | Clés `notApproved*`, `executeNotApproved*`, `refreshFailed` ; suppression de `noApprovedTestAvailable` et `carry.unavailable.notApproved` |
| `e2e-web/gh68-unapproved.spec.ts` (nouveau) | S1–S2, E1–E3 (+ L3), E6 |
| `specs/SPEC-TESTS.md`, `specs/SPEC-INDEX.md`, `specs/GH68.md` | Voir « Mises à jour SPEC » |

## Comportement implémenté

Conforme à la spec et au design §5, avec les précisions de design §2 (copie figée = version
affichée/exportée).

## Divergences par rapport au design

- **Rafraîchissement à l'ouverture** : appelé pour toute instance `pending` avec copie d'une campagne
  ouverte ; c'est le main qui décide si la copie est resynchronisable (pas de dépendance au
  chargement du schéma côté renderer). Coût : un appel IPC par ouverture, sans écriture si rien ne
  change.
- **Libellé de statut** : `testStatusLabel` (libellé du schéma) dans la pastille, le bandeau et la
  confirmation ; l'avertissement d'import (sprint 1) affiche le nom du statut.

## Mises à jour SPEC

- `SPEC-TESTS.md §4.2` — sélecteur : tous statuts proposés, colonne Statut forcée ; report : motif
  « non approuvé » retiré, pastille ; nouveau paragraphe « Tests non approuvés (GH68) » (remplace
  « Le gating "test approuvé"… ») : resynchronisation, moments, signalement, analyse d'impact.
- `SPEC-TESTS.md §4.5` — avertissement `test_not_approved` à l'import ; resynchronisation à l'export.
- `SPEC-INDEX.md` — lignes SPEC-TESTS §4.1–4.2 et §4.5 : résumé, mots-clés, MAJ → GH68.
- `specs/GH68.md` — §10, CA7, CA9 alignés sur le design §2.

## Vérifications

- `pnpm typecheck` : OK.
- `pnpm test` : 26 fichiers / 283 tests desktop + merge-core OK (dont `campaignApproval.test.ts`,
  `carryOver.test.ts` mis à jour).
- `pnpm test:e2e:web` : 41 réussis, 13 ignorés (gh57-consent, s3-oidc, s4-deployed : exigent
  `POLENTA_E2E_SSH`), 0 échec — dont les 3 nouveaux GH68 et GH64 inchangé. Captures :
  `e2e-web/.results/gh68-*.png`.
- `/code-review` : aucune remarque sur les fichiers GH68 ; les remarques portent sur du code déjà
  mergé (moteur de requêtes GH65, seed dashboard, préférences) — hors périmètre.
- Scénarios non automatisés : S3 (création), S4 (report par l'UI), S5, S6, L1–L2 (couverts en
  unitaire par `campaignApproval.test.ts`), E4, E5, E7, E8, I1 (couvert côté main au sprint 1), A1.

## Test manuel

1. Créer un test (statut brouillon) avec une étape « v1 ».
2. Ouvrir une campagne planifiée → « Ajouter des tests » : le test est listé, colonne Statut
   visible → l'ajouter. Pastille « Non approuvé » et bandeau « 1 instance à exécuter… ».
3. Modifier l'étape du test (« v2 »), revenir à la campagne, « Exécuter » : l'étape « v2 » est
   affichée, avec le bandeau d'avertissement.
4. « Soumettre le résultat » → confirmation ; « Annuler » ne change rien ; « Exécuter quand même »
   enregistre le résultat.
5. Modifier encore le test (« v3 ») : la relecture du run montre toujours « v2 ».
6. Passer le test au statut approuvé : la pastille disparaît des instances encore à exécuter.
7. « Depuis une campagne » : une entrée d'un test brouillon est cochable, avec la pastille.
8. Export Excel puis import d'un classeur rempli : avertissement « test non approuvé » dans l'aperçu.
