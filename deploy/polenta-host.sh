#!/usr/bin/env bash
# GH45 — exploitation d'un hôte Polenta : une forge Forgejo isolée par client derrière un Caddy
# partagé (specs/GH45.md §9, specs/GH45-design.md §5).
#
#   polenta-host setup                         préparation de l'hôte (une fois, rejouable)
#   polenta-host status                        état de l'hôte et des instances
#   polenta-host instance add <nom> [options]  nouvelle instance (client)
#   polenta-host instance list
#   polenta-host instance stop|start <nom>
#   polenta-host instance sync <nom>           remet à niveau une instance existante (idempotent)
#   polenta-host instance backup <nom>|--all   sauvegarde chiffrée (arrêt de quelques secondes)
#   polenta-host instance snapshots <nom>      liste des sauvegardes
#   polenta-host instance keys                 mots de passe des sauvegardes (à garder HORS de l'hôte)
#   polenta-host instance restore <nom> --from <id|latest> [--source s] [--domain d] [--password-file f] [--force]
#   polenta-host instance update <nom>|--all <version>   avec retour arrière automatique
#   polenta-host instance export <nom>         archive de restitution au client
#   polenta-host instance remove <nom>         export puis suppression définitive
#   polenta-host instance web enable <nom> --domain d --version v [--image i]   client web (GH44)
#   polenta-host instance web disable <nom>    arrête le client web (données conservées)
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
KIT_DIR="$POLENTA_ROOT/kit"
# shellcheck source=lib/caddy.sh
. "$SCRIPT_DIR/lib/caddy.sh"
# shellcheck source=lib/forgejo-api.sh
. "$SCRIPT_DIR/lib/forgejo-api.sh"
# shellcheck source=lib/backup.sh
. "$SCRIPT_DIR/lib/backup.sh"

DEMO_SOURCE_OWNER_URL="https://github.com/laurentolive"
DEMO_ROOT_REPO="demo-ll800-produit"
DEMO_REPOS=(demo-ll800-produit demo-ll800-comp-moteur demo-ll800-comp-pompe-vidange demo-ll800-comp-module-wifi demo-ll800-if-bus-interne)

# Aide : le bloc de commentaires d'en-tête, jusqu'à la première ligne de code.
usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit "${1:-0}"; }

# ─── setup ────────────────────────────────────────────────────────────────────

setup_install_kit() {
  if [[ "$SCRIPT_DIR" == "$KIT_DIR" ]]; then skip "kit en place ($KIT_DIR)"; return; fi
  if [[ -d "$KIT_DIR" ]] && diff -rq --exclude=host.env "$SCRIPT_DIR" "$KIT_DIR" >/dev/null 2>&1; then
    skip "kit à jour ($KIT_DIR)"
  else
    rm -rf "$KIT_DIR.new"; mkdir -p "$KIT_DIR.new"
    cp -a "$SCRIPT_DIR"/. "$KIT_DIR.new"/
    rm -f "$KIT_DIR.new/host.env"
    rm -rf "$KIT_DIR"; mv "$KIT_DIR.new" "$KIT_DIR"
    chmod 755 "$KIT_DIR"/*.sh
    ok "kit installé dans $KIT_DIR"
  fi
  local l
  for l in polenta-host polenta-admin; do
    if [[ "$(readlink -f "/usr/local/bin/$l" 2>/dev/null)" == "$KIT_DIR/$l.sh" ]]; then skip "/usr/local/bin/$l"
    else ln -sfn "$KIT_DIR/$l.sh" "/usr/local/bin/$l"; ok "/usr/local/bin/$l"; fi
  done
}

setup_host_env() {
  mkdir -p "$POLENTA_ROOT" "$POLENTA_INSTANCES" "$POLENTA_LOG_DIR"
  chmod 700 "$POLENTA_ROOT"
  if [[ ! -f "$HOST_ENV" ]]; then
    if [[ -f "$SCRIPT_DIR/host.env" ]]; then
      install -m 600 "$SCRIPT_DIR/host.env" "$HOST_ENV"; ok "host.env copié depuis le kit"
    else
      install -m 600 "$SCRIPT_DIR/host.env.example" "$HOST_ENV"
      die "$HOST_ENV créé depuis l'exemple : complétez ACME_EMAIL et BASE_DOMAIN puis relancez."
    fi
  else
    skip "host.env"
  fi
  chmod 600 "$HOST_ENV"
  load_host_env
  [[ "$ACME_EMAIL" != admin@example.fr ]] || die "ACME_EMAIL : remplacez l'exemple dans $HOST_ENV (ou laissez vide)."
  [[ -n "$ACME_EMAIL" ]] || warn "ACME_EMAIL vide : pas d'avis d'expiration de certificat (recommandé de le renseigner)."
  [[ -n "$BASE_DOMAIN" && "$BASE_DOMAIN" != forge.example.fr ]] || warn "BASE_DOMAIN non renseigné : chaque instance devra préciser --domain"
}

setup_packages() {
  local wanted=(ca-certificates curl jq dnsutils restic ufw fail2ban python3-systemd unattended-upgrades apt-listchanges)
  local missing=() p
  for p in "${wanted[@]}"; do
    # dnsutils est un paquet de transition sous Debian 13 / Ubuntu 24.04 : on teste la commande.
    if [[ "$p" == dnsutils ]]; then command -v dig >/dev/null && continue; missing+=("$p"); continue; fi
    dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q "install ok installed" || missing+=("$p")
  done
  if [[ ${#missing[@]} -eq 0 ]]; then skip "paquets système"; return; fi
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq "${missing[@]}" >/dev/null
  ok "paquets installés : ${missing[*]}"
}

setup_docker() {
  if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
    skip "Docker $(docker version -f '{{.Server.Version}}' 2>/dev/null)"
  else
    export DEBIAN_FRONTEND=noninteractive
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/$OS_ID/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
      "$(dpkg --print-architecture)" "$OS_ID" "$OS_CODENAME" >/etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
    ok "Docker $(docker version -f '{{.Server.Version}}') installé"
  fi
  local daemon='{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}'
  if write_if_changed /etc/docker/daemon.json "$daemon"; then
    systemctl restart docker; ok "rotation des journaux Docker"
  else
    skip "rotation des journaux Docker"
  fi
  systemctl is-enabled --quiet docker || systemctl enable --quiet docker
}

# LLMNR/mDNS de systemd-resolved écoutent sur toutes les interfaces (port 5355) : inutiles sur
# un serveur, coupés (constat du 2026-10-09 sur l'hôte OVH).
setup_resolved() {
  systemctl list-unit-files systemd-resolved.service >/dev/null 2>&1 || { skip "systemd-resolved absent"; return; }
  if write_if_changed /etc/systemd/resolved.conf.d/10-polenta.conf $'[Resolve]\nLLMNR=no\nMulticastDNS=no'; then
    systemctl restart systemd-resolved; ok "LLMNR / mDNS désactivés"
  else
    skip "LLMNR / mDNS désactivés"
  fi
}

# Messages du noyau (dont chaque paquet rejeté par le pare-feu) hors de la console : ils rendaient
# la console KVM inutilisable le jour où on en avait besoin (incident du 2026-10-10).
setup_console() {
  if write_if_changed /etc/sysctl.d/10-polenta-console.conf 'kernel.printk = 3 4 1 3'; then
    sysctl -q -p /etc/sysctl.d/10-polenta-console.conf; ok "console : messages du noyau limités"
  else
    skip "console : messages du noyau limités"
  fi
}

setup_firewall() {
  local rules=(22/tcp 80/tcp 443/tcp 443/udp) r changed=0
  # GH61 — Caddy externe : 80/443 appartiennent à un autre projet ; on n'ajoute que 22, on ne retire rien.
  caddy_external && rules=(22/tcp)
  ufw status | grep -q "^Status: active" || {
    ufw default deny incoming >/dev/null; ufw default allow outgoing >/dev/null; changed=1
  }
  for r in "${rules[@]}"; do
    ufw status | grep -qE "^${r//\//\\/}[[:space:]]+ALLOW" || { ufw allow "$r" >/dev/null; changed=1; }
  done
  ufw status | grep -q "^Status: active" || { ufw --force enable >/dev/null; changed=1; }
  if caddy_external; then
    if [[ $changed == 1 ]]; then ok "pare-feu : seul 22 ouvert (Caddy externe : 80/443 non gérés)"; else skip "pare-feu (Caddy externe : 80/443 non gérés)"; fi
  elif [[ $changed == 1 ]]; then ok "pare-feu : seuls 22, 80, 443 ouverts"; else skip "pare-feu"; fi
}

setup_fail2ban() {
  local admin_ips; admin_ips="$(env_get "$HOST_ENV" ADMIN_IPS | tr ',' ' ')"
  local jail="[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
ignoreip = 127.0.0.1/8 ::1 ${admin_ips}"
  if write_if_changed /etc/fail2ban/jail.d/10-polenta-sshd.local "$jail"; then
    systemctl restart fail2ban; ok "fail2ban (sshd)"
  else
    skip "fail2ban (sshd)"
  fi
  systemctl is-enabled --quiet fail2ban || systemctl enable --quiet --now fail2ban
}

setup_unattended() {
  local auto='APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";'
  local reboot='Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";'
  local c=0
  write_if_changed /etc/apt/apt.conf.d/20auto-upgrades "$auto" && c=1
  write_if_changed /etc/apt/apt.conf.d/52polenta-unattended "$reboot" && c=1
  if [[ $c == 1 ]]; then ok "mises à jour de sécurité automatiques (redémarrage 04:00)"; else skip "mises à jour de sécurité automatiques"; fi
}

# Sauvegarde nocturne (02:30) et rotation des journaux du kit.
setup_cron() {
  local cron='# GH45 — polenta-host : sauvegarde chiffrée de toutes les instances (arrêt de quelques secondes chacune)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 2 * * * root /usr/local/bin/polenta-host backup-cron >>/var/log/polenta/backup.log 2>&1'
  local rotate='/var/log/polenta/*.log {
  weekly
  rotate 12
  compress
  missingok
  notifempty
}'
  local c=0
  write_if_changed /etc/cron.d/polenta "$cron" 644 && c=1
  write_if_changed /etc/logrotate.d/polenta "$rotate" 644 && c=1
  if [[ $c == 1 ]]; then ok "sauvegarde nocturne (02:30) et rotation des journaux"; else skip "sauvegarde nocturne"; fi
}

# fail2ban sur les forges (design §5.9, révisé §12) : échecs de connexion web et créations de
# jeton refusées (mot de passe), IP réelle du client (proxy de confiance), blocage dans DOCKER-USER
# (le trafic vers Caddy ne passe pas par INPUT). Les 401 ordinaires de git (première requête sans
# identifiants, normale) ne sont PAS comptés.
setup_fail2ban_forge() {
  # datepattern : sans lui, fail2ban ne lit pas la date des journaux Forgejo (« 2026/10/10 15:06:44 »)
  # et compte chaque ligne comme récente — un journal relu en entier (restauration) déclenchait un
  # bannissement sur des échecs vieux de plusieurs heures (incident du 2026-10-10).
  local filter='[Definition]
failregex = Failed authentication attempt for .* from <HOST>:\d+
            router: completed POST /api/v1/users/[^/ ]+/tokens for <HOST>:\d+, 401 Unauthorized
ignoreregex =
datepattern = ^%%Y/%%m/%%d %%H:%%M:%%S'
  local logs; logs="$(find "$POLENTA_INSTANCES" -path '*/data/log/gitea.log' 2>/dev/null | sort | sed 's/^/          /')"
  local ignoreip; ignoreip="127.0.0.1/8 ::1 $(env_get "$HOST_ENV" ADMIN_IPS | tr ',' ' ')"
  local jail
  if [[ -n "$logs" ]]; then
    # chain = DOCKER-USER : le trafic vers Caddy (ports publiés par Docker) ne passe pas par INPUT.
    # Passé en paramètre de « banaction », il était ignoré : la règle tombait dans INPUT, bloquait
    # SSH et ne protégeait pas les forges (incident du 2026-10-10).
    jail="[polenta-forge]
enabled = true
backend = polling
filter = polenta-forge
logpath =
${logs}
maxretry = 10
findtime = 10m
bantime = 1h
banaction = iptables-allports
chain = DOCKER-USER
ignoreip = ${ignoreip}"
  else
    jail='[polenta-forge]
enabled = false'
  fi
  local c=0
  write_if_changed /etc/fail2ban/filter.d/polenta-forge.conf "$filter" && c=1
  write_if_changed /etc/fail2ban/jail.d/20-polenta-forge.local "$jail" && c=1
  if [[ $c == 1 ]]; then
    systemctl reload fail2ban 2>/dev/null || systemctl restart fail2ban
    ok "fail2ban (forges)"
  else
    skip "fail2ban (forges)"
  fi
}

