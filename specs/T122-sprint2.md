# T122-sprint2 — Tools d'import massif (`bulk_import_*`) avec dry-run

## Fichiers modifiés

Nouveaux :
- `apps/desktop/src/main/services/bulk-import-validation.util.ts` — `validateBulkEntries()`
  (logique métier pure, pas d'accès disque), règles de validation par entrée
  (`objectTypeRef` résolu, nœud pas `readonly`, champs requis, EARS), `resolveIdPrefix()`.
- `apps/desktop/src/mcp-server/tools/bulk-import.tools.ts` — 3 tools MCP
  (`bulk_import_requirements`/`bulk_import_tests`/`bulk_import_campaigns`), calcul des
  IDs prévisionnels (`makeSchemaBackedIdPreview`/`makeCampaignIdPreview`), boucle
  d'écriture série best-effort (`runBulkImport`).

Modifiés :
- `apps/desktop/src/main/services/id-counter.util.ts` — extraction de
  `readCounterState()` (partagée par `computeNextId` et le nouveau
  `peekNextCounterId`), ajout de `peekNextCounterId()` (lecture seule, sans écrire
  `counters.yaml`) et `formatCounterId()` (formatage `<PREFIX>-XXXX` partagé).
  `nextCounterId()`/`computeNextId()` inchangés dans leur comportement observable.
- `apps/desktop/src/main/services/maturity.util.ts` — `isEarsCompliant()` et
  `isFilled()` passées de privées à exportées, pour être réutilisées telles quelles
  par `bulk-import-validation.util.ts` (même heuristique EARS et même règle de
  "champ rempli" que le tableau de bord de maturité — pas une seconde regex/règle
  divergente).
- `apps/desktop/src/mcp-server/index.ts` — enregistre `registerBulkImportTools`.
- `TICKETS.md` — T122 passé en statut `coding sprint 2`.

Non modifiés (conforme au design §7 et hors périmètre de ce sprint) :
`apps/desktop/src/main/services/requirements.service.ts`,
`apps/desktop/src/main/services/tests.service.ts`,
`apps/desktop/src/main/services/campaigns.service.ts` (leur `create()` est réutilisé
tel quel, pas de vérification `readonly` ajoutée à l'intérieur — cf. divergences).

## Comportement implémenté

- **`dryRun: true` (par défaut)** : valide chaque entrée du batch, dans l'ordre —
  1) `objectTypeRef` résout vers un type existant (`'unresolvable'` = ref
  cross-composant non vérifiable, acceptée avec avertissement implicite, pas une
  erreur) ; 2) le nœud propriétaire n'est pas `readonly: true` ; 3) tous les champs
  `required: true` du type sont remplis dans `dto.fields` ; 4) tout champ
  `validator: EARS` respecte l'un des 5 patterns EARS. La première règle en échec
  arrête la validation de CETTE entrée sans bloquer les autres. Retourne
  `{ dryRun, summary, wouldCreate: [{index, id prévisionnel}], created: [], errors }`
  **sans aucune écriture disque**.
- **`dryRun: false`** : ne valide que pour déterminer les entrées éligibles, puis
  appelle `RequirementsService.create`/`TestsService.create`/`CampaignsService.create`
  **en série** (jamais `Promise.all`) pour chaque entrée valide, dans l'ordre du
  batch. Une entrée qui échoue à l'écriture (erreur imprévue) est reportée dans
  `errors` sans annuler les précédentes déjà écrites sur disque (best-effort, non
  transactionnel, conforme au spec). Une entrée déjà rejetée en validation
  (`readonly`, champ manquant, EARS non conforme, type inconnu) n'est jamais tentée
  à l'écriture, dans les deux modes.
- **IDs prévisionnels** (`dryRun: true`) : calculés par `peekNextCounterId` (variante
  lecture seule de `nextCounterId`, T118), une fois par préfixe **distinct** présent
  dans le batch (pas un appel disque par entrée), puis un offset en mémoire par
  préfixe garantit des IDs prévisionnels distincts au sein d'un même batch. Pour les
  campagnes, le préfixe est toujours `CAMP` (`CampaignsService.nextCampaignId()` ne
  dérive jamais l'ID du type, contrairement aux exigences/tests). En `dryRun: false`,
  ce calcul de préview n'est **pas exécuté** (voir divergence "found in review"
  ci-dessous) — l'ID réel vient uniquement de l'appel `create()`.
