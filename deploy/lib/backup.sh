#!/usr/bin/env bash
# GH45 S3 — sauvegardes restic par instance (design §5.7) : un dépôt chiffré par client dans le
# stockage S3 de host.env (préfixe = nom de l'instance), avec son propre mot de passe. Méthode :
# arrêt court de l'instance → copie de data/ + instance.env → redémarrage (copie cohérente de la base
# SQLite et des dépôts, restauration triviale).
# Sourcé après common.sh. Nécessite KIT_DIR, inst_compose, wait_healthy (polenta-host.sh).
# shellcheck disable=SC2034  # variables lues par polenta-host.sh

BACKUP_KEEP=(--keep-daily 7 --keep-weekly 4 --keep-monthly 12)

# Dossiers temporaires (extraction de snapshot, export) : ils contiennent les données et secrets d'un
# client, supprimés à la sortie du script, y compris sur erreur.
CLEANUP=()
cleanup_tmp() { [[ ${#CLEANUP[@]} -eq 0 ]] || rm -rf "${CLEANUP[@]}"; }
trap cleanup_tmp EXIT

# Dépôt restic d'une instance (URL S3), à partir de host.env.
restic_repo_url() {
  local name="$1"
  local endpoint bucket
  endpoint="$(env_get "$HOST_ENV" BACKUP_S3_ENDPOINT)"; bucket="$(env_get "$HOST_ENV" BACKUP_S3_BUCKET)"
  [[ -n "$endpoint" && -n "$bucket" ]] || die "sauvegardes non configurées : BACKUP_S3_ENDPOINT et BACKUP_S3_BUCKET dans $HOST_ENV."
  printf 's3:%s/%s/%s' "${endpoint%/}" "$bucket" "$name"
}

# Exécute restic pour une instance. Mot de passe : $RESTIC_PASSWORD_OVERRIDE (restauration sur un
# hôte neuf), sinon celui d'instance.env. Les secrets passent par l'environnement, jamais par la
# ligne de commande.
restic_for() {
  local name="$1"; shift
  local password="${RESTIC_PASSWORD_OVERRIDE:-}"
  [[ -n "$password" ]] || password="$(env_get "$(instance_env "$name")" RESTIC_PASSWORD)"
  [[ -n "$password" ]] || die "mot de passe des sauvegardes de « $name » inconnu (instance.env absent : --password-file)."
  AWS_ACCESS_KEY_ID="$(env_get "$HOST_ENV" BACKUP_S3_ACCESS_KEY)" \
  AWS_SECRET_ACCESS_KEY="$(env_get "$HOST_ENV" BACKUP_S3_SECRET_KEY)" \
  RESTIC_PASSWORD="$password" \
  RESTIC_REPOSITORY="$(restic_repo_url "$name")" \
  RESTIC_CACHE_DIR="$POLENTA_ROOT/.restic-cache" \
    restic "$@"
}

# Crée le dépôt s'il n'existe pas. Codes de sortie de restic (≥ 0.17) : 10 = dépôt absent,
# 12 = mot de passe incorrect — seul le premier justifie une création (constaté au test S3-3).
restic_ensure_repo() {
  local name="$1" rc=0
  restic_for "$name" cat config >/dev/null 2>&1 || rc=$?
  case "$rc" in
    0) return 0 ;;
    10) restic_for "$name" init >/dev/null || die "création du dépôt de sauvegarde de $name impossible."
        ok "dépôt de sauvegarde créé pour $name" ;;
    12) die "sauvegardes de $name : mot de passe incorrect pour le dépôt existant." ;;
    *) die "sauvegardes de $name : dépôt inaccessible (restic, code $rc) — stockage S3 ou réseau ?" ;;
  esac
}

# Ping de supervision (facultatif) : succès → URL, échec → URL/fail (convention healthchecks.io).
backup_ping() {
  local result="$1" url; url="$(env_get "$HOST_ENV" BACKUP_PING_URL)"
  [[ -n "$url" ]] || return 0
  [[ "$result" == fail ]] && url="${url%/}/fail"
  curl -fsS -m 10 --retry 3 -o /dev/null "$url" || warn "ping de supervision impossible ($url)"
}

