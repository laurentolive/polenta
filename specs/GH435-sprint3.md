# GH435 — Sprint 3 : rendu adapté à la carte, « trop petit », infobulles, tableaux

Périmètre (design § 1) : le graphique occupe le corps de sa carte et se redessine à chaque changement de
taille, légende placée d'après la taille, message « trop petit » à la place d'un tracé coupé, infobulles sur les
libellés tronqués, tableau natif ajusté à son contenu. Vérifié sur le même build que le sprint 4 (un seul
`pnpm build:web` pour les deux).

## Fichiers modifiés

| Fichier | Changement |
|---------|-----------|
| `renderer/components/dashboard/vegaFit.ts` (nouveau) | `fitSpec` (place et limites de légende, limites des axes nominaux, clés de l'utilisateur jamais remplacées), `measureChart` / `isTooSmall` (tracé < 48 px ou légende qui dépasse de la vue) |
| `renderer/components/dashboard/VegaView.tsx` | taille observée (`useElementSize`, 120 ms), spec à `width` / `height` numériques, **second passage `view.resize()`**, rendu hors écran puis remplacement d'un coup, « trop petit », infobulles des libellés tronqués, clic ignoré sur légende / axes / titre |
| `renderer/components/dashboard/vegaTheme.ts` | `themeConfig(resolve, minFont)` : police des axes et légendes paramétrable (10 px à l'écran) |
| `renderer/components/dashboard/widgets/WidgetRenderer.tsx`, `WidgetEmptyState.tsx`, `ResultTable.tsx` | chaîne en colonne flex (`flex-1 min-h-0`) du corps de carte jusqu'au défilement de la grille |
| `renderer/components/dashboard/DashboardGrid.tsx` | hauteur automatique (`minHeight` 160 / `maxHeight` 720) quand la carte n'a pas de hauteur ; corps de carte en colonne flex ; infobulle du titre seulement s'il est tronqué |
| `renderer/components/dashboard/WidgetSlot.tsx` | hauteur `undefined` pour un tableau natif sans hauteur enregistrée |
| `renderer/components/dashboard/WidgetConfigModal.tsx` | aperçu en colonne flex (même chaîne de taille que la carte) |
| `e2e-web/gh435-rendering.spec.ts` (nouveau) | E4, E4b, E5, E5c, E5b (partie 2), E6, E7, E14 (+ E13, E13b du sprint 4) |
| tests unitaires | `vegaFit.gh435.test.ts` (18, dont la mesure sur une vue Vega sans navigateur), `vegaTheme.gh435.test.ts` (2) |

## Comportement implémenté

- Le graphique reçoit la taille réelle du corps de sa carte (plus de `− 40`), se redessine quand la carte, la
  fenêtre ou le panneau latéral changent la taille (au plus ~8 redessins par seconde pendant un glissement, le
  dernier toujours appliqué) et ne clignote plus : chaque rendu se fait hors écran puis remplace le précédent.
- Légende : à droite si elle tient dans 40 % de la largeur et dans la hauteur, sinon en bas en colonnes ;
  `labelLimit` selon la place, `symbolLimit: 0` (plus de limite à 30 entrées). Axes nominaux : libellé borné
  (40 % de la largeur sur y, 35 % de la hauteur sur x). Clés `legend` / `axis` de la spec jamais remplacées.
- 9 séries de 34 caractères : libellés entiers et rien hors de la carte en `md` et `lg` ; en `sm`, message
  « Widget trop petit pour ce graphique — agrandissez-le » (`widget-too-small`) au lieu d'un tracé coupé.
- Libellé de légende ou d'axe tronqué par Vega : infobulle avec le texte entier. Titre de widget : infobulle
  seulement s'il dépasse (test sur `scrollWidth`).
- Tableau natif sans hauteur enregistrée : la carte s'ajuste à ses lignes (8 lignes en entier, sans défilement ;
  jamais sous 160 px, jamais au-dessus de 720 px, puis le tableau défile). Avec `height` : hauteur fixe. Tirer la
  poignée du bas d'un tableau automatique part de sa hauteur courante ; le double-clic revient à l'automatique.

## Divergences par rapport au design

- **Second passage de mise en page (nouveau, constaté dans Chromium).** Le design attribuait la légende coupée
  à la règle de Vega « une légende ne compte que dans sa dimension orthogonale ». Premier essai : « trop petit »
  affiché même en `lg`. Un script de contrôle (Chromium + Vega réels, avec et sans adaptation) a montré que
  `autosize: fit` ne calcule sa mise en page qu'une fois, au premier passage, quand la source `rows` est encore
  vide : légende et libellés d'axe n'existent pas encore, rien n'est réservé. Correctif : `view.resize()` après
  l'injection des lignes. Spec § 1 et design § 4.5 corrigés.
- La structure en colonne flex de la carte (corps, enveloppe du tableau, `ResultTable`) remplace les
  `h-full` : un pourcentage de hauteur ne se résout pas dans une carte à hauteur automatique, un enchaînement
  de `flex-1 min-h-0` si (aussi dans l'aperçu de la modale).
- Test E5 : la hauteur fixe est de 200 px (et non 300) pour que les 8 lignes défilent.

## Mises à jour SPEC

Reportées au sprint 4 (dernier sprint) : `SPEC-DASHBOARDS.md` § 6.1, § 7.0, § 10.

## Vérifications

Voir `GH435-sprint4.md` (les deux sprints sont vérifiés sur le même build).

## Comment tester manuellement

Dashboard *Pilotage LL800* : agrandir / réduire un graphique par ses poignées (la légende se déplace en bas
quand la largeur manque), réduire une carte au minimum (message « trop petit »), ouvrir / fermer le panneau
latéral (le graphique suit), survoler un titre tronqué dans une carte de 240 px. Un widget tableau de quelques
lignes s'ajuste à son contenu.
