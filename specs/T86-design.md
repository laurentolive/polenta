# T86-design — Suppression Tableau de bord/Droits, branche d'intégration + sélecteur de branche dans l'arbre Structure

## 1. Vue d'ensemble

Aucun nouveau canal IPC n'est nécessaire : tout ce dont on a besoin existe déjà côté `api.sync.*` (branches/tags/checkout/createBranch, déjà utilisé par `VersionRepoFolder`) et `api.baseline.get/setIntegrationBranch` (déjà utilisé par `IntBranchSelector`). Le travail est intégralement côté renderer :

1. Retrait de route/nav (`/project/$id`, `SyncBar`, entrées de sidebar).
2. Ré-atterrissage de tous les points d'entrée qui visaient `/project/$id` sur `/schema` (devient de facto la page "projet" par défaut).
3. Déplacement + renommage de `IntBranchSelector` → widget "Branche d'intégration" dans `StructureTab`, uniquement sur la ligne du repo root.
4. Nouveau sélecteur de branche compact, par ligne de repo (root + composants + interfaces), avec gate `dev-*` — construit sur un hook extrait de `VersionRepoFolder` pour ne pas dupliquer la logique de checkout/création.

Découverte importante en analysant l'impact : `/project/$id` n'est pas qu'un lien de sidebar, c'est **la destination par défaut après ouverture d'un projet** (démarrage à froid avec dernier projet ouvert, création/clone, "Récents") et la cible de plusieurs boutons "Retour"/"← Projet" dans les vues détail (exigence, test). Tous ces points doivent être ré-aiguillés — cf. §2.5.

---

## 2. Fichiers à modifier

### 2.1 Suppression

- **`apps/desktop/src/renderer/routes/project.$id.tsx`** — supprimé entièrement (route + `IntBranchSelector` + `ProjectPage`). Le composant `IntBranchSelector` est déplacé (pas juste supprimé, voir §2.3).
- **`apps/desktop/src/renderer/components/SyncBar.tsx`** — supprimé entièrement (plus aucun appelant après suppression de la route ; redondant avec le commit/push par repo déjà dans `VersionRepoFolder`, root compris).
- **`apps/desktop/src/renderer/components/sidebar/ProjectPanel.tsx`** — dans `WithProjectPanel` (lignes ~116-141), retirer le `<Link to="/project/$id">` "Tableau de bord" et le stub désactivé "Droits (bientôt)". Il ne reste que le lien "Modèle de données".
- **`routeTree.gen.ts`** — fichier généré par le plugin TanStack Router : se régénère automatiquement au prochain `dev`/`build` une fois `project.$id.tsx` supprimé. Ne pas l'éditer à la main ; vérifier simplement qu'il ne référence plus `/project/$id` après un build.

### 2.2 `apps/desktop/src/renderer/routes/schema.tsx`

- **Repli automatique de `repoPath`** : `/schema` devient la destination par défaut après ouverture d'un projet, mais son `validateSearch` exige aujourd'hui un `repoPath` déjà résolu — que tous les points d'entrée n'ont pas forcément sous la main (ex: `AppLayout`, `HomePage` ne connaissent que le `projectId`/`workspaceDir` encodé). Reprendre la résolution que faisait `project.$id.tsx` (`useQuery(['workspace', id], () => api.workspace.resolve(decodeProjectId(id)))`) directement dans `SchemaEditorPage` : si `repoPath` (search param) est vide et `projectId` est présent, résoudre `project.localPath` et l'utiliser. Les hooks `useProjectSchema`/`useWorkspaceStructure` sont déjà gate-és par `enabled: !!repoPath`, donc ce repli est purement additif, pas de risque de régression sur le cas où `repoPath` est déjà fourni (ex: navigation depuis `ProjectPanel`).
- **Retrait du bouton "← Projet"** (header, ligne ~432-436) : il n'a plus de destination logique — `/schema` est maintenant lui-même la page "projet". Supprimer purement ce bouton (pas de retarget).

### 2.3 `apps/desktop/src/renderer/components/schema/StructureTab.tsx`

