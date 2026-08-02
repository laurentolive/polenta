# T116 — Sprint 4 (final) : reste + vérification finale

Réf : `specs/T116.md`, `specs/T116-design.md` §4

## Fichiers modifiés

Interaction/navigation (4) :
- `apps/desktop/src/renderer/components/schema/StructureTab.tsx`
- `apps/desktop/src/renderer/components/system/ElementTree.tsx`
- `apps/desktop/src/renderer/components/sidebar/SearchPanel.tsx`
- `apps/desktop/src/renderer/routes/graph.tsx`

Dashboard widgets (2) :
- `apps/desktop/src/renderer/components/dashboard/DashboardGrid.tsx`
- `apps/desktop/src/renderer/components/dashboard/QueryBuilder.tsx`

Tiptap / rich text (7) :
- `apps/desktop/src/renderer/tiptap/ResizableMediaFrame.tsx`
- `apps/desktop/src/renderer/tiptap/NodeContextMenu.tsx`
- `apps/desktop/src/renderer/tiptap/ResizableImageView.tsx`
- `apps/desktop/src/renderer/tiptap/DrawioEmbedView.tsx`
- `apps/desktop/src/renderer/components/RichTextViewer.tsx`
- `apps/desktop/src/renderer/components/RichTextField.tsx`
- `apps/desktop/src/renderer/components/system/WordView.tsx` (bloc prose `code`/`blockquote`/`pre`, laissé de côté en sprint 2)

Sidebar / layout (7) :
- `apps/desktop/src/renderer/components/sidebar/AccountPanel.tsx`
- `apps/desktop/src/renderer/components/sidebar/VersionPanel.tsx`
- `apps/desktop/src/renderer/components/sidebar/ReorderableSidebarSection.tsx`
- `apps/desktop/src/renderer/components/layout/TabBar.tsx`
- `apps/desktop/src/renderer/components/layout/AppLayout.tsx`
- `apps/desktop/src/renderer/components/layout/ModificationControl.tsx`
- `apps/desktop/src/renderer/routes/account.tsx`

Diff / compliance / impact (5) :
- `apps/desktop/src/renderer/routes/diff.tsx`
- `apps/desktop/src/renderer/routes/version-diff.tsx`
- `apps/desktop/src/renderer/routes/impact-analysis.tsx`
- `apps/desktop/src/renderer/components/ComplianceMatrix.tsx`

Export / formulaires / divers (8) :
- `apps/desktop/src/renderer/components/export/ExportButton.tsx`
- `apps/desktop/src/renderer/components/AccountMenu.tsx`
- `apps/desktop/src/renderer/components/StepsTable.tsx`
- `apps/desktop/src/renderer/components/schema/RepoBranchSelector.tsx`
- `apps/desktop/src/renderer/components/system/SystemView.tsx`
- `apps/desktop/src/renderer/components/DrawioInsertButton.tsx`
- `apps/desktop/src/renderer/components/ImageInsertButton.tsx`

Architecture (nouveau token) :
- `apps/desktop/src/renderer/theme.config.ts` (+ token `overlay`)
- `apps/desktop/scripts/generate-theme-css.ts` (enregistrement `overlay` dans `buildTailwindColors()`)
- `apps/desktop/src/renderer/index.css`, `apps/desktop/tailwind.theme.generated.js` (régénérés via `pnpm theme:generate`)
- `apps/desktop/src/renderer/lib/objectCategoryColors.ts` (nouveau — constante partagée, voir §Divergences)

Specs :
- `specs/SPEC-THEMING.md` (nouveau)
- `specs/SPEC-INDEX.md` (entrée ajoutée)

37 fichiers de code + 1 fichier de constantes partagées + 3 fichiers d'architecture/génération.

## Comportement implémenté

Complète la migration des derniers fichiers recensés en design §4 ("reste") vers les
tokens `status-*`/`chart-*`, avec les mêmes conventions que les sprints précédents.

**Décision d'architecture — token `overlay`** : le grep de conformité (critère
d'acceptation 2 de `T116.md`) inclut littéralement `\b(bg|text|border)-(white|black)\b`,
qui couvre `bg-black/40`/`bg-black/50` (trame de fond de toutes les modales de l'app,
~25 occurrences) — ni `T116.md` ni `T116-design.md` ne les avait explicitement classées
"famille figée" comme `ActivityBar`/impression, mais elles en partagent exactement la
propriété (noir, invariant au thème par nature). Ajout d'un token `overlay` (noir fixe)
à `theme.config.ts`, enregistrement dans `generate-theme-css.ts`, régénération, puis
`bg-black/NN` → `bg-overlay/NN` sur l'ensemble du dépôt (`sed` — substitution 1:1,
opacité de chaque point d'usage préservée à l'identique). Couvre aussi le seul usage de
`black` hors trame de modale (`hover:bg-black/10` sur un bouton d'`ElementTree.tsx`,
assombrissement ponctuel au survol — même besoin visuel de base que la trame de modale).

