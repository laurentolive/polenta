# SPEC-PROJECT-MANAGEMENT — Gestion de projet dans l'application desktop

> Dernière révision : 2026-10-11 (GH45 S4 — repos et création sur une forge Forgejo/Gitea)  
> Dépend de : [SPEC-ELECTRON-DESKTOP.md](SPEC-ELECTRON-DESKTOP.md)

---

## 1. Principes fondamentaux

| Règle | Détail |
|-------|--------|
| **1 fenêtre = 1 projet** | Une `BrowserWindow` affiche exactement un projet à la fois. Pas d'onglets, pas de split-view multi-projet. |
| **2 projets simultanés = 2 fenêtres** | L'utilisateur ouvre une seconde instance de l'app (ou utilise "Ouvrir dans une nouvelle fenêtre"). Chaque fenêtre est indépendante. |
| **Dernier projet utilisé** | T130 : pas de channel `workspace:mark-last-opened(id)`. Réel : `workspace:mark-recent` marque un projet comme récemment ouvert, `workspace:clear-last-opened` (sans paramètre) efface le dernier projet ouvert, `workspace:get-last-opened` le lit. Reflète le dernier projet utilisé *toutes fenêtres confondues* — cela ne pose pas de problème car au redémarrage une seule fenêtre s'ouvre et reprend ce projet. |

---

## 2. Menu natif Electron — menu "Fichier"

**T130 : le menu natif est désactivé.** `main/index.ts` appelle `Menu.setApplicationMenu(null)` —
`buildMenu()` ci-dessous n'est jamais invoqué. Les actions "Ouvrir un projet"/"Fermer le projet"
passent par l'UI in-app (panneau Projet, `SPEC-ELECTRON-DESKTOP.md` §19.8), pas par un menu OS. La
description qui suit reste le comportement *prévu à l'origine* si le menu natif est un jour
réactivé — à ne pas prendre comme l'état actuel de l'application.

Le menu est enregistré dans le **main process** via `Menu.buildFromTemplate`. Les actions de navigation émettent des événements vers le renderer via `win.webContents.send(channel)`.

```
Menu bar
└── Fichier
    ├── Ouvrir un projet…          Ctrl+O   → envoie 'menu:open-workspace' au renderer
    ├── Ouvrir dans une nouvelle fenêtre     → crée une nouvelle BrowserWindow (§5)
    ├── ─────────────────────────────────────
    ├── Fermer le projet           Ctrl+W   → envoie 'menu:close-project' au renderer
    ├── ─────────────────────────────────────
    └── Quitter                    Alt+F4   → app.quit()
```

**Implémentation (`apps/desktop/src/main/menu.ts`) :**

```typescript
import { Menu, BrowserWindow, app } from 'electron'
import { createAppWindow } from './index'

export function buildMenu(win: BrowserWindow): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Fichier',
      submenu: [
        {
          label: 'Ouvrir un projet…',
          accelerator: 'CmdOrCtrl+O',
          click: () => win.webContents.send('menu:open-workspace'),
        },
        {
          label: 'Ouvrir dans une nouvelle fenêtre',
          click: () => createAppWindow(),
        },
        { type: 'separator' },
        {
          label: 'Fermer le projet',
          // T130 (T101) : pas d'accelerator ici — CmdOrCtrl+W est le raccourci de fermeture
          // d'onglet côté renderer (useTabShortcuts.ts) ; un accelerator ici créerait un conflit.
          click: () => win.webContents.send('menu:close-project'),
        },
        { type: 'separator' },
        {
          label: 'Quitter',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click: () => app.quit(),
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
```

---

## 3. Channels push main → renderer

Ces channels sont émis par le menu natif et reçus par le renderer via `window.polenta.on`.

