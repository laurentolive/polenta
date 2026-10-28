# GH123 — Sprint 1 (unique) : panneau latéral masquable

Spec `specs/GH123.md`, design `specs/GH123-design.md`, scénarios `specs/GH123-tests.md`.

## Fichiers modifiés

| Fichier | Modification |
|---------|--------------|
| `apps/desktop/src/renderer/components/layout/sidebarCollapse.ts` *(nouveau)* | Préférence `polenta.sidebarCollapsed`, `isEditableTarget`, `isSidebarToggleShortcut` |
| `apps/desktop/src/renderer/components/layout/sidebarCollapse.test.ts` *(nouveau)* | U1–U10 |
| `apps/desktop/src/renderer/components/layout/AppLayout.tsx` | État replié, bascule sur reclic du panneau actif, écoute Ctrl+B, poignée masquée |
| `apps/desktop/src/renderer/components/layout/Sidebar.tsx` | Prop `collapsed` → `hidden`, `data-testid="sidebar"` |
| `apps/desktop/src/renderer/components/layout/ActivityBar.tsx` | Prop `sidebarCollapsed`, `aria-expanded` sur le bouton actif |
| `apps/desktop/e2e-web/support/session.ts` | `openView` ne replie jamais le panneau |
| `apps/desktop/e2e-web/gh123-sidebar-collapse.spec.ts` *(nouveau)* | E1–E10, L3–L4 |
| `specs/SPEC-ELECTRON-DESKTOP.md`, `specs/SPEC-INDEX.md` | Voir § Mises à jour SPEC |

## Comportement implémenté

Conforme à la spec : reclic sur le bouton actif ou Ctrl+B (Cmd+B sur macOS) replie/déplie, sans
navigation ; clic sur un autre panneau navigue et déplie ; état mémorisé par poste ; panneau masqué
en CSS (pas démonté).

## Divergences par rapport au design

Ajouts issus de la revue de code, tous dans `isSidebarToggleShortcut` :
- **macOS** : `Cmd+B` seul (Ctrl+B y est « curseur en arrière ») ; hors macOS, `Ctrl+B` seul.
  Plateforme détectée par `navigator.platform` (`IS_MAC`), injectable pour les tests.
- **Auto-répétition** (`e.repeat`) ignorée : garder la touche enfoncée ne fait pas clignoter le panneau.
- **Touche physique** (`code === 'KeyB'`) acceptée en plus de `key`, pour les dispositions non latines.

E5 crée sa propre exigence (l'autosave enregistrerait sinon la saisie dans une exigence de la démo).

## Revue de code — points écartés

- `openView` ne re-navigue plus vers la route par défaut quand la vue est déjà active : aucun test
  n'en dépend (t173 passe par une autre vue entre deux appels), suite verte.
- Ctrl+B pendant une modale bascule le panneau derrière : sans conséquence, non traité.
- Panneaux masqués toujours montés (requêtes actives) : identique à avant GH123, où le panneau était
  toujours monté et visible.
- Ctrl+Z/Y/S dans l'éditeur richtext déclenchent aussi l'annulation globale de l'arbre : bug antérieur,
  **issue #152**.

## Tests

- `pnpm typecheck` : 0 erreur. `pnpm test` : 751 + 38 passés.
- e2e : `gh123-sidebar-collapse.spec.ts` 9/9, `gh56-activity-bar.spec.ts` 10/10. Suite complète :
  135 passés, 13 ignorés, 1 échec `gh77-history` H4 (+ B8 non exécuté, mode série), qui passe seul et
  ne touche pas l'ActivityBar — intermittent, sans lien.
- **Build web** : en échec sur une installation propre de `main` depuis GH120 (`@aws-sdk/client-s3`
  non résolu, #128 / #131, correctif PR #132 non mergé). Les e2e ont été lancés avec ce correctif
  appliqué localement **sans le committer**.
- Non couverts en e2e : L1/L2 (sans projet ouvert), M1 (Electron, manuel).

## Mises à jour SPEC

- `SPEC-ELECTRON-DESKTOP.md` §19.2 : règle « recliquer le panneau actif re-navigue » remplacée ;
  nouveau bloc « Panneau latéral masquable (GH123) ».
- `SPEC-INDEX.md` : ligne §19.1–§19.3, description et mots-clés complétés, MAJ → GH123.

## Tester manuellement

1. Ouvrir la démo, vue Exigences : recliquer « Exigences » → panneau masqué ; recliquer → réaffiché.
2. Replié, cliquer « Version » → graphe affiché, panneau déplié.
3. `Ctrl+B` hors champ → bascule ; dans un champ richtext → gras, panneau inchangé.
4. Replier, relancer l'application → toujours replié.
5. Desktop (Electron) : `Ctrl+B` bascule le panneau, sans conflit avec le menu natif (M1).
