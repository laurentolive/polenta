#!/usr/bin/env bash
# GH45 — exploitation d'un hôte Polenta : une forge Forgejo isolée par client derrière un Caddy
# partagé (specs/GH45.md §9, specs/GH45-design.md §5).
#
#   polenta-host setup                         préparation de l'hôte (une fois, rejouable)
#   polenta-host status                        état de l'hôte et des instances
#   polenta-host instance add <nom> [options]  nouvelle instance (client)
#   polenta-host instance list
#   polenta-host instance stop|start <nom>
#
# Sprint 3 : instance update|backup|restore|export|remove.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
KIT_DIR="$POLENTA_ROOT/kit"
# shellcheck source=lib/caddy.sh
. "$SCRIPT_DIR/lib/caddy.sh"
# shellcheck source=lib/forgejo-api.sh
. "$SCRIPT_DIR/lib/forgejo-api.sh"

DEMO_SOURCE_OWNER_URL="https://github.com/laurentolive"
DEMO_ROOT_REPO="demo-ll800-produit"
DEMO_REPOS=(demo-ll800-produit demo-ll800-comp-moteur demo-ll800-comp-pompe-vidange demo-ll800-comp-module-wifi demo-ll800-if-bus-interne)

usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

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

setup_firewall() {
  local rules=(22/tcp 80/tcp 443/tcp 443/udp) r changed=0
  ufw status | grep -q "^Status: active" || {
    ufw default deny incoming >/dev/null; ufw default allow outgoing >/dev/null; changed=1
  }
  for r in "${rules[@]}"; do
    ufw status | grep -qE "^${r//\//\\/}[[:space:]]+ALLOW" || { ufw allow "$r" >/dev/null; changed=1; }
  done
  ufw status | grep -q "^Status: active" || { ufw --force enable >/dev/null; changed=1; }
  if [[ $changed == 1 ]]; then ok "pare-feu : seuls 22, 80, 443 ouverts"; else skip "pare-feu"; fi
}

