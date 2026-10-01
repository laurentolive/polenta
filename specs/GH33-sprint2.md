# GH33 — Sprint 2 : sélecteur à la création de campagne, clôture

Spec : `specs/GH33.md` — Design : `specs/GH33-design.md` — Scénarios : `specs/GH33-tests.md`

## Fichiers modifiés

| Fichier | Nature |
|---------|--------|
| `apps/desktop/src/renderer/routes/campaign.new.tsx` | La liste de cases est remplacée par le bouton « Sélectionner des tests… » / « Modifier la sélection… », un récapitulatif et la modale (`mode="create"`). |
| `apps/desktop/src/renderer/components/campaign/TestPickerModal.tsx` | Rendu par portail (`document.body`) ; type par défaut amélioré (voir revue de code). |
| `apps/desktop/src/renderer/i18n/locales/fr.json`, `en.json` | + `campaignPage.picker.openSelect` / `edit` / `instances_*`. Suppression des clés devenues inutiles `campaignPage.addTestsSelected_*` et `campaignPage.alreadyPresent_*`. |
| `specs/SPEC-TESTS.md`, `specs/SPEC-SYSTEM-VIEW.md`, `specs/SPEC-INDEX.md` | Mises à jour SPEC (voir plus bas). |

## Comportement implémenté

- **`/campaign/new`** :
  - le bouton ouvre la modale avec la sélection et les saisies courantes du formulaire,
    préremplissage T46 compris ;
  - valider remplace `selectedTests`, `paramValues` et `reqSel` du formulaire ;
  - annuler ne change rien (confirmation si la sélection a été modifiée).
- **Candidats** : tous les tests du repo, filtrés par composant/niveau, sans contrôle « approuvé »,
  comme avant. Les tests préremplis hors filtre restent sélectionnés et sont comptés dans « non
  affichés ».
- **Récapitulatif** : ID et titre de chaque test ; « N instances » pour un test itérant ; valeurs
  saisies sous la forme `label=valeur`. Un avertissement « paramètres incomplets » s'affiche si
  la sélection n'est plus complète, par exemple après un changement de `baselineRef`. « Créer »
  reste désactivé dans ce cas (règle inchangée).
- **Prévisualisation** : la modale lit les paramètres au `baselineRef` saisi dans le formulaire.
- **Création** : `createMutation` est inchangé. Une campagne sans test reste possible.

## Divergences par rapport au design

- **Revue de code — défaut 1** : la modale était rendue dans le `<form>` de création, donc
  `Entrée` dans un de ses champs (filtre, paramètres) soumettait le formulaire et créait la
  campagne. Elle est maintenant rendue par portail dans `document.body`, ce qui protège aussi
  tout futur hôte.
- **Revue de code — défaut 2** : avec seulement `component` ou seulement `level` dans la route,
  la modale s'ouvrait sur le premier type du schéma, parfois sans aucun test proposé. Le type par
  défaut est désormais choisi dans cet ordre :
  1. le type de la route ;
  2. le premier type ayant des tests proposés ;
  3. le premier type.
- **Fichier `routeTree.gen.ts`** : régénéré en local par `pnpm dev` (fins de ligne seulement), il
  a été restauré et n'est pas commité.

## Mises à jour SPEC

| Section | Modification |
|---------|--------------|
| `SPEC-TESTS.md` §4.2 | Nouveau paragraphe « Sélecteur de tests (GH33) » : modale 2 étapes à la création et à l'ajout, un type à la fois, Vue Excel en mode sélection, compteur, tests hors arbre, étape paramètres conditionnelle, confirmation d'abandon, candidats inchangés. |
| `SPEC-SYSTEM-VIEW.md` §Vue Excel | Nouveau point « Mode sélection (GH33) » : lecture seule forcée, sélection par `objectId`, sémantique case / clic / Ctrl / Maj / ancre, cases trois états repli ignoré, état local non persisté. |
| `SPEC-SYSTEM-VIEW.md` §Filtre par colonne | `Échap` consommé par le popover : il ne ferme pas une modale hôte. |
| `SPEC-INDEX.md` | Lignes SPEC-TESTS §4.1–4.2, SPEC-SYSTEM-VIEW §Filtre par colonne et §Configuration des champs / §Vue Excel : descriptions et mots-clés complétés, `MAJ` → GH33. |

