# GH204 — Sprint 2 : vue Validation

## Fichiers

- **Nouveaux** : `renderer/routes/validations.tsx`, `validation.$validationId.tsx` ; `components/sidebar/ValidationPanel.tsx` ;
  `components/validation/` (`ValidationGrid`, `ValidationRuns`, `runMentions`, `useValidations`) ;
  `e2e-desktop/gh204-validation.spec.ts`.
- **Modifiés** : `ActivityBar`, `AppLayout`, `Sidebar`, `TabsContext`, `platform.ts`, `useLiveFileSync`, `routeTree.gen.ts`,
  locales ; `IssueProposalDialog` (origine exécution ou décision) et ses deux appels ; `field-rename`, `type-rename`,
  `git.service` ; `agents-md.template.ts`.

## Comportement

Conforme à `specs/GH204.md` §7. Vue desktop seulement, entrée masquée sur le web.

## Divergences par rapport au design

- **Boîtes de dialogue dans la page et le panneau** plutôt que des fichiers `SignValidationDialog` et `NewValidationDialog` :
  elles ne servent qu'à un endroit.
- **Colonnes** : pas de grille partagée avec la Vue Système, trop liée aux dossiers et aux types d'objet.
- **`entryFields` saisis dans la ligne dépliée**, pas dans la cellule : tous les types de champ restent possibles.

## Défauts trouvés

- **E2E** : déplier une exigence plantait la page sur une date de run lue comme `Date` YAML (fichier édité à la main).
- **Revue de code** (10 corrections) :
  - un `requiredWhen` sur le statut signé n'était pas contrôlé ;
  - un type dont le premier statut est `isApproval` créait des validations déjà signées ;
  - un commit figé absent donnait un périmètre vide, donc une signature possible et des décisions effacées ;
  - les champs et statuts renommés n'étaient pas migrés ;
  - un préfixe d'exigence modifié faisait perdre les décisions : figé, voir `specs/GH204.md` §2 ;
  - compléter une proposition la confirmait ;
  - une relecture de la page effaçait les saisies en cours ;
  - les widgets du Suivi n'étaient pas invalidés ;
  - un historique de statut désactivé perdait signataire et date ;
  - les tests jamais exécutés n'apparaissaient pas, et une exécution n'avait pas de lien.

## Limites

- **Exécutions d'un test d'un autre repo** : non lues, le service d'historique est limité au repo. La couverture, elle,
  couvre le workspace : une exigence de composant vérifiée par un test du produit s'affiche « Vérifié », avec son test
  marqué « Exécutions dans un autre composant ».
- **Ouverture d'une version released** : une lecture git par exigence, mise en cache. Non mesurée sur plusieurs centaines
  d'exigences.

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `SPEC-REQ-requirements.md` §13 | nouvelle section |
| `SPEC-MCP-SERVER.md` §4.10 | outils de validation |
| `SPEC-DASHBOARDS.md` | collection `validations`, `designVersion` |
| `SPEC-TEMPLATES.md` | catégorie `validation` |
| `SPEC-ELECTRON-DESKTOP.md` §19.2 | panneau et page |
| `SPEC-WEB.md` §11 | limite ajoutée |
| `SPEC-SYSTEM-VIEW.md` | vues enregistrées de la validation |
| `SPEC-INDEX.md` | ligne §13 |
| `MILESTONE-D.md` §5, `GH191.md` §3 et §5 | renvois |

`SPEC-TRACEABILITY.md` : sans changement, le statut de vérification est lu tel quel.

## Comment tester à la main

1. `/schema`, ligne du repo, « + Validation ». Vérifier les décisions proposées, puis enregistrer.
2. Panneau Version : créer une version, y inclure des exigences, passer released.
3. Panneau Validation : « Créer la validation » sur cette version.
4. Choisir « Non conforme » sur une exigence : la proposition d'issue s'ouvre.
5. « Signer » avec une exigence en attente : les motifs s'affichent. Tout décider, signer : commit, grille en lecture.
6. Modifier une exigence, créer une version suivante basée sur la première, puis sa validation : les décisions sont
   reprises, sauf pour l'exigence modifiée.
7. Sur un produit à composants : état des validations des composants dans l'en-tête.
