#!/usr/bin/env bash
# GH62 — modules facultatifs de durcissement de l'hôte (specs/GH62.md, specs/GH62-design.md §2, §5).
# Sourcé par polenta-host.sh après common.sh. Fonctions de résolution pures : aucun effet de bord,
# ni root, ni apt, ni hôte réel (testables : deploy/tests/harden-modules.test.sh). Seules
# module_detect et module_active interrogent l'hôte, en lecture seule.
# shellcheck disable=SC2034  # variables lues par polenta-host.sh

# Racine des fichiers de configuration (variable de test uniquement).
POLENTA_ETC="${POLENTA_ETC:-/etc}"

# Ordre d'exécution de `setup` (identique à l'historique GH45 en niveau full).
HOST_MODULE_ORDER=(resolved firewall console fail2ban unattended ssh-hardening backup-cron fail2ban-forge)
# Ordre d'affichage de `status`.
HOST_MODULE_DISPLAY=(docker restic firewall fail2ban fail2ban-forge unattended ssh-hardening backup-cron resolved console)
# Toujours actifs : jamais retirés par un niveau ni par HOST_MODULES.
HOST_MODULE_FIXED=(docker restic)
# Sous-option : redémarrage automatique 04:00 des mises à jour (dépend de `unattended`).
HOST_MODULE_FLAG_REBOOT=unattended-reboot

HARDEN_LEVEL=full
declare -gA HOST_MODULE_SET=()
MODULES_ERR=""
# Résultats rangés en variables : MODULES_ERR serait perdu dans une substitution de commande.
MODULES_LEVEL=full
MODULES_LIST=""

_module_is_known() {
  local m
  for m in "${HOST_MODULE_DISPLAY[@]}" "$HOST_MODULE_FLAG_REBOOT"; do [[ "$m" == "$1" ]] && return 0; done
  return 1
}

# harden_level_normalize <valeur> : affiche le niveau (minuscules, sans espaces ; vide = full).
harden_level_normalize() {
  local v="${1:-}"
  v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"
  v="${v,,}"
  case "$v" in
    "") v=full ;;
    full|basic|none) ;;
    *) MODULES_ERR="HARDEN_HOST invalide : « ${1} » — valeurs admises : full|basic|none"; return 1 ;;
  esac
  MODULES_LEVEL="$v"; printf '%s\n' "$v"
}

# modules_for_level <niveau> : modules facultatifs du niveau (hors docker/restic), séparés par des
# espaces. Le drapeau unattended-reboot n'est présent qu'en full.
modules_for_level() {
  case "$1" in
    full)  printf '%s\n' "resolved firewall console fail2ban unattended unattended-reboot ssh-hardening backup-cron fail2ban-forge" ;;
    basic) printf '%s\n' "fail2ban fail2ban-forge unattended backup-cron" ;;
    none)  printf '%s\n' "backup-cron" ;;
    *) return 1 ;;
  esac
}

