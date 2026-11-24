# GH435 — Sprint 1 : modèle, stockage, service, MCP

Périmètre (design § 1) : constantes et règles de bornage, lecture / écriture des dimensions, service, MCP,
types de l'API. Aucun effet visible dans l'application : le réglage à la souris arrive au sprint 2.

## Fichiers modifiés

| Fichier | Changement |
|---------|-----------|
| `packages/types/src/widget-size.ts` (nouveau) | constantes (`W` = 1104, bornes, préréglages 264 / 544 / 1104, seuil 640), `clampWidgetWidth` / `clampWidgetHeight`, `readWidgetDim`, `widgetRequestedWidth`, `widgetDisplayWidth`, constantes et fonctions d'impression (`PRINT_SCALE` = 0,65, `printLayoutWidth`, `printFontFloor`) |
| `packages/types/src/dashboard.ts`, `suivi-format.ts`, `index.ts` | `width?` / `height?` sur `Widget`, `StoredWidget`, `ReadWidget` ; lecture bornée dans `readWidget` |
| `apps/desktop/src/main/services/dashboards.service.ts` | `AddWidgetDto` / `UpdateWidgetDto` : `width`, `height` (`null` retire) ; `checkedDim`, `withDims` ; propagation dans `toWidget`, `toDraft`, `storedWidget` |
| `apps/desktop/src/mcp-server/tools/dashboards.tools.ts` | `width` / `height` dans `add_widget` et `update_widget` (schéma borné, `null` pour retirer), aperçu et écriture, descriptions |
| `apps/desktop/src/main/services/agents-md.template.ts` | phrase sur les dimensions |
| `packages/api-client/src/types.ts` | mêmes champs dans les DTO |

## Comportement implémenté

- Un widget porte deux champs facultatifs `width` et `height` (px). Écrits seulement s'ils existent, dans
  l'ordre `size, width, height` : `dashboard.yaml` (partagé) et `.pref` (privé). `formatVersion` inchangé.
- Lecture : nombre fini borné (240 à 1104, 160 à 720), tout autre type ignoré. Écriture : arrondi puis borne ;
  `null` retire la clé ; valeur non numérique ou non finie refusée (`Largeur / Hauteur de widget invalide`),
  sans rien écrire.
- Les dimensions suivent le widget au changement de portée, au changement d'ordre, à la suppression d'un autre
  widget et au changement de code. Un dashboard sans dimension est réécrit octet pour octet à l'identique.
- MCP : bornes du schéma refusent hors plage et non entiers ; `update_widget` accepte `null` ; l'aperçu
  (`dryRun`) porte les dimensions sans rien écrire ; `list_dashboards` les renvoie.

## Divergences par rapport au design

Aucune. Constat d'environnement : la suite unitaire doit s'exécuter dans `apps/desktop` (`npx vitest run`) avec
`POLENTA_GIT_DIR` pointant sur le `vendor/git` d'un autre dossier du poste ; passée par `pnpm test` (turbo),
la variable est supprimée et 59 fichiers échouent sur « Git embarqué introuvable ».

## Mises à jour SPEC

Reportées au sprint 4 (dernier sprint) : `SPEC-DASHBOARDS.md` § 7.0 et § 10, `SPEC-MCP-SERVER.md`, `SPEC-INDEX.md`.

## Vérifications

- `pnpm typecheck` : 0 erreur.
- Unitaires touchés : `widget-size.gh435` (11), `dashboards-size.gh435` (11), `mcp-dashboards.gh435` (2) : 24 / 24.
- Suite unitaire complète (`apps/desktop`, `npx vitest run`) : 242 fichiers, 2336 tests passés, 5 ignorés.
- ESLint sur les fichiers modifiés : 0 erreur. `pnpm lint` global : 3 erreurs **préexistantes** sur `main`,
  hors ticket (issue #437).
- E2E : aucun test du ticket à ce stade (aucun effet visible) ; les e2e voisins tournent au sprint 2.

## Comment tester manuellement

Sans interface à ce stade : dans un dashboard, appeler `dashboards:update-widget` avec `{ width: 700,
height: 320 }` (ou l'outil MCP `update_widget` avec `dryRun: false`), puis lire `dashboards/DASHBOARD-xxxx/dashboard.yaml`.
