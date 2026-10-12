#!/usr/bin/env bash
# GH61 — tests simulés du noyau « Caddy optionnel » (specs/GH61-tests.md, sprint 1) : validation de
# configuration, rendu des fichiers, blocs de site et rechargement, garde-fous. Sans Docker, sans
# ufw, sans root : `docker` est simulé par une fonction, les fichiers vont dans un dossier
# temporaire. Ne remplace PAS les scénarios sur un hôte Debian/Ubuntu jetable (compose, ufw,
# routage réel).
#
#   deploy/tests/caddy-external.test.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
kit="$here/.."
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
FAIL=0
pass() { printf '  \e[32m✓\e[0m %s\n' "$*"; }
fail() { printf '  \e[31m✗\e[0m %s\n' "$*"; FAIL=1; }
check() { local msg="$1"; shift; if "$@"; then pass "$msg"; else fail "$msg"; fi; }

# Charge common.sh + caddy.sh avec un POLENTA_ROOT temporaire et un host.env donné ($1 = contenu).
# Utilisable uniquement dans un sous-shell ( … ).
load_kit() {
  export POLENTA_ROOT="$tmp/root"; export POLENTA_LOG_DIR="$tmp/log"
  mkdir -p "$POLENTA_ROOT"; printf '%s\n' "$1" >"$POLENTA_ROOT/host.env"
  # shellcheck source=../lib/common.sh
  . "$kit/lib/common.sh"
  # shellcheck source=../lib/caddy.sh
  . "$kit/lib/caddy.sh"
  load_host_env
}

# ── S1-4 à S1-7 : validation de configuration (critère 9) ────────────────────────────────────
echo "== validation de configuration"
for case in 'CADDY_MODE=foo|CADDY_MODE|managed|external' \
            "EDGE_NETWORK=a b|EDGE_NETWORK|a-zA-Z0-9" \
            'EDGE_NETWORK=-x|EDGE_NETWORK|a-zA-Z0-9' \
            'CADDY_MODE=external
CADDY_SITES_DIR=relatif|chemin absolu|CADDY_SITES_DIR'; do
  conf="${case%%|*}"; rest="${case#*|}"
  out="$( ( load_kit "$conf" ) 2>&1 )"; rc=$?
  ok=1; [[ $rc -ne 0 ]] || ok=0
  IFS='|' read -ra want <<<"$rest"
  for w in "${want[@]}"; do grep -qF -- "$w" <<<"$out" || ok=0; done
  check "refus de « ${conf//$'\n'/ ; } » (rc=$rc)" test $ok = 1
done
out="$( ( load_kit 'ACME_EMAIL=a@b.c' && echo "$CADDY_MODE $EDGE_NETWORK $CADDY_SITES_DIR [$CADDY_RELOAD_CMD]" ) 2>&1 )"
check "défauts sans nouvelle clé : $out" test "$out" = "managed polenta-edge /opt/polenta/caddy-sites []"

# ── critère 1 : rendu managed identique à celui de main ──────────────────────────────────────
echo "== managed : rendu identique à main"
base="$(git -C "$kit/.." rev-parse --verify -q origin/main || git -C "$kit/.." rev-parse --verify -q main || true)"
if [[ -n "$base" ]]; then
  mkdir -p "$tmp/base"; git -C "$kit/.." show "$base:deploy/lib/caddy.sh" >"$tmp/base/caddy.sh"
  render_all() { # $1 = caddy.sh à charger
    ( load_kit 'ACME_EMAIL=ops@example.fr' >/dev/null
      # shellcheck disable=SC1090
      . "$1"
      docker() { return 1; }   # aucun réseau d'instance
      list_instances() { :; }
      caddy_render_compose; echo ---; caddy_render_caddyfile; echo ---
      caddy_render_site t1 forge.example.fr; echo ---; caddy_render_web_site t1 web.example.fr )
  }
  render_all "$tmp/base/caddy.sh" >"$tmp/avant.txt" 2>&1
  render_all "$kit/lib/caddy.sh" >"$tmp/apres.txt" 2>&1
  check "compose, Caddyfile et blocs de site managed : diff vide ($base)" cmp -s "$tmp/avant.txt" "$tmp/apres.txt"
  check "le rendu n'est pas vide" test -s "$tmp/apres.txt"
else
  echo "  (référence main introuvable : comparaison sautée)"
fi

# ── external : blocs de site, rechargement (critères 4, 8) ───────────────────────────────────
echo "== external : blocs de site et rechargement"
sites="$tmp/sites"; mkdir -p "$sites"; printf 'vitrine.example.fr {\n}\n' >"$sites/_vitrine.caddy"
vit_sum="$(sha256sum "$sites/_vitrine.caddy")"
ext_conf() { printf 'CADDY_MODE=external\nCADDY_SITES_DIR=%s\nCADDY_RELOAD_CMD=%s\n' "$sites" "$1"; }

