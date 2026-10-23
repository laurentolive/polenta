#!/usr/bin/env bash
# GH63 Sprint 1 — tests unitaires de deploy/lib/common.sh : codes de sortie, --json/fd 3,
# confirmations (--confirm, --non-interactive), masquage des secrets, verrou (specs/GH63-tests.md
# S1-9 à S1-13). Sans root ni Docker : POLENTA_ROOT pointe vers un dossier temporaire.
#
#   deploy/tests/lib-common.test.sh        (nécessite bash ≥ 4.3, jq, flock)
# shellcheck disable=SC2016,SC2329  # corps de scripts passés en chaînes ; fonctions appelées via check
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$here/../lib/common.sh"
FAIL=0
pass() { printf '  \e[32m✓\e[0m %s\n' "$*"; }
fail() { printf '  \e[31m✗\e[0m %s\n' "$*"; FAIL=1; }
check() { local msg="$1"; shift; if "$@"; then pass "$msg"; else fail "$msg"; fi; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
export POLENTA_ROOT="$tmp/root"

# Lance un petit script qui source common.sh ; $1 = corps. stdout → $tmp/out, stderr → $tmp/err,
# fd 3 → $tmp/fd3. Renvoie le code de sortie.
run() {
  local body="$1"; shift
  printf '%s\n' "#!/usr/bin/env bash" "set -Eeuo pipefail" ". '$LIB'" "parse_global_opts \"\$@\"; set -- \"\${ARGS[@]+\"\${ARGS[@]}\"}\"" "$body" >"$tmp/s.sh"
  bash "$tmp/s.sh" "$@" >"$tmp/out" 2>"$tmp/err" 3>"$tmp/fd3" </dev/null
}
rc_is() { [[ "$RC" == "$1" ]]; }
has() { grep -q -- "$2" "$1"; }
hasnt() { ! grep -q -- "$2" "$1"; }

echo "== Codes de sortie (design §5.5)"
run 'die "$E_DNS" "ne résout pas"'; RC=$?
check "die <code> : sortie 15" rc_is 15
check "die : message sur stderr" has "$tmp/err" "ne résout pas"
run 'die "message seul"'; RC=$?
check "die sans code : sortie 1" rc_is 1
run 'x="$(die "$E_NO_INSTANCE" "inconnue")"; echo "$x"'; RC=$?
check "die dans \$(…) : code propagé (12)" rc_is 12
check "die dans \$(…) : pas de « Erreur inattendue »" hasnt "$tmp/err" "Erreur inattendue"
run 'false'; RC=$?
check "erreur non expliquée : « Erreur inattendue »" has "$tmp/err" "Erreur inattendue"

echo "== Confirmations (S1-3, S1-12)"
run 'confirm "Supprimer ?" t1 || die "abandon."; echo SUPPRIME' --non-interactive; RC=$?
check "--non-interactive sans --confirm : sortie 3" rc_is 3
check "--non-interactive : rien exécuté" hasnt "$tmp/out" SUPPRIME
run 'confirm "Supprimer ?" t1 || die "abandon."; echo SUPPRIME' --confirm autre; RC=$?
check "--confirm incorrect : sortie 3" rc_is 3
run 'confirm "Supprimer ?" t1 || die "abandon."; echo SUPPRIME' --confirm t1 --non-interactive; RC=$?
check "--confirm correct : sortie 0" rc_is 0
check "--confirm correct : exécuté" has "$tmp/out" SUPPRIME
run 'confirm "Supprimer ?" t1 || die "abandon."; echo SUPPRIME'; RC=$?
check "interactif, entrée fermée : sortie 3 sans attente" rc_is 3
printf 'o\n' >"$tmp/yes"
printf '%s\n' "#!/usr/bin/env bash" "set -Eeuo pipefail" ". '$LIB'" 'confirm "Ok ?" && echo OUI' >"$tmp/i.sh"
out="$(bash "$tmp/i.sh" <"$tmp/yes" 2>/dev/null)"
check "interactif : réponse « o » acceptée (usage SSH inchangé)" test "$out" = OUI

echo "== Résultat JSON (S1-1)"
run 'log "journal humain"; emit_result "{\"ok\":true,\"n\":2}"' --json; RC=$?
check "--json : sortie 0" rc_is 0
check "--json : résultat sur le descripteur 3" test "$(jq -c . "$tmp/fd3")" = '{"ok":true,"n":2}'
check "--json : journal humain sur stdout" has "$tmp/out" "journal humain"
check "--json : résultat absent de stdout" hasnt "$tmp/out" '"ok"'
POLENTA_RESULT_FILE="$tmp/result.json" run 'emit_result "{\"a\":1}"' --json; RC=$?
check "POLENTA_RESULT_FILE : résultat dans le fichier" test "$(jq -c . "$tmp/result.json")" = '{"a":1}'
check "POLENTA_RESULT_FILE : mode 600" test "$(stat -c %a "$tmp/result.json")" = 600
run 'emit_result "{\"a\":1}"'; RC=$?
check "sans --json : aucun résultat" test ! -s "$tmp/fd3"
run 'emit_result "{pas du json"' --json; RC=$?
check "JSON invalide : sortie non nulle" test "$RC" -ne 0

echo "== Masquage des secrets (S1-13)"
run 'echo "password=Sentinel-1 token: Sentinel-2 RESTIC_KEY=\"Sentinel-3\" garde"; emit_result "{\"password\":\"Sentinel-4\"}"' --json; RC=$?
check "journal : password masqué" hasnt "$tmp/out" "Sentinel-1"
check "journal : token masqué" hasnt "$tmp/out" "Sentinel-2"
check "journal : *_KEY masqué" hasnt "$tmp/out" "Sentinel-3"
check "journal : motif remplacé par ***" has "$tmp/out" "password=\*\*\*"
check "journal : texte ordinaire conservé" has "$tmp/out" "garde"
check "résultat : secret transmis tel quel" has "$tmp/fd3" "Sentinel-4"
run 'echo "password=Sentinel-5"'; RC=$?
check "usage SSH sans --json : sortie inchangée" has "$tmp/out" "Sentinel-5"

echo "== Verrou (S1-9, S1-10, S1-11)"
printf '%s\n' "#!/usr/bin/env bash" "set -Eeuo pipefail" ". '$LIB'" 'POLENTA_ORIGIN=ui POLENTA_ACTOR=alice acquire_lock "instance backup acme"; touch "$1"; sleep 30' >"$tmp/holder.sh"
# Groupe de processus à part : kill -9 vise le script et ses enfants (qui héritent du verrou).
setsid bash "$tmp/holder.sh" "$tmp/held" </dev/null >/dev/null 2>&1 &
holder=$!
for _ in $(seq 50); do [[ -e "$tmp/held" ]] && break; sleep 0.1; done
start=$(date +%s%N)
run 'acquire_lock "instance backup acme"; echo PRIS'; RC=$?
elapsed_ms=$(( ($(date +%s%N) - start) / 1000000 ))
check "second verrou : sortie 5" rc_is 5
check "second verrou : en moins d'1 s (${elapsed_ms} ms)" test "$elapsed_ms" -lt 1000
check "second verrou : opération citée" has "$tmp/err" "instance backup acme"
check "second verrou : origine et acteur cités" has "$tmp/err" "ui, alice"
check ".lock.owner : JSON avec pid" test "$(jq -r .pid "$POLENTA_ROOT/.lock.owner")" -gt 0
run 'echo LECTURE'; RC=$?
check "lecture pendant le verrou : sans attente" rc_is 0
kill -9 -- "-$holder" 2>/dev/null; wait "$holder" 2>/dev/null
check "kill -9 : .lock.owner périmé laissé sur disque" test -f "$POLENTA_ROOT/.lock.owner"
run 'acquire_lock "instance backup acme"; echo PRIS'; RC=$?
check "après kill -9 : verrou repris (owner périmé ignoré)" rc_is 0
check "fin normale : .lock.owner supprimé" test ! -f "$POLENTA_ROOT/.lock.owner"

echo "== Annulation (SIGTERM)"
printf '%s\n' "#!/usr/bin/env bash" "set -Eeuo pipefail" ". '$LIB'" 'acquire_lock op; touch "$1"; sleep 30 & wait' >"$tmp/term.sh"
bash "$tmp/term.sh" "$tmp/t-held" </dev/null >/dev/null 2>&1 &
p=$!
for _ in $(seq 50); do [[ -e "$tmp/t-held" ]] && break; sleep 0.1; done
kill -TERM "$p"; wait "$p"; RC=$?
check "SIGTERM : sortie 10" rc_is 10
check "SIGTERM : verrou libéré" test ! -f "$POLENTA_ROOT/.lock.owner"

exit $FAIL
