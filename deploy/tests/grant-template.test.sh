#!/usr/bin/env bash
# GH57 — tests de deploy/lib/grant-template.py sur les modèles de référence (specs/GH57-tests.md
# T1 à T3). Sans réseau ni Docker : lancé depuis le poste de dev ou sur l'hôte.
#
#   deploy/tests/grant-template.test.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
gen="$here/../lib/grant-template.py"
# Premier interpréteur qui fonctionne (sous Windows, « python3 » peut n'être qu'un raccourci du Store).
PY="${PYTHON:-}"
if [[ -z "$PY" ]]; then
  for c in python3 python; do "$c" -c 'import sys' 2>/dev/null && { PY="$c"; break; }; done
fi
[[ -n "$PY" ]] || { echo "python3 introuvable" >&2; exit 2; }
ID='1b2c3d4e-aaaa-bbbb-cccc-123456789abc'
FAIL=0
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

pass() { printf '  \e[32m✓\e[0m %s\n' "$*"; }
fail() { printf '  \e[31m✗\e[0m %s\n' "$*"; FAIL=1; }
check() { local msg="$1"; shift; if "$@"; then pass "$msg"; else fail "$msg"; fi; }
has() { grep -qF -- "$2" "$1"; }
count() { grep -cF -- "$2" "$1"; }
not_has() { ! grep -qF -- "$2" "$1"; }

# T1 — modèles réels : branche client web + modèle d'origine à l'identique.
for fixture in "$here"/fixtures/grant-*.tmpl; do
  printf '== %s\n' "$(basename "$fixture")"
  out="$tmp/out.tmpl"
  "$PY" -I "$gen" "$fixture" "$ID" >"$out"; rc=$?
  check "code 0" test "$rc" -eq 0
  check "branche du client web en tête" has "$out" "{{if eq .Application.ClientID \"$ID\"}}"
  check "formulaire de transition envoyé automatiquement" has "$out" "document.getElementById('polenta-grant').submit()"
  check "granted=true en champ caché" has "$out" '<input type="hidden" name="granted" value="true">'
  check "bouton de secours sans JavaScript" has "$out" '<noscript><button type="submit"'
  check "message d'erreur de la forge affiché" has "$out" '{{template "base/alert" .}}'
  check "pas d'envoi automatique si la forge signale une erreur" has "$out" "{{if not (or .Flash.ErrorMsg .Flash.WarningMsg)}}<script>"
  for field in client_id state scope nonce redirect_uri; do
    check "champ $field dans les deux branches" test "$(count "$out" "name=\"$field\"")" -eq 2
  done
  # Branche de transition (avant {{else}}) : aucun bouton de refus, aucun texte d'avertissement.
  sed -n '1,/^{{else}}$/p' "$out" >"$tmp/transition"
  check "pas de bouton de refus dans la transition" not_has "$tmp/transition" 'value="false"'
  check "pas d'avertissement dans la transition" not_has "$tmp/transition" 'authorize_application_description'
  # Branche d'origine : le modèle extrait de la forge, octet pour octet.
  sed -n '/^{{else}}$/,$p' "$out" | sed '1d;$d' >"$tmp/original"
  check "modèle d'origine inchangé" cmp -s "$tmp/original" "$fixture"
  check "un seul {{else}} ajouté" test "$(grep -c '^{{else}}$' "$out")" -eq 1
done

# T2 — formes inattendues : code 3, rien sur la sortie.
printf '== formes inattendues\n'
f="$here/fixtures/grant-forgejo-15.tmpl"
expect_3() {
  local msg="$1" file="$2" rc
  "$PY" -I "$gen" "$file" "$ID" >"$tmp/o" 2>"$tmp/e"; rc=$?
  check "$msg : code 3" test "$rc" -eq 3
  check "$msg : sortie vide" test ! -s "$tmp/o"
  check "$msg : message" test -s "$tmp/e"
}
grep -v 'login/oauth/grant' "$f" >"$tmp/noform"; expect_3 "sans formulaire" "$tmp/noform"
sed 's/value="true"/value="yes"/' "$f" >"$tmp/nobutton"; expect_3 "sans bouton granted=true" "$tmp/nobutton"
{ cat "$f"; sed -n '/<form/,/<\/form>/p' "$f"; } >"$tmp/twoforms"; expect_3 "deux formulaires" "$tmp/twoforms"
{ echo '{{define "x"}}{{end}}'; cat "$f"; } >"$tmp/define"; expect_3 "avec {{define}}" "$tmp/define"

# T3 — client_id refusé (inséré dans une chaîne du modèle).
printf '== client_id\n'
for bad in '' 'abc' 'x"}}{{end' 'a b c d e f g h' "$(printf 'a%.0s' {1..70})" "$ID"$'\n'; do
  "$PY" -I "$gen" "$f" "$bad" >/dev/null 2>&1; rc=$?
  check "refus de « ${bad:0:20} »" test "$rc" -eq 2
done

exit $FAIL
