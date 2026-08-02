# T111 — Scénarios de test

## Sprint 1 — Infrastructure + coquille applicative

### Golden path
1. Lancer l'app (`pnpm dev` desktop) sans avoir jamais changé de langue → l'UI s'affiche
   entièrement en français (comportement actuel inchangé).
2. Ouvrir le panneau Compte → un contrôle "Langue" est visible, à côté du toggle thème.
3. Cliquer "English" → toute l'UI actuellement montée (ActivityBar, Sidebar, TabBar,
   AccountPanel lui-même, écran de login/accueil si affiché) bascule immédiatement en
   anglais, sans rechargement de fenêtre ni clignotement de contenu non traduit.
4. Naviguer vers une autre vue (ex. Projet) puis revenir au panneau Compte → le contrôle
   de langue reflète toujours "English" sélectionné.
5. Fermer et relancer l'app → l'UI démarre directement en anglais (persistance
   `localStorage`).
6. Repasser en "Français" → repasse immédiatement, `localStorage` mis à jour.

### Cas limites
- `localStorage` contient une valeur invalide pour `polenta:locale` (ex. `"de"`, chaîne
  vide, valeur corrompue) → l'app démarre en français (fallback), pas de crash.
- Deux fenêtres Electron ouvertes simultanément (l'app le permet déjà, cf. T101) : changer
  la langue dans une fenêtre ne change **pas** la langue de l'autre fenêtre déjà ouverte
  (chaque fenêtre lit `localStorage` à son propre démarrage — pas de synchronisation
  live inter-fenêtres attendue pour ce ticket, à documenter comme limite connue si
  constatée).
- Écran de login (`routes/login.tsx`, avant tout projet chargé) : le sélecteur de langue
  doit rester accessible même sans projet ouvert (le panneau Compte existe hors contexte
  projet) — vérifier qu'aucun texte de l'écran de démarrage ne reste figé en français
  quand la langue anglaise est active.

## Sprint 2 — Panneaux latéraux + Projet/Modèle de données

### Golden path
1. Langue anglaise active → ouvrir chaque panneau latéral (Projet, Suivi, Exigences,
   Tests, Version, Recherche, Système) → tous les libellés, boutons, en-têtes de section
   sont en anglais.
2. Ouvrir `StructureTab.tsx` (onglet Structure), les modales `AddDependencyModal`,
   `ElementConfigModal`, `RemoveDependencyModal` → contenu et boutons (Confirmer/Annuler)
   en anglais.
3. `RepoBranchSelector` (sélecteur de branche) : libellés d'état (chargement, erreur,
   liste vide) traduits.

### Cas limites
- Panneau Version : composants `version/*` (BranchCombobox, FileList, GitRefCombobox,
  PinPropagationWarning, VersionCompareSelector, VersionImpactSelector,
  VersionRepoFolder) — messages d'avertissement (ex. `PinPropagationWarning`) souvent
  construits par concaténation de chaînes + nom de branche/fichier : vérifier que
  l'interpolation (`t('key', { branch })`) ne casse pas la mise en forme (ex. guillemets,
  gras) attendue par le composant.
- Liste vide / état de chargement dans chaque panneau (ex. "Aucun résultat", "Chargement…")
  traduits dans les deux langues, pas seulement le contenu non-vide.

## Sprint 3 — Vue Système (exigences, tests, campagnes)

### Golden path
1. Langue anglaise active → ouvrir une exigence en édition (`EditView.tsx`) → labels de
   champs système (Statut, Priorité…), boutons (Enregistrer/Annuler/Supprimer) en anglais ;
   le **contenu métier** de l'exigence (statement, rationale saisis par l'utilisateur en
   français) reste inchangé, non traduit (cf. spec, hors périmètre).
2. `ExcelView`/`WordView` (vues tableau/document) : en-têtes de colonnes système
   (ID, Statut, Priorité) traduits ; les valeurs de champs personnalisés définis dans
   `schema.yaml` (labels de `fields`, de `statuses`) **ne sont pas traduits** — ce sont des
   données projet, pas de l'UI Polenta (cf. spec § Couverture).
