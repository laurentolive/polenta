# GH278 — Design

Spec : `specs/GH278.md`.

## 1. Décision : les objets dérivés passent par les vrais services

Le générateur écrit des YAML sans contrôle, ce qui explique `CAMP-0001`. Les versions et validations
embarquent en plus des données calculées (analyse figée, empreintes de contenu, copie à la signature)
qu'une réécriture à la main recopierait et ferait dériver.

**Le générateur appelle donc les services de l'application** pour les versions, validations, issues et
la version testée (`scripts/demo-lave-linge/app-services.ts`). Une erreur métier fait échouer la
génération. Essai du 2026-11-05 sur le dépôt Wi-Fi : commit `[version] … released` daté et attribué,
analyse figée, tag annoté, historique du statut corrects.

- **Horloge** : `atInstant(iso, fn)` remplace `Date` le temps de l'appel, en avançant d'une seconde par
  lecture. Commits, tags et `history` portent la date de l'histoire du produit.
- **Auteur** : `user.name` du repo, posé avant l'appel (repli de `AuthService.getAuthor` sans compte) ;
  `HistoryService` reçoit la personne, sans `source: mcp`.
- **Graphe neuf à chaque étape** : les index ne suivent pas les écritures faites hors des services.
- **Cache d'arbre** : `buildTree` + `writeCache` avant une étape du produit (`components`, tests à
  exécuter), en `.polenta/tree.cache.yaml` du workspace. Les pins sont à HEAD à ce moment, donc pas de
  réseau ; sinon la génération échoue. Le cache est supprimé en fin de génération.

**Alternative rejetée** : écrire ces YAML à la main et les vérifier ensuite. Plus simple au premier abord,
mais recopie `signatureCopy`, `computeVersionAnalysis`, `contentHash` et diverge à chaque évolution.

Le reste (exigences, tests, liens, paramètres, campagnes, runs) reste écrit par le générateur, qui en
garde la datation fine. `demo-conformity.test.ts` contrôle le résultat (§ 5).

## 2. Fichiers

| Fichier | Changement |
|---|---|
| `scripts/demo-lave-linge/app-services.ts` | nouveau : graphe des services, `atInstant` |
| `scripts/demo-lave-linge/milestone-d.mjs` | nouveau : étapes datées (versions, issues, validations) |
| `scripts/demo-lave-linge/generate.mjs` | `--out` contrôlé ; `name` retiré des arbres ; `writeCampaign` par dépôt ; `history` ; tombstone ; vues ; retrait des reviews ; étapes après chaque commit de phase |
| `scripts/demo-lave-linge/schemas.mjs` | types version, issue, validation, campagne moteur ; `issue-impact` ; `link`, `requiredWhen`, `transitions`, `runFields`, `stepFields`, `trackHistory`, `displayIdField` |
| `scripts/demo-lave-linge/content.mjs` | `CMOT-0001`, champs d'exécution, `carriedFrom`, `removedRuns`, `excel-import`, requête et dashboard de suivi |
| `scripts/demo-lave-linge/docs.mjs` | guide (spec § 4.1) |
| `scripts/demo-lave-linge/publish.mjs` | nouveau : republication (spec § 5), exécutée seulement sur accord explicite |
| `apps/desktop/src/main/services/demo-conformity.test.ts` | nouveau |
| `apps/desktop/src/main/services/demo-exercises.test.ts` | nouveau |
| `apps/desktop/src/main/services/suivi-corpus/*` | références régénérées et relues |
| `apps/desktop/e2e-web/gh278-*.spec.ts` | nouveau : tutoriels 9, 10, version testée |
| `docs/tutoriels/*`, `docs/tutorials/*` | écarts, tutoriels 9 et 10, exercices |
| `apps/desktop/Devesquaresoftpolenta_wsdemo-lave-linge/` | retiré |

## 3. Précisions sur la spec

- **Tags** : un pin sur tag annoté fonctionne (GH21, testé). Les tags `v1.1` et `v2.0` deviennent les
  tags annotés de leur passage released, et `v2.0` se pose en P8, là où le pin l'utilise (P5 aujourd'hui).
  `v1.0` du bus reste léger. Le défaut « pin sur tag annoté » du guide § 5 est périmé, à retirer ;
  « matrice vide » aussi (`gh22-compliance-matrix`). Le défaut MCP est à revérifier.
- **Ordre en P6** : bus, Wi-Fi, pompe, moteur, produit, chacun : commit de phase, création, inclusion,
  commit, released. `RE2` se pose ensuite. Le pin SHA du Wi-Fi vise donc son commit released.
- **`displayIdField`** remplace l'ID **dans les liens vers l'objet** (GH229) : l'exercice porte sur un
  lien vers une exigence IHM.
- **Issue dans une version** : `include` accepte les issues (`ELEMENT_DIRS`), leurs exigences impactées
  deviennent racines d'analyse (`viaIssues`).
- **Origine d'une issue depuis une décision** : `origin.decisions: [<ref>]`, référence reprise du code de
  `IssueProposalDialog`.
- **Vues d'équipe** : `{ version: 1, views: [{ name, settings }] }` ; clés de `settings` reprises de
  `SystemView`. Un fichier invalide bloque toutes les vues du type : contrôlé par le test.
- **Reviews** : ni données ni guide. Les services restent, hors périmètre.

## 4. Découpage

- **Sprint 1 — Générateur** : contrôles de `--out`, parasite, arbres, reviews, `CMOT-0001`, schémas,
  `history`, tombstone, vues, champs d'exécution, report, Excel ; `demo-conformity` (partie structure) ;
  références `suivi-corpus`.
- **Sprint 2 — Objets du milestone D** : services, versions, issues, validations, version testée, suivi ;
  `demo-conformity` complet ; `demo-exercises`.
- **Sprint 3 — Documentation et publication** : guide, tutoriels FR et EN, exercices, contrôle des ID
  cités, captures, `publish.mjs`, procédure au `RUNBOOK`, e2e `gh278-*`, mises à jour SPEC.

## 5. Vérification

`GH278-tests.md`. Le test de conformité génère la démo une fois (`beforeAll`, délai comme
`suivi-corpus`) et lit par les services. Les e2e sur la démo régénérée passent par
`POLENTA_E2E_DEMO_SOURCE`.
