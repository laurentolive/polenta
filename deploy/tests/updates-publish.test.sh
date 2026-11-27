#!/usr/bin/env bash
# GH52 sprint 2 — publication des mises à jour (polenta-host updates publish) et route /polenta-updates/ du
# Caddy du kit. Sans root ni Docker : POLENTA_ROOT est temporaire ; les fonctions de deploy/lib sont sourcées
# dans des sous-shells. Scénarios K-P1 à K-P5 et K-R1 de specs/GH52-tests.md.
#
#   deploy/tests/updates-publish.test.sh
# shellcheck disable=SC2016,SC2329
set -uo pipefail
export MSYS_NO_PATHCONV=1

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$here/../lib"
FAIL=0
pass() { printf '  \e[32m✓\e[0m %s\n' "$*"; }
fail() { printf '  \e[31m✗\e[0m %s\n' "$*"; FAIL=1; }
check() { local msg="$1"; shift; if "$@"; then pass "$msg"; else fail "$msg"; fi; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
if command -v cygpath >/dev/null 2>&1; then tmp="$(cygpath -m "$tmp")"; fi
export POLENTA_ROOT="$tmp/root"
mkdir -p "$POLENTA_ROOT/caddy/etc"
printf 'CADDY_MODE=managed\nHARDEN_HOST=none\n' >"$POLENTA_ROOT/host.env"

# Une publication de test : latest.yml (format electron-builder) + installeur + blockmap.
make_release() { # dossier version
  mkdir -p "$1"
  printf 'version: %s\nfiles:\n  - url: Polenta-Setup-%s.exe\n    sha512: AAAA\n    size: 10\npath: Polenta-Setup-%s.exe\nsha512: AAAA\nreleaseDate: '\''2026-11-27T10:00:00.000Z'\''\n' \
    "$2" "$2" "$2" >"$1/latest.yml"
  printf 'binaire %s' "$2" >"$1/Polenta-Setup-$2.exe"
  printf 'blockmap %s' "$2" >"$1/Polenta-Setup-$2.exe.blockmap"
}
make_release "$tmp/rel1" 0.3.0
make_release "$tmp/rel2" 0.4.0
DEST="$POLENTA_ROOT/caddy/etc/updates"

# Exécute un corps de script qui source common.sh, caddy.sh puis updates.sh ; renvoie son code de sortie.
run() {
  local body="$1"
  printf '%s\n' "set -uo pipefail" ". '$LIB/common.sh'" ". '$LIB/caddy.sh'" ". '$LIB/updates.sh'" "$body" >"$tmp/s.sh"
  bash "$tmp/s.sh" >"$tmp/out" 2>"$tmp/err" </dev/null
}

echo "== publication (K-P1 à K-P5)"
mkdir -p "$tmp/vide"
run "updates_publish '$tmp/vide'"; rc=$?
check "K-P1 : dossier sans latest.yml : refus (code 2)" test "$rc" -eq 2
check "K-P1 : et rien n'est publié" test ! -e "$DEST/latest.yml"

mkdir -p "$tmp/absent"
printf 'version: 0.9.0\nfiles:\n  - url: Absent-0.9.0.exe\n' >"$tmp/absent/latest.yml"
run "updates_publish '$tmp/absent'"; rc=$?
check "K-P2 : fichier référencé absent : refus (code 2)" test "$rc" -eq 2
check "K-P2 : et rien n'est publié" test ! -e "$DEST/latest.yml"

run "updates_publish '$tmp/rel1'"; rc=$?
check "K-P3 : publication valide (0.3.0) : code 0" test "$rc" -eq 0
check "K-P3 : installeur publié" test -f "$DEST/Polenta-Setup-0.3.0.exe"
check "K-P3 : blockmap publié" test -f "$DEST/Polenta-Setup-0.3.0.exe.blockmap"
check "K-P3 : latest.yml publié, identique à la source" cmp -s "$tmp/rel1/latest.yml" "$DEST/latest.yml"
check "K-P3 : aucun fichier caché restant" bash -c "! ls -A '$DEST' | grep -q '^\\.'"

run "updates_publish '$tmp/rel1'"; rc=$?
check "K-P4 : même version déjà présente : refus, code 2" test "$rc" -eq 2
check "K-P4 : le message dit que rien n'a été écrit" bash -c "grep -q 'rien n.a été écrit' '$tmp/err'"

echo "== échec pendant la copie (K-P5)"
make_release "$tmp/rel3" 0.5.0
printf 'version: 0.5.0\nfiles:\n  - url: Polenta-Setup-0.5.0.exe\n  - url: Autre-0.5.0.exe\n' >"$tmp/rel3/latest.yml"
printf 'autre' >"$tmp/rel3/Autre-0.5.0.exe"
run "cp() { if [[ \"\$2\" == *Polenta-Setup-0.5.0.exe.part ]]; then return 1; fi; command cp \"\$@\"; }; updates_publish '$tmp/rel3'"; rc=$?
check "K-P5 : copie en échec : code non nul" test "$rc" -ne 0
check "K-P5 : latest.yml inchangé (toujours celui de 0.3.0)" cmp -s "$tmp/rel1/latest.yml" "$DEST/latest.yml"
check "K-P5 : la version 0.5.0 n'est pas référencée" bash -c "! grep -q '0.5.0' '$DEST/latest.yml'"
check "K-P5 : aucun fichier .part laissé" bash -c "! ls -A '$DEST' | grep -q '\\.part$'"

echo "== mode external (K-P6)"
run "CADDY_MODE=external; updates_publish '$tmp/rel2'"; rc=$?
check "K-P6 : publication refusée en external (code 2)" test "$rc" -eq 2
check "K-P6 : aucun fichier publié en external" test ! -e "$tmp/root/caddy/etc/updates/Polenta-Setup-0.4.0.exe"

echo "== route Caddy (K-R1)"
TAB=$'\t'
run "caddy_render_site acc acc.example.fr"
check "K-R1 : le bloc contient handle_path /polenta-updates/*" grep -q "^${TAB}handle_path /polenta-updates/\\* {\$" "$tmp/out"
check "K-R1 : racine du dossier publié dans le conteneur" grep -q "^${TAB}${TAB}root \\* /etc/caddy/updates\$" "$tmp/out"
check "K-R1 : la route est avant reverse_proxy de la forge" bash -c "awk '/handle_path/{h=NR} /reverse_proxy/{r=NR} END{exit !(h && r && h<r)}' '$tmp/out'"

if [[ $FAIL -eq 0 ]]; then printf '\nToutes les vérifications passent.\n'; else printf '\nDes vérifications échouent.\n' >&2; fi
exit "$FAIL"
