#!/usr/bin/env bash
# GH45 — Caddy partagé de l'hôte : un fichier de site par instance, relié à chaud au réseau Docker
# de chaque instance (aucune instance ne partage de réseau avec une autre — design §5.3).
# Sourcé après common.sh.

CADDY_CONTAINER="polenta-caddy"

# Génère le docker-compose de Caddy avec la liste des réseaux d'instance (externes). Le fichier
# n'est appliqué qu'au (re)démarrage de Caddy : en fonctionnement, les réseaux sont reliés à chaud
# par caddy_connect_network, sans recréer le conteneur.
caddy_render_compose() {
  local nets="" decl="" name
  for name in $(list_instances); do
    # Seulement les réseaux qui existent : une instance dont l'ajout a échoué avant son premier
    # démarrage n'a pas encore de réseau, et un réseau externe absent empêcherait Caddy de démarrer.
    docker network inspect "polenta-$name" >/dev/null 2>&1 || continue
    nets+="      - polenta-$name"$'\n'
    decl+="  polenta-$name:"$'\n'"    external: true"$'\n'
  done
  cat <<EOF
# Généré par polenta-host — ne pas éditer à la main.
name: polenta-caddy
services:
  caddy:
    image: caddy:${CADDY_VERSION}
    container_name: ${CADDY_CONTAINER}
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ${POLENTA_CADDY}/etc:/etc/caddy:ro
      - ${POLENTA_CADDY}/data:/data
      - ${POLENTA_CADDY}/config:/config
    networks:
      - edge
${nets}networks:
  edge:
    name: ${EDGE_NETWORK:-$DEFAULT_EDGE_NETWORK}
${decl}
EOF
}

# Caddyfile de l'hôte : options globales + un fichier par instance. L'e-mail ACME est facultatif
# (avis d'expiration de certificat) : pas de ligne email s'il n'est pas renseigné.
caddy_render_caddyfile() {
  printf '# Généré par polenta-host — ne pas éditer à la main.\n{\n'
  if [[ -n "${ACME_EMAIL:-}" ]]; then printf '\temail %s\n' "$ACME_EMAIL"; fi
  printf '\tadmin localhost:2019\n}\n\nimport /etc/caddy/sites/*.caddy\n'
}

# GH61 — mode external : le kit ne crée aucun fichier ni conteneur Caddy.
caddy_external() { [[ "${CADDY_MODE:-managed}" == external ]]; }

# Dossier des blocs de site : celui du Caddy du kit (managed) ou CADDY_SITES_DIR (external).
caddy_sites_dir() {
  if caddy_external; then printf '%s' "$CADDY_SITES_DIR"; else printf '%s/etc/sites' "$POLENTA_CADDY"; fi
}

caddy_write_compose() {
  caddy_external && return 1
  mkdir -p "$POLENTA_CADDY"/{etc/sites,data,config}
  local changed=1
  write_if_changed "$POLENTA_CADDY/etc/Caddyfile" "$(caddy_render_caddyfile)" && changed=0
  write_if_changed "$POLENTA_CADDY/docker-compose.yml" "$(caddy_render_compose)" && changed=0
  return $changed
}

caddy_compose() { docker compose -f "$POLENTA_CADDY/docker-compose.yml" "$@"; }

caddy_running() {
  [[ "$(docker inspect -f '{{.State.Running}}' "$CADDY_CONTAINER" 2>/dev/null)" == true ]]
}

# Démarre Caddy si besoin (ne le recrée que si sa configuration compose a changé).
caddy_up() {
  caddy_write_compose || true
  local before; before="$(docker inspect -f '{{.Id}}' "$CADDY_CONTAINER" 2>/dev/null || true)"
  caddy_compose up -d --quiet-pull >/dev/null 2>&1 || caddy_compose up -d
  local after; after="$(docker inspect -f '{{.Id}}' "$CADDY_CONTAINER" 2>/dev/null || true)"
  if [[ "$before" == "$after" ]]; then
    caddy_reload || true   # Caddyfile éventuellement modifié : rechargement à chaud, sans coupure
    skip "Caddy en service"
  else
    ok "Caddy démarré"
  fi
}

