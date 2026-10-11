#!/usr/bin/env bash
# GH45 — appels à l'API Forgejo d'une instance, avec le jeton du compte d'exploitation.
# Les requêtes passent par le Caddy de l'hôte (HTTPS, --resolve vers 127.0.0.1) : le conteneur
# Forgejo ne publie aucun port, et c'est le même chemin que les postes Polenta.
# Sourcé après common.sh. Nécessite API_DOMAIN et API_TOKEN (voir api_use_instance).
# shellcheck disable=SC2034  # API_LIST, TEAM_ID… sont lus par les scripts qui sourcent ce fichier

API_DOMAIN=""
API_TOKEN=""
API_STATUS=""   # statut HTTP du dernier appel (000 : forge injoignable ou délai dépassé)
API_BODY=""     # corps de la réponse du dernier appel
API_LIST=""     # résultat d'api_paginate (tableau JSON)
TEAM_ID=""      # résultat d'api_team_id
API_TIMEOUT="${API_TIMEOUT:-60}"  # secondes ; les imports de dépôts (migrate) l'augmentent

# api_paginate et api_team_id renvoient leur résultat par variable globale, jamais par $(…) :
# un die dans une substitution ne sortirait que du sous-shell, et l'appelant prendrait une
# erreur d'API pour un résultat vide (« équipe inconnue »).

api_use_instance() {
  local name="$1" env; env="$(instance_env "$name")"
  API_DOMAIN="$(env_get "$env" DOMAIN)"
  API_TOKEN="$(env_get "$env" OPS_TOKEN)"
  [[ -n "$API_DOMAIN" ]] || die "DOMAIN absent de $env"
}

# api METHODE CHEMIN [JSON] [en-têtes supplémentaires…]
# Remplit API_STATUS / API_BODY ; renvoie 0 si 2xx, 1 sinon. Ne meurt jamais : à l'appelant de
# décider (certains 404/409 sont attendus).
api() {
  local method="$1" path="$2" data="${3:-}"; shift 3 2>/dev/null || shift $#
  local out; out="$(mktemp)"
  local args=(-sS -o "$out" -w '%{http_code}' -X "$method" --connect-timeout 10 --max-time "$API_TIMEOUT"
    --resolve "$API_DOMAIN:443:127.0.0.1"
    -H "Accept: application/json"
    -H "Authorization: token $API_TOKEN")
  [[ -n "$data" ]] && args+=(-H "Content-Type: application/json" --data "$data")
  local h; for h in "$@"; do args+=(-H "$h"); done
  API_STATUS="$(curl "${args[@]}" "https://$API_DOMAIN/api/v1$path" 2>/dev/null)" || true
  [[ "$API_STATUS" =~ ^[0-9]{3}$ ]] || API_STATUS=000
  API_BODY="$(cat "$out")"; rm -f "$out"
  [[ "$API_STATUS" == 2* ]]
}

# Comme api, mais meurt avec le message de l'API sur un statut non 2xx.
api_ok() {
  local method="$1" path="$2"
  api "$@" || die "API $method $path → HTTP $API_STATUS : $(api_message)"
}

# Message d'erreur lisible extrait d'une réponse Forgejo ({"message": …}).
api_message() {
  jq -r '.message // .errors // .' <<<"$API_BODY" 2>/dev/null | head -c 400 || printf '%s' "$API_BODY" | head -c 400
}

# Récupère toutes les pages d'une liste (limit=50) dans API_LIST (tableau JSON). Meurt sur erreur.
api_paginate() {
  local path="$1" sep='?'; [[ "$path" == *\?* ]] && sep='&'
  local page=1 acc='[]' n
  while :; do
    api_ok GET "${path}${sep}page=${page}&limit=50"
    acc="$(jq -s '.[0] + .[1]' <(printf '%s' "$acc") <(printf '%s' "$API_BODY"))"
    n="$(jq 'length' <<<"$API_BODY")"
    [[ "$n" -lt 50 ]] && break
    page=$((page + 1))
  done
  API_LIST="$acc"
}

# Identifiant d'une équipe de l'organisation dans TEAM_ID (vide si absente). Meurt sur erreur d'API.
api_team_id() {
  local org="$1" team="$2"
  api_paginate "/orgs/$org/teams"
  TEAM_ID="$(jq -r --arg t "$team" '[.[] | select(.name == $t) | .id][0] // empty' <<<"$API_LIST")"
}

# JSON d'une équipe : permission globale + unités. units_map seul : Gitea 28 refuse units et
# units_map ensemble (HTTP 400), Forgejo 15 accepte units_map seul (vérifié le 2026-10-09).
team_json() {
  local name="$1" perm="$2" all_repos="$3" can_create="$4"
  jq -n --arg n "$name" --arg p "$perm" --argjson all "$all_repos" --argjson cc "$can_create" '{
    name: $n, permission: $p, includes_all_repositories: $all, can_create_org_repo: $cc,
    units_map: {"repo.code": $p, "repo.issues": $p, "repo.pulls": $p, "repo.releases": $p,
                "repo.wiki": $p, "repo.projects": $p, "repo.packages": $p, "repo.actions": $p}
  }'
}
