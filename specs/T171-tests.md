# T171 — Scénarios de test

Pas de framework de test automatisé dans `apps/desktop` : `tsc` + script de service (tsx, repos
git temporaires, sans Electron, comme T172) pour le main, tests manuels pour l'UI.

## Jeu de données

Workspace : repo produit `PL` + composant `motor-control` (submodule, modifiable) + composant
`bms` (submodule `readonly: true`).
- `PL/parameters/parameters.yaml` : `puissance_turbo` (450, W), `puissance_eco` (150, W),
  `vide` (value `""`).
- `motor-control/parameters/parameters.yaml` : `courant_max` (12, A).
- `bms/parameters/parameters.yaml` : `tension_max` (16.8, V).
- `PL` : SYS-1 `approved`, statement `WHEN turbo THE system SHALL deliver {puissance_turbo}` ;
  SYS-2 `draft` avec `{motor-control::courant_max}` ; SYS-3 `obsolete` avec `{puissance_eco}` ;
  TEST-1 `approved`, expectedResult `≥ {puissance_turbo}`, lié à SYS-1 ; SW-9 `draft` lié à SYS-1.
- `motor-control` : TEST-MC-1 avec `{courant_max}` et `{numero_serie}`.

## Sprint 1 — Base et vue Paramètres

| # | Scénario | Attendu |
|---|---|---|
| S1.1 | Ouvrir la vue Paramètres | Groupes PL, motor-control, bms ; valeurs, unités, nombre d'utilisations (puissance_turbo = 2) |
| S1.2 | Recherche « 450 » | Seul `puissance_turbo` reste |
| S1.3 | « Utilisé par » de `courant_max` | SYS-2 (réf. cross-composant depuis PL) et TEST-MC-1 ; chaque lien ouvre l'élément |
| S1.4 | Créer `tension_nominale` = 14.4 V dans PL | Entrée ajoutée, fichier réécrit avec clés triées (CA 19) |
| S1.5 | Créer un nom invalide (`a b`) ou existant | Refus avec message |
| S1.6 | Repo `bms` | Pas de création ni d'édition possible (lecture seule) ; l'IPC refuse aussi |
| S1.7 | Modifier `puissance_turbo` 450 → 400 | Confirmation listant SYS-1 et TEST-1 ; après confirmation : SYS-1, TEST-1 **et** SW-9 marqués `needsRevalidation` ; statuts inchangés ; `links.yaml` inchangé (CA 16) |
| S1.8 | Annuler la confirmation | Rien n'est écrit, rien n'est marqué |
| S1.9 | Modifier seulement la description de `puissance_turbo` | Pas de confirmation, aucun marquage |
| S1.10 | Modifier `courant_max` (utilisé seulement par SYS-2 draft et TEST-MC-1 draft) | Pas de confirmation, aucun marquage |
| S1.11 | Créer `numero_serie` dans motor-control alors que TEST-MC-1 est `approved` | Confirmation ; TEST-MC-1 et ses éléments liés marqués |
| S1.12 | Supprimer `puissance_turbo` | Refus avec SYS-1, TEST-1 cliquables (CA 14) |
| S1.13 | Supprimer `puissance_eco` (utilisé seulement par SYS-3 `obsolete`) | Confirmation simple puis suppression ; SYS-3 listé grisé avant |
| S1.14 | Repo sans `parameters/parameters.yaml` | Base vide, pas d'erreur ; première création crée le fichier |
| S1.15 | `parameters.yaml` édité à la main avec `value: 12` (nombre) | Lu comme `"12"` |

## Sprint 2 — Affichage et insertion

