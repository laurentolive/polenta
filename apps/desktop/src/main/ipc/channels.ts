/**
 * GH44 — channels enregistrés par `registerDesktopOnlyHandlers` (desktop-only.handlers.ts) : propres
 * au poste local, jamais enregistrés par le serveur web. Liste vérifiée par les tests du serveur web
 * (channel-policy.test.ts) et par une assertion au démarrage du desktop.
 */
export const DESKTOP_ONLY_CHANNELS = [
  'auth:device-flow-start',
  'auth:device-flow-poll',
  'auth:logout',
  'auth:open-password-change',
  'app:set-title',
  'app:get-version',
  'app:open-release-page',
  'update:get-state',
  'update:install',
  'campaigns:execution-sheet-export',
  'campaigns:execution-sheet-preview',
  'dialog:pick-folder',
  'dialog:pick-image-file',
  'dialog:pick-drawio-file',
  'drawio:open-external',
  'image:pick-file',
  'export:save',
  'export:show-in-folder',
  'export:open-file',
] as const
