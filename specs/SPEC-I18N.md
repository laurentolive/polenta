# SPEC-I18N — Internationalisation de l'UI (T111)

## §1. Principe et périmètre

L'interface React du renderer desktop (`apps/desktop/src/renderer`) est
traduite en Français/Anglais via `react-i18next`/`i18next`. Le réglage de
langue est **par poste** (comme le thème clair/sombre, cf.
`contexts/ThemeContext.tsx`), stocké en `localStorage`, sans dépendance à un
compte ni à un projet ouvert.

Sont traduits : tous les libellés statiques de l'UI (boutons, titres de vue,
en-têtes de colonne, messages d'état vide, messages de confirmation/erreur,
placeholders).

Restent **volontairement non traduits** (données, pas UI) :
- le contenu métier saisi par l'utilisateur (`statement`, `rationale`, noms
  de composants, texte des exigences/tests/campagnes) ;
- les identifiants techniques (`SYS-001`…) et les statuts définis dans
  `schema.yaml` (`draft`/`review`/`approved`…) — leur `label` est de la
  donnée projet, pas de l'UI Polenta ;
- les messages d'erreur bruts remontés depuis Git/le système de fichiers ;
- le menu natif Electron (`apps/desktop/src/main/menu.ts`) et les boîtes de
  dialogue système — hors scope, non traduits par ce mécanisme.

