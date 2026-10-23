#!/usr/bin/env bash
# GH63 Sprint 1 — clé S3 et purge contre un vrai stockage S3 de test (MinIO) : specs/GH63-tests.md
# S1-7, S1-8, S1-14. Hôte simulé (POLENTA_ROOT temporaire, sans instance complète : la sauvegarde
# de contrôle ne porte sur aucune instance). Lancé en root dans un conteneur jetable relié à MinIO.
#
#   S3_TEST_ENDPOINT=http://minio:9000 S3_TEST_BUCKET=polenta-test S3_TEST_ACCESS=… S3_TEST_SECRET=… \
#     deploy/tests/host-s3.test.sh
# shellcheck disable=SC2016,SC2329  # doublures écrites en chaînes ; fonctions appelées via check
set -uo pipefail

[[ $EUID -eq 0 ]] || { echo "à lancer en root (conteneur de test)" >&2; exit 2; }
: "${S3_TEST_ENDPOINT:?}" "${S3_TEST_BUCKET:?}" "${S3_TEST_ACCESS:?}" "${S3_TEST_SECRET:?}"
# Gardées en variables du test, retirées de l'environnement : sinon tous les processus en hériteraient
# et le contrôle S1-14 (clé absente des environnements) ne prouverait rien.
export -n S3_TEST_ENDPOINT S3_TEST_BUCKET S3_TEST_ACCESS S3_TEST_SECRET
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOSTSH="$here/../polenta-host.sh"
FAIL=0
pass() { printf '  \e[32m✓\e[0m %s\n' "$*"; }
fail() { printf '  \e[31m✗\e[0m %s\n' "$*"; FAIL=1; }
check() { local msg="$1"; shift; if "$@"; then pass "$msg"; else fail "$msg"; fi; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
export POLENTA_ROOT="$tmp/root" POLENTA_LOG_DIR="$tmp/log"
mkdir -p "$tmp/bin" "$POLENTA_ROOT/instances" "$POLENTA_ROOT/exports"
cat >"$POLENTA_ROOT/host.env" <<EOF
ACME_EMAIL=ops@exemple.fr
HARDEN_HOST=none
CADDY_MODE=external
BACKUP_S3_ENDPOINT=$S3_TEST_ENDPOINT
BACKUP_S3_BUCKET=$S3_TEST_BUCKET
BACKUP_S3_ACCESS_KEY=$S3_TEST_ACCESS
BACKUP_S3_SECRET_KEY=$S3_TEST_SECRET
EOF
chmod 600 "$POLENTA_ROOT/host.env"

# curl enregistre sa ligne de commande et son environnement (S1-14), puis s'exécute vraiment.
REAL_CURL="$(command -v curl)"
cat >"$tmp/bin/curl" <<EOF
#!/usr/bin/env bash
{ tr '\0' ' ' </proc/\$\$/cmdline; echo; tr '\0' '\n' </proc/\$\$/environ; } >>"$tmp/curl-trace"
exec "$REAL_CURL" "\$@"
EOF
chmod +x "$tmp/bin/curl"
for c in docker restic systemctl ufw fail2ban-client sshd; do printf '#!/usr/bin/env bash\nexit 1\n' >"$tmp/bin/$c"; chmod +x "$tmp/bin/$c"; done
printf '#!/usr/bin/env bash\necho "x via y dev eth0 src 203.0.113.10"\n' >"$tmp/bin/ip"; chmod +x "$tmp/bin/ip"
export PATH="$tmp/bin:$PATH"

run() { bash "$HOSTSH" "$@" >"$tmp/out" 2>"$tmp/err" 3>"$tmp/fd3" </dev/null; }
jqe() { jq -e "$1" "$tmp/fd3" >/dev/null 2>&1; }
creds() { printf 'endpoint=%s\nbucket=%s\naccess_key=%s\nsecret_key=%s\n' "$S3_TEST_ENDPOINT" "$S3_TEST_BUCKET" "$1" "$2"; }

echo "== s3-key rotate (S1-7)"
cp -p "$POLENTA_ROOT/host.env" "$tmp/host.env.before"
run s3-key rotate --non-interactive --json --credentials-fd 4 4< <(creds "$S3_TEST_ACCESS" "SENTINEL-mauvaise-cle"); RC=$?
check "clé invalide : sortie 16" test "$RC" -eq 16
check "clé invalide : host.env identique octet pour octet" cmp -s "$tmp/host.env.before" "$POLENTA_ROOT/host.env"
check "clé invalide : « rien n'a été modifié »" grep -q "rien n'a été modifié" "$tmp/err"
POLENTA_TEST_FAIL_KEYCHECK=1 run s3-key rotate --non-interactive --json --credentials-fd 4 4< <(creds "$S3_TEST_ACCESS" "$S3_TEST_SECRET"); RC=$?
check "contrôle en échec : sortie 19" test "$RC" -eq 19
check "contrôle en échec : host.env restauré octet pour octet" cmp -s "$tmp/host.env.before" "$POLENTA_ROOT/host.env"
check "contrôle en échec : copie de la clé précédente retirée" test ! -e "$POLENTA_ROOT/host.env.prev-key"
check "contrôle en échec : résultat rolled-back" jqe '.status=="rolled-back"'
run s3-key rotate --non-interactive --json --credentials-fd 4 4< <(creds "$S3_TEST_ACCESS" "$S3_TEST_SECRET"); RC=$?
check "nominal : sortie 0" test "$RC" -eq 0
check "nominal : date de remplacement dans host.env" grep -q '^BACKUP_S3_KEY_ROTATED_AT=' "$POLENTA_ROOT/host.env"
check "nominal : host.env en 600" test "$(stat -c %a "$POLENTA_ROOT/host.env")" = 600
check "nominal : résultat sans secret, indice de clé" bash -c "jq -e '.status==\"succeeded\" and (.accessKeyHint|startswith(\"…\"))' '$tmp/fd3' >/dev/null && ! grep -q '$S3_TEST_SECRET' '$tmp/fd3'"
check "nominal : secret absent du journal" bash -c "! grep -q '$S3_TEST_SECRET' '$tmp/out' '$tmp/err'"
run s3-key rotate --non-interactive; RC=$?
check "--non-interactive sans descripteur : sortie 2" test "$RC" -eq 2
run status --json; RC=$?
check "status --json : stockage décrit, jamais la clé" bash -c "jq -e '.backupStorage.bucket==\"$S3_TEST_BUCKET\"' '$tmp/fd3' >/dev/null && ! grep -q '$S3_TEST_SECRET' '$tmp/fd3'"

echo "== s3-purge : refus (S1-8)"
# Objets factices d'une instance « gone » supprimée.
for k in config keys/k1 snapshots/s1 snapshots/s2 data/aa/1; do
  printf 'user = "%s:%s"\n' "$S3_TEST_ACCESS" "$S3_TEST_SECRET" | "$REAL_CURL" -sS -K - --aws-sigv4 "aws:amz:us-east-1:s3" \
    -X PUT --data-binary "objet $k" "$S3_TEST_ENDPOINT/$S3_TEST_BUCKET/gone/$k" >/dev/null
done
count() { printf 'user = "%s:%s"\n' "$S3_TEST_ACCESS" "$S3_TEST_SECRET" | "$REAL_CURL" -sS -K - --aws-sigv4 "aws:amz:us-east-1:s3" \
  --get --data-urlencode list-type=2 --data-urlencode prefix=gone/ "$S3_TEST_ENDPOINT/$S3_TEST_BUCKET" | grep -o '<Key>' | wc -l; }
check "5 objets de test présents" test "$(count)" -eq 5
purge_key() { printf 'access_key=%s\nsecret_key=%s\n' "$S3_TEST_ACCESS" "$S3_TEST_SECRET"; }
PHRASE="supprimer définitivement les sauvegardes de gone"
run s3-purge gone --non-interactive --confirm "$PHRASE"; RC=$?
check "sans export (ni --sans-export) : sortie 6" test "$RC" -eq 6
touch "$POLENTA_ROOT/exports/gone-20261001-120000.tar.gz"
run s3-purge gone --non-interactive --confirm "$PHRASE"; RC=$?
check "sans clé de purge : sortie 6" test "$RC" -eq 6
run s3-purge gone --non-interactive --purge-key-fd 4 4< <(purge_key); RC=$?
check "sans confirmation : sortie 3" test "$RC" -eq 3
run s3-purge gone --non-interactive --confirm "supprimer" --purge-key-fd 4 4< <(purge_key); RC=$?
check "confirmation incomplète : sortie 3" test "$RC" -eq 3
mkdir -p "$POLENTA_ROOT/instances/gone"
run s3-purge gone --non-interactive --confirm "$PHRASE" --purge-key-fd 4 4< <(purge_key); RC=$?
check "instance existante : sortie 6" test "$RC" -eq 6
rmdir "$POLENTA_ROOT/instances/gone"
check "après les refus : rien effacé (5 objets)" test "$(count)" -eq 5

echo "== s3-purge : aperçu puis purge (S1-14)"
run s3-purge gone --preview --json; RC=$?
check "aperçu : sortie 0" test "$RC" -eq 0
check "aperçu : 5 objets, 2 instantanés, taille, dates" jqe '.preview and .objects==5 and .snapshots==2 and .bytes>0 and .oldest!=null'
check "aperçu : rien effacé" test "$(count)" -eq 5
SENT="SENTINEL-PURGE-$$"
: >"$tmp/curl-trace"
run s3-purge gone --non-interactive --json --confirm "$PHRASE" --purge-key-fd 4 4< <(printf 'access_key=%s\nsecret_key=%s\n' "$S3_TEST_ACCESS" "$S3_TEST_SECRET"); RC=$?
check "purge : sortie 0" test "$RC" -eq 0
check "purge : tous les objets effacés" test "$(count)" -eq 0
check "purge : résultat (5 objets, 2 instantanés)" jqe '.deletedObjects==5 and .deletedSnapshots==2'
check "purge : clé absente des lignes de commande et environnements de curl" bash -c "! grep -q '$S3_TEST_SECRET' '$tmp/curl-trace'"
check "purge : clé absente du journal et du résultat" bash -c "! grep -q '$S3_TEST_SECRET' '$tmp/out' '$tmp/err' '$tmp/fd3'"
check "purge : tracée dans host.log, sans la clé" bash -c "grep -q 's3-purge gone' '$POLENTA_LOG_DIR/host.log' && ! grep -q '$S3_TEST_SECRET' '$POLENTA_LOG_DIR/host.log'"
check "purge : aucun fichier nouveau contenant la clé" bash -c "! grep -rqs '$S3_TEST_SECRET' '$POLENTA_ROOT' --exclude=host.env"
check "purge : sentinelle jamais écrite (contrôle)" bash -c "! grep -rqs '$SENT' '$tmp'"

exit $FAIL