caddy_connect_network() {
  caddy_external && return 0   # GH61 : le Caddy existant est déjà sur EDGE_NETWORK, jamais relié à chaud
  local net="$1"
  if docker inspect -f '{{json .NetworkSettings.Networks}}' "$CADDY_CONTAINER" | jq -e --arg n "$net" 'has($n)' >/dev/null; then
    return 0
  fi
  docker network connect "$net" "$CADDY_CONTAINER"
}

caddy_disconnect_network() {
  caddy_external && return 0
  docker network disconnect "$1" "$CADDY_CONTAINER" 2>/dev/null || true
}

caddy_render_site() {
  local name="$1" domain="$2"
  cat <<EOF
# Instance ${name} — généré par polenta-host, ne pas éditer à la main.
${domain} {
	encode zstd gzip
	# Les push git transportent le packfile dans le corps : limite large (design §5.3, écart
	# assumé aux 60 Mo initiaux qui auraient bloqué le premier push d'un gros dépôt).
	request_body {
		max_size 1GB
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		X-Frame-Options "SAMEORIGIN"
		-Server
	}
	reverse_proxy forgejo-${name}:3000
}
EOF
}

# Rechargement à chaud ; la sortie (journaux JSON de Caddy) n'est affichée qu'en cas d'échec.
caddy_reload() {
  local out
  if ! out="$(docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1)"; then
    printf '%s\n' "$out" >&2
    return 1
  fi
}

# GH61 — commande de rechargement du Caddy existant (CADDY_RELOAD_CMD, exécutée en root). Vide :
# un seul avertissement par processus. Sortie affichée seulement en cas d'échec.
EXTERNAL_RELOAD_WARNED=0
external_reload() {
  if [[ -z "${CADDY_RELOAD_CMD:-}" ]]; then
    if [[ $EXTERNAL_RELOAD_WARNED == 0 ]]; then
      warn "blocs de site mis à jour dans $CADDY_SITES_DIR : rechargez votre Caddy"
      EXTERNAL_RELOAD_WARNED=1
    fi
    return 0
  fi
  local out
  if ! out="$(bash -c "$CADDY_RELOAD_CMD" 2>&1)"; then
    printf '%s
' "$out" >&2
    return 1
  fi
}

# Rechargement selon le mode.
site_reload() {
  if caddy_external; then external_reload; else caddy_reload; fi
}

# Écrit un bloc de site et recharge si (et seulement si) son contenu a changé. Libellé : « domaine »
# ou « domaine (client web) ». Rechargement refusé : fichier retiré, sinon une relance le croirait
# déjà appliqué et tout rechargement ultérieur (autres instances, autres projets) importerait ce
# site invalide.
site_apply() {
  local site="$1" content="$2" label="$3"
  if write_if_changed "$site" "$content"; then
    if ! site_reload; then
      rm -f "$site"; site_reload || true
      if caddy_external; then
        die "le rechargement de votre Caddy (CADDY_RELOAD_CMD) a échoué pour le site ${label%% *} : bloc retiré (détail ci-dessus)."
      fi
      die "Caddy refuse la configuration du site ${label%% *} (détail ci-dessus)."
    fi
    ok "site Caddy $label"
  else
    skip "site Caddy $label"
  fi
}

# Ajoute (ou met à jour) le site d'une instance, à chaud.
caddy_add_site() {
  local name="$1" domain="$2"
  caddy_write_compose || true
  caddy_connect_network "polenta-$name"
  site_apply "$(caddy_sites_dir)/$name.caddy" "$(caddy_render_site "$name" "$domain")" "$domain"
}

# GH44 — site du client web d'une instance : fichier distinct (`<nom>.web.caddy`), même en-têtes que
# la forge. Caddy relaie la WebSocket des événements (/events) sans configuration particulière.
caddy_render_web_site() {
  local name="$1" domain="$2"
  cat <<EOF
# Client web de l'instance ${name} — généré par polenta-host, ne pas éditer à la main.
${domain} {
	encode zstd gzip
	# Uploads (images, diagrammes, classeurs) et exports : limite du serveur web (20 Mo par défaut).
	request_body {
		max_size 64MB
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		X-Frame-Options "SAMEORIGIN"
		-Server
	}
	reverse_proxy polenta-web-${name}:8787
}
EOF
}

