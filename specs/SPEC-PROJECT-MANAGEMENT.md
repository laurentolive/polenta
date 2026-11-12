# SPEC-PROJECT-MANAGEMENT — Gestion de projet dans l'application desktop

> Dernière révision : 2026-11-12 (GH342 — plusieurs fenêtres sur le même projet, §1, §5, §7)  
> Dépend de : [SPEC-ELECTRON-DESKTOP.md](SPEC-ELECTRON-DESKTOP.md)

---

## 1. Principes fondamentaux

| Règle | Détail |
|-------|--------|
| **1 fenêtre = 1 projet affiché** | Une `BrowserWindow` affiche un projet à la fois (avec ses onglets, T101). |
| **Plusieurs fenêtres sur le même projet** | GH342 : Ctrl+Shift+N ou « Ouvrir dans une nouvelle fenêtre » (menu d'onglet) — §5. Instance unique : relancer l'exécutable ne crée pas de fenêtre. Deux projets différents dans deux fenêtres : #343. |
| **Dernier projet utilisé** | T130 : pas de channel `workspace:mark-last-opened(id)`. Réel : `workspace:mark-recent` marque un projet comme récemment ouvert, `workspace:clear-last-opened` (sans paramètre) efface le dernier projet ouvert, `workspace:get-last-opened` le lit. Reflète le dernier projet utilisé *toutes fenêtres confondues*. Au redémarrage, les fenêtres mémorisées rouvrent sur leur page (§5) ; sans page mémorisée, l'accueil reprend ce projet. |

---

## 2. Menu natif Electron — menu "Fichier"

**T130 : le menu natif est désactivé.** `main/index.ts` appelle `Menu.setApplicationMenu(null)` —
`buildMenu()` ci-dessous n'est jamais invoqué. Les actions "Ouvrir un projet"/"Fermer le projet"
passent par l'UI in-app (panneau Projet, `SPEC-ELECTRON-DESKTOP.md` §19.8), pas par un menu OS. La
description qui suit reste le comportement *prévu à l'origine* si le menu natif est un jour
réactivé — à ne pas prendre comme l'état actuel de l'application.

Conséquence : les raccourcis de zoom du menu par défaut d'Electron n'existent pas ; le zoom de
l'interface (Ctrl+molette, Ctrl+= / Ctrl+- / Ctrl+0) est implémenté à part (GH237,
`SPEC-ELECTRON-DESKTOP.md` §19.2).

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

## 5. Multi-fenêtres (GH342)

Plusieurs fenêtres peuvent afficher **le même projet** (cas d'usage : exigences de composants
différents sur deux écrans). Deux projets différents dans deux fenêtres : non garanti (#343).

**Architecture.** Une seule instance (`app.requestSingleInstanceLock()`, GH45 : lien d'invitation
`polenta://`) ; relancer l'exécutable sans lien met la dernière fenêtre active au premier plan. Un
seul container de services pour toutes les fenêtres (les handlers reçoivent `repoPath` /
`workspaceDir`, aucun état « projet courant » par fenêtre côté main) ; chaque fenêtre a son renderer :
onglets, historique, panneau, titre (GH338). Les fenêtres sont gérées par `main/host/app-windows.ts`.

| Action | Comportement |
|---|---|
| **Ctrl/Cmd+Shift+N** (desktop) | nouvelle fenêtre sur la page de l'onglet actif, décalée de +30/+30 sur le même écran |
| **Clic droit sur un onglet** → « Ouvrir dans une nouvelle fenêtre » | nouvelle fenêtre sur la page de cet onglet ; l'onglet reste (copie). Web : nouvel onglet du navigateur. « Fermer l'onglet » dans le même menu |
| Ouverture sur une page | `index.html?__open=<route>` (même contrainte `file://` que `__print`) ; la route n'est suivie que si son projet existe encore (`workspace:resolve`), sinon démarrage habituel |
| Données | une écriture dans une fenêtre arrive dans les autres par `repo:file-changed` (`useLiveFileSync`) |
| Pull automatique (T155) | une seule fenêtre par projet le fait : la plus ancienne dont la route porte ce `projectId` (`app:auto-pull-owner`) ; web : chaque onglet |
| Terminal (GH238) | sortie envoyée au seul webContents propriétaire |
| Dialogues natifs | rattachés à la fenêtre appelante (modaux sur elle, sur son écran) |
| Invitation `polenta://` | traitée par la dernière fenêtre active ; au lancement, par la dernière fenêtre rouverte |
| Zoom (GH237), thème, mise à jour (GH26) | communs à toutes les fenêtres |

**Fermeture d'une fenêtre.** Le main retient `close` et envoie `app:close-requested` ; le renderer
accuse réception (`app:close-window('ack')`, sinon fermeture forcée après 3 s — renderer planté ou
bloqué), enregistre les saisies en attente (`renderer/lib/pendingEdits.ts` : champ actif quitté,
enregistrements temporisés lancés, appels en cours attendus ≤ 2 s), puis ferme — ou, s'il reste des
onglets non sauvegardés, demande confirmation (`WindowCloseGuard`, liste des onglets). Fermer une
fenêtre alors que d'autres restent ne quitte pas l'application.

**Sortie de l'application** (Cmd+Q, installation d'une mise à jour, `app.quit()`) : pas de
confirmation (la mise à jour a la sienne, GH302) ; `before-quit` est retardé une fois, le temps que
chaque fenêtre enregistre ses saisies (`app:flush-requested` → `app:close-window('flushed')`, ≤ 2,5 s).

