# T111 — Design technique

## Bibliothèque i18n

**`react-i18next` + `i18next`** (2 nouvelles dépendances `apps/desktop/package.json`).

Alternatives écartées :
- **Solution maison (dictionnaire de clés + `useLocale()` custom)** : écartée malgré la
  préférence du projet pour des Context faits main (`ThemeContext.tsx`,
  `VersioningContext.tsx`…) — dès qu'une chaîne a une variable interpolée ("X éléments
  trouvés", "Créé par {name}") ou un pluriel FR/EN (règles différentes : EN pluralise à
  partir de 2, FR reste singulier à 0 et 1), une solution maison réinvente une machinerie
  que `i18next` fournit déjà, testée et documentée. Vu les ~120 fichiers à couvrir, le coût
  de la dépendance est largement amorti.
- **`react-intl`/FormatJS** : équivalent fonctionnellement, mais `react-i18next` a une API
  plus simple (`t('key')` vs `formatMessage({id})`) pour ce cas d'usage (pas de besoin
  ICU MessageFormat avancé, pas de SSR).
- **`i18next-browser-languagedetector`** (détection langue navigateur/OS) : non ajouté —
  la spec exclut la détection automatique du périmètre ferme (point ouvert Design), et
  l'app tourne dans Electron où `navigator.language` est peu significatif du choix
  utilisateur. Le défaut reste toujours `fr`. Peut être ajouté plus tard sans rien casser.
- **Typage strict des clés de traduction** (`resources` typé, `d.ts` augmentation
  `react-i18next`) : non mis en place. Bénéfice réel (autocomplétion, erreur de build sur
  clé inexistante) mais coût de maintenance (chaque nouvelle clé JSON doit rester en
  synchro avec un type déclaré) disproportionné pour ce ticket — abstraction non demandée
  par la spec. `t()` reste `string → string`, les clés manquantes tombent en fallback
  visible en dev (`i18next` log un warning console si `debug: true` en dev).

## Architecture

```
apps/desktop/src/renderer/i18n/
├── index.ts              # init i18next + initReactI18next, resources fr/en, lng initial
└── locales/
    ├── fr.json            # namespace unique "translation", clés imbriquées par domaine
    └── en.json
```

`index.ts` :
```ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import fr from './locales/fr.json'
import en from './locales/en.json'

export const LOCALE_STORAGE_KEY = 'polenta:locale'

const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
const initialLng = stored === 'en' ? 'en' : 'fr'

i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en } },
  lng: initialLng,
  fallbackLng: 'fr',
  interpolation: { escapeValue: false }, // React échappe déjà le JSX
})

export default i18n
```

Importé une seule fois depuis `main.tsx` (avant le premier rendu), sur le modèle de
l'import de `index.css` — pas de Provider React dédié : `initReactI18next` enregistre déjà
`i18n` globalement, `useTranslation()` fonctionne dans tout composant sans wrapper
supplémentaire (à la différence de `ThemeContext`, qui doit rester un Context React
puisqu'il pilote une classe DOM `document.documentElement.classList` ; la langue, elle, n'a
pas besoin de traverser le DOM — `i18next` gère son propre store interne).

## `useLocale()` — hook de changement de langue

Petit hook, **pas un Context** (contrairement à `useTheme()`) — `i18next` maintenant déjà
l'état global et notifiant tous les `useTranslation()` via son propre event emitter, un
Context React serait une couche redondante :

```ts
// apps/desktop/src/renderer/i18n/useLocale.ts
import { useTranslation } from 'react-i18next'
import { LOCALE_STORAGE_KEY } from './index'

export function useLocale() {
  const { i18n } = useTranslation()
  const locale = i18n.language === 'en' ? 'en' : 'fr'

  function setLocale(next: 'fr' | 'en') {
    i18n.changeLanguage(next)
    localStorage.setItem(LOCALE_STORAGE_KEY, next)
  }

  return { locale, setLocale }
}
```

`changeLanguage` déclenche un re-render de tous les composants utilisant `useTranslation()`
(pas de rechargement de fenêtre) — répond au critère d'acceptation 2 de la spec.

## Sélecteur de langue

Ajouté dans `apps/desktop/src/renderer/components/sidebar/AccountPanel.tsx`, juste à côté
du toggle thème existant (`AccountPanel.tsx:22,114-125`, `useTheme()`) : deux boutons ou un
petit select "Français / English", suivant le même style visuel (`btn-*` du design system,
cf. mémoire projet) que le toggle clair/sombre voisin. Décision de layout fine (bouton
unique à bascule vs. deux options visibles) laissée à l'implémentation Sprint 1 — pas
d'enjeu d'architecture.

## Convention des clés de traduction