# Clé uniquement + root interdit, SEULEMENT si l'admin a déjà une clé autorisée (spec §9.2-3).
setup_ssh() {
  local admin="${SUDO_USER:-}"
  local keys=""
  [[ -n "$admin" && "$admin" != root ]] && keys="$(getent passwd "$admin" | cut -d: -f6)/.ssh/authorized_keys"
  local conf=/etc/ssh/sshd_config.d/10-polenta.conf
  if [[ -z "$keys" || ! -s "$keys" ]] || ! grep -qE '^(ssh-|ecdsa-|sk-)' "$keys"; then
    warn "SSH non durci : aucune clé autorisée pour l'utilisateur d'admin (${admin:-inconnu — lancez via sudo})."
    warn "Ajoutez une clé dans ~/.ssh/authorized_keys puis relancez setup."
    return
  fi
  local content=$'# GH45 — polenta-host setup\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no'
  if write_if_changed "$conf" "$content"; then
    mkdir -p /run/sshd   # sshd -t l'exige ; absent sous Ubuntu 24.04 (activation par socket)
    if sshd -t; then
      # Ubuntu 24.04 : ssh.socket, ssh.service inactif tant que personne ne se connecte — la
      # configuration est relue à chaque connexion, aucun rechargement n'est nécessaire.
      if systemctl is-active --quiet ssh; then systemctl reload ssh
      elif systemctl is-active --quiet sshd; then systemctl reload sshd
      fi
      ok "SSH : clé uniquement, root interdit"
    else
      rm -f "$conf"; warn "configuration SSH refusée par sshd -t : durcissement annulé"
    fi
  else
    skip "SSH durci"
  fi
}

# GH61 — external : dossier des blocs de site (créé, jamais purgé) et ligne à ajouter au Caddyfile existant.
setup_external_sites() {
  if [[ -d "$CADDY_SITES_DIR" ]]; then
    skip "dossier des blocs de site ($CADDY_SITES_DIR)"
  else
    mkdir -p "$CADDY_SITES_DIR" || die "création de $CADDY_SITES_DIR impossible (CADDY_SITES_DIR)."
    chmod 755 "$CADDY_SITES_DIR"
    ok "dossier des blocs de site ($CADDY_SITES_DIR)"
  fi
  ok "Caddy externe : réseau $EDGE_NETWORK, aucun conteneur Caddy créé"
  printf '  Ajoutez à votre Caddyfile (dossier monté en lecture seule dans votre Caddy) :\n    import %s/*.caddy\n' "$CADDY_SITES_DIR"
  [[ -n "$CADDY_RELOAD_CMD" ]] || warn "CADDY_RELOAD_CMD vide : rechargez votre Caddy à la main après chaque modification de site."
}

cmd_setup() {
  require_root; check_os
  log "Préparation de l'hôte ($PRETTY_NAME)"
  # GH61 — configuration validée et garde-fous de bascule AVANT toute modification de l'hôte.
  if [[ -f "$HOST_ENV" ]]; then load_host_env; fi
  caddy_external_guard
  caddy_managed_ports_guard
  setup_host_env
  setup_install_kit
  setup_packages
  setup_docker
  edge_network_require
  setup_resolved
  setup_firewall
  setup_console
  setup_fail2ban
  setup_unattended
  setup_ssh
  setup_cron
  setup_fail2ban_forge
  if caddy_external; then setup_external_sites; else caddy_up; fi
  log "Hôte prêt. Ajoutez un client : polenta-host instance add <nom>"
}

# ─── instances ────────────────────────────────────────────────────────────────

inst_compose() {
  local name="$1"; shift
  # GH44 — client web actif (domaine web renseigné) : ses commandes (up, stop, down…) l'incluent.
  local -a profile=()
  [[ -n "$(env_get "$(instance_env "$name")" WEB_DOMAIN)" ]] && profile=(--profile web)
  # GH61 — Caddy externe : surcharge rattachant forge et client web à EDGE_NETWORK (variable lue par compose).
  if caddy_external; then
    EDGE_NETWORK="$EDGE_NETWORK" docker compose -p "polenta-$name" --env-file "$(instance_env "$name")" "${profile[@]}" \
      -f "$KIT_DIR/instance/docker-compose.yml" -f "$KIT_DIR/instance/docker-compose.external.yml" "$@"
    return
  fi
  docker compose -p "polenta-$name" --env-file "$(instance_env "$name")" "${profile[@]}" -f "$KIT_DIR/instance/docker-compose.yml" "$@"
}

forge_container() { printf 'forgejo-%s' "$1"; }

# CLI de la forge dans le conteneur, en utilisateur git (forgejo, ou gitea pour le test de compatibilité).
forge_cli() {
  local name="$1"; shift
  docker exec -u git "$(forge_container "$name")" sh -c 'if command -v forgejo >/dev/null; then exec forgejo "$@"; else exec gitea "$@"; fi' -- "$@"
}

# Secret généré par la forge elle-même, écrit dans instance.env s'il n'y est pas encore. Jamais de
# valeur vide : un SECRET_KEY vide puis régénéré au passage suivant ne déchiffrerait plus les
# données déjà chiffrées (2FA, secrets OAuth).
ensure_generated_secret() {
  local env="$1" image="$2" kind="$3" value
  [[ -n "$(env_get "$env" "$kind")" ]] && return 0
  value="$(docker run --rm --entrypoint sh "$image" -c \
    'if command -v forgejo >/dev/null; then exec forgejo generate secret "$0"; else exec gitea generate secret "$0"; fi' "$kind" \
    | tr -d '[:space:]')" || die "génération de $kind impossible avec l'image $image."
  [[ -n "$value" ]] || die "génération de $kind : valeur vide renvoyée par l'image $image."
  env_set "$env" "$kind" "$value"
}