**Disposition mémorisée** — `userData/windows-state.json` :
`{ version: 1, windows: [{ x, y, width, height, maximized?, fullScreen?, route? }] }`.
- Écrite à la fermeture de la dernière fenêtre et à `before-quit` : les fenêtres ouvertes à ce
  moment ; une fenêtre fermée en cours de session n'est pas rouverte.
- `route` : page de l'onglet actif (`app:window-state`), seulement une page de projet.
- Au lancement : une fenêtre par entrée (8 au plus). Une fenêtre reste sur l'écran qui en recouvre
  au moins la moitié (ramenée dans son aire de travail) ; sinon (écran débranché) recentrée sur
  l'écran principal. Sous Windows avec mise à l'échelle, la taille relue après `setBounds` est
  compensée (sinon la fenêtre grandissait à chaque relance).
- Aucune entrée : une fenêtre 1280×800, démarrage habituel.

**Client web.** Mêmes appels `api.app.*` implémentés par le bridge : nouvel onglet
(`window.open`), `beforeunload` si un onglet Polenta est non sauvegardé. Une URL de page ouverte
directement (nouvel onglet, favori, F5) affiche cette page.

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
- ❌ **Ne pas retirer `requestSingleInstanceLock`.** Instance unique depuis GH45 (lien d'invitation) ; plusieurs fenêtres passent par la même instance (§5, GH342).
- ❌ **Ne pas diffuser à toutes les fenêtres un événement propre à l'une d'elles** (sortie de terminal, dialogue, invitation) — GH342 §5.

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

### 9.1 Forges GitHub et Forgejo/Gitea : liste des repos et création sur le serveur (GH45 S4, GH107)

Avec au moins un compte `github` ou `forgejo` connecté (SPEC-ACCOUNTS-AUTH §5), l'accueil propose les
fonctions de la forge. Les comptes sont relus **à l'ouverture** de chaque fenêtre (la page d'accueil est
montée une première fois avant la connexion). Code : `main/services/forge/forge.service.ts`
(`ForgeService`), `forge/repo-provisioning.service.ts` (`RepoProvisioningService`), providers
`forge/forgejo.provider.ts` et `forge/github.provider.ts`.

**« Ouvrir un projet depuis un repo »** → `RepoPickerModal` :
- repos accessibles au compte (**toutes les pages**), triés, recherche sur `organisation/nom` et la description ;
- badge « lecture seule » si le compte n'a pas l'écriture (`permissions.push`) ;
- le repo de configuration `<org>/polenta-config` (SPEC-ACCOUNTS-AUTH §7) n'est pas proposé ;
- sélecteur de compte s'il y en a plusieurs ;
- « Saisir une URL » : sur l'hôte d'un compte connecté, même inspection que depuis la liste ; sur un
  autre hôte, clone direct d'avant GH45, sans complétion ;
- un repo déjà présent sur le poste (projet récent de même `origin`) est rouvert ; sinon, il est
  **inspecté** (`forge:inspect-repo`, clones partiels, aucune écriture), et l'assistant
  `AddExistingRepo` (GH107, spec `GH103.md` §2.3) ne demande que ce qui manque :

| Repo | Écriture | Lecture seule |
|---|---|---|
| Vide | Formulaire complet, pré-rempli depuis la forge | Refusé |
| Complet | Aucune question | Ouvert |
| Projet Polenta incomplet | « Compléter » ou « Ouvrir tel quel » | Ouvert, sans question |
| Autre repo | Questions obligatoires, initialisation confirmée | Refusé, avec la liste de ce qui manque |

« Projet Polenta » : `.polenta/`, `integrationBranch` dans `config/project.yaml`, ou `AGENTS.md`
généré. `forge:adopt-repo(req)` complète dans un clone complet : `int-x` créée et désignée, ou
désignation de l'existante (commit seulement si `project.yaml` diffère) ; description sur la forge si
admin, `README.md` commité ; initialisation sans écraser un fichier existant ; push ; branche par
défaut. Écriture sans admin : description et branche par défaut signalées « à faire par un
administrateur », sans bloquer.

