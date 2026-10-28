# GH178 — Scénarios de test

Spec : `specs/GH178.md` · Design : `specs/GH178-design.md`.
Colonne **Auto** : `U` = vitest (`pnpm test`), `E` = e2e client web (`e2e-web/gh178-*.spec.ts`),
`M` = manuel (desktop).

## Fixture commune

Repo de test avec deux commits `c1` → `c2` :
- `SYS-0001` (exigence) : en `c2`, `statement` passe de « …within 500 ms » à « …within 300 ms »,
  `status` de `draft` à `review` (ajoute une entrée `history`), `priority` inchangée.
- `TEST-0001` (test, 3 étapes) : en `c2`, une étape est insérée en position 2 et l'action de la
  dernière étape est modifiée.
- `SYS-0002` : créée en `c2`. `SYS-0003` : supprimée en `c2`.
- `diagrams/a.drawio` (pages « Vue » et « Détail ») : en `c2`, la page « Détail » est modifiée et
  une page « Annexe » est ajoutée. `SYS-0004` référence la page « Détail » dans un richtext, et son
  YAML ne change pas entre `c1` et `c2`.
- `links/links.yaml` modifié.
- Schéma : en `c2`, le type d'exigence gagne un champ `rationale` (renseigné sur `SYS-0001`).

## Golden path

| # | Scénario | Attendu | Sprint | Auto |
|---|---|---|---|---|
| G1 | `/version-diff` `c1`→`c2`, `SYS-0001`, première ouverture | Mode Rendu, deux colonnes `Avant · c1` / `Après · c2`. Statut « Brouillon » / « En review » marqué ; `statement` marqué ; `priority` non marqué ; `history` absent. | 1 | E |
| G2 | Même écran, bascule Raw | Diff texte identique à l'actuel (mêmes lignes, `+n / −n`). | 1 | E |
| G3 | Fermer / rouvrir un diff (puis redémarrer l'app) | Le dernier mode choisi est restauré, de même que « Masquer les inchangés ». | 1 | E + M |
| G4 | `SYS-0001` en Rendu, sprint 2 | Dans `statement`, seuls `500` (barré, colonne Avant) et `300` (surligné, colonne Après) sont marqués. | 2 | E |
| G5 | `TEST-0001` en Rendu | L'étape insérée est verte à droite face à une rangée vide à gauche. L'étape suivante n'est pas marquée. La dernière étape est appariée avec un diff mot à mot sur l'action. | 2 | E |
| G6 | Modification locale de `SYS-0001` (working tree) depuis la section Modifications → `/diff` | Avant = `HEAD`, Après = `working tree`, même rendu que G1. | 1 | E |
| G7 | Graphe → commit `c2` → `SYS-0001` (`/diff?commitSha`) | Avant = parent (`c1`), Après = `c2`, même rendu. | 1 | E |
| G8 | `diagrams/a.drawio` en Rendu | Trois rangées « Vue » (non marquée), « Détail » (cadres rouge et vert), « Annexe » (absente à gauche, marquée à droite). Chaque colonne montre son diagramme. | 2 | E |
| G9 | `SYS-0004` en Rendu (YAML identique, diagramme référencé modifié) — fichier ouvert via `/diff` d'un commit qui modifie les deux | Chaque colonne affiche la page « Détail » de sa ref. Le bloc est encadré, l'unité marquée. | 2 | E |

## Cas limites

| # | Scénario | Attendu | Sprint | Auto |
|---|---|---|---|---|
| L1 | `links/links.yaml`, `.polenta/schema.yaml`, campagne, image seule | Pas de bascule, diff Raw. La préférence de mode n'est pas modifiée. | 1 | E |
| L2 | `SYS-0002` (ajoutée) | Colonne Avant : « Fichier absent de cette version » ; colonne Après : toutes les unités marquées. | 1 | E |
| L3 | `SYS-0003` (supprimée) | Symétrique de L2. | 1 | E |
| L4 | YAML invalide côté Après (fichier modifié à la main) | Rendu : « Rendu indisponible pour ce contenu — voir Raw » ; Raw fonctionne. | 1 | U + M |
| L5 | `objectTypeRef` inconnu des trois schémas | Pas de bascule, Raw. | 1 | U |
| L6 | Champ `rationale` ajouté au schéma en `c2` | Rangée « rationale » placée selon le schéma Après : « — absent » à gauche, valeur à droite, marquée. | 1 | E |
| L7 | Champ présent dans les données, absent du schéma | Rangée avec son nom technique et sa valeur brute. | 1 | U |
| L8 | « Masquer les inchangés » sur `SYS-0001` | Les rangées inchangées consécutives sont repliées en « n champs inchangés », que l'on peut déplier. | 1 | E |
| L9 | Richtext dont seule la mise en forme change (mot passé en gras) | Unité marquée, aucun `<del>` / `<ins>`. | 2 | U |
| L10 | Très long texte (> 4 000 jetons changés) | Unité marquée sans détail mot à mot ; pas de gel de l'interface. | 2 | U |
| L11 | Diagramme référencé absent à une des refs | Badge d'erreur du viewer dans cette colonne ; bloc encadré. | 2 | M |
| L12 | `.drawio` illisible d'un côté | « Rendu indisponible » dans cette colonne, l'autre colonne est rendue. | 2 | U + M |
| L13 | Commit initial (pas de parent) dans le graphe | Avant = fichier absent ; Après = objet complet marqué. | 1 | U |
| L14 | Exigence d'un composant (`<composant>::type`) | Type résolu via le schéma courant ; Rendu disponible. | 1 | M |
| L15 | Aucune écriture : ouvrir les diffs G1–G9 puis `git status` | Working tree inchangé, aucun fichier créé. | 1–2 | E |
| L16 | Client web | G1, G2, G8 identiques au desktop (`drawio:read` / `image:read` avec ref, `schema:get-at` passent la politique de canaux). | 1–2 | E |
| L17 | Thème sombre | Marques lisibles (jetons de thème). | 2 | M |

## Tests unitaires

- `objectUnits.test.ts` : ordre des unités (schéma, hors schéma, test vs exigence), exclusions
  (`id`, `history`…), libellés de statut / d'enum.
- `wordDiff.test.ts` : tokenisation (accents, apostrophes, ponctuation), préfixe / suffixe communs,
  garde-fou de taille, rattachement des espaces.
- `mediaDiff.test.ts` : alignement des blocs par `path`, changement de payload, ajout / retrait.
- `stepsAlign` (dans `StepsDiff`, exporté) : insertion, suppression, modification en place,
  réordonnancement.
- `sync.service` : `readFileAt` (ref, SHA, working tree, absent) ; refs et `*Missing` des trois
  diffs, y compris pour un commit initial.
- `schema.service.getAt` : schéma présent, absent à la ref, migration `roles` / `implements`.
- `channel-policy.test.ts` : `schema:get-at` déclaré.

## Critères d'acceptation → scénarios

| Critère spec §4 | Scénarios |
|---|---|
| 1 | G1, G6, G7, G8, L1 |
| 2 | G2 |
| 3 | G1, G5, G8 |
| 4 | G1, L6, L7 |
| 5 | G4, L9 |
| 6 | G1, L6 |
| 7 | L2, L3, L13 |
| 8 | G3, L8 |
| 9 | G9, L11 |
| 10 | G8, L12 |
| 11 | L4 |
| 12 | L15 |
| 13 | L16 |
