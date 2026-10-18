# GH104 — Scénarios de test

Fixture : workspace à 2 repos.

- `prod` (racine) : nœud `root`, type `PRODUCT_REQ` (`PRODUCT_REQ-0001..0003`) ; composant local
  `A` (types `A_REQ` : `A_REQ-0001/0002`, `A_TEST` : `A_TEST-0001` avec 1 run, `A_CAMP` :
  `CAMP-0001` contenant `A_TEST-0001`) ; sous-composant `B` de `A` (type `B_REQ` : `B_REQ-0001`) ;
  `links/links.yaml` : 3 liens `A_* ↔ PRODUCT_REQ-*`, 1 lien `B_REQ-0001 ↔ PRODUCT_REQ-0001`,
  1 lien `PRODUCT_REQ-0001 ↔ PRODUCT_REQ-0002` ; `linkTypes` : `implements`
  (`sourceRefs: [A::A_REQ, B::B_REQ]`, `targetRefs: [root::PRODUCT_REQ]`), `verifies`
  (`sourceRefs: [A::A_TEST]`, `targetRefs: [A::A_REQ]`) ; arbres `.polenta/trees/A/*`,
  `.polenta/trees/B/B_REQ.yaml` ; `impact-acks/A_REQ-0001/` ; une revue citant `A_REQ-0001`.
- `comp` : nœud `root`, type `COMP_REQ` (`COMP_REQ-0001`) ; `links/links.yaml` avec un lien
  `COMP_REQ-0001 ↔ A_REQ-0002` ; `linkTypes` citant `A::A_REQ`.

## Main — `schema-refs.util.ts`

- **D1** `mapLinkRefs` : `null` retire la ref ; une liste qui devient vide est conservée (`[]`) ;
  un `linkType` sans `sourceRefs` reste sans la clé. Tests GH100 existants
  (`type-rename.service.test.ts`) passent sans modification.

## Main — `SchemaDeleteService`

- **D2** `plan` (nœud `A`) : `nodes = [A, B]` ; `types` = 4 refs ; `objects` =
  `{ requirement: [A_REQ-0001, A_REQ-0002, B_REQ-0001], test: [A_TEST-0001], campaign: [CAMP-0001] }` ;
  `links` = `prod: 4`, `comp: 1` ; `linkTypes` = `implements` (prod, non vidé), `verifies` (prod,
  vidé), le type de lien de `comp` ; **aucun fichier modifié** (contenu des deux repos comparé
  avant / après).
- **D3** `delete` (nœud `A`) — critère d'acceptation 1 et 2 : les 5 fichiers objets absents ;
  5 pierres tombales dans `prod/.polenta/tombstones/` ; `test-runs/A_TEST-0001/` et
  `impact-acks/A_REQ-0001/` absents ; `prod/links.yaml` ne garde que le lien
  `PRODUCT_REQ-0001 ↔ PRODUCT_REQ-0002` ; lien de `comp` supprimé (critère 4) ;
  `.polenta/trees/A/` et `.polenta/trees/B/` absents ; schéma de `prod` sans `A` ni `B`,
  `implements.sourceRefs = []`, `verifies` conservé avec `sourceRefs: []`, `targetRefs: []`
  (critère 6) ; ref `A::A_REQ` retirée du schéma de `comp`.
- **D4** type seul `A::A_TEST` (critère 3) : seuls `A_TEST-0001`, son run, ses liens, son arbre et
  la ref `A::A_TEST` disparaissent ; `A_REQ-*`, `CAMP-0001` (type `A_CAMP`) inchangés ; la
  campagne contient toujours l'entrée (affichée « test supprimé »).
- **D5** collision de ref (critère 5) : `comp` déclare aussi un nœud `A` avec type `A_REQ` → ref
  `A::A_REQ` **conservée** dans `comp`, retirée dans `prod`.
- **D6** `REPO_MISSING` : `comp` absent du disque → `plan.errors`, `delete` lève, aucun fichier
  modifié.
- **D7** `READONLY` : nœud `A` `readonly: true` → erreur, aucune écriture ; repo épinglé (pin SHA)
  idem.
- **D8** `NOT_FOUND` : type renommé entre l'aperçu et `delete` → `delete` lève, aucune écriture.
- **D9** échec partiel : un fichier objet verrouillé / non supprimable (mock `git.deleteFile` qui
  lève pour `A_REQ-0002`) → listé dans `failed`, les autres étapes faites, **schéma de `prod`
  encore écrit en dernier** ; relancer `delete` termine la suppression (idempotent).
- **D10** pierres tombales (critère 8) : après D3, recréer un type de préfixe `A_REQ` puis une
  exigence → `A_REQ-0003`.

## Renderer

- **D11** corbeille d'un composant : `previewDelete` appelé, `schema.save` **non** appelé avant
  confirmation ; Annuler → ni `schema.delete` ni `schema.save` (critère 7).
- **D12** modale : comptes exacts de D2 affichés (3 exigences, 1 test, 1 campagne, 5 liens dans
  2 repos, `verifies` « devient invalide ») ; lignes à 0 masquées ; `errors` → bouton Supprimer
  désactivé.
- **D13** écran de revue : la revue citant `A_REQ-0001` s'ouvre après suppression, l'objet est
  affiché indisponible (pas d'exception).
- **D14** bouton Supprimer de `ElementConfigModal` et corbeille d'`ElementLeaf` → même flux
  (aperçu puis modale) ; élément `isNew` abandonné → suppression directe sans aperçu.
- **D15** e2e web (`e2e-web/gh104-delete-cascade.spec.ts`, modèle `gh82-value-rename.spec.ts`) :
  supprimer un composant local avec objets → modale avec comptes → Supprimer → composant absent
  de Structure, liste des exigences sans ses objets, compte rendu affiché.

## Critères d'acceptation

- `pnpm typecheck` et `pnpm test` verts (desktop + types), e2e D15 vert.
- Critères 1–9 de `specs/GH104.md` couverts : 1→D3, 2→D3, 3→D4, 4→D3, 5→D5, 6→D3/D12,
  7→D11/D12, 8→D10, 9→D2–D15.
