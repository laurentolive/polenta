# GH238 — Scénarios de test

Spec : `specs/GH238.md` · Design : `specs/GH238-design.md`.

## Unitaires (vitest)

### `terminal-shell.util.test.ts`
- T1 Windows, `git.exe` dans `<racine>\cmd` du PATH et `<racine>\bin\bash.exe` présent → Git Bash `--login -i`.
- T2 Windows, PATH sans git, `%ProgramFiles%\Git\bin\bash.exe` présent → trouvé (installation faite après le lancement).
- T3 Windows, `git.exe` dans `<racine>\mingw64\bin` → racine remontée de deux niveaux.
- T4 Windows, rien → `null`.
- T5 macOS, `SHELL=/bin/zsh` → zsh `-l` ; `SHELL` absent → `/bin/bash`.
- T6 `shellEnv` retire `ELECTRON_RUN_AS_NODE`, `ELECTRON_RENDERER_URL`, `POLENTA_USER_DATA_DIR` ; pose `TERM`, `CHERE_INVOKING` (Windows seulement).
- T7 `cdCommand('C:\\Dev\\a b', 'win32')` → `cd '/c/Dev/a b'\r` ; chemin avec apostrophe échappé.

### `terminalShortcut.test.ts`
- T8 `Ctrl+ù` (AZERTY), `Ctrl+`` ` (QWERTY), `code: 'Backquote'` → vrai ; avec Maj/Alt/Meta ou `repeat` → faux.
- T9 `isVersionRoute` : vrai pour les 4 routes, faux pour `/requirements`, `/graph-x`.
- T10 `QuietRefresh` : sortie sans Entrée → aucun appel ; Entrée puis sorties espacées < 500 ms → un seul appel 500 ms après la dernière ; nouvel Entrée → réarmé.

### Existant
- T11 `channel-policy.test.ts` vert (nouveaux canaux dans `DESKTOP_ONLY_CHANNELS`).

## E2E desktop (`e2e-desktop/gh238-terminal.spec.ts`, Windows avec Git for Windows)

Repo git local créé dans un dossier temporaire, ouvert comme projet dans un profil isolé.

- E1 Sur `/graph`, `Ctrl+ù` → panneau visible, invite bash, `pwd` affiche le repo (U1, CA1, CA2).
- E2 `echo GH238 > f.txt && git add f.txt` → `f.txt` apparaît dans Stagés du panneau Version sans action (U6, CA6).
- E3 `Ctrl+ù` → panneau masqué ; navigation `/requirements` → `Ctrl+ù` sans effet ; retour `/graph`, `Ctrl+ù` → contenu précédent toujours affiché (U9, U10, U17, CA4).
- E4 `exit` → message « processus terminé » ; Entrée → nouvelle invite (U12).
- E5 Bouton Tuer pendant `sleep 30` → message de fin, aucun processus `bash.exe` enfant restant (CA7).
- E6 Bouton du header Version ouvre / ferme le panneau.

## Manuels (non automatisables ou dépendants du poste)

- M1 `git log` long : pager `less`, `q` (U3).
- M2 `git rebase -i HEAD~2` avec l'éditeur de Git Bash (U4).
- M3 Rebase en conflit → `git rebase --abort` → graphe et statut à jour (U5).
- M4 `git fetch` sur un remote lent, `Ctrl+C` sans sélection interrompt ; avec sélection copie (U7, U8, CA5).
- M5 Repo composant sélectionné → « Aller au repo sélectionné » → `pwd` (U11).
- M6 Changement de projet → réouverture : nouveau shell dans le nouveau projet (U13).
- M7 Redimensionner le panneau pendant `git log --oneline --graph` : pas de ligne cassée (CA3).
- M8 Thème clair / sombre : couleurs du terminal suivent.
- M9 Poste sans Git (VM / renommer temporairement le dossier Git) : message, Installer Git via winget, shell ouvert sans redémarrer ; sans winget → page git-scm.com (U14–U16, CA8).
- M10 Fermer Polenta pendant `git fetch` : aucun `bash.exe` / `git.exe` orphelin dans le Gestionnaire des tâches (U18).
- M11 Build packagé (`pnpm package`) : le terminal démarre depuis l'application installée (CA10).
