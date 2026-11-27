# GH53 — Sprint 2 : certificat fourni pour une instance (kit)

Design : `specs/GH53-design.md` § 3. Scénarios : `specs/GH53-tests.md` S2.

## Fichiers modifiés

- `deploy/polenta-host.sh`, `cmd_instance_add` : options `--tls-cert` et `--tls-key` ; contrôle avant toute création
  (`tls_check`) ; copie dans `instances/<nom>/tls/` (cert 644, clé 600) ; `TLS_PROVIDED=1` dans `instance.env`.
- `deploy/lib/caddy.sh` :
  - `tls_provided` (lit `TLS_PROVIDED`), `tls_check` (contrôle des fichiers, refus en external).
  - `caddy_render_site` : une ligne `tls /etc/caddy/tls/<nom>/cert.pem /etc/caddy/tls/<nom>/key.pem` seulement si
    `TLS_PROVIDED=1`.
  - `caddy_sync_tls` (nouveau) : copie vers `$POLENTA_CADDY/etc/tls/<nom>/` ; appelé par `caddy_add_site`.
  - `caddy_remove_site` : supprime `$POLENTA_CADDY/etc/tls/<nom>/`.
- `deploy/RUNBOOK.md` : sous-section « Certificat fourni (forge interne, GH53) » après A3.
- Tests (nouveaux) : `deploy/tests/caddy-tls.test.sh` (sans root ni Docker).

## Comportement implémenté

- `instance add … --tls-cert F --tls-key F` : contrôle (paire lisible, clé non chiffrée, clé et certificat qui
  correspondent, non expiré). Un refus n'écrit rien. En `CADDY_MODE=external` : refus explicite.
- Fichiers sources dans `instances/<nom>/tls/` : sauvegardés par `backup` (dossier de l'instance) et supprimés par `remove`.
- Rendu : le Caddy du kit ne voit que `/etc/caddy` (`etc/` monté en lecture seule) ; les copies sont donc dans
  `etc/tls/<nom>/`.
- Sans option : le bloc Caddy est **identique à `origin/main` octet pour octet** (vérifié : 544 octets, `cmp`).

## Divergences avec le design

- Aucune. Le design prévoyait `caddy_add_site` pour la copie : c'est fait. `instance sync` passe aussi par
  `caddy_add_site` (ligne 879 de `polenta-host.sh`), donc il reprend les fichiers à jour de `instances/<nom>/tls/`. C'est
  ce qui sert de renouvellement provisoire (documenté dans le RUNBOOK, non contrôlé par `tls_check`).

## Tests lancés

- `deploy/tests/caddy-tls.test.sh` : vert (T-K1 à T-K9 ; T-K7 droits 600 non vérifiable sous Windows, signalé).
- Banc sans Docker pour `instance add` jusqu'au rendu Caddy (doublures docker, inst_compose) :
  - paire valide : rc 0, `tls/cert.pem` et `tls/key.pem` présents, `TLS_PROVIDED=1`, arrivée à `caddy_add_site`.
  - certificat ne correspondant pas à la clé : rc 2, rien créé.
  - `--tls-cert` seul : rc 2, rien créé.
  - sans option : aucun `tls/`, `TLS_PROVIDED` absent.
- Comparaison du bloc rendu avec `origin/main` sans certificat : identique.
- shellcheck : aucun avertissement nouveau dans `caddy.sh` et le test. `polenta-host.sh` : un SC2034 préexistant (`ASSUME_YES`
  dans `restore`).

## Non couvert

- `instance add` complet sur un hôte Docker (instance réelle, `curl` vers `https://<domaine>` avec le certificat fourni) : à faire
  sur une VM de test. Les tests kit `host-*.test.sh` exigent root dans un conteneur Debian : non lancés ici.
- Droits 600 de la clé : non vérifiables sous NTFS.

## Vérification manuelle à faire (VM de test, pas un hôte client)

1. `sudo polenta-host instance add t1 --domain t1.interne.exemple --tls-cert cert.pem --tls-key cle.pem --no-demo --yes`
2. `openssl s_client -connect <ip>:443 -servername t1.interne.exemple` : le certificat présenté est celui fourni.
3. `instance remove t1` : `etc/tls/t1/` disparaît.
