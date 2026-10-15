# GH64 — Scénarios de test

Spec : `specs/GH64.md`. Design : `specs/GH64-design.md`.

Jeu de données de référence (sauf mention contraire) :

- `TEST-0001` approuvé, sans paramètre.
- `TEST-0002` approuvé, une référence à saisir `{tension}`.
- `TEST-0003` approuvé, itérant (`{req.title}`), lié à `SYS-0001` et `SYS-0002`.
- `TEST-0004` en brouillon (non approuvé).
- `CAMP-0001` (`completed`) : `TEST-0001-1` PASS, `TEST-0002-1` pending (`tension=12V`),
  `TEST-0002-2` BLOCKED (`tension=24V`), `TEST-0003-1` FAIL (`SYS-0001`), `TEST-0003-2` pending
  (`SYS-0002`), `TEST-0004-1` INCOMPLETE.
- `CAMP-0002` (`in_progress`) : `TEST-0001-1` pending.

## Main — `campaigns.service.carry.test.ts` (sprint 1)

| # | Scénario | Attendu |
|---|----------|---------|
| S1 | `addTests` sur une cible vide avec `carried` = `CAMP-0001/TEST-0002-1` et `TEST-0002-2` (valeurs source) | 2 instances `pending` de TEST-0002, `paramValues` 12V et 24V, `carriedFrom` renseigné, `testSnapshot` = état live, `testCaseIds` +2 |
| S2 | `carried` = `CAMP-0001/TEST-0003-2` | 1 instance de TEST-0003 avec `requirementId: SYS-0002`, `resolvedParams['req.title']` = titre de SYS-0002 |
| S3 | Idem S2 après suppression du lien TEST-0003 ↔ SYS-0002 | Aucune instance créée, campagne inchangée, pas d'erreur |
| S4 | Cible contenant déjà TEST-0001 ; `carried` = `CAMP-0002/TEST-0001-1` | Ignorée (doublon `(TEST-0001, —, {})`) |
| S5 | Cible contenant TEST-0002 avec `tension=12V` ; `carried` = `TEST-0002-1` (12V) et `TEST-0002-2` (24V) | Seule l'instance 24V est créée |
| S6 | `carried` vers une campagne cible `completed` | Rejet (garde existante) |
| S7 | `carried` référençant une campagne ou un `entryId` inexistant, et une entrée de la cible elle-même | Ignorées, les autres sélections sont créées |
| S8 | Cible avec `baselineRef: v2` ; test reporté avec une référence de base | `resolvedParams` lus au tag `v2`, `paramSourceRef: v2` — jamais recopiés de la source |
| S9 | `create()` avec `testCaseIds: [TEST-0001]` et `carried` = `CAMP-0001/TEST-0002-2` | 2 instances : TEST-0001 (sans `carriedFrom`) puis TEST-0002 24V (avec), dans cet ordre |
| S10 | Après S1, relire `CAMP-0001` | Fichier source strictement identique (contenu YAML) |
| S11 | Campagne existante sans `carriedFrom` | Lecture, `addTests` classique, exports : comportement inchangé |
| S12 | `carryKey` | Indépendante de l'ordre des clés, des espaces autour des valeurs, des valeurs vides |

## Logique du sélecteur — `carryOver.test.ts` (sprint 2)

| # | Scénario | Attendu |
|---|----------|---------|
| L1 | `CAMP-0001`, filtre par défaut (`pending`/`BLOCKED`/`INCOMPLETE`) | Lignes `TEST-0002-1`, `TEST-0002-2`, `TEST-0003-2`, `TEST-0004-1` ; ni PASS ni FAIL |
| L2 | Ajout de `FAIL` au filtre | + `TEST-0003-1` |
| L3 | Mode ajout | `TEST-0004-1` indisponible `notApproved` |
| L4 | Mode création avec filtre composant excluant TEST-0002 | Lignes TEST-0002 indisponibles `outOfScope` |
| L5 | TEST-0002 supprimé | Lignes TEST-0002 `deleted` |
| L6 | Même clé dans `CAMP-0001` (exécutée le 01/10) et `CAMP-0002` (le 05/10) | Une seule ligne, source `CAMP-0002`, `otherSources: [CAMP-0001]` |
| L7 | `targetKeys` contient la clé de `TEST-0002-1` | Ligne `alreadyPresent` |
| L8 | `testSnapshot.version` source 2, test live en version 3 | Ligne disponible, `sourceVersion: 2`, `liveVersion: 3` |
| L9 | Campagne source sans `testSnapshot` (pré-T49) | Ligne construite, pas d'avertissement de version |

## Interface — e2e web `gh64-carry-over.spec.ts` (sprint 2)

| # | Scénario | Attendu |
|---|----------|---------|
| U1 | Campagne active → « + Ajouter des tests » | Onglets « Tests » et « Depuis une campagne » ; l'onglet Tests est inchangé (GH33) |
| U2 | Onglet campagne : la cible n'est pas listée ; `CAMP-0001` (clôturée) l'est | Conforme |
| U3 | Cocher `CAMP-0001` | Lignes du filtre par défaut cochées, `TEST-0004-1` grisée « Non approuvé » ; décocher une ligne, cocher `FAIL`, la ligne décochée le reste |
| U4 | Valider avec `TEST-0002-2` | Étape 2 : bloc `TEST-0002 · ↩ CAMP-0001`, `tension` pré-rempli `24V`, modifiable ; « Ajouter » crée l'instance, la liste affiche `↩ CAMP-0001` (lien) |
| U5 | `/campaign/new` → sélection d'entrées de `CAMP-0001` + un test de l'onglet Tests | Récapitulatif avec les deux ; « Créer » produit les instances, dont les reportées avec `↩` |
| U6 | Cocher le même TEST-0001 dans l'onglet Tests et via une entrée reportée | Une seule instance, avec `carriedFrom` |

## Manuel

| # | Scénario | Attendu |
|---|----------|---------|
| M1 | Reporter une instance T179 (`TEST-0003-2`) puis l'exécuter | En-tête « Exigence de cette instance : SYS-0002 » ; le run ne compte en couverture que pour SYS-0002 |
| M2 | Export plan/rapport (xlsx, docx) d'une campagne avec instances reportées | Identique à une campagne sans report (pas de mention `↩`) |
| M3 | Classeur d'exécution (GH36) export + réimport sur une campagne avec instances reportées | Fonctionne, `carriedFrom` conservé après import |
| M4 | Desktop et client web | Même comportement |
| M5 | Projet avec ~20 campagnes de ~200 entrées | Ouverture de l'onglet et coches sans latence perceptible (une seule requête de prévisualisation) |