| # | Scénario | Attendu |
|---|---|---|
| S2.1 | Vue Word, SYS-1 | « SHALL deliver 450 W », valeur stylée ; survol = `puissance_turbo` + description (CA 1) |
| S2.2 | Double-clic sur la valeur | Dialogue d'édition ; après modification (et confirmation), nouvelle valeur affichée (CA 2) |
| S2.3 | SYS-2 | Valeur de `courant_max` du composant (CA 6) |
| S2.4 | Référence à `vide` | Littérale `{vide}`, style « non résolue » (CA 10) |
| S2.5 | `{inconnu}` dans une exigence ; double-clic | Style non résolue ; propose la création avec le nom pré-rempli |
| S2.6 | `{bms::tension_max}` depuis PL, double-clic | Dialogue en lecture seule |
| S2.7 | Vue Excel (cellule richtext et cellule texte) | Même rendu que Word |
| S2.8 | Vue Édition : champ en édition | `{puissance_turbo}` affiché avec le style, survol = valeur ; la valeur stockée reste `{puissance_turbo}` |
| S2.9 | Fiche de TEST-1 (Word / Édition, étapes) | « ≥ 450 W » stylé, double-clic édite (CA 17) |
| S2.10 | Recherche contenant SYS-1 | Rendu identique |
| S2.11 | « Insérer un paramètre » dans l'éditeur | Liste des paramètres de PL et des composants visibles ; choix d'un paramètre de motor-control insère `{motor-control::courant_max}` (CA 15) |
| S2.12 | Taper `{` dans l'éditeur | Autocomplétion identique |
| S2.13 | « Créer un paramètre » depuis le sélecteur | Entrée créée dans le repo courant et référence insérée |
| S2.14 | Changer la branche de motor-control (autre valeur de `courant_max`) | SYS-2 affiche la nouvelle valeur, aucun marquage (CA 12) |
| S2.15 | Export docx / xlsx / pdf des exigences et des tests | Mêmes valeurs qu'à l'écran ; non résolues littérales (CA 18) |
| S2.16 | `{puissance_turbo}` dans un bloc de code Markdown | Reste littéral |

## Sprint 3 — Campagnes

| # | Scénario | Attendu |
|---|---|---|
| S3.1 | Campagne sans baseline, ajouter TEST-1 | Pas de saisie pour `puissance_turbo` ; exécution « ≥ 450 W » ; `resolvedParams.puissance_turbo = "450 W"` (CA 3) |
| S3.2 | Passer `puissance_turbo` à 400 après l'ajout | Campagne existante inchangée ; nouvel ajout ailleurs = 400 W (CA 4) |
| S3.3 | Campagne de motor-control, ajouter TEST-MC-1 | `courant_max` résolu dans motor-control ; `numero_serie` demandé en saisie (CA 5 reformulé, CA 9) |
| S3.4 | Campagne `baselineRef: baseline/v1.0` (450 au tag, 400 courant) | 450 W ; `paramSourceRef = baseline/v1.0` ; en-tête indique le tag (CA 7) |
| S3.5 | `baselineRef` sans tag correspondant | Ajout autorisé ; référence littérale, style non résolue, non proposée en saisie ; signalée avant validation, toast après ajout, indicateur et bandeau ; `unresolvedParams: [{ref: puissance_turbo, reason: tag_not_found}]` (CA 8) |
| S3.6 | `{motor-control::inconnu}` | Non demandé, littéral, `reason: missing` (CA 9) |
| S3.7 | Référence à `vide` | `reason: empty`, littérale (CA 10) |
| S3.8 | Test dont toutes les références sont résolues | Pas de « Dupliquer » (CA 11) |
| S3.9 | Formulaire de création de campagne | Résolues affichées en lecture seule, seules les saisies manuelles demandées ; validation possible sans elles si aucune à saisir |
| S3.10 | Exports plan / rapport (docx, xlsx, pdf) | Valeurs figées, y compris saisies T97 (CA 18) |
| S3.11 | Campagne T97 existante, repo sans base | Affichage identique à avant T171 (CA 20) |
| S3.12 | `paramValues` envoyé pour une clé résolue par la base | Ignoré ; la clé ne figure que dans `resolvedParams` |
| S3.13 | Tag annoté et tag léger | Les deux sont lus |

## Critères transverses

- `tsc --noEmit` : `apps/desktop`, `apps/api`, `apps/web`, `packages/*` — zéro nouvelle erreur.
- Aucune autre définition de la grammaire que `PARAM_REF_RE` (`grep -rn "\\\\{(\\[A-Za-z0-9_-\\]" apps packages`).
- Script de service (sprint 1 et 3) : S1.4–S1.15, S3.1–S3.8, S3.12, S3.13.
