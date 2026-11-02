# GH238 — Sprint 1 (unique) : terminal Git Bash des vues Version

Spec : `specs/GH238.md` · Design : `specs/GH238-design.md` (écarts : §6) · Tests : `specs/GH238-tests.md`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `apps/desktop/package.json`, `pnpm-lock.yaml` | `node-pty` 1.1.0, `@xterm/xterm` 6.0.0, `@xterm/addon-fit` 0.11.0 (MIT) |
| `apps/desktop/electron-builder.config.ts` | `**/node_modules/node-pty/**` dans `asarUnpack` |
| `src/main/services/terminal-shell.util.ts` (+ test) | Détection de Git Bash, environnement du shell, commande `cd` |
| `src/main/services/terminal.service.ts` | Sessions de pseudo-terminal (start / write / cd / resize / kill, winget) |
| `src/main/index.ts` | Création du service, `killAll` à `will-quit` |
| `src/main/ipc/desktop-only.handlers.ts`, `channels.ts` | Canaux `terminal:*`, sessions tuées au rechargement du webContents |
| `packages/types/src/app.ts`, `packages/api-client/src/{types,ipc-client}.ts` | `TerminalDetectResult`, `TerminalKind`, `api.terminal` |
| `src/renderer/components/terminal/terminalShortcut.ts` (+ test) | Raccourci, routes Version, `QuietRefresh` |
| `src/renderer/contexts/TerminalContext.tsx` | Session, xterm, raccourci global, rafraîchissement, thème |
| `src/renderer/components/terminal/TerminalPanel.tsx` | Panneau bas : poignée, en-tête, xterm, état « introuvable », menu contextuel |
| `src/renderer/components/layout/AppLayout.tsx` | `TerminalProvider` (sous `SelectedRepoProvider`), `TerminalPanel` sous `<main>` |
| `src/renderer/components/sidebar/VersionPanel.tsx` | Bouton Terminal du header |
| `src/renderer/i18n/locales/{fr,en}.json` | Clés `terminal.*`, `sidebar.version.terminal` |
| `e2e-desktop/gh238-terminal.spec.ts` | E1–E7 |

## Comportement

Conforme à la spec. Écarts de conception (ConPTY de Windows, canal `terminal:cd`, sessions liées
au webContents, `QuietRefresh` réarmable) : `GH238-design.md` §6.

## Vérifications

- Typecheck `apps/desktop` : 0 erreur.
- Unitaires : 1056 / 1056 (dont 11 `terminal-shell.util`, 8 `terminalShortcut`, `channel-policy`).
  `integration-branch.service.test.ts` T-01 a échoué une fois sous charge de la suite complète,
  vert seul et au passage suivant (sans lien avec GH238).
- E2E desktop `pnpm test:e2e:desktop -g GH238` : 7 / 7, stable sur plusieurs passages (E1 Ctrl+ù
  et `pwd`, E2 `git add` → Stagés sans action, E3 masquer / quitter / revenir, E4 `exit` + Entrée,
  E5 Tuer pendant `sleep`, E6 bouton du header, E7 rechargement sans orphelin).
- Build packagé (`pnpm package`) : node-pty extrait dans `app.asar.unpacked` ; le terminal
  démarre depuis `dist/win-unpacked` (voir ci-dessous).
- `/code-review` : 10 remarques ; corrigées — échec de `detect` non géré, PID réattribué par
  `taskkill`, shells orphelins au rechargement, rafraîchissement manqué après une pause, page de
  téléchargement ouverte après « Tuer » sur winget, ré-attachement de xterm, message français codé
  en dur côté main. Non retenues : garde client web (abandonné), `cd` tapé dans un programme au
  premier plan (accepté par la spec), mémoïsation du contexte (coût négligeable).

## Mises à jour SPEC

- `SPEC-ELECTRON-DESKTOP.md` §3 : dépendances `node-pty`, `@xterm/*`.
- `SPEC-ELECTRON-DESKTOP.md` §19.8b : nouvelle sous-section « Terminal Git Bash des vues Version
  (GH238) » (ouverture, cycle de vie, clavier, rafraîchissement, Git absent, main, canaux).
- `SPEC-ELECTRON-DESKTOP.md` §19.13 : `/graph` → mention du terminal.
- `SPEC-TECH-stack.md` §2 : ligne « Terminal des vues Version » ; §9 : ligne « Terminal » (asarUnpack).
- `SPEC-INDEX.md` : MAJ → GH238 pour ces quatre lignes (mots-clés terminal, node-pty, xterm…).
- `SPEC-WEB.md` : inchangé (client web abandonné ; canaux simplement desktop seulement).

## Tester à la main

Depuis `../polenta-official-milestone-C/apps/desktop` : `pnpm dev`, ouvrir un projet, panneau
Version, `Ctrl+ù`. Scénarios manuels M1–M11 de `GH238-tests.md` (pager, `rebase -i`, rebase en
conflit puis `--abort`, `Ctrl+C` avec / sans sélection, repo composant + « Aller à », changement
de projet, redimensionnement pendant `git log --graph`, thème sombre, poste sans Git / winget,
fermeture pendant un `fetch`, build packagé).
