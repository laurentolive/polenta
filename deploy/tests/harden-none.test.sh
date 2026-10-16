#!/usr/bin/env bash
# GH62 — vérification SUR L'HÔTE (root) du niveau HARDEN_HOST=none (specs/GH62.md critères 2 à 4).
# À lancer après `polenta-host setup` sur un hôte où ufw, fail2ban et unattended-upgrades étaient
# absents avant le setup. Sortie non nulle au moindre écart.
#
#   sudo deploy/tests/harden-none.test.sh [--ufw-before <fichier>] [--sshd-before <fichier>]
#
# --ufw-before / --sshd-before : sorties de `ufw status verbose` / `sshd -T | grep -E
# 'permitrootlogin|passwordauthentication'` relevées AVANT setup (hôte au pare-feu actif, critère 3).
set -uo pipefail

[[ $EUID -eq 0 ]] || { echo "à lancer en root" >&2; exit 2; }
FAIL=0
UFW_BEFORE=""; SSHD_BEFORE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ufw-before) UFW_BEFORE="${2:-}"; shift 2 ;;
    --sshd-before) SSHD_BEFORE="${2:-}"; shift 2 ;;
    *) echo "option inconnue : $1" >&2; exit 2 ;;
  esac
done

pass() { printf '  \e[32m✓\e[0m %s\n' "$*"; }
fail() { printf '  \e[31m✗\e[0m %s\n' "$*"; FAIL=1; }
check() { local msg="$1"; shift; if "$@"; then pass "$msg"; else fail "$msg"; fi; }
absent() { [[ ! -e "$1" ]]; }
present() { [[ -e "$1" ]]; }
pkg_absent() { ! dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'; }

echo "== Critère 2 — rien de durci n'a été installé"
for p in ufw fail2ban unattended-upgrades; do check "paquet $p absent" pkg_absent "$p"; done
check "pas de durcissement SSH du kit" absent /etc/ssh/sshd_config.d/10-polenta.conf
check "/etc/fail2ban absent" absent /etc/fail2ban
check "20auto-upgrades absent" absent /etc/apt/apt.conf.d/20auto-upgrades
check "52polenta-unattended absent" absent /etc/apt/apt.conf.d/52polenta-unattended
check "pas de réglage resolved du kit" absent /etc/systemd/resolved.conf.d/10-polenta.conf
check "pas de réglage console du kit" absent /etc/sysctl.d/10-polenta-console.conf

echo "== Critère 3 — pare-feu et SSH inchangés"
if [[ -n "$UFW_BEFORE" ]]; then
  check "ufw status verbose identique" cmp -s "$UFW_BEFORE" <(ufw status verbose)
else echo "  · ufw non comparé (--ufw-before absent)"; fi
if [[ -n "$SSHD_BEFORE" ]]; then
  check "sshd -T identique" cmp -s "$SSHD_BEFORE" <(sshd -T | grep -E 'permitrootlogin|passwordauthentication')
else echo "  · sshd non comparé (--sshd-before absent)"; fi

echo "== Critère 4 — l'indispensable est en place"
check "Docker Compose" docker compose version
check "restic" command -v restic
check "cron de sauvegarde" present /etc/cron.d/polenta
check "rotation des journaux" present /etc/logrotate.d/polenta
check "Caddy en service" bash -c 'docker ps --format "{{.Names}}" | grep -qi caddy'

echo "== status"
if out="$(polenta-host status 2>&1)"; then
  check "niveau none annoncé" grep -q 'niveau none' <<<"$out"
  check "aucun module hors niveau ni attendu absent" bash -c '! grep -qE "hors niveau\)|attendu, absent" <<<"$1"' _ "$out"
else fail "polenta-host status échoue"; fi

[[ $FAIL == 0 ]] && printf '\nTous les contrôles passent.\n' || printf '\n\e[31mDes contrôles échouent.\e[0m\n'
exit $FAIL
