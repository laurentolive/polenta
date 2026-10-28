# GH176 — Design : colonnes configurables du sélecteur de tests

Spec : [GH176.md](GH176.md). **Un seul sprint.**

## Vue d'ensemble

```
TestPickerModal ── bouton ⚙️ (barre onglet Tests) ── état columnsOpen
   │                                         │
   └─ TestPickerGrid ── lit fieldVisibility[type] (cache ['pref-visibility', …] partagé avec SystemView)
         │  colonnes = picker ?? excel ?? défaut  (+ Statut forcé)
         │  dossiers = showFoldersPicker ?? showFoldersExcel ?? true
         └─ FieldConfigModal (extrait de SystemView), une seule vue, Statut verrouillé
               └─ écrit un PATCH { picker } / { showFoldersPicker } / { picker: null, showFoldersPicker: null }
                     └─ pref:set-field-visibility : fusion clé à clé (null = suppression)
```

## 1. Stockage — `pref:set-field-visibility` fusionne au lieu de remplacer

**Problème** (spec point 10) : le handler remplace aujourd'hui `fieldVisibility[typeKey]` par
l'objet reçu, et la Vue Système envoie toujours un objet complet construit depuis `prefsRef`
(copie en mémoire). Une Vue Excel montée dans un autre onglet effacerait donc `picker` à sa
prochaine écriture.

**Décision** : `pref:set-field-visibility` applique un **patch** :
`next = { ...existant, ...views }`, puis toute clé dont la valeur reçue est `null` est supprimée.
Si l'entrée résultante est vide, elle est retirée de `fieldVisibility`.

- La Vue Système n'a rien à changer : elle envoie toutes les clés qu'elle gère, le résultat est
  identique à aujourd'hui pour ces clés, et les clés qu'elle ne connaît pas (`picker`,
  `showFoldersPicker`) sont préservées.
- Une clé `undefined` côté renderer disparaît à la sérialisation IPC/HTTP ⇒ « inchangée ». Aucun
  appelant actuel ne comptait sur l'effacement par omission (vérifié : seuls `SystemView` écrit,
  avec toutes ses clés).

**Problème induit — défaut d'équipe** : `pref:get-field-visibility` ne renvoie le défaut
d'équipe (GH45) que si l'entrée personnelle est absente. Écrire seulement `{ picker }` créerait
une entrée personnelle sans `excel`, et la Vue Excel perdrait le défaut d'équipe.

