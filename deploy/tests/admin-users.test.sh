#!/usr/bin/env bash
# GH63 Sprint 1 — commandes utilisateurs de polenta-admin (specs/GH63-tests.md S1-13, S1-15) :
# import CSV (aperçu, limites, BOM, mots de passe hors journal), rapport d'accès et invitation en
# --json. La forge est simulée par une doublure de curl qui répond aux appels d'API utilisés.
# Lancé en root dans un conteneur jetable (Debian 13 + jq).
#
#   deploy/tests/admin-users.test.sh
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
export POLENTA_ROOT="$tmp/root" POLENTA_LOG_DIR="$tmp/log" FORGE_LOG="$tmp/forge.log"
mkdir -p "$tmp/bin" "$POLENTA_ROOT/instances/acme"
printf 'HARDEN_HOST=none\nCADDY_MODE=managed\nPOLENTA_DOWNLOAD_URL=https://exemple.fr/polenta\n' >"$POLENTA_ROOT/host.env"
printf 'DOMAIN=acme-forge.exemple.fr\nORG=acme\nOPS_TOKEN=SENTINEL-ops-token\n' >"$POLENTA_ROOT/instances/acme/instance.env"
touch "$POLENTA_ROOT/instances/acme/.add-complete"

# Doublure de la forge : -o <fichier> reçoit le corps, le code HTTP sur stdout (-w).
cat >"$tmp/bin/curl" <<'EOF'
#!/usr/bin/env bash
out=/dev/null method=GET url=""
while (($#)); do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -X) method="$2"; shift 2 ;;
    -w|-H|--data|--connect-timeout|--max-time|--resolve) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
path="${url#*/api/v1}"; path="${path%%\?*}"
echo "$method $path" >>"$FORGE_LOG"
reply() { printf '%s' "$2" >"$out"; printf '%s' "$1"; exit 0; }
case "$method $path" in
  "GET /orgs/acme/teams") reply 200 '[{"id":1,"name":"auteurs","permission":"write"},{"id":2,"name":"testeurs","permission":"write"},{"id":3,"name":"lecteurs","permission":"read"}]' ;;
  "GET /users/alice") reply 200 '{"login":"alice","full_name":"Alice Martin"}' ;;
  "GET /users/"*) reply 404 '{"message":"user does not exist"}' ;;
  "POST /admin/users") reply 201 '{}' ;;
  "PUT /teams/"*) reply 204 '' ;;
  "GET /orgs/acme/repos") reply 200 '[{"name":"produit"}]' ;;
  "GET /repos/acme/produit/teams") reply 200 '[{"id":1,"permission":"write"}]' ;;
  "GET /teams/1/members") reply 200 '[{"login":"alice"}]' ;;
  "GET /repos/acme/produit/collaborators") reply 200 '[]' ;;
  *) reply 404 '{"message":"non simulé"}' ;;
esac
EOF
chmod +x "$tmp/bin/curl"
for c in docker systemctl; do printf '#!/usr/bin/env bash\nexit 1\n' >"$tmp/bin/$c"; chmod +x "$tmp/bin/$c"; done
export PATH="$tmp/bin:$PATH"

run() { : >"$FORGE_LOG"; bash "$ADMINSH" "$@" >"$tmp/out" 2>"$tmp/err" 3>"$tmp/fd3" </dev/null; }
jqe() { jq -e "$1" "$tmp/fd3" >/dev/null 2>&1; }

# CSV de 200 lignes dont 3 invalides (e-mail, login, équipe inconnue).
csv="$tmp/users.csv"
{ printf 'login;email;nom;équipes\n'
  for i in $(seq 1 197); do printf 'user%03d;user%03d@exemple.fr;Utilisateur %d;auteurs,lecteurs\n' "$i" "$i" "$i"; done
  printf 'bad-mail;pas-un-email;X;auteurs\n'
  printf -- '-bad;bad@exemple.fr;X;\n'
  printf 'zoe;zoe@exemple.fr;Zoé;inconnue\n'; } >"$csv"

