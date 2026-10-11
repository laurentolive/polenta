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
    name: polenta-edge
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

caddy_write_compose() {
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
  local net="$1"
  if docker inspect -f '{{json .NetworkSettings.Networks}}' "$CADDY_CONTAINER" | jq -e --arg n "$net" 'has($n)' >/dev/null; then
    return 0
  fi
  docker network connect "$net" "$CADDY_CONTAINER"
}

caddy_disconnect_network() {
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

# Ajoute (ou met à jour) le site d'une instance, à chaud.
caddy_add_site() {
  local name="$1" domain="$2"
  caddy_write_compose || true
  caddy_connect_network "polenta-$name"
  local site="$POLENTA_CADDY/etc/sites/$name.caddy"
  if write_if_changed "$site" "$(caddy_render_site "$name" "$domain")"; then
    # Rechargement refusé : on retire le fichier, sinon une relance le croirait déjà appliqué et
    # tout rechargement ultérieur (autres instances) importerait ce site invalide.
    if ! caddy_reload; then
      rm -f "$site"; caddy_reload || true
      die "Caddy refuse la configuration du site $domain (détail ci-dessus)."
    fi
    ok "site Caddy $domain"
  else
    skip "site Caddy $domain"
  fi
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
  local site="$POLENTA_CADDY/etc/sites/$name.web.caddy"
  if write_if_changed "$site" "$(caddy_render_web_site "$name" "$domain")"; then
    if ! caddy_reload; then
      rm -f "$site"; caddy_reload || true
      die "Caddy refuse la configuration du site $domain (détail ci-dessus)."
    fi
    ok "site Caddy $domain (client web)"
  else
    skip "site Caddy $domain (client web)"
  fi
}

caddy_remove_web_site() {
  rm -f "$POLENTA_CADDY/etc/sites/$1.web.caddy"
  caddy_reload || true
}

caddy_remove_site() {
  local name="$1"
  rm -f "$POLENTA_CADDY/etc/sites/$name.caddy" "$POLENTA_CADDY/etc/sites/$name.web.caddy"
  caddy_reload || true
  caddy_disconnect_network "polenta-$name"
  caddy_write_compose || true
}