- **`handleDiamondCancel`** (ligne ~807-810) : retirer l'appel `navigate({ to: '/project/$id', ... })`. Le `setLocalConflicts(null)` suffit à fermer la modale ; on reste sur l'onglet Structure (déjà l'écran courant), pas de destination de repli à chercher.
- **Nouveau import** : `IntegrationBranchSelector` (§2.4) et `RepoBranchSelector` (§2.5).
- **`RepoRow`** : sur la ligne principale (`flex items-center gap-2 ...`, avant le groupe `ml-auto`), ajouter :
  ```tsx
  <RepoBranchSelector repoPath={node.repoPath} />
  ```
  pour **toutes** les lignes (root et enfants) — juste après l'affichage du `pin` existant, avant le groupe d'actions `ml-auto`.
  - **Ligne root uniquement** (`!parentRepoPath`) : sous la ligne principale (nouvelle ligne, même indentation que les avertissements "non associé à un repo"), afficher `<IntegrationBranchSelector repoPath={node.repoPath} />`. Choix de layout : ne pas le caser dans la ligne principale déjà chargée (nom, pin, nouveau `RepoBranchSelector`, bouton crayon) — le widget "Branche d'intégration" est un bloc large (select + bouton "Définir comme..." + bandeau lecture-seule potentiel), il a sa propre ligne, sur le modèle des lignes secondaires déjà utilisées pour les avertissements de nœud orphelin.

### 2.4 Nouveau : `apps/desktop/src/renderer/components/schema/IntegrationBranchSelector.tsx`

Déplacement quasi verbatim de `IntBranchSelector` (`project.$id.tsx:15-136`) :
- Renommé `IntegrationBranchSelector`.
- Le chip `<span>Baseline</span>` (ligne 74) devient `<span>Branche d'intégration</span>`.
- Comportement inchangé : liste/sélection/création de branches `int-*` (`api.sync.branches` filtré `type === 'int'`), bouton "Définir comme branche d'intégration" (`api.baseline.setIntegrationBranch`) visible seulement si la branche `int-*` courante diffère de l'intégration configurée, sous-texte "Intégration configurée : …" (`useIntegrationBranch`), bandeau "Lecture seule" (`useVersioning().isReadonly`).
- **Point d'attention** : `useVersioning()` est un contexte scoped **root uniquement** (`VersioningContext.tsx`, une seule query `sync:status` sur le repo root du projet). Comme ce widget ne s'affiche que sur la ligne root (`!parentRepoPath` ⇒ `node.repoPath` === repo root), c'est cohérent tel quel — pas besoin de généraliser `useVersioning` à un `repoPath` arbitraire pour ce ticket.

### 2.5 Nouveau : `apps/desktop/src/renderer/hooks/useBranchCheckout.ts`

Extrait de la logique aujourd'hui inline dans `VersionRepoFolder.tsx` (lignes ~39-87 : query `sync:status`, `sync:branches`, `sync:tags`, mutations checkout/create/delete + invalidation). Signature :
```ts
function useBranchCheckout(repoPath: string): {
  currentBranch: string
  allBranches: BranchInfo[]
  allTags: string[]
  isDirty: boolean
  checkout: (name: string) => void
  createBranch: (name: string) => void
  deleteBranch: (name: string) => void
  isPending: boolean
}
```
- `VersionRepoFolder.tsx` est refactorisé pour consommer ce hook au lieu de sa copie inline — **aucun changement de comportement** dans le panneau Version (reste l'outil "avancé", sans restriction `dev-*`/`int-*`, cf. §2.6).
- Query branches/tags : contrairement à `VersionRepoFolder` (`enabled: !!repoPath && open`, gaté par l'ouverture du dossier), dans `StructureTab` les lignes sont ouvertes par défaut jusqu'à depth 2 (`useState(depth < 2)`) — le hook n'a pas d'opinion sur `enabled`, c'est le composant appelant qui passe son propre état `open` si besoin (paramètre optionnel `enabled?: boolean`, défaut `true`).

### 2.6 Nouveau : `apps/desktop/src/renderer/components/schema/RepoBranchSelector.tsx`

Composant compact, une ligne, réutilisé pour chaque repo de l'arbre Structure (root inclus) :
```tsx
function RepoBranchSelector({ repoPath }: { repoPath: string }) {
  const { currentBranch, allBranches, allTags, checkout, createBranch, deleteBranch, isPending } = useBranchCheckout(repoPath)
  if (currentBranch.startsWith('dev-')) {
    return <code className="text-xs text-ink-3 font-mono" title="Modification en cours — changez de branche via Publier/Annuler">{currentBranch}</code>
  }
  return (
    <div className="w-36 shrink-0" onClick={e => e.stopPropagation()}>
      <BranchCombobox
        branches={allBranches} tags={allTags} currentBranch={currentBranch}
        onCheckout={checkout} onDelete={deleteBranch} onCreateNew={createBranch}
        isPending={isPending}
      />
    </div>
  )
}
```
- **Gate `dev-*`** (règle du ticket) : sur une branche `dev-*`, pas de `BranchCombobox` du tout — juste le nom en lecture seule. Changer de branche pendant une modification en cours passe exclusivement par "Publier"/"Annuler" (T83), jamais par ce sélecteur.
- **`int-*`** : le sélecteur reste pleinement interactif (choisir une autre branche `int-*` existante, ou en créer une) — seule l'**édition de contenu** du repo reste lecture-seule sur `int-*` (comportement déjà géré ailleurs, `VersioningContext.isReadonly`/`useModificationMode`, inchangé par ce ticket).
- `onClick={e => e.stopPropagation()}` : nécessaire car la ligne parente (`RepoRow`) a `onClick={() => setOpen(v => !v)}` sur toute sa largeur (plier/déplier) — même pattern déjà utilisé par `AddMenu` (`onClick={e => e.stopPropagation()}` ligne ~145).
- Largeur fixe (`w-36`) : `BranchCombobox` a `flex-1` codé en dur sur sa racine, sans effet hors d'un parent flex — le wrapper `w-36 shrink-0` (non-flex) borne la largeur de l'`<input>` interne (`w-full`) sans toucher au composant partagé avec le panneau Version.

### 2.7 Ré-aiguillage des anciens points d'entrée `/project/$id` → `/schema`

Tous les appels suivants remplacent `navigate({ to: '/project/$id', params: { id } })` / `<Link to="/project/$id" params={{ id }}>` par `navigate({ to: '/schema', search: { repoPath, projectId } })` (ou juste `{ projectId }` quand `repoPath` n'est pas déjà en scope — cf. §2.2, résolu côté `/schema`) :

| Fichier | Contexte actuel |
|---|---|
| `components/layout/AppLayout.tsx:108-114` | Clic sur l'icône "Projet" de l'ActivityBar |
| `routes/index.tsx:41-45` | Redirection à froid vers le dernier projet ouvert |
| `routes/index.tsx:61-64` (`goToProject`) | Après ouverture/clone/création d'un projet |
| `routes/index.tsx:121-130` | Lien "Récents" |
| `routes/req.$reqId.tsx:182` | Bouton "Retour" |
| `routes/req.new.tsx:148` | Bouton "Retour" |
| `routes/test.$testId.tsx:213` | Bouton "Retour" |
| `routes/test.new.tsx:180` | Bouton "Retour" |

`ProjectPanel.tsx` a déjà son propre lien "Modèle de données" vers `/schema` avec `repoPath`+`projectId` — sert de référence pour le search param.

---

## 3. Décisions techniques et alternatives rejetées

- **`/schema` comme nouvelle page d'atterrissage par défaut, plutôt qu'une nouvelle route "accueil projet" dédiée** : évite de recréer une troisième route juste pour porter le résultat de résolution `projectId → repoPath` ; `/schema` a déjà cette logique en germe (search params `repoPath`/`projectId`), il ne manque que le repli quand `repoPath` est absent (§2.2). Alternative rejetée : garder `/project/$id` comme simple redirecteur transparent vers `/schema` — rejetée, ça laisserait une route fantôme et un aller-retour de navigation inutile.
- **Widget "Branche d'intégration" sur sa propre ligne, pas dans la ligne principale du root** : la ligne principale accueille déjà nom, icône, badge interface, pin, nouveau `RepoBranchSelector`, crayon de renommage — y ajouter le chip large "Branche d'intégration" (select + bouton conditionnel + bandeau lecture seule) la surchargerait. Cohérent avec le pattern existant de lignes secondaires sous une ligne de repo (avertissements de nœud orphelin).
- **`RepoBranchSelector` réutilise `BranchCombobox` tel quel plutôt qu'une variante allégée** : `BranchCombobox` gère déjà filtre, création, suppression, badges `int`/`tag` — dupliquer cette logique dans un composant "compact" séparé serait la duplication que T78 avait justement factorisée. Seule la largeur change (via wrapper), pas le composant.
- **Gate `dev-*` dans `RepoBranchSelector` (nouveau composant), pas dans `BranchCombobox` lui-même** : `BranchCombobox` reste utilisé tel quel par `VersionRepoFolder` dans le panneau Version, qui est délibérément l'outil "avancé" sans cette restriction (cf. T84 : "renvoyer vers la vue Version en mode avancé"). Ajouter la contrainte `dev-*` dans `BranchCombobox` fuiterait une règle de la vue Structure vers un composant partagé utilisé dans un contexte où elle ne s'applique pas.
- **`useBranchCheckout` extrait plutôt que dupliqué** : `RepoBranchSelector` a besoin exactement de la même mécanique (branches/tags/checkout/create/delete) que `VersionRepoFolder` — extraire évite ~40 lignes dupliquées et une dérive future entre les deux (ex: un correctif de bug de checkout appliqué à un seul des deux). `VersionRepoFolder` est refactorisé pour consommer le hook, sans changement de comportement (couvert par les scénarios non-régression de `specs/T86-tests.md`).
- **Suppression pure du bouton "← Projet" dans `schema.tsx`, pas de retarget** : maintenant que `/schema` est la page projet, un bouton "retour au projet" à l'intérieur de la page projet elle-même n'a plus de sens.

## 4. Découpage en sprints

**Un seul sprint.** Le périmètre est mécanique (suppression, ré-aiguillage de navigation, extraction de hook, un nouveau petit composant de sélection + un déplacement de composant existant) sans nouvelle donnée serveur ni nouveau canal IPC. Rien ne justifie un découpage supplémentaire.
