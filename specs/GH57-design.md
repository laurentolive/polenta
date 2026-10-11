# GH57 — Design : validation automatique du consentement pour le client web

Entrée : `specs/GH57.md` (validée le 2026-10-11). Ticket de petite taille : un seul sprint, sur
`main`.

## 1. Principe

La forge rend la page de consentement avec le modèle `templates/user/auth/grant.tmpl`. Un fichier
du même nom dans son dossier `custom` (`GITEA_CUSTOM=/data/gitea`, soit
`<instance>/data/gitea/templates/user/auth/grant.tmpl` sur l'hôte) le remplace. Le kit y écrit :

```gotemplate
{{/* Généré par polenta-host (GH57) — ne pas éditer : régénéré à chaque « instance web enable »
     et « instance update ». */}}
{{if eq .Application.ClientID "<client_id de polenta-web>"}}
  … page de transition : le formulaire d'origine, validé automatiquement …
{{else}}
  … modèle d'origine de la version installée, inchangé …
{{end}}
```

- **Le modèle d'origine est extrait de l'image de la forge** à chaque génération
  (`forgejo|gitea embedded extract`) : les autres applications voient toujours la page de la
  version en service, jamais une copie figée.
- **La page de transition réutilise le formulaire d'origine** (même `action`, mêmes champs
  cachés, y compris un éventuel jeton anti-CSRF d'une future version) : seuls changent le bouton et
  l'envoi automatique. Le formulaire est recopié du modèle, pas réécrit.

Formes constatées (identiques sur Forgejo 15.0.9 et Gitea 28.1.0, 2026-10-11) :

```html
<form method="post" action="{{AppSubUrl}}/login/oauth/grant">
  <input type="hidden" name="client_id" …> <input type="hidden" name="state" …>
  <input type="hidden" name="scope" …> <input type="hidden" name="nonce" …>
  <input type="hidden" name="redirect_uri" …>
  <button type="submit" id="authorize-app" name="granted" value="true" …>…</button>
  <button type="submit" name="granted" value="false" …>…</button>
</form>
```

## 2. Génération : `deploy/lib/grant-template.py`

Python 3 de la bibliothèque standard (déjà présent sur l'hôte : dépendance de `python3-systemd`,
installé par `setup`).

```
python3 grant-template.py <modèle-d-origine> <client_id>   → modèle généré sur la sortie standard
codes de sortie : 0 généré ; 3 forme inattendue (message sur stderr) ; 2 usage
```

Étapes :
1. `client_id` : refus s'il ne correspond pas à `^[A-Za-z0-9-]{8,64}$` (il est inséré dans une
   chaîne du modèle).
2. Le modèle d'origine doit contenir **exactement un** `<form … action="{{AppSubUrl}}/login/oauth/grant">`,
   un bouton `name="granted" value="true"`, et aucun `{{define` / `{{block` (un modèle qui définit
   des blocs ne peut pas être placé dans un `{{if}}`). Sinon : code 3.
3. Formulaire de transition = formulaire d'origine avec un `id="polenta-grant"`, les boutons
   retirés, remplacés par un champ caché `granted=true` (envoyé par `form.submit()`, qui ne transmet
   pas le bouton cliqué) et un seul bouton de secours dans `<noscript>`.
