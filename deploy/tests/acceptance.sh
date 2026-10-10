#!/usr/bin/env bash
# GH45 — vérifications non destructives d'un hôte Polenta, lancées DEPUIS L'EXTÉRIEUR (poste de
# l'exploitant) : critère 14 de specs/GH45.md.
#
#   deploy/tests/acceptance.sh <domaine-instance> [<domaine-instance>…]
#
# Sortie non nulle si une vérification échoue.
set -uo pipefail

[[ $# -gt 0 ]] || { sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

FAIL=0
pass() { printf '  \e[32m✓\e[0m %s\n' "$*"; }
fail() { printf '  \e[31m✗\e[0m %s\n' "$*"; FAIL=1; }

# shellcheck disable=SC2317  # port_open et not sont appelées indirectement, via verdict
port_open() { timeout 5 bash -c "exec 3<>/dev/tcp/$1/$2" 2>/dev/null; }
# shellcheck disable=SC2317
not() { ! "$@"; }

# verdict <message succès> <message échec> <commande…> : pass si la commande réussit, fail sinon.
verdict() {
  local yes="$1" no="$2"; shift 2
  if "$@"; then pass "$yes"; else fail "$no"; fi
}

check_instance() {
  local d="$1" code loc headers
  printf '== %s\n' "$d"

  # HTTPS valide (curl vérifie la chaîne de certificats, pas d'option -k).
  if curl -sS -o /dev/null --max-time 15 "https://$d/api/healthz"; then pass "HTTPS valide, /api/healthz répond"
  else fail "HTTPS invalide ou forge injoignable"; return; fi

  # HTTP → HTTPS
  loc="$(curl -sS -o /dev/null -w '%{redirect_url}' --max-time 10 "http://$d/")"
  verdict "HTTP redirigé vers HTTPS" "HTTP non redirigé (Location : ${loc:-aucune})" [ "${loc#https://}" != "$loc" ]

  # Rien de visible sans connexion.
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://$d/explore/repos")"
  loc="$(curl -sS -o /dev/null -w '%{redirect_url}' --max-time 10 "https://$d/explore/repos")"
  if [[ "$code" =~ ^30[0-9]$ && "$loc" == *"/user/login"* ]]; then pass "exploration anonyme → page de connexion"
  else fail "exploration anonyme accessible (HTTP $code ${loc})"; fi
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://$d/api/v1/repos/search")"
  verdict "API anonyme refusée (HTTP $code)" "API anonyme acceptée (HTTP $code)" grep -qxE '401|403' <<<"$code"

  # Inscription publique désactivée : la page ne propose pas de formulaire d'inscription.
  local body; body="$(curl -sS --max-time 10 "https://$d/user/sign_up")"
  if grep -q 'name="retype"' <<<"$body"; then fail "formulaire d'inscription public présent"
  else pass "inscription publique désactivée"; fi

  # En-têtes de sécurité.
  headers="$(curl -sSI --max-time 10 "https://$d/user/login" | tr -d '\r')"
  local h
  for h in strict-transport-security x-content-type-options referrer-policy x-frame-options; do
    verdict "en-tête $h" "en-tête $h absent" grep -qi "^$h:" <<<"$headers"
  done
  verdict "en-tête Server masqué" "en-tête Server exposé" not grep -qi '^server:' <<<"$headers"

  # Ports : seuls 22, 80, 443.
  local p
  for p in 22 80 443; do verdict "port $p ouvert" "port $p fermé" port_open "$d" "$p"; done
  for p in 2222 3000 5355 8080 2375; do verdict "port $p fermé" "port $p OUVERT" not port_open "$d" "$p"; done
}

for d in "$@"; do check_instance "$d"; done
if [[ $FAIL == 0 ]]; then printf '\nToutes les vérifications passent.\n'; else printf '\n\e[31mDes vérifications échouent.\e[0m\n'; fi
exit $FAIL
