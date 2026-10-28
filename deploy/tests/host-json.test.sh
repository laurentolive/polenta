#!/usr/bin/env bash
# GH63 Sprint 1 — commandes de lecture de polenta-host en --json (specs/GH63-tests.md S1-1, S1-4,
# S1-10) sur un hôte simulé : POLENTA_ROOT temporaire, docker/dig/ip/restic remplacés par des
# doublures dans le PATH. Lancé en root dans un conteneur jetable (Debian 13 + jq).
#
#   deploy/tests/host-json.test.sh
# shellcheck disable=SC2016,SC2329  # doublures écrites en chaînes ; fonctions appelées via check
set -uo pipefail

[[ $EUID -eq 0 ]] || { echo "à lancer en root (conteneur de test)" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOSTSH="$here/../polenta-host.sh"
FAIL=0
pass() { printf '  \e[32m✓\e[0m %s\n' "$*"; }
fail() { printf '  \e[31m✗\e[0m %s\n' "$*"; FAIL=1; }
check() { local msg="$1"; shift; if "$@"; then pass "$msg"; else fail "$msg"; fi; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
export POLENTA_ROOT="$tmp/root" POLENTA_LOG_DIR="$tmp/log"
mkdir -p "$POLENTA_ROOT/instances/acme/data" "$tmp/bin"
cat >"$POLENTA_ROOT/host.env" <<'EOF'
ACME_EMAIL=ops@exemple.fr
BASE_DOMAIN=exemple.fr
HARDEN_HOST=none
CADDY_MODE=external
EOF
cat >"$POLENTA_ROOT/instances/acme/instance.env" <<'EOF'
DOMAIN=acme-forge.exemple.fr
ORG=acme
FORGE_VERSION=15.0.9
LAST_BACKUP=2026-10-22T03:00:00+02:00
RESTIC_PASSWORD=Sentinel-restic
EOF
touch "$POLENTA_ROOT/instances/acme/.add-complete"

# Doublures.
stub() { printf '#!/usr/bin/env bash\n%s\n' "$2" >"$tmp/bin/$1"; chmod +x "$tmp/bin/$1"; }
stub docker 'case "$1 $2" in "inspect -f") echo healthy ;; "version --format") echo 27.3.1 ;; "network inspect") exit 0 ;; *) exit 1 ;; esac'
stub ip 'if [[ "$1" == -4 ]]; then echo "1.1.1.1 via 10.0.0.1 dev eth0 src 203.0.113.10 uid 0"; else echo "x via y dev eth0 src 2001:db8::10 metric 1"; fi'
stub dig 'case "$2" in A) printf "%s\n" ${DIG_A:-} ;; AAAA) printf "%s\n" ${DIG_AAAA:-} ;; esac'
stub restic 'for a; do [[ $a == --json ]] && { echo "[{\"id\":\"abcdef0123456789\",\"short_id\":\"abcdef01\",\"time\":\"2026-10-22T03:00:00Z\",\"tags\":[\"nightly\"],\"paths\":[\"/data\"]}]"; exit 0; }; done; echo "abcdef01  2026-10-22 03:00:00  nightly"'
for c in systemctl ufw fail2ban-client sshd; do stub "$c" 'exit 1'; done
export PATH="$tmp/bin:$PATH"

run() { bash "$HOSTSH" "$@" >"$tmp/out" 2>"$tmp/err" 3>"$tmp/fd3" </dev/null; }
json_ok() { jq -e . "$tmp/fd3" >/dev/null 2>&1; }
jqe() { jq -e "$1" "$tmp/fd3" >/dev/null 2>&1; }

echo "== instance list --json (S1-1)"
run instance list --json; RC=$?
check "sortie 0" test "$RC" -eq 0
check "résultat JSON valide sur fd 3" json_ok
check "instance acme, domaine, version" jqe '.instances[0] | .name=="acme" and .domain=="acme-forge.exemple.fr" and .forgeVersion=="15.0.9"'
check "journal humain (tableau) sur stdout" grep -q "acme-forge.exemple.fr" "$tmp/out"
check "aucun secret dans le résultat" bash -c "! grep -q Sentinel-restic '$tmp/fd3'"

echo "== status --json (S1-1)"
run status --json; RC=$?
check "sortie 0" test "$RC" -eq 0
check "résultat JSON valide" json_ok
check "niveau de durcissement (#62) : none" jqe '.hardening.level=="none"'
check "modules listés, docker toujours actif" jqe '.hardening.modules | map(select(.name=="docker")) | .[0].enabled'
check "Caddy (#61) : mode external" jqe '.caddy.mode=="external"'
check "versions : forge par défaut, docker" jqe '.versions.forgeDefault | endswith(":15.0.9")'
check "instances incluses" jqe '.instances | length == 1'
check "IPv4 de l'hôte" jqe '.ipv4=="203.0.113.10"'

echo "== instance snapshots --json (S1-1)"
run instance snapshots acme --json; RC=$?
check "sortie 0" test "$RC" -eq 0
check "instantané : id court, étiquettes" jqe '.snapshots[0] | .id=="abcdef01" and .tags==["nightly"]'
run instance snapshots inconnue --json; RC=$?
check "instance inconnue : sortie 12" test "$RC" -eq 12

echo "== instance keys <nom> --json (GH63 S5-2)"
run instance keys acme --json; RC=$?
check "sortie 0" test "$RC" -eq 0
check "clé dans le résultat (fd 3)" jqe '.instance=="acme" and .resticPassword=="Sentinel-restic"'
check "clé absente du journal (stdout, stderr)" bash -c "! grep -q Sentinel-restic '$tmp/out' '$tmp/err'"
run instance keys inconnue --json; RC=$?
check "instance inconnue : sortie 12" test "$RC" -eq 12

echo "== dns check --json (S1-4)"
dns() { DIG_A="$1" DIG_AAAA="$2" run dns check forge.exemple.fr --json; RC=$?; }
dns "203.0.113.10" ""
check "résout vers l'hôte : ok, sortie 0" bash -c "[[ $RC == 0 ]] && jq -e '.verdict==\"ok\"' '$tmp/fd3' >/dev/null"
dns "" ""
check "ne résout pas : no-resolve, sortie 15" bash -c "[[ $RC == 15 ]] && jq -e '.verdict==\"no-resolve\"' '$tmp/fd3' >/dev/null"
check "enregistrement à créer : A forge.exemple.fr → 203.0.113.10" jqe '.expected[0] == {type:"A", name:"forge.exemple.fr", value:"203.0.113.10"}'
check "enregistrement à créer affiché dans le journal" grep -q "A forge.exemple.fr → 203.0.113.10" "$tmp/err"
dns "198.51.100.7" ""
check "pointe ailleurs : elsewhere, sortie 15" bash -c "[[ $RC == 15 ]] && jq -e '.verdict==\"elsewhere\" and .found.a==[\"198.51.100.7\"]' '$tmp/fd3' >/dev/null"
dns "203.0.113.10" "2001:db8::99"
check "AAAA incohérent : aaaa-mismatch, sortie 15" bash -c "[[ $RC == 15 ]] && jq -e '.verdict==\"aaaa-mismatch\"' '$tmp/fd3' >/dev/null"
DIG_A="" run dns check "pas un domaine;rm" --json; RC=$?
check "domaine invalide : sortie 2" test "$RC" -eq 2
dns "" ""
check "sans --json : message identique à check_dns_points_here" grep -q "ne résout pas (A). Attendu : 203.0.113.10" "$tmp/err"

echo "== Lectures pendant un verrou (S1-10)"
( exec 9>>"$POLENTA_ROOT/.lock"; flock 9; touch "$tmp/held"; sleep 5 ) &
for _ in $(seq 50); do [[ -e "$tmp/held" ]] && break; sleep 0.1; done
run instance list --json; RC=$?
check "instance list pendant le verrou : sortie 0" test "$RC" -eq 0
DIG_A="203.0.113.10" run dns check forge.exemple.fr --json; RC=$?
check "dns check pendant le verrou : sortie 0" test "$RC" -eq 0
kill %1 2>/dev/null; wait 2>/dev/null

exit $FAIL
