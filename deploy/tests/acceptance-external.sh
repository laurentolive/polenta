#!/usr/bin/env bash
# GH61 — scénario d'acceptation du mode CADDY_MODE=external, lancé SUR L'HÔTE (root) : critères 2 à 6
# de specs/GH61.md (critère 12). Hôte attendu : kit installé, host.env en CADDY_MODE=external,
# EDGE_NETWORK existant, un Caddy tiers (ou un simple listener) éventuellement déjà en place.
#
#   sudo deploy/tests/acceptance-external.sh <domaine-instance-test> [options]
#
#   --web-domain <d> --web-version <v> [--web-image <i>]   joue aussi « instance web enable/disable »
#                                  (image du client web requise sur l'hôte ou sur un registre)
#   --name <nom>                   nom de l'instance de test (défaut : accext)
#   --no-setup                     ne relance pas « polenta-host setup » (défaut : relancé, rejouable)
#
# L'instance de test est créée puis supprimée (trap, y compris en cas d'écart) ; un Caddy d'essai
# éphémère (sans port publié, tls interne) importe les blocs pour prouver le routage. Image de sonde
# HTTP : ACC_CURL_IMAGE (défaut curlimages/curl:8.10.1). Sortie non nulle au PREMIER écart.
set -uo pipefail

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
[[ $# -gt 0 && "$1" != -h && "$1" != --help ]] || usage

DOMAIN="$1"; shift
NAME=accext; WEB_DOMAIN=""; WEB_VERSION=""; WEB_IMAGE=""; RUN_SETUP=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --web-domain) WEB_DOMAIN="${2:-}"; shift 2 ;;
    --web-version) WEB_VERSION="${2:-}"; shift 2 ;;
    --web-image) WEB_IMAGE="${2:-}"; shift 2 ;;
    --name) NAME="${2:-}"; shift 2 ;;
    --no-setup) RUN_SETUP=0; shift ;;
    *) echo "option inconnue : $1" >&2; usage ;;
  esac
done
if [[ -n "$WEB_DOMAIN" && -z "$WEB_VERSION" ]] || [[ -z "$WEB_DOMAIN" && -n "$WEB_VERSION" ]]; then
  echo "--web-domain et --web-version vont ensemble." >&2; exit 2
fi
[[ "$NAME" =~ ^[a-z0-9][a-z0-9-]{1,30}$ ]] || { echo "nom d'instance invalide : $NAME" >&2; exit 2; }
[[ $EUID -eq 0 ]] || { echo "à lancer en root (sudo $0 …)." >&2; exit 2; }

ROOT="${POLENTA_ROOT:-/opt/polenta}"
HOST_ENV="$ROOT/host.env"
HOST_BIN="${POLENTA_HOST_BIN:-polenta-host}"
KIT_LIB="$ROOT/kit/lib"
CURL_IMAGE="${ACC_CURL_IMAGE:-curlimages/curl:8.10.1}"
TIERS="polenta-acc-tiers-$NAME"
WORK="$(mktemp -d)"
EVENTS_PID=""; CREATED=0; STEP=""

pass() { printf '  \e[32m✓\e[0m %s\n' "$*"; }
# Premier écart : message, puis sortie non nulle (le trap EXIT nettoie).
fail() { printf '  \e[31m✗\e[0m %s\n' "$*" >&2; exit 1; }
check() { local msg="$1"; shift; if "$@"; then pass "$msg"; else fail "$msg"; fi; }
section() { STEP="$1"; printf '== %s\n' "$1"; }

