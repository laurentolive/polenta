# GH278 — Sprint 3 : documentation, tutoriels, publication, e2e

## Fichiers

- `scripts/demo-lave-linge/docs.mjs` : guide d'évaluation (milestone D, vues, version testée, défauts
  corrigés retirés, scénarios, régénération).
- `scripts/demo-lave-linge/publish.mjs`, `README.md` (nouveaux) : republication des 5 dépôts publics.
- `docs/tutoriels/*.md`, `docs/tutorials/*.md` : écarts corrigés, tutoriels 9 et 10 réécrits sur la démo,
  section `## Exercices` en fin de chaque tutoriel 2 à 12, « Repartir d'une démo propre » (tutoriel 2).
- `apps/desktop/e2e-web/gh278-demo-tour.spec.ts` (nouveau) ; `support/demo-types.ts` (nouveau) ;
  specs adaptées : `gh196`, `gh197`, `gh252`, `gh256`, `gh271`, `gh77`, `support/campaign.ts`.
- Suites de la revue de code : `lib.mjs`, `generate.mjs`, `publish.mjs`, `content.mjs`,
  `demo-conformity.test.ts`, `demo-exercises.test.ts`.

## Comportement et choix

- **Liens de vérification visibles par défaut** dans la démo (`defaultVisible`, GH139) : le type
  `issue-impact`, que l'application ajoute avec `defaultVisible`, masquait sinon la couverture.
- **`history`** écrit seulement pour les types qui historisent aussi leur priorité (PRD, SYS, TSYS, MOT,
  TMOT) ; les autres types montrent les entrées déduites. Le générateur l'écrit lui-même (dates du passé
  du produit) ; C12 vérifie que l'application le lit sans trou.
- **Specs e2e existantes** : elles ajoutaient leurs propres types version, issue, validation ; elles
  réutilisent ceux de la démo (`typeOfCategory`) et passent la version testée (`testedVersionArg`).
- **Revue de code** (`/code-review` medium, diff complet) : 10 constats, tous traités. Garde `--out`
  étendue aux dossiers qui contiennent le repo ; G1 n'exécute plus de `--force` ; tag d'archive par SHA ;
  dates de commit monotones ; pierre tombale par `deleteWithTombstone` ; QUERY-0013 limitée à une
  validation ; arbre préparé une fois par phase ; version ouverte lue par `versionState`.

## Divergences

- **Procédure de publication** dans `scripts/demo-lave-linge/README.md`, pas dans `deploy/RUNBOOK.md`
  (consacré à l'hébergement des clients).
- **Captures** non refaites : `campaigns.png` (FR et EN) montre encore TMOT-0003 dans CAMP-0001. À refaire
  sur la démo publiée (le client de bureau sur une démo locale ne reproduit pas les URL des composants).
- **Ancienne démo** : les dépôts publics ne sont pas encore republiés (accord à demander, § 5 de la spec).
  Jusque-là, l'application, les e2e et le site clonent l'ancienne démo.

## Mises à jour SPEC

Aucune : les SPEC ne décrivent pas le contenu de la démo (`SPEC-ELECTRON-DESKTOP` §16 : le bouton ;
`SPEC-DASHBOARDS` : le corpus, inchangé dans son principe).

## Vérifications

- `pnpm typecheck`, `pnpm lint` : sans erreur. `pnpm test` : 1513 tests desktop, tous verts.
- `demo-conformity` 13/13, `demo-exercises` 12/12, `suivi-corpus` 6/6 (références relues).
- e2e sur la démo régénérée (`POLENTA_E2E_DEMO_SOURCE`) : 90 passés, 4 ignorés (specs dépendant de la démo et `gh278-demo-tour`).
  Les composants y viennent encore des dépôts publics (anciens) : rien de ce qui est vérifié n'en dépend.
- Non lancé : suite e2e complète (niveau 3, après le « Validé » et la publication).

## Comment tester à la main

1. `pnpm --filter @polenta/desktop demo:generate -- --out C:/Dev/esquaresoft/polenta_ws/demo-gh278 --force`
2. Ouvrir ce dossier dans Polenta (bureau).
3. Suivre les tutoriels 9 et 10 et leurs exercices ; à vérifier en priorité, non couvert par les tests :
   - la fenêtre de reprise d'une copie de test de campagne (tutoriel 4) ;
   - l'exercice « Résoudre un conflit » (tutoriel 8) et le passage released de MOTV-0002 (tutoriel 9) ;
   - la matrice de conformité du bus interne (BUS-0006 non couverte) ;
   - l'affichage du titre d'une exigence IHM dans les liens (BIHM-0002).
