# GH439 — Scénarios de test (révision 2)

Spec : `specs/GH439.md` (cas U1 à U25, critères 1 à 9). Design : `specs/GH439-design.md`.

Niveaux (WORKFLOW.md § Niveaux de vérification) : unitaires `npx vitest run <fichier>` (niveau 1), `pnpm test` + e2e du
ticket `pnpm build:web` puis `npx playwright test e2e-web/gh439-` (niveau 2 en fin de sprint). Suite e2e complète
seulement au merge sur `main` (niveau 3 : le ticket modifie le renderer et les services du main).

## 1. Passage released et couverture figée — `versions.release-verification.gh439.test.ts` (sprint 1)

Fixtures : repo git réel (`TestRepo`, comme `versions.gh245.test.ts`), types `exigence` (statuts `draft`, `approved`
`isApproval`, `obsolete` `isTerminal`), `test`, `version` (`en_cours`, `released`, `abandonnee`) ; `setImpactSources` avec la
vraie `TraceabilityService`.

| # | Cas | Attendu | Couvre |
|---|---|---|---|
| R1 | Passage released d'une version : R1 liée à un test PASS, R2 sans test, R3 terminale | le fichier de version contient `verification.rows` = R1 `validated` (test), R2 `not_covered` ; R3 absente ; `computedAt` posé ; triées par ID | U4, U6 |
| R2 | `verification` dans le **même commit** que le fichier de version, aucun autre fichier du commit | commit de `[version] … released` : un seul fichier | critère 3 |
| R3 | Statuts : exécution FAIL / test `needsRevalidation` / lien sans exécution | `failing` / `needs_revalidation` / `covered` | U4 |
| R4 | Matrice illisible (erreur du moteur) | le passage échoue, version toujours en cours, aucun tag, rien d'écrit | risque § 4 |
| R5 | `setImpactSources` absent | passage released sans `verification`, comportement d'avant | rétro-compatibilité |
| R6 | Version released : `update()` d'un champ, tentative d'écrire `verification` | refusé (version verrouillée / champ système) | verrou |
| R7 | « Copier » une version released | la copie n'a ni `freeze`, ni `analysis`, ni `verification` | spec § 3.2 |
| R8 | Renommage d'un statut / champ (GH381) sur une version released | `verification` intacte | § 2 |
| R9 | `versions:get` d'une version released | `verification` non renvoyée dans la page ; `analysis` inchangée | § 2 |
| R10 | **Volume** : 1 500 exigences, passage released | termine, aucun « Too many pending tasks », taille du fichier de version raisonnable (mesurée et notée) (leçon GH335 : tester la limite) | risque |
| R11 | `buildVerification` (pure) : exigence absente de la matrice | `not_covered`, `tests: []` | § 4 |

## 2. Lecture — `version-requirements.gh439.test.ts` (sprint 1)

Une version released `V1` figée sur un commit contenant R1, R2, R3 (R3 `obsolete`), `verification` écrit par le passage.

