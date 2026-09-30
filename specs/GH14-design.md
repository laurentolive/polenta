# GH14 — Design technique

> Spec : [GH14.md](GH14.md) — **1 sprint**

Le changement se limite au renderer : pas d'IPC, pas de service, et aucun changement de
types dans `@polenta/types`.

## Fichiers modifiés

### 1. `components/sidebar/ReorderableSidebarSection.tsx` — section repliable

Seul `DashboardPanel.tsx` utilise ce composant. On remplace le prop `fillHeight` (ajouté
par T92 pour le mode onglets) par un contrôle de repli **piloté par le parent** :

```ts
interface Props<T> {
  // … props existants inchangés, sauf :
  // fillHeight?: boolean            ← supprimé
  collapsed: boolean
  onToggleCollapsed: () => void
}
```

- **En-tête** : le libellé `section-label` est enveloppé dans un `<button>` (pleine largeur
  moins le « + ») qui affiche `ChevronDown` (section dépliée) ou `ChevronRight`
  (section repliée), taille 12, puis le libellé. Le clic appelle `onToggleCollapsed`. Le
  bouton « + » reste à droite, hors de ce `<button>`, et reste actif quand la section
  est repliée.
- **Conteneur racine** :
  - section dépliée : `flex flex-col flex-1 min-h-0 border-b` → deux sections dépliées
    se partagent la hauteur à 50/50, et une seule dépliée prend tout le reste ;
  - section repliée : `shrink-0` ; seuls l'en-tête et la modale de suppression éventuelle
    sont rendus. Le filtre, le message d'erreur et la liste ne sont pas rendus.
- L'état interne (filtre, glisser-déposer, suppression en attente) reste dans le
  composant. Quand la section est repliée, le filtre en cours est conservé car le
  composant reste monté.
- Le `style={{ maxHeight: '50%' }}` du mode empilé d'avant T92 est supprimé : le partage
  de la hauteur passe désormais par `flex-1`.

### 2. `components/sidebar/DashboardPanel.tsx` — deux sections simultanées

- On supprime `type Tab`, `activeTab`, l'`useEffect` de synchronisation d'onglet, les deux
  boutons-icônes de l'en-tête et les imports `PieChart` / `SearchIcon`. L'en-tête ne
  garde que `<p className="section-label">Suivi</p>`.
- On ajoute un état `collapsed: { dashboards: boolean; queries: boolean }` :
  - lecture initiale depuis `localStorage['polenta:suiviCollapsed']` (JSON), dans un
    `try/catch` ; en cas de valeur absente ou invalide, on utilise
    `{ dashboards: false, queries: false }` ;
  - l'état est réécrit dans un `useEffect` à chaque changement, dans un `try/catch` ;
  - la clé est commune à tous les projets : c'est une préférence d'interface, sur le
    même principe que `polenta:excelRowMaxLines`.
- **Dépliage automatique** : un `useEffect` sur `[activeQueryId, activeDashboardId]`
  force `queries: false` quand `activeQueryId` est présent, et `dashboards: false` quand
  `activeDashboardId` est présent. Il remplace la synchronisation d'onglet de T92. La
  mise à jour renvoie l'objet précédent tel quel quand rien ne change, pour éviter un
  rendu inutile.
- Les deux `<ReorderableSidebarSection>` sont rendus l'un après l'autre (Dashboards,
  puis Requêtes), sans `fillHeight`, avec `collapsed` / `onToggleCollapsed`.

### 3. `routes/query.tsx` — retrait du bloc « Requêtes sauvegardées »

On supprime :
- l'état `savedFilter`, `deleteError`, `pendingDeleteQueryId` ;
- `deleteQueryMutation`, `pendingDeleteQuery`, l'`useModalHotkeys` de la modale de
  suppression ;
- `visibleSaved` ;
- le bloc JSX de la carte « Requêtes sauvegardées » et la modale de confirmation de
  suppression ;
- les imports devenus inutiles (`Trash2`, `Lock`, `Users2`, `Trans`, si plus aucun usage).

On conserve :
- la requête `savedQueries` (`['queries', …]`), toujours utile pour le titre d'onglet,
  `currentQueryName` et le chargement d'une requête par `queryId` ;
- `entryFilterText`, toujours utilisé par le filtre de l'historique.

La grille `grid grid-cols-2 gap-4` disparaît : la carte Historique est rendue directement
et occupe la pleine largeur du conteneur `max-w-5xl`.

Le commentaire d'en-tête du fichier est mis à jour : la vue contient l'éditeur, le
résultat, la sauvegarde, l'historique et l'export, mais plus la liste des requêtes
sauvegardées (GH14).

### 4. i18n `fr.json` / `en.json`

On retire les clés qui ne servent plus :
- `sidebar.dashboard.dashboardsTab` (seul `DashboardPanel` l'utilisait) ;
- `queryPage.savedQueriesCount`, `queryPage.savedQueriesCountFiltered`,
  `queryPage.noSavedQuery`, `queryPage.deleteQueryConfirmTitle`,
  `queryPage.deleteQueryConfirmBody`.

On conserve :
- `sidebar.dashboard.queriesTab` (titre du `ViewHeader` de `query.tsx`) ;
- `queryPage.noResultForFilter` (historique) ;
- `sidebar.dashboard.deleteFailed` (panneau).

Aucune nouvelle clé n'est nécessaire : les libellés de section
(`dashboardsLabel` / `queriesLabel`) existent déjà. Le bouton de repli prend
`aria-expanded` et n'a pas besoin de `title`.

## Décisions et alternatives rejetées

- **État de repli dans le parent plutôt que dans la section** : le parent doit pouvoir
  forcer le dépliage (élément actif) et persister les deux états sous une seule clé. Un
  état interne à la section obligerait à passer par un prop « forceOpen » et
  multiplierait les clés `localStorage`.
- **`localStorage` plutôt qu'un fichier de préférences** : l'état de repli est une
  préférence d'interface locale, pas une donnée projet. Il suit le précédent de
  `SystemView` et `AppLayout`.
- **Garder `fillHeight`** : rejeté. Avec `flex-1` sur chaque section dépliée, le
  partage 50/50 et le « prend tout » sont obtenus sans ce mode, qui n'aurait plus aucun
  appelant.
- **Splitter redimensionnable** : hors scope (spec).

## Découpage

Un seul sprint : les trois fichiers et l'i18n.
