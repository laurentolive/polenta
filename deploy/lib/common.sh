#!/usr/bin/env bash
# GH45 — fonctions communes du kit de déploiement Polenta (polenta-host.sh, polenta-admin.sh).
# Sourcé, jamais exécuté directement.
# shellcheck disable=SC2034  # variables de configuration lues par les scripts qui sourcent ce fichier

POLENTA_ROOT="${POLENTA_ROOT:-/opt/polenta}"
POLENTA_INSTANCES="$POLENTA_ROOT/instances"
POLENTA_CADDY="$POLENTA_ROOT/caddy"
POLENTA_LOG_DIR="${POLENTA_LOG_DIR:-/var/log/polenta}"
HOST_ENV="$POLENTA_ROOT/host.env"

# Valeurs par défaut (surchargeables dans host.env).
DEFAULT_FORGE_IMAGE="codeberg.org/forgejo/forgejo"
DEFAULT_FORGE_VERSION="15.0.9"      # LTS — épinglée, jamais « latest »
DEFAULT_CADDY_VERSION="2.11.7"
# GH61 — cohabitation avec d'autres projets dockerisés sur un même serveur (host.env).
DEFAULT_CADDY_MODE="managed"          # managed : Caddy du kit ; external : Caddy existant
DEFAULT_EDGE_NETWORK="polenta-edge"
DEFAULT_CADDY_SITES_DIR="/opt/polenta/caddy-sites"

if [[ -t 1 ]]; then
  C_RED=$'\e[31m'; C_GRN=$'\e[32m'; C_YEL=$'\e[33m'; C_BLU=$'\e[34m'; C_DIM=$'\e[2m'; C_OFF=$'\e[0m'
else
  C_RED=''; C_GRN=''; C_YEL=''; C_BLU=''; C_DIM=''; C_OFF=''
fi

log()   { printf '%s\n' "${C_BLU}==>${C_OFF} $*"; }
ok()    { printf '%s\n' "  ${C_GRN}✓${C_OFF} $*"; }
skip()  { printf '%s\n' "  ${C_DIM}· $* (déjà fait)${C_OFF}"; }
warn()  { printf '%s\n' "  ${C_YEL}!${C_OFF} $*" >&2; }
# GH63 — codes de sortie par cause (specs/GH63-design.md §5.5) : le service d'administration les
# convertit (17/19 → rolled-back, 10 → cancelled, 5 → 409, autres ≠ 0 → failed).
E_GENERAL=1; E_USAGE=2; E_CONFIRM=3; E_PERM=4; E_LOCKED=5; E_PRECOND=6; E_CANCELLED=10
E_NO_INSTANCE=12; E_EXISTS=13; E_NO_VERSION=14; E_DNS=15; E_S3=16; E_ROLLED_BACK=17
E_OPS_REFUSED=18; E_BACKUP_CHECK=19

