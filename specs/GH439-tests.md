# GH439 — Scénarios de test

Spec : `specs/GH439.md` (cas U1 à U18, critères 1 à 6). Design : `specs/GH439-design.md`.

Niveaux (WORKFLOW.md § Niveaux de vérification) : unitaires `npx vitest run <fichier>` (niveau 1), `pnpm test` + e2e du
ticket `pnpm build:web` puis `npx playwright test e2e-web/gh439-` (niveau 2 en fin de sprint). Suite e2e complète
seulement au merge sur `main` (niveau 3, le ticket modifie le renderer et les services du main).

## 1. Service — `version-requirements.gh439.test.ts` (sprint 1)

Fixtures : repo git réel (`TestRepo`, comme `versions.gh245.test.ts`), type `exigence` (statuts `draft`, `approved`
`isApproval`, `obsolete` `isTerminal`), type `test`, type `version` (`en_cours`, `released`, `abandonnee`). Une version
released `V1` figée sur un commit contenant R1, R2, R3 (R3 `obsolete`).

| # | Cas | Attendu | Couvre |
|---|---|---|---|
| S1 | Page de `V1` | lignes R1, R2 ; R3 absente (terminale au gel) ; contenu et statut du gel | U1, U5 |
| S2 | R2 modifiée (titre, statut) sur le disque après la release | la ligne R2 garde le titre et le statut **du gel** | U2, critère 2 |
| S3 | R4 créée après la release | absente | U3 |
| S4 | R1 passée `obsolete` après la release | toujours listée, statut du gel | U4 |
| S5 | Version en cours | lignes = disque courant ; `changedSince` absent | U6 |
| S6 | R1 liée à un test dont la dernière exécution est PASS ; R2 sans test | R1 `validated` avec le test (id, titre) ; R2 `not_covered`, `tests: []` | U7, U8 |
| S7 | Exécution FAIL / test marqué `needsRevalidation` | `failing` / `needs_revalidation` | U7 |
| S8 | Fichier `requirements/X.yaml` d'un `objectTypeRef` non déclaré par le schéma ; dépendance déclarée dans `polenta-repo.yaml` avec ses exigences | aucune des deux n'apparaît | U9 |
| S9 | Version abandonnée **sans** gel | `VersionError('VERSION_NOT_FROZEN')` | U10 |
| S10 | Version released puis abandonnée (gel conservé) | page lue au gel | U10 |
| S11 | `freeze.sha` absent du repo (clone partiel simulé) | `VERSION_NOT_FOUND`, **pas** de liste vide | U11 |
| S12 | `include` vide | `designVersionsFor` et `readWithFields` (disque) **non appelés** (espions) ; `designVersion` / `changedSince` absents | critère 3 |
| S13 | `include.changedSince` : R1 inchangée ; R2 contenu modifié ; R5 supprimée du disque ; R6 seul `history` / `needsRevalidation` modifié ; R7 statut modifié | R1 `false`, R2 `true`, R5 `true`, R6 `false`, R7 `true` | U2, D3 |
| S14 | `include.changedSince` sur version en cours | propriété absente | U6 |
| S15 | `include.design` : R1 incluse dans `V1` à l'identique ; R2 incluse puis modifiée | R1 → `{ V1 }`, R2 → `null` | D4 |
| S16 | Type d'exigence renommé après la release | libellés de type, de statut et champs lus du **schéma du gel** | GH266 |
| S17 | Repo sans exigence | `rows: []`, pas d'erreur | U18 |
| S18 | Ordre | `R2` avant `R10` (tri numérique) | §2.3 |
| S19 | Composant en lecture seule | page lue, `readonly: true` | U16 |
| S20 | Aucune écriture : `git status --porcelain` vide et aucune date de modification changée après la lecture | rien d'écrit | critère 5 |
| S21 | **Volume** : 1 500 exigences figées, `include` complet | se termine, aucune erreur « Too many pending tasks », ordre correct (leçon GH335 : tester la limite, pas seulement le chemin) | risque |
| S22 | `buildRequirementRows` (pure) : entrées sans couverture dans la matrice | `not_covered`, `tests: []` | S6 |

## 2. Renderer — `versionRequirementColumns.gh439.test.ts` (sprint 2)

| # | Cas | Attendu |
|---|---|---|
| C1 | Colonnes par défaut | `id`, `title`, `status`, champs `defaultVisible` (sinon trois premiers), `coverageStatus` ; `designStatus`, `changedSince`, `tests`, `version`, `objectTypeRef` masquées |
| C2 | `getText` de `coverageStatus` | libellé du badge (`system.coverage.status.*`), filtrable (GH224) |
| C3 | `getText` d'un champ richtext | texte aplati, sans balises (`htmlToCellText`) |
| C4 | `getText` de `designStatus` / `changedSince` | label de version ou « — » ; « Oui » ou vide |
| C5 | `include` déduit des colonnes visibles | `design` seulement si `designStatus` visible, `changedSince` de même |
| C6 | Version non figée : colonne `changedSince` | absente du catalogue |
| C7 | **Parité** (P1) : mêmes lignes et filtres → texte de la grille = lignes du `TableExportPayload` = texte du tableau de la route imprimable | identiques cellule par cellule |
| C8 | `infoSheet` | composant, label, état, tag, date de gel, commit, « n / total », date d'export |

## 3. E2E web — `e2e-web/gh439-version-requirements.spec.ts`

