# GH435 — Sprint 4 : impression à l'échelle A4, mises à jour des SPEC, documentation

Périmètre (design § 1) : impression du dashboard (échelle et marges identiques sur le desktop et le web),
cartes jamais coupées entre deux pages, polices lisibles, mises à jour des SPEC, tutoriels, niveau 2 complet.
**Les sprints 3 et 4 sont livrés dans un seul commit** : ils ont été construits et vérifiés ensemble (un seul
`pnpm build:web`, une seule exécution des e2e).

## Fichiers modifiés (sprint 4)

| Fichier | Changement |
|---------|-----------|
| `main/host/print-renderer.ts` | `PDF_LAYOUT_BY_KIND` (seul `dashboard` : `PRINT_SCALE` 0,65, marges de 10 mm), `electronPdfLayout` (pouces), `playwrightPdfLayout` (`'10mm'`) |
| `main/host/electron-pdf.ts`, `web-server/print/headless-print.ts` | passent l'échelle et les marges à `printToPDF` / `page.pdf` pour le dashboard ; les autres exports inchangés |
| `renderer/routes/print.dashboard.tsx` | conteneur de largeur fixe `W` (jamais réduit à la fenêtre), plus de `p-10` ni de `min-h-screen`, variable `--print-min-font` |
| `renderer/components/dashboard/WidgetSlot.tsx` | `break-inside: avoid` en impression |
| `renderer/index.css` | règle `.print-widgets` : texte HTML des cartes relevé à 8 px imprimés |
| `main/host/print-renderer.gh435.test.ts` (nouveau) | U15 : 6 tests |
| `e2e-web/gh435-rendering.spec.ts` | E13 (route d'impression, polices) et E13b (PDF de 13 cartes de 720 px : A4, 7 pages) |
| `specs/SPEC-DASHBOARDS.md`, `SPEC-INDEX.md`, `SPEC-MCP-SERVER.md`, `SPEC-WEB.md`, `SPEC-TECH-stack.md` | voir « Mises à jour SPEC » |
| `docs/tutoriels/07-suivi.md`, `docs/tutorials/07-tracking.md` | un paragraphe sur la taille des widgets et l'impression |

## Comportement implémenté

- Le dashboard est mis en page à sa largeur de référence (1104 px), puis réduit **par le moteur d'impression**
  (option `scale` d'Electron et de Chromium headless) à la largeur utile d'une page A4 (210 − 2 × 10 mm,
  718,1 px) : échelle 0,65, arrondie vers le bas pour que la mise en page (1104,8 px) contienne toujours la
  grille. Aucun `zoom` ni `transform` : Vega, `ResizeObserver` et la pagination restent en pixels normaux.
- Marges de 10 mm sur les deux moteurs (Electron 1 cm par défaut, Chromium headless aucune : ils différaient).
- Une carte n'est jamais coupée entre deux pages : 13 cartes de 720 px donnent 7 pages (2 par page), contre 6
  en flux continu.
- Texte lisible : polices des graphiques à 13 px de mise en page (8,45 px imprimés) ; texte HTML des cartes
  (`text-xs`, `text-[10px]`, `text-[11px]`) relevé par la règle `.print-widgets`. Vérifié par le test E13 sur tous
  les éléments texte (HTML et SVG) : aucun sous 8 px imprimés.

## Divergences par rapport au design

- Le design prévoyait un test d'impression par nombre de pages et par mesure DOM : réalisé (E13, E13b). La
  vérification de l'échelle elle-même est le nombre de pages d'un PDF de contrôle et les tests unitaires des
  options (l'échelle ne se voit pas dans le DOM, puisqu'elle est appliquée par le moteur).
- Le chemin **Electron** n'a que des tests unitaires sur ses options : la suite `e2e-desktop` n'est pas lancée
  (WORKFLOW : ciblée seulement). À essayer à la main (ci-dessous).
- Constat hors périmètre : lecture d'un dashboard pendant son écriture (fichier non écrit de façon atomique) —
  issue #438. Lint de `main` en échec sur 3 erreurs préexistantes — issue #437.

## Mises à jour SPEC

| Fichier | Section | Résumé |
|---------|---------|--------|
| `SPEC-DASHBOARDS.md` | en-tête, § 6.1 (nouveau), § 7.0, § 10 | dimensions, flux, poignées, rendu adapté (dont le second passage `view.resize()`), « trop petit », impression ; format `width?` / `height?` ; hors scope réécrit (T77 réouvert) |
| `SPEC-MCP-SERVER.md` | tableau des outils dashboards | `width` / `height` de `add_widget` et `update_widget` |
| `SPEC-WEB.md` | § 6 (impression) | `scale` 0,65 et marges de 10 mm pour le dashboard |
| `SPEC-TECH-stack.md` | export PDF | échelle et marges passées au moteur |
| `SPEC-INDEX.md` | lignes concernées | colonne `MAJ` → GH435, mots-clés |

## Vérifications

- `pnpm typecheck` : 0 erreur. ESLint sur tous les fichiers modifiés : 0 erreur. `pnpm lint` global : 3 erreurs
  **préexistantes** sur `main` (issue #437).
- Unitaires (`apps/desktop`, `npx vitest run`) : **245 fichiers, 2363 tests passés**, 5 ignorés, obtenus avec
  `--poolOptions.threads.maxThreads=4`. Deux passages complets à 16 threads ont chacun échoué sur **un seul test
  différent** par dépassement des 20 s d'un test git (`demo-conformity` C5, `sync.service.gh173` U8) alors que la
  suite durait 165 s au lieu de 47 s (machine lente, aucun processus parasite) ; chacun passe seul (13/13 et
  22/22) et la suite complète passe à 4 threads. Dépassements de charge, sans rapport avec le ticket ; non
  reproduits sur `main` (non lancé).
- E2E (`pnpm build:web` puis Playwright) : GH435 **22 / 22** (`gh435-widget-size` 12, `gh435-rendering` 10) ;
  voisins (GH74 édition et suivi, GH93, GH125, GH67, GH69, GH65 navigation, GH389 misc, impression S4)
  **44 / 44**. Total du dernier passage, après les corrections de revue : **66 / 66**.
- Revue de code (medium, PR #436) sur les sprints 3 et 4 : 6 remarques, toutes traitées — impression qui
  n'attendait jamais un graphique sans taille (2 remarques « importantes » : annonce de fin de rendu au bout
  de 250 ms de taille stable, widget sans taille rendu tout de suite), fuite d'un rendu hors écran si une
  étape échoue, glissement revenu à son point de départ enregistré à tort (test E1c), légende imposée en haut
  ou en bas mise en colonnes, règle CSS d'impression exprimée en plancher (`max()`).
- Niveau 3 (suite e2e complète) : **non lancé**, il attend le « Validé » (le ticket touche le renderer, les
  services du main et le serveur web : il sera requis).
- Non lancés : `e2e-desktop` (Electron), impression sur papier réel.

## Comment tester manuellement

1. **Poignées** : dashboard *Pilotage LL800*, tirer le bord droit / bas d'un widget ; double-clic sur un bord ;
   réduire la fenêtre (cartes à la ligne, puis pleine largeur sous 640 px de zone).
2. **Graphique** : réduire un graphique jusqu'au minimum (message « trop petit »), l'agrandir ; ouvrir /
   fermer le panneau latéral.
3. **Tableau** : un widget tableau de quelques lignes s'ajuste ; au-delà de 720 px il défile.
4. **Export PDF depuis l'application de bureau** (Electron, non couvert par un test automatique) : exporter
   un dashboard en PDF ; la grille occupe la largeur utile d'une page A4 (marges de 10 mm), aucun widget n'est
   coupé entre deux pages, la légende et le texte sont lisibles. Idem depuis le client web.
5. **Impression papier** d'un dashboard chargé : lisibilité des légendes à 8 px.
6. **Thèmes clair / sombre** et **langue anglaise** : repère des poignées, message « trop petit », texte de
   la fenêtre du widget.
