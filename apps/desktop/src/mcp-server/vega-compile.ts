// GH74 — point d'entrée du bundle ESM `out/mcp-server/vega-compile.mjs` (scripts/build-mcp-server.ts).
// Vega 6 est ESM seul, avec un `await` de premier niveau : il ne se bundle pas dans le serveur MCP
// (CommonJS). Le serveur le charge par import dynamique (`spec-compile.ts`).
export { compile } from 'vega-lite'
