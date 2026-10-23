# GH81 — Scénarios de test

Spec : `specs/GH81.md` — design : `specs/GH81-design.md`.
Notation : V1, V2 = contenus successifs d'un test `draft` ajouté à une campagne ouverte (instance
resynchronisable). « Aucune écriture » = `campaigns/<id>.yaml` inchangé sur disque (contenu et
`git status`).

## 1. Unitaires — `CampaignsService`

| # | Scénario | Attendu |
|---|---|---|
| U1 | `effectiveTests` : instance pending, copie V1 draft, test live V2 | entrée → V2 (sans `history`), `resyncable: true` ; aucune écriture |
| U2 | Copie approuvée | copie, `resyncable: false` |
| U3 | Instance exécutée / campagne clôturée | copie, `resyncable: false` |
| U4 | Entrée pré-T49 (sans copie) | test live, `resyncable: false` |
| U5 | Test resynchronisable supprimé | copie, `resyncable: false`, pas d'erreur |
| U6 | Schéma absent | repli `approved` : copie draft → `resyncable: true` |
| U7 | `updateRun` avec `testSnapshot` V1 sur instance resynchronisable (live = V2) | copie = V1 sans `history`, résultat enregistré, **une** écriture |
| U8 | `updateRun` avec `testSnapshot` sur copie approuvée / instance déjà exécutée | copie inchangée, résultat enregistré |
| U9 | `updateRun` avec `testSnapshot.id` ≠ `testCaseId` | erreur ; campagne inchangée |
| U10 | `updateRun` sans `testSnapshot` | comportement actuel (copie inchangée) |
| U11 | `updateRun` concurrents (file `enqueue`) | fichier final cohérent |
| U12 | `testFingerprint` | stable à l'ordre des clés près, ignore `history` et clés `undefined` ; change si une étape change, si `version` est identique mais le contenu diffère |

## 2. Unitaires — export / import (`CampaignExecutionService`, `validateExecutionImport`)

| # | Scénario | Attendu |
|---|---|---|
| X1 | Export, instance resynchronisable (copie V1, live V2) | classeur = V2 ; **aucune écriture** ; `_polenta` v2 avec empreinte de V2 |
| X2 | Export, instance approuvée | copie exportée, empreinte de la copie |
| X3 | Export, campagne clôturée | refus, aucune écriture (inchangé) |
| X4 | Export V2 → import sans changement | importable ; après `apply`, copie = V2, résultat enregistré |
| X5 | Export V2 → test modifié V3 → import | erreur `test_changed_since_export` pour l'instance ; autres instances importées ; copie inchangée |
| X6 | Cas #75 : export (3 étapes) → étape insérée en position 2 → import | `test_changed_since_export` (pas `steps_mismatch`) |
| X7 | Modification du YAML du test hors application, `version` inchangée, entre export et import | `test_changed_since_export` |
| X8 | Classeur v1 (sans colonne empreinte) | pas de refus `unsupported_version` ; importé ; copie actuelle conservée (pas de gel live) |
| X9 | Version de format inconnue (ex. 3) | refus global `unsupported_version` (inchangé) |
| X10 | Avertissement `test_not_approved` | porté par la version effective (live draft → avertissement) |
| X11 | Instance approuvée, test modifié après export | la copie n'a pas changé → empreinte égale → importée (copie figée inchangée) |

## 3. E2E web (`e2e-web/gh81-*.spec.ts`, et adaptation de `gh68-unapproved` / `gh80-execute-switch`)

| # | Scénario | Attendu |
|---|---|---|
| E1 | Test draft V1 dans une campagne, test modifié en V2, ouvrir la page d'exécution puis revenir à la campagne | V2 affiché ; fichier de campagne inchangé (copie V1) |
| E2 | Ouvrir l'exécution (V2 affiché), modifier le test en V3 par l'API, saisir et confirmer « Exécuter quand même » | bandeau « le test a changé » visible ; copie enregistrée = V2 ; instance exécutée |
| E3 | Après E2, le test passe en V4 | copie de l'instance exécutée toujours V2 ; badge « Non approuvé » conservé |
| E4 | Test approuvé (GH68 E6) | ni bandeau ni confirmation ; copie inchangée après saisie |
| E5 | Passer de l'entrée A à l'entrée B (GH80 X1) | B affiché en version live ; aucune écriture |
| E6 | Client web : télécharger le classeur d'exécution | aucune écriture du fichier de campagne |
| E7 | Channel `campaigns:refresh-entries` | refusé par le serveur web (absent de la liste blanche) |

## 4. Manuel (desktop)

| # | Scénario | Attendu |
|---|---|---|
| M1 | Ouvrir l'exécution d'un brouillon modifié, quitter sans saisir | `git status` propre |
| M2 | Exporter le classeur, modifier un test exporté, réimporter | aperçu : instance en erreur « le test a changé depuis l'export » ; autres importées |
| M3 | Importer un classeur exporté avant GH81 | aperçu sans erreur de format ; import OK |

## 5. Critères d'acceptation couverts

CA1 → E1, M1 · CA2 → X1, E6 · CA3 → U7, E2 · CA4 → U7, X4 · CA5 → X5, X6, M2 · CA6 → X4 ·
CA7 → X7 · CA8 → X8, M3 · CA9 → U2, U3, U8, X11, E3, E4 · CA10 → U9 (fichier de campagne ; cf.
design §4).
