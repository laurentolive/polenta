# T98 — Design : GitHub OAuth Device Flow

## Découpage en sprints

**Un seul sprint.** Périmètre contenu : un service, deux canaux IPC, un client typé, un écran.
Pas de nouveau modèle de données métier (exigences/tests/liens non touchés), pas de migration.

## Fichiers à modifier

| Fichier | Changement |
|---|---|
| `apps/desktop/src/main/services/auth.service.ts` | Ajout `startDeviceFlow`, `pollDeviceFlow` ; extraction d'un helper privé `persistToken` partagé avec `setup()` |
| `apps/desktop/src/main/ipc/index.ts` | Deux nouveaux handlers `auth:device-flow-start`, `auth:device-flow-poll` |
| `packages/api-client/src/types.ts` | Types `DeviceFlowSession`, `DeviceFlowPollResult` ; extension de `ApiClient['auth']` |
| `packages/api-client/src/ipc-client.ts` | Deux nouvelles méthodes dans le namespace `auth` |
| `apps/desktop/src/renderer/routes/login.tsx` | Bloc « Se connecter avec GitHub » (visible seulement si remote = github.com), état machine de polling |

Aucun fichier supprimé. `AccountPanel.tsx` / `account.tsx` ne changent pas : ils lisent déjà
l'identité résolue de façon générique (peu importe PAT ou Device Flow, même stockage).

## Nouveaux types (`packages/api-client/src/types.ts`)

```ts
export interface DeviceFlowSession {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number   // secondes, ~900 côté GitHub
  interval: number     // secondes, ~5 côté GitHub
}

export type DeviceFlowPollResult =
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'success'; identity: { login: string; name: string; email: string; remote: string } }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'error'; message: string }
```

`ApiClient['auth']` gagne :
```ts
startDeviceFlow: (remote: string) => Promise<DeviceFlowSession>
pollDeviceFlow: (remote: string, deviceCode: string) => Promise<DeviceFlowPollResult>
```

## `AuthService` — nouvelles méthodes

```ts
private get githubClientId(): string {
  return process.env['GITHUB_OAUTH_CLIENT_ID'] ?? ''
}

async startDeviceFlow(remote: string): Promise<DeviceFlowSession> {
  const host = extractHost(remote)
  if (host !== 'github.com') {
    throw new Error('Device Flow disponible uniquement pour github.com')
  }
  if (!this.githubClientId) {
    throw new Error('GITHUB_OAUTH_CLIENT_ID non configuré — voir README de déploiement')
  }
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: this.githubClientId, scope: 'repo' }),
  })
  const data = await res.json() as {
    device_code: string; user_code: string; verification_uri: string
    expires_in: number; interval: number
  }
  await shell.openExternal(data.verification_uri)
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval,
  }
}

async pollDeviceFlow(remote: string, deviceCode: string): Promise<DeviceFlowPollResult> {
  const host = extractHost(remote)
  try {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: this.githubClientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })
    const data = await res.json() as { access_token?: string; error?: string; interval?: number }

    if (data.access_token) {
      const identity = await this.persistToken(host, data.access_token)
      return { status: 'success', identity: { ...identity, remote: `https://${host}` } }
    }
    switch (data.error) {
      case 'authorization_pending': return { status: 'pending' }
      case 'slow_down': return { status: 'slow_down', interval: data.interval ?? 10 }
      case 'expired_token': return { status: 'expired' }
      case 'access_denied': return { status: 'denied' }
      default: return { status: 'error', message: data.error ?? 'Erreur inconnue' }
    }
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}

// Extrait de l'ancien corps de setup() — partagé par setup() (PAT) et pollDeviceFlow() (OAuth)
private async persistToken(host: string, token: string): Promise<{ login: string; name: string; email: string }> {
  await keytar.setPassword(KEYTAR_SERVICE, host, token)
  try {
    const identity = await this.resolveIdentity(`https://${host}`, token)
    await keytar.setPassword(KEYTAR_SERVICE, `${host}:${identity.login}`, token)
    await this.saveAccount({ remoteHost: host, username: identity.login, name: identity.name, email: identity.email })
    return identity
  } catch {
    return { login: 'git', name: 'Git User', email: `git@${host}` }
  }
}
```

`setup(remote, pat)` devient un simple appel `persistToken(extractHost(remote), pat)` — comportement
inchangé, juste dé-dupliqué.

Import ajouté en tête de fichier : `import { shell } from 'electron'`.

## IPC (`ipc/index.ts`)

```ts
ipcMain.handle('auth:device-flow-start', (_e, remote: string) => c.auth.startDeviceFlow(remote))
ipcMain.handle('auth:device-flow-poll', (_e, remote: string, deviceCode: string) =>
  c.auth.pollDeviceFlow(remote, deviceCode))