Clés imbriquées par domaine fonctionnel, calquées sur le découpage en sprints ci-dessous,
pour qu'une clé indique sans ambiguïté quel fichier la possède :

```json
{
  "common": { "save": "Enregistrer", "cancel": "Annuler", "delete": "Supprimer", "...": "..." },
  "layout": { "activityBar": { "...": "..." }, "tabBar": { "newTab": "Nouvel onglet", "...": "..." } },
  "account": { "languageLabel": "Langue", "themeLight": "Clair", "...": "..." },
  "sidebar": { "project": { "...": "..." }, "version": { "...": "..." } },
  "schema": { "structureTab": { "...": "..." }, "...": "..." },
  "system": { "editView": { "...": "..." }, "excelView": { "...": "..." } },
  "dashboard": { "widget": { "...": "..." }, "...": "..." },
  "print": { "...": "..." }
}
```

`common.*` regroupe les libellés génériques réutilisés partout (Enregistrer/Annuler/
Supprimer/Rechercher/Fermer…) pour éviter la duplication de clés identiques dans chaque
domaine — seule mutualisation prévue, le reste suit un mapping 1 domaine ↔ 1 sous-arbre.

Interpolation : `t('sidebar.testsFound', { count })` avec entrées `_one`/`_other` dans les
JSON pour les pluriels (règle i18next standard), ex. :
```json
"testsFound_one": "{{count}} test trouvé",
"testsFound_other": "{{count}} tests trouvés"
```

### Config module-scope (tableaux/dictionnaires hors composant)

Certains fichiers déclarent leurs libellés dans un tableau/dictionnaire au **niveau module**
(hors de tout composant React) — ex. `ActivityBar.tsx`'s `PANELS`, `TabsContext.tsx`'s
`PANEL_LABEL_KEYS`/`TITLE_OVERRIDE_KEYS`/`PREFIX_TITLE_KEYS`. `t()` n'existe que via le hook
`useTranslation()`, donc indisponible à cet endroit. Convention retenue (rencontrée dès le
Sprint 1, à réutiliser telle quelle pour toute config module-scope similaire en Sprint 2+,
ex. `components/dashboard/widgets/*`, `components/system/*` qui suivent le même pattern) :
- le tableau/dictionnaire stocke des **clés de traduction** (`labelKey: 'layout.activityBar.account'`),
  jamais de chaîne littérale ;
- la traduction effective (`t(labelKey)`) se fait au moment du rendu, à l'intérieur du
  composant qui consomme la config, ou dans une fonction qui reçoit `t` en paramètre
  explicite (ex. `defaultTitleForPathname(pathname, t)` dans `TabsContext.tsx`) quand la
  logique doit rester hors composant (fonctions utilitaires pures partagées entre plusieurs
  call sites).
- si cette fonction est utilisée depuis un `useCallback` à dépendances volontairement vides
  (cas des setters stables exposés par un Context, pour ne pas casser une garantie de
  référence stable documentée ailleurs dans le fichier), passer `t` via un `useRef` mis à
  jour par un effet plutôt que via les deps du `useCallback` — évite un `t` figé sur le
  rendu initial sans réintroduire la boucle de re-render que les deps vides évitaient.

### `<Trans>` pour préserver du style inline sur une valeur interpolée

