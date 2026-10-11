# GH57 — Scénarios de test

[A] automatisé (unitaire), [E2E] Playwright contre l'instance déployée, [M] manuel sur l'hôte de
test (`acme`).

| ID | Scénario | Attendu | Critère spec |
|---|---|---|---|
| T1 [A] | `grant-template.py` sur le modèle de référence Forgejo 15.0.9 et Gitea 28.1.0. | Code 0 ; sortie = `{{if eq .Application.ClientID "<id>"}}` … `{{else}}` + modèle d'origine **à l'identique** + `{{end}}` ; formulaire de transition avec les 5 champs cachés d'origine, `granted=true` caché, aucun bouton `granted=false`, script d'envoi, bouton de secours dans `<noscript>`. | 1, 2 |
| T2 [A] | Modèle sans formulaire `/login/oauth/grant`, avec deux formulaires, sans bouton `granted=true`, ou contenant `{{define`. | Code 3, message explicite, rien sur la sortie. | 5 |
| T3 [A] | `client_id` contenant `"`, `}}` ou des espaces ; vide. | Code 2, refus. | 2 |
| T4 [E2E] | Comptes `itest-*` recréés (aucune autorisation), connexion d'`itest-auteur` au client web déployé. | Pas de page « Autoriser l'application » ; arrivée dans Polenta ; `polenta-web` listée dans les applications autorisées du compte. | 1 |
| T5 [E2E] | Application OAuth2 « polenta-web » créée par `itest-testeur`, demande d'autorisation dans sa session. | Page de consentement d'origine (bouton « Autoriser l'application »). | 2 |
| T6 [E2E] | Suites `s3-oidc`, `s4-print`, `s4-deployed`. | Vertes (consentement présent ou absent géré par `completeForgeLogin`). | 6 |
| T7 [M] | `instance web enable acme` rejoué. | « page de consentement : inchangée » ; pas de redémarrage de la forge. | 3 |
| T8 [M] | `instance web disable acme` puis `enable`. | Fichier retiré, forge redémarrée, page d'origine pour `polenta-web` ; puis réinstallé. | 4 |
| T9 [M] | `install_grant_template acme <image sans forge, ex. alpine:3>` (simulation d'une version inattendue). | Avertissement, modèle retiré, aucun arrêt du script. | 5 |
| T10 [M] | `instance update acme 15.0.9` (même version). | Modèle régénéré avant le redémarrage, identique ; mise à jour réussie ; T4 toujours vert. | 5 |
| T11 [A] | `bash -n` du kit, `shellcheck` si disponible. | Sans erreur. | — |
