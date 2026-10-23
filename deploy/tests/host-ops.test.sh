#!/usr/bin/env bash
# GH63 Sprint 1 — opérations mutantes de polenta-host sur un hôte simulé (specs/GH63-tests.md
# S1-3, S1-5, S1-9, S1-12) : confirmations, codes de sortie, verrou, archives d'export. docker,
# restic, ip… sont des doublures dans le PATH ; POLENTA_ROOT est temporaire. Lancé en root dans
# un conteneur jetable (Debian 13 + jq).
#
#   deploy/tests/host-ops.test.sh
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
export POLENTA_ROOT="$tmp/root" POLENTA_LOG_DIR="$tmp/log" CALLS="$tmp/calls"
mkdir -p "$tmp/bin" "$POLENTA_ROOT/exports"
cat >"$POLENTA_ROOT/host.env" <<'EOF'
ACME_EMAIL=ops@exemple.fr
BASE_DOMAIN=exemple.fr
HARDEN_HOST=none
CADDY_MODE=external
EOF
new_instance() {
  local n="$1"; mkdir -p "$POLENTA_ROOT/instances/$n/data"
  printf 'DOMAIN=%s-forge.exemple.fr\nORG=%s\nFORGE_IMAGE=codeberg.org/forgejo/forgejo\nFORGE_VERSION=15.0.9\nRESTIC_PASSWORD=x\n' "$n" "$n" \
    >"$POLENTA_ROOT/instances/$n/instance.env"
  touch "$POLENTA_ROOT/instances/$n/.add-complete"
}
new_instance acme; new_instance t1

stub() { printf '#!/usr/bin/env bash\n%s\n' "$2" >"$tmp/bin/$1"; chmod +x "$tmp/bin/$1"; }
# docker : journal des appels ; « pull » d'une version inexistante échoue.
stub docker 'echo "docker $*" >>"$CALLS"
case "$1" in
  pull) [[ "$*" == *99.0.0* ]] && exit 1; exit 0 ;;
  exec) [[ "${FAIL_EXPORT:-0}" == 1 ]] && exit 1; exit 0 ;;
  inspect) echo healthy ;;
  version) echo 27.3.1 ;;
  *) exit 0 ;;
esac'
stub ip 'echo "x via y dev eth0 src 203.0.113.10 uid 0"'
for c in systemctl ufw fail2ban-client sshd restic dig curl; do stub "$c" 'echo "$(basename "$0") $*" >>"$CALLS"; exit 1'; done
export PATH="$tmp/bin:$PATH"

run() { : >"$CALLS"; bash "$HOSTSH" "$@" >"$tmp/out" 2>"$tmp/err" 3>"$tmp/fd3" </dev/null; }
jqe() { jq -e "$1" "$tmp/fd3" >/dev/null 2>&1; }

echo "== instance remove : confirmations (S1-3, S1-12)"
run instance remove t1; RC=$?
check "sans --confirm (entrée fermée) : sortie 3" test "$RC" -eq 3
check "sans --confirm : instance intacte" test -f "$POLENTA_ROOT/instances/t1/instance.env"
run instance remove t1 --non-interactive; RC=$?
check "--non-interactive sans --confirm : sortie 3" test "$RC" -eq 3
run instance remove t1 --confirm autre; RC=$?
check "--confirm autre : sortie 3" test "$RC" -eq 3
check "--confirm autre : instance intacte, aucun appel docker" bash -c "[[ -f '$POLENTA_ROOT/instances/t1/instance.env' ]] && ! grep -q docker '$CALLS'"
FAIL_EXPORT=1 run instance remove t1 --confirm t1 --non-interactive --json; RC=$?
# Export en échec (dump de la forge refusé) : pré-condition, rien n'est supprimé.
check "--confirm t1, export impossible : sortie 6" test "$RC" -eq 6
check "export impossible : instance intacte" test -f "$POLENTA_ROOT/instances/t1/instance.env"
check "export impossible : message « rien n'a été supprimé »" grep -q "rien n'a été supprimé" "$tmp/err"
check "verrou libéré après l'échec" test ! -f "$POLENTA_ROOT/.lock.owner"
run instance remove t1 --confirm t1 --non-interactive --json; RC=$?
check "--confirm t1 : sortie 0" test "$RC" -eq 0
check "--confirm t1 : instance supprimée" test ! -e "$POLENTA_ROOT/instances/t1"
check "--confirm t1 : export fait avant, cité dans le résultat" jqe '.removed=="t1" and (.export|test("/exports/t1-[0-9]{8}-[0-9]{6}[.]tar[.]gz$"))'
check "--confirm t1 : archive d'export présente" bash -c "ls '$POLENTA_ROOT'/exports/t1-*.tar.gz >/dev/null"