4. Page de transition : `{{template "base/head" .}}`, un titre `{{ctx.Locale.Tr "loading"}}`
   (« Chargement… » dans la langue de l'utilisateur, clé de la forge), le formulaire, puis
   `<script>document.getElementById('polenta-grant').submit()</script>`,
   `{{template "base/footer" .}}`. Pas de texte d'avertissement. Le bouton de secours porte le
   libellé de la forge `auth.authorize_application` (révision de la spec : « Continuer vers
   Polenta » n'existe pas dans les traductions de la forge, et le kit ne connaît pas la marque).
5. Sortie = en-tête de commentaire + `{{if eq .Application.ClientID "…"}}` + page de transition +
   `{{else}}` + modèle d'origine + `{{end}}`.

## 3. Kit : `deploy/polenta-host.sh`

| Fonction | Rôle |
|---|---|
| `forge_grant_template_original <image>` | `docker run --rm --entrypoint sh <image> -c '…'` : `forgejo` sinon `gitea` `embedded extract` dans un dossier temporaire, `cat` du modèle (même méthode qu'`ensure_generated_secret`). |
| `install_grant_template <nom> <image>` | Extrait, génère (client `WEB_OIDC_CLIENT_ID`), écrit `data/gitea/templates/user/auth/grant.tmpl` par `write_if_changed` (dossiers créés au propriétaire de `data/gitea`). Renvoie 0 si le fichier a changé. Extraction ou génération en échec → `remove_grant_template` + `warn` (« page de consentement d'origine conservée… »), jamais d'arrêt. |
| `remove_grant_template <nom>` | Supprime le fichier s'il existe ; renvoie 0 s'il a été supprimé. |
| `restart_forge <nom>` | `inst_compose <nom> restart forgejo` puis `wait_healthy` — seulement si la forge est en service. |

Points d'appel :

| Commande | Appel |
|---|---|
| `web_start` (`instance web enable`, `restore`) | Après `ensure_web_oauth_app` : `install_grant_template "$name" "$(forge image:version)"` → si changé : `restart_forge` (message « forge redémarrée : page de consentement du client web »). |
| `cmd_instance_web_disable` | `remove_grant_template` → si supprimé : `restart_forge`. |
| `update_instance` | Si `WEB_DOMAIN` : `install_grant_template "$name" "<image>:<nouvelle version>"` **avant** le `up -d` de la nouvelle version (le redémarrage de la mise à jour charge le modèle, pas de redémarrage en plus). Retour arrière : la restauration des données d'avant la mise à jour remet aussi l'ancien modèle. |

Le fichier est dans `data/` : sauvegardé, restauré et exporté avec la forge sans traitement
particulier.

## 4. Tests e2e : `apps/desktop/e2e-web/`

- `support/forge-login.ts` : `completeForgeLogin` renvoie `{ consentShown: boolean }` (vrai si la
  page de consentement d'origine a été présentée et validée).
- Nouveau `gh57-consent.spec.ts`, contre l'instance déployée (`POLENTA_E2E_WEB_URL`, comme
  `s4-deployed.spec.ts`) :
  1. `resetAccounts()` recrée les comptes `itest-*` (aucune autorisation) → connexion de
     `itest-auteur` : `consentShown === false`, arrivée dans Polenta ; la page
     `/user/settings/applications` de la forge liste `polenta-web` ;
  2. application OAuth2 `polenta-web` créée par `itest-testeur` (API, authentification basique),
     ouverture de `/login/oauth/authorize?client_id=…` dans sa session forge : bouton « Autoriser
     l'application » visible ; application supprimée ensuite.
- `s3-oidc.spec.ts` (serveur local en mode oidc, application `polenta-web-e2e` sans page
  personnalisée) : inchangé — consentement d'origine, géré par `completeForgeLogin`.

## 5. Décisions et alternatives rejetées

| Décision | Rejeté |
|---|---|
| Modèle généré à partir du modèle extrait de l'image, à chaque génération. | Modèle complet maintenu dans le kit : figerait la page des autres applications et casserait à la première évolution de la forge. |
| Formulaire recopié du modèle d'origine. | Formulaire réécrit par le kit : ignorerait un champ ajouté par une version future (jeton anti-CSRF). |
| Python (bibliothèque standard) pour la transformation. | `sed`/`awk` sur du HTML multi-lignes : fragile ; jq : inadapté. |
| Génération avant le `up -d` de la mise à jour. | Après : un redémarrage de plus. |
| Pas de redémarrage si le fichier est identique. | Redémarrage systématique à chaque `web enable`. |

## 6. Fichiers impactés

| Créés | Modifiés |
|---|---|
| `deploy/lib/grant-template.py`, `deploy/tests/grant-template.test.sh` (+ modèles de référence `deploy/tests/fixtures/grant-forgejo-15.tmpl`, `grant-gitea-28.tmpl`), `apps/desktop/e2e-web/gh57-consent.spec.ts` | `deploy/polenta-host.sh`, `deploy/RUNBOOK.md` (A6, A15), `apps/desktop/e2e-web/support/forge-login.ts`, `apps/desktop/e2e-web/README.md`, `specs/SPEC-WEB.md` §5 et §9, `specs/SPEC-INDEX.md` (ligne SPEC-WEB, MAJ = GH57) |

## 7. Risques

| Risque | Mitigation |
|---|---|
| Modèle généré syntaxiquement invalide → forge qui ne démarre pas (les modèles sont analysés au démarrage) ou page de consentement en erreur pour **toutes** les applications. | Validation de forme (§2) et test unitaire sur les modèles de référence ; `restart_forge` : si la forge n'est pas saine après redémarrage (`wait_healthy` dans un sous-shell attendu, `set -e` actif), retrait du modèle, nouveau redémarrage, avertissement. Le test e2e `gh57-consent` exécute la page générée. |
| Une version future rend la page sans `.Application.ClientID`. | Le test e2e `gh57-consent` le détecte (consentement réapparu) ; effet limité au retour de la page d'origine (la comparaison `eq` d'un champ vide échoue). |
| Un administrateur de la forge personnalise lui-même `grant.tmpl`. | Le fichier est réservé au kit (en-tête explicite, RUNBOOK) : écrasé à chaque génération. |

## 8. Révisions issues de l'implémentation et de la revue (`GH57-sprint1.md`)

| Point | Révision |
|---|---|
| Extraction | `docker run --user git` : la forge refuse de s'exécuter en root (« not supposed to be run as root »), y compris pour `embedded extract`. |
| Page de transition | Reprend `{{template "base/alert" .}}` ; si la forge signale une erreur (`.Flash.ErrorMsg` ou `.Flash.WarningMsg`, même test que son modèle `base/alert`), pas d'envoi automatique (pas de boucle) et bouton visible. |
| `client_id` | `fullmatch` : `^…$` de Python accepterait un saut de ligne final, invalide dans une chaîne de modèle. |
| Génération | Sortie d'erreur de Python séparée du modèle (un avertissement n'entre jamais dans `grant.tmpl`) ; raison explicite de l'échec (python3 absent, modèle introuvable dans l'image, forme inattendue) ; fichiers temporaires supprimés dans la fonction (appel possible dans un sous-shell). |
| Redémarrage | Aussi quand la forge est `starting`/`unhealthy` (conteneur en marche), pas seulement `healthy` ; message distinct quand la page d'origine a dû être rétablie. |
| Mise à jour | Si la nouvelle version ne démarre pas avec la page générée : nouvel essai avec la page d'origine **avant** le retour arrière complet. |
| Tests e2e | `completeForgeLogin` relève la page d'origine sur les réponses HTTP (marqueur `oauth2-authorize-application-box`), pas seulement sur un clic. |