setup_fail2ban() {
  local jail='[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h'
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

cmd_setup() {
  require_root; check_os
  log "Préparation de l'hôte ($PRETTY_NAME)"
  setup_host_env
  setup_install_kit
  setup_packages
  setup_docker
  setup_resolved
  setup_firewall
  setup_fail2ban
  setup_unattended
  setup_ssh
  caddy_up
  log "Hôte prêt. Ajoutez un client : polenta-host instance add <nom>"
}

# ─── instances ────────────────────────────────────────────────────────────────

inst_compose() {
  local name="$1"; shift
  docker compose -p "polenta-$name" --env-file "$(instance_env "$name")" -f "$KIT_DIR/instance/docker-compose.yml" "$@"
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
  local -a kv=(
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
  local domain="$1" timeout="${2:-180}" t=0
  while (( t < timeout )); do
    curl -fsS -o /dev/null --max-time 10 --resolve "$domain:443:127.0.0.1" "https://$domain/api/healthz" 2>/dev/null && return 0
    sleep 5; t=$((t + 5))
  done
  docker logs --tail 30 "$CADDY_CONTAINER" >&2 || true
  die "https://$domain ne répond pas après ${timeout}s (certificat TLS ? DNS ? ports 80/443 ?)."
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

write_polenta_config() {
  local name="$1" domain="$2" org="$3" demo="$4"
  local demo_url=""; [[ "$demo" == 1 ]] && demo_url="https://$domain/$org/$DEMO_ROOT_REPO.git"
  local json; json="$(jq -n --arg s "https://$domain" --arg d "$demo_url" \
    '{defaultServer: $s, hideGithub: true, autoUpdate: false} + (if $d == "" then {} else {demoProjectUrl: $d} end)')"
  write_if_changed "$(instance_dir "$name")/polenta-config.json" "$json" 644 || true
}

cmd_instance_add() {
  require_root; require_cmd docker jq dig curl; load_host_env
  local name="" domain="" org="" admin_login="" admin_email="" demo=1 image="" version=""
  name="${1:-}"; [[ -n "$name" ]] || die "usage : polenta-host instance add <nom> [--domain d] [--org o] [--client-admin login email] [--no-demo] [--image i] [--version v] [--yes]"
  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --domain) domain="$2"; shift 2 ;;
      --org) org="$2"; shift 2 ;;
      --client-admin) admin_login="$2"; admin_email="$3"; shift 3 ;;
      --no-demo) demo=0; shift ;;
      --image) image="$2"; shift 2 ;;
      --version) version="$2"; shift 2 ;;
      --yes|-y) ASSUME_YES=1; shift ;;
      *) die "option inconnue : $1" ;;
    esac
  done
  [[ "$name" =~ ^[a-z0-9][a-z0-9-]{1,30}$ ]] || die "nom d'instance invalide « $name » ([a-z0-9-], 2 à 31 caractères)."
  local dir; dir="$(instance_dir "$name")"
  [[ -f "$dir/.add-complete" ]] && die "l'instance « $name » existe déjà (polenta-host instance list)."
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
  check_dns_points_here "$domain"; ok "DNS $domain → cet hôte"
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
  wait_https "$domain"; ok "https://$domain (certificat TLS valide)"

  ensure_ops_account "$name"
  ensure_org_and_teams "$name" "$org"
  CLIENT_ADMIN_PASSWORD=""
  [[ -n "$admin_login" ]] && ensure_client_admin "$name" "$org" "$admin_login" "$admin_email"
  [[ "$demo" == 1 ]] && ensure_demo "$name" "$org" "$domain"
  write_polenta_config "$name" "$domain" "$org" "$demo"
  touch "$dir/.add-complete"
  admin_log "$name" "instance add $name --domain $domain --org $org${admin_login:+ --client-admin $admin_login}" OK

  log "Instance « $name » prête"
  printf '  URL                 https://%s\n' "$domain"
  printf '  Organisation        %s (équipes : auteurs, testeurs, lecteurs)\n' "$org"
  if [[ -n "$admin_login" ]]; then
    printf '  Admin client        %s' "$admin_login"
    if [[ -n "$CLIENT_ADMIN_PASSWORD" ]]; then printf ' — mot de passe temporaire : %s (à changer à la 1re connexion)\n' "$CLIENT_ADMIN_PASSWORD"; else printf '\n'; fi
  fi
  printf '  Compte exploitation polenta-ops (mot de passe et jeton dans %s)\n' "$env"
  printf '  Config Polenta      %s/polenta-config.json (à distribuer aux postes)\n' "$dir"
}

instance_health() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$(forge_container "$1")" 2>/dev/null || echo absent
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
  render_forgejo_env "$name"
  inst_compose "$name" up -d >/dev/null 2>&1 || inst_compose "$name" up -d
  wait_healthy "$name"
  caddy_add_site "$name" "$(env_get "$(instance_env "$name")" DOMAIN)"
  admin_log "$name" "instance start" OK
  ok "instance $name démarrée"
}

cmd_status() {
  log "Hôte $(hostname) — $(. /etc/os-release && echo "$PRETTY_NAME")"
  printf '  IPv4 %s  IPv6 %s\n' "$(host_ipv4)" "$(host_ipv6)"
  printf '  Mémoire disponible : %s Mo — disque / : %s libres\n' \
    "$(( $(awk '/MemAvailable/ {print $2}' /proc/meminfo) / 1024 ))" "$(df -h / | awk 'NR==2 {print $4}')"
  if caddy_running; then printf '  Caddy : en service\n'; else printf '  Caddy : %sarrêté%s\n' "$C_RED" "$C_OFF"; fi
  cmd_instance_list
}

main() {
  local cmd="${1:-}"; shift || true
  case "$cmd" in
    setup) cmd_setup "$@" ;;
    status) require_root; load_host_env; cmd_status ;;
    instance)
      local sub="${1:-}"; shift || true
      case "$sub" in
        add) cmd_instance_add "$@" ;;
        list) require_root; cmd_instance_list ;;
        stop) cmd_instance_stop "$@" ;;
        start) cmd_instance_start "$@" ;;
        update|backup|restore|export|remove) die "« instance $sub » arrive au sprint 3 de GH45." ;;
        *) usage 1 ;;
      esac ;;
    -h|--help|help|"") usage 0 ;;
    *) usage 1 ;;
  esac
}

main "$@"
