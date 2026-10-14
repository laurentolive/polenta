#!/usr/bin/env bash
# GH62 — tests purs de deploy/lib/modules.sh (specs/GH62-tests.md N1 à N10). Sans root ni hôte réel.
# shellcheck disable=SC2034,SC2015  # variables lues par modules.sh ; « A && B || C » voulu
#
#   deploy/tests/harden-modules.test.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../lib/modules.sh
. "$here/../lib/modules.sh"
FAIL=0
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

pass() { printf '  \e[32m✓\e[0m %s\n' "$*"; }
fail() { printf '  \e[31m✗\e[0m %s\n' "$*"; FAIL=1; }
eq() { if [[ "$2" == "$3" ]]; then pass "$1"; else fail "$1 (obtenu « $2 », attendu « $3 »)"; fi; }
sorted_set() { printf '%s\n' "${!HOST_MODULE_SET[@]}" | sort | tr '\n' ' ' | sed 's/ $//'; }
sorted() { tr ' ' '\n' <<<"$1" | sort | tr '\n' ' ' | sed 's/ $//'; }
# resolve <HARDEN_HOST> <HOST_MODULES> : code de retour de modules_resolve
resolve() { HARDEN_HOST_RAW="$1"; HOST_MODULES_RAW="${2:-}"; modules_resolve; }

echo "== N1 — normalisation du niveau"
for v in "" full " FULL " Basic none; do
  eq "« $v »" "$(harden_level_normalize "$v")" "$(case "${v,,}" in *basic*) echo basic;; *none*) echo none;; *) echo full;; esac)"
done

echo "== N2 — niveau invalide"
harden_level_normalize strict >/dev/null; rc=$?
eq "code 1" "$rc" 1
[[ "$MODULES_ERR" == *"full|basic|none"* && "$MODULES_ERR" == *strict* ]] && pass "message" || fail "message : $MODULES_ERR"

echo "== N3 — modules par niveau"
resolve full; eq "full" "$(sorted_set)" "$(sorted "backup-cron console docker fail2ban fail2ban-forge firewall resolved restic ssh-hardening unattended unattended-reboot")"
resolve basic; eq "basic" "$(sorted_set)" "$(sorted "backup-cron docker fail2ban fail2ban-forge restic unattended")"
resolve none; eq "none" "$(sorted_set)" "$(sorted "backup-cron docker restic")"
resolve ""; eq "défaut = full" "$HARDEN_LEVEL" full

echo "== N4/N5 — HOST_MODULES invalide"
resolve full fail2ban-forge; rc=$?
eq "dépendance : code 1" "$rc" 1
[[ "$MODULES_ERR" == *fail2ban-forge* && "$MODULES_ERR" == *fail2ban* ]] && pass "dépendance : message" || fail "message : $MODULES_ERR"
resolve full bidule; rc=$?
eq "inconnu : code 1" "$rc" 1
[[ "$MODULES_ERR" == *bidule* ]] && pass "inconnu : message" || fail "message : $MODULES_ERR"

echo "== N6 — tolérance"
resolve full " Firewall , fail2ban,,fail2ban-forge "; rc=$?
eq "code 0" "$rc" 0
eq "ensemble" "$(sorted_set)" "$(sorted "docker fail2ban fail2ban-forge firewall restic")"

echo "== N7 — la surcharge remplace"
resolve none firewall
eq "ensemble" "$(sorted_set)" "$(sorted "docker firewall restic")"
eq "niveau configuré" "$HARDEN_LEVEL" none

echo "== N8 — drapeau de redémarrage"
resolve full unattended; module_enabled unattended-reboot && fail "drapeau présent sans demande" || pass "sans drapeau"
resolve full unattended,unattended-reboot; module_enabled unattended-reboot && pass "avec drapeau" || fail "drapeau absent"
resolve full unattended-reboot; rc=$?
eq "drapeau seul : code 1" "$rc" 1

echo "== N9 — paquets"
resolve full;  eq "full" "$(modules_packages)" "ca-certificates curl jq dnsutils restic ufw fail2ban python3-systemd unattended-upgrades apt-listchanges"
resolve basic; eq "basic" "$(modules_packages)" "ca-certificates curl jq dnsutils restic fail2ban python3-systemd unattended-upgrades apt-listchanges"
resolve none;  eq "none" "$(modules_packages)" "ca-certificates curl jq dnsutils restic"

echo "== N10 — détection (POLENTA_ETC factice)"
POLENTA_ETC="$tmp/etc"
mkdir -p "$tmp/etc"/{ssh/sshd_config.d,cron.d,apt/apt.conf.d,systemd/resolved.conf.d,sysctl.d}
eq "ssh-hardening absent" "$(module_detect ssh-hardening)" inactif
touch "$tmp/etc/ssh/sshd_config.d/10-polenta.conf" "$tmp/etc/cron.d/polenta" \
  "$tmp/etc/systemd/resolved.conf.d/10-polenta.conf" "$tmp/etc/sysctl.d/10-polenta-console.conf" \
  "$tmp/etc/apt/apt.conf.d/20auto-upgrades"
for m in ssh-hardening backup-cron resolved console; do eq "$m présent" "$(module_detect $m)" actif; done
eq "unattended sans redémarrage" "$(module_detect unattended)" actif
touch "$tmp/etc/apt/apt.conf.d/52polenta-unattended"
eq "unattended avec redémarrage" "$(module_detect unattended)" "actif (redémarrage auto 04:00)"

[[ $FAIL == 0 ]] && printf '\nTous les tests passent.\n' || printf '\n\e[31mDes tests échouent.\e[0m\n'
exit $FAIL