```

## Renderer (`login.tsx`)

- Nouveau state local : `deviceState: 'idle' | 'waiting' | 'error'`, `session: DeviceFlowSession | null`,
  `deviceError: string | null`, `pollIntervalMs: number` (initialisé à `session.interval * 1000`).
- Bloc visible seulement si `effectiveRemote === 'https://github.com'`, au-dessus du formulaire PAT,
  séparé par un `<hr>`/texte « ou ».
- `handleStartDeviceFlow` : appelle `api.auth.startDeviceFlow(remote)`, stocke la session, passe
  `deviceState` à `waiting`, démarre un `setInterval` (via `useRef` pour l'ID, cleanup au démontage
  et à l'annulation) qui appelle `api.auth.pollDeviceFlow(remote, session.deviceCode)` :
  - `pending` → ne rien faire, attendre le prochain tick
  - `slow_down` → `clearInterval` + relance avec le nouvel `interval`
  - `success` → `clearInterval`, `navigate({ to: '/' })`
  - `expired` / `denied` / `error` → `clearInterval`, affiche message, repasse `deviceState` à `idle`
    (le bouton redevient cliquable, une nouvelle demande de code repart de zéro)
- Bouton **Annuler** visible seulement en état `waiting` : `clearInterval`, reset à `idle`.
- `useEffect` cleanup : `clearInterval` au démontage du composant (protection navigation).
- Affichage pendant `waiting` : code utilisateur en gros (`font-mono text-2xl tracking-widest`),
  bouton « Copier le code », lien texte « Ouvrir github.com/login/device » (au cas où l'ouverture
  automatique du navigateur ait échoué ou été bloquée), texte « En attente de validation dans le
  navigateur… ».
- Formulaire PAT en dessous, inchangé, toujours actif.

## Décisions techniques et alternatives rejetées

- **Polling piloté par le renderer** (`setInterval` côté React, un `invoke` par tick) plutôt qu'un
  push d'événements main→renderer (`webContents.send`). Rejeté : le codebase n'a aujourd'hui aucun
  canal d'événements équivalent déjà câblé bout en bout (le seul `onProgress` existant, dans
  `sync.service.ts`, n'est pas relié à un canal IPC côté renderer) — introduire ce mécanisme pour un
  seul cas d'usage serait une abstraction disproportionnée. Le polling client est strictement
  équivalent fonctionnellement et suit le pattern request/response déjà utilisé partout ailleurs.
- **Ouverture du navigateur** faite côté main (`shell.openExternal` dans `startDeviceFlow`) plutôt
  que d'ajouter un canal IPC générique `shell:open-external`. Rejeté d'ajouter un canal générique :
  un seul point d'appel existe pour l'instant (le début du Device Flow), pas besoin d'une
  abstraction réutilisable non demandée par ce ticket.
- **`client_id` en variable d'environnement** (`GITHUB_OAUTH_CLIENT_ID`, lu via `process.env` dans le
  process main, cohérent avec `ELECTRON_RENDERER_URL` déjà utilisé dans `main/index.ts`) plutôt que
  codé en dur dans le dépôt. Un `client_id` OAuth App n'est pas un secret (aucun `client_secret`
  n'est nécessaire pour le Device Flow), mais le garder configurable évite de coupler le code à une
  seule OAuth App et permet de pointer vers une App de test en dev.
- **Échec réseau pendant le polling → statut `error` terminal** (arrête le polling, message affiché,
  retour à `idle`) plutôt que de continuer à re-essayer silencieusement. Rejeté de masquer l'échec :
  un utilisateur qui perd sa connexion doit voir un message clair et relancer manuellement plutôt
  que de fixer un écran « en attente » indéfiniment sans retour.
- **Pas de refresh token** : les tokens Device Flow des OAuth Apps GitHub classiques n'expirent pas
  par défaut (contrairement aux GitHub Apps) — cohérent avec le traitement actuel des PAT (pas
  d'expiration gérée non plus).

## Point ouvert transporté depuis la spec

`GITHUB_OAUTH_CLIENT_ID` doit être fourni (OAuth App GitHub à créer par le mainteneur, aucun secret
requis côté client) avant de pouvoir tester le flow de bout en bout. Sans cette valeur, le bouton
reste fonctionnel mais affiche l'erreur de configuration dès le premier clic (cf. scénario 4 dans
`T98-tests.md`) — le développement du reste du flow ne dépend pas de l'avoir en main immédiatement
(mockable en test).
