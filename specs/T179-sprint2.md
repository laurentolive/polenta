# T179 — Sprint 2 (dernier) : interface, exports, SPEC

Réf. : `specs/T179.md`, `specs/T179-design.md` §4, `specs/T179-tests.md` (U1–U13).

## Fichiers modifiés

**Rendu de `{req.<champ>}` hors campagne**
- `renderer/contexts/ParamRefContext.tsx` — `ResolvedParamRef` gagne `req` (référence stylée, titre
  de survol) et `literal` (texte brut) ; les résolveurs de base renvoient `literal` pour une clé
  `req.*` ; nouveau `ReqRefScope` (portée « champ de test » : `req`, candidats du sélecteur) et
  `ReqRefLinkedProvider` (valeurs des exigences liées pour le survol) ; `openPicker(…, extra)`.
- `renderer/lib/markdownParamRefs.ts`, `tiptap/ParamRefDecoration.ts`,
  `components/parameters/ParamRefText.tsx` — rendu `param-ref--req` / texte brut.
- `renderer/components/parameters/ParamPicker.tsx` — `hint` (libellé d'un champ d'exigence).
- `renderer/components/parameters/LinkedReqValues.tsx` (nouveau) — charge les exigences liées d'un
  test (prévisualisation `campaigns:preview-params`, état courant).
- `renderer/components/StepsTable.tsx`, `components/search/SearchResultsDoc.tsx` — étapes dans
  `ReqRefScope` ; `components/system/SystemView.tsx`, `routes/test.$testId.tsx` — `LinkedReqValues`.
- `renderer/index.css` — `.param-ref--req`.
- `packages/types/src/parameter-refs.ts` — `REQ_REF_SYSTEM_FIELDS` partagé (main + renderer) ;
  `main/services/req-refs.service.ts` l'importe.

**Campagnes**
- `renderer/lib/reqInstances.ts` (nouveau) — sélection des exigences par test itérant, complétude,
  construction de `reqInstances`, nombre d'instances.
- `renderer/components/campaign/ReqInstancePicker.tsx` (nouveau) — exigences cochables, valeurs
  `{req.*}` en lecture seule, saisies par instance.
- `renderer/routes/campaign.$campaignId.tsx` — panneau d'ajout (tests itérants via `addTests` +
  `reqInstances`, test présent proposé tant qu'une exigence manque), ID d'exigence cliquable sur
  chaque instance, « Dupliquer » pour la même exigence.
- `renderer/routes/campaign.new.tsx` — même sélecteur à la création.
- `renderer/lib/testParams.ts` — `{req.*}` jamais « à saisir ».
- `renderer/components/RunParamsInfo.tsx` — « Exigence de cette instance » (exécution, relecture).
- `renderer/routes/campaign.$campaignId_.execute.$testId.tsx` — `requirementId` envoyé à l'exécution.
- Exports : `main/services/export/campaign.xlsx.ts` (colonne « Exigence »), `campaign.docx.ts`,
  `renderer/routes/print.campaign-plan.tsx`, `print.campaign-report.tsx` (suffixe `· <ID>`).
- `renderer/i18n/locales/{fr,en}.json` — libellés.

**SPEC** — voir « Mises à jour SPEC ».

## Comportement implémenté

- Panneau d'ajout / création : sous un test itérant, ses exigences liées (hors terminales), cochées
  par défaut, avec les valeurs `{req.*}` figeables et les champs à saisir par exigence ; le bouton
  indique le nombre d'instances ; une exigence déjà instanciée est grisée « déjà présente ».
- Liste de la campagne : `TEST-0012 — … · SYS-0041` (ID cliquable → fiche de l'exigence, cherchée
  dans les repos du workspace).
- Exécution / relecture : bandeau « Exigence de cette instance », valeurs figées stylées ; le run
  enregistré porte `requirementId`.
- Hors campagne : `{req.x}` littéral stylé dans les étapes de test ; survol = valeurs par exigence
  liée dans la fiche/l'édition d'un test, libellé générique ailleurs ; texte brut dans une exigence ;
  sélecteur `{` avec les champs de l'exigence liée.

