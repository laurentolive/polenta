# GH56 — Sprint 1 (unique)

## Fichiers modifiés

- `apps/desktop/src/renderer/components/layout/activityBarLayout.ts` (nouveau) — préférence `polenta.activityBarLayout`, `applyOrder`, `hiddenSet`, `movePanel`, `toggleHidden`.
- `apps/desktop/src/renderer/components/layout/activityBarLayout.test.ts` (nouveau) — U1–U9.
- `apps/desktop/src/renderer/components/layout/ActivityBarMenu.tsx` (nouveau) — menu contextuel.
- `apps/desktop/src/renderer/components/layout/ActivityBar.tsx` — drag & drop, clic droit, `aria-disabled`, badge dans un wrapper `mt-auto`.
- `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` — `layout.activityBar.menu.{hide,reset}`.
- `apps/desktop/vitest.config.ts` — inclut `src/renderer/**/*.test.ts`.
- `apps/desktop/e2e-web/gh56-activity-bar.spec.ts` (nouveau) + ligne dans `e2e-web/README.md`.
- `specs/SPEC-ELECTRON-DESKTOP.md`, `specs/SPEC-INDEX.md`.

## Comportement implémenté

Conforme à `specs/GH56.md` : réordonnancement par drag & drop (boutons grisés compris), menu clic droit
(« Masquer « X » », liste à cocher, Compte/Projet verrouillés, « Réinitialiser la disposition »), fermeture
par clic extérieur/Échap, persistance par poste commune aux projets, badge de mise à jour hors personnalisation.
Le menu est borné verticalement pour rester dans la fenêtre.

## Divergences par rapport au design

- Le menu bloque le `contextmenu` sur lui-même (sinon un clic droit dans le menu, enfant DOM de la barre,
  le rouvrait ailleurs).
- `ActivityBarMenu` affiche « Masquer » via `role="menuitem"` et les panneaux via `role="menuitemcheckbox"`.

## Vérifications

- `tsc --noEmit` : 0 erreur. `pnpm test` : 172 + 34 tests OK (dont U1–U9).
- e2e web `gh56-activity-bar.spec.ts` : 10/10 (E1–E7, L1–L3, L5, L6).
- `/code-review` (low) : un point — masquer le panneau actif ne change pas de vue ; comportement voulu (spec, L2), non corrigé.
- Non lancés : les autres fichiers e2e (le sélecteur `activityBar()` — classes `w-12 h-12` + `title` — est inchangé).

## Mises à jour SPEC

- `SPEC-ELECTRON-DESKTOP.md §19.1` — ligne « Activity bar » : renvoi vers la personnalisation.
- `SPEC-ELECTRON-DESKTOP.md §19.2` — nouveau bloc « Personnalisation (GH56) » (préférence, drag & drop, menu, cas limites).
- `SPEC-INDEX.md` — ligne §19.1/§19.3 étendue à §19.2, mots-clés ajoutés, MAJ → GH56.

## Tester manuellement

1. Glisser un bouton de la barre de gauche sur un autre : trait d'insertion, nouvel ordre conservé au redémarrage.
2. Clic droit sur un bouton → « Masquer » ; clic droit sur la zone vide → recocher ; « Réinitialiser la disposition ».
3. Compte/Projet : grisés dans le menu, non masquables.
4. Sans projet ouvert : les boutons grisés se déplacent mais ne naviguent pas.
5. Restants manuels (`GH56-tests.md`) : L4 clic droit sur le badge de mise à jour (pas de menu), L7 fenêtre courte, L8 client desktop Electron.
