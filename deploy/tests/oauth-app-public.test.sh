#!/usr/bin/env bash
# GH51 — `polenta-admin oauth-app create --public` (AC12) : client OAuth public, sans secret ; sans
# l'option, comportement inchangé (client confidentiel). La forge est simulée par une doublure de
# curl qui enregistre le corps envoyé. Lancé en root dans un conteneur jetable (Debian 13 + jq).
#
#   deploy/tests/oauth-app-public.test.sh
# shellcheck disable=SC2016,SC2329  # doublures écrites en chaînes ; fonctions appelées via check
set -uo pipefail

[[ $EUID -eq 0 ]] || { echo "à lancer en root (conteneur de test)" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADMINSH="$here/../polenta-admin.sh"
FAIL=0
pass() { printf '  \e[32m✓\e[0m %s\n' "$*"; }
fail() { printf '  \e[31m✗\e[0m %s\n' "$*"; FAIL=1; }
check() { local msg="$1"; shift; if "$@"; then pass "$msg"; else fail "$msg"; fi; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
export POLENTA_ROOT="$tmp/root" POLENTA_LOG_DIR="$tmp/log" FORGE_LOG="$tmp/forge.log" BODY_LOG="$tmp/body.log"
mkdir -p "$tmp/bin" "$POLENTA_ROOT/instances/acme"
printf 'HARDEN_HOST=none\nCADDY_MODE=managed\nPOLENTA_DOWNLOAD_URL=https://exemple.fr/polenta\n' >"$POLENTA_ROOT/host.env"
printf 'DOMAIN=acme-forge.exemple.fr\nORG=acme\nOPS_TOKEN=SENTINEL-ops-token\n' >"$POLENTA_ROOT/instances/acme/instance.env"
touch "$POLENTA_ROOT/instances/acme/.add-complete"

# Doublure de la forge : enregistre le corps de la requête ; -o <fichier> reçoit la réponse, le code HTTP sur stdout.
cat >"$tmp/bin/curl" <<'EOF'
#!/usr/bin/env bash
out=/dev/null method=GET url="" data=""
while (($#)); do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -X) method="$2"; shift 2 ;;
    --data) data="$2"; shift 2 ;;
    -w|-H|--connect-timeout|--max-time|--resolve) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
path="${url#*/api/v1}"; path="${path%%\?*}"
echo "$method $path" >>"$FORGE_LOG"
reply() { printf '%s' "$2" >"$out"; printf '%s' "$1"; exit 0; }
case "$method $path" in
  "POST /user/applications/oauth2")
    printf '%s' "$data" >>"$BODY_LOG"
    if [[ "$data" == *'"confidential_client":false'* ]]; then
      reply 201 '{"client_id":"cid-public","name":"polenta","confidential_client":false}'
    else
      reply 201 '{"client_id":"cid-conf","client_secret":"SECRET-ne-doit-pas-fuiter-en-public","name":"polenta"}'
    fi ;;
  *) reply 404 '{"message":"non simulé"}' ;;
esac
EOF
chmod +x "$tmp/bin/curl"
for c in docker systemctl; do printf '#!/usr/bin/env bash\nexit 1\n' >"$tmp/bin/$c"; chmod +x "$tmp/bin/$c"; done
export PATH="$tmp/bin:$PATH"

run() { : >"$FORGE_LOG"; : >"$BODY_LOG"; bash "$ADMINSH" "$@" >"$tmp/out" 2>"$tmp/err" </dev/null; }

echo "== oauth-app create --public (GH51, AC12)"
run --instance acme oauth-app create --public polenta "http://127.0.0.1/"; RC=$?
check "public : sortie 0" test "$RC" -eq 0
check "public : corps envoyé avec confidential_client:false" grep -q '"confidential_client":false' "$BODY_LOG"
check "public : client_id affiché" grep -q 'cid-public' "$tmp/out"
check "public : aucun secret affiché" bash -c "! grep -q 'SECRET-ne-doit-pas-fuiter' '$tmp/out'"
check "public : aucune mention de client_secret" bash -c "! grep -q 'client_secret' '$tmp/out'"

echo "== oauth-app create sans --public (inchangé)"
run --instance acme oauth-app create polenta "https://forge.exemple.fr/callback"; RC=$?
check "confidentiel : sortie 0" test "$RC" -eq 0
check "confidentiel : corps envoyé avec confidential_client:true" grep -q '"confidential_client":true' "$BODY_LOG"
check "confidentiel : secret affiché une seule fois" grep -q 'client_secret' "$tmp/out"

echo "== usage : --public sans nom ni redirection"
run --instance acme oauth-app create --public; RC=$?
check "usage : sortie non nulle, aucun appel à la forge" bash -c "[[ $RC -ne 0 ]] && [[ ! -s '$FORGE_LOG' ]]"

exit "$FAIL"
