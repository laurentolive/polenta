# GH15 — Scénarios de test

Spec : `specs/GH15.md` · Design : `specs/GH15-design.md`.

## Tests automatiques (vitest, `pnpm test`)

### T1 — Normalisation (`shared/network-timeout.ts`) — CA2
| Entrée | Attendu |
|---|---|
| `undefined`, `null`, `'30'`, `NaN` | 10 |
| `5`, `9`, `121`, `500` | 10 |
| `12.5` | 10 |
| `10`, `30`, `120` | inchangé |

### T2 — Calcul des délais (`net-timeouts.ts`) — CA3, CA5
- Réglage par défaut : `scaledTimeout(10_000) = 10_000`, `scaledTimeout(20_000) = 20_000`,
  `scaledTimeout(300_000) = 300_000`.
- `setNetworkTimeoutSeconds(30)` : 30 000 / 60 000 / 900 000 ; l'appel suivant à `scaledTimeout`
  voit la nouvelle valeur sans autre action.
- `setNetworkTimeoutSeconds(500)` → normalisé à 10.

### T3 — `AppSettingsService` — CA1, CA2
- Fichier absent → `get().networkTimeoutSeconds === 10`, `onNetworkTimeout` appelé avec 10 à la construction.
- `set({ networkTimeoutSeconds: 40 })` → fichier contient `40`, `get()` renvoie 40, rappel appelé avec 40.
- Nouvelle instance sur le même dossier → 40 (persistance) et rappel avec 40.
- `set({ networkTimeoutSeconds: 10 })` → la clé disparaît du fichier.
- Fichier contenant `"networkTimeoutSeconds": "abc"` / `5` / `500` → 10, pas d'exception.
- Sans rappel (cas web) : `set` fonctionne, aucune erreur.
- Les autres préférences (`autoCheckUpdates`, `exportTemplatesDir`, verrou GH45) ne changent pas.

### T4 — Dispatcher (`net-proxy.ts`) — CA4
- Sans proxy, réglage 10 puis 30 : `resolveProxyDispatcher` renvoie un `Agent` dont le délai de
  connexion vaut 10 000 puis 30 000 ms (vérifier via un spy/mock du constructeur undici) ; deux
  appels au même réglage renvoient la même instance.
- Avec `HTTPS_PROXY=http://proxy:3128`, réglage 30 : `ProxyAgent` construit avec
  `proxyTls.timeout = requestTls.timeout = 30 000`.

### T5 — Messages (`describeFetchError`, `isTimeoutError`) — CA7
- Erreur undici `{ code: 'UND_ERR_CONNECT_TIMEOUT' }` (code sur l'erreur) → message contenant
  « Compte → Délai de connexion réseau » et la valeur courante (« 10 s », puis « 30 s » après réglage).
- Même chose avec le code dans `cause` (forme `fetch failed`).
- `UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT`, `ETIMEDOUT` → même message.
- `ENOTFOUND`, `ECONNREFUSED`, certificat → messages actuels inchangés (non-régression).
- `isNetworkUnreachable` : résultats inchangés pour tous les codes existants.

### T6 — git-http, lien lent simulé — CA4, CA6, CA7
Serveur local de test : un relais TCP qui accepte la connexion puis **retarde** le transfert vers
un petit serveur HTTPS local (certificat auto-signé accepté pour le test) d'un délai `D`.
Pour garder le test court, les délais de base sont réduits par un crochet de test de
`net-timeouts.ts` (ex. base de connexion 200 ms) ; `D` = 400 ms.
- Réglage 10 (f = 1, délai 200 ms) → `request` échoue ; message cite le réglage ; `code` conservé
  (`UND_ERR_CONNECT_TIMEOUT`) et `isNetworkUnreachable(err) === true`.
- Réglage 30 (f = 3, délai 600 ms) → la réponse arrive (statut 200).
- Délai de corps : le serveur envoie les en-têtes puis s'interrompt au-delà du délai de corps →
  l'erreur levée **par l'itérateur du corps** porte le message traduit.

### T7 — forge-http — CA4
- `forgeRequest` sans `timeoutMs`, réglage 30 → `headersTimeout`/`bodyTimeout` = 60 000 (mock de
  `undici.request`).
- `timeoutMs: 10_000`, réglage 30 → 30 000.

### T8 — image-source — CA8
- Réglage 30 → `AbortSignal.timeout` appelé avec 30 000 (spy).

## Non-régression

- `pnpm test` complet vert ; typecheck / lint sans nouvelle erreur.
- `pnpm --filter @polenta/desktop test:e2e:web` vert (le réglage n'apparaît pas sur le web).

## Tests manuels (desktop)

### M1 — UI — CA1
1. Ouvrir le panneau compte → « Préférences » : « Délai de connexion réseau (s) » = 10.
2. Saisir 40, quitter le champ → valeur 40 ; `app-settings.json` (userData) contient `"networkTimeoutSeconds": 40`.
3. Saisir 5 puis 200 puis 12,5 → champ remis à 40, fichier inchangé.
4. Redémarrer → 40.
5. Remettre 10 → la clé disparaît du fichier.
6. Déconnecté (aucun compte) : le réglage est présent dans « Préférences ».

### M2 — Lien lent par proxy de test — CA6, CA7
1. Lancer un proxy HTTP local qui retarde de 15 s la mise en relation avec la cible (ex. script
   Node de quelques lignes : `CONNECT` accepté, `setTimeout(15000)` avant de relier les sockets).
2. Démarrer Polenta avec `HTTPS_PROXY=http://127.0.0.1:<port>`.
3. Réglage 10 : cloner un projet GitHub → échec en ~10 s ; le message cite « Compte → Délai de
   connexion réseau » et « 10 s ».
4. Régler 30, **sans redémarrer**, relancer le clone → aboutit. Un « Rafraîchir » (fetch) aboutit aussi.
5. Remettre 10 → le fetch échoue de nouveau avec le message.

### M3 — Hors ligne — cas d'usage 4
Réglage 60, couper le réseau, lancer un fetch → échec immédiat (DNS), message actuel, pas d'attente de 60 s.

### M4 — Confirmation terrain — CA9
Collaborateur en Chine, projet GitHub réel : clone, fetch, Publier avec un délai augmenté (30–60 s).
