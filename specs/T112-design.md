---
ticket: T112
type: design
---

# T112 — Design

Voir aussi le plan validé (agile-exploring-gosling.md) — ce document en reprend la
substance sous la forme attendue par WORKFLOW.md.

## Fichiers à modifier et pourquoi

1. **`packages/types/src/requirement.ts`, `packages/types/src/test.ts`** — élargir
   `createdAt`/`createdBy`/`updatedAt`/`updatedBy` de `string` à `string | null` sur
   `Requirement` et `TestCase`. `null` = fichier jamais commité.

2. **`apps/desktop/src/main/services/git.service.ts`** — nouvelle méthode
   `fileHistory(repoPath, filePath)` (nouvelle section `// ─── File history (git log)
   ───`) : `git.log({ filepath, ref: 'HEAD', force: true })`, retourne
   `{createdAt, createdBy, updatedAt, updatedBy}` (commit le plus ancien / le plus
   récent) ou `null` si aucun commit ne touche ce fichier.

3. **`apps/desktop/src/main/services/requirements.service.ts`** (`create`, `update`,
   `openDraft`, `transition`) et **`tests.service.ts`** (`create`, `update`,
   `openDraft`) :
   - `create()` : fixer les 4 champs à `null` directement (fichier neuf, aucun
     historique possible) — pas d'appel git.
   - `update()`/`openDraft()`/`transition()` : supprimer les lignes qui fixaient
     `updatedAt`/`updatedBy` à `now`/`'TODO:current-user'` — `...existing` (déjà
     enrichi via l'index, cf. point 4) porte les bonnes valeurs, l'édition en cours
     n'étant pas commitée ne les change pas.
   - Avant chaque `git.writeYaml`, omettre les 4 champs de l'objet persisté via un
     helper partagé `omitAuditFields()` (utilisé aux 7 sites d'écriture). L'objet
     complet (avec les 4 champs) reste ce qui est retourné à l'appelant et passé à
     `index.upsert()`/`upsertTestCase()`.

4. **`apps/desktop/src/main/services/requirements-index.service.ts`,
   `tests-index.service.ts`** (`build()`) : pour chaque fichier lu, appeler aussi
   `git.fileHistory(repoPath, file)` en parallèle et fusionner le résultat (ou 4×`null`)
   sur l'objet après le `readYaml`, en écrasant sans condition. Seul point d'appel de
   `fileHistory()` dans tout le ticket.

5. **`apps/desktop/src/main/services/tests.service.ts`** — corriger au passage deux
   contournements de l'index qui casseraient le mécanisme ci-dessus :
   - `findOne()` : lisait le YAML brut via `git.readYaml` au lieu de
     `testsIndex.findById()` — incohérent avec `RequirementsService.findOne()`.
   - `update()` : même bypass, plus grave — une fois les 4 champs absents du YAML, ce
     `readYaml` brut ne les contiendrait plus du tout (`undefined`), et `...existing`
     propagerait `undefined` au lieu des vraies valeurs déjà en cache dans l'index →
     perte de données silencieuse à chaque édition d'un test. Les deux doivent passer
     par `this.testsIndex.findById(repoPath, id)` (déjà utilisée correctement dans
     `openDraft()` du même fichier).

6. **`apps/desktop/src/main/services/repo-watcher.service.ts`** — le watcher chokidar
   existant ignore `.git` entièrement, donc un `commit`/`merge`/`rebase`/`checkout` qui
   ne touche aucun fichier du working tree (fast-forward, merge sans diff) ne
   déclencherait aucune invalidation de l'index, et les timestamps dérivés de git
   resteraient figés. Ajout d'un **second** `chokidar.watch()`, scopé strictement à
   `.git/HEAD` + `.git/refs/**` (pas tout `.git` — `.git/objects`/`.git/logs` bougent en
   permanence). Handler : `reqIndex.invalidate(repoPath)` +
   `testsIndex.invalidate(repoPath)` sans condition. Pas de changement dans
   `container.ts` — `RepoWatcherService` a déjà les deux services d'index injectés.

## Décisions techniques et alternatives rejetées

- **Alternative rejetée pour l'invalidation** : injecter `reqIndex`/`testsIndex` dans
  `SyncService` et appeler `.invalidate()` après `commit()`. Rejeté : ne couvrirait que
  `commit()`, laisserait le même trou pour `merge`/`rebase`/`checkoutBranch`/`pull`, et
  crée une dette ("il faudra penser à ajouter l'appel" à chaque future méthode qui
  déplace une ref). Le watcher `.git/HEAD`+`.git/refs` est générique et automatiquement
  correct pour toute opération future.
- **Pas de script de migration** : la lecture écrase sans condition ces 4 champs, donc
  d'anciennes clés dans des fichiers existants sont inertes — nettoyage naturel au
  prochain enregistrement réel, pas besoin d'un commit dédié qui ne ferait que du bruit.
- **`fileHistory()` appelé uniquement dans `build()`**, jamais dans `create`/`update` —
  au moment où ces méthodes s'exécutent, l'édition n'est jamais encore commitée, donc un
  appel git à cet instant renverrait soit `null` (création) soit les mêmes valeurs déjà
  connues via l'index (update) — appel inutile.

## Découpage sprint

Tient en un seul sprint — changement cohérent, pas de dépendance externe bloquante.
Ordre d'implémentation à l'intérieur du sprint : types (1) → `fileHistory()` (2) → index
`build()` (4, dépend de 1+2) → services d'écriture + fix bypass (3+5, dépend de 1) →
watcher (6, indépendant, peut être fait en parallèle).

## Scénarios de test (`T112-tests.md` — voir aussi le plan approuvé)

**Golden path**
1. Créer une exigence → fichier YAML sans les 4 champs, UI affiche "—".
2. Commiter → dates/auteur cohérents avec le commit.
3. Éditer sans commiter → `updatedAt` inchangé.
4. Commiter l'édition → `updatedAt` se met à jour sans redémarrer l'app.
5. Répéter sur un cas de test (`tests/*.yaml`), en particulier une édition via
   `update()` pour confirmer que le fix du bypass d'index ne perd plus les valeurs.

**Cas limites**
- Fichier jamais commité, `git.fileHistory()` doit retourner `null` sans lever
  d'exception (`force: true`).
- Repo avec beaucoup de commits sur un même fichier — `fileHistory()` doit renvoyer le
  bon premier/dernier commit (pas juste les `depth` premiers).