# Erreur expliquée : « die [code] message » (code 1 par défaut). on_error ne la répète pas, même
# quand die est appelé dans une substitution $(…) dont l'échec remonte au script appelant : die y
# laisse une marque propre au processus principal ($$ est le même dans les sous-shells).
DIE_MARK="${TMPDIR:-/tmp}/.polenta-die.$$"
die() {
  local code="$E_GENERAL"
  if [[ "${1:-}" =~ ^[0-9]+$ && $# -gt 1 ]]; then code="$1"; shift; fi
  printf '%s\n' "${C_RED}Erreur :${C_OFF} $*" >&2
  : >"$DIE_MARK" 2>/dev/null || true
  exit "$code"
}

require_root() {
  [[ $EUID -eq 0 ]] || die "$E_PERM" "à lancer en root (sudo $0 …)."
}

# GH63 — exécuté par le service d'administration (POLENTA_ADMIN_MODE=1) : uid opérateur du conteneur
# (root, design D10 ; surchargeable) ; sinon, comme avant, root.
POLENTA_OPERATOR_UID="${POLENTA_OPERATOR_UID:-0}"
require_operator() {
  if [[ "${POLENTA_ADMIN_MODE:-0}" == 1 ]]; then
    [[ $EUID -eq "$POLENTA_OPERATOR_UID" ]] || die "$E_PERM" "mode administration : à lancer sous l'uid opérateur $POLENTA_OPERATOR_UID."
  else
    require_root
  fi
}

# ─── GH63 — options globales, résultat structuré, confirmations, verrou ──────────────────────────

# --json : résultat JSON sur le descripteur 3 (ou dans $POLENTA_RESULT_FILE, à défaut sur stdout) ;
# le journal humain reste sur stdout/stderr. --non-interactive : aucune lecture sur stdin, une
# confirmation manquante sort en 3. --confirm <valeur> : confirmation donnée d'avance.
JSON_OUT=0; NON_INTERACTIVE=0; CONFIRM_VALUE=""
ARGS=()
parse_global_opts() {
  ARGS=()
  while (($#)); do
    case "$1" in
      --json) JSON_OUT=1; shift ;;
      --non-interactive) NON_INTERACTIVE=1; shift ;;
      --confirm) [[ $# -ge 2 ]] || die "$E_USAGE" "--confirm attend une valeur."; CONFIRM_VALUE="$2"; shift 2 ;;
      --confirm=*) CONFIRM_VALUE="${1#--confirm=}"; shift ;;
      *) ARGS+=("$1"); shift ;;
    esac
  done
  # Mode administration ou --json : le journal passe par redact (aucun secret en clair).
  if [[ "$JSON_OUT" == 1 || "${POLENTA_ADMIN_MODE:-0}" == 1 ]]; then
    exec > >(redact) 2> >(redact >&2)
  fi
}

# Écrit le résultat JSON de l'opération (validé par jq). Sans --json : rien.
emit_result() {
  [[ "$JSON_OUT" == 1 ]] || return 0
  local json; json="$(jq -c . <<<"$1")" || die "résultat JSON invalide (bogue du kit)."
  if [[ -n "${POLENTA_RESULT_FILE:-}" ]]; then
    ( umask 077; printf '%s\n' "$json" >"$POLENTA_RESULT_FILE" )
  elif { true >&3; } 2>/dev/null; then
    printf '%s\n' "$json" >&3
  else
    printf '%s\n' "$json" >&"$RESULT_STDOUT_FD"
  fi
}
# stdout d'origine, avant redact : le résultat n'est jamais masqué.
exec {RESULT_STDOUT_FD}>&1

# Masque les valeurs qui suivent password|secret|token|key (journal seulement, jamais le résultat).
redact() {
  sed -u -E "s/((password|passwd|secret|token|key)[A-Za-z_]*[\"']?[[:space:]]*[:=][[:space:]]*[\"']?)[^\"'[:space:],;]+/\\1***/Ig"
}

# Confirmation : --confirm <attendu> la donne d'avance, une valeur fausse sort en 3. Sinon, en
# --non-interactive ou sans entrée : sortie 3, jamais d'attente. Sinon, question interactive
# comme avant (sautée avec ASSUME_YES=1) ; renvoie 1 si l'utilisateur refuse.
confirm() {
  local prompt="$1" expected="${2:-oui}"
  if [[ -n "$CONFIRM_VALUE" ]]; then
    [[ "$CONFIRM_VALUE" == "$expected" ]] || die "$E_CONFIRM" "confirmation incorrecte : attendu --confirm $expected."
    return 0
  fi
  [[ "${ASSUME_YES:-0}" == 1 ]] && return 0
  [[ "$NON_INTERACTIVE" == 1 ]] && die "$E_CONFIRM" "confirmation requise (--non-interactive) : ajoutez --confirm $expected."
  local answer
  read -r -p "$prompt [o/N] " answer || die "$E_CONFIRM" "confirmation non reçue (entrée fermée) : ajoutez --confirm $expected."
  [[ "$answer" =~ ^[oOyY]$ ]]
}

# Verrou unique de l'hôte, pris par les commandes qui modifient quelque chose (SSH comme
# interface ; les lectures ne le prennent pas). Libéré par le noyau à la fin du processus, même tué
# (flock) ; .lock.owner dit qui le tient, ignoré si son pid n'existe plus.
LOCK_FILE="$POLENTA_ROOT/.lock"
LOCK_OWNER="$POLENTA_ROOT/.lock.owner"
LOCK_HELD=0
acquire_lock() {
  local op="$1"
  [[ "$LOCK_HELD" == 1 ]] && return 0
  mkdir -p "$POLENTA_ROOT"
  exec 9>>"$LOCK_FILE"
  if ! flock -n 9; then
    local owner="" pid=""
    [[ -f "$LOCK_OWNER" ]] && owner="$(cat "$LOCK_OWNER" 2>/dev/null || true)"
    pid="$(jq -r '.pid // empty' <<<"$owner" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      die "$E_LOCKED" "une autre opération est en cours : $(jq -r '"\(.op) (\(.origin), \(.actor)) depuis \(.since)"' <<<"$owner")."
    fi
    # Propriétaire mort mais verrou tenu : des sous-processus d'une opération interrompue (kill -9)
    # tournent encore et l'ont hérité. Rien n'est forcé : ils finissent, ou on les arrête.
    [[ -n "$pid" ]] && die "$E_LOCKED" "opération interrompue (pid $pid arrêté) dont des sous-processus tiennent encore le verrou : attendez leur fin ou arrêtez-les (fuser $LOCK_FILE)."
    die "$E_LOCKED" "une autre opération est en cours (verrou $LOCK_FILE)."
  fi
  LOCK_HELD=1
  local actor="${POLENTA_ACTOR:-${SUDO_USER:-${USER:-root}}}" origin="${POLENTA_ORIGIN:-ssh}"
  jq -nc --arg op "$op" --arg actor "$actor" --arg origin "$origin" --argjson pid "$$" \
    --arg since "$(date -Iseconds)" '{op:$op, actor:$actor, origin:$origin, pid:$pid, since:$since}' \
    >"$LOCK_OWNER.tmp.$$"
  mv "$LOCK_OWNER.tmp.$$" "$LOCK_OWNER"
}
release_lock() {
  [[ "$LOCK_HELD" == 1 ]] || return 0
  rm -f "$LOCK_OWNER"
  flock -u 9 2>/dev/null || true
  LOCK_HELD=0
}
# Fonctions appelées à la sortie (nettoyage des dossiers temporaires…), avant la libération du verrou.
EXIT_HOOKS=()
on_exit() {
  local rc=$? h
  for h in "${EXIT_HOOKS[@]}"; do "$h" || true; done
  release_lock
  rm -f "$DIE_MARK"
  return "$rc"
}
trap on_exit EXIT
trap 'die "$E_CANCELLED" "opération annulée (SIGTERM)."' TERM

require_cmd() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || die "commande « $c » introuvable — lancez d'abord « polenta-host setup »."
  done
}