| Channel | Émis par | Comportement attendu côté renderer |
|---------|----------|-----------------------------------|
| `menu:open-workspace` | Menu "Ouvrir un projet…" (T130 : menu désactivé, voir §2) | `workspace:clear-last-opened` + navigate(`/`) |
| `menu:close-project` | Menu "Fermer le projet" (T130 : menu désactivé, voir §2) | `workspace:clear-last-opened` + navigate(`/`) |

> Ces deux actions ont le même effet — l'utilisateur revient sur l'écran Workspace (`/`) et le `lastOpenedId` est effacé.

---

## 4. Abonnement renderer — hook `useMenuEvents`

Le hook est monté **une seule fois** dans le composant racine (layout racine du router), pas dans chaque route.

**T130 : appels réels différents** — `api.workspace.clearLastOpened()` (pas `markLastOpened(null)`,
channel qui n'existe pas), plus un appel supplémentaire non documenté ici à
`markProjectJustClosed()` :

```typescript
// apps/desktop/src/renderer/hooks/useMenuEvents.ts
import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { api } from '../api'

export function useMenuEvents(): void {
  const navigate = useNavigate()

  useEffect(() => {
    const unsubOpen = window.polenta.on('menu:open-workspace', async () => {
      await api.workspace.clearLastOpened()
      navigate({ to: '/' })
    })
    const unsubClose = window.polenta.on('menu:close-project', async () => {
      await api.workspace.clearLastOpened()
      markProjectJustClosed()
      navigate({ to: '/' })
    })
    return () => {
      unsubOpen()
      unsubClose()
    }
  }, [navigate])
}
```

---

## 5. Multi-fenêtres (plusieurs projets simultanés)

```typescript
// apps/desktop/src/main/index.ts

export function createAppWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  buildMenu(win)

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  // Pas de requestSingleInstanceLock() — plusieurs fenêtres autorisées
  const container = await createContainer()
  registerIpcHandlers(container)
  createAppWindow()
})
```

> **`app.requestSingleInstanceLock()` n'est pas utilisé.** Sur Windows et Linux, relancer l'exécutable crée une nouvelle fenêtre indépendante. Chaque fenêtre lance son propre flux d'initialisation (voir §16 de SPEC-ELECTRON-DESKTOP.md) de façon autonome.

---

## 6. Bouton "Fermer" dans l'UI projet

En complément du menu natif, le panneau latéral Projet expose un bouton "Fermer le projet" (`ProjectPanel.tsx`, `WithProjectPanel` — la route `/project/$id` qui l'hébergeait avant T86 a été retirée ; `/schema` est désormais la page d'atterrissage du projet, mais ce bouton reste dans la sidebar, pas dans une route dédiée). Son comportement est identique à l'action menu :

```typescript
// Dans ProjectPanel.tsx, WithProjectPanel
async function handleClose() {
  await api.workspace.clearLastOpened()
  navigate({ to: '/' })
}
```

---

## 7. Ce qu'il ne faut PAS faire

- ❌ **Ne pas créer un canal IPC `workspace:close-project` dédié.** La fermeture de projet combine deux opérations déjà existantes : `workspace:clear-last-opened` + navigation renderer. Aucune logique côté main process n'est requise.
- ❌ **Ne pas arrêter le `RepoWatcherService` à la fermeture.** Le watcher continue en arrière-plan tant que l'app tourne — intentionnel pour la réactivité à la réouverture du même projet.
- ❌ **Ne pas bloquer plusieurs instances avec `requestSingleInstanceLock`.** Polenta autorise explicitement plusieurs fenêtres pour permettre le travail sur plusieurs projets simultanément.

---

## 8. Glossaire — wording interface

| Terme technique | Libellé UI | Notes |
|----------------|-----------|-------|
| clone / cloner | Charger / Charger un projet | Télécharger un projet distant existant |
| repo existant local | Ouvrir un projet local | Pointer vers un dossier déjà présent sur le disque |
| repo / repository | projet | Dans toute l'interface utilisateur |
| Créer un repo | Créer un projet | Créer le repo sur le remote puis cloner localement |

---

## 9. Option "Créer un projet"

**Création locale (T130, GH27 — inchangée).** `createNewProject()` (`WorkspaceService`) crée un repo
git **local uniquement** (`git.init`). Sans compte Forgejo/Gitea, c'est le seul mode proposé.

**Saisie (GH27)** : bouton « Créer un nouveau projet » de `/`, qui enchaîne
- un popup **Nom du projet** (= nom du dossier créé), seul champ, `Entrée` pour valider ;
- puis le sélecteur natif pour le **Dossier conteneur**, où le projet est créé.

Cf. SPEC-ELECTRON-DESKTOP §16.5.

**Séquence réelle (`createNewProject(containerDir, name)`) :**
1. `initProjectRepo(containerDir/name)` : `mkdir` + `git init` (branche `main`), `.gitignore`,
   `AGENTS.md`, `.mcp.json` (config serveur MCP, desktop), premier commit
2. `initWorkspace(containerDir, rootRepoPath)` puis `openWorkspace(containerDir)`

**Channel IPC :** `workspace:create-new` → `{ containerDir: string, name: string }` → `WorkspaceOpenResult`

### 9.1 Forges Forgejo/Gitea : liste des repos et création sur le serveur (GH45 S4)

Avec au moins un compte `forgejo` connecté (SPEC-ACCOUNTS-AUTH §5), l'accueil propose les fonctions
de la forge. Les comptes sont relus **à l'ouverture** de chaque fenêtre (la page d'accueil est
montée une première fois avant la connexion). Code : `main/services/forge/forge.service.ts`
(`ForgeService`), provider `forge/forgejo.provider.ts`.

