# GH278 — Sprints 1 et 2 : générateur et objets du milestone D

Les deux sprints ont été menés d'un trait : les objets du milestone D dépendent du nouveau générateur.

## Fichiers

- `scripts/demo-lave-linge/app-services.ts` (nouveau) : services réels, horloge datée (`atInstant`).
- `scripts/demo-lave-linge/milestone-d.mjs` (nouveau) : étapes datées P5 à P8.
- `scripts/demo-lave-linge/generate.mjs`, `lib.mjs`, `schemas.mjs`, `content.mjs`.
- `apps/desktop/src/main/services/demo-conformity.test.ts`, `demo-exercises.test.ts` (nouveaux).
- `apps/desktop/src/main/services/suivi-corpus.test.ts` et ses références.
- Retrait de `apps/desktop/Devesquaresoftpolenta_wsdemo-lave-linge/`.

## Comportement

- **`--out`** : refus d'un chemin relatif au lecteur, sans valeur, ou dans le repo Polenta.
- **Structure** : arbres sans `name` ; reviews retirées ; `CMOT-0001` dans `comp-moteur` ; pierre tombale
  `SYS-0015` ; `history` (statut et priorité) sur le produit et le moteur ; vues d'équipe ;
  `requiredWhen`, `link`, `transitions`, `runFields`, `stepFields`, `displayIdField` ; report de campagne,
  entrée retirée, run importé d'Excel ; dashboard « Versions & validation » avec une requête paramétrée.
- **Milestone D**, par les services : 9 versions (dont 6 released avec tag annoté), 4 issues, 3 validations
  (2 signées), version testée sur les runs de la DVT avec un écart non documenté.

## Divergences avec le design et la spec

- **Composition du produit sans le bus** : l'arbre du workspace monte `if-bus-interne` sous `comp-moteur`.
  Le service a refusé la composition à quatre composants (`COMPONENT_NOT_RELEASED`) ; le bus suit la
  version du moteur. Le tutoriel 9 (« 4 composants ») sera corrigé au sprint 3.
- **Numéros d'issues** : la dérogation (P6) passe avant l'échec KPI (P7) : ISS-0002 et ISS-0003 échangés
  dans la spec.
- **Validation 2.0** : les décisions de la 1.0 sont reprises partout sauf sur les exigences impactées
  (PRD-0002, SYS-0002, SYS-0004), qui restent en attente ; PRD-0010 et SYS-0013 sont remises en attente ;
  SYS-0013 porte une proposition ; PRD-0006 est « à revoir » (modifiée en P8).
- **Version testée** : seuls les runs d'entrées de campagne en portent une, comme dans l'application ;
  `CMOT-0001` (P5) est antérieure à toute version.
- **Sélecteur de tests** : il ne liste que les tests du dépôt. Le service, lui, accepte un ID de test
  inconnu à la création d'une campagne (entrée sans copie) : issue séparée.

## Vérifications

- `demo-conformity.test.ts` : 12/12 ; `demo-exercises.test.ts` : 12/12 ; `suivi-corpus.test.ts` : 6/6,
  références relues (nouveau dashboard, issue-impact, `CMOT-0001` au lieu de `CAMP-0001/TMOT-0003`).
- `pnpm typecheck`, `pnpm lint` : sans erreur.
- Pas encore lancé : `pnpm test` complet, e2e (sprint 3), revue de code (sur le diff complet, sprint 3).