Quand une chaîne traduite doit conserver un style (ex. `font-mono`) sur une valeur
interpolée au milieu de la phrase (`ModificationControl.tsx`'s `blockedBranch`), utiliser
le composant `<Trans>` de `react-i18next` avec une balise custom dans le JSON plutôt que de
casser la phrase en plusieurs `t()` :
```json
"blockedBranch": "<mono>{{branch}}</mono> n'est pas la branche ... (<mono>{{integrationBranch}}</mono>) ..."
```
```tsx
<Trans i18nKey="layout.modificationControl.blockedBranch" values={{ branch, integrationBranch }}
  components={{ mono: <span className="font-mono" /> }} />
```
Réservé aux cas où un style doit vraiment survivre à la traduction — pour une phrase sans
mise en forme interne, un simple `t('key', { values })` reste la règle.

## Découpage en sprints

Le renderer compte ~120 fichiers `.tsx`/`.ts` sous `components/`, `routes/`, `contexts/`
portant potentiellement des chaînes UI. Découpage en 4 sprints par domaine fonctionnel
(chaque sprint = infra du sprint précédent + un lot cohérent, testable indépendamment) :

### Sprint 1 — Infrastructure i18n + coquille applicative
- Ajout dépendances, `i18n/index.ts`, `i18n/locales/{fr,en}.json` (namespace `common` +
  `layout` + `account`), `i18n/useLocale.ts`
- Sélecteur de langue dans `AccountPanel.tsx`
- `components/layout/*` (ActivityBar, AppLayout, ConfirmCloseTabModal, ModificationControl,
  Sidebar, TabBar, TabListMenu, ViewHeader)
- `components/AccountMenu.tsx`, `components/sidebar/AccountPanel.tsx`
- `routes/__root.tsx`, `routes/login.tsx`, `routes/index.tsx`, `routes/account.tsx`,
  `routes/preferences.tsx`, `routes/workspace.tsx`
- Import de `i18n/index.ts` dans `main.tsx`

### Sprint 2 — Panneaux latéraux + Projet/Modèle de données
- `components/sidebar/*` (ProjectPanel, DashboardPanel, RequirementsPanel, SearchPanel,
  SystemPanel, TestsPanel, VersionPanel, ReorderableSidebarSection, `version/*`)
- `components/schema/*` (AddDependencyModal, ElementConfigModal, RemoveDependencyModal,
  RepoBranchSelector, StructureTab, objectTypeEditor)
- `routes/schema.tsx`, `routes/search.tsx`

### Sprint 3 — Vue Système (exigences, tests, campagnes)
- `components/system/*` (CampaignListView, EditView, ElementTree, ExcelView, LinkCombobox,
  RichTextToolbar, SystemView, WordView)
- `components/DynamicField.tsx`, `RichTextField.tsx`, `RichTextViewer.tsx`,
  `StepsTable.tsx`, `TestParamFields.tsx`, `FilterOptionsToggle.tsx`
- `routes/product.tsx`, `routes/components.tsx`, `routes/req.$reqId.tsx`,
  `routes/req.new.tsx`, `routes/requirements.tsx`, `routes/test.$testId.tsx`,
  `routes/test.new.tsx`, `routes/tests.tsx`, `routes/campaign.*.tsx` (4 fichiers)

### Sprint 4 — Dashboards, traçabilité/versioning, export, impression
- `components/dashboard/**` (tout le sous-arbre widgets inclus)
- `components/impact/*`, `components/export/*`
- `components/ComplianceMatrix.tsx`, `DiamondConflictModal.tsx`, `DrawioInsertButton.tsx`,
  `DrawioLogoIcon.tsx`, `ImageInsertButton.tsx`, `TableInsertButton.tsx`
- `routes/dashboard.tsx`, `routes/query.tsx`, `routes/graph.tsx`, `routes/diff.tsx`,
  `routes/version-diff.tsx`, `routes/versioning.tsx`, `routes/baseline.tsx`,
  `routes/impact-analysis.tsx`, `routes/compliance.tsx`
- `routes/print.*.tsx` (7 fichiers)
- **Dernier sprint** : applique aussi l'étape "mise à jour SPEC" de `WORKFLOW.md` — création
  de la nouvelle section SPEC (cf. `T111.md` § Refs SPEC) et mise à jour de `SPEC-INDEX.md`.

`contexts/*.tsx` ne portent en général pas de chaînes UI directes (logique d'état pure) —
pas de sprint dédié ; les rares messages d'erreur qu'ils exposent (ex. throw dans un
provider) sont traduits au fil du sprint qui touche le composant consommateur concerné.
**Exception rencontrée en Sprint 1** : `contexts/TabsContext.tsx` construit lui-même les
titres d'onglet par défaut (`PANEL_LABELS`/`TITLE_OVERRIDES`/`PREFIX_TITLES`, consommés par
`TabBar.tsx`/`TabListMenu.tsx`, déjà dans le périmètre Sprint 1) — traité dans ce sprint
plutôt que reporté, la nouvelle bascule de langue rendant l'incohérence immédiatement
visible sinon (nouveaux onglets restant en français après passage en anglais). À vérifier
au cas par cas pour les autres contexts dans les sprints suivants plutôt que d'appliquer
l'exclusion par défaut sans relecture.

Chaque sprint se termine par : `pnpm typecheck` propre, grep de contrôle
(`rg "'[A-ZÀ-ÿ][a-zà-ÿ ]{3,}'" <fichiers du sprint>` ou revue visuelle) pour vérifier
qu'aucune chaîne française évidente ne reste en dur dans les fichiers du lot, et bascule
manuelle FR/EN dans l'app pour valider visuellement le lot.

## Fichiers créés

- `apps/desktop/src/renderer/i18n/index.ts`
- `apps/desktop/src/renderer/i18n/useLocale.ts`
- `apps/desktop/src/renderer/i18n/locales/fr.json`
- `apps/desktop/src/renderer/i18n/locales/en.json`

## Fichiers modifiés (par sprint, cf. découpage ci-dessus)

`apps/desktop/package.json` (Sprint 1, ajout deps), `main.tsx` (Sprint 1, import init),
puis les ~118 fichiers `routes/`/`components/` listés par sprint.