Projet de démo avec un type exigence et une version released créée par le test (modèle : `gh252-versions.spec.ts`,
`setupSession`, sans `allowConsoleErrors` : un canal masqué répondrait 404).

| # | Parcours | Attendu | Couvre |
|---|---|---|---|
| E1 | Page de la version → bouton « Exigences » | la page s'ouvre, grille avec les exigences du gel, ligne d'information « État figé au tag … » | U1 |
| E2 | Modifier une exigence après la release, rouvrir la page | contenu du gel affiché ; colonne « Modifiée depuis » cochée dans 👁 → « Oui » | U2 |
| E3 | Version en cours | ligne d'information « état courant » | U6 |
| E4 | 👁 : décocher `status`, cocher `designStatus`, réordonner, recharger la page | préférences restaurées ; `design` n'est lu qu'une fois la colonne cochée (requête observée) | U12, critère 3 |
| E5 | Filtre « Vérification » = Non couverte | compteur « affichées / total » ; seules ces lignes visibles | U13 |
| E6 | Lecture seule : aucune cellule ne propose d'édition (pas de curseur d'édition, `Entrée` / `F2` n'ouvrent aucun éditeur) ; double-clic sur une ligne | l'exigence s'ouvre | §2.3 |
| E7 | Version abandonnée sans gel | pas de bouton ; URL directe → message « aucun état figé », pas de grille vide | U10 |
| E8 | Retour (bouton Précédent, onglet, barre d'activité) après défilement dans une longue liste | position restaurée sans passer par le haut (leçon GH300 : échantillonner chaque frame, pas seulement l'état final) | défilement |
| E9 | Exécution d'un test passée depuis ailleurs (canal) pendant que la page est ouverte | la couverture se met à jour sans recharger | invalidation |
| E10 | Repo sans exigence | message « Aucune exigence dans cette version » ; Exporter désactivé | U18 |
| E11 | Client web : tous les parcours ci-dessus passent en client web (c'est la cible de cette spec) ; `versions:requirements` répond 200, jamais 404 | | U17 |
| E12 | Clic **souris** dans la fenêtre d'export (pas seulement le clavier) | la fenêtre reste ouverte jusqu'au choix du format (leçon GH416) | export |

## 4. Exports

| # | Cas | Attendu | Couvre |
|---|---|---|---|
| X1 | Exporter → Excel avec un filtre actif et une colonne masquée | classeur : feuille de données avec **les seules lignes filtrées et colonnes visibles, dans l'ordre**, en-tête gras, volets figés ; nom de feuille ≤ 31 caractères | U13, U14 |
| X2 | Même classeur | seconde feuille « Version » : composant, label, état, tag, date de gel, commit, « n / total », date d'export | U14, D6 |
| X3 | Nom de fichier proposé | `<repo>-<label>-exigences.xlsx` / `.pdf` | §4 |
| X4 | Exporter → PDF, 300 exigences (champs richtext longs) | fichier `%PDF`, plusieurs pages, **A4 paysage** (largeur > hauteur de la boîte de page), contient le label de la version et les ID première / dernière ligne | U15 |
| X5 | PDF : texte de la ligne d'en-tête du tableau | présent sur **chaque** page ; pied « page n / N » présent | U15 |
| X6 | PDF filtré | ne contient que les lignes filtrées (texte extrait) | U13 |
| X7 | Parité Excel / PDF / écran | mêmes lignes, mêmes colonnes (C7 en e2e) | critère 4 |
| X8 | Export depuis une version en cours | identification : « état courant », pas de tag ni de commit | §4.1 |
| X9 | Export sur composant en lecture seule | possible ; aucun fichier du repo écrit (statut git vide) | U16, critère 5 |
| X10 | Desktop : export Excel et PDF par la boîte de dialogue native (stub) | fichiers écrits, ouvrables | desktop |

Le PDF se vérifie comme `e2e-web/s4-print.spec.ts` (octets `%PDF`, extraction de texte) ; le contrôle du pied de page et
de l'orientation lit les métadonnées de page du fichier.

## 5. À tester à la main (non couverts par l'automatique)

Ce que l'humain regarde à la validation finale, dans le dossier principal :

1. **Lisibilité du PDF** sur la vraie version produit (projet réel `PH2` ou démo « Lave-linge ») : paysage, colonnes
   proportionnées, aucune ligne coupée entre deux pages, en-tête répété, pied de page.
2. **Classeur Excel** ouvert dans Excel : volets figés, largeurs, hyperlinks éventuels, feuille « Version ».
3. **Sens métier de la colonne « Vérification »** pour une version released dont des exécutions ont eu lieu après la
   release : la couverture courante est affichée (décision D2) ; la colonne « Modifiée depuis » aide-t-elle à le lire ?
4. **Temps d'ouverture** sur un repo de plusieurs centaines d'exigences, colonnes Design et « Modifiée depuis » cochées.
5. **Aspect de la grille** par rapport à la vue Tableau des exigences (colonnes, badge, hauteur des lignes, 👁).

## 6. Traçabilité critères → scénarios

| Critère | Scénarios |
|---|---|
| 1 — U1 à U18 | S1–S19, E1–E11, X1–X10 |
| 2 — liste figée, colonnes courantes | S2, S4, S13, E2 |
| 3 — pas de lecture inutile | S12, C5, E4 |
| 4 — export = affiché | X1, X6, X7, C7 |
| 5 — aucune écriture | S20, X9 |
| 6 — SPEC à jour | revue du dernier sprint (`GH439-sprint3.md` § Mises à jour SPEC) |
