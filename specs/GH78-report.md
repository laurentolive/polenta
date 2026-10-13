# GH78 — Prototype QuickJS + Vega-Lite : rapport de mesures

> Prototype jetable préalable au Design de #74. Le code est sur la branche `GH78`
> (`apps/desktop/spikes/GH78/`), jamais mergée. Ce rapport est le seul livrable versé sur `main`.

## Recommandation

**Valider l'approche de #74, avec six ajustements.**

1. **Exécuter le bac à sable dans le process main**, partagé avec le serveur web et le serveur MCP.
   Le renderer ne reçoit que des lignes, et il ne charge que Vega.
2. **Garder en cache un contexte préparé** par workspace : graphe injecté, gelé, bibliothèque
   compilée. Sans cache, chaque exécution paie 0,4 s d'injection sur le jeu ×50.
3. **Plafonner la mémoire wasm** avec une `WebAssembly.Memory` bornée. `setMemoryLimit` seul ne
   protège pas le process : mesuré, la mémoire monte jusqu'à 2 Go.
4. **Durcir le contexte réutilisé** (gel des intrinsèques et de l'objet global). Sinon un widget
   laisse des traces au suivant.
5. **Sortir l'exécution du thread principal** du main (`worker_threads` ou `utilityProcess`).
   QuickJS est synchrone : un script qui tourne jusqu'à sa limite de temps (1 à 2 s) bloquerait
   l'IPC et le serveur web.
6. **Compléter le contrat de données** sur les points relevés en §6 et §8.

Tous les seuils indicatifs du ticket sont tenus (tableau ci-dessous). Aucune alternative de §7
(`iframe` + Worker, `isolated-vm`, `ses`) n'est nécessaire.

| Seuil du ticket | Mesuré | Verdict |
|---|---|---|
| Surcoût bundle desktop < 1,5 Mo gzip, chargement paresseux | 533 Ko (pile complète dans le renderer) ; 305 Ko si QuickJS est dans le main ; point d'entrée +0,8 Ko | ✅ |
| Script (c) < 200 ms sur la démo | 1,3 ms (contexte en cache) ; 12,7 ms (runtime neuf) | ✅ |
| Script (c) < 1 s sur le jeu ×50, graphe en cache | 3,3 ms pour une campagne ; 160 ms pour toutes les campagnes cumulées | ✅ |

## Configuration de mesure

- Machine : AMD Ryzen 7 7435HS (16 threads), 16 Go de RAM, Windows 11 Pro 10.0.26200, Node v24.15.0.
- QuickJS : `quickjs-emscripten-core` 0.32.0 et `@jitl/quickjs-wasmfile-release-sync` 0.32.0
  (comparée à la variante `quickjs-ng`).
- Vega : `vega` 6.4.0, `vega-lite` 6.4.3, `vega-embed` 7.3.0, `vega-interpreter` 2.3.2.
- Navigateurs : Electron 31.7.7 (Chrome 126) et Chromium 156 (Playwright).
- Jeux de données : le jeu de démo `scripts/demo-lave-linge` (5 repos), et deux copies gonflées
  ×10 et ×50. Les copies sont écrites sur disque et commitées dans chaque repo : la lecture passe
  donc par les vrais index, `git log` compris.
- Le jeu de démo est antérieur à GH77 et GH73. On fabrique donc, de façon déterministe, un
  historique simulé :
  - `history.status` au format GH77 pour chaque objet ;
  - `addedAt` sur les entrées de campagne ;
  - 1 à 3 runs par entrée exécutée, rattachés par `campaignEntry` (FAIL ou BLOCKED avant le
    verdict final).

| Jeu | Exigences | Tests | Liens | Campagnes | Entrées | Runs | Graphe JSON |
|---|---|---|---|---|---|---|---|
| démo | 77 | 22 | 77 | 5 | 24 | 42 | 128 Ko |
| ×10 | 770 | 220 | 770 | 50 | 240 | 425 | 1,1 Mo |
| ×50 | 3 850 | 1 100 | 3 850 | 250 | 1 200 | 2 086 | 5,6 Mo |

Les temps sont des médianes de 5 à 10 exécutions.

## 1. Poids

Les mesures sont faites en build minifié, chaque bibliothèque étant chargée par `import()` dans un
chunk séparé (comme `alasql` aujourd'hui). Le renderer desktop et le client web partagent le même
code renderer et le même Vite : les chiffres valent pour les deux.

| Option | Brut | gzip | brotli |
|---|---|---|---|
| `vega` (runtime) + `vega-interpreter` — rendu d'une spec Vega déjà compilée | 514 Ko | 183 Ko | 156 Ko |
| `vega-lite` (compilateur seul) | 708 Ko | 244 Ko | 208 Ko |
| `vega-embed` + `vega-lite` + `vega` + interpréteur | 841 Ko | 290 Ko | 241 Ko |
| QuickJS (cœur JS 51 Ko + `.wasm` 491 Ko) | 542 Ko | 242 Ko | 207 Ko |
| **Tout, combiné** (chunks partagés dédupliqués) | 1 381 Ko | **533 Ko** | 457 Ko |
| Point d'entrée (surcoût permanent) | 1,5 Ko | 0,8 Ko | 0,7 Ko |

Côté Node (main Electron, serveur web, serveur MCP), avec esbuild configuré comme
`build:mcp-server` :

| Option | JS minifié (gzip) | `.wasm` à livrer à côté | Remarque |
|---|---|---|---|
| QuickJS | 51 Ko (14 Ko) | 491 Ko (228 Ko gzip) | Bundle CJS sans problème |
| `vega-lite` | 774 Ko (267 Ko) | — | **Ne se bundle pas en CJS** (voir ci-dessous) ; mesuré en ESM |

Pour comparaison, les bundles actuels font en gzip :
- renderer desktop : 1,76 Mo ;
- client web : 1,44 Mo ;
- main : 1,17 Mo ;
- serveur MCP : 1,18 Mo.

Le chargement paresseux est possible partout :
- dans le renderer, `import()` produit des chunks séparés ; le `.wasm` est émis comme fichier
  (`new URL(…, import.meta.url)`) ;
- dans le main, même modèle qu'`alasql`, avec un `import()` mémoïsé.

Point d'attention : **Vega 6 est ESM-only, avec un `await` de premier niveau dans `vega-canvas`**.
esbuild refuse alors le format CJS, qui est celui du serveur MCP aujourd'hui (`Top-level await is
currently not supported with the "cjs" output format`). `tsx` échoue de la même façon sur un
`import` statique depuis un module CJS. Un `await import('vega-lite')` dynamique fonctionne.
Si le MCP doit compiler ou valider des specs, il faut au choix :
- un `import()` dynamique d'un module laissé externe ;
- un bundle MCP en ESM.

## 2. Où exécuter le bac à sable

**Recommandation : dans le process main**, avec un seul moteur pour l'app desktop, le serveur web
(#44) et le serveur MCP.

- **Les données y sont déjà.** Le graphe est construit à partir des index du main (§3). En
  l'exécutant dans le renderer, il faudrait transférer 5,6 Mo de JSON par IPC (×50). Pour le
  client web, ces 5,6 Mo passeraient par le réseau, et il faudrait aussi télécharger QuickJS
  (242 Ko gzip).
- **Même résultat partout.** Les outils MCP « tester un script sur les données réelles » utilisent
  le même code que l'app.
- **Le renderer reste léger.** Il ne charge que Vega : 290 Ko gzip avec `vega-embed`, ou 183 Ko si
  la spec est compilée ailleurs.
- **Pas de wasm dans le renderer.** Exécuter du wasm sous CSP stricte exige `'wasm-unsafe-eval'`
  dans `script-src`. Le main n'a pas cette contrainte.
- **Contrepartie : QuickJS est synchrone.** Une exécution occupe le thread jusqu'à sa limite de
  temps. Le bac à sable doit donc tourner dans un `worker_thread` (ou un `utilityProcess`
  Electron) : c'est le point 5 de la recommandation. Ce découpage n'a pas été prototypé ; il ne
  change rien aux mesures ci-dessous.
- Pour le client web, cela ne change rien d'autre : les lignes arrivent par le RPC existant, comme
  les résultats de requête aujourd'hui.

## 3. Performance

### 3.1 Construction du graphe

Le graphe est construit avec `createMcpContainer`, puis les étapes `resolveRepos`, `fetchRepoRaw`
et `computeCoverage` de `QueryEngineService`. Elles sont appelées en lecture, sans l'aplatissement,
et sans aucune modification des services.

| Jeu | Froid (index vides : fichiers + `git log`) | Chaud (index en mémoire) | `JSON.stringify` |
|---|---|---|---|
| démo | 525 ms | 12,5 ms | 1,5 ms |
| ×10 | 1 277 ms | 88 ms | 10 ms |
| ×50 | 4 968 ms | 387 ms | 48 ms |

- Le temps à froid est celui de l'indexation actuelle : il est payé aujourd'hui de la même façon
  par le moteur SQL.
- Le temps à chaud reste notable à ×50 (387 ms). Le graphe gagne à être **mis en cache** et
  invalidé par les événements d'index (watcher), au lieu d'être reconstruit à chaque exécution
  comme l'est le dataset SQL aujourd'hui.
- Observation annexe : pendant `fetchRepoRaw`, chaque index de repo est construit 2 à 3 fois en
  parallèle (journaux `Building index`). `getOrBuild` ne mémoïse pas les constructions en cours.
  C'est un gain possible indépendant de #74.

### 3.2 Passage du graphe dans QuickJS

| Jeu | Copie (`newString`) | `JSON.parse` dans QuickJS | Gel profond | Total préparation | Tas QuickJS |
|---|---|---|---|---|---|
| démo | 2,1 ms | 3,5 ms | 4,3 ms | 10 ms | 0,6 Mo |
| ×10 | 15 ms | 32 ms | 37 ms | 85 ms | 3,4 Mo |
| ×50 | 73 ms | 170 ms | 194 ms | 437 ms | 16 Mo |

- Le passage par une chaîne JSON (une copie, puis `JSON.parse` interne) est le plus simple.
  Construire les objets handle par handle serait bien plus lent.
- Le gel coûte à peu près autant que le parse. C'est le prix de la lecture seule, qui permet de
  réutiliser le contexte.
- Le cache entre exécutions est donc indispensable à partir de ×10. En mode « runtime neuf par
  exécution », tout widget coûte au moins 85 ms (×10) ou 420 ms (×50).

### 3.3 Exécution des trois scripts

Les trois scripts mesurés :
- (a) répartition des statuts d'exigences par composant ;
- (b) matrice test × campagne, équivalent GH69 ;
- (c) courbe empilée des statuts d'une campagne jour par jour, à partir de la bibliothèque projet
  `campaignsTimeline`, avec `addedAt`, les runs rattachés et `history`.

Colonnes du tableau :
- « Neuf » : runtime créé pour l'exécution (préparation comprise) ;
- « Cache » : contexte préparé réutilisé, sortie JSON comprise ;
- « V8 » : même script exécuté nativement, hors bac à sable, pour référence.

| Script | démo neuf | démo cache | ×10 cache | ×50 neuf | ×50 cache | ×50 V8 | Lignes |
|---|---|---|---|---|---|---|---|
| (a) statuts | 15,5 ms | 0,6 ms | 1,5 ms | 426 ms | 6,4 ms | 1,6 ms | 23 |
| (b) matrice | 12,0 ms | 0,5 ms | 2,7 ms | 430 ms | 12,7 ms | 0,4 ms | 19 / 950 |
| **(c) 1 campagne** | 12,7 ms | **1,3 ms** | 1,2 ms | 420 ms | **3,3 ms** | 0,6 ms | 80 |
| (c) toutes campagnes cumulées | 22,5 ms | 8,6 ms | 36 ms | 593 ms | 160 ms | 15 ms | 815 |
| (c) toutes, sans `_ids` | 18,6 ms | 6,4 ms | 21 ms | 504 ms | 81 ms | 7,9 ms | 815 |

- QuickJS est un interpréteur : il est **5 à 30 fois plus lent que V8** selon le script. Les
  volumes de Polenta restent malgré tout très en dessous des seuils.
- **La qualité de la bibliothèque compte davantage que le moteur.** Une première version de (c)
  calculait une timeline par campagne sur la plage globale, puis fusionnait 200 000 lignes.
  Elle prenait **1 290 ms** sur ×50 (V8 : 350 ms). La version à balayage unique
  (`campaignsTimeline`) prend **160 ms**. La bibliothèque de départ livrée par #74 doit être
  écrite avec soin, et testée sur un gros jeu.
- **`_ids` sur une série temporelle pèse lourd** : 1,9 Mo de sortie pour (c) cumulé à ×50, et
  deux fois le temps d'exécution. La règle « chaque ligne porte ses IDs » reste juste, mais il
  faut prévoir que les IDs puissent être demandés au clic. Par exemple, le même script relancé
  avec `params.ids` sur la ligne cliquée (§8).
- Variante `quickjs-ng` : environ 25 à 35 % plus lente sur (c) cumulé (210 ms contre 157 ms) et
  sur la préparation (576 ms contre 479 ms). On garde QuickJS (Bellard).

### 3.4 Mémoire et limites

Valeurs mesurées sur ×50 :
- tas QuickJS : 16 Mo ;
- mémoire linéaire wasm : 52 Mo ;
- RSS du process de mesure : 440 Mo, dont les index et le graphe côté hôte.

Les sondes de limites tournent avec une limite mémoire de 64 Mo, une limite de temps de 1 s et une
pile de 256 Ko.

| Sonde | Résultat sans plafond wasm | Avec `WebAssembly.Memory` plafonnée à 128 Mo |
|---|---|---|
| Boucle infinie | `InternalError: interrupted` en 1,01 s ; contexte en cache réutilisable | Identique |
| Allocation massive | `out of memory` en **3,9 s** (limite de temps dépassée) ; **mémoire wasm montée à 2 048 Mo**, jamais rendue | `out of memory` en **0,29 s** ; wasm 126 Mo ; module réutilisable |
| Chaîne géante | `string too long` en 11 ms | Identique |
| Récursion infinie | `stack overflow` en 14 ms | Identique |

Trois constats en découlent pour le Design.

1. **`setMemoryLimit` ne borne pas le process.** La mémoire linéaire wasm grandit jusqu'à 2 Go
   avant l'OOM, et une mémoire wasm ne rétrécit jamais. Il faut une `WebAssembly.Memory` avec un
   `maximum`, passée via `newVariant(…, { wasmMemory })` : l'instanciation d'un module coûte
   5 à 17 ms. Il faut aussi recréer le module après un OOM.
2. **La limite de temps n'est pas tenue pendant un OOM lent** : 3,9 s pour une limite de 1 s, car
   le ramasse-miettes s'emballe. Le plafond wasm règle le problème, puisque l'OOM arrive plus tôt.
3. **La pile ne doit pas dépasser environ 256 Ko.** Avec 512 Ko, la récursion fait déborder la
   pile native de V8 (les frames wasm) avant que QuickJS ne lève son erreur : `RangeError` côté
   hôte. Après ce débordement, la libération du runtime fait avorter tout le module wasm
   (assertion `gc_obj_list`). La taille sûre dépend de la pile du thread hôte : elle est à
   revérifier dans le worker retenu.

Les limites par défaut proposées pour #74 :
- 64 Mo pour le runtime, avec un plafond wasm de 128 Mo par module ;
- 2 s par exécution ;
- une pile de 256 Ko.

## 3 bis. Bibliothèque projet

La bibliothèque est chargée par `import { … } from "lib/<module>.js"`. Le chargeur de modules du
bac à sable ne résout que les clés `lib/*.js` fournies par l'hôte (fichiers de
`dashboards/lib/`). Les imports relatifs entre modules de la bibliothèque sont résolus.

| Cas | Runtime neuf | Contexte en cache : 1ʳᵉ exécution | Contexte en cache : exécutions suivantes |
|---|---|---|---|
| Bibliothèque de départ (~3 Ko), import de `lib/history.js` | 0,3 ms | 0,3 ms | 0,1 ms |
| Bibliothèque synthétique de 100 Ko, import du module de 100 Ko | 13 ms | 13 ms | **0,1 ms** (module en cache) |
| Même code de 100 Ko injecté en script global (sans modules) | 12 ms | — | — |

- **L'import ES suffit.** Il ne coûte pas plus cher que l'injection, et QuickJS met les modules en
  cache dans un contexte réutilisé.
- On ne paie que les modules importés : une bibliothèque volumineuse dont le widget n'importe
  qu'un petit module ne coûte rien de plus.
- Le cache des modules a une conséquence : **toute modification d'un fichier `dashboards/lib/`
  doit invalider le contexte préparé**, comme une modification des données.

## 4. Isolation et erreurs

Résultats vérifiés par `bench.ts` (section `isolation` de `results/bench.json`).

**Globaux absents** : `fetch`, `require`, `process`, `module`, `setTimeout`, `setInterval`,
`queueMicrotask`, `XMLHttpRequest`, `WebSocket`, `WebAssembly`, `console`, `window`, `document`,
`performance`, `std`, `os`.
- `SharedArrayBuffer` est présent, mais sans thread ni `Atomics` il est inoffensif.
- `Date.now()`, `Math.random()`, `eval` et `Function` existent, mais ils restent confinés au bac à
  sable. `Function('return this')()` rend le global QuickJS, sans `process` ni `require`.

**Imports refusés** avec un message explicite : `os`, `std`, `fs`, `node:fs`, `child_process`, une
URL `https://…`, `../../package.json` et `lib/../../secret.js`. Un `import('os')` dynamique ne se
résout jamais : il n'y a pas de boucle de jobs, et la fonction est synchrone.

**Données en lecture seule** :
- `data.requirements[0].status = …` → `TypeError: 'status' is read-only` ;
- `data.requirements = []` → `TypeError: 'requirements' is read-only`.

**Fuite entre widgets dans un contexte réutilisé** :
- sans durcissement, `globalThis.leak` et `Array.prototype.sum`, posés par le widget 1, restent
  visibles du widget 2 ;
- avec durcissement (gel de l'objet global et des intrinsèques, 4 à 5 ms une fois par contexte),
  l'écriture échoue (`TypeError: object is not extensible`) et le widget 2 ne voit rien. Le
  widget (c) fonctionne toujours, et le durcissement n'a pas d'effet mesurable sur l'exécution.

**Remontée des erreurs** :

| Cas | Remontée |
|---|---|
| `throw new Error(…)` en ligne 3 | `Error: seuil dépassé : 77`, `widget.js`, ligne 3, colonne 18 |
| Champ absent (`c.entrees.length`), ligne 4 | `TypeError: cannot read property 'length' of undefined`, `widget.js`, ligne 4, colonne 17 |
| Erreur de syntaxe (parenthèse manquante en ligne 2) | `SyntaxError: expecting ','`, `widget.js`, **ligne 3** (là où l'analyseur la détecte) |
| Erreur dans la bibliothèque | `TypeError: cannot read property 'concat' of null`, **`lib/campaign.js`**, ligne 35, colonne 35 |
| Pas d'export par défaut | Message dédié (contrôle par l'hôte) |
| Ligne sans `_ids`, valeur non scalaire | `RowsError` : « Ligne 0 : "_ids" doit être un tableau… », « Ligne 0, colonne "r" : valeur non scalaire » |
| Fonction `async` | `RowsError` : « doit renvoyer un tableau » ; un message dédié aux promesses serait plus clair |

## 5. Vega-Lite

La page de rendu est servie avec la CSP suivante, posée à la fois en en-tête HTTP et en balise
meta :

`default-src 'self'; script-src 'self'; style-src 'self'; …`

Elle ne contient **ni `unsafe-eval`, ni `unsafe-inline`**. Les spec sont compilées par
`vega-lite` puis passées à `vega.parse(…, { ast: true })` et `new View(…, { expr:
expressionInterpreter })`. Le contrôle de la CSP est fait de deux façons :
- `new Function` est bien bloqué (`EvalError`) ;
- un rendu **sans** interpréteur échoue, comme attendu.

| | Electron 31 (Chrome 126) | Chromium 156 |
|---|---|---|
| (a), (b), (c) en thème clair et sombre | ✅ 6/6 | ✅ 6/6 |
| Compilation Vega-Lite + premier rendu | 8 à 38 ms, puis 30 à 153 ms | 6 à 31 ms, puis 25 à 142 ms |
| `vega-embed` avec `{ ast: true, expr }` | ✅ | ✅ |
| Violations CSP hors contrôles volontaires | Une injection de `<style>` en ligne (non bloquante, rendu correct) | Idem |
| Clic sur une marque → `_ids` de la ligne d'origine | ✅ (a) 3 IDs, (b) test + campagne, (c) 3 tests | ✅ |

- **Drill-down.** `view.addEventListener('click', (e, item) => item.datum._ids)` suffit : il
  n'est pas nécessaire de passer par la sélection Vega-Lite.
- **Courbe empilée (aires).** Une aire est une seule marque, dont le `datum` n'identifie pas le
  point cliqué. La spec (c) ajoute donc une couche de barres quasi transparentes portant les
  lignes. C'est à intégrer au modèle « courbe empilée ».
- **L'agrégation se fait dans le script, pas dans la spec.** Un `aggregate` Vega-Lite perd `_ids`.
  L'agent de §6 l'a compris tout seul ; c'est à écrire dans le contrat.
- **Thème.** Les specs désignent leurs couleurs par jeton : `"var(--status-success-solid)"`.
  L'hôte remplace ces jetons par les valeurs calculées du thème courant (jetons « R G B » de
  `theme.config.ts`). Il construit aussi la `config` Vega à partir des jetons :
  - `ink`, `edge`, `activity-fg` pour les axes et les légendes ;
  - `surface` pour le fond ;
  - `chart-series-1…8` pour la palette catégorielle.

  Le rendu est correct dans les deux thèmes (`results/render-*.png`). Un changement de thème
  impose de recompiler la spec.
- **Pas de CSP aujourd'hui.** L'application n'a aucune CSP (ni balise, ni en-tête). L'objectif
  « mode CSP sans `eval` » de #74 suppose d'en ajouter une, ce qui dépasse le périmètre de #74.
  L'injection de `<style>` en ligne vient vraisemblablement de `vega-embed` / `vega-tooltip`. Il
  faudra autoriser ces styles, ou fournir la feuille de style de l'infobulle.

## 6. Écriture par l'IA

Trois agents ont écrit chacun un script et une spec, à partir du **seul** `contract.ts`, sans
accès au code ni possibilité d'exécution. Leurs sorties sont dans `spikes/GH78/ai/`. Elles ont été
exécutées dans le bac à sable sur la démo, puis comparées aux agrégats des widgets de référence.

| Cas | Exécution | Écart à la référence | Spec Vega-Lite |
|---|---|---|---|
| (a) statuts | ✅ du premier coup, 23 lignes | 0 | Compile ; aucun champ inconnu |
| (b) matrice | ✅, 19 lignes | 0 | Compile ; aucun champ inconnu |
| (c) avancement dans le temps, **sans bibliothèque** | ✅, 525 lignes | 0 | Compile ; aucun champ inconnu |

- **Aucune erreur fonctionnelle.** L'agent (c) a même reconstruit des cas que la référence
  n'utilisait pas : repli sur `runId` pour les données antérieures à GH73, entrées retirées,
  passage à `abandoned` lu dans `history`.
- Écart de méthode : l'agent (c) a utilisé une fois `sed` sur sa propre spec, hors consigne, sans
  lire d'autre fichier.

Les ambiguïtés que les agents ont signalées sont les vrais trous du contrat :

| Ambiguïté signalée | Proposition pour la Spec de #74 |
|---|---|
| Lien entre la sélection Vega-Lite et `_ids` non spécifié (a, b, c) | Documenter la convention : l'hôte lit `datum._ids` de la marque cliquée ; aucun nom de paramètre imposé |
| `_ids` perdu par un `aggregate` Vega-Lite (c) | Règle : le script agrège, la spec n'agrège pas |
| Pas de libellé de composant (a) | Ajouter `components: { name, label, repo }[]` (seul `repos[].label` existe) |
| Ordre et gravité des statuts d'entrée (`pending` par rapport à INCOMPLETE) (b) | Publier l'ordre canonique de `EntryStatus` |
| Statuts terminaux à inclure ou non (a) | Préciser dans le contrat (laisser le choix au script, avec `isTerminal`) |
| Libellé d'un statut défini par plusieurs types (a) | Rappeler la clé (`repo`, `objectTypeRef`) — déjà présente, à mettre en avant |
| `completedAt` d'une campagne abandonnée ; un run garanti par verdict ? (c) | Préciser (GH73 rend le run obligatoire pour les nouvelles saisies) |
| Fuseau horaire des jours (c) | Paramètre `polenta.timezone`, ou découpage UTC documenté (GH73 §6.3) |

Mon propre travail sur le contrat a fait apparaître un point de plus : une `objectTypeRef` comme
`root::…` **n'est pas unique entre repos**, puisque chaque repo a son schéma. Le contrat porte donc
`repo` sur chaque objet et chaque type. Ce point est passé inaperçu des agents, mais il est
indispensable.

## 7. Alternatives

Aucun point bloquant n'a été rencontré. `iframe` + Web Worker, `isolated-vm` et `ses` n'ont pas
été évalués.

## 8. Points à reporter dans la Spec et le Design de #74

**Lieu d'exécution** : le process main, dans un `worker_thread` ou un `utilityProcess`, avec un
seul moteur pour le desktop, le web et le MCP. Le renderer n'exécute pas de script.

**Cache** :
- un graphe par workspace et un contexte QuickJS préparé (graphe injecté, gelé, contexte durci) ;
- invalidation sur tout changement d'index ou de `dashboards/lib/` ;
- les widgets d'un dashboard partagent le contexte.

**Limites par défaut** :
- 64 Mo pour le runtime, avec une `WebAssembly.Memory` plafonnée à 128 Mo par module ;
- 2 s par exécution, et une pile de 256 Ko ;
- le module est recréé après un OOM ou un abandon.

**Chargement paresseux** :
- QuickJS : `import()` mémoïsé dans le main, et le `.wasm` copié à côté des bundles
  main, web-server et MCP ;
- Vega : chunk paresseux dans le renderer ;
- `vega-lite` ne se bundle pas en CJS (MCP) : prévoir un `import()` externe ou un bundle ESM.

**Contrat de données v1** :
- `repo` sur chaque objet et chaque type ;
- une liste des composants avec leurs libellés ;
- l'ordre canonique des statuts d'entrée ;
- les conventions de drill-down (`datum._ids`, pas d'agrégation dans la spec) ;
- le fuseau horaire ;
- le statut du `snapshot`, réduit ici à `{ status, version, title }`. La copie complète
  multiplierait la taille du graphe, et ses `steps` en HTML ne servent à aucun indicateur ;
- les `steps` des tests, qui pèsent lourd dans le graphe (à envisager en option).

**`_ids` à la demande** pour les séries longues : le widget est relancé avec un paramètre de ligne
au moment du clic, plutôt que d'embarquer tous les IDs à chaque point.

**Bibliothèque de départ** :
- écrite pour la performance (balayage, pas de rescans) ;
- testée sur un jeu ×50 dans le corpus de non-régression.

**Modèle « courbe empilée »** : ajouter la couche de marques cliquables au-dessus de l'aire.

**Thème** :
- jetons `var(--…)` dans les specs, résolus par l'hôte ;
- `config` Vega dérivée des jetons ;
- recompilation au changement de thème.

**CSP** : en ajouter une à l'application (aujourd'hui absente) dans un ticket à part, avec
`'wasm-unsafe-eval'` uniquement si un jour QuickJS tourne dans le renderer.

**Hors #74** :
- la construction des index en double dans `getOrBuild`, constatée pendant les mesures (§3.1).

## Reproduire les mesures

Depuis la branche `GH78`, avec le workspace de démo présent à côté du repo
(`node scripts/demo-lave-linge/generate.mjs`, ou `GH78_DEMO_WS=<dossier>`) :

```
pnpm install
pnpm --filter @polenta/desktop spike:gh78
```

La commande enchaîne :
1. la génération des jeux ×10 et ×50 (`spikes/GH78/.data/`, ignoré par git) ;
2. les mesures (graphe, QuickJS, bibliothèque, limites, isolation) ;
3. le poids des bundles, avec un rebuild des bundles actuels pour référence (`--no-baseline` pour
   s'en passer) ;
4. le rendu dans Chromium et Electron ;
5. l'évaluation des sorties IA.

Résultats : `apps/desktop/spikes/GH78/results/` (`bench.json`, `bundles.json`, `render.json`,
`ai.json`, `render-*.png`). Durée : environ 5 minutes, dont 3,5 pour les rebuilds de référence.