# Variables d'environnement de la forge (design §5.2), régénérées depuis instance.env et host.env.
# Préfixe GITEA__ seul : lu par Forgejo 15 comme par Gitea 28, alors que Gitea ignore FORGEJO__
# (vérifié le 2026-10-09, GH45-sprint1.md §6.1).
render_forgejo_env() {
  local name="$1" env; env="$(instance_env "$name")"
  local domain; domain="$(env_get "$env" DOMAIN)"
  local app_name; app_name="$(env_get "$env" APP_NAME)"
  local -a kv=(
    # Section racine d'app.ini (clé sans section : « GITEA____APP_NAME »). Remplace le titre
    # générique « Forgejo: Beyond coding. We forge. » par celui du client.
    "__APP_NAME=${app_name:-Forge $(env_get "$env" ORG)}"
    # Accueil = page de connexion : pas de page marketing Forgejo sur le domaine d'un client.
    "server__LANDING_PAGE=login"
    "server__ROOT_URL=https://$domain/"
    "server__DOMAIN=$domain"
    "server__PROTOCOL=http"
    "server__HTTP_PORT=3000"
    "server__DISABLE_SSH=true"
    "server__START_SSH_SERVER=false"
    "server__LFS_START_SERVER=false"
    "server__LFS_MAX_FILE_SIZE=0"
    "server__OFFLINE_MODE=true"
    "service__DISABLE_REGISTRATION=true"
    "service__REQUIRE_SIGNIN_VIEW=true"
    "service__DEFAULT_KEEP_EMAIL_PRIVATE=false"
    # Une seule organisation par instance (celle du client, créée par le kit) : les utilisateurs
    # n'en créent pas — une organisation personnelle ne peut pas masquer la configuration Polenta.
    "service__DEFAULT_ALLOW_CREATE_ORGANIZATION=false"
    "admin__DISABLE_REGULAR_ORG_CREATION=true"
    "repository__FORCE_PRIVATE=true"
    "repository__DEFAULT_PRIVATE=private"
    "repository__DEFAULT_BRANCH=main"
    "repository.upload__FILE_MAX_SIZE=50"
    "security__INSTALL_LOCK=true"
    "security__SECRET_KEY=$(env_get "$env" SECRET_KEY)"
    "security__INTERNAL_TOKEN=$(env_get "$env" INTERNAL_TOKEN)"
    "security__DISABLE_GIT_HOOKS=true"
    "security__REVERSE_PROXY_LIMIT=1"
    "security__REVERSE_PROXY_TRUSTED_PROXIES=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
    "database__DB_TYPE=sqlite3"
    "database__PATH=/data/gitea/gitea.db"
    "log__MODE=console,file"
    "log__LEVEL=Info"
    "log__ROOT_PATH=/data/log"
    "migrations__ALLOWED_DOMAINS=github.com,*.github.com"
    "cron.update_checker__ENABLED=false"
  )
  if [[ -n "$SMTP_HOST" ]]; then
    kv+=("mailer__ENABLED=true" "mailer__PROTOCOL=smtp+starttls" "mailer__SMTP_ADDR=$SMTP_HOST"
         "mailer__SMTP_PORT=${SMTP_PORT:-587}" "mailer__USER=$SMTP_USER" "mailer__PASSWD=$SMTP_PASSWORD"
         "mailer__FROM=${SMTP_FROM:-forge@$domain}")
  else
    kv+=("mailer__ENABLED=false")
  fi
  # Valeurs entre apostrophes : docker compose (env_file) interpole $VAR et coupe à « # » dans une
  # valeur nue, ce qui corromprait un mot de passe SMTP. Entre apostrophes, la valeur est littérale.
  local line key val out=""
  for line in "${kv[@]}"; do
    key="${line%%=*}"; val="${line#*=}"
    [[ "$val" != *"'"* ]] || die "la valeur de $key contient une apostrophe, non supportée (host.env)."
    out+="GITEA__${key}='${val}'"$'\n'
  done
  write_if_changed "$(instance_dir "$name")/forgejo.env" "${out%$'\n'}" 600 || true
}

wait_healthy() {
  local name="$1" timeout="${2:-180}" c; c="$(forge_container "$name")"
  local t=0 s
  while (( t < timeout )); do
    s="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$c" 2>/dev/null || echo absent)"
    [[ "$s" == healthy ]] && return 0
    sleep 3; t=$((t + 3))
  done
  docker logs --tail 40 "$c" >&2 || true
  die "l'instance $name n'est pas en bonne santé après ${timeout}s (état : $s)."
}

wait_https() {
  local domain="$1" timeout="${2:-180}" health="${3:-/api/healthz}" t=0
  while (( t < timeout )); do
    curl -fsS -o /dev/null --max-time 10 --resolve "$domain:443:127.0.0.1" "https://$domain$health" 2>/dev/null && return 0
    sleep 5; t=$((t + 5))
  done
  docker logs --tail 30 "$CADDY_CONTAINER" >&2 || true
  die "https://$domain ne répond pas après ${timeout}s (certificat TLS ? DNS ? ports 80/443 ?)."
}

# GH61 — point de bascule : managed → wait_https (TLS réel) ; external → sonde réseau interne sur
# EDGE_NETWORK (le chemin /healthz désigne le client web, sinon la forge).
wait_front() {
  local name="$1" domain="$2" timeout="${3:-180}" health="${4:-/api/healthz}"
  if ! caddy_external; then wait_https "$domain" "$timeout" "$health"; return; fi
  if [[ "$health" == /healthz ]]; then
    wait_edge_http "$name" "polenta-web-$name:8787" "$health" "$timeout"
  else
    wait_edge_http "$name" "forgejo-$name:3000" "$health" "$timeout"
  fi
}

# Message de succès de wait_front : managed → https vérifié ; external → routage réseau seulement.
front_ok() {
  local domain="$1" managed_suffix="${2:-}"
  if caddy_external; then
    ok "joignable sur le réseau $EDGE_NETWORK — https://$domain non vérifié (le certificat dépend de votre Caddy)"
  else
    ok "https://$domain$managed_suffix"
  fi
}

# DNS : vérifié en managed ; en external il peut viser un autre proxy, donc non vérifié.
check_front_dns() {
  local domain="$1"
  if caddy_external; then
    printf '%s\n' "  ${C_DIM}· DNS $domain non vérifié (géré par votre Caddy)${C_OFF}"
  else
    check_dns_points_here "$domain"; ok "DNS $domain → cet hôte"
  fi
}

ensure_ops_account() {
  local name="$1" env; env="$(instance_env "$name")"
  if forge_cli "$name" admin user list --admin | awk '{print $2}' | grep -qx polenta-ops; then
    skip "compte d'exploitation polenta-ops"
  else
    forge_cli "$name" admin user create --admin --username polenta-ops \
      --email "polenta-ops@$(env_get "$env" DOMAIN)" --password "$(env_get "$env" OPS_PASSWORD)" \
      --must-change-password=false >/dev/null
    ok "compte d'exploitation polenta-ops"
  fi
  api_use_instance "$name"
  if [[ -n "$API_TOKEN" ]] && api GET /user; then
    skip "jeton d'exploitation"
  else
    local token
    token="$(forge_cli "$name" admin user generate-access-token --username polenta-ops \
      --token-name "polenta-kit-$(date +%Y%m%d-%H%M%S)" --scopes all --raw | tail -n1 | tr -d '[:space:]')"
    [[ -n "$token" ]] || die "génération du jeton d'exploitation impossible."
    env_set "$env" OPS_TOKEN "$token"
    api_use_instance "$name"
    api_ok GET /user
    ok "jeton d'exploitation"
  fi
}

ensure_org_and_teams() {
  local name="$1" org="$2"
  if api GET "/orgs/$org"; then skip "organisation $org"
  else
    api_ok POST /orgs "$(jq -n --arg o "$org" '{username: $o, visibility: "private", repo_admin_change_team_access: false}')"
    ok "organisation $org"
  fi
  local spec t perm cc
  for spec in auteurs:write:true testeurs:write:false lecteurs:read:false; do
    IFS=: read -r t perm cc <<<"$spec"
    api_team_id "$org" "$t"
    if [[ -n "$TEAM_ID" ]]; then skip "équipe $t"
    else
      api_ok POST "/orgs/$org/teams" "$(team_json "$t" "$perm" true "$cc")"
      ok "équipe $t ($perm$( [[ $cc == true ]] && printf ', création de repos'))"
    fi
  done
}

ensure_client_admin() {
  local name="$1" org="$2" login="$3" email="$4"
  if api GET "/users/$login"; then skip "admin client $login"; return; fi
  local pw; pw="$(random_secret 20)"
  local notify=false; [[ -n "$SMTP_HOST" ]] && notify=true
  api_ok POST /admin/users "$(jq -n --arg u "$login" --arg e "$email" --arg p "$pw" --argjson n "$notify" \
    '{username: $u, email: $e, password: $p, must_change_password: true, send_notify: $n, login_name: $u, source_id: 0}')"
  # Affiché tout de suite : si une étape suivante échoue, la reprise saute ce compte (il existe
  # déjà) et le mot de passe serait perdu.
  CLIENT_ADMIN_PASSWORD="$pw"
  if [[ "$notify" == true ]]; then ok "admin client $login créé (mot de passe temporaire envoyé à $email)"
  else ok "admin client $login créé — mot de passe temporaire : $pw (à changer à la 1re connexion)"; fi
  api_ok PATCH "/admin/users/$login" "$(jq -n --arg u "$login" '{admin: true, login_name: $u, source_id: 0}')"
  api_team_id "$org" Owners
  [[ -z "$TEAM_ID" ]] || api_ok PUT "/teams/$TEAM_ID/members/$login" ""
  ok "admin client $login : admin de l'instance, propriétaire de $org"
}

