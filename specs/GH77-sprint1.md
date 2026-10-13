# GH77 — Sprint 1 : alimentation de l'historique sur toutes les écritures

Spec : `specs/GH77.md` · Design : `specs/GH77-design.md` §1–2 · Scénarios : `specs/GH77-tests.md`

## Comportement livré

- Toute écriture d'exigence, de test ou de campagne ajoute une entrée à `history` pour chaque champ
  suivi qui change. Par défaut, le statut est suivi ; s'y ajoutent les champs `trackHistory: true`
  du schéma (configurables à la main dans `schema.yaml` jusqu'au sprint 2).
- Chemins couverts :
  - création ;
  - édition, avec autosave sans effet ;
  - transition et « Rouvrir » ;
  - changement de statut direct d'un test ;
  - campagne : `planned` à la création, `in_progress` au premier résultat, clôture, champs
    personnalisés ;
  - pose et levée de `needsRevalidation` (aucune entrée) ;
  - réécriture d'`objectTypeRef` (aucune entrée) ;
  - import en masse MCP.
- `by` = login du compte du projet sur le desktop et sur le web (session). Dans le MCP, c'est
  `--user` / `POLENTA_USER` (sinon `local`) avec `source: mcp`.
- La valeur courante fait foi :
  - un écart (YAML modifié à la main, ancienne app, `git revert`, fusion) apparaît à la lecture
    comme une entrée `implicit: true` ;
  - il est comblé à la prochaine écriture : entrée datée du dernier commit, ou `source: schema`
    s'il n'y avait aucune entrée.
- Fusion de branches : union triée de `history`, jamais de conflit.
- Les copies `testSnapshot` des campagnes ne portent jamais `history`.
- Lecture :
  - IPC `history:get` (desktop, client web via la liste blanche) ;
  - tool MCP `get_history`.
- Documentation : `CLAUDE.md` (champ système, exemple de schéma, règle n° 12, interdiction
  d'éditer `history`) et `AGENTS.md` (v4 : `history`, `get_history`).

## Fichiers modifiés

| Fichier | Modification |
|---------|--------------|
| `packages/types/src/history.ts` (nouveau) | Logique pure : `trackedKeys`, `applyHistory`, `effectiveHistory`, `hasHistoryGap`, `withoutHistory` |
| `packages/types/src/{schema,requirement,test,campaign,index}.ts` | `trackHistory`, `trackStatusHistory`, `history?` |
| `packages/merge-core/src/object.ts`, `index.ts` | `mergeHistories`, cas `history` dans `mergeUnit` |
| `apps/desktop/src/main/services/history.service.ts` (nouveau) | `HistoryService.stamp` / `effective`, `readEffectiveHistory` |
| `requirements.service.ts`, `tests.service.ts`, `campaigns.service.ts` | Une méthode d'écriture unique `persist` par service |
| `revalidation.service.ts` | `writeElement` passe par `stamp` |
| `main/container.ts`, `mcp-server/container.ts` | Acteur par hôte |
| `main/ipc/index.ts`, `web-server/channel-policy.ts`, `packages/api-client` | Canal `history:get` |
| `mcp-server/tools/read.tools.ts` | Tool `get_history` |
| `agents-md.template.ts`, `CLAUDE.md` | Documentation |
| Tests | `history.test.ts` (25), `history.writes.test.ts` (17), `history.write-paths.test.ts` (garde-fou), `merge-core.test.ts` (+4), `web-server/app.test.ts` (W16) |

## Divergences par rapport au design

1. **MCP** : il n'existe pas de tool de lecture d'un objet unique (seulement des listes).
   J'ai ajouté un tool `get_history(kind, id)` qui renvoie l'historique effectif. Les listes
   renvoient `history` tel qu'il est écrit.
2. **`HistoryService` lit le schéma sur disque** (comme `readTypeDef` des services) et pas dans le
   cache de `SchemaService`. Sinon, le serveur MCP (processus long) ne voyait pas un schéma
   enregistré par l'application. Le constructeur n'a donc plus de paramètre `schema`.
3. **Type d'un composant en repo séparé** : si le type est introuvable dans le schéma du repo ouvert
   (nœud submodule), il est cherché par nom dans le schéma du repo propriétaire du fichier
   (`ownerRepo`). Sans ça, les champs suivis d'un composant n'étaient pas historisés quand on les
   éditait depuis le produit.
4. **Acteur résolu paresseusement** : le compte n'est lu que si une entrée est réellement ajoutée.
   Une sauvegarde automatique sans changement suivi ne coûte rien de plus.
5. **Campagnes** : l'état « avant » se réduit à `{ status, fields, history }` (`historyBase`), au
   lieu de `structuredClone` de toute la campagne avec ses copies de tests.
6. **Datation du comblement d'un trou** : date du dernier commit, **mais jamais avant la dernière
   entrée** (une écriture non commitée peut être plus récente que le commit). La liste reste triée
   et sa dernière entrée reste la valeur courante.
7. **Normalisation des valeurs** :
   - une date YAML non quotée est enregistrée et comparée en `YYYY-MM-DD` pour un champ `date` ;
   - un nombre saisi en texte est traité comme un nombre pour un champ `number`.

   Sans ça, on obtenait des entrées parasites.
8. Un champ de `fields` nommé `status` n'est jamais suivi : sa clé se confondrait avec le statut.
   La spec (§2.2) affirmait à tort qu'il n'y avait pas de collision.

## Revue de code — points non corrigés

- **`by` des entrées comblées = nom de l'auteur du commit** (`updatedBy`), pas le login forge :
  git ne connaît pas le login. C'est le même point que celui ouvert au design pour la reprise git
  (sprint 3) et il reste **à valider**.
- **Trois séquences « stamp → écriture → index »** (exigences, tests, revalidation) : elles sont
  courtes et ont chacune leurs paramètres. Le garde-fou W12 empêche qu'une écriture échappe à
  l'historique.
- **Entrées d'une même seconde dans deux branches** : l'ordre après fusion est stable (gauche puis
  droite) mais arbitraire. Si la valeur fusionnée ne correspond pas à la dernière entrée, la règle
  « valeur courante » (entrée déduite, puis comblement) le corrige.

## Mises à jour SPEC

Aucune : les SPEC seront mises à jour au sprint final (3).

## Résultats

- `tsc` : zéro erreur (desktop, api-client, merge-core).
- `pnpm test` : 389 tests desktop + 38 merge-core, tous verts.
- `test:e2e:web` : 49 passés, 13 ignorés (scénarios déployé / OIDC, comme avant). Aucun e2e propre
  à GH77 dans ce sprint (pas d'UI) : W16 est couvert par `web-server/app.test.ts`.

## Comment tester manuellement

1. **W17** — Dans le desktop, sur une exigence du projet de démo : changer le statut par le bouton
   de transition, par la colonne Statut de la vue Tableau, puis « Rouvrir en brouillon ». Le YAML
   gagne une entrée `history.status` à chaque action, et aucune quand on édite sans rien changer.
2. Ajouter `trackHistory: true` à un champ enum de `schema.yaml`, l'éditer : une entrée apparaît.
   Éditer un champ richtext suivi : une entrée sans `value` apparaît.
3. Modifier `status:` à la main dans un YAML puis éditer l'objet dans l'app : une entrée comble
   l'écart avant la nouvelle.
4. **F5** — Deux branches changent le statut du même objet, puis Publier ou fusion dans l'outil :
   pas de bloc sur `history`.
5. Campagne : créer, saisir un premier résultat, clôturer. On doit avoir
   `planned` → `in_progress` → `completed`.
6. Serveur MCP lancé avec `--user bob` : `bulk_import_requirements` (`dryRun: false`) donne
   `by: bob, source: mcp`, et `get_history` renvoie l'historique.
