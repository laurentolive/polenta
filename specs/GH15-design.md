# GH15 — Design : délais d'attente réseau réglables

Spec : `specs/GH15.md`. **Un seul sprint.**

## 1. Constats sur le code

- **Délai de connexion** : undici le fixe dans `buildConnector` (`core/connect.js`, défaut 10 s),
  qui couvre TCP + TLS. Aucun dispatcher de Polenta ne le règle :
  - connexion directe : `resolveProxyDispatcher` renvoie `undefined`, donc le dispatcher global
    d'undici s'applique ;
  - via proxy : `ProxyAgent` (undici 6.28) construit deux connecteurs, `proxyTls` (connexion au
    proxy) et `requestTls` (TLS vers la cible **à travers le tunnel**), avec 10 s par défaut chacun.
    Sur un lien filtré, c'est le second qui expire (le proxy répond vite, la cible non).
    La réponse au `CONNECT` passe par le `Client` du proxy (`headersTimeout` 300 s), donc pas en cause.
- **En-têtes / corps** : réglés par requête (`headersTimeout` / `bodyTimeout` de `undici.request`).
  `forge-http.ts` passe `opts.timeoutMs ?? 20_000`, `git-http.ts` ne passe rien (300 s par défaut).
- **Erreurs** : `undici.request` lève des erreurs dont le `code` est **sur l'erreur elle-même**
  (`UND_ERR_CONNECT_TIMEOUT`, `UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT`).
  `describeFetchError` ne lit que `err.cause.code` (modèle `fetch`), donc pour les appels de la
  forge un délai de connexion dépassé ressort aujourd'hui en « Connect Timeout Error » brut.
  Côté git, `sync.service.ts` (`guarded` → `classifyAccessError`) renvoie l'erreur réseau telle quelle.
- **Préférences** : `AppSettingsService` est instancié par `createContainer` (`container.ts`), donc
  **aussi par le serveur web, une fois par utilisateur** (`user-pool.ts`), et le canal
  `app:set-settings` est exposé au web (`channel-policy.ts`). Un état de délai **global au process**
  ne doit donc être piloté que par l'hôte desktop.
- **Panneau compte** : la section « Préférences » (`AccountPanel.tsx`) s'affiche **même sans compte
  connecté** (elle est hors du bloc `identity`). Le réglage y sera donc accessible avant connexion,
  pour peu que l'utilisateur ouvre le panneau compte (voir §6, divergence favorable).

## 2. Fichiers

| Fichier | Modification |
|---|---|
| `apps/desktop/src/shared/network-timeout.ts` | **Nouveau.** Constantes et normalisation, partagées main / renderer. |
| `apps/desktop/src/main/services/net-timeouts.ts` | **Nouveau.** État du process (délai courant) et calcul des délais effectifs. |
| `apps/desktop/src/main/services/net-timeouts.test.ts` | **Nouveau.** Tests unitaires. |
| `packages/types/src/app.ts` | `AppSettings.networkTimeoutSeconds?: number`. |
| `apps/desktop/src/main/services/app-settings.service.ts` | Lecture/normalisation, écriture seulement si ≠ défaut, rappel `onNetworkTimeout`. |
| `apps/desktop/src/main/host/host-context.ts` | `HostContext.applyNetworkTimeout?: (seconds: number) => void`. |
| `apps/desktop/src/main/host/electron-host.ts` | Fournit `applyNetworkTimeout: setNetworkTimeoutSeconds`. |
| `apps/desktop/src/main/container.ts` | Passe `host.applyNetworkTimeout` à `AppSettingsService`. |
| `apps/desktop/src/main/services/net-proxy.ts` | Dispatcher toujours explicite avec délai de connexion ; cache par (proxy, délai) ; `describeFetchError` lit le code sur l'erreur ou sa cause et cite le réglage. |
| `apps/desktop/src/main/services/git-http.ts` | `headersTimeout`/`bodyTimeout` explicites ; traduction des erreurs de délai. |
| `apps/desktop/src/main/services/forge/forge-http.ts` | Défaut 20 s → `forgeTimeout(20_000)`, et applique le facteur à `opts.timeoutMs`. |
| `apps/desktop/src/main/services/export/template/image-source.ts` | `AbortSignal.timeout(scaledTimeout(10_000))`. |
| `apps/desktop/src/renderer/platform.ts` | `capabilities.networkTimeout: !isWeb`. |
| `apps/desktop/src/renderer/components/sidebar/AccountPanel.tsx` | Champ numérique dans « Préférences ». |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | Libellé + aide. |
| Tests existants touchés | `app-settings` (nouveau `app-settings.service.test.ts` si absent), `net-proxy` (nouveau `net-proxy.test.ts`), `git-http` (nouveau `git-http.gh15.test.ts`). |

