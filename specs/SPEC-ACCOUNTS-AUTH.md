# SPEC-ACCOUNTS-AUTH — Connexion et gestion des comptes git

> Dernière révision : 2026-07-15 (T98)  
> Dépend de : [SPEC-ELECTRON-DESKTOP.md](SPEC-ELECTRON-DESKTOP.md)

---

## 1. Principes fondamentaux

| Règle | Détail |
|-------|--------|
| **Un compte = un remote host + un token** | Aucun mot de passe brut n'est jamais stocké ou envoyé. Tout accès git/API passe par un token (PAT ou token OAuth), stocké dans le trousseau OS via `keytar` (service `polenta`), jamais en clair sur disque. |
| **`auth.json` (`userData`) ne stocke pas de secrets** | Il ne contient que les métadonnées de compte (`StoredAccount` : host, username, name, email) et le compte par défaut — les tokens vivent exclusivement dans `keytar`. |
| **Deux méthodes de connexion, à égalité** | Formulaire PAT (tout host) et OAuth Device Flow (github.com uniquement) sont deux chemins vers le même stockage — aucune UI ne distingue un compte connecté via l'un ou l'autre après coup. |
| **PAT-only pour les hosts non-GitHub** | GitLab, Gitea, GitHub Enterprise Server et tout remote personnalisé passent uniquement par le formulaire PAT — pas de Device Flow implémenté pour ces providers à ce jour. |

---

## 2. Formulaire PAT (`/login`)

L'utilisateur choisit un remote (`https://github.com`, `https://gitlab.com`, `https://gitea.io` ou « Autre… ») et colle un Personal Access Token.

`AuthService.setup(remote, pat)` :
1. Sauvegarde le token dans `keytar` sous la clé `extractHost(remote)`.
2. Résout l'identité (`resolveIdentity` — GitHub via `api.github.com/user`, sinon tentative Gitea `/api/v1/user`, sinon identité minimale de repli).
3. Sauvegarde le token une seconde fois sous `${host}:${login}` et persiste le compte dans `auth.json`.

`resolveIdentity(remote, token)` reçoit toujours le **remote complet** (scheme + host + port éventuel), jamais seulement le hostname extrait — nécessaire pour les remotes self-hosted sur port non-standard ou en HTTP.

## 3. GitHub OAuth Device Flow (T98)

Second mode de connexion, visible uniquement quand le remote effectif résout vers `github.com` (comparaison par hostname normalisé, pas de comparaison de chaîne stricte — tolère `https://github.com/`, casse différente, etc.).

**Prérequis** : une OAuth App GitHub avec *Device Flow* activé (Settings → Developer settings → OAuth Apps → onglet **Optional features**), son `client_id` embarqué en dur dans `auth.service.ts` (constante `GITHUB_OAUTH_CLIENT_ID`, non secret par nature — le Device Flow ne nécessite aucun *client secret*). Pas de variable d'environnement : `electron-vite` ne charge pas les `.env` non préfixés dans `process.env` du process main, une config externe aurait été silencieusement ignorée.

**Séquence :**
1. `AuthService.startDeviceFlow(remote)` — vérifie `host === 'github.com'`, `POST github.com/login/device/code`, ouvre `verification_uri` dans le navigateur système (`shell.openExternal`), renvoie `{ deviceCode, userCode, verificationUri, expiresIn, interval }`.
2. Le renderer affiche `userCode` et poll `AuthService.pollDeviceFlow(remote, deviceCode)` — self-scheduling via `setTimeout` (jamais de recouvrement de requêtes), avec un compteur de génération : toute réponse qui arrive après une annulation ou un redémarrage du polling est silencieusement ignorée.
3. `pollDeviceFlow` renvoie un statut discriminé : `pending` (continue), `slow_down` (nouvel intervalle, cf. §4), `success` (identité résolue + jeton persisté via le même `persistToken` que le PAT), `expired`, `denied`, ou `error`.
4. `pollDeviceFlow` vérifie aussi `host === 'github.com'` avant d'interroger l'endpoint GitHub — un remote non-GitHub ne peut jamais faire persister un token GitHub sous son propre host.

**Annulation** : bouton « Annuler » côté renderer — arrête le polling programmé et invalide la génération courante, donc une réponse encore en vol ne peut plus altérer l'état affiché après coup.

## 4. Stockage partagé (`AuthService.persistToken`)

`setup()` (PAT) et `pollDeviceFlow()` (OAuth) convergent vers un unique helper privé `persistToken(remote, token)` :
- Clé `keytar` = `extractHost(remote)` (host seul, cohérent avec le reste du service).
- Résolution d'identité = **remote complet** transmis tel quel à `resolveIdentity` (pas de reconstruction d'URL — le scheme et le port du remote d'origine doivent survivre intacts).
- En cas d'échec de résolution d'identité (Gitea sans API, host injoignable) : repli sur une identité minimale `{ login: 'git', name: 'Git User', email: 'git@{host}' }`, le token reste néanmoins stocké.

## 5. Hors scope actuel

- Device Flow pour GitLab.com / Gitea (potentiellement supporté par ces plateformes, non implémenté)
- Rafraîchissement de token (les tokens OAuth Device Flow d'une GitHub OAuth App classique n'expirent pas par défaut)
- Migration automatique d'un compte PAT existant vers OAuth
