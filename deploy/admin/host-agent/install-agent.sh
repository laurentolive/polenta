#!/usr/bin/env bash
# GH63 — installe (ou retire) l'agent hôte de l'administration Polenta (specs/GH63-design.md §5.6).
# Rejouable. Root, par SSH :
#
#   sudo /opt/polenta/kit/admin/host-agent/install-agent.sh
#   sudo /opt/polenta/kit/admin/host-agent/install-agent.sh --remove
#
# Unité systemd root sans réseau, joignable seulement par /run/polenta/agent.sock (0660
# root:polenta-agent). Node.js est installé depuis les paquets du système s'il manque (aucune
# dépendance npm). Sans agent, le service d'administration fonctionne, actions « hôte » grisées.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=../../lib/common.sh
. "$SCRIPT_DIR/../../lib/common.sh"

UNIT=polenta-host-agent
UNIT_FILE="/etc/systemd/system/$UNIT.service"
SOCKET=/run/polenta/agent.sock

remove() {
  log "Retrait de l'agent hôte"
  systemctl disable --now "$UNIT" >/dev/null 2>&1 || true
  rm -f "$UNIT_FILE"; systemctl daemon-reload
  ok "agent arrêté et retiré (le service d'administration le voit « absent »)"
}

main() {
  case "${1:-}" in
    --remove) require_root; remove; return ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; return ;;
    "") ;;
    *) die "$E_USAGE" "option inconnue : $1" ;;
  esac
  require_root
  command -v systemctl >/dev/null || die "$E_PRECOND" "systemd requis pour l'agent hôte."
  log "Agent hôte (polenta-host-agent)"
  if ! command -v node >/dev/null; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
    ok "Node.js $(node --version) installé"
  else
    skip "Node.js $(node --version)"
  fi
  if getent group polenta-agent >/dev/null; then skip "groupe polenta-agent"; else groupadd --system polenta-agent; ok "groupe polenta-agent"; fi
  install -m 644 "$SCRIPT_DIR/$UNIT.service" "$UNIT_FILE"
  # Le kit installé (/opt/polenta/kit) porte le code de l'agent ; l'unité y pointe.
  [[ -f "$POLENTA_ROOT/kit/admin/host-agent/polenta-host-agent.js" ]] \
    || die "$E_PRECOND" "kit absent de $POLENTA_ROOT/kit : lancez d'abord « polenta-host setup »."
  systemctl daemon-reload
  systemctl enable "$UNIT" >/dev/null 2>&1
  systemctl restart "$UNIT"
  local i
  for i in $(seq 1 20); do [[ -S "$SOCKET" ]] && break; sleep 0.5; done
  [[ -S "$SOCKET" ]] || die "agent démarré mais socket $SOCKET absent (journalctl -u $UNIT)."
  ok "agent actif, socket $SOCKET ($(stat -c '%a %U:%G' "$SOCKET"))"
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx polenta-admin; then
    docker restart polenta-admin >/dev/null && ok "service d'administration redémarré (agent vu « up »)"
  fi
}

main "$@"