( load_kit "$(ext_conf "echo x >>$tmp/reload.count")" >/dev/null
  caddy_add_site t1 forge.example.fr >/dev/null; caddy_add_site t1 forge.example.fr >/dev/null
  caddy_add_web_site t1 web.example.fr >/dev/null )
check "blocs t1.caddy et t1.web.caddy écrits dans CADDY_SITES_DIR" test -f "$sites/t1.caddy" -a -f "$sites/t1.web.caddy"
check "contenu forge identique au rendu managed" test "$(cat "$sites/t1.caddy")" = "$( ( load_kit 'ACME_EMAIL=x' >/dev/null; caddy_render_site t1 forge.example.fr ) )"
check "contenu web identique au rendu managed" test "$(cat "$sites/t1.web.caddy")" = "$( ( load_kit 'ACME_EMAIL=x' >/dev/null; caddy_render_web_site t1 web.example.fr ) )"
check "rechargement exactement une fois par modification effective (2 écritures, 1 relecture à l'identique)" test "$(wc -l <"$tmp/reload.count")" = 2
check "aucun dossier Caddy du kit créé" test ! -e "$tmp/root/caddy"

( load_kit "$(ext_conf "echo x >>$tmp/reload.count")" >/dev/null; caddy_remove_site t1 >/dev/null )
check "suppression : blocs retirés" test ! -e "$sites/t1.caddy" -a ! -e "$sites/t1.web.caddy"
check "suppression : un rechargement de plus" test "$(wc -l <"$tmp/reload.count")" = 3
( load_kit "$(ext_conf "echo x >>$tmp/reload.count")" >/dev/null; caddy_remove_site t1 >/dev/null )
check "suppression sans bloc existant : aucun rechargement" test "$(wc -l <"$tmp/reload.count")" = 3
check "_vitrine.caddy intact" test "$(sha256sum "$sites/_vitrine.caddy")" = "$vit_sum"

out="$( ( load_kit "$(ext_conf false)" >/dev/null; caddy_add_site t2 d2.example.fr ) 2>&1 )"; rc=$?
check "CADDY_RELOAD_CMD=false : échec non nul (rc=$rc) et message" test $rc -ne 0 -a -n "$out"
check "CADDY_RELOAD_CMD=false : bloc retiré" test ! -e "$sites/t2.caddy"

out="$( ( load_kit "$(ext_conf '')" >/dev/null; caddy_add_site t3 d3.example.fr; caddy_add_web_site t3 w3.example.fr ) 2>&1 )"; rc=$?
check "commande vide : succès (rc=$rc), bloc conservé" test $rc -eq 0 -a -f "$sites/t3.caddy"
check "commande vide : un seul avertissement" test "$(grep -c 'rechargez votre Caddy' <<<"$out")" = 1
rm -f "$sites/t3.caddy" "$sites/t3.web.caddy"

# ── external : garde-fous (critères 6, 7, 10) ────────────────────────────────────────────────
echo "== external : garde-fous"
out="$( ( load_kit "$(ext_conf '')" >/dev/null; docker() { return 1; }; edge_network_require ) 2>&1 )"; rc=$?
has_net=0; grep -q 'docker network create polenta-edge' <<<"$out" && has_net=1
check "réseau absent : refus (rc=$rc) citant le réseau et docker network create" test $rc -ne 0 -a $has_net = 1
( load_kit "$(ext_conf '')" >/dev/null; docker() { return 0; }; edge_network_require ) >/dev/null 2>&1
check "réseau présent : accepté" test $? -eq 0
( load_kit 'ACME_EMAIL=x' >/dev/null; docker() { return 1; }; edge_network_require ) >/dev/null 2>&1
check "managed : edge_network_require sans effet" test $? -eq 0

out="$( ( load_kit "$(ext_conf '')" >/dev/null; docker() { [[ "$1 $2" == "inspect -f" ]] && echo true; return 0; }; caddy_external_guard ) 2>&1 )"; rc=$?
has_c=0; grep -q 'polenta-caddy' <<<"$out" && has_c=1
check "external avec polenta-caddy en marche : setup refusé (rc=$rc)" test $rc -ne 0 -a $has_c = 1
( load_kit "$(ext_conf '')" >/dev/null; docker() { echo false; return 0; }; caddy_external_guard ) >/dev/null 2>&1
check "external sans polenta-caddy en marche : accepté" test $? -eq 0

# ── external : aucune action réseau sur Caddy (critère 6) ────────────────────────────────────
echo "== external : pas de docker network connect"
log="$tmp/docker.log"; : >"$log"
( load_kit "$(ext_conf 'true')" >/dev/null; docker() { echo "$*" >>"$log"; return 0; }
  caddy_connect_network polenta-t1; caddy_disconnect_network polenta-t1
  caddy_add_site t4 d4.example.fr >/dev/null; caddy_remove_site t4 >/dev/null )
check "aucun appel docker (connect/disconnect/exec) en external" test ! -s "$log"

echo
if [[ $FAIL == 0 ]]; then echo "OK"; else echo "ÉCHEC"; fi
exit $FAIL
