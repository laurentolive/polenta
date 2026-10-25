# GH126 — Sprint 2 : bibliothèque, modèle « Résultat par campagne », démo, SPEC

> Spec : `specs/GH126.md` · Design : `specs/GH126-design.md` §6 · Tests : `specs/GH126-tests.md` §6

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `apps/desktop/resources/dashboard-lib/campaign.js` | v4 : `entryResultsByCampaign(data)` (import `worst` de `status.js`) |
| `apps/desktop/resources/dashboard-lib/manifest.json` | version 4 de `campaign.js` (empreinte, résumé fr/en) ; v1–v3 conservées → bandeau des mises à jour |
| `packages/types/src/suivi-templates.ts` | modèle `campaign-results` (« Résultat par campagne (colonnes) ») : script + déclaration éclatée proposée |
| `packages/types/src/suivi-columns.ts` | validation : `splitColumn` égale à la colonne identifiant ou valeur → refusée (revue) |
| `apps/desktop/src/renderer/hooks/useComputedColumns.ts` | revue : cache du dernier résultat indexé aussi par `splitColumn` ; `pending` / `ready` limités aux colonnes visibles |
| `apps/desktop/src/renderer/components/dashboard/ColumnDeclEditor.tsx` | revue : « Une colonne par valeur de » indisponible tant qu'aucune colonne candidate n'est connue (plus de repli sur `id`) |
| `apps/desktop/src/mcp-server/tools/queries.tools.ts`, `main/services/agents-md.template.ts` | description : colonnes éclatées, modèle `campaign-results` |
| `scripts/demo-lave-linge/content.mjs` | QUERY-0011 « Résultat par campagne » (modèle) |
| `apps/desktop/src/main/services/suivi-corpus.test.ts` + `fixtures/suivi-corpus/demo-columns.json` | cas « Colonne / Résultat par campagne » (ajout seul : la référence existante est inchangée) |
| `apps/desktop/src/main/services/suivi-columns-split.test.ts` | T41–T49, validation `splitColumn` = identifiant |
| `apps/desktop/src/main/services/dashboard-library.service.test.ts` | catalogue des modèles |
| `apps/desktop/e2e-web/gh126-split-column.spec.ts` | T47 — modèle sur la démo |
| `specs/SPEC-DASHBOARDS.md`, `SPEC-SYSTEM-VIEW.md`, `SPEC-MCP-SERVER.md`, `SPEC-INDEX.md` | cf. § Mises à jour SPEC |

## Comportement implémenté

- `entryResultsByCampaign` : une ligne par (campagne, test ayant une entrée active) ; campagnes par
  `createdAt` puis ID, abandonnées comprises ; entrées retirées ignorées ; test itérant → pire
  statut (`worst`), `statuses` de toutes les instances.
- Modèle `campaign-results` : lignes `id`, `value`, `campaignId`, `campaignTitle`, `tooltip`,
  `_ids` ; déclaration proposée `splitColumn: campaignId`, `splitLabelColumn: campaignTitle`,
  `values: [PASS, FAIL, BLOCKED, INCOMPLETE, pending]`. Une requête créée depuis ce modèle donne
  directement une sous-colonne par campagne dans ⚙️.

## Divergences par rapport au design / à la spec

- **Instance de référence d'un test itérant** (revue) : `entryId` / `executedAt` / `executedBy` sont
  ceux de l'instance qui **porte le pire statut** (la plus récemment exécutée parmi elles), et non
  de la plus récente toutes instances confondues (spec §6.1) : double-clic et infobulle renvoient à
  l'instance en échec. Pire statut `pending` → instance non exécutée, `executedAt` / `executedBy`
  nuls (« · non exécuté »). Spec et SPEC-DASHBOARDS §4 décrivent la règle retenue.
- Infobulle du modèle : « non exécuté » / « not executed » selon `polenta.locale`.
- Validation supplémentaire : `splitColumn` ne peut pas être la colonne identifiant ni la colonne
  valeur effectives (`COLUMN_INVALID`).
