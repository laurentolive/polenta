#!/usr/bin/env bash
# GH63 Sprint 1 — accès direct au stockage S3 des sauvegardes (specs/GH63.md §3.7, §3.8) : test d'une
# clé avant remplacement, inventaire et suppression des objets d'une instance lors d'une purge.
# Sourcé après common.sh. Requêtes signées par curl (--aws-sigv4, curl ≥ 7.75) ; les identifiants
# passent par la configuration lue sur l'entrée de curl (-K -) : jamais dans la ligne de commande
# (ps, /proc/<pid>/cmdline), jamais dans l'environnement, jamais sur disque.
# shellcheck disable=SC2034  # variables lues par polenta-host.sh

# https://… à partir de BACKUP_S3_ENDPOINT (restic accepte l'hôte seul).
s3_base_url() {
  local endpoint="${1%/}"
  [[ "$endpoint" == http://* || "$endpoint" == https://* ]] || endpoint="https://$endpoint"
  printf '%s' "$endpoint"
}

# Région de signature : BACKUP_S3_REGION, sinon déduite de l'hôte (s3.<région>.… ou
# s3-<région>.…), sinon us-east-1 (la plupart des fournisseurs compatibles l'acceptent).
s3_region() {
  local endpoint="$1" explicit="${2:-}" host
  [[ -n "$explicit" ]] && { printf '%s' "$explicit"; return; }
  host="${endpoint#*://}"; host="${host%%/*}"
  if [[ "$host" =~ ^s3[.-]([a-z]{2}-[a-z]+(-[0-9])?)\. ]]; then printf '%s' "${BASH_REMATCH[1]}"; else printf 'us-east-1'; fi
}

# s3_curl <méthode> <url> <access> <secret> <région> [options curl…] — requête signée : corps de la
# réponse dans S3_BODY, code HTTP dans S3_HTTP_CODE. À appeler directement, jamais dans $(…) : les
# variables n'en sortiraient pas.
S3_HTTP_CODE=""; S3_BODY=""
s3_curl() {
  local method="$1" url="$2" access="$3" secret="$4" region="$5"; shift 5
  local out rc=0
  out="$(printf 'user = "%s:%s"\n' "$access" "$secret" \
    | curl -sS -K - --aws-sigv4 "aws:amz:$region:s3" -X "$method" --max-time 60 -w '\n%{http_code}' "$@" "$url")" || rc=$?
  S3_HTTP_CODE="${out##*$'\n'}"
  S3_BODY="${out%$'\n'*}"
  return "$rc"
}

# Test d'une clé : écriture puis relecture d'un objet de contrôle dans le bucket (suppression tentée
# ensuite, sans exiger le droit de suppression). Renvoie 0 si la clé lit et écrit.
s3_keycheck() {
  local endpoint="$1" bucket="$2" access="$3" secret="$4" region="$5"
  [[ "${POLENTA_TEST_S3_KEYCHECK:-}" == fail ]] && return 1
  [[ "${POLENTA_TEST_S3_KEYCHECK:-}" == ok ]] && return 0
  local url token
  url="$(s3_base_url "$endpoint")/$bucket/.polenta-keycheck"
  token="polenta-keycheck $(date -Iseconds) $(random_secret 12)"
  s3_curl PUT "$url" "$access" "$secret" "$region" --data-binary "$token" -H 'Content-Type: text/plain' || return 1
  [[ "$S3_HTTP_CODE" == 200 ]] || return 1
  s3_curl GET "$url" "$access" "$secret" "$region" || return 1
  [[ "$S3_HTTP_CODE" == 200 && "$S3_BODY" == "$token" ]] || return 1
  s3_curl DELETE "$url" "$access" "$secret" "$region" 2>/dev/null || true
  return 0
}

# Objets sous <préfixe>/ (ListObjectsV2, pagination comprise), une ligne « clé<TAB>taille<TAB>date ».
s3_list_objects() {
  local endpoint="$1" bucket="$2" prefix="$3" access="$4" secret="$5" region="$6"
  local base token="" page
  base="$(s3_base_url "$endpoint")/$bucket"
  while :; do
    local args=(--get --data-urlencode "list-type=2" --data-urlencode "prefix=$prefix/")
    [[ -n "$token" ]] && args+=(--data-urlencode "continuation-token=$token")
    s3_curl GET "$base" "$access" "$secret" "$region" "${args[@]}" || return 1
    [[ "$S3_HTTP_CODE" == 200 ]] || return 1
    page="$S3_BODY"
    tr -d '\n' <<<"$page" | sed 's/<Contents>/\n<Contents>/g' | awk '
      /^<Contents>/ {
        k = $0; sub(/.*<Key>/, "", k); sub(/<\/Key>.*/, "", k)
        z = $0; sub(/.*<Size>/, "", z); sub(/<\/Size>.*/, "", z)
        d = $0; sub(/.*<LastModified>/, "", d); sub(/<\/LastModified>.*/, "", d)
        print k "\t" z "\t" d
      }'
    grep -q '<IsTruncated>true</IsTruncated>' <<<"$page" || break
    token="$(grep -o '<NextContinuationToken>[^<]*' <<<"$page" | sed 's/^<NextContinuationToken>//')"
    [[ -n "$token" ]] || break
  done
}

# Suppression des objets listés sur l'entrée (un DELETE par objet). Renvoie le nombre d'échecs.
s3_delete_keys() {
  local endpoint="$1" bucket="$2" access="$3" secret="$4" region="$5" key failed=0 base
  base="$(s3_base_url "$endpoint")/$bucket"
  while IFS= read -r key; do
    [[ -n "$key" ]] || continue
    s3_curl DELETE "$base/$key" "$access" "$secret" "$region" || { failed=$((failed + 1)); continue; }
    [[ "$S3_HTTP_CODE" == 204 || "$S3_HTTP_CODE" == 200 ]] || failed=$((failed + 1))
  done
  return "$failed"
}

# Lit des lignes « clé=valeur » sur le descripteur $1 dans le tableau associatif S3_INPUT (clés en
# minuscules). Le descripteur est fermé ensuite : la valeur n'est lue qu'une fois.
declare -gA S3_INPUT=()
s3_read_fd() {
  local fd="$1" line k v
  [[ "$fd" =~ ^[0-9]+$ ]] || die "$E_USAGE" "descripteur invalide « $fd »."
  { true <&"$fd"; } 2>/dev/null || die "$E_USAGE" "descripteur $fd non ouvert."
  S3_INPUT=()
  while IFS= read -r line <&"$fd" || [[ -n "$line" ]]; do
    [[ "$line" == *=* ]] || continue
    k="${line%%=*}"; v="${line#*=}"
    S3_INPUT["${k,,}"]="$v"
  done
  eval "exec $fd<&-"
}
