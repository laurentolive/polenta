/**
 * GH63 — point d'entrée de `polenta-docker-proxy` (même image que le service).
 */
import { createProxy } from './server'

const port = Number(process.env.POLENTA_DOCKER_PROXY_PORT || 2375)
const server = createProxy({
  socketPath: process.env.POLENTA_DOCKER_SOCKET || '/var/run/docker.sock',
  edgeNetwork: process.env.EDGE_NETWORK || undefined,
})

server.listen(port, '0.0.0.0', () => console.log(`polenta-docker-proxy : API Docker filtrée sur le port ${port}`))
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => server.close(() => process.exit(0)))
