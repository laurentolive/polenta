# T101-design — Gestion des onglets (tabs) façon Firefox

## 1. Vue d'ensemble du découpage

Deux sprints :

- **Sprint 1 — Cœur de la fonctionnalité** : modèle d'onglet, `TabsProvider`,
  barre d'onglets (ouverture/fermeture/switch/menu déroulant+filtre/récemment
  fermés), raccourcis Ctrl+T/Ctrl+W, retrait de l'accélérateur Electron
  `CmdOrCtrl+W`, titres par défaut (mapping statique par route), règle
  "toujours au moins un onglet", scoping par fenêtre, comportement au
  changement/fermeture de projet.
- **Sprint 2 — Détection de modification non enregistrée + confirmation de
  fermeture** : généralisation du pattern `isDirty` déjà présent dans
  `schema.tsx` via un hook partagé, filet de sécurité générique (élément
  éditable focus dans l'onglet), popup de confirmation réelle sur
  Ctrl+W/croix.

Justification du découpage : le sprint 1 est testable et démontrable de
bout en bout sans toucher à aucune vue métier existante (uniquement de
nouveaux fichiers + `AppLayout.tsx`/`__root.tsx`/`menu.ts`). Le sprint 2
touche des vues existantes (`schema.tsx` a minima) et repose sur un choix de
détection à valider après avoir vu le sprint 1 tourner — les découpler
limite le risque de régression et permet une validation humaine
intermédiaire.

## 2. Sprint 1 — Modèle et barre d'onglets

### 2.1 Modèle de données

Nouveau fichier `apps/desktop/src/renderer/contexts/TabsContext.tsx`, sur le
modèle de `VersioningContext.tsx` (`createContext` + `useX()` + `XProvider`) :

```ts
interface Tab {
  id: string              // uuid généré à la création, stable tant que l'onglet existe
  pathname: string        // ex. '/req/SYS-001'
  searchParams: Record<string, string>  // ex. { projectId: '...', component: '...' }
  title: string           // dérivé par défaut (2.3), écrasable par une route (sprint 2 pour l'affinage)
}

interface TabsContextValue {
  tabs: Tab[]
  activeTabId: string
  recentlyClosed: Tab[]          // pile bornée, cf. 2.5
  openTab: (pathname: string, searchParams?: Record<string, string>) => void
  closeTab: (id: string) => void        // aucune garde ici — la garde dirty vit au sprint 2, au niveau de l'appelant (TabBar / raccourci)
  activateTab: (id: string) => void
  reopenClosedTab: (id: string) => void
}
```

- `TabsProvider` est monté dans `__root.tsx`, **au-dessus** de `AppLayout`
  (`RootLayout`, `__root.tsx:12-16`) : c'est lui qui rend la nouvelle
  `<TabBar/>` avant `<AppLayout/>`, cohérent avec la spec ("barre au-dessus
  de l'ensemble ActivityBar+Sidebar+main frame").
- `TabsProvider` **synchronise l'onglet actif avec l'URL courante**, dans le
  sens onglet actif → URL uniquement au moment du switch/ouverture (pas de
  synchronisation URL → onglet en continu) : naviguer normalement à
  l'intérieur de l'app (cliquer un lien, une exigence dans la liste…) met à
  jour `pathname`/`searchParams` de l'onglet actif en place (même `id`), sans
  créer de nouvel onglet. Implémentation : un effet sur
  `useRouterState({ select: s => s.location })` qui met à jour l'entrée
  `tabs` correspondant à `activeTabId` à chaque changement d'URL — c'est ce
  qui permet à un onglet de "suivre" la navigation normale de l'utilisateur
  à l'intérieur de ce même onglet.
- Ouvrir un onglet = `openTab(pathname, searchParams)` qui pousse un nouveau
  `Tab`, l'active, puis appelle `router.navigate({ to: pathname as never,
  search: searchParams as never })` — pattern déjà utilisé dans
  `main.tsx:40` pour naviguer vers un pathname dynamique avec des search
  params en `Record<string,string>`.
- Activer un onglet = `activateTab(id)` : marque `activeTabId = id` puis
  `router.navigate(...)` vers `pathname`/`searchParams` de cet onglet.
  Comme l'ActivityBar/Sidebar sont dérivés de l'URL (`deducePanel`,
  `AppLayout.tsx:20-45`), ils suivent automatiquement sans code
  supplémentaire.

### 2.2 Barre d'onglets — `TabBar.tsx`

Nouveau `apps/desktop/src/renderer/components/layout/TabBar.tsx` :

- Rendu dans `__root.tsx`, uniquement quand `!isBareRoute` (même garde que
  `AppLayout`, pour ne pas apparaître sur `/login`/`/print/*`).
- Structure : liste scrollable horizontale d'onglets (bouton par onglet,
  titre tronqué + croix au survol/actif) + bouton **"+"** + bouton
  **flèche vers le bas** (menu déroulant), alignés à droite de la liste.
- Style : réutilise les tokens existants (`bg-surface`, `border-edge`,
  `text-ink`/`text-ink-3`, cf. `ViewHeader.tsx`) — hauteur compacte (~32px),
  cohérente avec la barre de titre OS déjà en place au-dessus.
- Clic sur un onglet inactif → `activateTab(id)`.
- Clic sur la croix d'un onglet → tentative de fermeture (sprint 1 : ferme
  toujours ; sprint 2 : passe par la garde dirty, cf. §3.3).
- Bouton "+" → `openTab(HOME_PATHNAME, homeSearchParams)` (2.3).
- Bouton flèche vers le bas → ouvre `TabListMenu.tsx` (popover), liste
  `tabs` puis section "Récemment fermés" (`recentlyClosed`), champ de
  filtre texte au-dessus (filtre par `title`, insensible à la casse,
  substring — même registre que les filtres existants de l'app, ex.
  filtre sidebar). Sélectionner une entrée de `tabs` → `activateTab`.
  Sélectionner une entrée de `recentlyClosed` → `reopenClosedTab`.

### 2.3 Titre par défaut et page d'accueil

- `HOME_PATHNAME` : la page d'accueil de l'app telle que définie par T102
  (Suivi/Dashboard si projet chargé). **Dépendance sur T102** : si T102
  n'est pas encore mergé au moment du sprint 1, ce ticket implémente la
  fonction `resolveHomeRoute(hasProject: boolean)` localement (retourne la
  route actuelle utilisée pour l'écran de démarrage aujourd'hui) et
  T102, une fois mergé, n'a qu'à faire pointer cette même fonction vers son
  nouveau comportement — un seul point de vérité, pas de duplication.
- Titre par défaut d'un onglet : table statique `pathname → libellé`
  (ex. `/schema` → "Modèle de données", `/graph` → "Arbre de versions",
  `/product` → "Produit", `/query`/`/dashboard` → "Dashboards", `/account`
  → "Compte", route d'accueil → "Accueil"), avec repli générique sur le nom
  du panel (`deducePanel`) si le pathname n'est pas dans la table. Pour les
  routes de détail (`/req/$reqId`, `/test/$testId`, `/campaign/$campaignId`),
  le sprint 1 affiche un titre générique ("Exigence", "Test", "Campagne") —
  l'affinage avec le nom réel de l'objet (ex. "SYS-001 — Démarrage rapide")
  est fait en sprint 2 via le mécanisme `useSetTabTitle` (§3.1), pour ne pas
  coupler le sprint 1 aux données métier de chaque route.

### 2.4 Raccourcis clavier et retrait de l'accélérateur Electron

- Nouveau hook `apps/desktop/src/renderer/hooks/useTabShortcuts.ts`, monté
  une fois dans `TabsProvider` (ou `RootLayout`, à trancher en implémentation
  selon ce qui est le plus direct), sur le modèle de `useMenuEvents.ts` :
  `window.addEventListener('keydown', handler)` global, `e.ctrlKey ||
  e.metaKey` + `e.key === 't'` → `openTab(...)`, + `e.key === 'w'` →
  tentative de fermeture de l'onglet actif (`e.preventDefault()` dans les
  deux cas pour éviter tout comportement navigateur/OS par défaut résiduel).
- `apps/desktop/src/main/menu.ts:19-23` : l'entrée "Fermer le projet" perd
  son `accelerator: 'CmdOrCtrl+W'` (le `click` et le `label` restent
  inchangés — l'action reste accessible depuis le menu Fichier). Aucun
  changement côté `useMenuEvents.ts` (le canal `menu:close-project` continue
  de fonctionner pour un clic menu).

### 2.5 Récemment fermés, dernier onglet, scoping fenêtre/projet

- `recentlyClosed` : pile bornée à **10 entrées**, la plus récente en tête,
  en mémoire (state React dans `TabsProvider`, pas de persistance disque —
  cohérent avec la décision de spec). Rouvrir un onglet depuis cette liste
  le retire de `recentlyClosed` et le pousse dans `tabs` (nouvel `id`,
  mêmes `pathname`/`searchParams`/`title`).
- Fermer le dernier onglet restant : au lieu de fermer sans rien laisser, on
  **remplace son contenu par la page d'accueil** (même `id` conservé,
  `pathname`/`searchParams`/`title` réinitialisés à `HOME_PATHNAME`) plutôt
  que de le retirer de `tabs` — répond au point ouvert de `T101.md` en
  gardant la fenêtre toujours dans un état affichable, sans code spécial de
  fermeture de fenêtre.
- Fermeture/changement de projet (`menu:close-project`, ou action
  équivalente dans le panneau Projet) : réinitialise `tabs` à un onglet
  unique sur la page d'accueil et vide `recentlyClosed` — les onglets
  pointant vers un `projectId` qui n'existe plus n'ont pas de sens à
  conserver. Déclenché par un effet sur `currentProjectId` devenant `null`
  dans `TabsProvider` (mirroring `AppLayout.tsx:75-77`, qui fait déjà ce
  genre de reset sur changement de projet pour `lastVersionRoute`).
- Scoping par fenêtre : `TabsProvider` est un state React local au process
  de rendu de la fenêtre (pas de `localStorage`/IPC partagé) — deux
  `BrowserWindow` (`createAppWindow()`, `menu.ts:15-16`) ont chacune leur
  propre arbre React, donc leur propre `TabsProvider` : le scoping par
  fenêtre est gratuit, aucun code dédié requis.

## 3. Sprint 2 — Dirty state et confirmation de fermeture

### 3.1 Hook partagé `useRegisterTabDirty`

Nouveau, dans `TabsContext.tsx` :

```ts
function useRegisterTabDirty(dirty: boolean): void
```

- Enregistre/désenregistre `dirty` pour l'onglet actif au moment du montage
  du composant appelant (via `activeTabId` lu depuis le contexte), avec
  cleanup à `false` au démontage.
- **Câblé dans `schema.tsx`** en remplaçant rien de l'existant : un seul
  ajout, `useRegisterTabDirty(isDirty)` juste après la ligne
  `schema.tsx:397` où `isDirty` est déjà calculé. C'est la seule vue de
  l'app avec un vrai brouillon "édition différée + Enregistrer explicite"
  identifié dans le code actuel (cf. commentaire `schema.tsx:30`).
- Prévu extensible : toute future vue au même patron (draft +
  `isDirty` local + bouton Enregistrer explicite) n'a qu'à ajouter cet
  unique appel — pas de câblage supplémentaire nécessaire côté `TabsContext`.

De la même mécanique, `useSetTabTitle(title: string)` (même fichier, même
patron d'enregistrement par `activeTabId`) est ajouté aux routes de détail
(`req.$reqId.tsx`, `test.$testId.tsx`, `campaign.$campaignId.tsx`) pour
pousser le vrai nom de l'objet une fois chargé, complétant le titre
générique du sprint 1 (§2.3) — ces routes connaissent déjà ce nom pour leur
propre `ViewHeader.title`, l'appel est un simple effet supplémentaire sur la
même donnée déjà en main, pas une nouvelle requête.

### 3.2 Filet de sécurité générique — champ éditable en cours de frappe

Le reste de l'app suit un modèle **autosave au blur/debounce** (`EditView`
sauvegarde champ par champ via `handleFlushEditValues`,
`SystemView.tsx:794`) plutôt qu'un brouillon explicite : le risque réel n'y
est pas "un brouillon jamais sauvegardé" mais "l'utilisateur ferme l'onglet
pendant qu'il tape, avant que le blur/debounce n'ait eu l'occasion de
committer". Plutôt que d'instrumenter individuellement chaque champ de
chaque vue (gros travail, fragile), la fermeture d'onglet (croix ou Ctrl+W)
applique la règle suivante, indépendante de toute vue :

1. Si `document.activeElement` est un champ éditable (`input`, `textarea`,
   ou `[contenteditable]` — englobe l'éditeur TipTap de `RichTextField`)
   **situé dans le sous-arbre DOM de l'onglet actif**, on déclenche d'abord
   son événement `blur` (`(document.activeElement as HTMLElement).blur()`)
   pour laisser l'autosave existant de la vue s'exécuter normalement (aucun
   changement requis dans les vues — elles gèrent déjà `onBlur`).
2. On réévalue ensuite l'état dirty de l'onglet (§3.3) — dans l'immense
   majorité des cas, le blur a déjà tout committé et l'onglet n'est plus
   dirty, fermeture silencieuse.
3. Cas résiduel non couvert par ce filet (accepté comme hors scope, cf.
   `T101.md` — aucune régression par rapport à l'existant : un `Ctrl+W`
   sur une vue autosave sans brouillon explicite n'a jamais aujourd'hui de
   confirmation, et n'en aura toujours pas dans le rare cas où le blur
   lui-même échoue silencieusement) : une saisie perdue par une défaillance
   du mécanisme d'autosave existant (hors périmètre T101, préexistant).

### 3.3 Résolution de l'état dirty d'un onglet et popup de confirmation

`closeTab(id)` (exposée par `TabsContext`) reste inchangée (§2.1, aucune
garde). La garde vit dans les deux points d'entrée utilisateur, sur le
même modèle :

```
attemptCloseTab(id):
  if id === activeTabId: flush champ focus (3.2 étape 1)
  if dirtyMap[id] (registre §3.1) est true:
    afficher <ConfirmCloseTabModal> (nouveau, calqué sur CancelConfirmModal
      de schema.tsx) — "Fermer sans enregistrer ?" / Annuler / Fermer
    → si confirmé : closeTab(id)
    → si annulé : ne rien faire
  else:
    closeTab(id)
```

- `attemptCloseTab` est appelé par la croix d'un onglet dans `TabBar.tsx`
  et par le handler Ctrl+W de `useTabShortcuts.ts` (§2.4, mis à jour au
  sprint 2 pour appeler `attemptCloseTab` au lieu de `closeTab` directement).
- La popup est un composant générique, indépendant de la vue affichée dans
  l'onglet (elle ne connaît que "cet onglet est marqué dirty"), donc pas de
  dépendance vers `schema.tsx` ou toute future vue qui appellerait
  `useRegisterTabDirty`.

## 4. Fichiers impactés — récapitulatif

**Nouveaux (sprint 1)**
- `apps/desktop/src/renderer/contexts/TabsContext.tsx`
- `apps/desktop/src/renderer/components/layout/TabBar.tsx`
- `apps/desktop/src/renderer/components/layout/TabListMenu.tsx`
- `apps/desktop/src/renderer/hooks/useTabShortcuts.ts`

**Modifiés (sprint 1)**
- `apps/desktop/src/renderer/routes/__root.tsx` — monte `TabsProvider` +
  `<TabBar/>` au-dessus de `AppLayout`, sous la même garde `isBareRoute`.
- `apps/desktop/src/main/menu.ts` — retrait de l'`accelerator` sur "Fermer
  le projet" (ligne 21).

**Nouveaux (sprint 2)**
- `apps/desktop/src/renderer/components/layout/ConfirmCloseTabModal.tsx`

**Modifiés (sprint 2)**
- `apps/desktop/src/renderer/contexts/TabsContext.tsx` — ajoute
  `useRegisterTabDirty`, `useSetTabTitle`, `attemptCloseTab`.
- `apps/desktop/src/renderer/hooks/useTabShortcuts.ts` — Ctrl+W appelle
  `attemptCloseTab`.
- `apps/desktop/src/renderer/components/layout/TabBar.tsx` — la croix
  appelle `attemptCloseTab`.
- `apps/desktop/src/renderer/routes/schema.tsx` — un appel
  `useRegisterTabDirty(isDirty)`.
- `apps/desktop/src/renderer/routes/req.$reqId.tsx`,
  `test.$testId.tsx`, `campaign.$campaignId.tsx` — un appel
  `useSetTabTitle(...)` chacune.

## 5. Alternatives rejetées

- **Maintenir plusieurs `<Outlet/>` montés simultanément** (un par onglet,
  masqués/affichés en CSS plutôt que démontés) : préserverait l'état local
  non committé de chaque vue en changeant d'onglet, réduisant le besoin même
  du sprint 2. Rejeté : changement d'architecture bien plus large (chaque
  route devrait devenir idempotente au montage multiple, les contextes
  scoping-projet de `AppLayout.tsx:198-210` devraient être dupliqués ou
  repensés par onglet), hors de proportion avec le ticket. Le modèle
  single-Outlet + dirty-tracking explicite (retenu) est la décision de
  cadrage de `T101.md`.
- **Détection dirty générique par diff de formulaire pour toutes les vues** :
  rejeté au profit du filet de sécurité focus-element (§3.2), qui ne
  nécessite aucune instrumentation par vue et couvre le cas réel dominant
  (frappe en cours) sans faux positifs sur les vues déjà "propres" grâce à
  l'autosave existant.
- **Persister `tabs`/`recentlyClosed` en `localStorage`** : rejeté, hors
  scope explicite de `T101.md`.

## 6. Points de `T101.md` résolus par ce design

- Dernier onglet → retombe sur la page d'accueil (§2.5).
- Comportement au changement/fermeture de projet → reset à un onglet unique
  sur la page d'accueil (§2.5).
- Titre par onglet → table statique + affinage sprint 2 via
  `useSetTabTitle`, sans dupliquer les requêtes déjà faites par chaque
  route pour son propre `ViewHeader.title` (§2.3, §3.1).
- Taille de la liste "récemment fermés" → 10 entrées, en mémoire (§2.5).