- **`readonly` refusé dans les deux modes**, y compris quand le TYPE lui-même n'est
  pas vérifiable localement (`'unresolvable'`, forme normale d'un nœud submodule
  sans `objectTypes` inlinés) — voir bug corrigé en revue ci-dessous.

## Divergences par rapport au design

- **Bug trouvé et corrigé en code-review, avant tout commit** : le design décrit la
  règle "nœud pas `readonly`" comme s'appliquant après résolution du type, mais
  l'implémentation initiale ne vérifiait le `readonly` du nœud propriétaire QUE
  lorsque `findObjectTypeDef` retournait un `ObjectTypeDefinition` résolu — jamais
  quand il retournait `'unresolvable'`. Or `'unresolvable'` est précisément la forme
  normale d'un nœud submodule dont les `objectTypes` ne sont pas inlinés localement
  (CLAUDE.md : "objectTypes absent → le schéma du composant fait foi") — exactement
  le cas d'un composant `readonly: true` réel. Un import ciblant un tel composant,
  avec `--workspace` configuré (le tree cache résout alors réellement
  `resolveComponentRepoPath` vers le repo du composant), aurait été accepté et écrit
  sans jamais être refusé. Corrigé : `findLocalNodeByRefPrefix()` retrouve le
  `SystemNode` local par le préfixe `<nodeName>::` de `objectTypeRef` et son
  `readonly` est vérifié AVANT de traiter `'unresolvable'` comme "rien à vérifier".
  Vérifié manuellement (scénario 6 ci-dessous) sur un nœud `motor-control` sans
  `objectTypes` marqué `readonly: true` : refusé dans les deux modes, comme
  `readonly-comp` (nœud avec type résolu localement).
- **`nextIdPreview` n'a pas la signature `(objectTypeRef, countSoFar) => string`**
  du design (§3.1) mais `(objectTypeRef: string | undefined) => string`, un callback
  **stateful** fourni par l'appelant (pas de paramètre `countSoFar` explicite). Motif :
  les campagnes utilisent toujours le préfixe fixe `CAMP`, indépendamment de
  `objectTypeRef` — un compteur tenu par `objectTypeRef` littéral (comme le suggère
  la signature du design) donnerait des IDs prévisionnels en collision dès qu'un
  batch de campagnes mélange plusieurs types de campagne différents. Le compteur
  est donc tenu par **préfixe résolu**, à la charge de l'appelant qui seul connaît
  la correspondance objectTypeRef → préfixe pour chaque catégorie.
- **`validateBulkEntries<TDto extends { objectTypeRef: string; ... }>` assoupli en
  `objectTypeRef?: string`** — `CreateCampaignDto.objectTypeRef` est explicitement
  optionnel dans `packages/types/src/campaign.ts` (une campagne peut n'être
  catégorisée que par `component`/`level`, sans type de schéma). Une entrée sans
  `objectTypeRef` n'a simplement rien à vérifier côté schéma (toujours valide de ce
  point de vue) plutôt que de forcer un champ requis inexistant dans le DTO réel.
- **`resolveIdPrefix()` duplique (3e copie)** le fallback déjà dupliqué entre
  `requirements.service.ts::nextId()` et `tests.service.ts::nextTestId()` (type
  résolu → `prefix` du schéma, sinon 6 premiers caractères du nom de type en
  majuscules), plutôt que d'extraire un helper partagé dans ces deux services — ce
  sprint ne les modifie pas (hors périmètre, cf. design §7 : seuls
  `id-counter.util.ts`, `bulk-import-validation.util.ts` et les tools MCP sont
  touchés). Le mirroring exact reste indispensable pour que l'ID prévisionnel du
  dry-run corresponde à celui réellement attribué.
