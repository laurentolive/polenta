#!/usr/bin/env bash
# GH63 Sprint 1 — réglages d'administration de host.env (ADMIN_UI, ADMIN_INSTANCE,
# ADMIN_AGENT_SOCKET), jeton de service par instance, forge-versions.json. Hôte simulé, fonctions
# de polenta-host.sh chargées sans exécuter de commande. Lancé en root dans un conteneur jetable.
#
#   deploy/tests/host-admin-env.test.sh
# shellcheck disable=SC2016,SC2329,SC1090,SC2034  # fonctions et variables du kit chargé dynamiquement
set -uo pipefail

[[ $EUID -eq 0 ]] || { echo "à lancer en root (conteneur de test)" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAIL=0
pass() { printf '  \e[32m✓\e[0m %s\n' "$*"; }
fail() { printf '  \e[31m✗\e[0m %s\n' "$*"; FAIL=1; }
check() { local msg="$1"; shift; if "$@"; then pass "$msg"; else fail "$msg"; fi; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cp -r "$here/.." "$tmp/kit"
# Copie du kit sans l'appel final à main : les fonctions sont chargées, rien n'est exécuté.
sed '$d' "$tmp/kit/polenta-host.sh" >"$tmp/kit/polenta-host-lib.sh"
export POLENTA_ROOT="$tmp/root" POLENTA_LOG_DIR="$tmp/log"
mkdir -p "$POLENTA_ROOT/instances/acme" "$tmp/bin"
printf 'DOMAIN=acme-forge.exemple.fr\nORG=acme\n' >"$POLENTA_ROOT/instances/acme/instance.env"
for c in docker systemctl; do printf '#!/usr/bin/env bash\nexit 1\n' >"$tmp/bin/$c"; chmod +x "$tmp/bin/$c"; done
export PATH="$tmp/bin:$PATH"

hostenv() { printf 'HARDEN_HOST=none\nCADDY_MODE=external\n%s\n' "$1" >"$POLENTA_ROOT/host.env"; }
inlib() { bash -c ". '$tmp/kit/polenta-host-lib.sh'; $1" >"$tmp/out" 2>"$tmp/err" </dev/null; }

echo "== host.env : ADMIN_*"
hostenv ""
inlib 'load_host_env; echo "$ADMIN_UI|$ADMIN_INSTANCE|$ADMIN_AGENT_SOCKET"'; RC=$?
check "défauts : off, sans instance d'exploitation, socket /run/polenta/agent.sock" test "$(cat "$tmp/out")" = "off||/run/polenta/agent.sock"
hostenv $'ADMIN_UI=on\nADMIN_INSTANCE=ops'
inlib 'load_host_env; echo "$ADMIN_UI|$ADMIN_INSTANCE"'
check "ADMIN_UI=on, ADMIN_INSTANCE=ops lus" test "$(cat "$tmp/out")" = "on|ops"
hostenv 'ADMIN_UI=oui'
inlib 'load_host_env'; RC=$?
check "ADMIN_UI=oui refusé, message explicite" bash -c "[[ $RC != 0 ]] && grep -q 'ADMIN_UI « oui » invalide' '$tmp/err'"
hostenv 'ADMIN_INSTANCE=Pas Bon'
inlib 'load_host_env'; RC=$?
check "ADMIN_INSTANCE invalide refusé" test "$RC" -ne 0
hostenv 'ADMIN_AGENT_SOCKET=relatif.sock'
inlib 'load_host_env'; RC=$?
check "ADMIN_AGENT_SOCKET relatif refusé" test "$RC" -ne 0

echo "== Jeton de service"
hostenv ""
inlib 'load_host_env; ensure_service_token acme'; RC=$?
tok="$(sed -n 's/^ADMIN_SERVICE_TOKEN=//p' "$POLENTA_ROOT/instances/acme/instance.env")"
check "créé : sortie 0, jeton de 43 caractères dans instance.env" bash -c "[[ $RC == 0 && ${#tok} == 43 ]]"
check "service-tokens.json : empreinte SHA-256 du jeton" \
  test "$(jq -r .acme.sha256 "$POLENTA_ROOT/admin/service-tokens.json")" = "$(printf '%s' "$tok" | sha256sum | cut -d' ' -f1)"
check "service-tokens.json : jeton jamais en clair" bash -c "! grep -q '$tok' '$POLENTA_ROOT/admin/service-tokens.json'"
check "service-tokens.json en 600, dossier en 700" bash -c "[[ \$(stat -c %a '$POLENTA_ROOT/admin/service-tokens.json') == 600 && \$(stat -c %a '$POLENTA_ROOT/admin') == 700 ]]"
inlib 'load_host_env; ensure_service_token acme'
tok2="$(sed -n 's/^ADMIN_SERVICE_TOKEN=//p' "$POLENTA_ROOT/instances/acme/instance.env")"
check "rejoué : jeton conservé (idempotent)" test "$tok" = "$tok2"
inlib 'load_host_env; forget_service_token acme'
check "instance supprimée : empreinte retirée" test "$(jq -c . "$POLENTA_ROOT/admin/service-tokens.json")" = '{}'

echo "== forge-versions.json"
check "JSON valide, défaut présent dans la liste, jamais latest" \
  jq -e '(.default as $d | .versions | map(.version) | index($d)) != null and (.versions | map(.version) | index("latest")) == null' "$here/../forge-versions.json"
inlib 'echo "$DEFAULT_FORGE_VERSION"'
check "défaut aligné sur DEFAULT_FORGE_VERSION du kit" test "$(cat "$tmp/out")" = "$(jq -r .default "$here/../forge-versions.json")"

exit $FAIL