# Valeur d'une clé de host.env (dernière occurrence), sinon le défaut $2.
hv() {
  local v; v="$(grep -E "^$1=" "$HOST_ENV" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d "\"'")"
  printf '%s' "${v:-$2}"
}
listeners() { ss -ltnH 2>/dev/null | awk '{print $4}' | grep -E ':(80|443)$' | sort; }
ufw_web_rules() { ufw status 2>/dev/null | grep -E '^(80|443)([/ ]|$)' | sort; }
tiers_sums() { ( cd "$SITES" 2>/dev/null && find . -maxdepth 1 -name '_*.caddy' -type f -exec sha256sum {} + | sort -k2 ); }
no_kit_caddy() { [[ -z "$(docker ps -a --filter name='^polenta-caddy$' -q)" ]]; }
nets_of() { docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$1"; }
has_word() { grep -qw -- "$1" <<<"$2"; }

cleanup() {
  local rc=$?
  set +e
  [[ -z "$EVENTS_PID" ]] || kill "$EVENTS_PID" 2>/dev/null
  docker rm -f "$TIERS" >/dev/null 2>&1
  if [[ $CREATED == 1 ]]; then
    [[ -z "$WEB_DOMAIN" ]] || "$HOST_BIN" instance web disable "$NAME" >/dev/null 2>&1
    "$HOST_BIN" instance remove "$NAME" --confirm "$NAME" >/dev/null 2>&1
    rm -f "$ROOT/exports/$NAME"-* 2>/dev/null
  fi
  rm -rf "$WORK"
  if [[ $rc != 0 ]]; then printf '\n\e[31mÉchec à l'\''étape « %s » : instance de test nettoyée.\e[0m\n' "$STEP" >&2; fi
}
trap cleanup EXIT

CADDY_MODE_NOW="$(hv CADDY_MODE managed)"
EDGE="$(hv EDGE_NETWORK polenta-edge)"
SITES="$(hv CADDY_SITES_DIR /opt/polenta/caddy-sites)"
CADDY_VERSION_NOW="$(hv CADDY_VERSION 2)"

# ── préconditions ────────────────────────────────────────────────────────────────────────────
section "préconditions"
check "host.env en CADDY_MODE=external" test "$CADDY_MODE_NOW" = external
check "réseau $EDGE présent" docker network inspect "$EDGE"
check "instance « $NAME » absente (nom libre)" test ! -e "$ROOT/instances/$NAME"
# Empreintes avant : pare-feu, listeners 80/443 tiers, fichiers _*.caddy d'autres projets.
UFW_BEFORE="$(ufw_web_rules)"; LISTEN_BEFORE="$(listeners)"; TIERS_SUMS="$(tiers_sums)"
docker events --filter type=network --filter event=connect \
  --format '{{.Actor.Attributes.name}} {{.Actor.Attributes.container}}' >"$WORK/connects.log" 2>/dev/null &
EVENTS_PID=$!

# ── critère 3 : setup ne touche pas à 80/443 ─────────────────────────────────────────────────
if [[ $RUN_SETUP == 1 ]]; then
  section "setup en external (critères 2 et 3)"
  "$HOST_BIN" setup >"$WORK/setup.log" 2>&1 || { tail -n 40 "$WORK/setup.log" >&2; fail "polenta-host setup a échoué"; }
  check "règles ufw 80/443 identiques avant/après setup" test "$UFW_BEFORE" = "$(ufw_web_rules)"
  check "listeners 80/443 tiers inchangés" test "$LISTEN_BEFORE" = "$(listeners)"
fi

# ── critère 2 : aucun Caddy du kit ───────────────────────────────────────────────────────────
section "aucun conteneur Caddy du kit (critère 2)"
check "aucun conteneur polenta-caddy (docker ps -a)" no_kit_caddy
check "$ROOT/caddy absent" test ! -e "$ROOT/caddy"

# ── instance de test ─────────────────────────────────────────────────────────────────────────
section "instance add (blocs de site, critère 4)"
CREATED=1
"$HOST_BIN" instance add "$NAME" --domain "$DOMAIN" --no-demo --yes >"$WORK/add.log" 2>&1 \
  || { tail -n 40 "$WORK/add.log" >&2; fail "instance add a échoué"; }
check "bloc $SITES/$NAME.caddy présent" test -f "$SITES/$NAME.caddy"
# Contenu attendu : rendu des fonctions du kit (identiques à celles du mode managed).
expected_forge="$( ( export POLENTA_ROOT="$ROOT"; . "$KIT_LIB/common.sh"; . "$KIT_LIB/caddy.sh"; caddy_render_site "$NAME" "$DOMAIN" ) )"
check "bloc forge identique au rendu managed (octet pour octet)" test "$(cat "$SITES/$NAME.caddy")" = "$expected_forge"
check "aucun conteneur polenta-caddy après instance add" no_kit_caddy

# ── critère 6 : réseaux de la forge ──────────────────────────────────────────────────────────
section "réseaux de la forge (critère 6)"
nets="$(nets_of "forgejo-$NAME")"
check "forgejo-$NAME sur polenta-$NAME" has_word "polenta-$NAME" "$nets"
check "forgejo-$NAME sur $EDGE" has_word "$EDGE" "$nets"

# ── critère 5 : routage par un Caddy tiers ───────────────────────────────────────────────────
section "routage via un Caddy tiers d'essai (critère 5)"
# Les blocs du kit ne portent pas « tls internal » : local_certs l'applique à tous les sites.
printf '{\n\tlocal_certs\n\tauto_https disable_redirects\n}\n\nimport /sites/*.caddy\n' >"$WORK/Caddyfile"
docker run -d --name "$TIERS" --network "$EDGE" -v "$SITES:/sites:ro" -v "$WORK/Caddyfile:/etc/caddy/Caddyfile:ro" \
  "caddy:$CADDY_VERSION_NOW" >/dev/null || fail "Caddy d'essai non démarré (image caddy:$CADDY_VERSION_NOW)"
tiers_ip="$(docker inspect -f "{{(index .NetworkSettings.Networks \"$EDGE\").IPAddress}}" "$TIERS")"
code=000
for _ in $(seq 1 24); do   # 2 minutes : démarrage de la forge + émission du certificat interne
  code="$(docker run --rm --network "$EDGE" "$CURL_IMAGE" -ksS -o /dev/null -w '%{http_code}' --max-time 10 \
    --resolve "$DOMAIN:443:$tiers_ip" "https://$DOMAIN/api/healthz" 2>/dev/null)"
  [[ "$code" == 200 ]] && break
  sleep 5
done
check "https://$DOMAIN/api/healthz → 200 via le Caddy tiers (reçu : $code)" test "$code" = 200

# ── client web (facultatif) ──────────────────────────────────────────────────────────────────
if [[ -n "$WEB_DOMAIN" ]]; then
  section "web enable / disable (critères 2, 4, 6)"
  web_args=(--domain "$WEB_DOMAIN" --version "$WEB_VERSION")
  [[ -z "$WEB_IMAGE" ]] || web_args+=(--image "$WEB_IMAGE")
  "$HOST_BIN" instance web enable "$NAME" "${web_args[@]}" >"$WORK/web.log" 2>&1 \
    || { tail -n 40 "$WORK/web.log" >&2; fail "instance web enable a échoué"; }
  check "bloc $SITES/$NAME.web.caddy présent" test -f "$SITES/$NAME.web.caddy"
  expected_web="$( ( export POLENTA_ROOT="$ROOT"; . "$KIT_LIB/common.sh"; . "$KIT_LIB/caddy.sh"; caddy_render_web_site "$NAME" "$WEB_DOMAIN" ) )"
  check "bloc web identique au rendu managed (octet pour octet)" test "$(cat "$SITES/$NAME.web.caddy")" = "$expected_web"
  wnets="$(nets_of "polenta-web-$NAME")"
  check "polenta-web-$NAME sur polenta-$NAME" has_word "polenta-$NAME" "$wnets"
  check "polenta-web-$NAME sur $EDGE" has_word "$EDGE" "$wnets"
  check "aucun conteneur polenta-caddy après web enable" no_kit_caddy
  "$HOST_BIN" instance web disable "$NAME" >"$WORK/webd.log" 2>&1 \
    || { tail -n 20 "$WORK/webd.log" >&2; fail "instance web disable a échoué"; }
  check "bloc $NAME.web.caddy supprimé par web disable" test ! -e "$SITES/$NAME.web.caddy"
  check "bloc forge conservé après web disable" test -f "$SITES/$NAME.caddy"
fi

# ── aucun docker network connect vers un Caddy (critère 6) ───────────────────────────────────
section "aucun rattachement de Caddy aux réseaux d'instance (critère 6)"
sleep 1
bad="$(awk -v n="polenta-$NAME" -v f="forgejo-$NAME" -v w="polenta-web-$NAME" \
  '$1 == n && $2 != f && $2 != w { print }' "$WORK/connects.log")"
check "seuls forgejo-$NAME / polenta-web-$NAME ont rejoint polenta-$NAME (autres : ${bad:-aucun})" test -z "$bad"
members="$(docker network inspect -f '{{range .Containers}}{{.Name}} {{end}}' "polenta-$NAME")"
check "aucun conteneur Caddy sur polenta-$NAME" test -z "$(tr ' ' '\n' <<<"$members" | grep -i caddy)"

# ── suppression ──────────────────────────────────────────────────────────────────────────────
section "instance remove (critère 4)"
docker rm -f "$TIERS" >/dev/null 2>&1
"$HOST_BIN" instance remove "$NAME" --confirm "$NAME" >"$WORK/rm.log" 2>&1 \
  || { tail -n 20 "$WORK/rm.log" >&2; fail "instance remove a échoué"; }
CREATED=0; rm -f "$ROOT/exports/$NAME"-* 2>/dev/null
check "blocs $NAME.caddy et $NAME.web.caddy supprimés" test ! -e "$SITES/$NAME.caddy" -a ! -e "$SITES/$NAME.web.caddy"
check "fichiers _*.caddy d'autres projets : empreintes inchangées" test "$TIERS_SUMS" = "$(tiers_sums)"
check "règles ufw 80/443 inchangées sur l'ensemble du scénario" test "$UFW_BEFORE" = "$(ufw_web_rules)"
check "listeners 80/443 tiers inchangés sur l'ensemble du scénario" test "$LISTEN_BEFORE" = "$(listeners)"
check "toujours aucun conteneur polenta-caddy" no_kit_caddy

printf '\nToutes les vérifications passent.\n'
exit 0
