# GH53 — Sprint 1 : CA de l'entreprise sur le poste (API et git)

Design : `specs/GH53-design.md` § 2. Scénarios : `specs/GH53-tests.md` S1.

## Fichiers modifiés

- `packages/types/src/forge.ts` : `MachineConfig.caPath?: string`.
- `apps/desktop/src/main/services/machine-config.ts` : clé `caPath` (chaîne non vide, sinon avertissement).
- `apps/desktop/src/main/services/extra-ca.ts` (nouveau) : lecture et analyse du PEM, état de processus (`configureExtraCa`),
  options TLS (`tlsCaOption`), localisation et fabrication du bundle git (`gitDefaultBundle`, `gitCaBundlePath`).
- `apps/desktop/src/main/services/net-proxy.ts` : `ca` ajouté aux options des deux dispatchers, clé de cache qui distingue
  « avec CA » et « standard ».
- `apps/desktop/src/main/git/git-backend.ts` : `gitCaConfigArgs` (pur), `gitCaBundle` (une fois par processus), appelé dans `netRun`.
- `apps/desktop/src/main/host/electron-host.ts` : chargement de `caPath` une fois, avant le premier appel réseau.
- Tests (nouveaux) : `services/extra-ca.gh53.test.ts`, `services/machine-config.gh53.test.ts`, `git/git-ca.gh53.test.ts`.
- Fixtures de test (clés de test, à ne pas réutiliser) : `services/fixtures/extra-ca/`.

## Comportement implémenté

- Sans `caPath` : aucun changement. `tlsCaOption()` renvoie `undefined`, les dispatchers gardent exactement leurs options.
- Avec `caPath` valide : la CA est **ajoutée** aux racines de Node (`tls.rootCertificates`), pour l'API comme pour git.
- git : seules les opérations `https://` reçoivent `-c http.sslCAInfo=<bundle>`, où le bundle combine le bundle git embarqué
  et la CA. Écrit dans `userData/ca/git-ca-bundle.pem`.
- Erreurs de fichier (absent, illisible, sans PEM) : avertissement, aucune CA, démarrage normal.

## Divergences avec le design

- Chemin du bundle git : le design demandait de le vérifier. Vérifié sur le PortableGit 2.56.1 réellement embarqué
  (`pnpm git:fetch`) : `usr/ssl/certs/ca-bundle.crt`. `mingw64/` et `ucrt64/` n'existent pas dans cette version. La liste
  de candidats est donc réduite à ce seul chemin (T-G1 : test sur `vendor/git` réel, conditionnel à sa présence).

## Tests lancés

- `npx vitest run` sur les fichiers GH53 et sur `net-proxy.gh15`, `net-proxy.gh347`, `machine-config.test.ts` : 62 tests verts.
  Dont T-P1 et T-P2 : connexions TLS réelles vers un serveur local signé par la CA de test (avec CA : 200 ; sans CA : échec
  sur la chaîne de certification).
- `pnpm typecheck` (apps/desktop) : vert.
- `eslint` sur les fichiers modifiés : sans erreur.
- `pnpm test` complet (apps/desktop), deux passages :
  - passage 1 : 2496 verts, 7 échecs ;
  - passage 2 : 2499 verts, 4 échecs.
  Les échecs changent d'un passage à l'autre (tests git et dépôt : `node-checkout.gh337`, `sync.service.gh173/gh414`,
  `repo-adoption.gh107`, `repo-conformity.gh340`, `tree-edit-locks.gh361`). Motif : `EBUSY`/`EPERM` au nettoyage des dossiers
  temporaires et dépassements de 20 s, sous exécution parallèle sur Windows. **Ces fichiers passent seuls** :
  `node-checkout` + `sync.gh173` + `sync.gh414` 45/45, les quatre autres 51/51. Le changement git de ce sprint est inerte sans
  CA (`gitCaBundle()` renvoie `null`). **Non prouvé** : que `origin/main` présente les mêmes échecs dans une suite complète
  (il faudrait un passage de référence sur `main`).

## Non couvert

- T-E2E (git clone en HTTPS avec CA) : le serveur git de test est en HTTP. `gitCaBundle()` et `netRun` ne sont pas exécutés
  de bout en bout ; seuls les arguments (`gitCaConfigArgs`) et le bundle (`gitCaBundlePath`) le sont.
- Le magasin Windows n'est pas lu (hors périmètre, décision validée).

## Vérification manuelle à faire

1. Poste Windows de test : `config.json` avec `"caPath": "C:\\…\\ca.pem"` ; forge HTTPS signée par cette CA ; connexion, puis clone.
2. Même poste sans `caPath` : comportement inchangé.
3. Vérifier que `userData/ca/git-ca-bundle.pem` contient les racines publiques suivies de la CA.