**Couleurs catégorielles (hors sentiment)** :
- `CATEGORY_DOT` (`StructureTab.tsx`, icône de type d'élément dans l'arbre) et
  `badgeCls` (`SearchPanel.tsx`, badge de type dans les résultats de recherche)
  réimplémentaient indépendamment la même correspondance catégorie → couleur
  (`requirement`/`test`/`campaign`, précédemment `blue`/`green`/`purple` dans
  `StructureTab.tsx` mais `blue`/`green`/`amber` dans `SearchPanel.tsx` — une
  divergence pré-existante). Extrait en `lib/objectCategoryColors.ts`
  (`CATEGORY_CHART_TEXT`/`CATEGORY_CHART_BG`, classes Tailwind écrites en toutes
  lettres — une classe construite par concaténation ne serait pas détectée par le
  scanner JIT de Tailwind), réutilisé par les deux fichiers. `campaign` → `chart-7`
  (pas `chart-5`, déjà pris par le marqueur sous-composant/interface qui peut
  apparaître dans le même arbre `StructureTab.tsx`).
- `GitFork`/`ShieldCheck` (marqueur sous-composant/interface, `text-violet-500`
  historique) migré vers `chart-5` dans `StructureTab.tsx` — résout l'incohérence
  transitoire documentée en fin de sprint 3 (ce fichier restait sur l'ancienne teinte
  violette alors que `VersionRepoFolder.tsx`/`compliance.tsx` avaient déjà basculé).

**Autres mappings notables** :
- Poignées de recadrage/redimensionnement (`ResizableMediaFrame.tsx`, `orange-500/600`)
  → `status-warning-solid` ; carrés de poignée blancs → `status-info-fg` (blanc fixe
  dans les deux thèmes, réutilisé comme "blanc constant" plutôt que la classe brute
  `white`, cohérent avec le badge de recherche et le fond du point de commit dans
  `graph.tsx`, cf. ci-dessous).
- Canevas du rendu draw.io embarqué (`DrawioEmbedView.tsx`, `bg-white`) → `bg-print-bg`
  plutôt que `status-info-fg` : le contenu du diagramme (couleurs propres au fichier
  `.drawio`) est conçu pour un fond clair fixe, indépendamment du thème — même besoin
  que les vues d'impression, pas un simple "texte blanc sur fond coloré".
- `graph.tsx` : trait SVG `stroke="white"` (contour du point de commit courant) →
  `stroke="rgb(var(--status-info-fg))"` (attribut SVG, pas de classe Tailwind
  possible — référence directe à la variable CSS du token).
- Tableau `COLORS` (hex bruts, palette des lignes du graphe git) laissé inchangé —
  hors périmètre du grep de conformité (couleurs de branches indépendantes du thème
  par nature, documenté dans `SPEC-THEMING.md` §5).

## Vérifications effectuées

- Grep de conformité **exact du critère d'acceptation 2 de `T116.md`** sur
  `apps/desktop/src/renderer/**/*.tsx` : 0 résultat.
