# GH57 — Sprint 1 (unique) : pas d'écran de consentement de la forge pour le client web

Périmètre : `specs/GH57-design.md` §1-§6 ; révisions : §8.

## Fichiers modifiés

**Kit `deploy/`** :
- `lib/grant-template.py` (nouveau) : génère `grant.tmpl` à partir du modèle d'origine de la forge
  — page de transition envoyée automatiquement pour le `client_id` de `polenta-web`, modèle
  d'origine inchangé sinon ; refus d'une forme inattendue (code 3).
- `polenta-host.sh` : `forge_grant_template_original`, `install_grant_template`,
  `remove_grant_template`, `restart_forge_for_grant_template` ; appels dans `web_start`
  (`instance web enable`, `restore`), `instance web disable`, `update_instance` (génération avant
  le redémarrage, nouvel essai sans la page avant tout retour arrière).
- `tests/grant-template.test.sh` (nouveau, 50 vérifications) et `tests/fixtures/grant-forgejo-15.tmpl`,
  `grant-gitea-28.tmpl` (modèles de référence extraits des images).
- `RUNBOOK.md` A6, A15.

**Tests e2e** (`apps/desktop/e2e-web/`) : `gh57-consent.spec.ts` (nouveau), `support/forge-login.ts`
(`consentShown`, relevé sur les réponses HTTP), `README.md`.

**SPEC** : `SPEC-WEB.md` §5 (consentement), §9 (kit) ; `SPEC-INDEX.md` (ligne SPEC-WEB, MAJ = GH57).

## Comportement implémenté

À sa première connexion au client web, l'utilisateur ne voit plus « Autoriser polenta-web à accéder
à votre compte ? » : après la page de connexion de la forge, un passage « Chargement… » valide
l'autorisation et il arrive dans Polenta. L'autorisation reste visible et révocable dans les
paramètres de son compte. Toute autre application OAuth2 de la forge — y compris une application
d'utilisateur nommée « polenta-web » — garde la page de consentement d'origine.

`instance web enable` installe la page (redémarrage de la forge seulement si elle change),
`instance web disable` la retire, `instance update` la régénère pour la nouvelle version. En cas de
doute (python3 absent, modèle introuvable ou de forme inattendue, forge qui ne redémarre pas), la page
d'origine est conservée avec un avertissement : jamais d'échec du kit pour cette raison.

## Divergences par rapport au design

§8 du design : extraction en utilisateur `git` ; message d'erreur de la forge conservé sur la page de
transition (sans envoi automatique) ; bouton de secours au libellé de la forge ; nouvel essai sans la
page pendant une mise à jour ; détection du consentement sur les réponses HTTP dans les tests.

## Vérifications

- `deploy/tests/grant-template.test.sh` : 50/50 (poste de dev, hôte).
- E2E web contre `acme` : `gh57-consent` 2/2 ; suite complète 40/40 (+ 1 mesure ignorée).
  Contre-épreuve : page retirée → T4 échoue comme attendu.
- Hôte : `enable` (installation + redémarrage), rejeu (inchangé, sans redémarrage), `disable` /
  `enable`, image inattendue (`alpine:3` → avertissement, page d'origine).
- Forgejo 16.0.0 (seule version plus récente) : page de consentement identique, générateur OK —
  sans mise à jour d'`acme`.
- `pnpm typecheck` : 0 erreur.
- `/code-review` : 9 constats, tous corrigés (stderr de Python hors du modèle, `client_id` avec saut
  de ligne final, mise à jour sans retour arrière inutile, redémarrage d'une forge `starting`,
  message après repli, fichiers temporaires dans un sous-shell, python3 absent signalé, boucle
  d'envoi sur message d'erreur, détection du consentement dans les tests).

## Reste à faire (manuel)

- T10 : observer `instance update` sur une vraie montée de version d'`acme` (Forgejo 16.0.0
  disponible ; décision de montée de version à prendre).

## Comment tester

Dans un navigateur privé : https://acme-web.forge.esquaresoft.fr → « Se connecter » → compte de la
forge neuf (`sudo polenta-admin --instance acme user add …`) → après le changement de mot de passe
imposé, arrivée dans Polenta sans page « Autoriser l'application ».

```bash
deploy/tests/grant-template.test.sh
cd apps/desktop && POLENTA_E2E_SSH="ssh -o BatchMode=yes debian@<hôte>" \
  POLENTA_E2E_WEB_URL=https://acme-web.forge.esquaresoft.fr pnpm test:e2e:web gh57
```
