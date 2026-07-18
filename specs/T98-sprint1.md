# T98 — Sprint 1 (dernier sprint) : GitHub OAuth Device Flow

## Fichiers modifiés

- `apps/desktop/src/main/services/auth.service.ts` — `startDeviceFlow`, `pollDeviceFlow`, extraction de `persistToken` (partagé avec `setup()`)
- `apps/desktop/src/main/ipc/index.ts` — canaux `auth:device-flow-start`, `auth:device-flow-poll`
- `packages/api-client/src/types.ts` — types `DeviceFlowSession`, `DeviceFlowPollResult`, extension `ApiClient['auth']`
- `packages/api-client/src/ipc-client.ts` — méthodes `startDeviceFlow`, `pollDeviceFlow`
- `apps/desktop/src/renderer/routes/login.tsx` — bloc « Se connecter avec GitHub », polling
- `apps/desktop/.env.example` (nouveau) — documente `GITHUB_OAUTH_CLIENT_ID`
- `specs/SPEC-ACCOUNTS-AUTH.md` (nouveau), `specs/SPEC-INDEX.md` (entrée ajoutée)

## Comportement implémenté

Conforme à `specs/T98.md` et `specs/T98-design.md` : bouton Device Flow visible uniquement pour
`github.com`, code affiché + navigateur ouvert automatiquement, polling jusqu'à succès/expiration/
refus/erreur, formulaire PAT inchangé et toujours actif en parallèle.

## Divergences par rapport au design (issues du `/code-review` du sprint)

Le design initial a été implémenté tel quel puis passé au crible d'une revue de code (8 angles,
8 candidats confirmés). Les correctifs suivants s'écartent du design d'origine :

1. **`persistToken(remote, token)` prend le remote complet, pas seulement le host.** Le design
   prévoyait `persistToken(host, token)` avec reconstruction `https://${host}` avant résolution
   d'identité — cela cassait silencieusement la résolution d'identité pour tout remote self-hosted
   sur port non-standard ou en HTTP (le port et le scheme d'origine étaient perdus). Corrigé en
   transmettant le `remote` d'origine intact jusqu'à `resolveIdentity`, `extractHost` n'étant utilisé
   que pour la clé `keytar`.
2. **`pollDeviceFlow` vérifie désormais `host === 'github.com'`**, comme `startDeviceFlow` — le
   design l'omettait, ce qui aurait permis (via l'`invoke` générique du preload, sans allowlist de
   canal) de faire persister un token GitHub sous un host arbitraire.
3. **Polling réécrit en `setTimeout` auto-planifié + compteur de génération**, à la place du
   `setInterval` du design. Le `setInterval` avec callback async n'avait pas de garde de
   recouvrement : une requête lente pouvait se chevaucher avec le tick suivant, et une réponse
   `slow_down` en retard pouvait écraser un intervalle de repli déjà appliqué par une réponse plus
   rapide. Le compteur de génération corrige aussi le cas Annuler : une réponse encore en vol au
   moment du clic ne peut plus faire basculer l'UI vers un état d'erreur après le retour à `idle`.
4. **Garde de ré-entrance (`useRef`) sur `handleStartDeviceFlow`** — un double-clic avant le
   re-render React pouvait déclencher deux demandes de code concurrentes.
5. **`isGithub` normalise l'URL (`new URL(...).hostname`) au lieu d'une égalité de chaîne stricte**
   — la comparaison stricte du design masquait le bouton pour des variantes équivalentes
   (`https://github.com/` avec slash final, casse différente) que `startDeviceFlow` aurait pourtant
   acceptées.
6. **Le champ `remote` du payload de succès (`DeviceFlowPollResult`) a été supprimé** — aucun
   appelant ne le lisait, donnée morte identifiée en revue.
7. **Le select Remote git et le champ « Autre… » restent dans le `<form>`** (le premier jet de
   l'implémentation les en avait sortis par erreur, cassant la soumission au clavier).

Point non résolu, noté mais volontairement non traité ce sprint : la revue a relevé que le polling
gagnerait à être exprimé via `useQuery({ refetchInterval })` (TanStack Query, déjà utilisé ailleurs
dans le renderer pour du polling) plutôt qu'en `setTimeout` fait main. Le correctif appliqué (§3)
résout déjà les bugs de fond (recouvrement, annulation) ; la migration vers React Query est une
simplification de confort, pas une correction de bug — laissée pour un ticket ultérieur si souhaité.

## Mises à jour SPEC effectuées

- **Nouveau `specs/SPEC-ACCOUNTS-AUTH.md`** : aucune section SPEC ne documentait jusqu'ici le
  système de compte/authentification git (`auth.service.ts`/`login.tsx` datent des sprints
  fondateurs, avant SPEC-INDEX.md). Documente le formulaire PAT, le Device Flow GitHub et le
  stockage partagé (`persistToken`).
- **`specs/SPEC-INDEX.md`** : nouvelle ligne pour `SPEC-ACCOUNTS-AUTH.md`, colonne MAJ → T98.

## Comment tester manuellement

1. Créer une OAuth App GitHub avec *Enable Device Flow* coché (voir `apps/desktop/.env.example`),
   renseigner `GITHUB_OAUTH_CLIENT_ID` dans `.env` d'`apps/desktop`.
2. Lancer l'app en dev, aller sur `/login`, laisser le remote par défaut `https://github.com`.
3. Cliquer « Se connecter avec GitHub » → un code s'affiche, le navigateur système s'ouvre sur
   `github.com/login/device`. Se connecter/valider avec un compte GitHub réel.
4. Vérifier la redirection automatique vers `/` et l'identité affichée dans le panneau Compte.
5. Non-régression : recommencer avec un PAT collé manuellement (GitHub et un remote self-hosted si
   disponible, notamment avec port non-standard) — la connexion doit toujours fonctionner et
   résoudre correctement l'identité.
6. Cas d'erreur : cliquer le bouton puis fermer l'onglet du navigateur sans valider, attendre
   l'expiration (~15 min) ou cliquer Annuler — vérifier les messages et le retour à l'état initial.
