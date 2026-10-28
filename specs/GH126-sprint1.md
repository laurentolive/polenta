# GH126 — Sprint 1 : mécanisme générique de colonne éclatée

> Spec : `specs/GH126.md` · Design : `specs/GH126-design.md` §1–§5 · Tests : `specs/GH126-tests.md`

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `packages/types/src/suivi-columns.ts` | `splitColumn` / `splitLabelColumn` dans `QueryColumnDef` et `validateColumnDecl` ; `MAX_SPLIT_COLUMNS` ; `computedColumnKey(id, split?)`, `parseComputedColumnKey` ; `splitColumnValuesFromRows` ; lecture d'une ligne factorisée (`rowReader`) ; `columnFieldDef(…, split?)` |
| `apps/desktop/src/renderer/hooks/useComputedColumns.ts` | option `discover` ; exécution d'une colonne éclatée si une sous-colonne est visible ou ⚙️ ouvert ; analyse des résultats séparée de la visibilité ; déploiement en sous-colonnes `query::<ID>::<valeur>` ; `panel` (colonnes simples / groupes) ; colonnes de substitution pendant le chargement ou en erreur (dernier résultat valide de la session) ; `headerTitle` ; fusion limitée aux colonnes visibles |
| `apps/desktop/src/renderer/components/system/SystemView.tsx` | `discover: showFieldConfig` ; groupe dans la section « Colonnes calculées » du ⚙️ (titre, `(calc)`, chargement, ⚠, une case par sous-colonne) |
| `apps/desktop/src/renderer/components/system/ExcelView.tsx` | infobulle d'en-tête `headerTitle` ; `data-computed-cell` porte la clé de colonne |
| `apps/desktop/src/renderer/components/system/WordView.tsx` | infobulle du libellé `headerTitle` |
| `apps/desktop/src/renderer/components/dashboard/ColumnDeclEditor.tsx` | « Une colonne par valeur de » + « Libellé des colonnes » ; liste de colonnes factorisée (`columnSelect`) |
| `apps/desktop/src/mcp-server/tools/suivi-common.ts` | `splitColumn` / `splitLabelColumn` dans `columnSchema` |
| `apps/desktop/src/main/services/agents-md.template.ts` | une phrase sur les colonnes éclatées |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | `system.fieldConfig.computedGroupPending` / `computedGroupEmpty`, `queryPage.column.split*` |
| `apps/desktop/src/main/services/suivi-columns-split.test.ts` | nouveau — T1–T20, T50 |
| `apps/desktop/e2e-web/gh126-split-column.spec.ts` | nouveau — T21, T23–T34, T38–T39 |

## Comportement implémenté

- Déclaration `column.splitColumn` (+ `splitLabelColumn`) validée, persistée dans `query.yaml`,
  indépendante du modèle, acceptée par le MCP.
- Panneau ⚙️ : groupe par colonne éclatée, une case par sous-colonne dans l'ordre du script,
  décochées par défaut ; nouvelle valeur (campagne) → nouvelle case sans recharger.
- Vues Tableau / Document, filtre de colonne, double-clic, lecture seule, exports, impression :
  chaque sous-colonne est une colonne calculée ordinaire (aucun changement dans ces vues hors
  infobulle).
- Script exécuté une seule fois par requête pour toutes ses sous-colonnes.

## Divergences par rapport au design

- `columnFieldDef` garde l'ID de requête en premier argument et prend un `split?: { value, label }`
  optionnel (au lieu de prendre la clé) : appelants GH70 et tests inchangés.
- Ajouts issus de la revue de code :
  - les colonnes de substitution figurent aussi dans le groupe du ⚙️ (décochables en erreur) ;
  - elles reprennent les sous-colonnes et libellés du **dernier résultat valide de la session**
    (`lastKnownSplits`) : pas de colonne « fantôme » d'une campagne supprimée au chargement, vrai
    libellé en erreur ; sans résultat connu (premier chargement) : libellé provisoire = la valeur ;
  - libellé d'une sous-colonne = premier `splitLabelColumn` **non vide** de ses lignes (et non
    seulement celui de la première ligne) ;
  - choix par défaut de « Une colonne par valeur de » : première colonne du résultat qui n'est ni
    l'identifiant, ni la valeur, ni l'infobulle ;
  - fusion des valeurs dans les objets limitée aux colonnes visibles (le filtre global ne voit pas
    les sous-colonnes exécutées pour le seul ⚙️).
- `data-computed-cell` porte désormais la clé de colonne (au lieu d'une chaîne vide), pour cibler
  une sous-colonne en e2e ; les tests GH70 (présence de l'attribut) ne changent pas.

Points de revue non retenus : échec au-delà de 50 sous-colonnes (choix de la spec) ; libellés
identiques entre deux colonnes éclatées sur les mêmes valeurs (en-tête = libellé de la sous-colonne,
choix de la spec — l'infobulle d'en-tête donne le groupe) ; `isPending` d'une requête désactivée
(comportement GH70 existant).

## Mises à jour SPEC

Aucune à ce sprint (prévues au sprint 2, dernier sprint).

## Tests

- `pnpm test` : 66 fichiers, tous verts (dont 17 tests GH126).
- e2e web : `gh126-split-column.spec.ts` 10/10, `gh70-*` 13/13 ; suite complète exécutée une fois
  (136 passés, 13 ignorés — forge réelle / déploiement).
- **Build web** : `pnpm build:web` échoue sur une installation neuve depuis GH120 (`unzipper` 0.12 →
  `@aws-sdk/client-s3` non résolu) — issue **#128**, hors périmètre. Les e2e ont été exécutés avec
  `@aws-sdk/client-s3` ajouté localement aux `external` de `scripts/build-web-server.ts`, **non
  commité**.

## Tester manuellement

1. Vue Requêtes : nouvelle requête Script partagée renvoyant
   `{ id, value, campaignId, campaignTitle }` par (test, campagne) ; cocher « Utiliser comme
   colonne », « Une colonne par valeur de » → `campaignId`, « Libellé des colonnes » →
   `campaignTitle` ; Sauvegarder.
   (Ou : requête modèle « Entrées de campagne », identifiant `testCaseId`, valeur `status`.)
2. Vue Système → Tests → ⚙️ : groupe avec une case par campagne, décochées ; en cocher deux.
3. Vérifier en-têtes, valeurs, infobulle d'en-tête « groupe — campagne », double-clic, filtre.
4. Créer une campagne puis rouvrir ⚙️ : nouvelle case décochée.
5. Casser le script (`throw`) : ⚠ dans l'en-tête et dans le groupe, cases toujours décochables.
