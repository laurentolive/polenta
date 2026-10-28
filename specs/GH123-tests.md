# GH123 — Scénarios de test

Spec : `specs/GH123.md` — design : `specs/GH123-design.md`.

## Unitaires (`layout/sidebarCollapse.test.ts`, vitest)

| # | Cas | Attendu |
|---|-----|---------|
| U1 | `loadSidebarCollapsed` clé absente | `false` |
| U2 | clé `"1"` | `true` |
| U3 | clé `"0"`, `"true"`, `"x"` | `false` |
| U4 | `localStorage.getItem` lève | `false`, pas d'exception |
| U5 | `saveSidebarCollapsed(true)` puis `(false)` | `"1"` puis clé supprimée |
| U6 | `isSidebarToggleShortcut` Ctrl+b, Ctrl+B (Caps Lock), Cmd+b sur macOS, touche physique B sur disposition non latine | `true` |
| U7 | b seul, Ctrl+Shift+B, Ctrl+Alt+B, Ctrl+N, Ctrl+B sur macOS, Cmd+B hors macOS | `false` |
| U8 | Ctrl+B avec `defaultPrevented` ou en auto-répétition | `false` |
| U9 | Ctrl+B cible `INPUT`, `TEXTAREA`, `SELECT`, `isContentEditable`, descendant d'un `[contenteditable]` | `false` |
| U10 | Ctrl+B cible `BUTTON`, `DIV`, `null` | `true` |

## e2e (`e2e-web/gh123-sidebar-collapse.spec.ts`)

Avant chaque test : clé `polenta.sidebarCollapsed` supprimée, rechargement, projet ouvert sur Exigences.

| # | Scénario | Attendu |
|---|----------|---------|
| E1 | Clic sur Exigences (actif) | `[data-testid=sidebar]` masqué, poignée absente, URL identique, `aria-expanded="false"` ; la zone `main` est plus large qu'avant |
| E2 | Puis reclic sur Exigences | Panneau visible, même largeur qu'avant le repli, URL identique, `aria-expanded="true"` |
| E3 | Replié, clic sur Version | Route `/graph`, panneau Version visible |
| E4 | Ctrl+B sur le corps de page, deux fois | replié puis déplié |
| E5 | Ctrl+B dans un champ richtext d'une exigence en édition | texte mis en gras, panneau toujours visible |
| E6 | Ctrl+B dans le champ de recherche du panneau Recherche | panneau toujours visible |
| E7 | Replié, rechargement | toujours replié ; clé `"1"` |
| E8 | Replié, ouverture d'un autre onglet (TabBar) pointant vers une autre vue | reste replié, le bouton actif suit la route |
| E9 | Clic Compte → panneau Compte ; reclic Compte → replié ; Ctrl+B | panneau déplié, affiche le panneau de la route (Exigences), pas Compte |
| E10 | Panneau Version : saisir un message de commit, replier, déplier | message toujours présent (pas de démontage) |

## Cas limites

| # | Cas | Attendu |
|---|-----|---------|
| L1 | Sans projet ouvert, clic sur une icône grisée (replié et déplié) | aucun effet |
| L2 | Sans projet, Ctrl+B | bascule (écran d'accueil) |
| L3 | Largeur modifiée par la poignée, repli, dépli | largeur conservée ; `polenta.sidebarWidth` inchangée |
| L4 | Clé `polenta.sidebarCollapsed` = `"garbage"` | démarrage déplié |

## Non-régression

- Suite e2e complète verte (`pnpm --filter @polenta/desktop test:e2e:web`), en particulier
  `gh56-activity-bar.spec.ts` (drag & drop, clic droit) et toutes les specs utilisant `openView`.
- `pnpm test` vert ; typecheck sans nouvelle erreur.

## Manuel (Electron)

- M1 : Ctrl+B dans l'application desktop bascule le panneau ; aucun conflit avec le menu natif.
