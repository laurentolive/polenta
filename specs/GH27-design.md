# GH27 — Design : page de chargement en boutons + projet de démonstration

Spec : `specs/GH27.md`. **Un seul sprint.**

## Fichiers modifiés / créés

| Fichier | Nature | Pourquoi |
|---------|--------|----------|
| `apps/desktop/src/renderer/routes/index.tsx` | réécrit (rendu + handlers) | Les 3 formulaires sont remplacés par 4 boutons d'action. Le `useEffect` de démarrage (compte → dernier projet, garde T105) est **conservé tel quel**. |
| `apps/desktop/src/renderer/components/home/TextPromptModal.tsx` | nouveau | Popup à un seul champ texte (URL Git / nom de projet). |
| `apps/desktop/src/renderer/lib/demoProject.ts` | nouveau | Constante `DEMO_PROJECT_URL`, pour ne pas laisser d'URL en dur dans le composant. |
| `apps/desktop/src/renderer/i18n/locales/fr.json`, `en.json` | clés `home.*` | Nouveaux libellés, suppression des clés devenues inutiles. |
| `specs/SPEC-ELECTRON-DESKTOP.md` §16.3 / §16.5 | mise à jour (fin de sprint) | Le layout et le wording de `/` changent. |
| `specs/SPEC-INDEX.md` | colonne MAJ | → GH27 |

| `apps/desktop/src/main/services/workspace.service.ts` | + `isEmptyDir(dir)` | Nouveau canal IPC, validé par l'humain après le design initial, pour refuser un dossier non vide (spec D3). |
| `apps/desktop/src/main/ipc/index.ts` | + handler `workspace:is-empty-dir` | idem |
| `packages/api-client/src/types.ts`, `ipc-client.ts` | + `workspace.isEmptyDir` | idem. Le preload expose un `invoke` générique : rien à y changer. |

Canaux existants réutilisés : `dialog:pick-folder`, `workspace:detect`, `workspace:open-project`,
`workspace:create-from-clone`, `workspace:create-new` et `workspace:mark-recent`.

### Canal `workspace:is-empty-dir`

| Channel | Paramètres | Retour | Description |
|---------|-----------|--------|-------------|
| `workspace:is-empty-dir` | `dir: string` | `boolean` | `true` si le dossier n'existe pas ou ne contient aucune entrée (fichiers cachés compris), `false` sinon (y compris si `dir` est un fichier). |

## Composants

### `TextPromptModal`

```ts
interface TextPromptModalProps {
  title: string          // ex. « Ouvrir un projet depuis un repo existant »
  label: string          // ex. « URL du repo Git »
  placeholder?: string   // ex. https://github.com/org/projet.git
  confirmLabel: string   // ex. « Continuer »
  onConfirm: (value: string) => void   // valeur trimée, jamais vide
  onCancel: () => void
}
```

- La coque reprend celle des modales existantes (`ConfirmCloseTabModal`) : overlay
  `fixed inset-0 z-50 bg-overlay/40`, carte `bg-surface border border-edge rounded-lg shadow-xl`,
  clic sur l'overlay = annuler.
- `<input autoFocus className="input-field w-full">` dans un `<form onSubmit>`. `Entrée` soumet de
  façon native.
- `useModalHotkeys(onCancel)` gère `Échap`. On ne lui passe pas `onConfirm` : le `submit` du
  formulaire gère déjà `Entrée`, ce qui évite un double déclenchement.
- Bouton principal désactivé si `value.trim() === ''`. `onSubmit` vérifie aussi que le champ n'est
  pas vide, puisque `Entrée` contourne le `disabled` du bouton.
- Le composant n'a pas d'état de chargement : il se ferme dès la confirmation, et le chargement est
  affiché sur le bouton de la page.

### `HomePage` (routes/index.tsx)

État :

```ts
type HomeAction = 'demo' | 'open' | 'clone' | 'create'
const [busy, setBusy] = useState<HomeAction | null>(null)
const [error, setError] = useState<{ action: HomeAction; message: string } | null>(null)
const [prompt, setPrompt] = useState<'clone' | 'create' | null>(null)
```

Un seul `error` suffit : lancer une action efface l'erreur précédente, quelle que soit l'action
concernée. Le message s'affiche sous le bouton dont `action` correspond.

Helper commun, qui centralise la gestion de busy et d'erreur aujourd'hui triplée :

```ts
async function run(action: HomeAction, op: () => Promise<string | null>) {
  // op renvoie le workspaceDir à ouvrir, ou null si l'utilisateur a annulé
  setBusy(action); setError(null)
  try {
    const dir = await op()
    if (dir) await goToProject(dir)     // markRecent + navigate /schema (inchangé)
  } catch (err) {
    setError({ action, message: err instanceof Error ? err.message : String(err) })
  } finally { setBusy(null) }
}
```

Une erreur « métier » (pas un projet Polenta, repo git pour la démo) est levée sous forme
d'`Error(t(...))` dans `op`, pour passer par le même affichage.

Parcours :

| Action | `op` |
|--------|------|
| `open` | `dir = pickFolder(t('home.pickProjectFolder'))`, retour `null` si annulé ; `openProject(dir)` ; `not-a-workspace` lève `home.notAWorkspace` ; sinon renvoie `dir`. |
| `demo` | `dir = pickFolder(t('home.pickDemoFolder'))`, retour `null` si annulé ; `detect(dir) === 'workspace'` → `openProject(dir)` (D2) ; sinon, si `isEmptyDir(dir)` → `createFromClone(dir, DEMO_PROJECT_URL)` (D1), sinon lève `home.demoFolderNotEmpty` (D3). Renvoie `dir`. |
| `clone` | Le clic ouvre `prompt = 'clone'`. À la confirmation (`url`) : `setPrompt(null)`, puis `run('clone', …)` avec `pickFolder(t('home.pickDestinationFolder'))`, retour `null` si annulé, puis `createFromClone(dir, url)`. |
| `create` | Même schéma avec `prompt = 'create'`, puis `createNew(dir, name)`. |

