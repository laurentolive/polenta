# GH63 — image du service d'administration `polenta-admin` et du proxy Docker `polenta-docker-proxy`
# (specs/GH63-design.md §3.1, §6.1). Une image, deux points d'entrée.
#
# Contexte de build = racine du monorepo :
#   docker build -f deploy/admin/Dockerfile -t polenta-admin:<version> .
#
# Le service lance les scripts du kit (copiés en /opt/polenta-kit) : bash, jq, curl, dig, restic,
# flock, git et la CLI docker/compose (qui parle au proxy, jamais au socket). Utilisateur 1500.

FROM node:22-bookworm AS build
WORKDIR /src
# npm (et non corepack) : suit HTTP(S)_PROXY lors d'un build derrière un proxy.
RUN npm i -g pnpm@9.15.9
COPY . .
ENV CI=true ELECTRON_SKIP_BINARY_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @polenta/admin-service... \
 && pnpm --filter @polenta/admin-service build

FROM node:22-alpine
# Outils GNU (sed -u, find -printf, grep -P…) : les scripts du kit sont écrits pour Debian/Ubuntu,
# pas pour les variantes busybox d'Alpine.
RUN apk add --no-cache bash jq curl bind-tools restic util-linux util-linux-misc git coreutils tar gzip \
      sed grep gawk findutils diffutils procps-ng iproute2 openssl \
      docker-cli docker-cli-compose tini \
 && addgroup -g 1500 polenta-ops \
 && adduser -D -H -u 1500 -G polenta-ops -s /sbin/nologin polenta-ops
COPY --from=build /src/apps/admin-service/dist /app/dist
COPY deploy /opt/polenta-kit
RUN chmod 755 /opt/polenta-kit/*.sh \
 && ln -s /opt/polenta-kit/polenta-host.sh /usr/local/bin/polenta-host \
 && ln -s /opt/polenta-kit/polenta-admin.sh /usr/local/bin/polenta-admin
ENV NODE_ENV=production \
    POLENTA_ROOT=/opt/polenta \
    POLENTA_KIT_DIR=/opt/polenta-kit \
    POLENTA_ADMIN_PORT=8787 \
    HOME=/tmp
USER 1500:1500
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "/app/dist/index.cjs"]