# modules_parse_list <csv> : normalise (espaces, casse, éléments vides) ; nom inconnu → code 1.
modules_parse_list() {
  local csv="$1" item out=() items
  IFS=',' read -ra items <<<"$csv"
  for item in "${items[@]}"; do
    item="${item#"${item%%[![:space:]]*}"}"; item="${item%"${item##*[![:space:]]}"}"; item="${item,,}"
    [[ -n "$item" ]] || continue
    if ! _module_is_known "$item"; then
      MODULES_ERR="module inconnu : « $item » (modules : ${HOST_MODULE_DISPLAY[*]} $HOST_MODULE_FLAG_REBOOT)"
      return 1
    fi
    out+=("$item")
  done
  MODULES_LIST="${out[*]:-}"; printf '%s\n' "$MODULES_LIST"
}

# modules_check_deps <liste séparée par des espaces>
modules_check_deps() {
  local list=" $1 "
  if [[ "$list" == *" fail2ban-forge "* && "$list" != *" fail2ban "* ]]; then
    MODULES_ERR="module fail2ban-forge : requiert fail2ban (ajoutez-le à HOST_MODULES)"; return 1
  fi
  if [[ "$list" == *" $HOST_MODULE_FLAG_REBOOT "* && "$list" != *" unattended "* ]]; then
    MODULES_ERR="option $HOST_MODULE_FLAG_REBOOT : requiert unattended (ajoutez-le à HOST_MODULES)"; return 1
  fi
}

# modules_resolve : lit HARDEN_HOST_RAW / HOST_MODULES_RAW (posées par load_host_env), calcule
# HARDEN_LEVEL et HOST_MODULE_SET. Code 1 + MODULES_ERR si invalide. N'appelle jamais die.
modules_resolve() {
  MODULES_ERR=""; HOST_MODULE_SET=(); HARDEN_LEVEL=full
  local level list m
  harden_level_normalize "${HARDEN_HOST_RAW:-}" >/dev/null || return 1
  level="$MODULES_LEVEL"
  if [[ -n "${HOST_MODULES_RAW//[[:space:],]/}" ]]; then
    modules_parse_list "${HOST_MODULES_RAW}" >/dev/null || return 1
    list="$MODULES_LIST"
  else
    list="$(modules_for_level "$level")"
  fi
  modules_check_deps "$list" || return 1
  HARDEN_LEVEL="$level"
  for m in "${HOST_MODULE_FIXED[@]}" $list; do HOST_MODULE_SET[$m]=1; done
}

module_enabled() { [[ -n "${HOST_MODULE_SET[$1]:-}" ]]; }

# Nombre de modules de l'ensemble (le drapeau de redémarrage n'est pas un module).
modules_count() {
  local n=0 k
  for k in "${!HOST_MODULE_SET[@]}"; do [[ "$k" == "$HOST_MODULE_FLAG_REBOOT" ]] || n=$((n + 1)); done
  printf '%s\n' "$n"
}

# modules_packages : paquets à installer selon l'ensemble (ordre historique GH45).
modules_packages() {
  local p=(ca-certificates curl jq dnsutils restic)
  module_enabled firewall && p+=(ufw)
  module_enabled fail2ban && p+=(fail2ban python3-systemd)
  module_enabled unattended && p+=(unattended-upgrades apt-listchanges)
  printf '%s\n' "${p[*]}"
}

# module_active <nom> : 0 si le module est actif sur l'hôte (lecture seule).
module_active() {
  local e="$POLENTA_ETC"
  case "$1" in
    docker) command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 ;;
    restic) command -v restic >/dev/null 2>&1 ;;
    firewall) command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active' ;;
    fail2ban) systemctl is-active --quiet fail2ban 2>/dev/null && [[ -f "$e/fail2ban/jail.d/10-polenta-sshd.local" ]] ;;
    fail2ban-forge) systemctl is-active --quiet fail2ban 2>/dev/null && grep -q '^enabled = true' "$e/fail2ban/jail.d/20-polenta-forge.local" 2>/dev/null ;;
    unattended) [[ -f "$e/apt/apt.conf.d/20auto-upgrades" ]] ;;
    "$HOST_MODULE_FLAG_REBOOT") [[ -f "$e/apt/apt.conf.d/52polenta-unattended" ]] ;;
    ssh-hardening) [[ -f "$e/ssh/sshd_config.d/10-polenta.conf" ]] ;;
    backup-cron) [[ -f "$e/cron.d/polenta" ]] ;;
    resolved) [[ -f "$e/systemd/resolved.conf.d/10-polenta.conf" ]] ;;
    console) [[ -f "$e/sysctl.d/10-polenta-console.conf" ]] ;;
    *) return 1 ;;
  esac
}

# module_detect <nom> : affiche « actif » ou « inactif » (+ annotation de redémarrage pour unattended).
module_detect() {
  if module_active "$1"; then
    if [[ "$1" == unattended ]] && module_active "$HOST_MODULE_FLAG_REBOOT"; then
      printf 'actif (redémarrage auto 04:00)\n'
    else
      printf 'actif\n'
    fi
  else
    printf 'inactif\n'
  fi
}