**Décision** : `get` renvoie `{ ...défautÉquipe, ...personnel }` (fusion par vue), `null` si les
deux sont absents. Le défaut d'équipe s'applique ainsi à toute vue non choisie personnellement.
C'est un léger élargissement (une entrée personnelle avec `excel` mais sans `word` prend
maintenant le `word` de l'équipe au lieu du défaut Polenta) qui va dans le sens de #139, sans le
corriger (le bouton Réinitialiser de la Vue Excel n'est pas touché).

**Alternatives rejetées**
- Lire-modifier-écrire côté renderer (relire la pref avant d'écrire) : course entre deux
  écritures, et la Vue Système resterait capable d'écraser `picker`.
- Nouveau canal `pref:set-picker-columns` / clé racine `pickerVisibility` dans le `.pref` :
  duplique la plomberie (IPC, politique web, api-client) pour un besoin qui se range
  naturellement par type dans `fieldVisibility`.

### Fichiers

| Fichier | Modification |
|---|---|
| `packages/api-client/src/types.ts` | `FieldVisibilityPref` : `picker?: string[]`, `showFoldersPicker?: boolean`. Nouveau type `FieldVisibilityPatch = { [K in keyof FieldVisibilityPref]?: FieldVisibilityPref[K] \| null }` ; `setFieldVisibility(…, views: FieldVisibilityPatch)` (un `FieldVisibilityPref` complet reste accepté). |
| `apps/desktop/src/main/ipc/pref.handlers.ts` | `set` : fusion + suppression des `null` + entrée vide retirée. `get` : fusion défaut d'équipe / personnel. Type du paramètre `views` : `FieldVisibilityPatch` (au lieu du littéral recopié). |
| `apps/desktop/src/main/services/pref-defaults.test.ts` | Cas de fusion (voir GH176-tests.md, U1–U5). |

Pas de changement de `channel-policy.ts` (canaux inchangés) ni de `team-config.ts` (pas de
défaut d'équipe pour le sélecteur — hors scope).

## 2. Panneau — extraction de `FieldConfigModal`

`FieldConfigModal` (≈ 270 lignes, privé à `SystemView.tsx`) est déplacé tel quel dans
`components/system/FieldConfigModal.tsx` et exporté. Ajouts de props, toutes facultatives pour
que l'appel de `SystemView` ne change que par l'import :

| Prop | Rôle | Défaut |
|---|---|---|
| `tabs?: ConfigTab[]` | onglets proposés ; un seul ⇒ barre d'onglets masquée | `['excel', 'word']` |
| `lockedFields?: Record<string, string>` | clé → infobulle : case cochée, `disabled`, infobulle ; `toggle` l'ignore | `{}` |
| `onReset?: () => void` | remplace l'action du bouton Réinitialiser | comportement actuel (`defaultFields` + titres de dossiers affichés) |
| `layer?: 'page' \| 'modal'` | `'modal'` : rendu en portail dans `document.body`, `z-[60]`, panneau ancré en haut à droite de la fenêtre (au-dessus de la modale `z-50`) ; gère lui-même `Échap` | `'page'` (inchangé) |

Avec `layer: 'modal'`, le panneau écoute `keydown` `Escape` sur `window` en **capture** et appelle
`stopImmediatePropagation()` puis `onClose()` : la modale (dont `useModalHotkeys` écoute en phase
bulle) ne reçoit pas l'événement. Par sûreté, `TestPickerModal` désactive aussi ses raccourcis
pendant que le panneau est ouvert (3ᵉ argument de `useModalHotkeys`).

**Alternative rejetée** : un composant « Colonnes du sélecteur » dédié. Il recopierait la liste
(champs, colonnes calculées éclatées, Étapes, liens, ⚠) et divergerait au premier ticket qui
touche le panneau (GH126 l'a déjà fait évoluer deux fois).

## 3. Sélecteur

### `TestPickerModal.tsx`

- État `columnsOpen` ; bouton ⚙️ (`title={t('system.fieldConfig.configureColumns')}`, même
  pictogramme que la Vue Système, `data-testid="picker-columns-button"`) à droite de
  `FilterOptionsToggle`, rendu seulement à l'étape 1, onglet Tests, quand une grille est affichée.
- Changement de type (combobox) ou d'onglet / passage à l'étape 2 ⇒ `columnsOpen = false`.
- `useModalHotkeys(requestCancel, undefined, confirmAbandon || columnsOpen)`.
- Passe `columnsOpen` / `onColumnsClose` à `TestPickerGrid`.

### `TestPickerGrid.tsx`

- Colonnes suivies : `basePicker = prefs?.picker ?? prefs?.excel ?? defaultVisibleFields(typeDef)` ;
  affichées : `withStatusColumn(basePicker)` (inchangé). Dossiers :
  `prefs?.showFoldersPicker ?? prefs?.showFoldersExcel ?? true`.
- `useComputedColumns` : `visibleKeys` = colonnes suivies, `discover: columnsOpen`.
- Écriture (mutation locale au composant) :
  - `onChange(fields)` ⇒ patch `{ picker: fields }` ;
  - `onChangeShowFolders(v)` ⇒ patch `{ showFoldersPicker: v }` ;
  - `onReset` ⇒ patch `{ picker: null, showFoldersPicker: null }`.
  Mise à jour **optimiste** du cache `['pref-visibility', repoPath, username, typeRef]`
  (`setQueryData` avec le patch appliqué, `null` ⇒ clé supprimée) avant l'appel IPC, pour un
  affichage immédiat ; en cas d'erreur, `invalidateQueries` sur la même clé. Le cache étant partagé
  avec la Vue Système, celle-ci re-dérive ses colonnes à l'identique (ses clés n'ont pas changé)
  et son `prefsRef` récupère `picker` — sans effet puisque le serveur fusionne.
- Le `toggle` du panneau part de la liste **suivie** (`basePicker`), pas de la liste affichée :
  la colonne Statut forcée n'est donc jamais écrite dans `picker` si l'utilisateur ne l'avait pas.
  `lockedFields = { status: t('campaignPage.picker.statusAlwaysShown') }`. Le panneau reçoit
  `withStatusColumn(basePicker)` comme `visibleFieldsExcel` pour que la case paraisse cochée ;
  `onChangeExcel` reçoit la liste issue du toggle, de laquelle on retire `status` s'il n'était pas
  dans `basePicker`.
- `ExcelView` garde `key={typeRef}` : changer de colonnes ne le remonte pas, la sélection
  (portée par la modale), le filtre global, les filtres colonne (état interne T51 indexé par
  colonne), le repli et les colonnes figées (états locaux du composant) sont conservés.
- Panneau : `<FieldConfigModal tabs={['excel']} layer="modal" lockedFields=… onReset=… />` avec
  `typeDef`, `objectTypeRef = typeRef`, `linkTypes = schema.linkTypes`, `computed.available` /
  `computed.panel`. Les onglets restent nommés `excel` dans le composant ; c'est le sélecteur
  qui route vers `picker`.

### i18n

`campaignPage.picker.statusAlwaysShown` (fr : « Toujours affichée dans le sélecteur : tous les
statuts sont proposés » ; en : « Always shown in the picker: tests of every status are
offered »). Les autres libellés viennent de `system.fieldConfig.*`.

## 4. SPEC à mettre à jour au dernier sprint

- `SPEC-TESTS.md` §4.1–4.2 (paragraphe Sélecteur de tests) : colonnes configurables, préférence propre.
- `SPEC-SYSTEM-VIEW.md` §Configuration des champs — sous-paragraphe « Sélecteur de tests (GH176) ».
- `SPEC-SYSTEM-VIEW.md` §Persistance : clés `picker` / `showFoldersPicker`, sémantique de fusion
  et `null`, fusion avec le défaut d'équipe à la lecture.
- `SPEC-INDEX.md` : colonne MAJ → GH176 pour ces lignes, mots-clés `picker`, `showFoldersPicker`.

## 5. Risques

- **Sémantique de `set` modifiée** : toute écriture future qui voudrait « oublier » une clé devra
  envoyer `null`. Documenté dans le JSDoc de `setFieldVisibility` et dans la SPEC.
- **Lecture fusionnée avec le défaut d'équipe** : les impressions (`print.tests.tsx`,
  `print.requirements.tsx`) lisent `excel`/`word` ; elles reçoivent désormais le défaut d'équipe
  pour une vue non choisie — cohérent avec l'écran.
- **Taille de `SystemView.tsx`** : l'extraction réduit le fichier, sans changer le comportement
  (couvert par les e2e GH70/GH126 existants du panneau).

## Sprint unique — périmètre

1. Types + handlers + tests unitaires (§1).
2. Extraction de `FieldConfigModal` + nouvelles props (§2).
3. Sélecteur : bouton, grille, persistance, Échap, i18n (§3).
4. e2e `e2e-web/gh176-picker-columns.spec.ts` (scénarios marqués e2e dans GH176-tests.md).
5. Mises à jour SPEC (§4).