echo "== user import --preview (S1-15)"
run user import "$csv" --preview --json; RC=$?
check "aperçu : sortie 0" test "$RC" -eq 0
check "aperçu : 197 valides" jqe '.preview and .valid==197'
check "aperçu : 3 rejetées avec ligne et cause" jqe '.rejected|length==3 and (map(.line)==[199,200,201]) and (.[0].cause=="e-mail invalide") and (.[1].cause=="login invalide")'
check "aperçu : équipe inconnue listée" jqe '.unknownTeams==["inconnue"]'
check "aperçu : rien créé sur la forge" bash -c "! grep -qE '^(POST|PUT)' '$FORGE_LOG'"
check "aperçu : sans verrou" test ! -e "$POLENTA_ROOT/.lock.owner"

printf '\xEF\xBB\xBFlogin;email;nom;équipes\nbob;bob@exemple.fr;Bob;auteurs\n' >"$tmp/bom.csv"
run user import "$tmp/bom.csv" --preview --json; RC=$?
check "BOM UTF-8 accepté" bash -c "[[ $RC == 0 ]] && jq -e '.valid==1' '$tmp/fd3' >/dev/null"
printf 'login;email;nom;équipes\nalice;alice@exemple.fr;Alice;\nbob;b@exemple.fr;B;\nbob;b2@exemple.fr;B;\n' >"$tmp/dup.csv"
run user import "$tmp/dup.csv" --preview --json; RC=$?
check "login existant et doublon : rejetés" jqe '(.rejected|map(.cause))==["login déjà utilisé","login en double dans le fichier"]'

echo "== limites (S1-15)"
{ printf 'login;email;nom;équipes\n'; for i in $(seq 1 2001); do printf 'u%d;u%d@exemple.fr;U;\n' "$i" "$i"; done; } >"$tmp/big-rows.csv"
run user import "$tmp/big-rows.csv" --preview --json; RC=$?
check "2 001 lignes : sortie 2, avant tout traitement" bash -c "[[ $RC == 2 ]] && ! grep -q 'users/' '$FORGE_LOG'"
{ printf 'login;email;nom;équipes\n'; head -c $((5 * 1024 * 1024 + 100 * 1024)) /dev/zero | tr '\0' 'x'; printf '\n'; } >"$tmp/big.csv"
run user import "$tmp/big.csv" --preview --json; RC=$?
check "5,1 Mo : sortie 2, avant tout traitement" bash -c "[[ $RC == 2 ]] && ! grep -q 'users/' '$FORGE_LOG'"

echo "== user import (S1-13)"
run user import "$csv" --json; RC=$?
check "import : sortie 0" test "$RC" -eq 0
check "import : 197 créés, 3 erreurs" jqe '(.created|length)==197 and (.errors|length)==3'
check "import : mot de passe temporaire et lien dans le résultat" jqe '.created[0].temporaryPassword|length==20'
pw="$(jq -r '.created[0].temporaryPassword' "$tmp/fd3")"
check "import : mot de passe absent du journal" bash -c "! grep -q '$pw' '$tmp/out' '$tmp/err'"
check "import : mot de passe absent de admin.log" bash -c "! grep -q '$pw' '$POLENTA_ROOT/instances/acme/admin.log'"
check "import : jeton d'exploitation absent du journal" bash -c "! grep -q SENTINEL-ops-token '$tmp/out' '$tmp/err'"
check "import : verrou libéré" test ! -e "$POLENTA_ROOT/.lock.owner"

echo "== access-report --json, invite --json"
run access-report --json; RC=$?
check "access-report : sortie 0, ligne alice/produit/write" bash -c "[[ $RC == 0 ]] && jq -e '.rows==[{user:\"alice\",repo:\"produit\",permission:\"write\"}]' '$tmp/fd3' >/dev/null"
run invite alice --json; RC=$?
check "invite : sortie 0" test "$RC" -eq 0
check "invite : lien polenta://connect, serveur et login" jqe '.inviteLink=="polenta://connect?server=https%3A%2F%2Facme-forge.exemple.fr&login=alice"'
check "invite : message avec le lien de téléchargement" jqe '.message|contains("https://exemple.fr/polenta")'
run invite inconnu --json; RC=$?
check "invite d'un compte inconnu : sortie 2" test "$RC" -eq 2

exit $FAIL
