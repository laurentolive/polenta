# T43 — Scénarios de test

**Branche** : T43
**Worktree** : `../polenta-T43/`

---

## Scénarios nominaux (golden path)

### Sprint 1 — Fondations + Cahier d'exigences

1. **Icône export visible** : ouvrir la vue Exigences (`requirements.tsx`) → une icône Export apparaît
   dans le `ViewHeader`, à côté du bouton Publier.
2. **Popup de formats** : cliquer l'icône → popover affichant 3 icônes (Word/Excel/PDF), sans action tant
   qu'aucun format n'est choisi.
3. **Export Excel** : choisir Excel → dialogue natif "Enregistrer sous" s'ouvre, nom pré-rempli
   `{composant}-exigences-{commit}.xlsx` → confirmer → fichier `.xlsx` créé, une ligne par exigence
   actuellement affichée, colonnes correspondant aux champs clés (id, titre, statut, énoncé).
4. **Export Word** : même flux, format docx → fichier `.docx` créé, un titre par exigence avec ses champs
   (statut, énoncé EARS, critères d'acceptation) en corps de document.
5. **Export PDF** : même flux, format pdf → fichier `.pdf` créé, contenu visuellement équivalent à
   l'export Word (mise en page papier), généré via la route imprimable dédiée.
6. **Annulation du dialogue** : ouvrir le dialogue "Enregistrer sous" puis Annuler → aucun fichier créé,
   aucune erreur affichée, le popover se referme normalement.
7. **Périmètre filtré** : appliquer un filtre texte ou un filtre par type sur `requirements.tsx` (réduisant
   la liste affichée) → exporter → seules les exigences actuellement visibles apparaissent dans le
   fichier généré, pas la collection complète du composant.

### Sprint 2 — Cahier de test + Cahier/Rapport de campagne

8. **Cahier de test** : mêmes scénarios 1-7 reproduits sur `tests.tsx` (xlsx/docx/pdf, périmètre filtré).
9. **Cahier de campagne (plan)** : ouvrir une campagne → icône export "Cahier de campagne" → xlsx/docx/pdf
   disponibles → fichier généré liste les tests planifiés (`testCaseIds`) avec leurs champs, sans statut
   d'exécution.
10. **Rapport de campagne visible seulement si exécutée** : campagne sans aucun run (`runs` tous
    `pending` ou vide) → seule l'icône "Cahier de campagne" est visible, pas "Rapport de campagne".
11. **Rapport de campagne après exécution** : au moins un test exécuté (statut ≠ `pending`) → icône
    "Rapport de campagne" apparaît (docx/pdf uniquement) → fichier généré contient le statut
    (PASS/FAIL/BLOCKED/INCOMPLETE) de chaque test exécuté.

### Sprint 3 — Query, Impact analysis, Dashboard + nettoyage

12. **Export résultat de requête (xlsx)** : depuis `query.tsx`, exécuter une requête → exporter en xlsx via
    le nouveau bouton unifié → comportement identique à l'export existant (non régressé), nom par défaut
    `request-{nom}.xlsx`.
13. **Export résultat de requête (pdf)** : même résultat → exporter en pdf → fichier généré, tableau lisible.
14. **Export analyse d'impact** : ouvrir une analyse d'impact existante → exporter en xlsx ou pdf → fichier
    contient le diff des exigences changées et les statuts des éléments impactés tels qu'affichés, nom par
    défaut `impactAnalisys-{baselineOld}-{baselineNew}.{ext}`.
15. **Export dashboard** : ouvrir un dashboard avec au moins un widget graphique → exporter en docx ou pdf
    → fichier généré reflète les widgets et leurs données courantes, nom par défaut `dashboard-{nom}.{ext}`.
16. **Non-régression `queries:export-excel`** : l'ancien canal est retiré, aucun code renderer ne
    l'appelle plus (vérifier absence de référence après le sprint).

---

## Cas limites

- **Collection vide après filtrage** (0 exigence/test visible) : export génère un fichier valide mais vide
  (en-têtes seuls pour xlsx, document avec message "aucun élément" pour docx/pdf) plutôt qu'une erreur ou
  un fichier corrompu.
- **Champs richtext très longs ou avec tableaux/images intégrés** dans une exigence/test exportée en
  docx/pdf : ne doit pas planter le générateur — dégrader proprement si un élément richtext (ex. diagramme
  drawio embarqué) n'est pas convertible en docx (texte de substitution acceptable, à documenter comme
  limitation connue plutôt que planter).
- **Nom de fichier par défaut avec caractères invalides pour le système de fichiers** (ex. composant/titre
  contenant `/`, `:`, `?`) : les caractères interdits sont normalisés/retirés avant de pré-remplir le
  dialogue natif — pas de crash du dialogue `showSaveDialog`.
- **Chemin de destination non accessible en écriture** (dossier protégé, disque plein) : `ExportResult`
  remonte `{status:'error', message}` affiché à l'utilisateur, pas d'exception non gérée ni de fenêtre
  Electron qui reste ouverte en arrière-plan.
- **Fenêtre cachée PDF qui ne charge jamais** (route `/print/*` en erreur, timeout réseau/IPC interne) :
  timeout explicite côté `pdf.util.ts` → `{status:'error'}` plutôt qu'un process qui reste bloqué
  indéfiniment ; la `BrowserWindow` cachée est toujours détruite (`destroy()`) même en cas d'échec, pour ne
  pas fuiter de fenêtres invisibles.
- **Deux exports lancés en parallèle** (ex. clic rapide sur deux formats différents, ou deux vues) :
  chaque export utilise sa propre `BrowserWindow` cachée / son propre appel — pas d'état partagé mutable
  entre exports concurrents côté main process.
- **Campagne avec runs mixtes** (certains tests `pending`, d'autres exécutés) : le rapport de campagne
  n'inclut que les tests réellement exécutés, ou affiche explicitement "non exécuté" pour les tests
  `pending` restants — pas d'omission silencieuse.
- **Analyse d'impact avec arbre montant vide** (cf. T46) : l'export reflète fidèlement l'absence d'arbre
  montant (pas de section vide trompeuse).
- **Dashboard avec un widget en erreur** (requête sous-jacente supprimée, cf. T77) : l'export du dashboard
  n'échoue pas globalement à cause d'un seul widget cassé — affiche l'état d'erreur de ce widget comme à
  l'écran.
- **`{baseline|commit}` sur un repo sans commit** (repo git vierge, cas théorique) : repli sur un
  identifiant explicite (ex. `sans-commit`) plutôt qu'un nom de fichier invalide/vide.
- **Composant sans label explicite** (nom de nœud technique uniquement) : repli sur le nom technique du
  nœud pour `{composant}` dans le nom de fichier.

---

## Critères d'acceptation vérifiables (rappel, cf. `T43.md`)

Chaque scénario nominal ci-dessus correspond à un critère mesurable de `specs/T43.md` §Critères
d'acceptation — pas de duplication ici, se référer à ce fichier pour la liste normative complète.