Les sondes à 10 s (`forgejo.provider.ts`, `github.provider.ts`, `forge-config.service.ts`) **ne
changent pas** : elles passent `timeoutMs: 10_000`, que `forgeRequest` met désormais à l'échelle
(une seule modification centrale plutôt que cinq appels).

## 3. Interfaces

### 3.1 `shared/network-timeout.ts`

```ts
/** GH15 — délai de connexion réseau (s) : défaut = comportement d'origine d'undici. */
export const NETWORK_TIMEOUT_DEFAULT = 10
export const NETWORK_TIMEOUT_MIN = 10
export const NETWORK_TIMEOUT_MAX = 120

/** Entier dans [MIN, MAX], sinon le défaut (valeur absente, texte, décimale, hors bornes). */
export function normalizeNetworkTimeout(value: unknown): number
```

### 3.2 `main/services/net-timeouts.ts`

```ts
/** Délai réglé par l'utilisateur, global au process — piloté par l'hôte desktop uniquement. */
export function setNetworkTimeoutSeconds(seconds: number): void   // normalise
export function getNetworkTimeoutSeconds(): number

/** Délai de base (calibré pour 10 s) × (réglage / 10). */
export function scaledTimeout(baseMs: number): number

export const CONNECT_TIMEOUT_BASE_MS = 10_000   // undici
export const GIT_IO_TIMEOUT_BASE_MS = 300_000   // en-têtes / corps git (défaut undici)
export const FORGE_TIMEOUT_BASE_MS = 20_000     // API forge
```

Lecture à chaque requête (pas de copie mise en cache) : un changement vaut pour la requête suivante
(CA5), une requête en cours garde ses délais.

### 3.3 `AppSettings`

```ts
/** GH15 — délai de connexion réseau (s), 10–120. Absent = 10 (défaut). */
networkTimeoutSeconds?: number
```

`AppSettingsService` :
- `read()` : `networkTimeoutSeconds` présent seulement si la valeur normalisée ≠ défaut ;
- `get()` renvoie toujours `networkTimeoutSeconds` renseigné (normalisé, défaut compris) pour l'UI ;
- `set(patch)` : normalise ; supprime la clé du fichier si égale au défaut (comme
  `exportTemplatesDir` vide) ; appelle `onNetworkTimeout(valeur)` ;
- nouveau 4ᵉ paramètre du constructeur `onNetworkTimeout?: (seconds: number) => void`, appelé
  aussi **à la construction** avec la valeur lue (le délai est en place dès le démarrage).

Sur le web, `createWebHostContext` ne fournit pas `applyNetworkTimeout` : la préférence d'un
utilisateur web serait stockée dans son `app-settings.json` mais n'agit jamais sur le process
partagé, et l'UI ne la propose pas (`capabilities.networkTimeout`).

### 3.4 `net-proxy.ts`

```ts
export async function resolveProxyDispatcher(targetUrl: string): Promise<Dispatcher>
```

- Délai `t = scaledTimeout(CONNECT_TIMEOUT_BASE_MS)`.
- Sans proxy : `new Agent({ connect: { timeout: t } })`, mis en cache par `t`.
- Avec proxy : `new ProxyAgent({ uri: proxyUrl, proxyTls: { timeout: t }, requestTls: { timeout: t } })`,
  mis en cache par `` `${proxyUrl}|${t}` ``.
- Le type de retour n'est plus `| undefined` (les appelants passent déjà la valeur telle quelle à
  `dispatcher`). Avec le réglage par défaut, le comportement est identique à aujourd'hui
  (10 s, comme le dispatcher global).
- Les anciens agents ne sont pas fermés au changement (au plus quelques entrées, réglage rare) :
  une requête en cours les utilise encore.

**Erreurs** — nouveau helper exporté et `describeFetchError` étendu :

```ts
const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'])
export function isTimeoutError(err: unknown): boolean          // code sur l'erreur ou sa cause
export function describeTimeout(detail: string): string
// « Délai dépassé (délai de connexion réseau : 30 s) — augmentez-le dans Compte → Délai de
//   connexion réseau, ou vérifiez le proxy/pare-feu de l'entreprise. (<détail>) »
```

`describeFetchError` lit `code = err.code ?? err.cause?.code` et renvoie `describeTimeout(...)`
pour les codes de délai. Les autres cas sont inchangés.

