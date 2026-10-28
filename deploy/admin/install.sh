#!/usr/bin/env bash
# GH63 — module « admin » : installe (ou remet à niveau) le service d'administration et le proxy
# Docker sur un hôte du kit (specs/GH63-design.md §3.1, §6.1). Rejouable. Hors interface : root, SSH.
#
#   sudo /opt/polenta/kit/admin/install.sh [--image i] [--version v] [--build <monorepo>]
#   sudo /opt/polenta/kit/admin/install.sh --remove
#
# Pré-requis : `polenta-host setup` fait (Docker, kit dans /opt/polenta/kit), ADMIN_UI=on et, pour le
# niveau hôte, ADMIN_INSTANCE dans /opt/polenta/host.env. L'image est tirée (--image/--version) ou
# construite depuis un clone du monorepo (--build, Dockerfile deploy/admin/Dockerfile).
#
# Le service tourne en root DANS son conteneur (décision du 2026-10-28, design D10) : les scripts du kit
# écrivent leur état en root 0600 et la forge ses données en 1000:1000. Il n'a que quatre capacités de
# fichier, aucun socket Docker, aucun port, un seul montage (/opt/polenta).
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=../lib/common.sh
. "$SCRIPT_DIR/../lib/common.sh"

ADMIN_DIR="$POLENTA_ROOT/admin"
ADMIN_ENV="$ADMIN_DIR/admin.env"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

admin_compose() {
  docker compose -p polenta-admin --env-file "$ADMIN_ENV" -f "$COMPOSE_FILE" "$@"
}

remove() {
  log "Désinstallation du module admin"
  if [[ -f "$ADMIN_ENV" ]]; then admin_compose down; ok "service et proxy arrêtés"; else skip "service absent"; fi
  warn "audit et travaux conservés dans $ADMIN_DIR ; ADMIN_UI=off dans $HOST_ENV puis « polenta-host instance sync <nom> » pour retirer les instances du réseau polenta-admin-net."
}

main() {
  local image="" version="" build=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --image) image="$2"; shift 2 ;;
      --version) version="$2"; shift 2 ;;
      --build) build="$2"; shift 2 ;;
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
  chown -R 0:0 "$ADMIN_DIR"
  ok "dossier d'état $ADMIN_DIR"

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