echo "== instance update : version inexistante (S1-5)"
run instance update acme 99.0.0 --json; RC=$?
check "sortie 14" test "$RC" -eq 14
check "« rien n'a été modifié »" grep -q "rien n'a été modifié" "$tmp/err"
check "instance.env intact (15.0.9)" grep -q "^FORGE_VERSION=15.0.9$" "$POLENTA_ROOT/instances/acme/instance.env"
check "aucune sauvegarde ni redémarrage tentés" bash -c "! grep -qE 'restic|compose' '$CALLS'"
run instance update acme --version 99.0.0; RC=$?
check "forme --version <v> : sortie 14 également" test "$RC" -eq 14
run instance update inconnue 15.0.10; RC=$?
check "instance inconnue : sortie 12" test "$RC" -eq 12
run instance update acme latest; RC=$?
check "« latest » refusé : sortie 2" test "$RC" -eq 2

echo "== Verrou sur les opérations (S1-9)"
( exec 9>>"$POLENTA_ROOT/.lock"; flock 9
  printf '{"op":"instance backup acme","actor":"alice","origin":"ui","pid":%s,"since":"2026-10-23T10:00:00+02:00"}\n' "$BASHPID" >"$POLENTA_ROOT/.lock.owner"
  touch "$tmp/held"; sleep 5 ) &
for _ in $(seq 50); do [[ -e "$tmp/held" ]] && break; sleep 0.1; done
run instance update acme 15.0.10; RC=$?
check "update pendant un backup : sortie 5" test "$RC" -eq 5
check "message : opération, origine, depuis quand" grep -q "instance backup acme (ui, alice) depuis 2026-10-23T10:00:00" "$tmp/err"
check "rien tenté (pas de docker pull)" bash -c "! grep -q 'docker pull' '$CALLS'"
run instance list --json; RC=$?
check "lecture pendant le verrou : sortie 0" test "$RC" -eq 0
kill %1 2>/dev/null; wait 2>/dev/null; rm -f "$POLENTA_ROOT/.lock.owner"

echo "== instance backup : étiquette, pré-condition"
run instance backup acme --tag 'pas bon'; RC=$?
check "étiquette invalide : sortie 2" test "$RC" -eq 2
run instance backup acme --tag avant-migration; RC=$?
check "sans stockage S3 configuré : sortie 6" test "$RC" -eq 6

echo "== exports list | delete"
printf 'archive' >"$POLENTA_ROOT/exports/acme-20261020-101500.tar.gz"
printf 'abc123  acme-20261020-101500.tar.gz\n' >"$POLENTA_ROOT/exports/acme-20261020-101500.tar.gz.sha256"
run exports list --json; RC=$?
check "list : sortie 0" test "$RC" -eq 0
check "list : archive, instance, taille, sha256" jqe '.exports[0] | .file=="acme-20261020-101500.tar.gz" and .instance=="acme" and .sizeBytes==7 and .sha256=="abc123"'
run exports delete acme-20261020-101500.tar.gz --non-interactive; RC=$?
check "delete sans --confirm : sortie 3, archive conservée" bash -c "[[ $RC == 3 && -f '$POLENTA_ROOT/exports/acme-20261020-101500.tar.gz' ]]"
run exports delete ../host.env --confirm ../host.env; RC=$?
check "delete hors du dossier des exports : sortie 2" test "$RC" -eq 2
run exports delete acme-20261020-101500.tar.gz --confirm acme-20261020-101500.tar.gz --json; RC=$?
check "delete confirmé : sortie 0" test "$RC" -eq 0
check "delete : archive et .sha256 effacés" bash -c "[[ ! -e '$POLENTA_ROOT/exports/acme-20261020-101500.tar.gz' && ! -e '$POLENTA_ROOT/exports/acme-20261020-101500.tar.gz.sha256' ]]"
check "delete : résultat" jqe '.deleted=="acme-20261020-101500.tar.gz"'

echo "== Droits"
run instance list; RC=$?
check "root : sortie 0" test "$RC" -eq 0
POLENTA_ADMIN_MODE=1 run instance list; RC=$?
check "mode administration sous root (≠ uid 1500) : sortie 4" test "$RC" -eq 4

exit $FAIL
