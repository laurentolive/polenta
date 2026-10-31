# GH237 — Scénarios de test

## Unitaires

- U1 `stepZoom` : 1 → in → 1,1 ; 1 → out → 0,9 ; 3 → in → 3 ; 0,5 → out → 0,5 ; tout → reset → 1.
- U2 `normalizeZoomFactor` : `undefined`, `"abc"`, `NaN` → 1 ; `7` → 3 ; `0,1` → 0,5 ; `1,12` → 1,1.
- U3 `AppSettingsService` : `set({ zoomFactor: 1.25 })` persiste ; relu identique ; `set({ zoomFactor: 1 })`
  supprime la clé ; fichier avec `zoomFactor: "abc"` → absent de `get()` ; `7` → 3.
- U4 `zoomShortcutAction` : Ctrl+`=`, Ctrl+`+`, Ctrl+NumpadAdd → in ; Ctrl+`-`, Ctrl+NumpadSubtract → out ;
  Ctrl+`0`, Ctrl+Numpad0, Ctrl+Digit0 (`à`, AZERTY) → reset ; `=` sans Ctrl, Ctrl+Alt+`=`, Ctrl+B → null ;
  macOS : Cmd requis, Ctrl seul → null.

## E2E desktop (`e2e-desktop/gh237-zoom.spec.ts`)

- E1 Ctrl+`=` ×2 → facteur 1,25 (`webContents.getZoomFactor()`), bulle « 125 % » visible avec Réinitialiser.
- E2 Ctrl+`-` depuis 1,25 → 1,1 ; Ctrl+`0` → 1, bulle sans Réinitialiser ; clic Réinitialiser à 0,9 → 1.
- E3 Persistance : régler 1,5, relancer avec le même profil → fenêtre à 1,5 dès le premier chargement ;
  revenir à 1 → `app-settings.json` sans `zoomFactor`.
- E4 Bulle masquée ~1,5 s après le dernier changement.

## Manuels (non automatisables)

- M1 Ctrl+molette / pincement trackpad : un palier par cran, dans les deux sens.
- M2 Éditeur draw.io et visionneuse plein écran : Ctrl+molette et Ctrl+`+`/`-` zooment le diagramme,
  pas l'application.
- M3 Ctrl+molette au-dessus d'un diagramme en lecture (Vue Word) : zoome l'application.
- M4 Export PDF d'un document à 200 % : identique à 100 %.
- M5 Clavier AZERTY : Ctrl+`=`, Ctrl+`-` (touche 6), Ctrl+`0` (touche à).
- M6 Raccourcis existants intacts : F12, Ctrl+T, Ctrl+W, Ctrl+B, Alt+←/→, Ctrl+Entrée.