À l'inverse, les types TS union **fixes** utilisés comme habillage UI (ex.
`TestRunStatus`, `ImpactAnalysisStatus`, `RequirementChangeType` — définis
dans `@polenta/types`, pas dans le `schema.yaml` d'un projet) sont bien de
l'UI Polenta et doivent être traduits via une table `Record<Union, clé de
traduction>` résolue par `t()`, jamais affichés en valeur brute.

## §2. Architecture

- **`apps/desktop/src/renderer/i18n/index.ts`** — initialise `i18next` +
  `initReactI18next`, charge les deux dictionnaires JSON en ressources,
  lit `localStorage:polenta:locale` (clé `LOCALE_STORAGE_KEY`) pour la
  langue initiale, défaut `fr` si absente. Importé une fois dans
  `main.tsx`.
- **`apps/desktop/src/renderer/i18n/useLocale.ts`** — hook
  `{ locale, setLocale }`, sur le modèle de `ThemeContext.tsx` :
  `setLocale` appelle `i18n.changeLanguage()` (re-rend l'UI immédiatement,
  sans rechargement de fenêtre) et persiste en `localStorage`.
  Exporte aussi `toIntlLocale(language: string): string` — mappe un code
  de langue i18next (`'fr'`/`'en'`) vers le tag `Intl` correspondant
  (`'fr-FR'`/`'en-US'`) pour les appels `toLocaleDateString`. Centralise ce
  mapping pour tous les appelants plutôt que de le réimplémenter par
  fichier (cf. §5).
- **`apps/desktop/src/renderer/i18n/locales/{fr,en}.json`** — dictionnaires
  parallèles, clés imbriquées par domaine fonctionnel (`common.*`,
  `layout.*`, `account.*`, `dashboardPage.*`, `graphPage.*`,
  `printRequirementsPage.*`…). Parité de clés FR/EN obligatoire — vérifiée
  par script à chaque sprint (cf. §6).
- **Sélecteur de langue** — dans `AccountPanel.tsx`, au même niveau que le
  toggle thème clair/sombre (`useTheme()`).

## §3. Convention des clés et cas d'usage

- **Composant React** : `const { t } = useTranslation()`, puis
  `t('domaine.cle')`. Pour l'interpolation de variables :
  `t('domaine.cle', { valeur })` avec `{{valeur}}` dans le JSON.
- **Pluriels** : suffixes i18next `_one`/`_other` avec un paramètre
  `count`, jamais de ternaire fait main (`` `${n} item${n!==1?'s':''}` ``).
  Exemple :
  ```json
  { "rowCount_one": "{{count}} ligne", "rowCount_other": "{{count}} lignes" }
  ```
  Un texte avec **deux quantités indépendantes** (ex. "N exigences · M
  composants") se scinde en deux clés pluralisées séparément — le modèle
  `count` d'i18next ne gère qu'une seule quantité par clé.
- **Style inline sur valeur interpolée** (`<strong>`, `<code>`…) :
  composant `<Trans i18nKey="..." values={{...}} components={{tag: <El/>}} />`
  plutôt que `t()` brut, pour ne pas perdre la mise en forme. Un même nom de
  tag (`code`) peut être réutilisé plusieurs fois dans une même chaîne — pas
  besoin de `code1`/`code2`/`code3` distincts, `Trans` matche par nom de
  tag.
- **Config module-scope** (tableau/objet déclaré hors composant React, donc
  sans accès à `useTranslation()`) : stocke des **clés de traduction**
  (`labelKey`), jamais de littéral résolu — résolues via `t()` par
  l'appelant à l'intérieur du composant. Exemple : `SYSTEM_FIELD_DEFS`,
  `OPERATORS` (`QueryBuilder.tsx`), `STATUS_LABEL_KEY`/
  `CHANGE_TYPE_LABEL_KEY` (`impact-analysis.tsx`), `RUN_STATUS_LABEL_KEY`
  (`campaign.$campaignId.tsx`). Si une même table de labels sert à la fois
  la vue interactive et sa contrepartie imprimable/export (`print.*.tsx`),
  la table est **exportée** depuis le fichier route qui la définit et
  réimportée plutôt que dupliquée.
- **Titre de branche/tag avec suffixe conditionnel** (ex. `` `Branche:
  ${ref}${isCurrent ? ' (courante)' : ''}` ``) : deux clés complètes
  séparées (`branchLabel`/`branchLabelCurrent`) plutôt qu'une clé unique
  avec fragment concaténé après coup — évite une construction
  grammaticalement invalide dans une langue où l'ordre des mots diffère.
- **Réutilisation inter-namespace** : réutiliser une clé existante à texte
  identique plutôt qu'en dupliquer une nouvelle est encouragé (réduit le
  coût de maintenance), **sauf** si le texte diffère ne serait-ce que
  légèrement entre les deux emplacements dans une des deux langues — y
  compris pour des raisons purement grammaticales (accord de genre en
  français, ex. "Privé"/"Privée" selon le nom qualifié). Ne jamais fusionner
  deux clés au texte visuellement différent au prétexte d'une synonymie de
  sens.

## §4. Ce qui reste explicitement non traduit

Cf. §1 — business data et menu natif. Concrètement, dans les fichiers
`print.*.tsx`/`routes/*.tsx` : `req.status`, `tc.status`, `campaign.status`
et les `col.label`/labels définis par `schema.yaml` restent bruts. À
distinguer des tables `*_LABEL_KEY` (§3) qui, elles, DOIVENT passer par
`t()`.

## §5. Formatage des dates par locale

`toLocaleDateString` doit recevoir le tag `Intl` correspondant à la langue
active, jamais `'fr-FR'` codé en dur — sinon les dates restent en français
quelle que soit la langue d'UI choisie. Utiliser
`toIntlLocale(i18n.language)` (exporté par `i18n/useLocale.ts`, cf. §2)
plutôt que de réimplémenter le ternaire `language === 'en' ? 'en-US' :
'fr-FR'` par fichier.

## §6. Contrôle de non-régression

- **Parité de clés FR/EN** : script (`node -e` flatten+diff des deux JSON)
  exécuté à la fin de chaque sprint — doit renvoyer zéro clé orpheline dans
  un sens ou l'autre.
- **Résolution des clés référencées** : chaque `t('...')`/`i18nKey="..."`
  du code doit correspondre à une clé (ou paire `_one`/`_other`) réellement
  présente dans `fr.json` — vérifié par script à la fin de chaque sprint, un
  typo de clé ne provoque aucune erreur de compilation (juste l'affichage
  de la clé brute en prod).
- **Revue exhaustive de fin de dernier sprint** (critère d'acceptation 5 du
  ticket) : recherche des chaînes françaises encore codées en dur — un
  simple grep regex sur motifs capitalisés est insuffisant à lui seul
  (rate les template literals, le texte JSX précédé d'espace plutôt que
  d'un `>` littéral, les chaînes courtes) ; une relecture manuelle des
  fichiers volumineux reste nécessaire en complément.

## §7. Fichiers de référence

- `apps/desktop/src/renderer/contexts/ThemeContext.tsx` — architecture
  répliquée pour la langue (`createContext`/`localStorage`/`useState`).
- `apps/desktop/src/renderer/i18n/index.ts`, `useLocale.ts`,
  `locales/{fr,en}.json`.
- `apps/desktop/src/renderer/components/sidebar/AccountPanel.tsx` —
  emplacement du sélecteur de langue.
- `apps/desktop/src/main/menu.ts` — menu natif, explicitement hors scope.