| # | Cas | Attendu | Couvre |
|---|---|---|---|
| S1 | Page de `V1` | lignes R1, R2 ; R3 absente ; contenu et statut du gel ; `verification: 'frozen'` | U1, U6 |
| S2 | R2 modifiée (titre, statut) sur le disque après la release | la ligne R2 garde le titre et le statut **du gel** | U2 |
| S3 | Test exécuté PASS / lien supprimé après la release | `coverageStatus` et `tests` de la page **inchangés** ; `getMatrix` **non appelé** (espion) | U3, critère 2 |
| S4 | R4 créée après la release | absente | U5 |
| S5 | Version en cours | lignes = disque ; couverture à l'instant ; `verification: 'live'` ; `getMatrix` appelé | U7 |
| S6 | Version released **sans** `verification` (fichier d'avant GH439) | lignes au gel, `coverageStatus: null`, `verification: 'missing'`, `getMatrix` non appelé | U8 |
| S7 | Fichier `requirements/X.yaml` d'un `objectTypeRef` non déclaré par le schéma ; dépendance déclarée dans `polenta-repo.yaml` avec ses exigences | aucune des deux n'apparaît | U9 |
| S8 | Version abandonnée **sans** gel | `VersionError('VERSION_NOT_FROZEN')` | U10 |
| S9 | Version released puis abandonnée (gel conservé) | page lue au gel | U10 |
| S10 | `freeze.sha` absent du repo (clone partiel simulé) | `VERSION_NOT_FOUND`, **pas** de liste vide | U11 |
| S11 | Type d'exigence renommé après la release | libellés de type, de statut et champs lus du **schéma du gel** | GH266 |
| S12 | Repo sans exigence | `rows: []`, pas d'erreur | U25 |
| S13 | Ordre | `R2` avant `R10` (tri numérique) | § 2.3 |
| S14 | Composant en lecture seule | page lue | U22 |
| S15 | Aucune écriture : `git status --porcelain` vide, dates de modification inchangées après la lecture | rien d'écrit | critère 8 |
| S16 | Exigence présente au gel mais sans ligne dans `verification` | `coverageStatus: null` (« — »), pas `not_covered` | spec § 3.2 |
| S17 | **Volume** : 1 500 exigences figées | termine, ordre correct, aucune erreur de file de tâches | risque |
| S18 | `buildRequirementRows` (pure) : périmètre, tri, couverture absente | conforme | S1, S13 |
| S19 | Première release qui inclut R1, R2 ; le repo contient aussi R4 jamais incluse | liste R1, R2 — pas R4 | U26 |
| S20 | 1.1 basée sur la 1.0 (R1, R2) et incluant R3 | liste R1, R2, R3 ; la 1.0 ne liste que R1, R2 | U27 |
| S21 | Version de la lignée released puis abandonnée | ses changements ne comptent pas pour la suivante ; la lignée se poursuit au-delà | U28 |
| S22 | Version en cours basée sur la 1.0 : sans changement, puis avec R5 | liste celle de la 1.0, puis + R5 (disque) | U29 |
| S23 | Exigence incluse et terminale au gel | absente | U6 |
| S24 | Élément inclus qui n'est pas une exigence (test) ou n'existe plus à l'état lu | absent, pas d'erreur | § 3.1 |
| S25 | Cycle dans `basedOn` (fichiers édités à la main) | la lecture termine, chaque version comptée une fois | robustesse |

## 3. Tables d'export — `versionSectionTables.gh439.test.ts` (sprint 3, renderer)

| # | Cas | Attendu | Couvre |
|---|---|---|---|
| T1 | Sections cochées `info` + `requirements` | deux `SectionTable`, dans l'ordre de la page | U16 |
| T2 | Colonne masquée dans les préférences de la grille | absente de la table ; colonnes dans l'ordre choisi | U19 |
| T3 | Colonnes de gestes (`actions`, `diff`) | exclues | spec § 5.2 |
| T4 | Filtre actif dans une grille (état local d'écran) | sans effet : toutes les lignes | U20, D10 |
| T5 | `getText` des colonnes extraites = texte de la grille (`versionChangeColumns` etc. appelés avec gestes inertes) | identique cellule par cellule | critère 6 |
| T6 | `info` : lignes Champ / Valeur (libellé, état, statut, basée sur, tag, date de gel, commit, champs du type, composant, exporté le) | conforme ; version en cours : pas de tag ni de commit | § 5.2 |
| T7 | `components` : composant, version, état | conforme | § 5.2 |
| T8 | Coverage `null` | texte « — » ; badge `validated` → libellé « Vérifié » | § 2.3 |
| T9 | Version abandonnée | `analysis` / `tests` non produites même si demandées | U21 |
| T10 | Section vide | table avec en-tête et zéro ligne | U25 |

## 4. E2E web — page (`e2e-web/gh439-version-page.spec.ts`, sprint 2)

Projet de démo, un type exigence et une version released créée et released par le test (modèle : `gh252-versions.spec.ts`,
`setupSession`, sans `allowConsoleErrors` : un canal masqué répondrait 404).

| # | Parcours | Attendu | Couvre |
|---|---|---|---|
| E1 | Ouvrir la page | six sections dans l'ordre ; « Informations » ouverte, « Exigences » fermée ; **aucune** requête `versions:requirements` | U13, critère 4 |
| E2 | Barre de titre | ID et pastille d'état visibles ; **aucun** bouton de repli (`version-header-toggle` absent) | U14, critère 7 |
| E3 | Replier « Informations », recharger la page | reste repliée ; autres sections inchangées ; sa mémoire ne touche pas la page de validation | U13 |
| E4 | Version avec composant retiré de la structure, section « Composants » fermée | l'alerte reste visible | U15 |
| E5 | Ouvrir « Exigences » | requête `versions:requirements` émise ; grille avec les exigences du gel ; ligne « État figé au tag … — Vérification figée à la release » ; compteur | U1 |
| E6 | Modifier une exigence et exécuter un test après la release, rouvrir la section | contenu **et couverture du gel** inchangés | U2, U3 |
| E7 | Version en cours | ligne « État courant du repo — … » ; couverture à l'instant ; après une exécution (canal) la couverture suit sans recharger | U7 |
| E8 | Version released avant GH439 (fichier sans `verification`) | colonne « — » et mention dédiée | U8 |
| E9 | 👁 : décocher `status`, cocher `tests`, réordonner, recharger | préférences restaurées | U12 |
| E10 | Filtre « Vérification » = Non couverte | compteur « affichées / total » cohérent ; les autres lignes masquées | spec § 2.3 |
| E11 | Lecture seule : aucune cellule n'offre d'édition (`Entrée` / `F2` n'ouvrent aucun éditeur) ; double-clic sur une ligne | l'exigence s'ouvre | § 2.3 |
| E12 | Version abandonnée sans gel | pas de section « Exigences » | U10 |
| E13 | Défilement : sortir de la page puis revenir (Précédent, onglet, barre d'activité) dans la section ouverte, échantillonnage de chaque frame | position restaurée sans passer par le haut (leçon GH300) | défilement |
| E14 | `gh389-versions.spec.ts` adapté : repli de l'en-tête remplacé par la section « Informations » ; `expectGridContract` sans bouton Exporter pour `version-changes`, `version-tests`, `version-analysis` | passe | U24 |
| E15 | Composant en lecture seule | section disponible | U22 |
| E16 | Client web : tout ce qui précède passe en client web (cible de cette spec) ; `versions:requirements` répond 200 | | U23 |
| E17 | Saisie des champs de la section « Informations » (libellé, statut, « basée sur », champs, Enregistrer / Annuler) | comportement d'avant, vérifié sur la section repliée puis dépliée | § 4 |

## 5. E2E web — export (`e2e-web/gh439-version-export.spec.ts`, sprint 3)

| # | Cas | Attendu | Couvre |
|---|---|---|---|
| X1 | Bouton **Exporter** de la barre de titre | fenêtre avec cases (six sections, toutes cochées), formats Excel / PDF ; fermeture au clic extérieur | § 5.1 |
| X2 | Décocher toutes les sections | formats désactivés | § 5.1 |
| X3 | Clic **souris** sur une case et sur un format (pas seulement le clavier) | la fenêtre reste ouverte jusqu'au choix (leçon GH416) | § 5.1 |
| X4 | Excel, `Informations` + `Exigences` cochées | classeur de **deux onglets**, ordre de la page, noms ≤ 31 caractères | U16 |
| X5 | Excel, sections **repliées** cochées | exportées | U17 |
| X6 | Colonne décochée dans 👁, puis export | absente de l'onglet | U19 |
| X7 | Filtre actif puis export | toutes les lignes | U20 |
| X8 | Onglet « Informations » | libellé, état, tag, date de gel, commit, composant, champs du type | § 5.2 |
| X9 | Version en cours | « Informations » sans tag ni commit | § 5.2 |
| X10 | PDF toutes sections, 300 exigences (champs richtext longs) | fichier `%PDF`, plusieurs pages, **A4 paysage** (largeur > hauteur), contient le label de la version, un titre par section, ID première / dernière ligne | U18 |
| X11 | PDF : en-tête du tableau sur **chaque** page ; pied « page n / N » | présents | U18 |
| X12 | Parité Excel / PDF | mêmes sections, mêmes colonnes, mêmes lignes | critère 6 |
| X13 | Version abandonnée avec gel | `Analyse` et `Tests` non proposées ; export possible | U21 |
| X14 | Composant en lecture seule | export possible ; aucun fichier du repo écrit (statut git vide) | U22, critère 8 |
| X15 | Mémoire du choix de sections par poste | restaurée au retour ; `localStorage` indisponible : toutes cochées | § 5.1 |
| X16 | Desktop : export Excel et PDF par la boîte de dialogue native (stub) | fichiers écrits, ouvrables | desktop |

Le PDF se vérifie comme `e2e-web/s4-print.spec.ts` (octets `%PDF`, extraction de texte) ; l'orientation et le pied de page se
lisent dans les métadonnées de page du fichier.

## 6. À tester à la main (non couverts par l'automatique)

Ce que l'humain regarde à la validation finale, dans le dossier principal :

1. **Page d'une version** : les six sections se replient de la même façon ; la barre de titre est claire sans le bouton
   de repli ; « Informations » ressemble à l'ancien en-tête.
2. **Lisibilité du PDF** sur la vraie version produit (projet réel `PH2` ou démo « Lave-linge ») : paysage, colonnes
   proportionnées, aucune ligne coupée entre deux pages, en-tête répété, pied de page.
3. **Classeur Excel** ouvert dans Excel : onglets, volets figés, largeurs, hyperliens.
4. **Passage released d'un vrai produit** : durée du passage avec la couverture figée ; contenu de `verification` dans le
   fichier de version (taille).
5. **Sens métier** : la couverture d'une version released ne bouge plus après de nouvelles exécutions ; la mention des
   versions released avant GH439 est claire.
6. **Aspect de la grille** par rapport à la vue Tableau des exigences (colonnes, badge, hauteur, 👁).

## 7. Traçabilité critères → scénarios

| Critère | Scénarios |
|---|---|
| 1 — U1 à U25 | R1–R4, S1–S16, E1–E17, X1–X16 |
| 2 — couverture figée | S3, E6, E7 |
| 3 — `verification` au passage, rien d'autre | R1, R2 |
| 4 — pas de lecture avant ouverture | E1 |
| 5 — export = cases cochées, colonnes visibles, toutes lignes | T1–T4, X4–X7 |
| 6 — parité Excel / PDF | T5, X12 |
| 7 — plus de bouton de repli, six sections identiques | E2, E3, E14 |
| 8 — aucune écriture hors passage | S15, X14 |
| 9 — SPEC et CLAUDE.md à jour | revue du dernier sprint (`GH439-sprint3.md` § Mises à jour SPEC) |
