#!/usr/bin/env bash
set -u
[ -f "$POLENTA_ROOT/fake.env" ] && . "$POLENTA_ROOT/fake.env"
trap 'echo "annulé" >&2; exit 10' TERM
args=()
for a in "$@"; do case "$a" in --json|--non-interactive) ;; *) args+=("$a") ;; esac; done
printf '%s\n' "${args[*]}" >> "$POLENTA_ROOT/calls.log"
printf '%s|%s|%s\n' "$POLENTA_ORIGIN" "$POLENTA_ACTOR" "$POLENTA_ADMIN_MODE" >> "$POLENTA_ROOT/env.log"
emit() { printf '%s' "$1" > "$POLENTA_RESULT_FILE"; }
# polenta-admin.sh : --instance <nom> en tête.
inst=""
if [ "${args[0]:-}" = --instance ]; then inst="${args[1]}"; args=("${args[@]:2}"); fi
# Secrets du descripteur 4 (S5) : lus, puis volontairement ÉCRITS au journal pour vérifier le filtre.
read_fd4() {
  local line
  while IFS= read -r line <&4 || [ -n "$line" ]; do echo "lu sur fd 4 : $line"; done
}
case "${args[0]:-} ${args[1]:-}" in
  "instance list") emit '{"instances":[{"name":"acme","state":"ok"},{"name":"globex","state":"ok"},{"name":"ops","state":"ok"}]}' ;;
  "instance snapshots") emit '{"instance":"'"${args[2]}"'","snapshots":[{"id":"s1"}]}' ;;
  "dns check") emit '{"domain":"'"${args[2]}"'","verdict":"ok"}' ;;
  "instance backup")
    echo "Sauvegarde de ${args[2]} password=hunter2-secret"
    for i in $(seq 1 "${FAKE_SLEEP:-0}"); do sleep 0.1; done
    emit '{"instance":"'"${args[2]}"'","tag":"'"${args[4]:-manual}"'","snapshot":"abc"}' ;;
  "instance update")
    echo "Mise à jour de ${args[2]}"
    if [ "${FAKE_FAIL_UPDATE:-0}" = 1 ]; then echo "✗ échec, retour arrière effectué" >&2; emit '{"updates":[{"restoredVersion":"10.0.1"}]}'; exit 17; fi
    emit '{"updates":[{"instance":"'"${args[2]}"'","version":"'"${args[4]}"'"}]}' ;;
  "instance add") emit '{"name":"'"${args[2]}"'","clientAdmin":{"login":"jo","temporaryPassword":"Tmp-Pass-123456"}}' ;;
  "instance remove") emit '{"instance":"'"${args[2]}"'"}' ;;
  "instance keys") emit '{"instance":"'"${args[2]}"'","resticPassword":"SENTINEL-RESTICKEY"}' ;;
  "instance restore") echo "pre-restore puis restauration de ${args[2]}"; emit '{"instance":"'"${args[2]}"'","preRestore":"p1"}' ;;
  "instance export") mkdir -p "$POLENTA_ROOT/exports"; f="${args[2]}-20261028-101500.tar.gz"; printf 'ARCHIVE' > "$POLENTA_ROOT/exports/$f"; emit '{"file":"'"$f"'","instance":"'"${args[2]}"'"}' ;;
  "exports list") emit '{"exports":[{"file":"acme-20261028-101500.tar.gz","instance":"acme","sizeBytes":7},{"file":"globex-20261028-101500.tar.gz","instance":"globex","sizeBytes":7}]}' ;;
  "exports delete") emit '{"deleted":"'"${args[2]}"'"}' ;;
  "s3-key rotate") read_fd4; emit '{"status":"succeeded","accessKeyHint":"…2345"}' ;;
  "s3-purge "*)
    if [[ " ${args[*]} " == *" --preview "* ]]; then emit '{"instance":"'"${args[1]}"'","snapshots":4,"objects":12,"bytes":2048,"preview":true}'
    else read_fd4; emit '{"instance":"'"${args[1]}"'","deletedObjects":12}'; fi ;;
  "status ") emit '{"host":"h","backupStorage":{"endpoint":"https://s3.test","bucket":"b","accessKeyHint":"…2345","rotatedAt":null}}' ;;
  "user import")
    if [[ " ${args[*]} " == *" --preview "* ]]; then
      head -c 3 "${args[2]}" | grep -q x && { echo "✗ colonne manquante" >&2; exit 2; }
      emit '{"rows":[{"line":2,"login":"zoe"}],"rejected":[{"line":3,"cause":"doublon"}],"unknownTeams":[]}'
    else
      emit '{"created":[{"login":"zoe","temporaryPassword":"SENTINEL-USERPW","inviteLink":"polenta://connect?login=zoe"}],"errors":[]}'
    fi ;;
  "access-report "*) emit '{"instance":"'"$inst"'","rows":[{"user":"zoe","repo":"produit","permission":"write"}]}' ;;
  "invite "*) emit '{"login":"'"${args[1]}"'","inviteLink":"polenta://connect?login='"${args[1]}"'","message":"Bienvenue"}' ;;
  *) emit '{}' ;;
esac
exit "${FAKE_EXIT:-0}"