# OS cibles : Debian 12/13, Ubuntu 24.04 (spec §9.1).
check_os() {
  [[ -r /etc/os-release ]] || die "/etc/os-release introuvable : OS non supporté."
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID="$ID"; OS_VERSION="$VERSION_ID"; OS_CODENAME="${VERSION_CODENAME:-}"
  case "$OS_ID:$OS_VERSION" in
    debian:12|debian:13|ubuntu:24.04) ;;
    *) die "OS non supporté : ${PRETTY_NAME:-$OS_ID $OS_VERSION}. Supportés : Debian 12, Debian 13, Ubuntu 24.04." ;;
  esac
}

# Mot de passe / secret aléatoire alphanumérique. Pas de « tr </dev/urandom | head » : avec
# pipefail, le SIGPIPE de tr ferait échouer l'affectation et set -e arrêterait le script.
random_secret() {
  local len="${1:-32}" s=""
  while (( ${#s} < len )); do
    s+="$(LC_ALL=C tr -dc 'A-Za-z0-9' < <(head -c 512 /dev/urandom))"
  done
  printf '%s' "${s:0:len}"
}

# Arrêt inattendu (set -e) : toujours dire où, jamais de sortie silencieuse.
on_error() {
  local rc=$? line="$1" cmd="$2"
  [[ -e "$DIE_MARK" ]] && exit "$rc"
  printf '%s
' "${C_RED}Erreur inattendue${C_OFF} (code $rc) ligne $line : $cmd" >&2
  exit "$rc"
}
trap 'on_error "$LINENO" "$BASH_COMMAND"' ERR

# Écrit $2 dans le fichier $1 seulement si le contenu change (idempotence : un second
# passage ne touche aucun fichier). Renvoie 0 si écrit, 1 si inchangé.
write_if_changed() {
  local file="$1" content="$2" mode="${3:-}"
  if [[ -f "$file" ]] && [[ "$(cat "$file")" == "$content" ]]; then
    return 1
  fi
  mkdir -p "$(dirname "$file")"
  # Fichier à mode imposé (secrets en 600) : jamais lisible par d'autres, même le temps de l'écriture.
  ( [[ -n "$mode" ]] && umask 077; printf '%s\n' "$content" >"$file.tmp.$$" )
  [[ -n "$mode" ]] && chmod "$mode" "$file.tmp.$$"
  mv "$file.tmp.$$" "$file"
  return 0
}

# Lecture d'une variable KEY=valeur dans un fichier env (sans l'exécuter).
env_get() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  sed -n "s/^${key}=//p" "$file" | tail -n1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

# Écrit/remplace KEY=valeur dans un fichier env (chmod 600). Ne touche pas le fichier si la
# valeur est identique.
env_set() {
  local file="$1" key="$2" value="$3"
  if [[ -f "$file" ]] && grep -q "^${key}=" "$file"; then
    [[ "$(env_get "$file" "$key")" == "$value" ]] && return 0
    local tmp="$file.tmp.$$"
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k{print k "=" v; next} {print}' "$file" >"$tmp"
    chmod 600 "$tmp"; mv "$tmp" "$file"
  else
    touch "$file"; chmod 600 "$file"
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

# Charge host.env dans des variables HOST_* (sans `source` : le fichier n'est jamais exécuté).
load_host_env() {
  [[ -f "$HOST_ENV" ]] || die "$HOST_ENV introuvable — lancez « polenta-host setup »."
  ACME_EMAIL="$(env_get "$HOST_ENV" ACME_EMAIL)"
  BASE_DOMAIN="$(env_get "$HOST_ENV" BASE_DOMAIN)"
  # GH44 — image du client web proposée par défaut (instance web enable), ex. ghcr.io/…/polenta-web.
  POLENTA_WEB_IMAGE_DEFAULT="$(env_get "$HOST_ENV" POLENTA_WEB_IMAGE)"
  FORGE_IMAGE_DEFAULT="$(env_get "$HOST_ENV" FORGE_IMAGE)"; FORGE_IMAGE_DEFAULT="${FORGE_IMAGE_DEFAULT:-$DEFAULT_FORGE_IMAGE}"
  FORGE_VERSION_DEFAULT="$(env_get "$HOST_ENV" FORGE_VERSION)"; FORGE_VERSION_DEFAULT="${FORGE_VERSION_DEFAULT:-$DEFAULT_FORGE_VERSION}"
  CADDY_VERSION="$(env_get "$HOST_ENV" CADDY_VERSION)"; CADDY_VERSION="${CADDY_VERSION:-$DEFAULT_CADDY_VERSION}"
  SMTP_HOST="$(env_get "$HOST_ENV" SMTP_HOST)"
  SMTP_PORT="$(env_get "$HOST_ENV" SMTP_PORT)"
  SMTP_USER="$(env_get "$HOST_ENV" SMTP_USER)"
  SMTP_PASSWORD="$(env_get "$HOST_ENV" SMTP_PASSWORD)"
  SMTP_FROM="$(env_get "$HOST_ENV" SMTP_FROM)"
  # GH62 — niveau de durcissement et surcharge fine : lus bruts, validés par modules_resolve.
  HARDEN_HOST_RAW="$(env_get "$HOST_ENV" HARDEN_HOST)"
  HOST_MODULES_RAW="$(env_get "$HOST_ENV" HOST_MODULES)"
  # GH61 — Caddy et réseau de bord optionnels ; validés ici, avant toute action sur l'hôte.
  CADDY_MODE="$(env_get "$HOST_ENV" CADDY_MODE)"; CADDY_MODE="${CADDY_MODE:-$DEFAULT_CADDY_MODE}"
  EDGE_NETWORK="$(env_get "$HOST_ENV" EDGE_NETWORK)"; EDGE_NETWORK="${EDGE_NETWORK:-$DEFAULT_EDGE_NETWORK}"
  CADDY_SITES_DIR="$(env_get "$HOST_ENV" CADDY_SITES_DIR)"; CADDY_SITES_DIR="${CADDY_SITES_DIR:-$DEFAULT_CADDY_SITES_DIR}"
  CADDY_RELOAD_CMD="$(env_get "$HOST_ENV" CADDY_RELOAD_CMD)"
  # GH63 — administration depuis Polenta : interface (on|off, défaut off), instance d'exploitation
  # (ses propriétaires administrent l'hôte), socket de l'agent hôte.
  ADMIN_UI="$(env_get "$HOST_ENV" ADMIN_UI)"; ADMIN_UI="${ADMIN_UI:-off}"
  ADMIN_INSTANCE="$(env_get "$HOST_ENV" ADMIN_INSTANCE)"
  ADMIN_AGENT_SOCKET="$(env_get "$HOST_ENV" ADMIN_AGENT_SOCKET)"; ADMIN_AGENT_SOCKET="${ADMIN_AGENT_SOCKET:-/run/polenta/agent.sock}"
  validate_host_env
}

# GH61 — refus explicite (français, exit non nul) des valeurs invalides de CADDY_MODE, EDGE_NETWORK
# et CADDY_SITES_DIR.
validate_host_env() {
  [[ "$CADDY_MODE" == managed || "$CADDY_MODE" == external ]]     || die "CADDY_MODE « $CADDY_MODE » invalide dans $HOST_ENV : valeurs acceptées managed|external."
  [[ "$EDGE_NETWORK" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]     || die "EDGE_NETWORK « $EDGE_NETWORK » invalide dans $HOST_ENV : motif accepté [a-zA-Z0-9][a-zA-Z0-9_.-]* (ni espace, ni tiret initial)."
  [[ "$ADMIN_UI" == on || "$ADMIN_UI" == off ]] || die "ADMIN_UI « $ADMIN_UI » invalide dans $HOST_ENV : valeurs acceptées on|off."
  [[ -z "$ADMIN_INSTANCE" || "$ADMIN_INSTANCE" =~ ^[a-z0-9][a-z0-9-]{1,30}$ ]] || die "ADMIN_INSTANCE « $ADMIN_INSTANCE » invalide dans $HOST_ENV : nom d'instance attendu."
  [[ "$ADMIN_AGENT_SOCKET" == /* ]] || die "ADMIN_AGENT_SOCKET « $ADMIN_AGENT_SOCKET » invalide dans $HOST_ENV : un chemin absolu est requis."
  [[ "$CADDY_SITES_DIR" == /* ]]     || die "CADDY_SITES_DIR « $CADDY_SITES_DIR » invalide dans $HOST_ENV : un chemin absolu est requis."
}

# Liste des instances (noms), triée.
list_instances() {
  [[ -d "$POLENTA_INSTANCES" ]] || return 0
  find "$POLENTA_INSTANCES" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort
}

instance_dir() { printf '%s/%s' "$POLENTA_INSTANCES" "$1"; }
instance_env() { printf '%s/%s/instance.env' "$POLENTA_INSTANCES" "$1"; }

# Résout l'instance visée : argument explicite, sinon l'unique instance de l'hôte.
resolve_instance() {
  local wanted="$1"
  if [[ -n "$wanted" ]]; then
    [[ -f "$(instance_env "$wanted")" ]] || die "$E_NO_INSTANCE" "instance « $wanted » inconnue. Instances : $(list_instances | tr '\n' ' ')"
    printf '%s' "$wanted"; return
  fi
  local all; all="$(list_instances)"
  local n; n="$(printf '%s' "$all" | grep -c . || true)"
  case "$n" in
    0) die "$E_NO_INSTANCE" "aucune instance sur cet hôte." ;;
    1) printf '%s' "$all" ;;
    *) die "$E_USAGE" "plusieurs instances : précisez --instance <nom> parmi : $(printf '%s' "$all" | tr '\n' ' ')" ;;
  esac
}

# Adresses publiques de l'hôte (source de la route par défaut).
# Pas de route (hôte sans IPv6, réseau absent) : vide, jamais une erreur sous pipefail (status --json).
host_ipv4() { ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n1 || true; }
host_ipv6() { ip -6 route get 2606:4700:4700::1111 2>/dev/null | sed -n 's/.* src \([0-9a-f:]*\).*/\1/p' | head -n1 || true; }

# GH63 — verdict DNS de $1 pour cet hôte, sans rien arrêter (dns check --json, check_dns_points_here) :
# DNS_VERDICT = ok | no-resolve | elsewhere | aaaa-mismatch, DNS_MESSAGE (français), DNS_A / DNS_AAAA
# (enregistrements trouvés), HOST_V4 / HOST_V6. Résolveur public uniquement (pas de cache local).
dns_verdict() {
  local domain="$1"
  HOST_V4="$(host_ipv4)"; HOST_V6="$(host_ipv6)"
  DNS_A="$(dig +short A "$domain" @1.1.1.1 | grep -E '^[0-9.]+$' || true)"
  DNS_AAAA="$(dig +short AAAA "$domain" @1.1.1.1 | grep -E '^[0-9a-f:]+$' || true)"
  DNS_VERDICT=ok; DNS_MESSAGE="« $domain » pointe vers cet hôte."
  if [[ -z "$DNS_A" ]]; then
    DNS_VERDICT=no-resolve
    DNS_MESSAGE="« $domain » ne résout pas (A). Attendu : $HOST_V4. Créez l'enregistrement DNS puis relancez."
  elif ! grep -qx "$HOST_V4" <<<"$DNS_A"; then
    DNS_VERDICT=elsewhere
    DNS_MESSAGE="« $domain » résout vers $(tr '
' ' ' <<<"$DNS_A")au lieu de $HOST_V4 (IP de cet hôte)."
  elif [[ -n "$DNS_AAAA" && -z "$HOST_V6" ]]; then
    DNS_VERDICT=aaaa-mismatch
    DNS_MESSAGE="« $domain » a un AAAA ($DNS_AAAA) mais cet hôte n'a pas d'IPv6 : le certificat échouerait."
  elif [[ -n "$DNS_AAAA" ]] && ! grep -qx "$HOST_V6" <<<"$DNS_AAAA"; then
    DNS_VERDICT=aaaa-mismatch
    DNS_MESSAGE="« $domain » AAAA = $(tr '
' ' ' <<<"$DNS_AAAA")au lieu de $HOST_V6 (IPv6 de cet hôte)."
  fi
}

# Vérifie que $1 résout vers cet hôte (A obligatoire, AAAA vérifié s'il existe) ; sinon arrêt (15).
check_dns_points_here() {
  dns_verdict "$1"
  [[ "$DNS_VERDICT" == ok ]] || die "$E_DNS" "$DNS_MESSAGE"
}

# Trace des commandes d'administration (spec §9.6) — jamais de mot de passe dans $cmd.
admin_log() {
  local instance="$1" cmd="$2" result="$3"
  local file; file="$(instance_dir "$instance")/admin.log"
  printf '%s | %s | %s | %s\n' "$(date -Iseconds)" "$instance" "$cmd" "$result" >>"$file"
  chmod 600 "$file"
}