## Divergences par rapport au design

1. **Portée par contexte React plutôt que prop `reqRefs`** : `ReqRefScope` enveloppe les rendus de
   champs de test (`StepsTable`, étapes de la Recherche) au lieu d'une prop à propager dans chaque
   viewer. Préconditions/postconditions sont des `textarea` sur la fiche test (pas de rendu stylé,
   comme pour les paramètres T171).
2. **Pas de nouvel IPC `tests:linked-requirements`** : le survol réutilise `campaigns:preview-params`
   (valeurs des champs utilisés par le test enregistré).
3. **Exports** : ID de l'exigence seulement (pas son titre, absent du payload).
4. Le sélecteur d'insertion propose les champs d'exigence à la saisie de `{` dans une étape, pas
   via le bouton `{x}` de la barre d'outils (hors portée du test).

## Corrections suite à `/code-review`

- Survol figé : `ReqRefScope` fait évoluer `version` quand les exigences liées arrivent (sinon
  l'éditeur et le rendu statique gardaient le libellé générique).
- Lien vers l'exigence d'une instance : recherche du repo dans le workspace (l'exigence peut
  appartenir à un composant).

## Mises à jour SPEC

- `SPEC-TESTS.md` §2.4a — famille `{req.<champ>}` : champs accessibles, test itérant, exigences
  liées, formatage, affichage, insertion.
- `SPEC-TESTS.md` §4.2 — `requirementId`, raison `no_linked_requirement`, une instance par exigence,
  sélection, déduplication (test, exigence), baseline, « Dupliquer ».
- `SPEC-TESTS.md` §4.4 — instance générée : en-tête, `TestRun.requirementId`, exports.
- `SPEC-TRACEABILITY.md` §2.3 — dernier run par paire selon `requirementId` (matrice, requêtes,
  rapport d'impact, plan de test).
- `SPEC-REQ-requirements.md` §3.2f — `{req.…}` texte brut dans une exigence ; §5.1 — lien de
  couverture = exigences liées pour `{req.…}`.
- `SPEC-INDEX.md` — lignes correspondantes, colonne MAJ → T179.

## Vérifications

- `npm run typecheck` : aucune erreur. Script de service du sprint 1 : 37/37.
- `/code-review` (medium) : 2 constats, corrigés.
- Dans l'app (build + driver Playwright, fixture dédiée) : U1–U5, U7–U10 vérifiés — panneau
  d'ajout, décochage, ré-ouverture (exigence grisée), liste avec ID, exécution SYS-0042 (valeurs
  Turbo / 12 min figées, bandeau), runs écrits avec `requirementId` (FAIL SYS-0042, PASS SYS-0041),
  style et survol dans la fiche test, texte brut dans une exigence, sélecteur `{`.
- Non vérifiés dans l'app : U6 (instance sans exigence liée — couvert par le script, N7), U11
  (exports, fichiers non ouverts), U12 (campagne T171 existante), U13 (thème sombre, tokens de thème
  existants).

## Constats hors périmètre (préexistants)

- Page campagnes vide : « Créer la première campagne » s'affiche mal encodé (`CrÃ©er la premiÃ¨re…`).
- Formulaire « Nouvelle campagne » ouvert depuis le panneau : tests filtrés par
  `<composant>::<type de campagne>`, donc aucun test proposé ; l'ajout passe par la page campagne.
- Rapport d'impact : un test lié par un lien test → exigence n'apparaît pas (cf. `T179-sprint1.md`).

## Comment tester manuellement

1. Un test approuvé avec `{req.target}` dans une étape, lié à deux exigences ayant un champ `target`.
2. Campagne → « Ajouter des tests » → cocher le test : les deux exigences apparaissent cochées avec
   leur valeur ; en décocher une, ajouter → une instance `· <ID>`.
3. Rouvrir le panneau : le test est proposé, l'exigence déjà instanciée est grisée.
4. Exécuter une instance : bandeau d'exigence et valeur figée ; après FAIL, la matrice de
   traçabilité n'affiche l'échec que pour cette exigence.
5. Fiche du test : `{req.target}` stylé, survol = valeurs par exigence.