## Vérifications

- `pnpm typecheck` (apps/desktop) : 0 erreur. `--noUnusedLocals` est propre sur les fichiers
  touchés.
- Pas de tests automatiques dans `apps/desktop` : les scénarios C, L et R de `GH33-tests.md`
  restent à dérouler.

## Comment tester manuellement

`pnpm dev` depuis `../polenta-official-GH33` :
- **C1–C7** sur `/campaign/new`, dont le préremplissage T46 depuis « Générer une campagne » de
  l'analyse d'impact ;
- **Entrée** dans le filtre et dans les paramètres de la modale : la modale ne doit pas créer la
  campagne ;
- **L1–L5** ;
- **R1–R2** : non-régression de la Vue Excel dans la vue système.

## Tests de l'application (pilotage Playwright `_electron`)

Exécution automatisée sur le build `out/`, avec un profil Electron isolé
(`--user-data-dir`). Le jeu de données est une **copie** du projet `handstickProduct`, préparée
ainsi :
- 60 tests approuvés ;
- 16 tests passés dans le type `VE22D::VE22D_TEST` ;
- dans l'arbre : « Dossier A » avec son « Sous-dossier A1 », et un « Dossier brouillons » ;
- un test retiré de l'arbre (orphelin) ;
- `PRODUCT_TEST-0003` avec une référence à saisir `{vitesse_essai}` ;
- `PRODUCT_TEST-0029` itérant (`{req.id}`, 3 exigences liées).

Les scénarios ont été pilotés avec de vrais clics souris, Ctrl et Maj compris, et l'état a été
vérifié dans le DOM et dans les YAML de campagne.

| Scénarios | Résultat |
|-----------|----------|
| N1–N6 | OK. N4 : 3 exigences liées → « Ajouter (3) » ; en décocher une → « Ajouter (2) » ; 2 instances avec `requirementId`. |
| S1–S13 | OK |
| F1–F5 | OK |
| A1–A5 | OK. A5 : le fichier de préférences `.<user>.pref` n'est pas modifié par les manipulations dans la modale. |
| A6 | OK après correctif (voir ci-dessous). |
| C1–C5 | OK. Entrée dans le filtre et dans un paramètre ne créent pas la campagne. |
| C7 | Créer une campagne sans test : non exécuté. |
| L2, L3 | OK |
| R1–R2 | OK : vue système sans colonne de cases ; crayon, glisser-déposer et Ctrl+clic (T149) intacts ; `Échap` dans le popover de filtre colonne. |
| Non testés | C6 (le projet n'a pas de tag de baseline), L1 (aucun projet sans type de test), L4 (performances ressenties) et L5 (langue EN). |

### Correctifs issus des tests

- **A6** : la modale d'ajout était rendue dans le bloc réservé aux campagnes actives. Si la
  campagne était clôturée ailleurs (rechargement par le watcher), la modale disparaissait sans
  message et la sélection était perdue. Elle est maintenant rendue hors de ce bloc : l'erreur
  « Cannot add tests to a completed campaign » s'affiche dans le pied et la modale reste
  ouverte.
- **Pluriel du compteur** : « dont 1 non affichés » suivait le total au lieu du nombre de tests
  masqués. Le suffixe porte désormais son propre pluriel (`campaignPage.picker.hiddenSuffix_*`).

### Bug préexistant constaté, hors périmètre

« + Nouvelle campagne » (panneau Campagnes) ouvre `/campaign/new` avec `level` égal au **type
de campagne** (ex. `PRODUCT_CAMP`). Le formulaire filtre les tests sur ce `level`, donc aucun
test n'est proposé. Le filtre date du commit initial et l'ancienne liste était tout aussi vide.
Il est signalé dans une issue séparée.
