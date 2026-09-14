# T158 — Design technique

## Principe

Une seule mécanique bas niveau dans `RichTextField`, câblée par chaque conteneur.

### 1. `RichTextField` — extension clavier + prop `onSubmit`

`apps/desktop/src/renderer/components/RichTextField.tsx`

- Nouvelle prop : `onSubmit?: () => void`.
- Ref stable `onSubmitRef` mis à jour à chaque render (`useEffect(() => { onSubmitRef.current = onSubmit })`) —
  pour ne pas recréer l'éditeur quand la closure `onSubmit` change.
- Nouvelle extension TipTap locale, créée une seule fois (`useRef(...).current`) :

  ```ts
  import { Extension } from '@tiptap/core'

  const SubmitOnModEnter = Extension.create({
    name: 'submitOnModEnter',
    priority: 1000, // > HardBreak/CodeBlock : notre keymap est enregistré en premier
    addKeyboardShortcuts() {
      return {
        'Mod-Enter': () => {
          if (onSubmitRef.current) { onSubmitRef.current(); return true }
          return false // aucun onSubmit → comportement HardBreak inchangé
        },
      }
    },
  })
  ```

  L'extension close sur `onSubmitRef` (ref du composant) — factory inline, pas d'options TipTap
  (les options seraient figées à la création de l'éditeur puisque `useEditor` ne rebâtit pas
  l'éditeur quand le tableau `extensions` change).
- Ajout de `SubmitOnModEnter` au tableau `extensions` de `useEditor`.
- `priority: 1000` : `ExtensionManager` trie les extensions par priorité décroissante avant
  d'enregistrer les plugins ProseMirror (keymaps compris). Notre plugin keymap passe donc
  avant celui de `HardBreak` (`Mod-Enter` → `setHardBreak`) et de `CodeBlock`
  (`Mod-Enter` → sortie de bloc). Quand `onSubmit` est fourni on renvoie `true` → l'évènement
  est consommé, les keymaps suivants ne s'exécutent pas. Sinon `false` → `HardBreak` reprend
  la main, aucun changement.
- `Shift-Enter` (aussi mappé sur `setHardBreak` par `HardBreak`) n'est pas touché.

**Pourquoi pas de fallback « blur » par défaut dans `RichTextField`** : garder le
comportement strictement inchangé pour tout champ non explicitement câblé (viewers, futurs
usages, champ `disabled`). Le fallback « blur » est porté par `StepsTable` uniquement
(voir §4).

### 2. `DynamicField` — passe-plat

`apps/desktop/src/renderer/components/DynamicField.tsx`

- Nouvelle prop `onSubmit?: () => void`, transmise **uniquement** à `RichTextField`
  (`field.type === 'richtext'`). Les autres types sont déjà couverts par `useModalHotkeys` /
  `Enter` natif / `requestSubmit`.

### 3. Conteneurs — câblage de `onSubmit` sur l'action primaire

| Fichier | Câblage |
|---|---|
| `components/system/ExcelView.tsx` (`activeRichtextPopover`, ~l.1833) | `onSubmit={() => setActiveRichtextPopover(null)}` — le `onChange` a déjà propagé la dernière frappe via `applyInlineEditToSelection`. Le handler `onKeyDown` `Ctrl+Enter` existant (l.1826) devient mort mais est **conservé** (garde-fou si le focus n'est pas dans l'éditeur) ou retiré — au choix du Dev, sans impact fonctionnel. |
| `components/system/WordView.tsx` (`EditableRichField`, ~l.220) | `onSubmit={commit}` |
| `components/system/EditView.tsx` (`FieldControl`, case `'richtext'`, ~l.68) | `onSubmit={() => onBlur(localVal)}` — même effet que le blur des autres types de champ (persiste via `onBlurField`). Le handler `window` `Ctrl+Enter` de `EditView` (l.432) devient inutile pour les richtext mais reste utile pour les autres inputs — **conservé**. |
| `routes/req.new.tsx`, `routes/test.new.tsx`, `routes/campaign.new.tsx` | `ref` sur le `<form>` ; `onSubmit={() => formRef.current?.requestSubmit()}` passé à chaque `DynamicField` (et `StepsTable` pour test.new). `requestSubmit()` déclenche `handleSubmit` + validation native. |
| `routes/req.$reqId.tsx` | `const submitEdit = () => { if (hasChanges && !saveMutation.isPending) saveMutation.mutate() }` ; passé à chaque `DynamicField`. |
| `routes/test.$testId.tsx` | `const submitEdit = () => { if (hasChanges && !saveMutation.isPending) handleSave() }` ; passé aux `DynamicField` et à `StepsTable`. |
| `routes/campaign.$campaignId.tsx` (édition des champs de campagne, ~l.343) | `onSubmit={() => { if (editingFields && !updateFieldsMutation.isPending) updateFieldsMutation.mutate(editingFields) }}` |
| `routes/campaign.$campaignId_.execute.$testId.tsx` (commentaires d'étape + notes globales, l.232 / l.260) | `onSubmit={() => { if (!executeMutation.isPending) executeMutation.mutate() }}` |

### 4. `StepsTable` — prop `onSubmit` + fallback blur

`apps/desktop/src/renderer/components/StepsTable.tsx`

- Nouvelle prop `onSubmit?: () => void`.
- Passée aux deux `RichTextField` (Action, Résultat attendu) ainsi :
  `onSubmit={onSubmit ?? blurActiveEditor}` où
  `const blurActiveEditor = () => { (document.activeElement as HTMLElement | null)?.blur() }`.
- Contextes où `onSubmit` est fourni : `test.new` (`requestSubmit`), `test.$testId` (`submitEdit`).
- Contextes sans `onSubmit` (panneaux d'étapes inline `ExcelView`/`WordView`/`SystemView`,
  qui auto-sauvent à chaque frappe et n'ont pas d'action primaire discrète) : `Ctrl+Entrée`
  sort du champ (blur) sans ajouter d'étape.

## Types / interfaces

Aucun type partagé (`@polenta/types`) modifié. Trois props locales `onSubmit?: () => void`
ajoutées (`RichTextField`, `DynamicField`, `StepsTable`).

## Alternatives rejetées

- **Laisser l'évènement remonter (`return false` + handlers `window`)** : fragile — dépend
  de la présence d'un handler `window` par contexte, et `useModalHotkeys` ignore
  volontairement `contentEditable`. Rejeté en phase Spec.
- **`SubmitOnModEnter.configure({ onSubmit })`** : les options TipTap sont figées à la
  création de l'éditeur (`useEditor` sans deps ne rebâtit pas), `this.options.onSubmit`
  serait périmé. D'où le passage par une ref.
- **Fallback blur global dans `RichTextField`** : changerait le comportement de champs non
  concernés (viewers, futurs usages). Cantonné à `StepsTable`.
- **Un seul `onSubmit` = « soumettre le formulaire » pour `StepsTable` inline** : pas de
  formulaire ni d'action primaire dans les panneaux d'étapes inline → blur est le seul
  équivalent sensé.

## Découpage

Un seul sprint. ~11 fichiers, changements mécaniques et localisés, pas de nouvelle
dépendance ni de migration de données.
