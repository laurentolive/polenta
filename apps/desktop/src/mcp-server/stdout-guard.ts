/**
 * Réserve stdout au protocole MCP (GH23).
 *
 * Les services du process principal réutilisés par le conteneur MCP (index des exigences/tests,
 * workspace, schéma…) journalisent via `console.log` — donc sur stdout, où un client MCP strict
 * tente de parser chaque ligne comme du JSON-RPC. Ce module redirige `console.log/info/debug`
 * vers stderr ; il doit être le premier import de `index.ts` pour s'appliquer avant tout autre
 * code. Le transport stdio écrit via `process.stdout.write`, qui n'est pas affecté.
 */

console.log = console.error
console.info = console.error
console.debug = console.error
