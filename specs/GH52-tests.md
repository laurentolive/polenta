# GH52 — Scénarios de test

Niveaux (WORKFLOW) : 1 ciblé pendant le sprint ; 2 en fin de sprint (`pnpm test` complet, les tests du kit lancés là où ils peuvent l'être) ; 3 au push du lot seulement.

## S1 — poste (vitest, `electron` et `electron-updater` simulés)

| ID | Scénario | Attendu |
|---|---|---|
| U-M1 | `updateFeedUrl` https valide | renseigné, normalisé avec `/` final |
| U-M2 | `updateFeedUrl` en `http://` distant, vide, non-chaîne | avertissement, clé ignorée, autres réglages inchangés |
| U-M3 | Config sans `updateFeedUrl` | configuration identique au défaut (non-régression) |
| U-U1 | `scheduleStartupCheck` avec URL | `setFeedURL({ provider: 'generic', url })` appelé **avant** `checkForUpdates` |
| U-U2 | `scheduleStartupCheck` sans URL | `setFeedURL` non appelé ; comportement actuel |
| U-U3 | URL présente | `checkForUpdates` n'est jamais appelé avec le fournisseur GitHub (aucune requête vers `github.com` : vérifié par le fournisseur simulé) |
| U-U4 | `autoUpdate: false` ou verrou d'équipe, URL présente | aucune vérification, aucun `setFeedURL` |
| U-U5 | Flux en erreur (rejet de `checkForUpdates`) | erreur journalisée, état d'erreur, démarrage non bloqué |
| U-U6 | Journal | l'URL journalisée ne contient pas d'identifiants (`user:pass@`) |

## S2 — kit (bash, sans Docker)

| ID | Scénario | Attendu |
|---|---|---|
| K-P1 | `updates publish` sans `latest.yml` | refus, rien copié |
| K-P2 | `latest.yml` cite un fichier absent du dossier | refus, rien copié |
| K-P3 | Publication valide | artefacts dans `etc/updates/`, `latest.yml` présent en dernier |
| K-P4 | Artefact de même nom déjà présent | refus (pas d'écrasement) |
| K-P5 | Échec pendant la copie d'un artefact | `latest.yml` existant inchangé (atomicité) |
| K-R1 | `caddy_render_site` | contient `handle_path /polenta-updates/*` avec `root * /etc/caddy/updates` et `file_server` |
| K-R2 | Rendu de l'instance avec certificat fourni (GH53) | les deux routes présentes |
| K-R3 | Test non-régression GH53 (octet pour octet) | **mis à jour** : la nouvelle référence est le rendu de GH52 |

Exécution : tests bash locaux (Git Bash) pour K-P* et K-R* ; `caddy validate` de la configuration rendue lancé sur une VM de test si disponible (non disponible ici).

## Validation humaine (non automatisable ici)

1. Poste Windows de test, flux `https://<forge de test>/polenta-updates/` : une version plus récente publiée → proposition de mise à jour ; installation réussie.
2. Même poste, flux coupé : pas de blocage, message d'erreur clair.
3. Vérifier que le poste n'interroge pas `github.com` (journal réseau ou pare-feu de test).
4. **Confirmer que la CA d'entreprise, installée dans le magasin Windows, suffit pour le téléchargement** (hypothèse de la correction de design).