Pour `clone` et `create`, l'action passe en `busy` dès la confirmation du popup, y compris pendant
le sélecteur natif. Cela empêche un second lancement pendant que la boîte de dialogue OS est
ouverte. Le comportement est identique pour `open` et `demo`, qui ouvrent le sélecteur dans `run`.

Rendu : colonne centrée (`max-w-lg mx-auto`), 4 boutons pleine largeur.
- Chaque bouton contient une icône lucide (`Sparkles` pour la démo, `FolderOpen`, `Download`,
  `Plus`), un titre (`font-medium`) et une ligne d'aide (`text-xs text-ink-3`).
- Démo : style mis en avant, avec bordure et fond accentués via les tokens de thème existants
  (`border-accent`, `bg-accent-bg` ou leur équivalent dans `theme.config.ts`). Pas de nouveau token.
- Les trois autres : carte `bg-surface border border-edge rounded-xl hover:bg-surface-2`.
- `busy !== null` : tous les boutons `disabled`. Le bouton concerné affiche le libellé de
  chargement (`home.loadingDemo`, `home.opening`, `home.cloning`, `home.creating`) à la place de sa
  ligne d'aide.
- Erreur : même `<p>` que les formulaires actuels (`text-status-danger bg-status-danger-bg…`), sous
  le bouton concerné.

## i18n (`home.*`)

| Clé | FR | EN |
|-----|----|----|
| `demoTitle` | Découvrir Polenta avec le projet de démonstration | Discover Polenta with the demo project |
| `demoHelp` | Lave-linge LL800 — toutes les fonctionnalités sur un projet complet | LL800 washing machine — every feature on a complete project |
| `openExisting` *(gardée)* | Ouvrir un projet existant | Open an existing project |
| `openExistingHelp` | Choisir le dossier d'un projet Polenta ou d'un repo git | Pick a Polenta project folder or a git repo |
| `openFromRepo` *(gardée)* | Ouvrir un projet depuis un repo existant | Open a project from an existing repo |
| `openFromRepoHelp` | Cloner un projet à partir de son URL Git | Clone a project from its Git URL |
| `createNew` *(gardée)* | Créer un nouveau projet | Create a new project |
| `createNewHelp` | Démarrer un projet vide | Start an empty project |
| `repoUrlLabel` | URL du repo Git | Git repository URL |
| `projectNameLabel` | Nom du projet | Project name |
| `continue` | Continuer | Continue |
| `pickProjectFolder` | Dossier du projet | Project folder |
| `pickDestinationFolder` | Dossier de destination | Destination folder |
| `pickDemoFolder` | Dossier du projet de démonstration | Demo project folder |
| `loadingDemo` | Chargement de la démo… | Loading demo… |
| `demoFolderNotEmpty` | Ce dossier n'est pas vide et ne contient pas de projet Polenta : choisissez un dossier vide ou un projet existant. | This folder is not empty and holds no Polenta project: pick an empty folder or an existing project. |
| `notAWorkspace`, `opening`, `cloning`, `creating` | *(gardées)* | |

Clés supprimées (plus utilisées) : `projectFolderPlaceholder`, `selectProject`, `open`,
`destinationFolderPlaceholder`, `clone`, `projectNamePlaceholder`, `create`. Il faut vérifier par
grep qu'aucune autre page ne les utilise avant de les retirer.

## Décisions et alternatives

- **Dossier choisi = dossier conteneur**, comme aujourd'hui pour clone et création. Le repo est
  placé dans `<dossier>/<nom-du-repo>` ou `<dossier>/<nom>`. Ce comportement est inchangé.
- **Dossier non vide refusé (D3)** grâce au canal `workspace:is-empty-dir`. Le design initial
  s'en passait (contrainte « aucun IPC »), mais `workspace:detect` ne distingue que `workspace`,
  `repo` et `unknown` et ne peut pas dire si un dossier est vide. L'humain a validé l'ajout du
  canal. La démo n'écrit donc jamais dans un dossier qui contient autre chose qu'un projet Polenta,
  repo git compris.
- **Démo dans un projet existant (D2)** : on passe par `detect` puis `openProject`, et non par
  `openProject` seul. Sinon, un repo git arbitraire serait « adopté » comme projet (comportement
  T69 de `openProject` pour `kind === 'repo'`), ce qui ne doit pas arriver quand l'utilisateur
  demande la démo.
- **Popup puis sélecteur natif, plutôt qu'un popup contenant aussi un champ dossier** : un clic de
  moins, validé par l'humain en phase Spec.
- **Alternative rejetée** : un composant `Modal` générique partagé. Les modales de l'app sont
  écrites au cas par cas, et en introduire un générique sortirait du périmètre. Un nouveau besoin
  ferait l'objet d'une issue séparée.
- Les statuts `diamond-conflict` et `parse-error` renvoyés par `openProject`, `createFromClone` et
  `createNew` ne sont pas traités sur cette page aujourd'hui. Ce comportement est conservé : hors
  scope.

## Découpage

Un sprint : canal `workspace:is-empty-dir`, refonte de `index.tsx`, `TextPromptModal`, constante
démo, i18n, mise à jour de
SPEC-ELECTRON-DESKTOP §16.3/§16.5 et de SPEC-INDEX.
