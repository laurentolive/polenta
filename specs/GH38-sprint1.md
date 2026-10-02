# GH38 — Sprint 1 (unique)

## Réalisé

- `renderer/lib/publishWorkspace.ts` (nouveau) : `publishOrder` (post-ordre dédupliqué),
  `ancestorRepoPaths`, `isBlockedBranch`, `slugify` (déplacé), `publishRepo` (flux T87/T154
  extrait de `ModificationControl`, sans le fetch), `publishWorkspace` (contrôles préalables,
  fetch de tous les candidats, boucle enfants → parents avec propagation de pin, rattachement des
  repos détachés), erreurs `PublishBlockedError` / `PublishNetworkError` / `PublishConflictError` /
  `PublishRepoError`.
- `useModificationMode` : `tree`, `pendingRepos`, `totalPendingCount` ; `refetch` invalide le
  statut de tous les repos.
- `ModificationControl` : mutation → `publishWorkspace` ; bouton actif sur l'ensemble du
  workspace ; popup listant les repos ; erreurs par repo (bloqué / réseau / conflit / générique,
  repos déjà publiés) ; « Résolution manuelle » sur le repo en échec ; push de tous les repos
  publiés, y compris avant un échec.
- i18n fr/en (`layout.modificationControl.*`) ; clés `conflictMessage`/`networkError` remplacées
  par `conflictOnRepo`/`networkErrorRepo`.
- Spécs : `SPEC-FORKS-BRANCHES-BASELINES.md` §2.1, `SPEC-ELECTRON-DESKTOP.md` §19.15,
  `SPEC-INDEX.md`.

## Vérification

- `pnpm typecheck` (apps/desktop) : OK. Pas de suite de tests unitaires ni de config ESLint dans
  `apps/desktop`.
- Bout en bout dans l'application construite (driver Playwright `run-desktop`), sur le workspace
  de démo LL800 généré localement (`scripts/demo-lave-linge/generate.mjs`), remotes remplacés par
  des repos bare locaux :
  - **CA1** — seule une exigence de `comp-moteur` modifiée : bouton actif ; publication de
    `comp-moteur` puis de `ll800-produit` avec `pin: <sha moteur>` ; les deux poussés, plus aucune
    modification en attente, plus de branche `dev-*`, autres repos intacts.
  - **CA5** — `comp-moteur` sur `int-autre`, `if-bus-interne` modifié : « Rien n'a été publié »,
    `Moteur BLDC & onduleur : int-autre ≠ main`, aucun commit ni branche nulle part.
  - **CA7** — conflit distant sur `ll800-produit`, `if-bus-interne` + racine modifiés : bus puis
    moteur publiés et poussés, erreur nommant la racine + fichier en conflit + « Déjà publiés : Bus
    interne (interface), Moteur BLDC & onduleur » ; « Résolution manuelle » ouvre
    `/version-diff?repoPath=…ll800-produit&ref1=dev-test-conflit&ref2=main`.
  - **CA6** — remote de `ll800-produit` injoignable, seul `comp-moteur` modifié : message réseau
    nommant « Lave-linge LL800 », aucun commit ni branche.
- Défauts trouvés et corrigés pendant la vérification : (1) repos publiés avant un échec non
  poussés ; (2) `if-bus-interne` (diamant) laissé en HEAD détaché par la propagation de pin →
  `reattachPublished`.

## Non vérifié

- CA3/CA4/CA8 non rejoués isolément (couverts par la même boucle : ordre bus → moteur → produit
  constaté en CA7 ; un seul candidat = flux unitaire).
- Reprise après résolution manuelle d'un conflit : logique T87 inchangée (branche éphémère
  reconnue dans la même session), non rejouée de bout en bout.

## Remarque

- La génération du `AGENTS.md` par l'application (GH26) au premier chargement le rend « en
  attente » dans le repo racine : il est publié avec la première publication. Comportement
  préexistant, hors périmètre.
