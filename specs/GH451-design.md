# GH451 — Design : « Basée sur » accepte une version en cours

Spec : `specs/GH451.md`. **Un seul sprint** : le changement tient dans `VersionsService` (règle de sélection, deux
nouveaux contrôles), deux listes du renderer, les codes d'erreur et la doc.

## 1. Fichiers modifiés

| Fichier | Changement |
|---|---|
| `packages/types/src/product-version.ts` | codes `BASE_NOT_RELEASED`, `VERSION_IS_BASE` (union `VersionErrorCode` + liste) ; commentaire de `basedOnOptions` |
| `apps/desktop/src/main/services/versions.service.ts` | règle de sélection `basedOnCandidates`, `assertBasedOn` réécrit, options de la page, motif au passage released, refus à la suppression |
| `apps/desktop/src/renderer/components/versions/VersionInfoSection.tsx` | mention « — en cours » sur les options |
| `apps/desktop/src/renderer/components/versions/NewVersionDialog.tsx` | liste = versions non abandonnées, mention « — en cours » (même rendu que la liste des composants) |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | libellés des deux codes |
| `apps/desktop/src/mcp-server/tools/versions.tools.ts` | description de `basedOn` (released ou en cours, ni abandonnée ni descendante) |
| `specs/SPEC-REQ-requirements.md` §11.1, §11.2, §11.5 ; `specs/SPEC-MCP-SERVER.md` §4.8 ; `specs/SPEC-INDEX.md` | mise à jour (dernier sprint) |

## 2. Service

### 2.1 Règle de sélection

```ts
/** GH451 — bases possibles de `self` (null : version à créer) : released ou en cours, ni `self`, ni une descendante. */
private basedOnCandidates(typeDef, versions: ProductVersion[], self: string | null): ProductVersion[]
```

Descendante de `self` : version dont la chaîne `basedOn` (de proche en proche, garde anti-cycle `seen`) atteint
`self`. Calcul sur la liste **complète** des versions du repo.

### 2.2 `assertBasedOn(typeDef, versions, basedOn, self, current)`

- `basedOn` vide → `null`.
- `basedOn === current` (valeur déjà enregistrée, même devenue abandonnée) → acceptée telle quelle : un
  enregistrement d'un autre champ ne doit pas échouer sur une base qui a changé d'état depuis.
- sinon `basedOn` doit être dans `basedOnCandidates` ; refus `VERSION_NOT_FOUND` avec détail : `introuvable`,
  `version abandonnée`, `boucle de lignée` (self ou descendante).

Appels : `create` (current `null`, liste complète), `update` (current = `existing.basedOn`, **liste complète** — la
liste filtrée sans `self` reste celle de `assertLabel`). `copy` recopie la base sans contrôle (inchangé).

### 2.3 Page

`basedOnOptions` = candidates (ordre inversé, plus récentes d'abord, inchangé), précédées de la base actuelle si
elle n'y est pas (abandonnée, cycle d'un fichier édité à la main) — le select ne la perd pas.

### 2.4 Passage released

`releaseProblems` : base existante à l'état `in_progress` → `{ code: 'BASE_NOT_RELEASED', detail: '<ID> <label>' }`.
Base absente du repo, released ou abandonnée : rien.

### 2.5 Suppression

`delete` : avant le contrôle des validations, versions du repo dont `basedOn === id` → `VERSION_IS_BASE`, détail
`<ID> <label>, …`.

### 2.6 Ce qui ne change pas

`availableIds` parcourt déjà toute la lignée non abandonnée : la section « Exigences » d'une version en cours inclut
une base en cours sans changement de code (décision 2). `rowsOf`, `lastInclusions`, backlog, reprise de validation :
inchangés (spec § Contexte).

## 3. Renderer

Les deux listes utilisent le même suffixe que la liste des composants de la boîte de création :
`` `${v.title} (${v.id})${v.state === 'in_progress' ? ` — ${t('versions.state.in_progress')}` : ''}` ``.
Création : `node.versions.filter(v => v.state !== 'abandoned')` (une nouvelle version n'a pas de descendante).

## 4. Alternatives rejetées

- **Filtrer côté renderer** à partir de `VersionSummary.basedOn` : la règle des descendantes serait dupliquée ; le
  serveur la porte déjà pour le contrôle, la page en reçoit le résultat.
- **Rebaser à la suppression** : écarté par la décision 4.
