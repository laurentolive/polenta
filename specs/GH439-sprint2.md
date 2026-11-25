# GH439 — Sprint 2 : la page (sections, barre de titre, section « Exigences »)

Spec : `specs/GH439.md` § 2, § 4 · design : `specs/GH439-design.md` § 6, § 7 · scénarios : `specs/GH439-tests.md` E1–E13, E17.

## Fichiers

| Fichier | Changement |
|---|---|
| `renderer/routes/version.$versionId.tsx` | barre de titre : ID et pastille d'état toujours visibles, plus de bouton de repli ; six sections dans l'ordre (Informations, Composants, Changements, Analyse, Tests, Exigences) ; alerte des composants retirés hors section ; pas de section Exigences pour une version abandonnée sans gel |
| `components/versions/VersionInfoSection.tsx` (nouveau) | le bloc d'en-tête déplacé tel quel (libellé, statut, « basée sur », tag, champs du type, Enregistrer / Annuler) sous un en-tête de section |
| `components/versions/VersionRequirementsSection.tsx` (nouveau) | section fermée par défaut, lecture à l'ouverture seulement, ligne d'information selon l'origine de la vérification, grille commune en lecture seule, `noExport`, mémoire du défilement |
| `components/versions/versionRequirementColumns.tsx` (nouveau) | colonnes : id, titre, statut, type (masquée), champs du schéma, révision (masquée), Vérification, tests (masquée) ; défauts = `defaultVisible` ou les trois premiers champs |
| `components/versions/versionChangeColumns.tsx`, `versionTestColumns.tsx`, `versionAnalysisColumns.tsx` (nouveaux) | colonnes **extraites** des trois grilles existantes (aucune duplication : l'export du sprint 3 les réutilise) ; `VersionChangesTable`, `VersionTestsSection`, `VersionAnalysisSection` les appellent |
| `components/versions/SectionToggle.tsx`, `useVersionRequirements.ts` | en-tête de section partagé (compteur facultatif) ; requête `versions:requirements` (clé `['versions', …]`) |
| `components/versions/useVersions.ts` | `useSectionOpen(section, defaultOpen = true)` |
| `components/grid/useHeaderCollapsed.ts` | type réduit à `'validation'` |
| `components/system/CoverageBadge.tsx`, `lib/impactStatus.ts`, `components/impact/ImpactTrees.tsx` | `CLASS_BY_STATUS` exporté ; `CLOSED_STATUSES` déplacé dans `lib/impactStatus` (pur, ré-exporté par `ImpactTrees`) pour que les colonnes se chargent sans le graphe de composants |
| `i18n/locales/{fr,en}.json` | `versions.info`, `versions.requirements.*`, `VERSION_NOT_FROZEN` |
| `e2e-web/gh439-version-page.spec.ts` (nouveau), `gh389-versions.spec.ts` | 15 scénarios ; le repli de l'en-tête devient le repli de la section « Informations » |

## Comportement

- Un repli par section, état mémorisé par poste (`polenta:versionSections`) ; « Exigences » fermée tant que l'utilisateur ne
  l'a pas ouverte, et **aucune lecture** (`versions:requirements`) tant qu'elle est fermée (vérifié sur les requêtes).
- Ligne d'information : « État figé au tag … — Vérification figée à la release » / « … non figée pour cette version »
  (released avant GH439, colonne « — ») / « État courant du repo — … » (version en cours).
- Entrée ou double-clic sur une ligne : ouvre l'exigence. Aucune cellule n'est modifiable. Pas de bouton Exporter dans la
  grille (l'export global est au sprint 3).

## Divergences par rapport au design

- La grille des tests, des changements et de l'analyse gardent leur bouton Exporter jusqu'au sprint 3 (`noExport`
  arrive avec l'export de la page, pour ne jamais laisser la page sans export).
- `CLOSED_STATUSES` déplacé hors de `ImpactTrees` (hors périmètre strict) : sans cela, charger les colonnes d'analyse pour
  l'export tirait tout le graphe de composants de l'arbre d'impact, et `window` / `localStorage` avec lui.
- E7 « la couverture suit une exécution sans recharger » n'est pas automatisé : la page relit la section à chaque
  invalidation `versions` (`useLiveFileSync`), comme le reste de la page ; à vérifier à la main.

## Vérifications

- `pnpm typecheck` OK ; lint : seules les 3 erreurs préexistantes de `main` (#437).
- `e2e-web/gh439-version-page` : 15/15 (E1–E12, E13 ×3 par Précédent / onglet / barre d'activité avec échantillonnage de
  chaque frame, E17). `e2e-web/gh389-versions` adapté : vert. Tests unitaires du renderer : 480/480.
- Suite unitaire complète : au sprint 3 (le sprint 2 ne touche aucun service).

## Comment tester à la main

Ouvrir une version released : section **Exigences** (fermée) → l'ouvrir : état au tag, colonne Vérification figée.
Modifier une exigence ou lier un test après la release, rouvrir : rien ne change. Sur une version en cours : la
vérification suit les liens et les exécutions. Replier « Informations » : l'état est retrouvé sur les autres versions.
