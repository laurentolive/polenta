#!/usr/bin/env bash
# GH53 sprint 2 — certificat fourni (instance add --tls-cert/--tls-key) : contrôle, rendu du bloc Caddy,
# copie et suppression de la copie dans etc/tls/. Sans root ni Docker : POLENTA_ROOT est temporaire,
# les fonctions de deploy/lib sont sourcées dans des sous-shells. Nécessite openssl.
#
#   deploy/tests/caddy-tls.test.sh          (specs/GH53-tests.md, scénarios T-K1 à T-K9)
# shellcheck disable=SC2016,SC2329  # corps de scripts passés en chaînes ; fonctions appelées via check
set -uo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash : ne pas réécrire les sujets « /CN=… » d'openssl

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$here/../lib"
FAIL=0
pass() { printf '  \e[32m✓\e[0m %s\n' "$*"; }
fail() { printf '  \e[31m✗\e[0m %s\n' "$*"; FAIL=1; }
check() { local msg="$1"; shift; if "$@"; then pass "$msg"; else fail "$msg"; fi; }

command -v openssl >/dev/null || { echo "openssl requis" >&2; exit 2; }
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
# Git Bash : l'openssl natif ne lit pas les chemins /tmp/… ; chemin Windows pour lui (sans effet ailleurs).
if command -v cygpath >/dev/null 2>&1; then tmp="$(cygpath -m "$tmp")"; fi
export POLENTA_ROOT="$tmp/root"
mkdir -p "$POLENTA_ROOT/instances/acc" "$POLENTA_ROOT/caddy/etc"
printf 'CADDY_MODE=managed\nHARDEN_HOST=none\n' >"$POLENTA_ROOT/host.env"
printf 'DOMAIN=acc.example.fr\nINSTANCE_NAME=acc\n' >"$POLENTA_ROOT/instances/acc/instance.env"

# Paire de test (certificat + clé non chiffrée) et une seconde clé, pour le cas « ne correspondent pas ».
make_pair() { # base cn
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$tmp/$1.key" -out "$tmp/$1.pem" -days 30 -subj "/CN=$2" >/dev/null 2>&1
}
make_pair pair acc.example.fr
make_pair other other.example.fr

# Exécute un corps de script qui source common.sh puis caddy.sh ; renvoie son code de sortie.
run() {
  local body="$1"
  printf '%s\n' "set -uo pipefail" ". '$LIB/common.sh'" ". '$LIB/caddy.sh'" "$body" >"$tmp/s.sh"
  bash "$tmp/s.sh" >"$tmp/out" 2>"$tmp/err" </dev/null
}

echo "== contrôle du certificat fourni (T-K1 à T-K3, T-K9)"
run 'tls_check "" "'"$tmp/pair.key"'"'
check "T-K1 : --tls-cert sans --tls-key : refus (code 2)" test "$?" -eq 2
run 'tls_check "'"$tmp/other.pem"'" "'"$tmp/pair.key"'"'
check "T-K2 : certificat et clé qui ne correspondent pas : refus" bash -c "[[ \$(cat '$tmp/err') == *'ne correspondent pas'* ]]"
run 'tls_check "'"$tmp/pair.key"'" "'"$tmp/pair.pem"'"'
check "T-K3 : fichiers inversés (clé donnée comme certificat) : refus" test "$?" -eq 2
run 'tls_check "'"$tmp/pair.pem"'" "'"$tmp/pair.key"'"'
check "T-K4 : paire valide : accepté" test "$?" -eq 0
printf 'CADDY_MODE=external\n' >"$tmp/ext.env"
run 'HOST_ENV=/dev/null; CADDY_MODE=external; tls_check "'"$tmp/pair.pem"'" "'"$tmp/pair.key"'"'
check "T-K9 : --tls-cert en CADDY_MODE=external : refus explicite" bash -c "[[ \$(cat '$tmp/err') == *'relève du Caddy de l'*  ]]"

echo "== rendu du bloc Caddy (T-K5, T-K6)"
run 'caddy_render_site acc acc.example.fr'
check "T-K6 : instance sans certificat fourni : aucune ligne tls, bloc inchangé" bash -c "! grep -q '^	tls ' '$tmp/out' && sed -n 2p '$tmp/out' | grep -qx 'acc.example.fr {'"
check "T-K6 : la ligne suivante est encode (bloc sans ligne ajoutée)" bash -c "sed -n 3p '$tmp/out' | grep -qx '	encode zstd gzip'"
echo "TLS_PROVIDED=1" >>"$POLENTA_ROOT/instances/acc/instance.env"
run 'caddy_render_site acc acc.example.fr'
check "T-K5 : instance avec certificat fourni : ligne tls vers /etc/caddy/tls/acc/" bash -c "grep -qx '	tls /etc/caddy/tls/acc/cert.pem /etc/caddy/tls/acc/key.pem' '$tmp/out'"
check "T-K5 : la ligne tls est juste après l'ouverture du bloc" bash -c "sed -n 3p '$tmp/out' | grep -q '^	tls '"

echo "== copie et suppression (T-K7, T-K8)"
mkdir -p "$POLENTA_ROOT/instances/acc/tls"
cp "$tmp/pair.pem" "$POLENTA_ROOT/instances/acc/tls/cert.pem"
cp "$tmp/pair.key" "$POLENTA_ROOT/instances/acc/tls/key.pem"
chmod 600 "$POLENTA_ROOT/instances/acc/tls/key.pem"
run 'caddy_sync_tls acc'
check "T-K7 : certificat copié dans etc/tls/acc/" test -f "$POLENTA_ROOT/caddy/etc/tls/acc/cert.pem"
if command -v cygpath >/dev/null 2>&1; then
  printf '  - T-K7 : droits 600 de la clé non vérifiables sous Windows (NTFS) ; à contrôler sur l'\''hôte Linux\n'
else
  check "T-K7 : clé copiée avec droits 600" bash -c "[[ \$(stat -c %a '$POLENTA_ROOT/caddy/etc/tls/acc/key.pem') == 600 ]]"
fi
run 'site_remove() { :; }; caddy_disconnect_network() { :; }; caddy_write_compose() { :; }; caddy_remove_site acc'
check "T-K8 : suppression de l'instance retire la copie etc/tls/acc/" test ! -e "$POLENTA_ROOT/caddy/etc/tls/acc"
check "T-K8 : la source (instances/acc/tls) reste jusqu'à la suppression de l'instance" test -f "$POLENTA_ROOT/instances/acc/tls/key.pem"

if [[ $FAIL -eq 0 ]]; then printf '\nToutes les vérifications passent.\n'; else printf '\nDes vérifications échouent.\n' >&2; fi
exit "$FAIL"
