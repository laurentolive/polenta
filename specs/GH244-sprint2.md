# GH244 — Sprint 2 : interface

## Fichiers modifiés

- `AppLayout`, `ActivityBar`, `Sidebar`, `TabsContext`, `SystemPanel`, `useSystemObjects`, `normalizeObject`, `SystemView`, `EditView` : panneau Issues, vues Tableau et Document, fiche.
- `StructureTab`, `objectTypeEditor`, `NoTypeForCategory`, `SchemaDeleteConfirmModal`, `objectCategoryColors` : « + Issue », statuts par défaut.
- `routes/schema.tsx` : `issue` proposé dans les refs de lien ; brouillon de l'onglet Liens réaligné quand le schéma change hors de lui.
- `VersionChangesTable`, `versions_.backlog`, `VersionElementPicker`, `TestPickerGrid`, `VersionAnalysisSection` : issue dans une version, « via … » sur la racine.
- `ElementPreviewPopup`, `useLiveFileSync`, i18n. Libellé `validated` : « Vérifié » / « Verified ».

## Divergences par rapport au design

- Brouillon de l'onglet Liens : défaut constaté à la revue (il aurait retiré `issue-impact` à l'enregistrement).
- Origine affichée en texte (IDs d'exécution), sans lien : une exécution n'a pas de page propre hors de sa campagne.