# Sauvegarde d'une instance. Le service est toujours redémarré, même si la copie échoue.
backup_instance() {
  local name="$1" tag="${2:-manual}" dir; dir="$(instance_dir "$name")"
  [[ -f "$dir/.add-complete" ]] || die "instance « $name » incomplète : rien à sauvegarder."
  restic_ensure_repo "$name"
  local was_running=0
  [[ "$(instance_health "$name")" =~ ^(healthy|unhealthy|starting|running)$ ]] && was_running=1
  local started; started="$(date +%s)"
  inst_compose "$name" stop >/dev/null 2>&1 || true
  local rc=0 files=(data instance.env) f
  for f in admin.log polenta-config.json; do [[ -f "$dir/$f" ]] && files+=("$f"); done
  (cd "$dir" && restic_for "$name" backup --quiet --tag "$tag" --host polenta "${files[@]}") || rc=$?
  if [[ $was_running == 1 ]]; then
    inst_compose "$name" up -d >/dev/null 2>&1 || inst_compose "$name" up -d
    wait_healthy "$name"
  fi
  local pause=$(( $(date +%s) - started ))
  if [[ $rc != 0 ]]; then
    warn "sauvegarde de $name en échec (restic : code $rc) — service relancé"
    return "$rc"
  fi
  env_set "$(instance_env "$name")" LAST_BACKUP "$(date -Iseconds)"
  ok "sauvegarde de $name ($tag) — service interrompu ${pause}s"
}

# Snapshot à restaurer : identifiant, « latest », ou « latest:<tag> ».
resolve_snapshot() {
  local name="$1" from="$2" json rc=0
  case "$from" in
    latest) json="$(restic_for "$name" snapshots --json --latest 1 2>/dev/null)" || rc=$? ;;
    latest:*) json="$(restic_for "$name" snapshots --json --latest 1 --tag "${from#latest:}" 2>/dev/null)" || rc=$? ;;
    *) json="$(restic_for "$name" snapshots --json "$from" 2>/dev/null)" || rc=$? ;;
  esac
  case "$rc" in
    0) ;;
    10) die "aucune sauvegarde pour « $name » dans le stockage S3." ;;
    12) die "mot de passe incorrect pour les sauvegardes de « $name » — rien n'a été modifié." ;;
    *) die "sauvegarde « $from » de « $name » introuvable ou stockage inaccessible (restic, code $rc) — rien n'a été modifié." ;;
  esac
  local id; id="$(jq -r '.[-1].short_id // empty' <<<"$json")"
  [[ -n "$id" ]] || die "aucune sauvegarde « $from » pour $name."
  printf '%s' "$id"
}

# Date d'un snapshot (ISO 8601) : l'instance.env restauré date d'avant cette sauvegarde, son
# LAST_BACKUP est donc remis à la date du snapshot.
snapshot_time() {
  local name="$1" snapshot="$2" t
  t="$(restic_for "$name" snapshots --json "$snapshot" | jq -r '.[0].time // empty')"
  if [[ -n "$t" ]]; then date -Iseconds -d "$t"; else date -Iseconds; fi
}

# Restaure le contenu d'un snapshot (data/, instance.env…) dans $2, quel que soit le chemin
# d'origine (une instance peut être restaurée sous un autre nom). $4 (facultatif) : instance à
# arrêter juste avant de remplacer ses fichiers, une fois le snapshot extrait sans erreur.
restore_snapshot_to() {
  local name="$1" target="$2" snapshot="$3" stop="${4:-}"
  local tmp; tmp="$(mktemp -d "$POLENTA_ROOT/.restore.XXXXXX")"
  CLEANUP+=("$tmp")   # données du client : supprimées même en cas d'échec (trap EXIT)
  restic_for "$name" restore "$snapshot" --target "$tmp" >/dev/null
  # Les fichiers sont à la racine du snapshot (sauvegarde lancée depuis le dossier de l'instance,
  # chemins relatifs) ; une sauvegarde à chemins absolus les place sous …/instances/<nom>/ :
  # on accepte les deux (constaté au test S3-7).
  local found; found="$(find "$tmp" -maxdepth 8 -name instance.env -type f | head -n1)"
  local src; src="$(dirname "${found:-$tmp/absent/x}")"
  [[ -n "$src" && -d "$src/data" ]] || { rm -rf "$tmp"; die "snapshot $snapshot illisible (instance.env ou data/ absent)."; }
  if [[ -n "$stop" ]]; then inst_compose "$stop" down >/dev/null 2>&1 || true; fi
  mkdir -p "$target"
  # Contenu restauré à la place du contenu actuel (data/ remplacé entièrement).
  rm -rf "$target/data"
  cp -a "$src"/. "$target"/
  rm -rf "$tmp"
  # Journal de la forge restauré : renommé (conservé pour l'historique) pour que fail2ban ne
  # recompte pas des échecs déjà comptés — une restauration ou un retour arrière bannissait sinon
  # des IP sur de vieux échecs (incident du 2026-10-10).
  local log="$target/data/log/gitea.log"
  [[ -f "$log" ]] && mv "$log" "$log.avant-restauration-$(date +%Y%m%d-%H%M%S)"
  return 0
}
