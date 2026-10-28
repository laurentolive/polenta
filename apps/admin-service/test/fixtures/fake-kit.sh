#!/usr/bin/env bash
set -u
[ -f "$POLENTA_ROOT/fake.env" ] && . "$POLENTA_ROOT/fake.env"
trap 'echo "annulé" >&2; exit 10' TERM
args=()
for a in "$@"; do case "$a" in --json|--non-interactive) ;; *) args+=("$a") ;; esac; done
printf '%s\n' "${args[*]}" >> "$POLENTA_ROOT/calls.log"
printf '%s|%s|%s\n' "$POLENTA_ORIGIN" "$POLENTA_ACTOR" "$POLENTA_ADMIN_MODE" >> "$POLENTA_ROOT/env.log"
emit() { printf '%s' "$1" > "$POLENTA_RESULT_FILE"; }
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
  *) emit '{}' ;;
esac
exit "${FAKE_EXIT:-0}"
