#!/usr/bin/env bash
# GH63 — module « admin » : installe (ou remet à niveau) le service d'administration et le proxy
# Docker sur un hôte du kit (specs/GH63-design.md §3.1, §6.1). Rejouable. Hors interface : root, SSH.
#
#   sudo /opt/polenta/kit/admin/install.sh [--image i] [--version v] [--build <monorepo>] [--root-fallback]
#   sudo /opt/polenta/kit/admin/install.sh --remove
#
# Pré-requis : `polenta-host setup` fait (Docker, kit dans /opt/polenta/kit), ADMIN_UI=on et, pour le
# niveau hôte, ADMIN_INSTANCE dans /opt/polenta/host.env. L'image est tirée (--image/--version) ou
# construite depuis un clone du monorepo (--build, Dockerfile deploy/admin/Dockerfile).
#
# --root-fallback : repli du risque R1 (design §9) — sous l'uid 1500 les scripts ne lisent ni l'état du kit
# (root 0600) ni les données de la forge (1000). Root DANS le conteneur + capacités de fichier
# (docker-compose.root.yml), toujours sans socket Docker ni port.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=../lib/common.sh
. "$SCRIPT_DIR/../lib/common.sh"

ADMIN_DIR="$POLENTA_ROOT/admin"
ADMIN_ENV="$ADMIN_DIR/admin.env"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
OPERATOR_UID=1500

usage() { sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

admin_compose() {
  local -a files=(-f "$COMPOSE_FILE")
  # Repli R1 (root dans le conteneur + capacités de fichier) mémorisé dans admin.env.
  [[ "$(env_get "$ADMIN_ENV" POLENTA_ADMIN_UID)" == 0 ]] && files+=(-f "$SCRIPT_DIR/docker-compose.root.yml")
  docker compose -p polenta-admin --env-file "$ADMIN_ENV" "${files[@]}" "$@"
}

remove() {
  log "Désinstallation du module admin"
  if [[ -f "$ADMIN_ENV" ]]; then admin_compose down; ok "service et proxy arrêtés"; else skip "service absent"; fi
  warn "audit et travaux conservés dans $ADMIN_DIR ; ADMIN_UI=off dans $HOST_ENV puis « polenta-host instance sync <nom> » pour retirer les instances du réseau polenta-admin-net."
}

main() {
  local image="" version="" build="" root_fallback=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --image) image="$2"; shift 2 ;;
      --version) version="$2"; shift 2 ;;
      --build) build="$2"; shift 2 ;;
      --root-fallback) root_fallback=1; shift ;;
      --remove) require_root; remove; return ;;
      -h|--help) usage 0 ;;
      *) die "$E_USAGE" "option inconnue : $1" ;;
    esac
  done
  require_root
  require_cmd docker jq
  load_host_env
  [[ "$ADMIN_UI" == on ]] || die "$E_PRECOND" "ADMIN_UI=off dans $HOST_ENV : passez-le à on avant d'installer le module admin."
  [[ -n "$ADMIN_INSTANCE" ]] || warn "ADMIN_INSTANCE vide : aucun propriétaire n'aura le niveau hôte (chacun administre sa seule instance)."

  log "Module admin (service d'administration + proxy Docker)"
  mkdir -p "$ADMIN_DIR/jobs" "$ADMIN_DIR/tmp"
  touch "$ADMIN_DIR/audit.log"
  chmod 700 "$ADMIN_DIR" "$ADMIN_DIR/jobs" "$ADMIN_DIR/tmp"; chmod 600 "$ADMIN_DIR/audit.log"
  local uid="$OPERATOR_UID"
  [[ "$root_fallback" == 1 ]] && uid=0
  # État du service à l'uid du service (jetons de service : lecture seule pour lui, écrits par le kit).
  chown -R "$uid:$uid" "$ADMIN_DIR/jobs" "$ADMIN_DIR/tmp" "$ADMIN_DIR/audit.log"
  chown "$uid:$uid" "$ADMIN_DIR"
  [[ -f "$ADMIN_DIR/service-tokens.json" ]] && chown "$uid:$uid" "$ADMIN_DIR/service-tokens.json"
  ok "dossier d'état $ADMIN_DIR (uid $uid)"

  [[ -f "$ADMIN_ENV" ]] || { touch "$ADMIN_ENV"; chmod 600 "$ADMIN_ENV"; }
  [[ -n "$image" ]] || image="$(env_get "$ADMIN_ENV" POLENTA_ADMIN_IMAGE)"; image="${image:-polenta-admin}"
  [[ -n "$version" ]] || version="$(env_get "$ADMIN_ENV" POLENTA_ADMIN_VERSION)"
  if [[ -n "$build" ]]; then
    [[ -f "$build/deploy/admin/Dockerfile" ]] || die "$E_USAGE" "--build : $build n'est pas un clone du monorepo Polenta."
    version="${version:-$(git -C "$build" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M)}"
    docker build -q -f "$build/deploy/admin/Dockerfile" -t "$image:$version" "$build" >/dev/null
    ok "image $image:$version construite"
  else
    [[ -n "$version" ]] || die "$E_USAGE" "--version requis (ou --build <monorepo>)."
    docker image inspect "$image:$version" >/dev/null 2>&1 || docker pull -q "$image:$version" >/dev/null \
      || die "$E_NO_VERSION" "image introuvable : $image:$version"
    ok "image $image:$version"
  fi
  env_set "$ADMIN_ENV" POLENTA_ADMIN_IMAGE "$image"
  env_set "$ADMIN_ENV" POLENTA_ADMIN_VERSION "$version"
  env_set "$ADMIN_ENV" POLENTA_ADMIN_UID "$uid"
  env_set "$ADMIN_ENV" POLENTA_ADMIN_GID "$uid"
  env_set "$ADMIN_ENV" POLENTA_HOST_NAME "$(hostname)"
  env_set "$ADMIN_ENV" EDGE_NETWORK "$(caddy_mode_external && printf '%s' "$EDGE_NETWORK" || true)"

  admin_compose up -d --remove-orphans >/dev/null
  ok "polenta-admin et polenta-docker-proxy démarrés"
  # Aucun port publié (critère 3) : vérification après démarrage.
  local published
  published="$(docker ps --filter label=com.docker.compose.project=polenta-admin --format '{{.Names}} {{.Ports}}' | awk '$2 ~ /->/')"
  [[ -z "$published" ]] || die "port publié inattendu : $published"
  ok "aucun port publié"

  # Les instances rejoignent polenta-admin-net (forge + client web) et reçoivent leur jeton de service.
  local name
  for name in $(list_instances); do
    [[ -f "$(instance_dir "$name")/.add-complete" ]] || continue
    "$SCRIPT_DIR/../polenta-host.sh" instance sync "$name" --non-interactive >/dev/null \
      && ok "instance $name rattachée" || warn "instance $name : « polenta-host instance sync $name » à relancer."
  done
  log "Module admin prêt. Journal : docker logs polenta-admin ; audit : $ADMIN_DIR/audit.log"
}

caddy_mode_external() { [[ "${CADDY_MODE:-managed}" == external ]]; }

main "$@"