- **Optimisation ajoutée en revue** (relevée par le review, pas dans le design) :
  le calcul du preview d'ID (`makeSchemaBackedIdPreview`/`makeCampaignIdPreview`,
  qui lit `counters.yaml` + liste les fichiers via `peekNextCounterId`) n'est
  exécuté que si `dryRun: true`. En `dryRun: false`, un callback factice
  (`NOOP_ID_PREVIEW`) est utilisé à la place — les IDs réels viennent uniquement de
  `create()`, calculer un preview avant une écriture réelle était un aller-retour
  disque entièrement gaspillé (doublé par la lecture déjà faite par le vrai
  `nextCounterId` à l'intérieur de `create()`).
- **Readonly non ajouté dans `RequirementsService.create`/`TestsService.create`/
  `CampaignsService.create` eux-mêmes** (confirmé : ces méthodes n'appliquent
  toujours aucune vérification `readonly`, comme documenté en design §3.3) — le
  refus reste une garde de la seule couche de validation bulk-import, appliquée au
  chemin MCP uniquement ; l'UI reste, comme avant ce ticket, sans protection
  `readonly` sur l'écriture directe (constat préexistant, hors scope, déjà signalé
  au design).

## Vérifications effectuées

- `pnpm --filter @polenta/desktop run typecheck` → 0 erreur (avant et après les
  corrections de revue).