ensure_demo() {
  local name="$1" org="$2" domain="$3" repo
  for repo in "${DEMO_REPOS[@]}"; do
    if api GET "/repos/$org/$repo"; then skip "démo $repo"; continue; fi
    API_TIMEOUT=600 api_ok POST /repos/migrate "$(jq -n --arg u "$DEMO_SOURCE_OWNER_URL/$repo.git" --arg o "$org" --arg r "$repo" \
      '{clone_addr: $u, repo_owner: $o, repo_name: $r, mirror: false, private: true, service: "git"}')"
    ok "démo $repo importée"
  done
  # Dépendances : URLs github.com → cette instance (design §5.5), dans le polenta-repo.yaml de
  # CHAQUE branche de CHAQUE repo (le produit, mais aussi comp-moteur qui dépend de if-bus-interne).
  # Les tags (baselines RE1/RE2) gardent leurs URLs d'origine : les réécrire changerait l'historique.
  local rewritten=0 branch sha content new
  for repo in "${DEMO_REPOS[@]}"; do
    api_paginate "/repos/$org/$repo/branches"
    for branch in $(jq -r '.[].name' <<<"$API_LIST"); do
      api GET "/repos/$org/$repo/contents/polenta-repo.yaml?ref=$branch" || continue
      sha="$(jq -r .sha <<<"$API_BODY")"
      content="$(jq -r .content <<<"$API_BODY" | base64 -d)"
      new="${content//"$DEMO_SOURCE_OWNER_URL/"/"https://$domain/$org/"}"
      [[ "$new" == "$content" ]] && continue
      api_ok PUT "/repos/$org/$repo/contents/polenta-repo.yaml" "$(jq -n --arg c "$(printf '%s\n' "$new" | base64 -w0)" \
        --arg s "$sha" --arg b "$branch" '{content: $c, sha: $s, branch: $b, message: "Démo : dépendances servies par cette forge"}')"
      rewritten=$((rewritten + 1))
    done
  done
  if [[ $rewritten == 0 ]]; then skip "démo : URLs des dépendances"
  else ok "démo : URLs des dépendances réécrites vers $domain ($rewritten branche(s))"; fi
}

# GH45 S2b — configuration Polenta de l'organisation, par équipe (spec §3bis) : repo
# <org>/polenta-config, modèle commenté, branche main protégée (push réservé à Owners). Le contenu
# d'un repo existant n'est jamais réécrit.
CONFIG_REPO="polenta-config"

ensure_config_repo() {
  local name="$1" org="$2" demo="$3"
  if api GET "/repos/$org/$CONFIG_REPO"; then
    skip "repo de configuration $org/$CONFIG_REPO"
  else
    api_ok POST "/orgs/$org/repos" "$(jq -n --arg n "$CONFIG_REPO" \
      '{name: $n, private: true, auto_init: false, default_branch: "main", description: "Configuration Polenta par équipe (propriétaires uniquement)"}')"
    ok "repo de configuration $org/$CONFIG_REPO"
  fi
  # Étape séparée (reprise d'un ajout interrompu entre la création du repo et celle du fichier).
  # Sur un repo vide, Forgejo répond 200 « [] » au lieu de 404 : vérifier qu'il s'agit d'un fichier.
  if api GET "/repos/$org/$CONFIG_REPO/contents/config.yaml" \
    && jq -e 'type == "object" and .type == "file"' <<<"$API_BODY" >/dev/null; then
    skip "configuration : config.yaml"
  else
    local projects=' []'
    [[ "$demo" == 1 ]] && projects=$'\n    - repo: '"$org/$DEMO_ROOT_REPO"$'\n      label: Démonstration'
    local tmpl; tmpl="$(cat "$KIT_DIR/instance/polenta-config.yaml.tmpl")"
    tmpl="${tmpl//__ORG__/$org}"
    tmpl="${tmpl//__DEFAULT_PROJECTS__/$projects}"
    api_ok POST "/repos/$org/$CONFIG_REPO/contents/config.yaml" "$(jq -n --arg c "$(printf '%s\n' "$tmpl" | base64 -w0)" \
      '{content: $c, message: "Configuration Polenta initiale", branch: "main", new_branch: "main"}')"
    ok "configuration : config.yaml (modèle)"
  fi
  api_ok GET "/repos/$org/$CONFIG_REPO/branch_protections"
  if jq -e '.[] | select((.rule_name // .branch_name) == "main")' <<<"$API_BODY" >/dev/null; then
    skip "configuration : branche main protégée"
  else
    api_ok POST "/repos/$org/$CONFIG_REPO/branch_protections" "$(jq -n \
      '{rule_name: "main", branch_name: "main", enable_push: true, enable_push_whitelist: true, push_whitelist_teams: ["Owners"], push_whitelist_usernames: []}')"
    ok "configuration : branche main protégée (propriétaires uniquement)"
  fi
}

write_polenta_config() {
  local name="$1" domain="$2" org="$3" demo="$4"
  local demo_url=""; [[ "$demo" == 1 ]] && demo_url="https://$domain/$org/$DEMO_ROOT_REPO.git"
  local json; json="$(jq -n --arg s "https://$domain" --arg d "$demo_url" \
    '{defaultServer: $s, hideGithub: true, autoUpdate: false} + (if $d == "" then {} else {demoProjectUrl: $d} end)')"
  write_if_changed "$(instance_dir "$name")/polenta-config.json" "$json" 644 || true
}

cmd_instance_add() {
  require_root; require_cmd docker jq dig curl; load_host_env
  local name="" domain="" org="" admin_login="" admin_email="" demo=1 image="" version="" app_name=""
  name="${1:-}"; [[ -n "$name" ]] || die "usage : polenta-host instance add <nom> [--domain d] [--org o] [--client-admin login email] [--app-name \"Nom affiché\"] [--no-demo] [--image i] [--version v] [--yes]"
  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --domain) domain="$2"; shift 2 ;;
      --org) org="$2"; shift 2 ;;
      --client-admin) admin_login="$2"; admin_email="$3"; shift 3 ;;
      --no-demo) demo=0; shift ;;
      --image) image="$2"; shift 2 ;;
      --app-name) app_name="$2"; shift 2 ;;
      --version) version="$2"; shift 2 ;;
      --yes|-y) ASSUME_YES=1; shift ;;
      *) die "option inconnue : $1" ;;
    esac
  done
  [[ "$name" =~ ^[a-z0-9][a-z0-9-]{1,30}$ ]] || die "nom d'instance invalide « $name » ([a-z0-9-], 2 à 31 caractères)."
  local dir; dir="$(instance_dir "$name")"
  [[ -f "$dir/.add-complete" ]] && die "l'instance « $name » existe déjà (polenta-host instance list)."
  edge_network_require
  local env; env="$(instance_env "$name")"
  if [[ -f "$env" ]]; then
    log "Reprise de l'ajout inachevé de « $name »"
    domain="${domain:-$(env_get "$env" DOMAIN)}"; org="${org:-$(env_get "$env" ORG)}"
  fi
  if [[ -z "$domain" ]]; then
    [[ -n "$BASE_DOMAIN" ]] || die "--domain requis (BASE_DOMAIN absent de host.env)."
    domain="$name.$BASE_DOMAIN"
  fi
  org="${org:-$name}"
  [[ "$org" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$ ]] || die "nom d'organisation invalide « $org »."
  local other
  for other in $(list_instances); do
    [[ "$other" == "$name" ]] && continue
    [[ "$(env_get "$(instance_env "$other")" DOMAIN)" == "$domain" ]] && die "le domaine $domain est déjà utilisé par l'instance $other."
  done

  log "Nouvelle instance « $name » — https://$domain (organisation $org)"
  check_front_dns "$domain"
  local avail; avail="$(awk '/MemAvailable/ {print $2}' /proc/meminfo)"
  if (( avail < 524288 )); then
    warn "mémoire disponible faible : $((avail / 1024)) Mo (< 512 Mo)."
    confirm "Continuer quand même ?" || die "abandon."
  fi

  mkdir -p "$dir/data" "$dir/web-data"; chmod 700 "$dir"
  chown 1000:1000 "$dir/data" "$dir/web-data"
  touch "$env"; chmod 600 "$env"
  [[ -n "$(env_get "$env" INSTANCE_NAME)" ]] || env_set "$env" INSTANCE_NAME "$name"
  env_set "$env" INSTANCE_DIR "$dir"
  env_set "$env" DOMAIN "$domain"
  env_set "$env" ORG "$org"
  [[ -n "$app_name" ]] && env_set "$env" APP_NAME "$app_name"
  [[ -n "$(env_get "$env" APP_NAME)" ]] || env_set "$env" APP_NAME "Forge $org"
  [[ -n "$(env_get "$env" FORGE_IMAGE)" ]] || env_set "$env" FORGE_IMAGE "${image:-$FORGE_IMAGE_DEFAULT}"
  [[ -n "$(env_get "$env" FORGE_VERSION)" ]] || env_set "$env" FORGE_VERSION "${version:-$FORGE_VERSION_DEFAULT}"
  [[ -n "$(env_get "$env" OPS_PASSWORD)" ]] || env_set "$env" OPS_PASSWORD "$(random_secret 32)"
  [[ -n "$(env_get "$env" RESTIC_PASSWORD)" ]] || env_set "$env" RESTIC_PASSWORD "$(random_secret 40)"
  local img; img="$(env_get "$env" FORGE_IMAGE):$(env_get "$env" FORGE_VERSION)"
  docker pull -q "$img" >/dev/null || die "image introuvable : $img"
  ok "image $img"
  ensure_generated_secret "$env" "$img" SECRET_KEY
  ensure_generated_secret "$env" "$img" INTERNAL_TOKEN
  render_forgejo_env "$name"
  ok "configuration ($env)"

  inst_compose "$name" up -d >/dev/null 2>&1 || inst_compose "$name" up -d
  wait_healthy "$name"; ok "forge démarrée (réseau isolé polenta-$name)"
  caddy_add_site "$name" "$domain"
  wait_front "$name" "$domain"; front_ok "$domain" " (certificat TLS valide)"

  ensure_ops_account "$name"
  ensure_org_and_teams "$name" "$org"
  CLIENT_ADMIN_PASSWORD=""
  [[ -n "$admin_login" ]] && ensure_client_admin "$name" "$org" "$admin_login" "$admin_email"
  [[ "$demo" == 1 ]] && ensure_demo "$name" "$org" "$domain"
  ensure_config_repo "$name" "$org" "$demo"
  write_polenta_config "$name" "$domain" "$org" "$demo"
  touch "$dir/.add-complete"
  setup_fail2ban_forge
  admin_log "$name" "instance add $name --domain $domain --org $org${admin_login:+ --client-admin $admin_login}" OK
  # Première sauvegarde (UC1), si le stockage est configuré.
  local backup_ok=0
  if [[ -n "$(env_get "$HOST_ENV" BACKUP_S3_BUCKET)" ]]; then
    if ( backup_instance "$name" manual ); then backup_ok=1; else warn "première sauvegarde en échec : polenta-host instance backup $name"; fi
  else
    warn "sauvegardes non configurées (BACKUP_S3_* dans $HOST_ENV)"
  fi

  log "Instance « $name » prête"
  printf '  URL                 https://%s\n' "$domain"
  printf '  Organisation        %s (équipes : auteurs, testeurs, lecteurs)\n' "$org"
  if [[ -n "$admin_login" ]]; then
    printf '  Admin client        %s' "$admin_login"
    if [[ -n "$CLIENT_ADMIN_PASSWORD" ]]; then printf ' — mot de passe temporaire : %s (à changer à la 1re connexion)\n' "$CLIENT_ADMIN_PASSWORD"; else printf '\n'; fi
  fi
  printf '  Compte exploitation polenta-ops (mot de passe et jeton dans %s)\n' "$env"
  printf '  Config Polenta      %s/polenta-config.json (à distribuer aux postes)\n' "$dir"
  if [[ $backup_ok == 1 ]]; then
    printf '  Sauvegardes         OK — mot de passe à ranger HORS de l'"'"'hôte : polenta-host instance keys\n'
  fi
}

