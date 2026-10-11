#!/usr/bin/env bash
# GH45 — opérations courantes dans une instance Forgejo (specs/GH45.md §9.6).
#
#   polenta-admin [--instance <nom>] user add <login> <email> [--name "Nom"] [--team <équipe>]…
#   polenta-admin [--instance <nom>] user import <fichier.csv>      (login;email;nom;équipes séparées par ,)
#   polenta-admin [--instance <nom>] user disable|enable <login>
#   polenta-admin [--instance <nom>] team add <nom> <read|write> [repo…]
#   polenta-admin [--instance <nom>] team member add|rm <équipe> <login>
#   polenta-admin [--instance <nom>] project create <nom> [--team <équipe>]…
#   polenta-admin [--instance <nom>] oauth-app create <nom> <redirect-uri>
#   polenta-admin [--instance <nom>] access report [--csv]
#
# --instance est facultatif quand l'hôte n'a qu'une instance.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/forgejo-api.sh
. "$SCRIPT_DIR/lib/forgejo-api.sh"

usage() { sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

INSTANCE=""
ORG=""
CMDLINE=""   # commande journalisée dans admin.log (jamais de mot de passe)

# Mot de passe temporaire : affiché sans SMTP, envoyé par la forge sinon.
smtp_enabled() { [[ -n "$(env_get "$HOST_ENV" SMTP_HOST)" ]]; }

# TEAM_ID de l'équipe $1, ou arrêt avec la liste des équipes existantes.
team_id_or_die() {
  api_team_id "$ORG" "$1"
  [[ -n "$TEAM_ID" ]] || die "équipe « $1 » inconnue dans $ORG. Équipes : $(jq -r '[.[].name] | join(", ")' <<<"$API_LIST")"
}

# GH45 S2b — lien d'invitation (spec §3ter) : ouvre Polenta sur l'écran de connexion, serveur et
# identifiant pré-remplis ; jamais de connexion automatique.
invite_link() {
  local login="$1"
  printf 'polenta://connect?server=%s&login=%s' "$(jq -rn --arg v "https://$API_DOMAIN" '$v|@uri')" "$(jq -rn --arg v "$login" '$v|@uri')"
}

# Message d'invitation prêt à copier (mot de passe inclus seulement sans SMTP).
announce_invitation() {
  local login="$1" fullname="$2"
  local download; download="$(env_get "$HOST_ENV" POLENTA_DOWNLOAD_URL)"
  printf '  Lien d'"'"'invitation : %s\n' "$(invite_link "$login")"
  printf '  ── Message à envoyer ──────────────────────────────────────────────\n'
  printf '  Bonjour %s,\n\n' "${fullname:-$login}"
  printf '  Votre compte Polenta est prêt sur le serveur https://%s\n' "$API_DOMAIN"
  printf '  Identifiant : %s\n' "$login"
  if smtp_enabled; then
    printf '  Mot de passe temporaire : envoyé dans un e-mail séparé.\n'
  else
    printf '  Mot de passe temporaire : %s (à changer à la première connexion)\n' "$USER_PASSWORD"
  fi
  [[ -n "$download" ]] && printf '\n  1. Installez Polenta : %s\n' "$download"
  printf '  %s Cliquez sur ce lien pour vous connecter : %s\n' "$([[ -n "$download" ]] && printf '2.' || printf '→')" "$(invite_link "$login")"
  printf '  ──────────────────────────────────────────────────────────────────\n'
}

# Mot de passe temporaire d'un compte qui vient d'être créé : affiché TOUT DE SUITE (sans SMTP),
# avant les étapes suivantes. Si l'une d'elles échoue, le compte existe déjà et une relance serait
# refusée (« login déjà utilisé ») : le mot de passe ne doit jamais être perdu.
announce_password() {
  local login="$1" email="$2"
  if smtp_enabled; then
    printf '  %s : mot de passe temporaire envoyé à %s (changement imposé à la première connexion).\n' "$login" "$email"
  else
    printf '  %s : mot de passe temporaire %s (à transmettre ; changement imposé à la première connexion)\n' "$login" "$USER_PASSWORD"
  fi
}

# ─── user ─────────────────────────────────────────────────────────────────────

# Crée un utilisateur ; renvoie 0 si créé. Écrit le mot de passe temporaire dans USER_PASSWORD.
create_user() {
  local login="$1" email="$2" fullname="$3"
  [[ "$login" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$ ]] || { USER_ERROR="login invalide"; return 1; }
  [[ "$email" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || { USER_ERROR="e-mail invalide"; return 1; }
  if api GET "/users/$login"; then USER_ERROR="login déjà utilisé"; return 1; fi
  USER_PASSWORD="$(random_secret 20)"
  local notify=false; smtp_enabled && notify=true
  if ! api POST /admin/users "$(jq -n --arg u "$login" --arg e "$email" --arg f "$fullname" --arg p "$USER_PASSWORD" --argjson n "$notify" \
      '{username: $u, email: $e, full_name: $f, password: $p, must_change_password: true, send_notify: $n, login_name: $u, source_id: 0}')"; then
    USER_ERROR="$(api_message)"; return 1
  fi
}

add_to_team() {
  local team="$1" login="$2"
  api_team_id "$ORG" "$team"
  [[ -n "$TEAM_ID" ]] || { USER_ERROR="équipe « $team » inconnue"; return 1; }
  api PUT "/teams/$TEAM_ID/members/$login" "" || { USER_ERROR="ajout à $team : $(api_message)"; return 1; }
}

cmd_user_add() {
  local login="${1:-}" email="${2:-}"; [[ -n "$login" && -n "$email" ]] || usage 1
  shift 2
  local fullname="" teams=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --name) fullname="$2"; shift 2 ;;
      --team) teams+=("$2"); shift 2 ;;
      *) die "option inconnue : $1" ;;
    esac
  done
  local t
  for t in "${teams[@]}"; do team_id_or_die "$t"; done
  USER_ERROR=""
  if ! create_user "$login" "$email" "$fullname"; then
    admin_log "$INSTANCE" "$CMDLINE" "ERREUR $USER_ERROR"; die "$login : $USER_ERROR"
  fi
  ok "utilisateur $login créé"
  announce_password "$login" "$email"
  announce_invitation "$login" "$fullname"
  for t in "${teams[@]}"; do
    if ! add_to_team "$t" "$login"; then
      admin_log "$INSTANCE" "$CMDLINE" "ERREUR compte créé, $USER_ERROR"
      die "compte $login créé, mais $USER_ERROR — relancez : polenta-admin --instance $INSTANCE team member add $t $login"
    fi
    ok "$login ajouté à $t"
  done
  admin_log "$INSTANCE" "$CMDLINE" OK
}