caddy_add_web_site() {
  local name="$1" domain="$2"
  caddy_write_compose || true
  caddy_connect_network "polenta-$name"
  site_apply "$(caddy_sites_dir)/$name.web.caddy" "$(caddy_render_web_site "$name" "$domain")" "$domain (client web)"
}

# Supprime des blocs de site ; en external, rechargement seulement si un bloc existait réellement.
# Les autres fichiers du dossier (ex. _*.caddy d'autres projets) ne sont jamais touchés.
site_remove() {
  local dir f existed=0; dir="$(caddy_sites_dir)"
  for f in "$@"; do
    if [[ -e "$dir/$f" ]]; then existed=1; rm -f "$dir/$f"; fi
  done
  if caddy_external; then
    [[ $existed == 0 ]] || external_reload || warn "rechargement de votre Caddy en échec (CADDY_RELOAD_CMD) : rechargez-le à la main."
  else
    caddy_reload || true
  fi
}

caddy_remove_web_site() {
  site_remove "$1.web.caddy"
}

caddy_remove_site() {
  local name="$1"
  site_remove "$name.caddy" "$name.web.caddy"
  caddy_disconnect_network "polenta-$name"
  caddy_write_compose || true
}

# ─── GH61 : mode external ────────────────────────────────────────────────────

# external : le réseau de bord appartient à l'exploitant, le kit ne le crée jamais.
edge_network_require() {
  caddy_external || return 0
  docker network inspect "$EDGE_NETWORK" >/dev/null 2>&1     || die "réseau Docker « $EDGE_NETWORK » absent (CADDY_MODE=external) : créez-le (docker network create $EDGE_NETWORK) et rattachez-y votre Caddy."
}

# Refuse la bascule à chaud managed → external : deux Caddy ne peuvent pas se partager 80/443.
caddy_external_guard() {
  caddy_external || return 0
  command -v docker >/dev/null 2>&1 || return 0
  if caddy_running; then
    die "CADDY_MODE=external mais le conteneur $CADDY_CONTAINER tourne encore : retirez-le d'abord (docker compose -f $POLENTA_CADDY/docker-compose.yml down), cf. RUNBOOK, section Cohabitation."
  fi
}

# managed sur un hôte sans polenta-caddy : 80/443 doivent être libres (sinon Caddy ne démarrera pas).
caddy_managed_ports_guard() {
  caddy_external && return 0
  command -v ss >/dev/null 2>&1 || return 0
  if command -v docker >/dev/null 2>&1 && docker inspect "$CADDY_CONTAINER" >/dev/null 2>&1; then return 0; fi
  if ss -ltnH 2>/dev/null | awk '{print $4}' | grep -qE ':(80|443)$'; then
    die "les ports 80/443 sont occupés par un autre processus que $CADDY_CONTAINER : libérez-les, ou utilisez CADDY_MODE=external (cf. RUNBOOK, section Cohabitation)."
  fi
}

# Sonde réseau interne (external) : GET depuis un conteneur éphémère rattaché à EDGE_NETWORK, avec
# l'image de la forge de l'instance (déjà présente ; wget inclus). Prouve le routage réseau,
# pas le certificat TLS.
wait_edge_http() {
  local name="$1" target="$2" path="$3" timeout="${4:-180}" t=0
  local env img; env="$(instance_env "$name")"
  img="$(env_get "$env" FORGE_IMAGE):$(env_get "$env" FORGE_VERSION)"
  while (( t < timeout )); do
    docker run --rm --network "$EDGE_NETWORK" --entrypoint wget "$img" -qO- -T 5 "http://$target$path" >/dev/null 2>&1 && return 0
    sleep 5; t=$((t + 5))
  done
  docker inspect -f '{{json .NetworkSettings.Networks}}' "${target%%:*}" >&2 2>/dev/null || true
  die "${target%%:*} ne répond pas sur le réseau $EDGE_NETWORK après ${timeout}s (conteneur non joignable : réseau d'instance seul ? réseau $EDGE_NETWORK à jour : « polenta-host instance sync $name »)."
}
