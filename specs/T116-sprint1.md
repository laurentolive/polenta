# T116 — Sprint 1 : Architecture

Réf : `specs/T116.md`, `specs/T116-design.md`

## Fichiers modifiés

**Nouveaux** :
- `apps/desktop/src/renderer/theme.config.ts` — source unique des tokens (RGB triplets, valeurs light/dark)
- `apps/desktop/scripts/generate-theme-css.ts` — génère `index.css` (bloc `:root`/`.dark`) et `tailwind.theme.generated.js` à partir de `theme.config.ts`
- `apps/desktop/tailwind.theme.generated.js` — sortie générée, mapping `theme.extend.colors`

**Modifiés** :
- `apps/desktop/src/renderer/index.css` — bloc de variables régénéré (marqueurs `THEME:GENERATED:START/END`), `.input-field`/`.btn-danger` migrés vers les tokens `status-info`/`status-danger-*`
- `apps/desktop/tailwind.config.js` — `colors` dérivé de `tailwind.theme.generated.js` au lieu d'un objet en dur
- `apps/desktop/package.json` — script `theme:generate`, devDependency `tsx`
- `apps/desktop/src/renderer/components/layout/ActivityBar.tsx` — migré vers les tokens `activity-*`
- 7 routes `print.*.tsx` (`print.requirements`, `print.tests`, `print.campaign-plan`, `print.campaign-report`, `print.dashboard`, `print.query-result`, `print.impact-analysis`) — migrées vers les tokens `print-*`

## Comportement implémenté

- 5 sentiments (`status-neutral/info/success/warning/danger`) × 5 variantes (`DEFAULT`/`bg`/`border`/`solid`/`fg`) + familles figées `activity-*`/`print-*`, tous dérivés de `theme.config.ts`.
- Tous les tokens sont stockés en triplet RGB (`"R G B"`) et exposés côté Tailwind via `rgb(var(--token) / <alpha-value>)`, ce qui permet les modificateurs d'opacité Tailwind (`/30`, `/50`...) sur les nouvelles classes — validé concrètement (`focus:ring-status-info/30` compile en `rgb(var(--status-info) / 0.3)`).
- `pnpm --filter @polenta/desktop theme:generate` régénère `index.css` et `tailwind.theme.generated.js` ; idempotent (deux exécutions consécutives sans changement de `theme.config.ts` produisent un fichier identique — vérifié par checksum).
- `ActivityBar.tsx` et les 7 routes `print.*.tsx` : zéro classe Tailwind brute restante (vérifié par grep).

## Divergences par rapport au design

1. **Format des valeurs (RGB triplet plutôt que hex)** — `T116-design.md` §2.1 montrait des valeurs hex indicatives. Passage en triplet RGB (`"51 65 85"` plutôt que `"#334155"`) nécessaire pour que `rgb(var(--x) / <alpha-value>)` fonctionne avec les modificateurs d'opacité Tailwind — sans ce format, `focus:ring-status-info/30` n'aurait pas pu s'appliquer correctement (limite documentée dans `T116-tests.md` § cas limite "Opacité sur token", tranchée ici en faveur du support de l'opacité).
2. **`tailwind.config.js` importe un fichier généré (`tailwind.theme.generated.js`) plutôt que `theme.config.ts` directement** — le design proposait un import direct de `theme.config.ts` (TS) depuis `tailwind.config.js` (JS) en s'appuyant sur le chargeur `jiti` de Tailwind. Choix plus sûr et plus simple : le générateur produit aussi un fichier JS plain object (`tailwind.theme.generated.js`, même statut que `index.css` — généré, jamais édité à la main), que `tailwind.config.js` importe normalement. Évite toute incertitude sur la résolution TS-dans-JS via jiti pour les imports transitifs d'un fichier de config.
3. **Nuances "-bg"/"-border" en couleur opaque plutôt que translucide** — les alertes en mode sombre utilisaient des couleurs translucides (`bg-red-900/20`) dans le code d'origine ; les tokens `status-*-bg` en sombre utilisent désormais des teintes opaques équivalentes (ex. `status-danger-bg` sombre = `red-900` plein plutôt que `red-900` à 20% d'opacité) — harmonise aussi avec le style des badges (déjà en `red-900` plein dans plusieurs fichiers), simplifie le système de tokens (pas besoin de gérer deux modes bg — translucide vs plein — pour un même token).

## Vérifications effectuées

- `tsc --noEmit` (apps/desktop) : 0 erreur.
- `theme:generate` exécuté et vérifié idempotent (checksum identique sur 2 exécutions consécutives).
- Build Tailwind autonome (`npx tailwindcss -c tailwind.config.js -i src/renderer/index.css -o ...`) : compile sans erreur ; classes `bg-print-bg`, `text-activity-fg`, `bg-activity-bg-active`, `focus:ring-status-info/30` vérifiées présentes avec les bonnes valeurs `rgb(var(--x) / ...)` dans le CSS généré.
- Grep de conformité restreint aux 8 fichiers du sprint (`ActivityBar.tsx` + 7 routes `print.*.tsx`) : 0 classe Tailwind brute restante.
- **Trouvaille incidente (hors périmètre)** : `.btn-danger` (dans `index.css`) n'est actuellement utilisé nulle part dans le code (`grep btn-danger` → 0 résultat en dehors de sa propre définition). Tailwind purge donc cette règle du CSS compilé quel que soit son contenu — comportement préexistant, non lié à T116, à signaler séparément si le bouton "danger" est censé être utilisé quelque part.

## Comment tester manuellement

1. `pnpm --filter @polenta/desktop dev` — lancer l'app desktop.
2. Ouvrir un projet, observer la barre d'activité (icônes à gauche) : doit rester en fond sombre (`slate-900` visuellement identique à avant) quel que soit le thème actif.
3. Basculer clair/sombre (bouton de thème) : vérifier que le focus ring des champs texte (`.input-field`) change de couleur selon le thème (bleu clair en sombre, bleu plus soutenu en clair) — c'était géré en dur (`ring-slate-400/30`) avant, maintenant piloté par le token `status-info`.
4. Exporter un cahier d'exigences en PDF (bouton Exporter sur la vue Système) en étant en thème sombre : le PDF généré doit rester en fond blanc/texte foncé, indépendamment du thème actif de l'app — vérifie les routes `print.*.tsx`.
5. `pnpm --filter @polenta/desktop theme:generate` après une modification test de `theme.config.ts` (ex. changer une valeur `light`) : vérifier que `index.css` reflète le changement après rebuild.

## Suite

Sprint 2 (statuts métier — requirements/tests/campagnes/exécution, ~13 fichiers) peut démarrer : l'architecture de tokens est en place et validée de bout en bout.
