# GH62 — Sprint 1 + 2 : durcissement de l'hôte en modules

Les deux sprints du design ont été réalisés dans le même passage (volume réduit, kit d'exploitation uniquement).

## Fichiers modifiés
- `deploy/lib/modules.sh` (nouveau) : résolution des niveaux/modules, dépendances, paquets, détection.
- `deploy/lib/common.sh` : `load_host_env` lit `HARDEN_HOST` / `HOST_MODULES` (bruts, non validés).
- `deploy/polenta-host.sh` : `cmd_setup` par modules, `setup_packages`, `setup_unattended` (redémarrage conditionnel), message `setup_firewall`, `setup_firewall_warn`, `setup_report`, `setup_fail2ban_forge_if_active`, `cmd_status_hardening`.
- `deploy/host.env.example`, `deploy/RUNBOOK.md` (A1, A2, A8).
- `deploy/tests/harden-modules.test.sh` (N1–N10, vert), `harden-none.test.sh` (hôte), `acceptance.sh --harden-level`.

## Divergences par rapport au design
- Résultats de `harden_level_normalize` / `modules_parse_list` aussi rangés dans `MODULES_LEVEL` / `MODULES_LIST` (`MODULES_ERR` serait perdu dans une substitution de commande).
- Défaut inchangé en `full` : ordre, fichiers et messages d'origine (seul le message du pare-feu préexistant change, cf. spec).
- Aucune mise à jour SPEC (kit d'exploitation hors application).

## Tester
- Sans hôte : `bash deploy/tests/harden-modules.test.sh`, `bash -n` / `shellcheck -x`.
- Sur hôte : scénarios `[H]` de `specs/GH62-tests.md` (N12–N46), non exécutés ici (pas de VM de test).
