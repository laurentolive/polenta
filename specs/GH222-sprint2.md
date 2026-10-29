# GH222 — Sprint 2 : mise en évidence des différences

Spec : `specs/GH222.md` §5, §6 · Design : `specs/GH222-design.md` §4.

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `apps/desktop/src/renderer/theme.config.ts`, `index.css`, `tailwind.theme.generated.js`, `scripts/generate-theme-css.ts` | jetons `diff-*` (clair / sombre, fonds opaques) et couleurs Tailwind `diff-*` ; `.diff-del` / `.diff-ins` / `.diff-media-*` sur ces jetons ; classe `.diff-hatch` |
| `apps/desktop/package.json`, `pnpm-lock.yaml` | `@codemirror/merge` 6.12.2 (MIT) |
| `components/diffkit/OverviewRuler.tsx` | **nouveau** — règle de vue d'ensemble cliquable |
| `components/diffkit/useChangeNavigation.ts`, `NavBar.tsx` | **nouveaux** — précédent / suivant, compteur, `F7` / `Maj+F7` / `Alt+↓↑` |
| `components/diffkit/cmDiff.ts` | **nouveau** — habillage CodeMirror du diff (jetons, hachures, régions repliées), bloc courant |
| `components/diff/RawDiffView.tsx` | **nouveau** — Raw des vues de diff : `MergeView` (côte à côte) / `unifiedMergeView` (en ligne) |
| `components/diff/FileDiffView.tsx` | Raw sur `RawDiffView`, bascule Côte à côte / En ligne, navigation dans le sous-en-tête, compteurs `+n / −m` par `lib/diffStats.ts` |
| `components/diff/LineDiffView.tsx`, `lib/lineDiff.ts` | **retirés** (diff LCS plafonné à 2 000 lignes) |
| `components/diff/ObjectDiffView.tsx`, `StepsDiff.tsx` | fonds `diff-*` (plus d'opacité 15 % en sombre) |
| `lib/diffPrefs.ts` | préférence `layout` |
| `components/merge/RawPane.tsx` | côtés : changements depuis l'ancêtre ligne **et caractères** ; actions dans les panneaux gauche / droite ; sortie : « Prendre les deux », bloc résolu marqué + « Réinitialiser » ; règle de vue d'ensemble ; bloc courant |
| `components/merge/blockLocator.ts` | **nouveau** — blocs situés dans les côtés et dans la sortie (résolu : gauche / droite / les deux) |
| `components/merge/FileResolver.tsx` | branchement des actions, navigation des conflits (raw et rendu), `F7` → fichier suivant |
| `components/merge/MergeResolvePage.tsx` | liste : conflits restants et blocs repris par fichier |
| `i18n/locales/{fr,en}.json` | libellés |
| tests | `lib/diffTokens.test.ts`, `merge/blockLocator.test.ts`, `e2e-web/gh222-raw.spec.ts` ; `gh178-diff-rendered.spec.ts` adapté (sélecteurs Raw) |

## Comportement implémenté

- **Diff Raw** : fond plein des lignes changées, caractères changés en couleur soutenue (barrés
  côté Avant), barre colorée dans la gouttière, alignement hachuré en face d'un ajout / retrait,
  régions inchangées repliées (3 lignes de contexte), plus de troncature à 2 000 lignes.
  Côte à côte ou en ligne, mémorisé.
- **Navigation** : compteur « Changement n / N », boutons, `F7` / `Maj+F7` (ou `Alt+↓` / `Alt+↑`
  hors champ éditable), bloc courant en relief ; règle de vue d'ensemble cliquable.
- **Résolution Raw** : chaque panneau du haut montre ce que son côté a changé depuis l'ancêtre ;
  « Prendre gauche » / « Prendre droite » au-dessus du bloc dans son panneau ; dans la sortie :
  gauche · droite · les deux (seulement quand c'est sensé), un bloc résolu est marqué
  « ✓ Résolu : … » avec « Réinitialiser » ; navigation « Conflit n / N » ; après le dernier,
  `F7` ouvre le fichier suivant à résoudre.
- **Liste des fichiers en conflit** : « N conflits » restants, « N repris ».

## Divergences par rapport au design

- Panneau Version : les lettres `A` / `M` / `D` colorées existaient déjà ; les compteurs `+n / −m`
  par fichier n'y sont **pas** ajoutés (il faudrait lire et comparer chaque fichier de la liste) —
  ils restent dans le sous-en-tête du diff ouvert.
- Mode Rendu existant (exigence / test) : seulement les nouvelles couleurs à ce sprint ; règle,
  navigation et hachures du Rendu arrivent avec la vue générique (sprints 3 et 4).
- « Réinitialiser » repère le texte retenu dans la sortie : un bloc retouché à la main n'est plus
  reconnu comme résolu et ne peut pas être réinitialisé (il reste éditable).

## Revue de code

`/code-review` (medium) : 10 constats, tous corrigés —
- boutons des widgets CodeMirror résolus au clic dans les props courantes (plus de gestionnaire
  périmé gardé par `eq`) ;
- bloc résolu et fragments des côtés repérés au plus près de la ligne de leur région (un fragment
  court comme `status: draft` peut exister ailleurs) ;
- navigation remise à zéro quand la liste change (conflit résolu, autre fichier) ;
- `F7` sans effet sur un fichier à choix de côté ;
- diff des côtés avec la même limite que la vue de diff (`DIFF_CONFIG`) ;
- actions des côtés recalculées seulement quand l'ensemble des blocs ouverts change, blocs résolus
  et « les deux » calculés sur le document courant ;
- bloc courant effacé quand la sortie est remplacée ;
- règle de vue d'ensemble : pas de re-rendu quand rien n'a bougé ;
- libellé « Conflits » pour la règle de la sortie.

Pendant les e2e : la vue Raw de `MergeView` regroupait les changements éloignés d'un gros fichier en
un seul bloc (limite de 500 caractères du diff précis) → `DIFF_CONFIG` (`scanLimit` 50 000, budget
1 s), partagé par la vue, les compteurs et les panneaux de merge.

## Régression trouvée et corrigée en e2e

`theme:generate` réécrit tout le bloc des variables de `index.css` depuis `theme.config.ts`. Les
couleurs `--chart-progress-*` (GH71, étapes d'avancement des campagnes) avaient été ajoutées à la
main dans ce bloc sans être déclarées dans `theme.config.ts` : régénérer le thème pour les jetons
`diff-*` les a effacées et les graphiques du Suivi (seed Campagnes) ne s'affichaient plus
(e2e gh65, gh71, gh74, gh93). Elles sont maintenant déclarées dans `theme.config.ts` (mêmes valeurs),
et `themeTokens.gh222.test.ts` vérifie que toute variable `var(--…)` de la bibliothèque de
dashboards est un jeton déclaré.

Les e2e du client web utilisent des ports fixes (8796–8799) : une exécution lancée par une autre
session dans un autre worktree (GH224) en même temps a faussé un premier passage complet.
gh169 (Vue Excel) et gh63 (exports admin) échouent aussi sur `main` : sans lien avec ce ticket.

## Tests

- Unitaires : contraste des jetons `diff-*` (44 cas, clair / sombre), repérage des blocs (6),
  jetons de la bibliothèque de dashboards déclarés (1).
- e2e : `gh222-raw.spec.ts` (H1–H11 sauf H12 unitaire) ; GH178 adaptés. G8 (`gh178-diff-detail`)
  lisait les pages `.drawio` avant leur chargement asynchrone : attente ajoutée.

## Comment tester manuellement

1. Panneau Version → un fichier modifié → Raw : lignes pleines, mots surlignés, règle à droite,
   `F7`. Basculer « En ligne ». Passer en thème sombre.
2. Créer un conflit (deux branches modifiant la même valeur d'un YAML) → Résoudre les conflits →
   Raw : surlignage par côté, « Prendre gauche » dans le panneau de gauche, « Prendre les deux »,
   « Réinitialiser », `F7`.