`isNetworkUnreachable` **n'est pas modifié** : `UND_ERR_CONNECT_TIMEOUT`/`ETIMEDOUT` y sont déjà
(auto-pull silencieux, échec réseau explicite de Publier, inchangés) ; un délai d'en-têtes ou de
corps dépassé reste une erreur affichée, comme aujourd'hui avec 300 s.

### 3.5 `git-http.ts`

```ts
const t = scaledTimeout(GIT_IO_TIMEOUT_BASE_MS)
try {
  res = await undiciRequest(url, { dispatcher, method, headers, body, headersTimeout: t, bodyTimeout: t })
} catch (err) {
  if (isTimeoutError(err)) throw Object.assign(new Error(describeTimeout(...)), { code: <code d'origine>, cause: err })
  throw err
}
```

Le `code` d'origine est conservé sur l'erreur traduite, donc `isNetworkUnreachable` et
`classifyAccessError` (`sync.service.ts`) la classent comme avant ; seul le message change.
Un délai de corps dépassé **pendant la lecture** du flux (après `request`) sort par l'itérateur
d'isomorphic-git, hors de ce `try` : on enveloppe l'itérateur `res.body` pour traduire aussi cette
erreur (petit générateur `async function* translateTimeouts(body)`).

### 3.6 `forge-http.ts`

```ts
const timeout = scaledTimeout(opts.timeoutMs ?? FORGE_TIMEOUT_BASE_MS)
```

Les appelants traduisent déjà via `describeFetchError` (`auth.service`, `forge.service`,
`forgejo/github.provider`, `forge-config.service`) — qui, corrigé (§3.4), cite désormais le réglage.

### 3.7 UI — `AccountPanel.tsx`

Dans « Préférences », sous la mise à jour automatique, si `capabilities.networkTimeout` :

```
Délai de connexion réseau (s)   [ 10 ]     (input type=number, min 10, max 120, step 1, w-16)
```

- `title` = aide (spec §1). Valeur chargée par `api.app.getSettings()` (même `useEffect`).
- Enregistrement au `blur` / Entrée : valeur hors bornes ou non entière → champ remis à la valeur
  enregistrée, sans appel. Sinon `api.app.setSettings({ networkTimeoutSeconds })` et affichage de
  la valeur renvoyée.
- i18n : `account.panel.networkTimeout`, `account.panel.networkTimeoutHint` (fr, en).

Le message d'erreur des services main reste en français (comme tous les messages de
`describeFetchError` aujourd'hui) — la traduction des erreurs du main est hors du périmètre.

## 4. Décisions et alternatives rejetées

| Décision | Alternative rejetée | Raison |
|---|---|---|
| Facteur unique `réglage / 10` appliqué à des délais de base | Valeurs séparées par appel | Décision de spec (un seul délai). |
| État global piloté par un rappel de l'hôte desktop | Lire `AppSettingsService` dans `net-proxy` | Le serveur web a un `AppSettingsService` par utilisateur dans un seul process : un réglage utilisateur ne doit pas changer les délais de tous. |
| Dispatcher toujours explicite (`Agent`) | `setGlobalDispatcher` | Le global toucherait aussi le serveur web et les fetch non concernés ; l'explicite est local aux appels de la forge et de git. |
| Mise à l'échelle centrale dans `forgeRequest` | Modifier les 5 appels à 10 s | Un seul point, les sondes gardent leur rapport court/long. |
| `isNetworkUnreachable` inchangé | Y ajouter les délais d'en-têtes/corps | Pas de changement de comportement de l'auto-pull/Publier hors périmètre ; seul le message change. |
| Traduction des délais git dans `git-http.ts` | Dans `sync.service.ts` | Un seul point pour clone/fetch/pull/push ; `sync.service` garde ses chemins GH30/GH43/GH45. |

## 5. Tests

Voir `specs/GH15-tests.md`. Tests e2e web : sans objet (fonction desktop uniquement, masquée sur
le web) ; on vérifie seulement que les e2e web existants restent verts.

## 6. Divergence avec la spec (favorable)

La spec place le réglage « après connexion ». En pratique la section « Préférences » du panneau
compte est déjà affichée sans compte connecté : le réglage est donc atteignable avant la
connexion, si le panneau compte est accessible depuis l'écran courant. Aucun lien n'est ajouté sur
l'écran de connexion (hors scope inchangé).

## 7. Découpage

Un sprint : ~10 fichiers, aucune migration de données, pas de changement de canal IPC
(`app:get-settings` / `app:set-settings` existants).
