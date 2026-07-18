# T109 — Design

## Fichier modifié

`apps/desktop/src/renderer/routes/dashboard.tsx` — seul fichier touché. Aucun
changement d'API/IPC, aucun nouveau type, aucune migration de données : tout ce
dont on a besoin (liste des dashboards, ordre persisté, helper `orderItems`)
existe déjà et est utilisé tel quel par `DashboardPanel.tsx` /
`DashboardGrid.tsx`.

## Approche

1. Importer `orderItems` depuis `../components/sidebar/ReorderableSidebarSection`
   (déjà exporté et déjà réutilisé par `DashboardGrid.tsx:19` — pas de nouvel
   export à créer).

2. Dans `DashboardPage`, ajouter deux requêtes déjà utilisées ailleurs à
   l'identique (mêmes `queryKey`/`queryFn` que `DashboardPanel.tsx:111-121`, donc
   même cache React Query — pas de double fetch réseau si le panneau latéral est
   déjà monté) :

   ```ts
   const { data: dashboards = [], isLoading: dashboardsLoading } = useQuery({
     queryKey: ['dashboards', repoPath, username],
     queryFn: () => api.dashboards.list(repoPath, username),
     enabled: !!repoPath && !!username && !dashboardId,
   })
   const { data: dashboardsOrder = [], isLoading: orderLoading } = useQuery({
     queryKey: ['dashboards-order', repoPath, username],
     queryFn: () => api.dashboards.getOrder(repoPath, username),
     enabled: !!repoPath && !!username && !dashboardId,
   })
   ```

   `enabled: … && !dashboardId` : ces deux requêtes ne servent qu'au calcul du
   "premier dashboard" quand on n'a pas déjà un id explicite — pas de fetch
   superflu sur le chemin déjà-un-id (le cas le plus fréquent une fois la
   redirection faite).

3. `useEffect` de redirection :

   ```ts
   useEffect(() => {
     if (dashboardId || dashboardsLoading || orderLoading) return
     const first = orderItems(dashboards, dashboardsOrder)[0]
     if (first) navigate({ to: '/dashboard', search: { projectId, dashboardId: first.id }, replace: true })
   }, [dashboardId, dashboardsLoading, orderLoading, dashboards, dashboardsOrder, projectId, navigate])
   ```

   Ne dépend que de données déjà chargées ; ne se déclenche plus une fois
   `dashboardId` présent (guard `if (dashboardId) return`), donc pas de boucle.

4. Remplacer le bloc `if (!dashboardId) { … }` (lignes 141-149 actuelles) par :

   ```ts
   if (!dashboardId) {
     if (dashboardsLoading || orderLoading) {
       return <p className="text-sm text-ink-3 p-4">Chargement…</p>
     }
     if (dashboards.length === 0) {
       return (
         <div className="max-w-5xl p-6">
           <p className="text-sm text-ink-3">
             Sélectionnez un dashboard dans le panneau latéral, ou créez-en un avec le bouton "+".
           </p>
         </div>
       )
     }
     // dashboards.length > 0 : redirection en cours (effect ci-dessus) — état de
     // transition bref, pas de flash du message d'invite.
     return <p className="text-sm text-ink-3 p-4">Chargement…</p>
   }
   ```

   Le message d'invite ne reste affiché que dans le cas réellement vide (0
   dashboard), qui est le seul cas où l'effet ne redirige pas.

## Alternatives rejetées

- **Faire la redirection dans `DashboardPanel.tsx` (sidebar) plutôt que dans
  `dashboard.tsx`** — rejeté : `DashboardPanel` n'est monté que si la route
  affiche la sidebar Suivi, mais la logique "que faire quand on arrive sur
  `/dashboard` sans id" appartient à la page elle-même (c'est elle qui décide de
  son état sans id, cf. le bloc déjà existant lignes 141-149) ; garder la
  décision dans un seul endroit évite un couplage à double sens entre les deux
  composants.
- **Faire porter le "premier dashboard" par le backend (`dashboards.list`
  renverrait déjà trié, ou un champ `isDefault`)** — rejeté : le tri actuel
  (ordre persisté `dashboardsOrder`, ids inconnus en fin de liste) est déjà une
  logique purement front (`orderItems`), appliquée de façon identique aux
  widgets (`DashboardGrid.tsx`) et aux deux sections du panneau latéral ;
  dupliquer/déplacer cette règle côté serveur serait une divergence, pas une
  simplification, pour un besoin qui ne demande aucune donnée supplémentaire.
- **Rediriger de façon impérative depuis les appelants (`index.tsx`,
  `DashboardPanel.tsx` delete) plutôt que depuis `dashboard.tsx`** — rejeté :
  demanderait de dupliquer le calcul du "premier dashboard" (et le fetch
  dashboards/order) dans chaque appelant, alors que centraliser dans la page
  cible couvre les deux cas (et tout futur appelant) avec une seule
  implémentation.

## Découpage en sprints

Un seul sprint — un seul fichier modifié, aucune nouvelle interface, portée déjà
entièrement couverte ci-dessus.

## Refs SPEC

Inchangé par rapport à `specs/T109.md` : SPEC-ELECTRON-DESKTOP.md §16.3,
SPEC-DASHBOARDS.md §6 (mise à jour de la ligne §16.3 en fin de sprint, cf. §
"Mises à jour SPEC" de `WORKFLOW.md`).
