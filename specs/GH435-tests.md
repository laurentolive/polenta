# GH435 — Scénarios de test

Spec : `specs/GH435.md` (critères 1 à 16). Design : `specs/GH435-design.md`.
Unitaires : vitest (`apps/desktop`, lancé directement avec `POLENTA_GIT_DIR`). E2E : `apps/desktop/e2e-web/gh435-widget-size.spec.ts`
(E1 à E3, E5b partie 1, E8 à E12 : poignées, flux, modale) et `gh435-rendering.spec.ts` (E4 à E7, E13, E13b, E14 :
rendu, tableaux, impression), client web, mouvements de souris réels, jamais seulement le clavier — leçon 2026-11-19.
Écarts avec la liste ci-dessous : E5c ajouté (nombre de lignes qui change) ; E13c (polices ≥ 8 px) est inclus dans E13 ;
fichiers unitaires réels : `widget-size.gh435`, `dashboards-size.gh435`, `mcp-dashboards.gh435`, `vegaFit.gh435`
(U12 à U14 et U12b : mesure sur une vue Vega sans navigateur), `vegaTheme.gh435` (U16), `print-renderer.gh435` (U15). Objets créés par le test via IPC
(`dashboards:*`, `queries:*`), comme les specs GH74 / GH125.

## 1. Unitaires