**« Créer un nouveau projet »** → `CreateProjectModal` (comptes GitHub et Forgejo connectés,
`forge:repo-accounts`) : nom, puis **« Sur le serveur <hôte> »** (par défaut) ou « Sur ce poste
uniquement » (création locale ci-dessus). Le serveur ouvre l'**assistant « Ajouter un repo »**
(GH107, `components/repo/AddRepoWizard.tsx`, spec `GH103.md` §2.2, design `GH107-design.md` §3 et §5) :

- service (compte), **propriétaire** : le compte lui-même ou une organisation où il peut créer
  (`forge:owners`). Forgejo : `can_create_repository` ou `is_owner`. GitHub : admin de
  l'organisation, ou `members_can_create_repositories` ; droit inconnu → proposée, refus expliqué ;
- **nom** : `[A-Za-z0-9._-]`, ni `.` ni `-` en tête ; disponibilité vérifiée 400 ms après la dernière
  frappe (`forge:name-available`) et une dernière fois avant la création ;
- visibilité (privé par défaut), **description obligatoire** (forge et `README.md`), **branche
  d'intégration** `int-<x>` pré-remplie avec le nom, membres facultatifs (`RepoMembersEditor` :
  comptes et équipes de l'organisation, `forge:org-teams`) ;
- `forge:create-repo(req)` → `CreateRepoResult` (`RepoProvisioningService.create`), étapes dans
  cet ordre, **tout étant validé avant la première écriture** :
  1. `remote` : repo vide créé (`auto_init: false`) ; un échec arrête tout, rien n'est écrit ;
  2. `local` : `initProjectRepo` avec options — **un seul premier commit sur `int-<x>`**, avec
     `README.md` (titre = nom, paragraphe = description) et `config/project.yaml`
     (`integrationBranch`) ; aucune branche `main` ; `origin` ; workspace ;
  3. `push` de `int-<x>` ;
  4. `defaultBranch` : branche par défaut de la forge alignée (`alignDefaultBranch`) ;
  5. `members` : un appel par membre, un échec n'arrête pas les suivants ; invitation GitHub signalée ;
  6. `open` : le projet s'ouvre.

  Après un échec, les étapes suivantes sont `skipped` et l'assistant affiche la liste des étapes.
  Polenta ne supprime **jamais** un repo distant.

### 9.2 Composant créé sur le serveur (GH107)

Dans la fenêtre d'ajout d'un composant (SPEC-TEMPLATES §3), « Créer le repo sur le serveur » ouvre le
même assistant (`CreateComponentRepo`, nom par défaut : nom de montage), et « Depuis un repo existant »
passe par la liste et l'inspection du §9.1. Le repo est préparé dans un dossier temporaire, supprimé ensuite. Au retour, l'URL remplit le champ « Repo (URL git) » et
`int-<x>` le champ « Branche » (pin de `polenta-repo.yaml`) ; l'ajout et le clone suivent le flux
habituel par URL.

### 9.4 Paramètres du repo (GH108)

Dans l'onglet Structure, une icône sur la ligne d'un repo ouvre la fenêtre « Paramètres du repo »
(`RepoSettingsModal`, spec `GH103.md` §3). Elle n'apparaît que si `origin` est sur une forge `github`
ou `forgejo` d'un compte connecté (`forge:repo-settings-available`, sans appel réseau).

- **Lecture** : `forge:repo-settings` ; forge injoignable → « indisponible hors ligne » ; une liste que
  la forge refuse à ce compte reste vide, avec une mention.
- **Écritures** (`forge:update-repo-settings`, `forge:set-collaborator`, `forge:remove-collaborator`,
  `forge:set-repo-team`, `forge:remove-repo-team`, `forge:cancel-invitation`) : droit admin **revérifié
  côté main** avant chaque appel ; sans ce droit, lecture seule. Retrait ou rétrogradation du dernier
  admin direct d'un repo d'organisation refusés s'il n'y a pas d'équipe admin (`owner` compte) ; retrait
  de son propre accès admin : confirmation.
- **Description** : non vide ; `README.md` mis à jour après confirmation (`forge:sync-readme`), par un
  commit sur l'intégration puis un push, en remplaçant le paragraphe qui suit le titre. Forme libre,
  autre branche ou modification en attente : rien n'est écrit, la fenêtre le dit.
- **Visibilité** : le passage en public demande une confirmation. Une forge du kit
  (`FORCE_PRIVATE=true`) le refuse : le refus est affiché.
- **Membres** : collaborateurs (autocomplétion sur les membres de l'organisation, saisie libre), invitations
  GitHub annulables, équipes d'un repo d'organisation. GitHub : niveau par repo. Forgejo : niveau de
  l'équipe en lecture, attribution et retrait, équipes « tous les repos » non retirables. Lien vers les
  équipes sur la forge. `triage` et `maintain` sont affichés tels quels, pas proposés.

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