3. Créer/exécuter un test (`test.new.tsx`, `campaign.*.execute/run`) → `StepsTable`,
   `TestParamFields`, boutons d'exécution (Pass/Fail/Blocked) traduits.

### Cas limites
- `RichTextToolbar`/`LinkCombobox` : tooltips et titres d'icônes (souvent portés par
  l'attribut `title=""`, pas du texte visible) doivent aussi être traduits — vérifier
  qu'ils ne sont pas oubliés lors du grep de contrôle du sprint.
- Distinction à vérifier composant par composant : un libellé de **statut** provenant de
  `schema.yaml` (`statuses[].label`, ex. "Brouillon"/"Approuvé" définis par le projet) ne
  doit jamais passer par `t()` — seul le texte fixe autour (ex. "Statut :") l'est. Risque
  de confusion identifié en Sprint 3 car c'est la zone où données projet et UI Polenta sont
  le plus proches visuellement.

## Sprint 4 — Dashboards, traçabilité/versioning, export, impression

### Golden path
1. Langue anglaise active → `dashboard.tsx`, `query.tsx` : titres de widgets, bouton
   "+ Ajouter un widget", `QueryBuilder`, `WidgetConfigModal` en anglais ; les noms de
   dashboards/requêtes créés par l'utilisateur restent inchangés (données, pas UI).
2. `graph.tsx`, `baseline.tsx`, `impact-analysis.tsx`, `version-diff.tsx`,
   `compliance.tsx` : légendes, filtres, en-têtes de matrice traduits.
3. Export : `ExportButton.tsx` (menu d'export PDF/DOCX/XLSX), `exportFilenames.ts` — les
   libellés de menu sont traduits ; les **noms de fichiers générés** restent identiques
   quelle que soit la langue UI (pas de changement de nommage de fichier attendu, sauf si
   le Sprint révèle que `exportFilenames.ts` contient déjà des libellés français dans le
   nom du fichier lui-même — à trancher au cas par cas en gardant la stabilité du nommage
   comme défaut).
4. Vues d'impression (`print.*.tsx`, 7 routes) : rendu HTML imprimé/exporté en PDF
   entièrement dans la langue active au moment de l'impression.

### Cas limites
- Vues d'impression : elles sont rendues hors du chrome applicatif normal
  (`routes/print.*.tsx`, montées sans `AppLayout`) — vérifier que `i18n/index.ts` est bien
  initialisé aussi sur ce chemin de rendu (pas de dépendance implicite à un montage via
  `AppLayout`/`main.tsx` uniquement, sachant que print.*.tsx pourrait être rendu dans un
  contexte Electron `printToPDF` séparé — à vérifier lors de l'implémentation, cf. mots-clés
  `SPEC-ELECTRON-DESKTOP.md §19.13`).
- `ComplianceMatrix.tsx`, `DiamondConflictModal.tsx` : matrices avec beaucoup de texte
  dense (cellules de statut croisées) — vérifier qu'aucun libellé de cellule ne dépasse
  visuellement en anglais (langue généralement plus courte que le français, donc risque
  surtout inverse : à surveiller si un jour d'autres langues plus longues sont ajoutées,
  non bloquant pour FR/EN).

## Critères d'acceptation globaux (vérifiés au dernier sprint)

Repris de `specs/T111.md` § Critères d'acceptation — revue exhaustive finale :
1. Sélecteur de langue visible et fonctionnel dans `AccountPanel.tsx`.
2. Bascule FR ⇄ EN immédiate, sans rechargement de fenêtre.
3. Persistance `localStorage` entre deux lancements.
4. Défaut = français en l'absence de choix explicite.
5. Grep final sur l'ensemble de `apps/desktop/src/renderer/{routes,components}` : aucune
   chaîne française évidente restante en dehors des fichiers `i18n/locales/fr.json` et du
   contenu métier légitimement non traduit.
6. Contenu métier (exigences/tests/composants saisis par l'utilisateur) jamais traduit
   automatiquement.
7. `apps/desktop/src/main/menu.ts` non modifié par ce ticket (diff de contrôle en fin de
   Sprint 4).
8. `pnpm typecheck` propre après chaque sprint.
