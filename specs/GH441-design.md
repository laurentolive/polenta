# GH441 — Design : couverture figée (`verification`) exposée au graphe et au MCP

Spec validée : [GH441.md](GH441.md) (décisions D1 à D5 retenues par l'humain, 2026-11-27).

## 1. Fichiers modifiés

| Fichier | Changement |
|---|---|
| `packages/types/src/graph.ts` | `GraphVersion.verification` (après `analysis`) |
| `apps/desktop/src/main/services/graph.service.ts` | `listVersions` : mapping de `verification` |
| `apps/desktop/resources/dashboard-lib/polenta.d.ts` | régénéré par `scripts/generate-graph-dts.ts` (ne pas éditer à la main) |
| `apps/desktop/resources/dashboard-lib/manifest.json` | nouvelle version de `polenta-types` (`scripts/dashboard-lib-manifest.ts --bump`) |
| `apps/desktop/src/mcp-server/tools/versions.tools.ts` | `get_version` : clé `verification`, description |
| `apps/desktop/src/main/services/graph-verification.gh441.test.ts` | nouveau : tests du graphe (fixtures) |
| `apps/desktop/src/main/services/versions-verification.gh441.test.ts` | nouveau : tests MCP et séquence réelle (dépôt git) |
| `specs/SPEC-DASHBOARDS.md` §2 | note « GH441 (contrat v1, ajout) » |
| `specs/SPEC-MCP-SERVER.md` §4.8 | `get_version` renvoie `verification` |
| `specs/SPEC-INDEX.md` | colonne MAJ des deux lignes ci-dessus |

Aucun changement de `versions.service.ts` : `get()` lit déjà la version brute, et `page()` garde son retrait de
`verification` (GH439 §3.2).

## 2. Types

`packages/types/src/graph.ts`, dans `GraphVersion`, après `analysis` :

```ts
  /** GH441 — couverture figée au passage released (`verification` du fichier de version, GH439). `null` tant que la
   *  version n'est pas released, et pour une version released avant GH439. Lignes triées par ID ; `tests` : IDs.
   *  Lu tel quel, jamais recalculé. */
  verification: {
    computedAt: string
    rows: Array<{ id: string; status: GraphCoverageStatus; tests: string[] }>
  } | null
```

`GraphCoverageStatus` (`graph.ts` l. 212) a les mêmes cinq valeurs que `CoverageStatus`
(`packages/types/src/traceability.ts` l. 9) : le champ du fichier s'affecte sans conversion.

## 3. Lecture (graphe)

`listVersions` (`graph.service.ts` l. 269), dans le littéral `GraphVersion`, après `analysis` :

```ts
verification: v.verification ? {
  computedAt: v.verification.computedAt,
  // Fichier édité à la main : un bloc incomplet ne casse pas le graphe (même garde que `analysis`).
  rows: (v.verification.rows ?? []).map((r) => ({ id: r.id, status: r.status, tests: r.tests ?? [] })),
} : null,
```

Pourquoi `?? []` : une exception dans ce `map` tombe dans le `catch` de `listVersions`, qui retire **toutes** les
versions du repo. Le garde évite qu'un bloc incomplet fasse disparaître les autres versions.

Aucun appel supplémentaire : `versions.list()` lit déjà chaque fichier de version, `verification` compris.

## 4. Lecture (MCP)

`get_version` (`versions.tools.ts` l. 38) :

```ts
async ({ id, component }) => {
  const repo = await repoOf(component)
  const page = await container.versions.page(repo, id, ws)
  // GH441 — `page()` retire `verification` (GH439) : lu sur la version brute.
  const version = await container.versions.get(repo, id)
  return jsonToolResult({
    version: page.version, state: page.state, component: page.component.name, basedOn: page.basedOn,
    components: page.components.map(c => ({ name: c.name, selected: c.selected })),
    changes: page.rows.map(({ repoPath: _repoPath, ...row }) => row),
    verification: version.verification ?? null,
  })
}
```

Description du tool : ajouter une phrase « `verification` : couverture figée au passage released (`computedAt`,
lignes `{ id, status, tests }`), `null` sinon ».

Deux lectures du fichier (`page` puis `get`) : coût négligeable, et `page()` reste intact pour la page.

## 5. Contrat et manifeste

1. `tsx scripts/generate-graph-dts.ts` régénère `polenta.d.ts`. Le test L8 compare le fichier à `renderGraphDts()`.
2. `tsx scripts/dashboard-lib-manifest.ts --bump polenta.d.ts "GH441 : GraphVersion.verification (couverture figée au passage released)" "GH441: GraphVersion.verification (coverage frozen at release)"`.
   Le test L11 vérifie que la dernière empreinte est celle du contenu livré et que les numéros sont croissants.
3. `GRAPH_CONTRACT_VERSION` ne change pas (ajout, D4).

## 6. Alternatives rejetées

- **Calcul live pour une version en cours** (`TraceabilityService.getMatrix`) : contredit « figée » (D1). La matrice
  de traçabilité couvre déjà ce besoin.
- **Ajouter `verification` à `page()` puis au MCP** : GH439 a retiré le champ de la page à dessein (§3.2) ; rétablir
  le champ casserait ce choix.
- **Nouveau tool MCP `get_version_verification`** : même donnée, un outil de plus. GH441 D2 : une clé de `get_version`.
- **Garder `status: string`** comme `analysis` : moins strict, et le vocabulaire existe déjà (D3).

## 7. Risques

- **Graphe qui perd des versions** : couvert par `?? []` et le test T3 (§ tests).
- **Dérive `polenta.d.ts`** : le test L8 échoue si on oublie la régénération ; à lancer après toute modification de `graph.ts`.
- **Manifeste** : `--bump` ajoute une version ; ne pas modifier une version passée (règle du script).
- **Séquence « figée »** : le graphe lit le fichier, pas la matrice ; le test T4 vérifie qu'un changement de lien
  après release ne modifie pas la valeur.