- **e2e « v3 → mise à jour »** prévu (M1) non reproductible : la bibliothèque de la démo e2e est
  copiée au premier accès depuis le contenu livré, donc déjà en v4. Couvert par T49 (manifeste :
  v4 = contenu livré, v1–v3 connues) et par les tests existants du bandeau
  (`suivi-updates.test.ts`). À vérifier à la main dans PH2 (M1).
- Revue de code, point essayé puis écarté : compléter les colonnes de substitution par les clés
  visibles absentes du dernier résultat valide — ressuscitait la colonne d'une campagne supprimée
  en cas d'erreur (T33 l'a détecté). Règle du sprint 1 conservée ; un résultat rafraîchi ne passe
  pas par les colonnes de substitution (react-query garde l'ancien résultat pendant le recalcul).

Points de revue non retenus : en-têtes identiques pour deux colonnes éclatées sur les mêmes
campagnes (en-tête = libellé de la sous-colonne, choix de la spec ; l'infobulle d'en-tête porte le
groupe) ; statut `pending` affiché brut (cohérent avec PASS / FAIL bruts de GH70) ; erreur d'import
avec une bibliothèque v3 (comportement connu GH70, résolu par le bandeau des mises à jour).

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `SPEC-DASHBOARDS.md` §4 | `campaign.js` : `entryResultsByCampaign` (v4) et sa règle |
| `SPEC-DASHBOARDS.md` §5 | modèle « Résultat par campagne (colonnes) » `campaign-results` |
| `SPEC-DASHBOARDS.md` §5.2 | `splitColumn` / `splitLabelColumn` dans la déclaration ; § « Colonne éclatée » (clés, ordre, libellé, erreurs, limite 50) ; saisie dans `ColumnDeclEditor` ; exécution (déploiement dans le hook, `discover`, fusion des seules colonnes visibles, colonnes de substitution) |
| `SPEC-DASHBOARDS.md` §7.0 | `query.yaml` : `splitColumn` / `splitLabelColumn` |
| `SPEC-SYSTEM-VIEW.md` §Vue Excel | sous-colonnes = colonnes calculées à part entière, infobulle d'en-tête du groupe |
| `SPEC-SYSTEM-VIEW.md` §Configuration des champs | groupe ⚙️, une case par sous-colonne, découverte à l'ouverture, sous-colonnes cochées décochables en erreur |
| `SPEC-SYSTEM-VIEW.md` §Persistance | clés `query::<ID>::<valeur>` |
| `SPEC-MCP-SERVER.md` §global | `create_query` / `update_query` / `list_queries` : `splitColumn` / `splitLabelColumn` |
| `SPEC-INDEX.md` | colonne `MAJ` → GH126 et mots-clés pour les 4 lignes ci-dessus |

## Tests

- `pnpm test` : 66 fichiers, 759 tests verts (manifeste `--check` vert).
- e2e web : `gh126-split-column.spec.ts` 11/11, `gh70-*` 13/13.
- Build web : toujours **#128** (contournement local non commité pour les e2e).

## Tester manuellement

1. **M1 — PH2** : ouvrir PH2 ; le bandeau des mises à jour du Suivi propose `campaign.js` (v4) →
   Appliquer. Requêtes → nouvelle requête, modèle « Résultat par campagne (colonnes) », partagée,
   Sauvegarder. Vue Système → Tests → ⚙️ : groupe « Résultat par campagne » avec RE2, RP1, RP2 ;
   cocher les trois ; valeurs identiques à QUERY-0004/5/6 (pending pour un test non exécuté).
   Supprimer ensuite QUERY-0004/5/6 depuis la vue Requêtes.
2. Sans appliquer la mise à jour (projet en v3) : le groupe affiche ⚠ (export
   `entryResultsByCampaign` introuvable).
3. **M2** : relecture du diff — aucun code propre aux campagnes hors `resources/dashboard-lib/` et
   du modèle (`suivi-templates.ts`).
