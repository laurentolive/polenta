# GH435 — Sprint 2 : flux responsive, poignées, enregistrement, modale

Périmètre (design § 1) : mise en page en flux, poignées de redimensionnement à la souris, enregistrement
au relâchement avec retour arrière en cas d'échec, remise au défaut, modale. Les graphiques ne sont pas
encore redessinés à la taille de leur carte (sprint 3) ; les tableaux gardent la hauteur de 256 px par défaut.

## Fichiers modifiés

| Fichier | Changement |
|---------|-----------|
| `renderer/hooks/useElementSize.ts` (nouveau) | taille d'un élément par `ResizeObserver`, référence « callback », mise à jour plafonnée par intervalle |
| `renderer/components/dashboard/ResizeHandle.tsx` (nouveau) | poignée du bord droit / du bas : capture du pointeur, une mise à jour par frame, valeur finale au relâchement, double-clic = défaut, verrou du glisser de carte |
| `renderer/components/dashboard/WidgetSlot.tsx` (nouveau) | emplacement d'un widget dans le flux : largeur affichée, taille « en cours de glissement » conservée jusqu'à la relecture, poignées |
| `renderer/components/dashboard/DashboardGrid.tsx` | grille 4 colonnes remplacée par un flux (`flex-wrap`), `SIZE_SPAN` supprimé, zone observée, `WidgetSlot`, hauteur de carte en `style` (plus de `h-64`) |
| `renderer/routes/dashboard.tsx` | mutation d'enregistrement d'une dimension (promesse résolue après relecture), bandeau d'erreur |
| `renderer/components/dashboard/WidgetConfigModal.tsx` | autre préréglage → `width: null, height: null` ; rappel de la taille personnalisée |
| `renderer/i18n/locales/fr.json`, `en.json` | libellés des poignées, erreur d'enregistrement, taille personnalisée, message « trop petit » (utilisé au sprint 3) |
| `e2e-web/gh435-widget-size.spec.ts` (nouveau) | 11 scénarios (E1, E1b, E2, E2b, E3, E8 à E12, E5b partie 1) |

## Comportement implémenté

- Les cartes se placent en flux ; largeur affichée = largeur demandée bornée par la zone (minimum 240 px),
  pleine largeur sous 640 px de zone ; la largeur enregistrée n'est jamais modifiée par la fenêtre.
- Deux poignées visibles en permanence sur chaque carte modifiable (`widget-resize-w` à droite,
  `widget-resize-h` en bas). Pendant le glissement la carte suit le pointeur, bornée (240 à 1104 / zone ;
  160 à 720) ; valeur arrondie et enregistrée au relâchement (un seul appel). Un clic sans mouvement
  n'écrit rien. La poignée de largeur est masquée en zone étroite (rien à régler).
- La taille glissée reste appliquée jusqu'à la fin de la relecture du dashboard : pas de saut au retour du
  serveur. Échec d'écriture : la carte revient à la taille enregistrée et `widget-size-error` s'affiche.
- Double-clic sur une poignée : la dimension revient au défaut (clé retirée du fichier).
- Saisir une poignée ne déplace pas la carte (verrou du glisser, comme les sélecteurs GH125) ; le
  réordonnancement par l'en-tête fonctionne comme avant.
- Aucune poignée sur un dashboard en lecture seule (format plus récent) ni à l'impression.
- Modale : un autre préréglage remet les dimensions au défaut ; enregistrer sans y toucher les conserve ;
  « Taille personnalisée : 700 × 320 px » est rappelé sous les boutons de taille.

## Divergences par rapport au design

- La poignée de largeur est masquée quand la zone est plus étroite que 640 px (non prévu au design) : en
  zone étroite toutes les cartes sont pleine largeur, la poignée ne réglerait rien.
- `WidgetSlot` reçoit les enfants par fonction (`children({ height, resizing })`) plutôt que d'être un simple
  conteneur : la carte a besoin de la hauteur « en cours de glissement ».

## Mises à jour SPEC

Reportées au sprint 4 (dernier sprint).

## Vérifications

- `pnpm typecheck` : 0 erreur. ESLint sur les fichiers touchés : 0 erreur.
- E2E du ticket (`e2e-web/gh435-widget-size.spec.ts`) : **11 / 11**.
- E2E voisins relancés (GH74 édition et suivi, GH93, GH125, GH67, GH69, GH65 navigation, GH389 misc,
  impression S4) : **44 / 44**, sans changement.
- Unitaires (`apps/desktop`, `npx vitest run`) : 243 fichiers, 2350 tests passés, 5 ignorés.
- Niveau 3 (suite e2e complète) : non lancé, il attend le « Validé ».

## Comment tester manuellement

Ouvrir un dashboard (Suivi), tirer le bord droit puis le bord bas d'un widget : la carte suit la souris, la
valeur est enregistrée au relâchement (visible dans `dashboards/DASHBOARD-xxxx/dashboard.yaml`) ; fermer et
rouvrir : même taille. Double-clic sur une poignée : retour au défaut. Réduire la fenêtre : les cartes passent à
la ligne, puis en pleine largeur sous 640 px. Les graphiques ne sont redessinés qu'au sprint 3.