- Revue de code effectuée manuellement (2 passes ciblées : angles de correction —
  scan ligne à ligne, audit des comportements supprimés/refactorés dans
  `id-counter.util.ts`, traçage cross-fichiers des nouveaux exports ; angles
  qualité — réutilisation, simplification, efficacité, conventions CLAUDE.md).
  4 points relevés et tous corrigés avant commit :
  1. **[critique, corrigé]** Contournement du refus `readonly` quand le type est
     `'unresolvable'` (cf. divergence ci-dessus) — corrigé et revérifié
     manuellement (scénario 6).
  2. **[mineur, corrigé]** `peekNextCounterId` calculé inutilement en `dryRun:
     false` (I/O disque gaspillé) — corrigé (`NOOP_ID_PREVIEW`).
  3. **[mineur, corrigé]** `isFieldFilled()` dupliquait `isFilled()` déjà présent
     dans `maturity.util.ts` — corrigé (export + réutilisation).
  4. **[mineur, non corrigé, documenté]** `resolveIdPrefix()` appelé deux fois par
     entrée valide dans `makeSchemaBackedIdPreview` (une fois pour construire
     l'ensemble des préfixes distincts, une fois dans la closure) — coût
     négligeable (scan en mémoire, pas de disque), laissé tel quel.
- Vérification manuelle bout-en-bout via un vrai client MCP
  (`@modelcontextprotocol/sdk` `Client`/`StdioClientTransport`, script jetable
  supprimé après usage) contre une **copie** de
  `C:\Dev\polenta-demo\aspirateur-demo` (pour ne pas polluer les données de démo),
  avec deux nœuds ajoutés au schéma le temps du test : `readonly-comp` (`readonly:
  true`, type `exigence-ro` résolu localement) et `motor-control` (`readonly: true`,
  **sans** `objectTypes` — reproduit la forme réelle d'un nœud submodule non
  inliné, `'unresolvable'`) :
  1. Liste vide (`entries: []`) en `dryRun: true` et `dryRun: false` →
     `summary: {0,0,0}`, aucune écriture, pas d'erreur.
  2. 3 entrées toutes invalides (champ `statement` manquant) en `dryRun: true`
     **et** `dryRun: false` → `wouldCreate/created: []`, 3 erreurs, fichiers
     `requirements/` strictement inchangés (comparaison de listing avant/après).
  3. 2 valides + 1 invalide (champ manquant) en `dryRun: true` → aperçu correct
     (`SYS-0019`, `SYS-0020` prévisionnels, 1 erreur explicite), aucun fichier créé.
     Même batch en `dryRun: false` → exactement 2 fichiers créés
     (`SYS-0019.yaml`, `SYS-0020.yaml`), IDs identiques à la préview, erreur
     toujours présente pour l'entrée invalide.
  4. `statement` non conforme EARS (pas de `SHALL`/mot-clé) → erreur explicite
     citant la non-conformité EARS.
  5. Nœud `readonly-comp` (type résolu localement) → refusé en `dryRun: true` et
     `dryRun: false`, aucune écriture.
  6. Nœud `motor-control` (`readonly: true`, `'unresolvable'`) → refusé en
     `dryRun: true`, confirmant le correctif du bug critique ci-dessus.
  7. 10 créations valides en un seul appel `dryRun: false` → 10 fichiers distincts
     (`PRD-0009`…`PRD-0018`), IDs consécutifs sans trou ni doublon (le compteur
     `counters.yaml` de la copie était volontairement resté désynchronisé du
     contenu disque avant le test — `CAMP: 3` en counters alors que 4 fichiers
     `CAMP-*.yaml` existaient déjà — et le scénario 9 a confirmé l'auto-guérison
     T118 : ID prévisionnel et réel tous deux `CAMP-0005`, pas `CAMP-0004`).
  8. `bulk_import_tests` : 2 valides + 1 invalide (`objectTypeRef` inconnu) →
     mêmes garanties que requirements (aperçu correct en dry-run, 2 fichiers
     `TEST-0009`/`TEST-0010` créés en écriture réelle, entrée invalide jamais
     écrite).
  9. `bulk_import_campaigns` : 1 entrée valide **sans** `objectTypeRef` → acceptée
     (aucune validation de schéma applicable), `CAMP-0005` créé en écriture réelle
     avec le même ID que la préview.
  10. `git status` dans le repo de test, avant/après tous les scénarios
      d'écriture : tous les fichiers créés apparaissent en `??` (non trackés) —
      aucun commit déclenché par aucun tool.
- Contenu d'un fichier créé inspecté manuellement (`SYS-0019.yaml`) : `fields`,
  `title`, `objectTypeRef`, `status: draft`, `version: 1` conformes au DTO envoyé.

Scénarios de `specs/T122-tests.md` couverts (numérotation de la section "Sprint 2 —
Import massif") : 13, 14, 15, 16 (via requirements/tests/campaigns), 17, 18, 19, 20,
21, 23 (ordre série confirmé par les IDs consécutifs du scénario 7 attribués dans
l'ordre du batch). Scénario 22 (échec best-effort partiel simulé par une erreur FS)
non reproduit — repro impraticable sans forcer une erreur disque ciblée sur une
seule entrée (cf. `T122-tests.md` lui-même : "à défaut, vérifier au moins que le
code ne fait pas `Promise.all`") ; confirmé par lecture du code (`runBulkImport`
utilise une boucle `for...of` avec `await` séquentiel, jamais `Promise.all`).

## Comment tester manuellement

```bash
# Démarrer le serveur sur une copie de test (jamais sur les données de démo directement
# si le test doit écrire — dryRun: false crée de vrais fichiers) :
pnpm --filter @polenta/desktop run mcp-server -- --repo "C:\chemin\vers\repo-polenta-copie"
```

Avec un client MCP (Claude Code via `.mcp.json`, ou tout client de test stdio),
appeler `get_schema` d'abord pour connaître les `objectTypeRef` valides et leurs
champs requis, puis :

```json
// 1. Toujours commencer en dryRun: true (comportement par défaut si omis)
{
  "entries": [
    { "objectTypeRef": "root::exigence-systeme", "title": "Ma nouvelle exigence",
      "fields": { "priority": "high",
        "statement": "WHEN the user presses X\nTHE system SHALL do Y within 500 ms" } }
  ]
}
// → bulk_import_requirements avec dryRun implicite true : vérifier wouldCreate/errors,
//   puis vérifier sur le disque qu'AUCUN fichier n'a été créé.

// 2. Si l'aperçu est satisfaisant, relancer avec dryRun: false pour écrire réellement.
```

Vérifier ensuite `git status` dans le repo cible : les fichiers créés apparaissent
comme non suivis (`??`), jamais commités automatiquement.
