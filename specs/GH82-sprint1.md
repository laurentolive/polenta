# GH82 — Sprint 1 (unique) : renommer un statut ou une valeur d'enum

Spec : `specs/GH82.md` · Design : `specs/GH82-design.md` · Scénarios : `specs/GH82-tests.md`

## Comportement livré

- **Détection** dans l'éditeur de type (onglet Structure) :
  - **statut** : la ligne garde son nom d'origine ; un nom différent est un renommage (une ligne
    supprimée puis recréée n'en est pas un) ;
  - **valeur d'enum / multi_enum** : même position dans une liste de même longueur, à condition que
    l'ancienne valeur ait disparu de la liste et que la nouvelle n'y figurait pas. Réordonner ou
    échanger des valeurs ne propose donc rien (voir Divergences) ;
  - si un champ est renommé dans la même édition, la cible est le nouveau nom du champ.
- **Confirmation avant enregistrement** :
  - une ligne par renommage, cochée par défaut et décochable ;
  - le nombre d'objets concernés, ou « indisponible » si l'aperçu échoue ;
  - un avertissement de collision quand des objets portent déjà la nouvelle valeur (sans faux
    avertissement pour un échange de statuts) ;
  - la mention « requêtes et dashboards du Suivi non modifiés ».
  - Annuler n'enregistre rien et laisse l'édition ouverte. Les raccourcis Entrée / Échap de
    l'édition sont suspendus pendant la confirmation.
- **Migration** (`schema:rename-values`), en écriture brute (ni entrée d'historique, ni
  revalidation, ni changement de `version`) :
  - `status` et `fields.<f>` des objets du type. Pour un `multi_enum`, seul l'élément de la liste
    change ; les séparateurs sont conservés ;
  - les valeurs de `history` ;
  - les copies `testSnapshot` de toutes les campagnes du repo ;
  - le `default` du champ, élément de la liste compris.
- **Compte rendu** commun avec le renommage de champ (GH77) : objets migrés, copies de campagne,
  non migrés, échecs. Les deux migrations sont indépendantes : l'échec de l'une n'empêche pas
  l'autre.

## Fichiers modifiés

| Fichier | Modification |
|---------|--------------|
| `packages/types/src/history.ts` | `ValueRename`, `ValueRenameTarget`, `ValueRenamePreview`, `renameValues`, `valueHas`, `FieldRenameResult.snapshots` |
| `requirements.service.ts`, `tests.service.ts`, `campaigns.service.ts` | `rewriteObjects` générique (`renameFieldKeys` s'appuie dessus) ; `CampaignsService.rewriteSnapshots` |
| `field-rename.service.ts` | `renameValues`, `previewValueRenames` |
| `main/ipc/index.ts`, `web-server/channel-policy.ts`, `packages/api-client` | `schema:preview-value-renames`, `schema:rename-values` (arguments validés) |
| `renderer/components/schema/objectTypeEditor.tsx` | `EditableStatus.originalName`, `valueRenames`, `withRenamedDefaults`, `withOriginalFieldNames` |
| `ValueRenameConfirmModal.tsx` (nouveau) | Confirmation |
| `StructureTab.tsx`, `ElementConfigModal.tsx` | Flux aperçu → confirmation → enregistrement → migrations ; raccourcis suspendus |
| `i18n/locales/{fr,en}.json` | `schema.valueRename.*`, compte rendu des copies |
| Tests | `value-rename.test.ts` (11), `value-rename.service.test.ts` (7), `objectTypeEditor.gh82.test.ts` (10), `e2e-web/gh82-value-rename.spec.ts` (4) |

## Divergences par rapport à la spec et au design

1. **Réordonner ou échanger des valeurs d'enum dans l'éditeur ne propose rien** (spec §1.2 :
   « chaque position modifiée »). La saisie en texte ne permet pas de distinguer un réordonnancement
   d'un renommage croisé, et la confirmation, pré-cochée, aurait inversé les données de tous les
   objets (revue de code). Le critère 6 (échange `a ↔ b`) reste vrai au niveau de la migration (test
   P5) et pour les statuts. Pour échanger deux valeurs d'enum, il faut passer par une valeur
   temporaire en deux enregistrements.
2. **Aperçu sur les anciens noms de champ** quand un champ est renommé dans la même édition (les
   objets portent encore l'ancien nom).
3. La passe sur les copies `testSnapshot` s'exécute pour tout type, sans effet pour un type qui
   n'est pas un type de test. Le design prévoyait de lire la catégorie ; c'est inutile, puisque le
   filtre porte sur l'`objectTypeRef` de la copie.

## Revue de code

**Corrigé** :
- réordonnancement pris pour un échange ;
- champ nommé `status` confondu avec le statut ;
- aperçu à 0 quand un champ est renommé dans la même édition ;
- migrations dépendantes l'une de l'autre ;
- `default` d'un `multi_enum` ;
- séparateurs CSV normalisés ;
- aperçu en échec affiché « 0 objet » ;
- fausse collision sur un échange ;
- JSDoc de `registerHandlers` déplacée.

**Laissé** : la lecture des campagnes en deux ou trois passes. C'est une action rare, et la
réécriture des copies reste bornée au repo.

## Mises à jour SPEC

| Fichier | Section | Modification |
|---------|---------|--------------|
| `SPEC-REQ-requirements.md` | §4.4 | « Renommer un statut ou une valeur d'enum (GH82) » remplace « non migré (#82) » |
| `SPEC-TESTS.md` | §4.2 | Clés des copies migrées au renommage |
| `SPEC-ELECTRON-DESKTOP.md` | §20.4, §20.6 | Canaux, confirmation |
| `SPEC-TEMPLATES.md` | §3.3 | Effet d'un renommage |
| `SPEC-INDEX.md` | 4 lignes | MAJ → GH82 |

## Résultats

- `tsc` : zéro erreur.
- `pnpm test` : 463 tests desktop + 38 merge-core, tous verts.
- e2e web : 79 passés, 13 ignorés (scénarios déployé / OIDC, inchangé), dont `gh82-value-rename.spec.ts` 4/4.

## Comment tester manuellement

1. Renommer le statut d'approbation d'un type de test, avec une campagne contenant un brouillon de
   ce type. Après migration, pas de pastille « Non approuvé » erronée, et la page d'exécution affiche
   le libellé du nouveau statut.
2. Réordonner les valeurs d'un enum : enregistrement direct, sans confirmation, et objets inchangés.
3. Renommer un champ et une de ses valeurs dans la même édition : la confirmation donne le bon
   nombre d'objets, puis champ et valeur sont migrés.