| # | Fichier | Cas | Critère |
|---|---------|-----|---------|
| U1 | `main/services/widget-size.gh435.test.ts` | `clampWidgetWidth` / `clampWidgetHeight` : arrondi, bornes 240 / 1104 et 160 / 720, `max` plus petit que le minimum | 2 |
| U2 | idem | `readWidgetDim` : nombre, chaîne numérique ignorée, `NaN`, `Infinity`, négatif, `null`, absent → `undefined` | 2 |
| U3 | idem | `WIDGET_PRESET_WIDTH` : deux `md` + espacement = `W` ; `sm` ≥ 240 ; `widgetRequestedWidth` sans `width` = préréglage | 3, 11 |
| U4 | idem | `widgetDisplayWidth` : zone 1104 → inchangé ; zone 900 → borné à 900 ; zone 639 → `'100%'` ; zone 640 → pas `'100%'` ; zone 200 → `min(240, zone)` | 3 |
| U5 | idem | `printScale()` = 0,65 ; largeur de mise en page `Lp / s ≥ W` ; `printFontFloor()` = 13 ; `13 × s ≥ 8` | 8 |
| U6 | `main/services/suivi-store.gh435.test.ts` | lecture d'un `dashboard.yaml` : `width` / `height` valides, hors bornes ramenés, chaîne ignorée, absents ; format d'avant GH74 inchangé | 2, 11 |
| U7 | idem | `addWidget` avec dimensions : écrites dans `dashboard.yaml` (partagé) et dans `.pref` (privé), ordre des clés `size, width, height` | 1 |
| U8 | idem | `updateWidget` : un nombre pose, `null` retire la clé du fichier, `undefined` conserve, valeur non numérique → erreur, hors bornes → bornée | 2, 13 |
| U9 | idem | dimensions conservées par `setScope` (privé → partagé → privé), `updateWidget` de titre seul, `setWidgetOrder`, `deleteWidget` d'un autre widget | 11 |
| U10 | idem | un widget sans dimension n'écrit ni `width` ni `height` (fichiers inchangés pour les seeds) | 11 |
| U11 | `mcp-server/tools/dashboards.gh435.test.ts` | `add_widget` / `update_widget` : schéma refuse hors bornes, `dryRun` renvoie les dimensions, écriture réelle les pose, `null` les retire ; `list_dashboards` les renvoie | 15 |
| U12 | `renderer/components/dashboard/vegaFit.gh435.test.ts` | légende à droite (peu d'entrées, libellés courts, graphique large) ; en bas avec colonnes (8 entrées de 30+ caractères en 544 px) ; `labelLimit` = place disponible ; `symbolLimit: 0` | 4 |
| U13 | idem | clés `legend` de l'utilisateur conservées ; `legend: null` intact ; encodages dans `layer` ; spec sans légende inchangée ; valeurs quantitatives ignorées | 4 |
| U14 | idem | axes : `labelLimit` borné (y : 40 % de la largeur, x : 35 % de la hauteur) | 4 |
| U15 | `main/host/print-renderer.gh435.test.ts` | `PRINT_OPTIONS_BY_KIND` : `dashboard` seul renseigné ; convertisseur Electron (pouces, `scale`) et Playwright (`'10mm'`, `scale`) ; les autres exports sans option | 8 |
| U16 | `vegaTheme.test.ts` (étendu) | `themeConfig(resolve, 13)` : polices axes et légendes à 13 ; défaut 10 | 8 |

## 2. E2E web — golden path et cas limites

Préparation commune : dashboard partagé « GH435 » créé par IPC ; requête partagée de lignes fabriquées
(`export default () => [...]`) ; fenêtre 1600 × 1000 sauf mention.

| # | Scénario | Attendu | Critère |
|---|----------|---------|---------|
| E1 | Tirer la poignée droite d'une carte `md` de 544 vers 700 px, échantillonnage de chaque frame du glissement | largeur ∈ [240, 1104] à chaque frame, suit le pointeur ±1 px ; au relâchement `dashboards:get` renvoie `width: 700` ; `dashboard.yaml` contient `width: 700` ; après rechargement 700 ±1 ; le SVG remplit le corps | 1, 6 |
| E1b | Idem hauteur : 256 → 400 ; dashboard privé : valeur dans le `.pref` | `height: 400`, carte 400 ±1 | 1 |
| E2 | Tirer bien au-delà des bornes (droite, gauche, bas, haut) | 1104 / 240 / 720 / 160 ; jamais hors bornes à aucune frame | 2 |
| E2b | `dashboard.yaml` écrit à la main : `width: 5000`, `height: 10` ; `dashboards:update-widget` avec `width: 99999` | affichage 1104 × 160 ; valeur lue / écrite bornée | 2 |
| E3 | Deux `md` côte à côte (zone mesurée = 1104 px) ; fenêtre ramenée à 1000, 900 puis 600 px | côte à côte à 1600 ; à la ligne dès 900 ; sous 640 de zone, chaque carte = largeur de la zone ; `document.scrollingElement.scrollWidth ≤ clientWidth` à chaque largeur | 3 |
| E3b | Ouvrir le panneau latéral (zone qui rétrécit) | la mise en page suit sans rechargement | 3, 6 |
| E4 | Graphique à barres empilées, 9 séries de 34 caractères, tailles `md` puis `lg` | tous les libellés de légende entiers (pas de « … »), aucun `text` de légende ou d'axe hors du corps de la carte | 4 |
| E4b | Même graphique en `sm` (264 × 256) | soit tous les libellés entiers, soit `widget-too-small` ; jamais de texte coupé | 4, 7 |
| E5 | Widget tableau de 8 lignes sans hauteur enregistrée ; autre de 100 lignes ; un troisième avec `height: 300` | 8 lignes : pas de défilement vertical interne ; 100 lignes : carte de 720 ±1 puis défilement ; hauteur fixe 300 ±1 avec défilement | 5 |
| E5b | Tirer la poignée du bas du tableau automatique, puis double-clic dessus | hauteur enregistrée, puis clé retirée et retour à l'ajustement automatique | 5, 13 |
| E6 | Redimensionner la fenêtre (1600 → 1000), puis la carte | SVG = corps de carte ±2 px après stabilisation, sans rechargement ; pas d'élément hors du corps | 6 |
| E7 | Carte à 8 séries ramenée à 240 × 160 (par la poignée), puis rétablie à 544 × 256 | `widget-too-small` à la place du tracé ; après agrandissement le graphique revient (sans rechargement) | 7 |
| E8 | Dashboard d'un format plus récent (`formatVersion: 2`) et route `/print/dashboard` | aucune poignée (`widget-resize-w` / `-h` : 0) ; pas de glisser | 9 |
| E9 | Glisser une carte par son en-tête vers une autre place ; saisir la poignée droite et bouger | l'ordre change dans le fichier ; avec la poignée, la carte se redimensionne et l'ordre ne change pas | 10 |
| E10 | Dashboard « avant GH435 » (aucune clé de dimension, `sm` / `md` / `lg`) ; changement de portée privé ↔ partagé d'un dashboard redimensionné | largeurs 264 / 544 / 1104 (±1), hauteur 256 ; dimensions conservées après le changement de portée | 11 |
| E11 | Modale : changer de préréglage `md` → `lg` sur un widget à 700 × 320 ; l'ouvrir et enregistrer sans toucher à la taille | clés retirées dans le premier cas ; conservées dans le second ; aperçu non coupé ; texte « Taille personnalisée : 700 × 320 px » | 12 |
| E12 | Réseau : `page.route` fait échouer `dashboards:update-widget` pendant un relâchement | la carte revient à sa taille enregistrée (±1) ; message d'erreur visible ; fichier inchangé | 14 |
| E13 | Impression, route `/print/dashboard` ouverte dans le navigateur, fenêtre 1105 px de large, média `print` | grille de 1104 px ; chaque carte à ses dimensions ; aucune poignée ; aucun défilement horizontal | 8 |
| E13b | PDF via « Exporter » → PDF d'un dashboard de 13 cartes pleine largeur de 720 px (KPI, hauteur enregistrée) | `%PDF-`, page A4 (`MediaBox` 595 × 842 pt), **7 pages** (une carte jamais coupée ; 6 en flux continu) | 8 |
| E13c | Même route : parcours du texte des widgets | `fontSize × PRINT_SCALE ≥ 8` pour chaque élément contenant du texte | 8 |
| E14 | Régression : e2e GH74, GH69 (matrice), GH93, GH125 (sélecteurs dans l'en-tête), GH65, GH67 relancés | inchangés | 11 |

Cas limites couverts par les unitaires : valeurs non numériques, `null`, absence de clé, zone étroite.

## 3. À tester à la main (non couvert par les tests automatiques)

1. **Desktop (Electron)** : exporter un dashboard en PDF depuis l'application de bureau ; vérifier échelle
   (la grille occupe la largeur utile), marges de 10 mm, aucune carte coupée. Le chemin Electron n'a que des
   tests unitaires sur ses options (`e2e-desktop` non lancé : ciblé seulement).
2. **Impression papier** réelle d'un dashboard chargé (lisibilité des légendes à 8 px).
3. **Ressenti du glissement** : fluidité sur un dashboard de 10 graphiques ; thème sombre ; légende en bas.
4. **Thèmes clair / sombre** : repère des poignées et message « trop petit » lisibles.
5. **Langue anglaise** : libellés des poignées, message, texte de la modale.

## 4. Commandes de vérification

- Niveau 1 : `pnpm typecheck`, `pnpm lint`, `npx vitest run <fichiers touchés>`.
- Niveau 2 (fin de sprint) : `pnpm test` ; `pnpm build:web` puis `npx playwright test e2e-web/gh435-` (chemin
  complet) et les specs voisines `e2e-web/gh74-`, `gh125-`, `gh93-`, `gh69-`, `gh65-`, `gh67-`, `s4-print`.
- Niveau 3 (après le « Validé ») : suite e2e complète en arrière-plan, requise (renderer, services du main,
  serveur web).
