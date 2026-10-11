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

if [[ -t 1 ]]; then
  C_RED=$'\e[31m'; C_GRN=$'\e[32m'; C_YEL=$'\e[33m'; C_BLU=$'\e[34m'; C_DIM=$'\e[2m'; C_OFF=$'\e[0m'
else
  C_RED=''; C_GRN=''; C_YEL=''; C_BLU=''; C_DIM=''; C_OFF=''
fi

log()   { printf '%s\n' "${C_BLU}==>${C_OFF} $*"; }
ok()    { printf '%s\n' "  ${C_GRN}✓${C_OFF} $*"; }
skip()  { printf '%s\n' "  ${C_DIM}· $* (déjà fait)${C_OFF}"; }
warn()  { printf '%s\n' "  ${C_YEL}!${C_OFF} $*" >&2; }
# Code 3 : erreur déjà expliquée à l'utilisateur. on_error ne la répète pas, même quand die est
# appelé dans une substitution $(…) dont l'échec remonte au script appelant.
DIE_CODE=3
die()   { printf '%s\n' "${C_RED}Erreur :${C_OFF} $*" >&2; exit "$DIE_CODE"; }

require_root() {
  [[ $EUID -eq 0 ]] || die "à lancer en root (sudo $0 …)."
}

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
  [[ $rc == "$DIE_CODE" ]] && exit "$rc"
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
    [[ -f "$(instance_env "$wanted")" ]] || die "instance « $wanted » inconnue. Instances : $(list_instances | tr '\n' ' ')"
    printf '%s' "$wanted"; return
  fi
  local all; all="$(list_instances)"
  local n; n="$(printf '%s' "$all" | grep -c . || true)"
  case "$n" in
    0) die "aucune instance sur cet hôte." ;;
    1) printf '%s' "$all" ;;
    *) die "plusieurs instances : précisez --instance <nom> parmi : $(printf '%s' "$all" | tr '\n' ' ')" ;;
  esac
}

# Adresses publiques de l'hôte (source de la route par défaut).
host_ipv4() { ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n1; }
host_ipv6() { ip -6 route get 2606:4700:4700::1111 2>/dev/null | sed -n 's/.* src \([0-9a-f:]*\).*/\1/p' | head -n1; }

# Vérifie que $1 résout vers cet hôte (A obligatoire, AAAA vérifié s'il existe), via un
# résolveur public pour ne pas dépendre du cache local.
check_dns_points_here() {
  local domain="$1" v4 v6 a aaaa
  v4="$(host_ipv4)"; v6="$(host_ipv6)"
  a="$(dig +short A "$domain" @1.1.1.1 | grep -E '^[0-9.]+$' || true)"
  aaaa="$(dig +short AAAA "$domain" @1.1.1.1 | grep -E '^[0-9a-f:]+$' || true)"
  [[ -n "$a" ]] || die "« $domain » ne résout pas (A). Attendu : $v4. Créez l'enregistrement DNS puis relancez."
  grep -qx "$v4" <<<"$a" || die "« $domain » résout vers $(tr '\n' ' ' <<<"$a")au lieu de $v4 (IP de cet hôte)."
  if [[ -n "$aaaa" ]]; then
    [[ -n "$v6" ]] || die "« $domain » a un AAAA ($aaaa) mais cet hôte n'a pas d'IPv6 : le certificat échouerait."
    grep -qx "$v6" <<<"$aaaa" || die "« $domain » AAAA = $(tr '\n' ' ' <<<"$aaaa")au lieu de $v6 (IPv6 de cet hôte)."
  fi
}

# Confirmation interactive (sautée avec ASSUME_YES=1).
confirm() {
  [[ "${ASSUME_YES:-0}" == 1 ]] && return 0
  local answer
  read -r -p "$1 [o/N] " answer
  [[ "$answer" =~ ^[oOyY]$ ]]
}

# Trace des commandes d'administration (spec §9.6) — jamais de mot de passe dans $cmd.
admin_log() {
  local instance="$1" cmd="$2" result="$3"
  local file; file="$(instance_dir "$instance")/admin.log"
  printf '%s | %s | %s | %s\n' "$(date -Iseconds)" "$instance" "$cmd" "$result" >>"$file"
  chmod 600 "$file"
}