cmd_user_import() {
  local file="${1:-}"; [[ -f "$file" ]] || die "fichier CSV introuvable : ${file:-?}"
  local header; header="$(head -n1 "$file" | tr -d '\r' | tr '[:upper:]' '[:lower:]')"
  [[ "$header" == "login;email;nom;équipes" || "$header" == "login;email;nom;equipes" ]] \
    || die "en-tête attendu : login;email;nom;équipes (trouvé : $header)"
  local n=0 nok=0 nerr=0 login email fullname teams t line
  printf '%-20s %-8s %s\n' LOGIN RÉSULTAT DÉTAIL
  while IFS= read -r line || [[ -n "$line" ]]; do
    n=$((n + 1)); [[ $n -eq 1 ]] && continue
    line="${line%$'\r'}"; [[ -z "${line// }" ]] && continue
    IFS=';' read -r login email fullname teams <<<"$line"
    USER_ERROR=""; USER_PASSWORD=""
    local okline=1
    if [[ -n "$teams" ]]; then
      for t in ${teams//,/ }; do
        api_team_id "$ORG" "$t"
        [[ -n "$TEAM_ID" ]] || { USER_ERROR="équipe « $t » inconnue"; okline=0; break; }
      done
    fi
    if [[ $okline == 1 ]] && create_user "$login" "$email" "$fullname"; then
      for t in ${teams//,/ }; do
        # Compte créé mais équipe en échec : le mot de passe figure dans la ligne d'erreur.
        if ! add_to_team "$t" "$login"; then
          okline=0
          smtp_enabled || USER_ERROR="compte créé (mot de passe temporaire : $USER_PASSWORD), mais $USER_ERROR"
          break
        fi
      done
    else
      okline=0
    fi
    if [[ $okline == 1 ]]; then
      nok=$((nok + 1))
      if smtp_enabled; then printf '%-20s %-8s %s\n' "$login" OK "e-mail envoyé — $(invite_link "$login")"
      else printf '%-20s %-8s %s\n' "$login" OK "mot de passe temporaire : $USER_PASSWORD — $(invite_link "$login")"; fi
      admin_log "$INSTANCE" "user import $login" OK
    else
      nerr=$((nerr + 1))
      printf '%-20s %-8s %s\n' "${login:-?}" ERREUR "$USER_ERROR"
      admin_log "$INSTANCE" "user import ${login:-?}" "ERREUR $USER_ERROR"
    fi
  done <"$file"
  log "Import terminé : $nok créé(s), $nerr erreur(s)."
}

cmd_user_disable() {
  local login="${1:-}"; [[ -n "$login" ]] || usage 1
  api_ok GET "/users/$login"
  api_ok PATCH "/admin/users/$login" "$(jq -n --arg u "$login" '{prohibit_login: true, login_name: $u, source_id: 0}')"
  # Jetons d'accès : prohibit_login suffit à les rendre inutilisables. Vérifié le 2026-10-09 sur
  # Forgejo 15 et Gitea 28 : API → 403 « prohibited from signing in », git refusé (GH45-sprint1
  # §6.5). Suppression en plus quand la forge le permet : Forgejo accepte la liste en admin + Sudo,
  # Gitea la refuse (401) ; l'interdiction de connexion reste alors la garantie.
  local tokens deleted=0 id
  if api GET "/users/$login/tokens" "" "Sudo: $login"; then
    tokens="$API_BODY"
    for id in $(jq -r '.[].id' <<<"$tokens"); do
      api DELETE "/users/$login/tokens/$id" "" "Sudo: $login" && deleted=$((deleted + 1))
    done
    ok "$login : connexion interdite, $deleted jeton(s) révoqué(s)"
  else
    ok "$login : connexion interdite"
    printf '  Jetons non listables sur cette forge (HTTP %s) : ils sont bloqués par l'\''interdiction de connexion.\n' "$API_STATUS"
  fi
  admin_log "$INSTANCE" "$CMDLINE" OK
}

cmd_user_enable() {
  local login="${1:-}"; [[ -n "$login" ]] || usage 1
  api_ok PATCH "/admin/users/$login" "$(jq -n --arg u "$login" '{prohibit_login: false, login_name: $u, source_id: 0}')"
  admin_log "$INSTANCE" "$CMDLINE" OK
  ok "$login réactivé"
}

# ─── team ─────────────────────────────────────────────────────────────────────

cmd_team_add() {
  local name="${1:-}" perm="${2:-}"; [[ -n "$name" && "$perm" =~ ^(read|write)$ ]] || usage 1
  shift 2
  api_team_id "$ORG" "$name"
  [[ -z "$TEAM_ID" ]] || die "l'équipe « $name » existe déjà."
  local all=true; [[ $# -gt 0 ]] && all=false
  local repo
  for repo in "$@"; do api GET "/repos/$ORG/$repo" || die "repo « $ORG/$repo » introuvable."; done
  api_ok POST "/orgs/$ORG/teams" "$(team_json "$name" "$perm" "$all" false)"
  local id; id="$(jq -r .id <<<"$API_BODY")"
  for repo in "$@"; do api_ok PUT "/teams/$id/repos/$ORG/$repo" ""; done
  admin_log "$INSTANCE" "$CMDLINE" OK
  if [[ $# -gt 0 ]]; then ok "équipe $name ($perm) sur : $*"; else ok "équipe $name ($perm) sur tous les repos de $ORG"; fi
}

cmd_team_member() {
  local action="${1:-}" team="${2:-}" login="${3:-}"
  [[ "$action" =~ ^(add|rm)$ && -n "$team" && -n "$login" ]] || usage 1
  team_id_or_die "$team"
  api_ok GET "/users/$login"
  if [[ "$action" == add ]]; then api_ok PUT "/teams/$TEAM_ID/members/$login" ""; ok "$login ajouté à $team"
  else api_ok DELETE "/teams/$TEAM_ID/members/$login" ""; ok "$login retiré de $team"; fi
  admin_log "$INSTANCE" "$CMDLINE" OK
}

# ─── project ──────────────────────────────────────────────────────────────────

# Contenu initial identique à WorkspaceService.createNewProject (GH27) pour le .gitignore ;
# AGENTS.md est (re)généré par Polenta à la première ouverture (ensureAgentFiles).
PROJECT_GITIGNORE=$'.polenta/tree.cache.yaml\n*.pref\n'

cmd_project_create() {
  local name="${1:-}"; [[ "$name" =~ ^[A-Za-z0-9._-]{1,100}$ ]] || usage 1
  shift
  local teams=()
  while [[ $# -gt 0 ]]; do
    case "$1" in --team) teams+=("$2"); shift 2 ;; *) die "option inconnue : $1" ;; esac
  done
  local t; for t in "${teams[@]}"; do team_id_or_die "$t"; done
  api GET "/repos/$ORG/$name" && die "le repo $ORG/$name existe déjà."
  api_ok POST "/orgs/$ORG/repos" "$(jq -n --arg n "$name" '{name: $n, private: true, auto_init: false, default_branch: "main"}')"
  api_ok POST "/repos/$ORG/$name/contents/.gitignore" "$(jq -n --arg c "$(printf '%s' "$PROJECT_GITIGNORE" | base64 -w0)" \
    '{content: $c, message: "init: create project", branch: "main", new_branch: "main"}')"
  for t in "${teams[@]}"; do team_id_or_die "$t"; api_ok PUT "/teams/$TEAM_ID/repos/$ORG/$name" ""; done
  admin_log "$INSTANCE" "$CMDLINE" OK
  ok "projet $ORG/$name créé (privé)${teams:+, équipes : ${teams[*]}}"
  printf '  URL de clone : https://%s/%s/%s.git\n' "$API_DOMAIN" "$ORG" "$name"
}

# ─── oauth-app ────────────────────────────────────────────────────────────────

cmd_oauth_app_create() {
  local name="${1:-}" redirect="${2:-}"
  [[ -n "$name" && "$redirect" =~ ^https?:// ]] || usage 1
  api_ok POST /user/applications/oauth2 "$(jq -n --arg n "$name" --arg r "$redirect" \
    '{name: $n, redirect_uris: [$r], confidential_client: true}')"
  admin_log "$INSTANCE" "$CMDLINE" OK
  ok "application OAuth2 « $name »"
  printf '  client_id     : %s\n  client_secret : %s (affiché une seule fois)\n' \
    "$(jq -r .client_id <<<"$API_BODY")" "$(jq -r .client_secret <<<"$API_BODY")"
}

# ─── access report (S3) ───────────────────────────────────────────────────────

# Accès effectifs : pour chaque repo de l'organisation, le droit maximal de chaque utilisateur, via
# ses équipes et ses ajouts individuels (revue d'accès périodique, ISO 27001).
cmd_access_report() {
  local csv=0; [[ "${1:-}" == --csv ]] && csv=1
  local rank='{"none":0,"read":1,"write":2,"admin":3,"owner":4}'
  local lines="" repo team_json tid perm members m collab
  declare -A team_members=()
  api_paginate "/orgs/$ORG/repos"
  local repos; repos="$(jq -r '.[].name' <<<"$API_LIST")"
  for repo in $repos; do
    api_ok GET "/repos/$ORG/$repo/teams"
    team_json="$API_BODY"
    for tid in $(jq -r '.[].id' <<<"$team_json"); do
      perm="$(jq -r --argjson id "$tid" '.[] | select(.id == $id) | .permission' <<<"$team_json")"
      if [[ -z "${team_members[$tid]+x}" ]]; then
        api_paginate "/teams/$tid/members"
        team_members[$tid]="$(jq -r '.[].login' <<<"$API_LIST")"
      fi
      members="${team_members[$tid]}"
      for m in $members; do lines+="$m;$repo;$perm"$'\n'; done
    done
    api_paginate "/repos/$ORG/$repo/collaborators"
    for collab in $(jq -r '.[].login' <<<"$API_LIST"); do
      api_ok GET "/repos/$ORG/$repo/collaborators/$collab/permission"
      lines+="$collab;$repo;$(jq -r '.permission' <<<"$API_BODY")"$'\n'
    done
  done
  # Droit maximal par (utilisateur, repo).
  local result
  result="$(printf '%s' "$lines" | awk -F';' -v r="$rank" '
    BEGIN { n=split("none read write admin owner", lv, " "); for (i=1;i<=n;i++) rk[lv[i]]=i }
    NF==3 { k=$1";"$2; if (!(k in best) || rk[$3] > rk[best[k]]) best[k]=$3 }
    END { for (k in best) print k";"best[k] }' | sort)"
  if [[ $csv == 1 ]]; then
    printf 'utilisateur;repo;droit\n%s\n' "$result"
  else
    printf '%-20s %-34s %s\n' UTILISATEUR REPO DROIT
    printf '%s\n' "$result" | awk -F';' 'NF==3 { printf "%-20s %-34s %s\n", $1, $2, $3 }'
  fi
  admin_log "$INSTANCE" "access report" OK
}

# ─── main ─────────────────────────────────────────────────────────────────────

main() {
  require_root; require_cmd jq curl
  local wanted=""
  if [[ "${1:-}" == --instance ]]; then wanted="${2:-}"; shift 2; fi
  [[ $# -gt 0 ]] || usage 0
  case "$1" in -h|--help|help) usage 0 ;; esac
  INSTANCE="$(resolve_instance "$wanted")"
  api_use_instance "$INSTANCE"
  [[ -n "$API_TOKEN" ]] || die "jeton d'exploitation absent : l'instance $INSTANCE est-elle complète ?"
  ORG="$(env_get "$(instance_env "$INSTANCE")" ORG)"
  CMDLINE="$*"
  local a="${1:-}" b="${2:-}"; shift 2 || shift $#
  case "$a $b" in
    "user add") cmd_user_add "$@" ;;
    "user import") cmd_user_import "$@" ;;
    "user disable") cmd_user_disable "$@" ;;
    "user enable") cmd_user_enable "$@" ;;
    "team add") cmd_team_add "$@" ;;
    "team member") cmd_team_member "$@" ;;
    "project create") cmd_project_create "$@" ;;
    "oauth-app create") cmd_oauth_app_create "$@" ;;
    "access report") cmd_access_report "$@" ;;
    *) usage 1 ;;
  esac
}

main "$@"