**« Ouvrir un projet depuis un repo »** → `RepoPickerModal` :
- repos accessibles au compte (`GET /api/v1/user/repos`, **toutes les pages**, 50 par page), triés,
  recherche sur `organisation/nom` et la description ;
- badge « lecture seule » si le compte n'a pas l'écriture (`permissions.push`) ;
- le repo de configuration `<org>/polenta-config` (SPEC-ACCOUNTS-AUTH §7) n'est pas proposé ;
- sélecteur de compte s'il y en a plusieurs ;
- « Saisir une URL » : popup URL d'avant GH45 ;
- un repo déjà présent sur le poste (projet récent de même `origin`) est rouvert, sinon cloné.

**« Créer un nouveau projet »** → `CreateProjectModal` : nom, puis **« Sur le serveur <hôte> »**
(par défaut quand c'est possible) ou « Sur ce poste uniquement » (création locale ci-dessus) :
- organisation choisie parmi celles où le compte **peut créer** (`GET /user/orgs`, puis
  `GET /users/{login}/orgs/{org}/permissions` → `can_create_repository` ou `is_owner`) ; aucune →
  option désactivée avec l'explication ;
- `workspace:create-on-server(containerDir, name, accountKey, org)` → `CreateOnServerResult`
  (`ForgeService.createProjectOnServer`), dans cet ordre :
  1. nom valide (`[A-Za-z0-9._-]`) et **libre** (`GET /repos/{org}/{nom}` → 404) — sinon erreur
     **avant toute écriture locale** (« Le dépôt … existe déjà sur le serveur ») ;
  2. `POST /orgs/{org}/repos` `{ private: true, auto_init: false, default_branch: 'main' }` (409 →
     même erreur) ;
  3. `createNewProject` (contenu initial identique au local) ;
  4. `origin` = URL de clone du repo ;
  5. publication de `main`. **Un échec de la publication n'annule rien** : le projet reste ouvert
     avec `origin`, le message (« publiez plus tard ») s'affiche dans l'indicateur de
     synchronisation (`pushWarning`). Polenta ne supprime **jamais** un repo distant.

### 9.2 Composant créé sur le serveur (GH45 S4)

Dans la fenêtre d'ajout d'un composant (SPEC-TEMPLATES §3), « Créer le repo sur le serveur » :
organisation (mêmes règles qu'en §9.1) et nom du repo (par défaut : nom de montage). 
`workspace:create-component-on-server(accountKey, org, name)` → `{ cloneUrl }` : nom vérifié, repo
privé créé, **initialisé dans un dossier temporaire** (même contenu qu'un nouveau projet) puis
publié, dossier temporaire supprimé. L'URL remplit le champ « Repo (git URL) » ; l'ajout et le
clone suivent le flux habituel par URL. Si la publication échoue, l'erreur donne l'URL du repo créé
(vide) pour réessayer par « Saisir une URL ».

### 9.3 Champ `user` et diagnostic des droits (GH45 S4)

- `forge:org-members(repoPath)` : membres de l'organisation propriétaire du repo `origin` (login,
  nom affiché), en cache par `(hôte, organisation)` pour la durée du processus ; `null` pour un repo
  personnel, hors ligne, ou hors Forgejo. Utilisé par le champ `user` (SPEC-REQ-requirements §3).
- `forge:repo-access(repoPath)` : droits du compte sur le repo `origin` ; `null` dans les cas sans
  objet (jamais d'erreur). À l'ouverture d'un projet, si le compte n'a que la lecture sur le repo
  racine : bandeau non bloquant « Vous avez un accès en lecture seule à ce projet : vous pouvez
  consulter mais pas publier » (`RepoAccessBanner`, refermable pour la session). Les actions
  d'édition restent possibles ; le refus arrive à la publication (SPEC-ACCOUNTS-AUTH §8). Une
  dépendance inaccessible est signalée au chargement de l'arbre (SPEC-ELECTRON-DESKTOP §22).

Web (GH44) : mêmes channels, exposés au navigateur ; `containerDir` et `repoPath` passent par la
garde des chemins de l'espace utilisateur.

---

## 10. Ordre d'implémentation

```
Sprint 6 — Gestion de projet / menu File + UI compte  [LIVRÉ]
  ① Extraire createAppWindow() dans src/main/index.ts
  ② Créer src/main/menu.ts → buildMenu(win)
  ③ Appeler buildMenu(win) après création de la fenêtre dans createAppWindow()
  ④ Ajouter handler IPC dialog:pick-folder (dialog.showOpenDialog)
  ⑤ Ajouter namespace dialog dans ApiClient + ipc-client (pickFolder)
  ⑥ Créer src/renderer/hooks/useMenuEvents.ts
  ⑦ Monter useMenuEvents() dans le layout racine du router
  ⑧ Header workspace : titre "Ouvrir un projet" à gauche, [user▾] à droite
  ⑨ Créer composant AccountMenu (nom, email, remote, Changer de compte, Se déconnecter)
  ⑩ Layout WorkspacePage en deux colonnes : Récents à gauche, Charger + Ouvrir empilés à droite
  ⑪ Ajouter boutons Browse [📁] dans les formulaires
  ⑫ Ajouter bouton "Fermer le projet" dans project.$id.tsx

Sprint 7 — Wording + layout workspace + création de projet
  ① Renommer "Cloner un repo" → "Charger un projet" dans WorkspacePage
  ② Renommer "Ouvrir un repo existant" → "Ouvrir un projet local" dans WorkspacePage
  ③ Remplacer tout "repo" par "projet" dans l'interface utilisateur
  ④ Ajouter panneau "Créer un projet" (nom, dossier [📁], visibilité Privé/Public)
  ⑤ Implémenter WorkspaceService.createProject() (API remote + clone)
  ⑥ Ajouter handler IPC workspace:create
  ⑦ Ajouter workspace.create() dans ApiClient + ipc-client
  ⑧ Réorganiser layout WorkspacePage : 2 colonnes, Récents à gauche, 3 panneaux empilés à droite
```
