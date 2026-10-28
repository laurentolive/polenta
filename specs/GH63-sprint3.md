# GH63 — Sprint 3 : agent hôte

Périmètre : `specs/GH63-design.md` §7 Sprint 3, §5.6. Scénarios : `specs/GH63-tests.md` §Sprint 3.

## Fichiers

| Fichier | Changement |
|---|---|
| `deploy/admin/host-agent/polenta-host-agent.js` (nouveau) | Agent Node sans dépendance. Socket Unix `/run/polenta/agent.sock` (0660 `root:polenta-agent`), JSON par lignes, lignes `{id, log}` pendant l'action. Table **fermée** de 6 actions (`host.status`, `host.setup`, `host.reboot`, `fail2ban.status`, `fail2ban.unban`, `firewall.status`) ; clé inconnue, paramètre en trop ou mal formé, ligne > 4 Ko → `invalid`, rien d'exécuté. Commandes en tableau. Module requis (#62) vérifié par `polenta-host status --json` : absent → refus 6. `host.setup` refusé (3) si `ssh-hardening` est actif sans `sshHardeningConfirmed`. `fail2ban.unban` dans les deux prisons sous `flock -n` du verrou de l'hôte. Trace dans `host.log`. |
| `deploy/admin/host-agent/polenta-host-agent.service` (nouveau) | Unité root : `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `RestrictAddressFamilies=AF_UNIX AF_NETLINK`, écriture limitée à `/opt/polenta`, `/run/polenta` et aux sockets fail2ban / systemd. |
| `deploy/admin/host-agent/install-agent.sh` (nouveau) | Installation rejouable (Node.js des paquets si absent, groupe `polenta-agent`, unité, vérification du socket, redémarrage du service) et `--remove`. |
| `deploy/admin/docker-compose.yml` | `/run/polenta` monté **en lecture seule** dans `polenta-admin` (connexion au socket seulement). |
| `apps/admin-service/src/agent-client.ts` | `SocketAgent` : état `up`/`absent` (connexion, 1 s), modules actifs (cache 60 s), requêtes avec journal relayé. |
| `apps/admin-service/src/jobs/registry.ts`, `app.ts` | Actions agent : niveau hôte, 503 si agent absent, **422 `module-absent`** si le module n'est pas actif (aucune installation implicite), verrou vérifié avant et après les attentes. `/me` : modules déclarés par l'agent quand il est là, sinon `host.env`. Nouvelle opération `firewall.status`. |
| `apps/admin-service/src/jobs/runner.ts` | `startAgent` (journal filtré, code de l'agent → état) ; `startReboot` : travail `rebooting` écrit **avant** l'appel, `succeeded` quand le `boot_id` change (y compris après redémarrage du service), `failed` avec consigne console KVM (RUNBOOK A8) passé `REBOOT_WAIT_MIN` (15). |
| `deploy/lib/common.sh` | **Correctif S1** : `host_ipv4` / `host_ipv6` ne font plus échouer `polenta-host status --json` sur un hôte sans route IPv6 (pipefail). |
| `packages/types/src/admin.ts` | `firewall.status` dans `OperationId`. |
| `apps/admin-service/test/agent.test.ts`, `agent-ops.test.ts` (nouveaux) | Agent (validation, actions, modules, socket réel) et opérations agent vues du service. |

## Divergences par rapport au design

1. **Commandes du kit par `systemd-run`** (`status`, `setup`) : unité transitoire hors du bac à sable
   de l'agent. L'agent garde `RestrictAddressFamilies=AF_UNIX AF_NETLINK` (pas de réseau) alors que
   `setup` a besoin du réseau (apt) et d'écrire dans `/etc`. AF_NETLINK : lecture de l'état du pare-feu.
2. **Pas d'annulation** des actions agent (`fail2ban.unban` était « annulable ») : action de quelques
   secondes, rien à interrompre.
3. **Socket monté en lecture seule** (au lieu de `group_add`) : le service est root dans son conteneur
   (D10) ; la lecture seule l'empêche d'altérer le socket.
4. **Acteur transmis à l'agent** (`login@instance`, motif strict) pour `POLENTA_ACTOR` et la trace.

## Tests

**Unitaires** (Windows, Node 20) : 111 verts, 1 sauté (SIGTERM, Linux seulement). Nouveaux : 21 pour
l'agent (S3-2, S3-3 sur 15 requêtes invalides, S3-4 IPv4/IPv6 sous verrou, S3-8, S3-10, socket réel),
8 pour les opérations agent du service (S3-9, S3-10, niveau instance refusé, journal filtré, S3-6
redémarrage suivi par `boot_id`, S3-7 délai dépassé → consigne KVM).

**VM** (WSL2 Ubuntu 24.04, systemd, Docker 29.1, `HARDEN_HOST=none`) : 21 contrôles agent verts —
installation rejouable ; socket `660 root:polenta-agent`, aucun port TCP/UDP (S3-1) ; `host.status` réel
(S3-2) ; 7 refus `invalid` dont 10 Ko et injection `; reboot`, journalisés (S3-3) ; `fail2ban.unban` et
`firewall.status` refusés module absent, fail2ban non installé (S3-10) ; appel depuis le conteneur
`polenta-admin`, qui ne peut pas écrire dans `/run/polenta` ; `systemd-analyze security` : **6.0
MEDIUM**, `NoNewPrivileges`, `ProtectSystem=strict`, AF_UNIX (S3-5) ; agent arrêté puis relancé (S3-9).
Non-régression : 37 contrôles du Sprint 2, tests bash du kit (136) et `shellcheck` verts.

Non exécutés en réel (VM partagée avec le poste, pas de fail2ban/ufw configurés par le kit) : S3-4
(fail2ban réel), S3-6/S3-7 (redémarrage réel), S3-8 (`setup` réel). Couverts en unitaire.

## Comment tester (hôte de test)

```bash
sudo /opt/polenta/kit/admin/host-agent/install-agent.sh
stat -c '%a %U:%G' /run/polenta/agent.sock              # 660 root:polenta-agent
ss -tulnp | grep polenta-host-agent                     # rien
systemd-analyze security polenta-host-agent
sudo node -e 'const c=require("net").connect("/run/polenta/agent.sock",()=>c.write(JSON.stringify({id:"t",action:"host.status"})+"\n"));c.on("data",d=>{console.log(String(d));c.end()})'
```
