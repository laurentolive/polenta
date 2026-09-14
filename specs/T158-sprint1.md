# T158 — Sprint 1 (unique)

## Fichiers modifiés

### Composant central
- `apps/desktop/src/renderer/components/RichTextField.tsx`
  - prop `onSubmit?: () => void`
  - ref `onSubmitRef` (maj à chaque render) + extension TipTap `submitOnModEnter`
    (`priority: 1000`, initialiseur paresseux `useState`) qui capte `Mod-Enter` :
    `onSubmit` fourni → appel + `return true` (évènement consommé) ; sinon `return false`
    (comportement `HardBreak` inchangé).

### Passe-plats
- `apps/desktop/src/renderer/components/DynamicField.tsx` — prop `onSubmit`, transmise au
  seul `RichTextField` (`field.type === 'richtext'`).
- `apps/desktop/src/renderer/components/StepsTable.tsx` — prop `onSubmit` ; les deux
  `RichTextField` (Action / Résultat attendu) reçoivent `onSubmit ?? submitCell`, où
  `submitCell` fait un `blur` de l'élément actif (fallback pour les panneaux d'étapes inline
  sans action primaire). N'ajoute jamais d'étape.

### Câblage conteneurs
- `components/system/ExcelView.tsx` — popover richtext : `onSubmit={() => setActiveRichtextPopover(null)}`.
  Le handler `onKeyDown` `Ctrl+Enter` du conteneur est conservé (garde-fou hors éditeur, désormais
  redondant avec le chemin TipTap).
- `components/system/WordView.tsx` — `EditableRichField` : `onSubmit={commit}`.
- `components/system/EditView.tsx` — `FieldControl` case `richtext` : `onSubmit={() => onBlur(localVal)}`
  (même effet que le blur des autres types de champ).
- `routes/req.new.tsx`, `routes/test.new.tsx`, `routes/campaign.new.tsx` — extraction d'un
  `submitForm()` depuis `handleSubmit(e)` (même logique + garde `isDisabled`/`isPending`),
  passé aux `DynamicField` (et `StepsTable` pour test.new).
- `routes/req.$reqId.tsx` — `submitEdit = () => { if (hasChanges && !saveMutation.isPending) saveMutation.mutate() }`.
- `routes/test.$testId.tsx` — `submitEdit = () => { if (hasChanges && !saveMutation.isPending) handleSave() }`,
  passé aux `DynamicField` et à `StepsTable`.
- `routes/campaign.$campaignId.tsx` — édition des champs de campagne :
  `onSubmit={() => { if (editingFields && !updateFieldsMutation.isPending) updateFieldsMutation.mutate(editingFields) }}`.
- `routes/campaign.$campaignId_.execute.$testId.tsx` — `submitExecution = () => { if (!executeMutation.isPending) executeMutation.mutate() }`,
  passé aux commentaires d'étape et aux notes globales.

## Comportement implémenté

Conforme à `specs/T158.md` et au tableau de `specs/T158-design.md`. `Ctrl/Cmd+Entrée`
dans un champ richtext en édition valide l'action primaire du contexte ; `Maj+Entrée` et
`Entrée` inchangés ; champs en lecture seule inchangés.

## Divergences par rapport au design

Aucune. Le design prévoyait `formRef.current?.requestSubmit()` pour les formulaires de
création ; remplacé par l'extraction d'un `submitForm()` appelé directement (la validation
de ces formulaires est manuelle, pas via l'API native `required` — équivalent fonctionnel,
sans ref sur le `<form>`).

## Mises à jour SPEC effectuées

- **`SPEC-REQ-requirements.md` §3.2e (nouvelle)** — documentation du raccourci
  `Ctrl/Cmd+Entrée` = « valider la saisie » dans un champ `richtext` : tableau par contexte
  d'édition, mécanique (extension `submitOnModEnter` + prop `onSubmit`), tradeoff sortie de
  bloc de code.
- **`SPEC-INDEX.md`** — ligne `SPEC-REQ-requirements.md §3` : ajout de la mention §3.2e et
  des mots-clés (`raccourci`, `Ctrl+Entrée`, `Mod-Enter`, `onSubmit`, `valider`), colonne
  `MAJ` → `T158`.
- `SPEC-ELECTRON-DESKTOP.md` §19.1/§19.3 (consulté, `## Refs SPEC`) : **non modifié** — ces
  sections décrivent la barre d'onglets (Ctrl+T/Ctrl+W) ; le raccourci richtext a sa place
  naturelle dans SPEC-REQ §3.2e.

## Contrôles

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → exit 0.
- `/code-review high` ciblé sur le worktree → `[]` (aucun finding). Vérifs faites par la
  revue : ordre des keymaps par priorité dans `@tiptap/core` 2.27.2, `useEditor` ne
  recrée pas l'éditeur, `Shift-Enter` préservé, chaque `onSubmit` aligné sur le handler du
  bouton primaire correspondant, champs `disabled` non focusables.
- Pas de test unitaire automatisé ajouté (comportement clavier UI — voir `specs/T158-tests.md`,
  9 scénarios manuels).

## Comment tester manuellement

Voir `specs/T158-tests.md` (S1 à S9 + cas limites L1–L5). Résumé : dans chaque contexte
d'édition richtext, taper du texte puis `Ctrl+Entrée` → l'action primaire du contexte se
déclenche (fermeture popover / commit / création / enregistrement) ; `Maj+Entrée` insère
toujours un saut de ligne.