# GH45 S2b — rejoue les étapes idempotentes d'après installation sur une instance existante
# (instances créées avec une version antérieure du kit) : compte d'exploitation, organisation,
# équipes, repo de configuration.
cmd_instance_sync() {
  require_root; require_cmd docker jq curl; load_host_env
  local name; name="$(resolve_instance "${1:-}")"
  local env; env="$(instance_env "$name")"
  [[ -f "$(instance_dir "$name")/.add-complete" ]] || die "instance « $name » incomplète : relancez « instance add $name »."
  local org domain; org="$(env_get "$env" ORG)"; domain="$(env_get "$env" DOMAIN)"
  log "Mise à niveau de l'instance « $name »"
  if caddy_external; then
    # GH61 — recrée les conteneurs d'une instance antérieure (ou migrée) pour les rattacher à
    # EDGE_NETWORK, puis réécrit les blocs de site dans CADDY_SITES_DIR.
    edge_network_require
    render_forgejo_env "$name"
    inst_compose "$name" up -d >/dev/null 2>&1 || inst_compose "$name" up -d
    wait_healthy "$name"; ok "conteneurs rattachés au réseau $EDGE_NETWORK"
    caddy_add_site "$name" "$domain"
    [[ -z "$(env_get "$env" WEB_DOMAIN)" ]] || caddy_add_web_site "$name" "$(env_get "$env" WEB_DOMAIN)"
  fi
  ensure_ops_account "$name"
  ensure_org_and_teams "$name" "$org"
  local demo=0; api GET "/repos/$org/$DEMO_ROOT_REPO" && demo=1
  ensure_config_repo "$name" "$org" "$demo"
  write_polenta_config "$name" "$domain" "$org" "$demo"
  admin_log "$name" "instance sync" OK
  ok "instance $name à jour"
}

# ─── sprint 3 : sauvegardes, restauration, mises à jour, export, retrait ──────

# polenta-host instance backup <nom>|--all [--tag t]
cmd_instance_backup() {
  require_root; load_host_env; require_cmd restic jq
  local target="${1:-}" tag=manual; shift || true
  [[ "${1:-}" == --tag ]] && tag="$2"
  if [[ "$target" == --all ]]; then
    local name failed=0
    for name in $(list_instances); do
      [[ -f "$(instance_dir "$name")/.add-complete" ]] || continue
      ( backup_instance "$name" "$tag" ) || { failed=1; host_log "backup $name ($tag)" ERREUR; continue; }
      host_log "backup $name ($tag)" OK
    done
    if [[ $failed == 0 ]]; then backup_ping ok; else backup_ping fail; die "au moins une sauvegarde a échoué (voir ci-dessus)."; fi
    return
  fi
  local name; name="$(resolve_instance "$target")"
  backup_instance "$name" "$tag"
  admin_log "$name" "instance backup ($tag)" OK
}

# polenta-host instance snapshots <nom>
cmd_instance_snapshots() {
  require_root; load_host_env
  local name="${1:-}"; [[ -n "$name" ]] || die "usage : polenta-host instance snapshots <nom> [--password-file f]"
  shift
  [[ "${1:-}" == --password-file ]] && RESTIC_PASSWORD_OVERRIDE="$(tr -d '[:space:]' <"$2")"
  local rc=0
  restic_for "$name" snapshots || rc=$?
  case "$rc" in
    0) ;;
    10) die "aucune sauvegarde pour « $name »." ;;
    12) die "mot de passe incorrect pour les sauvegardes de « $name »." ;;
    *) die "sauvegardes de « $name » inaccessibles (restic, code $rc)." ;;
  esac
}

# polenta-host instance keys — mots de passe des sauvegardes, à conserver HORS de l'hôte.
cmd_instance_keys() {
  require_root
  local name
  printf '%-16s %s\n' INSTANCE "MOT DE PASSE DES SAUVEGARDES (restic)"
  for name in $(list_instances); do
    [[ -f "$(instance_env "$name")" ]] || continue
    printf '%-16s %s\n' "$name" "$(env_get "$(instance_env "$name")" RESTIC_PASSWORD)"
  done
  warn "à ranger dans un gestionnaire de mots de passe : sans eux, aucune restauration n'est possible sur un hôte neuf."
}

# polenta-host instance restore <nom> --from <id|latest> [--domain d] [--password-file f] [--source <nom>] [--force]
cmd_instance_restore() {
  require_root; load_host_env; require_cmd docker restic jq dig curl
  local name="${1:-}" from="" domain="" source="" force=0; shift || true
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --from) from="$2"; shift 2 ;;
      --domain) domain="$2"; shift 2 ;;
      --password-file) RESTIC_PASSWORD_OVERRIDE="$(tr -d '[:space:]' <"$2")"; shift 2 ;;
      --source) source="$2"; shift 2 ;;
      --force) force=1; shift ;;
      --yes|-y) ASSUME_YES=1; shift ;;
      *) die "option inconnue : $1" ;;
    esac
  done
  [[ "$name" =~ ^[a-z0-9][a-z0-9-]{1,30}$ && -n "$from" ]] \
    || die "usage : polenta-host instance restore <nom> --from <id|latest> [--source <instance sauvegardée>] [--domain d] [--password-file f] [--force]"
  edge_network_require
  source="${source:-$name}"
  local dir; dir="$(instance_dir "$name")"
  local replace=""
  if [[ -e "$dir" ]]; then
    [[ $force == 1 ]] || die "l'instance « $name » existe déjà sur cet hôte (--force pour la remplacer par la sauvegarde)."
    confirm "Remplacer TOUTES les données actuelles de « $name » par la sauvegarde « $from » ?" || die "abandon."
    replace="$name"
  fi
  # Mot de passe : instance.env local de l'instance source s'il existe, sinon --password-file.
  if [[ -z "${RESTIC_PASSWORD_OVERRIDE:-}" && -f "$(instance_env "$source")" ]]; then
    RESTIC_PASSWORD_OVERRIDE="$(env_get "$(instance_env "$source")" RESTIC_PASSWORD)"
  fi
  # Snapshot et mot de passe vérifiés AVANT d'arrêter l'instance remplacée : une erreur la laisse en
  # service (elle n'est arrêtée qu'une fois le snapshot extrait, par restore_snapshot_to).
  local snapshot; snapshot="$(resolve_snapshot "$source" "$from")"
  log "Restauration de « $source » (sauvegarde $snapshot) vers l'instance « $name »"
  restore_snapshot_to "$source" "$dir" "$snapshot" "$replace"
  chmod 700 "$dir"; chown -R 1000:1000 "$dir/data"
  local env; env="$(instance_env "$name")"
  local olddomain; olddomain="$(env_get "$env" DOMAIN)"
  domain="${domain:-$olddomain}"
  env_set "$env" INSTANCE_NAME "$name"
  env_set "$env" INSTANCE_DIR "$dir"
  env_set "$env" DOMAIN "$domain"
  env_set "$env" LAST_BACKUP "$(snapshot_time "$source" "$snapshot")"
  check_front_dns "$domain"
  render_forgejo_env "$name"
  local img; img="$(env_get "$env" FORGE_IMAGE):$(env_get "$env" FORGE_VERSION)"
  docker pull -q "$img" >/dev/null || die "image introuvable : $img"
  inst_compose "$name" up -d >/dev/null 2>&1 || inst_compose "$name" up -d
  wait_healthy "$name"; ok "forge restaurée et démarrée"
  caddy_add_site "$name" "$domain"
  wait_front "$name" "$domain"; front_ok "$domain"
  api_use_instance "$name"
  write_polenta_config "$name" "$domain" "$(env_get "$env" ORG)" "$(api GET "/repos/$(env_get "$env" ORG)/$DEMO_ROOT_REPO" && echo 1 || echo 0)"
  # GH44 — client web restauré avec l'instance : configuration réalignée sur le domaine de la forge.
  # Un échec du client web (image absente, DNS du domaine web pas encore basculé…) n'empêche pas la
  # restauration de la forge : signalé, à reprendre par « instance web enable ». Sous-shell lancé
  # puis attendu (et non testé par if/!) : `set -e` y reste actif.
  if [[ -n "$(env_get "$env" WEB_DOMAIN)" ]]; then
    local web_rc=0
    ( web_start "$name" ) &
    wait $! || web_rc=$?
    [[ $web_rc == 0 ]] || warn "client web non démarré — forge restaurée ; corriger puis relancer : polenta-host instance web enable $name"
  fi
  touch "$dir/.add-complete"
  setup_fail2ban_forge
  admin_log "$name" "instance restore depuis $source@$snapshot (domaine $domain)" OK
  log "Instance « $name » restaurée — https://$domain"
}