- Grep élargi (préfixes `outline-`/`accent-`/`caret-`/`shadow-`/`decoration-` en plus,
  pour couvrir des usages non listés dans le critère strict mais trouvés pendant
  l'audit du sprint) sur `**/*.{tsx,ts}` : 0 résultat.
- `pnpm --filter @polenta/desktop theme:generate` relancé après ajout du token
  `overlay` : idempotent (deuxième exécution sans diff supplémentaire).
- `pnpm --filter @polenta/desktop typecheck` : 0 erreur.
- `/code-review` (effort high, 5 angles via subagents) : 6 problèmes confirmés et
  corrigés —
  1. `graph.tsx` (4 zones) et `diff.tsx`/`version-diff.tsx` : la substitution
     mécanique avait perdu la distinction d'opacité clair/sombre de plusieurs
     surlignages de ligne (ex. `bg-blue-50/40 dark:bg-blue-900/5` → `bg-status-info-bg/40`
     appliquait la valeur sombre du token à 40% au lieu des 5% d'origine, rendant la
     ligne beaucoup plus visible qu'avant). Corrigé en réintroduisant un modificateur
     `dark:` explicite sur le token (ex. `bg-status-info-bg/40 dark:bg-status-info-bg/5`)
     pour chaque cas où le clair et le sombre avaient une opacité distincte à l'origine.
  2. `SearchPanel.tsx` : le surlignage `<mark>` de correspondance de recherche
     (`bg-yellow-300` opaque en clair) devenait trop terne à `bg-status-warning-solid/30` ;
     opacité remontée à `/70`.
  3. `DrawioInsertButton.tsx`/`ImageInsertButton.tsx`/`ResizableImageView.tsx`/
     `DrawioEmbedView.tsx` : la bordure d'un popover d'erreur (`border-red-400/50`,
     translucide, à côté d'un texte déjà rouge) avait été sur-corrigée vers
     `border-status-danger` (pleine saturation) par réflexe du correctif appliqué à
     `DiamondConflictModal.tsx` en cours de sprint (bordure seule, sans texte rouge
     adjacent, où la pleine saturation était justifiée) — revenu à
     `border-status-danger-border` (pâle), le texte rouge portant déjà le signal
     principal dans ces 4 cas.
  4. Duplication `CATEGORY_DOT`/`badgeCls` — extraite en constante partagée (voir
     ci-dessus).
- Autres observations, non corrigées (décision documentée) :
  - Opacité `/40` vs `/50` incohérente entre trames de modale selon les fichiers —
    pré-existante (déjà `bg-black/40` vs `bg-black/50` avant T116), hors périmètre du
    critère d'acceptation 5 (préserver les valeurs actuelles sauf harmonisation
    explicitement décidée en Design — non décidée pour ce cas).
  - `code`/`pre` du bloc prose rich-text partagent désormais `status-neutral-bg` en
    mode sombre (nuance unique) alors que l'original distinguait `slate-700`/`slate-800`
    (un cran d'écart) — les deux utilisaient déjà la même teinte en mode clair
    (`slate-100`) avant T116 ; aucun token existant ne reproduit exactement la paire
    `slate-100`/`slate-800` requise pour `pre` sans en introduire un nouveau pour ce
    seul usage. Harmonisation mineure acceptée.
  - `bg-print-bg` réutilisé pour le canevas draw.io plutôt que `status-info-fg` (
    utilisé ailleurs dans ce sprint comme "blanc constant") — écart volontaire, motivé
    ci-dessus (§Comportement implémenté), pas une incohérence.

## Divergences par rapport au design

- Token `overlay` non prévu dans `T116-design.md` (voir §Comportement implémenté) —
  nécessaire pour satisfaire le critère d'acceptation 2 à la lettre.
- `lib/objectCategoryColors.ts` : nouveau fichier non prévu, ajouté suite à la revue
  de code (duplication de mapping catégorie → couleur entre deux fichiers).
- Périmètre légèrement élargi par rapport à la liste indicative de `T116-design.md`
  §4 : `SearchPanel.tsx`, `ReorderableSidebarSection.tsx`, `ModificationControl.tsx`,
  `AppLayout.tsx`, `TabBar.tsx`, `VersionPanel.tsx`, `AccountPanel.tsx`/`account.tsx`,
  `DrawioInsertButton.tsx`/`ImageInsertButton.tsx` n'étaient pas nommés explicitement
  mais contenaient des couleurs brutes détectées par le grep de conformité final —
  traités pour atteindre zéro résultat.

## Mises à jour SPEC

- **Nouveau** : `specs/SPEC-THEMING.md` — architecture `theme.config.ts`, 5 sentiments
  × 5 variantes, catégoriel `chart-1..8`, familles figées (`activity-*`, `print-*`,
  `overlay`), mécanisme de génération, procédure d'ajout de token, grep de conformité.
- `specs/SPEC-INDEX.md` — entrée ajoutée pour `SPEC-THEMING.md`, colonne `MAJ` → T116.

## Comment tester manuellement

1. `pnpm --filter @polenta/desktop dev`.
2. Basculer clair/sombre depuis n'importe quel écran (Compte, ou bouton thème du
   panneau Compte) et parcourir : arbre Structure, panneau Version (checkout, diff,
   comparaison de versions, analyse d'impact), Graphe de versions (`/graph`),
   Recherche globale (Ctrl+Shift+F ou équivalent), un dashboard avec widgets, une
   exigence/test en mode Word (blocs de code/citation), insertion d'image et de
   diagramme draw.io (recadrage), export.
3. Vérifier qu'aucune zone ne reste bloquée sur l'ancienne palette dans les deux
   thèmes, notamment le graphe de commits (ligne sélectionnée, ligne courante,
   panneau de fichiers déplié) et le surlignage de recherche.
4. Ouvrir plusieurs modales (Structure "+", suppression, Publier, fermeture d'onglet
   avec modifications non enregistrées) : la trame de fond doit rester identique à
   avant (noir semi-transparent), dans les deux thèmes.
5. Dans l'arbre Structure, comparer visuellement le marqueur violet "interface" et un
   badge "campagne" (recherche ou arbre) : deux teintes catégorielles distinctes,
   cohérentes entre les écrans.

## Suite

Sprint final du ticket — grep de conformité global exécuté (0 résultat), specs à jour.
Ticket archivé de `TICKETS.md` vers `tickets_archive.md`. Merge vers `main` proposé,
en attente de validation humaine.