# polenta-host instance update <nom>|--all <version> — sauvegarde, mise à jour, retour arrière si échec.
update_instance() {
  local name="$1" version="$2" env; env="$(instance_env "$name")"
  local image old; image="$(env_get "$env" FORGE_IMAGE)"; old="$(env_get "$env" FORGE_VERSION)"
  [[ "$old" != "$version" ]] || { skip "$name déjà en $version"; return 0; }
  edge_network_require
  log "Mise à jour de « $name » : $old → $version"
  # 1. La nouvelle version doit exister : sinon rien n'est touché (critère 17).
  docker pull -q "$image:$version" >/dev/null 2>&1 || die "version introuvable : $image:$version — rien n'a été modifié."
  # 2. Sauvegarde de retour arrière.
  backup_instance "$name" pre-update
  local snapshot; snapshot="$(resolve_snapshot "$name" latest:pre-update)"
  # 3. Nouvelle version.
  env_set "$env" FORGE_VERSION "$version"
  render_forgejo_env "$name"
  # GH57 — page de consentement régénérée pour la nouvelle version, chargée par le redémarrage
  # ci-dessous (en cas de retour arrière, la restauration des données remet l'ancienne).
  if [[ -n "$(env_get "$env" WEB_DOMAIN)" ]]; then install_grant_template "$name" "$image:$version" || true; fi
  inst_compose "$name" up -d >/dev/null 2>&1 || true
  local healthy=0
  ( wait_healthy "$name" ) && ( wait_front "$name" "$(env_get "$env" DOMAIN)" 60 ) && healthy=1
  # GH57 — la nouvelle version peut refuser la page de consentement générée : nouvel essai avec la
  # page d'origine avant tout retour arrière.
  if [[ $healthy == 0 ]] && remove_grant_template "$name"; then
    warn "$name ne démarre pas en $version avec la page de consentement du client web : essai avec la page d'origine."
    inst_compose "$name" restart forgejo >/dev/null 2>&1 || true
    ( wait_healthy "$name" ) && ( wait_front "$name" "$(env_get "$env" DOMAIN)" 60 ) && healthy=1
  fi
  # Crochet de test (scénario S3-7) : la NOUVELLE version est déclarée en échec, après démarrage
  # et migration de la base — jamais en exploitation.
  if [[ "${POLENTA_TEST_FAIL_UPDATE:-0}" == 1 ]]; then
    warn "POLENTA_TEST_FAIL_UPDATE=1 : échec simulé de la nouvelle version"; healthy=0
  fi
  if [[ $healthy == 1 ]]; then
    admin_log "$name" "instance update $old → $version" OK
    ok "$name en version $version"
    return 0
  fi
  # 4. Retour arrière : la base a pu être migrée → restauration du snapshot pre-update.
  warn "$name ne démarre pas en $version : retour à $old et aux données d'avant la mise à jour."
  docker logs --tail 30 "$(forge_container "$name")" >&2 || true
  inst_compose "$name" down >/dev/null 2>&1 || true
  restore_snapshot_to "$name" "$(instance_dir "$name")" "$snapshot"
  chown -R 1000:1000 "$(instance_dir "$name")/data"
  env_set "$env" FORGE_VERSION "$old"
  env_set "$env" LAST_BACKUP "$(snapshot_time "$name" "$snapshot")"
  render_forgejo_env "$name"
  inst_compose "$name" up -d >/dev/null 2>&1 || inst_compose "$name" up -d
  wait_healthy "$name"
  admin_log "$name" "instance update $old → $version" "ERREUR, retour à $old (snapshot $snapshot)"
  die "mise à jour de $name annulée : instance revenue en $old avec les données d'avant (snapshot $snapshot)."
}

cmd_instance_update() {
  require_root; load_host_env; require_cmd docker restic jq
  local target="${1:-}" version="${2:-}"
  [[ -n "$target" && -n "$version" && "$version" != latest ]] \
    || die "usage : polenta-host instance update <nom>|--all <version> (jamais « latest »)"
  if [[ "$target" == --all ]]; then
    local name
    for name in $(list_instances); do
      [[ -f "$(instance_dir "$name")/.add-complete" ]] || continue
      update_instance "$name" "$version"
    done
    return
  fi
  update_instance "$(resolve_instance "$target")" "$version"
}

# polenta-host instance export <nom> — archive de restitution au client.
cmd_instance_export() {
  require_root; load_host_env; require_cmd docker tar sha256sum
  local name; name="$(resolve_instance "${1:-}")"
  local dir env; dir="$(instance_dir "$name")"; env="$(instance_env "$name")"
  local stamp; stamp="$(date +%Y%m%d-%H%M%S)"
  local out="$POLENTA_ROOT/exports"; mkdir -p "$out"; chmod 700 "$out"
  local work; work="$(mktemp -d "$POLENTA_ROOT/.export.XXXXXX")"
  CLEANUP+=("$work")   # contient des secrets : supprimé même en cas d'échec (trap EXIT)
  log "Export de « $name »"
  # 1. Dump portable (format officiel Forgejo/Gitea), instance en service — démarrée si elle a été
  # arrêtée (instance stop), sinon un client arrêté ne pourrait être ni exporté ni retiré.
  local was_running=1
  if [[ "$(instance_health "$name")" != healthy ]]; then
    was_running=0
    inst_compose "$name" up -d >/dev/null 2>&1 || inst_compose "$name" up -d
    wait_healthy "$name"
  fi
  local c; c="$(forge_container "$name")"
  docker exec -u git "$c" sh -c 'rm -f /tmp/polenta-dump.tar.gz; cd /tmp && if command -v forgejo >/dev/null; then forgejo dump --type tar.gz --file /tmp/polenta-dump.tar.gz; else gitea dump --type tar.gz --file /tmp/polenta-dump.tar.gz; fi' >"$work/dump.log" 2>&1 \
    || { cat "$work/dump.log" >&2; die "dump de la forge en échec."; }
  rm -f "$work/dump.log"
  docker cp "$c:/tmp/polenta-dump.tar.gz" "$work/forge-dump.tar.gz" >/dev/null
  docker exec "$c" rm -f /tmp/polenta-dump.tar.gz
  ok "dump de la forge"
  # 2. Données brutes, copie cohérente (arrêt court, comme une sauvegarde).
  inst_compose "$name" stop >/dev/null 2>&1 || true
  tar -C "$dir" -czf "$work/data.tar.gz" data || { inst_compose "$name" up -d >/dev/null 2>&1; die "copie des données impossible."; }
  # GH44 — espaces des utilisateurs du client web (clones, modifications non publiées), copiés
  # pendant le même arrêt : aucun utilisateur n'écrit pendant la copie.
  if [[ -d "$dir/web-data" ]]; then
    tar -C "$dir" -czf "$work/web-data.tar.gz" web-data || { inst_compose "$name" up -d >/dev/null 2>&1; die "copie des données du client web impossible."; }
  fi
  if [[ $was_running == 1 ]]; then
    inst_compose "$name" up -d >/dev/null 2>&1 || inst_compose "$name" up -d
    wait_healthy "$name"
  fi
  ok "données brutes"
  [[ -f "$work/web-data.tar.gz" ]] && ok "données du client web"
  # 3. Configuration expurgée des secrets d'exploitation (SECRET_KEY conservé : nécessaire pour remonter).
  grep -vE '^(OPS_TOKEN|OPS_PASSWORD|RESTIC_PASSWORD|LAST_BACKUP|INSTANCE_DIR)=' "$env" >"$work/instance.env"
  # Format de « docker run --env-file » : valeurs sans apostrophes (docker run, contrairement à
  # docker compose, les garderait dans la valeur).
  sed -E "s/^([A-Za-z0-9_.]+)='(.*)'$/\1=\2/" "$dir/forgejo.env" >"$work/forge.env"
  local version image domain
  version="$(env_get "$env" FORGE_VERSION)"; image="$(env_get "$env" FORGE_IMAGE)"; domain="$(env_get "$env" DOMAIN)"
  cat >"$work/LISEZMOI.md" <<EOF
# Export de la forge « ${name} » (${domain}) — ${stamp}

Contenu :
- \`forge-dump.tar.gz\` : export officiel de la forge (${image}, version ${version}), restaurable
  avec la commande \`restore\` de la forge (documentation Forgejo : « Backup and restore »).
- \`data.tar.gz\` : le dossier \`/data\` complet de la forge (dépôts git, base SQLite, configuration).
- \`forge.env\` : la configuration de la forge (variables GITEA__…), dont la clé SECRET_KEY,
  indispensable pour relire les secrets chiffrés (double authentification…).
- \`web-data.tar.gz\` (si le client web était activé) : les espaces des utilisateurs du client web
  (copies de travail, dont les modifications qu'ils n'avaient pas encore publiées sur la forge).

Remonter la forge à l'identique (Docker) :

    mkdir forge && tar -C forge -xzf data.tar.gz
    sudo chown -R 1000:1000 forge/data
    docker run -d --name forge --env-file forge.env -e USER_UID=1000 -e USER_GID=1000 \\
      -v "\$PWD/forge/data:/data" -p 127.0.0.1:3000:3000 ${image}:${version}

Le port 3000 (HTTP, non chiffré) n'écoute que sur la machine elle-même : le servir en HTTPS sous ${domain} (ou modifier GITEA__server__ROOT_URL et
GITEA__server__DOMAIN dans forge.env pour une autre adresse). Les postes Polenta se reconnectent à la
nouvelle adresse.
EOF
  local archive="$out/${name}-${stamp}.tar.gz"
  tar -C "$work" -czf "$archive" .
  rm -rf "$work"
  (cd "$out" && sha256sum "$(basename "$archive")" >"$(basename "$archive").sha256")
  chmod 600 "$archive" "$archive.sha256"
  admin_log "$name" "instance export → $archive" OK
  ok "export : $archive (+ .sha256, $(du -h "$archive" | cut -f1))"
  EXPORT_ARCHIVE="$archive"
}

# polenta-host instance remove <nom> [--confirm <nom>] — export obligatoire, puis suppression.
cmd_instance_remove() {
  require_root; load_host_env
  local name; name="$(resolve_instance "${1:-}")"; shift || true
  local typed=""
  [[ "${1:-}" == --confirm ]] && typed="${2:-}"
  if [[ -z "$typed" ]]; then
    read -r -p "Suppression DÉFINITIVE de l'instance « $name » (un export est fait avant). Tapez son nom pour confirmer : " typed
  fi
  [[ "$typed" == "$name" ]] || die "confirmation incorrecte : rien n'a été supprimé."
  cmd_instance_export "$name"
  local domain; domain="$(env_get "$(instance_env "$name")" DOMAIN)"
  inst_compose "$name" down -v >/dev/null 2>&1 || true
  caddy_remove_site "$name"
  docker network rm "polenta-$name" >/dev/null 2>&1 || true
  rm -rf "$(instance_dir "$name")"
  setup_fail2ban_forge
  host_log "instance remove $name ($domain), export $EXPORT_ARCHIVE" OK
  ok "instance $name supprimée — export conservé : $EXPORT_ARCHIVE"
  warn "les sauvegardes restent dans le stockage S3 ($(restic_repo_url "$name")) : purge manuelle, cf. RUNBOOK."
}

# ─── Client web (GH44) ────────────────────────────────────────────────────────────

# web.env du client web, rendu depuis instance.env : forge de l'instance (émetteur OIDC, hôte git
# autorisé), URL publique, application OAuth2, secret de session (généré une fois, conservé),
# projet de démonstration s'il est sur la forge (#58 — sans lui, le bouton démo est masqué).
render_web_env() {
  local name="$1" env dir; env="$(instance_env "$name")"; dir="$(instance_dir "$name")"
  local forge web; forge="$(env_get "$env" DOMAIN)"; web="$(env_get "$env" WEB_DOMAIN)"
  local secret; secret="$(env_get "$dir/web.env" POLENTA_WEB_SESSION_SECRET)"
  [[ -n "$secret" ]] || secret="$(random_secret 48)"
  local org demo_line=""; org="$(env_get "$env" ORG)"
  api_use_instance "$name"
  api GET "/repos/$org/$DEMO_ROOT_REPO" \
    && demo_line=$'\n'"POLENTA_WEB_DEMO_PROJECT_URL=https://${forge}/${org}/${DEMO_ROOT_REPO}.git"
  local content
  content="$(cat <<EOF
# Client web de l'instance ${name} — généré par polenta-host (instance web enable), ne pas éditer.
POLENTA_WEB_AUTH=oidc
POLENTA_WEB_DEFAULT_SERVER=https://${forge}
POLENTA_WEB_PUBLIC_URL=https://${web}
POLENTA_WEB_GIT_HOSTS=${forge}
POLENTA_WEB_OIDC_CLIENT_ID=$(env_get "$env" WEB_OIDC_CLIENT_ID)
POLENTA_WEB_OIDC_CLIENT_SECRET=$(env_get "$env" WEB_OIDC_CLIENT_SECRET)
POLENTA_WEB_SESSION_SECRET=${secret}${demo_line}
EOF
)"
  write_if_changed "$dir/web.env" "$content" 600 || true
  chmod 600 "$dir/web.env"
}

# Application OAuth2 « polenta-web » de la forge, dont l'adresse de retour est le domaine web.
# Recréée si elle manque ou si le domaine a changé (le secret n'est lisible qu'à la création).
ensure_web_oauth_app() {
  local name="$1" env; env="$(instance_env "$name")"
  local redirect="https://$(env_get "$env" WEB_DOMAIN)/auth/callback"
  local current; current="$(env_get "$env" WEB_OIDC_CLIENT_ID)"
  api_use_instance "$name"
  api_ok GET /user/applications/oauth2
  local apps="$API_BODY"
  if [[ -n "$current" ]] && jq -e --arg c "$current" --arg r "$redirect" \
      '.[] | select(.client_id == $c and (.redirect_uris | index($r)))' <<<"$apps" >/dev/null; then
    skip "application OAuth2 polenta-web"
    return 0
  fi
  local id
  for id in $(jq -r '.[] | select(.name == "polenta-web") | .id' <<<"$apps"); do
    api DELETE "/user/applications/oauth2/$id" >/dev/null || true
  done
  api_ok POST /user/applications/oauth2 "$(jq -n --arg r "$redirect" \
    '{name: "polenta-web", redirect_uris: [$r], confidential_client: true}')"
  env_set "$env" WEB_OIDC_CLIENT_ID "$(jq -r .client_id <<<"$API_BODY")"
  env_set "$env" WEB_OIDC_CLIENT_SECRET "$(jq -r .client_secret <<<"$API_BODY")"
  ok "application OAuth2 polenta-web ($redirect)"
}

wait_web_healthy() {
  local name="$1" timeout="${2:-120}" t=0 s c="polenta-web-$1"
  while (( t < timeout )); do
    s="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$c" 2>/dev/null || echo absent)"
    [[ "$s" == healthy ]] && return 0
    sleep 3; t=$((t + 3))
  done
  docker logs --tail 40 "$c" >&2 || true
  die "le client web de $name n'est pas en bonne santé après ${timeout}s (état : $s)."
}

# ─── GH57 : page de consentement de la forge validée automatiquement pour le client web ──────────
# Modèle `grant.tmpl` dans le dossier custom de la forge (/data/gitea = <instance>/data/gitea) :
# page de transition pour l'application polenta-web de l'instance, page d'origine pour les autres
# (specs/GH57-design.md). En cas de doute, la page d'origine est conservée.

grant_template_file() { printf '%s/data/gitea/templates/user/auth/grant.tmpl' "$(instance_dir "$1")"; }

# Modèle de consentement d'origine d'une image de forge (Forgejo ou Gitea), sur la sortie standard.
forge_grant_template_original() {
  # Utilisateur git : la forge refuse de s'exécuter en root (« not supposed to be run as root »).
  docker run --rm --user git --entrypoint sh "$1" -c '
    d="$(mktemp -d)"
    if command -v forgejo >/dev/null; then f=forgejo; else f=gitea; fi
    "$f" embedded extract --destination "$d" templates/user/auth/grant.tmpl >/dev/null 2>&1 \
      && cat "$d/templates/user/auth/grant.tmpl"'
}

# Retire le modèle ; renvoie 0 s'il existait.
remove_grant_template() {
  local f; f="$(grant_template_file "$1")"
  [[ -f "$f" ]] || return 1
  rm -f "$f"
}

# Écrit le modèle pour l'image de forge donnée ; renvoie 0 si le fichier a changé (ajouté, modifié
# ou retiré faute de pouvoir le générer). Jamais d'arrêt du script.
install_grant_template() {
  local name="$1" image="$2" env f data reason="" generated="" rc=0
  env="$(instance_env "$name")"; f="$(grant_template_file "$name")"; data="$(instance_dir "$name")/data/gitea"
  local client_id; client_id="$(env_get "$env" WEB_OIDC_CLIENT_ID)"
  # Fichiers temporaires supprimés ici même : la fonction peut tourner dans un sous-shell (restore),
  # qui n'a ni le tableau CLEANUP ni le piège EXIT du script.
  local original err; original="$(mktemp)"; err="$(mktemp)"
  if [[ -z "$client_id" ]]; then
    reason="application OAuth2 polenta-web inconnue (WEB_OIDC_CLIENT_ID vide)"
  elif ! command -v python3 >/dev/null; then
    reason="python3 absent de l'hôte (polenta-host setup l'installe)"
  elif ! forge_grant_template_original "$image" >"$original" 2>"$err" || [[ ! -s "$original" ]]; then
    reason="modèle d'origine introuvable dans l'image"
  else
    # Sortie standard seule dans le modèle : un avertissement de Python sur stderr n'y entre jamais.
    generated="$(python3 -I "$SCRIPT_DIR/lib/grant-template.py" "$original" "$client_id" 2>"$err")" || rc=$?
    [[ $rc == 0 ]] || reason="$(head -c 300 "$err")"
  fi
  rm -f "$original" "$err"
  if [[ -n "$reason" ]]; then
    warn "page de consentement du client web non générée pour $image : $reason — page d'origine de la forge conservée."
    remove_grant_template "$name"
    return
  fi
  local owner; owner="$(stat -c %u:%g "$data")"
  mkdir -p "$(dirname "$f")"
  chown "$owner" "$data/templates" "$data/templates/user" "$data/templates/user/auth"
  if write_if_changed "$f" "$generated" 644; then
    chown "$owner" "$f"
    ok "page de consentement du client web ($image)"
    return 0
  fi
  skip "page de consentement du client web"
  return 1
}

# Redémarre la forge (si son conteneur tourne) pour charger le modèle. Si elle ne redevient pas
# saine, le modèle est retiré et la forge redémarrée avec la page d'origine.
restart_forge_for_grant_template() {
  local name="$1"
  case "$(instance_health "$name")" in
    healthy|starting|unhealthy) ;;
    *) return 0 ;;   # arrêtée : le modèle sera chargé à son prochain démarrage
  esac
  inst_compose "$name" restart forgejo >/dev/null 2>&1 || inst_compose "$name" restart forgejo
  local rc=0
  ( wait_healthy "$name" 120 ) &
  wait $! || rc=$?
  if [[ $rc == 0 ]]; then
    ok "forge redémarrée (page de consentement)"
    return 0
  fi
  warn "forge en échec avec la page de consentement du client web : page d'origine rétablie."
  remove_grant_template "$name" || true
  inst_compose "$name" restart forgejo >/dev/null 2>&1 || inst_compose "$name" restart forgejo
  wait_healthy "$name"
  ok "forge redémarrée avec la page de consentement d'origine"
}

# Démarre (ou réaligne) le client web d'une instance dont WEB_DOMAIN est renseigné.
web_start() {
  local name="$1" env dir; env="$(instance_env "$name")"; dir="$(instance_dir "$name")"
  local domain; domain="$(env_get "$env" WEB_DOMAIN)"
  edge_network_require
  mkdir -p "$dir/web-data"; chown 1000:1000 "$dir/web-data"
  ensure_web_oauth_app "$name"
  # GH57 — pas de page de consentement de la forge pour le client web.
  if install_grant_template "$name" "$(env_get "$env" FORGE_IMAGE):$(env_get "$env" FORGE_VERSION)"; then
    restart_forge_for_grant_template "$name"
  fi
  render_web_env "$name"
  inst_compose "$name" up -d polenta-web >/dev/null 2>&1 || inst_compose "$name" up -d polenta-web
  wait_web_healthy "$name"; ok "client web démarré"
  caddy_add_web_site "$name" "$domain"
  wait_front "$name" "$domain" 180 /healthz; front_ok "$domain"
}

# polenta-host instance web enable <nom> --domain <d> --version <v> [--image <i>]
cmd_instance_web_enable() {
  require_root; load_host_env; require_cmd docker jq dig curl
  local name; name="$(resolve_instance "${1:-}")"; shift || true
  local env; env="$(instance_env "$name")"
  local domain image version
  domain="$(env_get "$env" WEB_DOMAIN)"; image="$(env_get "$env" POLENTA_WEB_IMAGE)"; version="$(env_get "$env" POLENTA_WEB_VERSION)"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --domain) domain="$2"; shift 2 ;;
      --image) image="$2"; shift 2 ;;
      --version) version="$2"; shift 2 ;;
      *) die "option inconnue : $1" ;;
    esac
  done
  image="${image:-${POLENTA_WEB_IMAGE_DEFAULT:-polenta-web}}"
  [[ -n "$domain" && -n "$version" ]] \
    || die "usage : polenta-host instance web enable <nom> --domain <domaine web> --version <version> [--image <image>]"
  [[ "$domain" != "$(env_get "$env" DOMAIN)" ]] || die "le client web demande son propre domaine (différent de celui de la forge)."
  docker image inspect "$image:$version" >/dev/null 2>&1 || docker pull -q "$image:$version" >/dev/null \
    || die "image introuvable : $image:$version (construite avec apps/desktop/Dockerfile.web ?)"
  check_front_dns "$domain"
  env_set "$env" WEB_DOMAIN "$domain"
  env_set "$env" POLENTA_WEB_IMAGE "$image"
  env_set "$env" POLENTA_WEB_VERSION "$version"
  log "Client web de « $name » ($image:$version)"
  web_start "$name"
  admin_log "$name" "instance web enable ($domain, $image:$version)" OK
  log "Client web de « $name » — https://$domain"
}

# polenta-host instance web disable <nom> — arrêt du client web ; web-data et web.env conservés.
cmd_instance_web_disable() {
  require_root; load_host_env
  local name; name="$(resolve_instance "${1:-}")"
  local env; env="$(instance_env "$name")"
  [[ -n "$(env_get "$env" WEB_DOMAIN)" ]] || { skip "client web de $name déjà désactivé"; return 0; }
  inst_compose "$name" rm -sf polenta-web >/dev/null 2>&1 || true
  caddy_remove_web_site "$name"
  # GH57 — page de consentement d'origine rétablie.
  if remove_grant_template "$name"; then
    ok "page de consentement d'origine rétablie"
    restart_forge_for_grant_template "$name"
  fi
  env_set "$env" WEB_DOMAIN ""
  admin_log "$name" "instance web disable" OK
  ok "client web de $name arrêté (données conservées dans $(instance_dir "$name")/web-data)"
}

# Tâche nocturne (cron) : sauvegarde de toutes les instances, rétention, purge hebdomadaire.
cmd_backup_cron() {
  require_root; load_host_env
  log "Sauvegarde nocturne $(date -Iseconds)"
  local name failed=0
  for name in $(list_instances); do
    [[ -f "$(instance_dir "$name")/.add-complete" ]] || continue
    if ( backup_instance "$name" nightly ); then
      host_log "backup $name (nightly)" OK
      local prune=(); [[ "$(date +%u)" == 7 ]] && prune=(--prune)
      # Verrous périmés (opération interrompue, hôte perdu puis restauré : constaté au test S3-13) :
      # « unlock » ne retire que les verrous d'un processus mort ou vieux de plus de 30 min.
      ( restic_for "$name" unlock --quiet ) || true
      ( restic_for "$name" forget --quiet "${BACKUP_KEEP[@]}" "${prune[@]}" ) \
        || { warn "rétention de $name en échec"; host_log "rétention $name" ERREUR; }
    else
      failed=1; host_log "backup $name (nightly)" ERREUR
    fi
  done
  if [[ $failed == 0 ]]; then backup_ping ok; else backup_ping fail; fi
  return $failed
}

host_log() {
  mkdir -p "$POLENTA_LOG_DIR"
  printf '%s | %s | %s\n' "$(date -Iseconds)" "$1" "$2" >>"$POLENTA_LOG_DIR/host.log"
}

instance_health() {
  # Conteneur arrêté : son état (exited…), pas le dernier état de santé connu (« unhealthy »).
  docker inspect -f '{{if and .State.Running .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$(forge_container "$1")" 2>/dev/null || echo absent
}

cmd_instance_list() {
  local name env
  printf '%-14s %-38s %-10s %-10s %-8s %s\n' INSTANCE DOMAINE VERSION ÉTAT DISQUE "DERNIÈRE SAUVEGARDE"
  for name in $(list_instances); do
    env="$(instance_env "$name")"
    [[ -f "$env" ]] || continue
    local state; state="$(instance_health "$name")"
    [[ -f "$(instance_dir "$name")/.add-complete" ]] || state="incomplète"
    printf '%-14s %-38s %-10s %-10s %-8s %s\n' "$name" "$(env_get "$env" DOMAIN)" "$(env_get "$env" FORGE_VERSION)" \
      "$state" "$(du -sh "$(instance_dir "$name")/data" 2>/dev/null | cut -f1)" "$(env_get "$env" LAST_BACKUP || true)"
  done
}

cmd_instance_stop() {
  require_root; local name; name="$(resolve_instance "${1:-}")"
  inst_compose "$name" stop >/dev/null 2>&1
  admin_log "$name" "instance stop" OK
  ok "instance $name arrêtée (données conservées)"
}

cmd_instance_start() {
  require_root; load_host_env; local name; name="$(resolve_instance "${1:-}")"
  edge_network_require
  render_forgejo_env "$name"
  inst_compose "$name" up -d >/dev/null 2>&1 || inst_compose "$name" up -d
  wait_healthy "$name"
  local domain; domain="$(env_get "$(instance_env "$name")" DOMAIN)"
  caddy_add_site "$name" "$domain"
  wait_front "$name" "$domain"; front_ok "$domain"
  admin_log "$name" "instance start" OK
  ok "instance $name démarrée"
}

cmd_status() {
  log "Hôte $(hostname) — $(. /etc/os-release && echo "$PRETTY_NAME")"
  printf '  IPv4 %s  IPv6 %s\n' "$(host_ipv4)" "$(host_ipv6)"
  printf '  Mémoire disponible : %s Mo — disque / : %s libres\n' \
    "$(( $(awk '/MemAvailable/ {print $2}' /proc/meminfo) / 1024 ))" "$(df -h / | awk 'NR==2 {print $4}')"
  if caddy_external; then
    printf '  Caddy : externe (blocs dans %s, réseau %s)' "$CADDY_SITES_DIR" "$EDGE_NETWORK"
    if docker network inspect "$EDGE_NETWORK" >/dev/null 2>&1; then printf '\n'; else printf ' — %sréseau absent%s\n' "$C_RED" "$C_OFF"; fi
  elif caddy_running; then printf '  Caddy : en service\n'; else printf '  Caddy : %sarrêté%s\n' "$C_RED" "$C_OFF"; fi
  cmd_instance_list
}

main() {
  local cmd="${1:-}"; shift || true
  case "$cmd" in
    setup) cmd_setup "$@" ;;
    backup-cron) cmd_backup_cron ;;
    status) require_root; load_host_env; cmd_status ;;
    instance)
      local sub="${1:-}"; shift || true
      case "$sub" in
        add) cmd_instance_add "$@" ;;
        list) require_root; cmd_instance_list ;;
        stop) cmd_instance_stop "$@" ;;
        start) cmd_instance_start "$@" ;;
        sync) cmd_instance_sync "$@" ;;
        backup) cmd_instance_backup "$@" ;;
        snapshots) cmd_instance_snapshots "$@" ;;
        keys) cmd_instance_keys "$@" ;;
        restore) cmd_instance_restore "$@" ;;
        update) cmd_instance_update "$@" ;;
        export) cmd_instance_export "$@" ;;
        remove) cmd_instance_remove "$@" ;;
        web)
          local websub="${1:-}"; shift || true
          case "$websub" in
            enable) cmd_instance_web_enable "$@" ;;
            disable) cmd_instance_web_disable "$@" ;;
            *) usage 1 ;;
          esac ;;
        *) usage 1 ;;
      esac ;;
    -h|--help|help|"") usage 0 ;;
    *) usage 1 ;;
  esac
}

main "$@"
