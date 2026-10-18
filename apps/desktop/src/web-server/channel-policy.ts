/**
 * GH44 — liste blanche des channels appelables depuis le navigateur (specs/GH44-design.md §4.3).
 *
 * Tout channel enregistré par `registerHandlers` (noyau partagé) est soit exposé, soit
 * explicitement masqué ici ; `channel-policy.test.ts` échoue si un nouveau channel n'est classé
 * nulle part. Un channel non exposé répond 404, même s'il est enregistré : un oubli ne peut jamais
 * ouvrir un channel au navigateur.
 */

/** Channels du noyau partagé exposés au navigateur (liste blanche, design D6). */
export const WEB_EXPOSED: ReadonlySet<string> = new Set([
  'app:get-machine-config', 'app:get-settings', 'app:get-team-config', 'app:refresh-team-config', 'app:set-settings',
  'app:team-projects',
  'auth:current-account', 'auth:has-any-account', 'auth:project-username', 'auth:resolve-identity',
  'baseline:create', 'baseline:delete', 'baseline:get', 'baseline:get-integration-branch',
  'baseline:list', 'baseline:set-integration-branch',
  'campaigns:add-tests', 'campaigns:close', 'campaigns:create', 'campaigns:delete',
  'campaigns:duplicate-test', 'campaigns:execution-sheet-apply', 'campaigns:get', 'campaigns:list',
  'campaigns:preview-params', 'campaigns:remove-entries', 'campaigns:update',
  'campaigns:update-run', 'campaigns:update-run-params',
  'dashboards:add-widget', 'dashboards:create', 'dashboards:delete', 'dashboards:delete-widget',
  'dashboards:get', 'dashboards:list', 'dashboards:order-get', 'dashboards:order-set',
  'dashboards:param-values-get', 'dashboards:param-values-set', 'dashboards:set-scope', 'dashboards:set-widget-order', 'dashboards:update',
  'dashboards:update-widget',
  'drawio:read',
  'export-templates:install-examples', 'export-templates:list',
  'forge:accounts', 'forge:creatable-orgs', 'forge:list-repos', 'forge:org-members', 'forge:repo-access',
  'git:head-sha',
  'history:backfill', 'history:get',
  'image:read', 'image:write-paste',
  'impact-analysis:create', 'impact-analysis:delete', 'impact-analysis:get',
  'integration:create', 'integration:designate', 'integration:state',
  'impact-analysis:list', 'impact-analysis:local', 'impact-analysis:update-status',
  'interface:compliance-matrix', 'interface:coverage',
  'merge-resolution:abandon', 'merge-resolution:finalize', 'merge-resolution:get',
  'merge-resolution:get-file', 'merge-resolution:keep-both', 'merge-resolution:list',
  'merge-resolution:open', 'merge-resolution:save-file', 'merge-resolution:validate',
  'parameters:create', 'parameters:delete', 'parameters:list', 'parameters:update',
  'parameters:usages',
  'polenta-repo:get', 'polenta-repo:save',
  'pref:get-field-visibility', 'pref:set-field-visibility',
  'queries:create', 'queries:delete',
  'queries:history-add', 'queries:history-delete', 'queries:history-list', 'queries:list',
  'queries:order-get', 'queries:order-set', 'queries:set-scope', 'queries:update',
  'requirements:create', 'requirements:get', 'requirements:link-create',
  'requirements:link-delete', 'requirements:links', 'requirements:links-all', 'requirements:list',
  'requirements:open-draft', 'requirements:transition', 'requirements:update',
  'requirements:versions',
  'revalidation:clear', 'revalidation:list',
  'reviews:approve-object', 'reviews:close', 'reviews:create', 'reviews:get', 'reviews:list',
  'reviews:revoke-approval',
  'schema:get', 'schema:invalidate', 'schema:move-element', 'schema:preview-value-renames', 'schema:rename-fields', 'schema:rename-values', 'schema:save',
  'suivi:describe-ids', 'suivi:object-types', 'suivi:render-template', 'suivi:resolve-target', 'suivi:run',
  'suivi:templates', 'suivi:updates-apply', 'suivi:updates-ignore', 'suivi:updates-list',
  'sync:auto-sync', 'sync:branches', 'sync:can-merge-remote', 'sync:checkout-branch',
  'sync:checkout-commit', 'sync:commit', 'sync:commit-diff', 'sync:commit-files',
  'sync:create-branch', 'sync:create-branch-at', 'sync:create-tag', 'sync:delete-branch',
  'sync:delete-remote-branch', 'sync:delete-tag', 'sync:diff', 'sync:diff-between',
  'sync:diff-file-between', 'sync:discard', 'sync:discard-all', 'sync:fast-forward-branch',
  'sync:fetch', 'sync:graph', 'sync:integration-state', 'sync:is-merged', 'sync:log', 'sync:merge',
  'sync:merge-into', 'sync:pull', 'sync:pull-fast-forward-only', 'sync:push', 'sync:push-branch',
  'sync:rebase', 'sync:resolve-refs', 'sync:resync-integration', 'sync:stage', 'sync:stage-all',
  'sync:status', 'sync:tags', 'sync:unstage', 'sync:unstage-all',
  'tests:create', 'tests:execute', 'tests:get', 'tests:list', 'tests:open-draft', 'tests:runs',
  'tests:update',
  'traceability:acknowledge', 'traceability:diff-requirements', 'traceability:export-csv',
  'traceability:impact', 'traceability:matrix', 'traceability:missing-links',
  'traceability:test-plan',
  'tree:generate-id', 'tree:get', 'tree:save',
  'workspace:find-by-remote', 'workspace:clear-last-opened', 'workspace:create-component-on-server',
  'workspace:create-from-clone', 'workspace:create-new', 'workspace:create-on-server',
  'workspace:detect', 'workspace:get-last-opened', 'workspace:get-tree', 'workspace:init',
  'workspace:is-empty-dir', 'workspace:list-recents', 'workspace:mark-recent', 'workspace:open',
  'workspace:open-project', 'workspace:rebuild-tree', 'workspace:remove-repo-dir',
  'workspace:rename-repo-dir', 'workspace:resolve', 'workspace:set-mount-override',
])

/** Channels du noyau partagé volontairement NON exposés au navigateur. */
export const WEB_HIDDEN: Record<string, string> = {
  // Le compte web est celui de la session (forge) : aucune gestion de jeton depuis le navigateur,
  // et un jeton ne doit jamais transiter vers lui (AC 1).
  'auth:setup': 'compte = session',
  'auth:detect-forge': 'connexion = OIDC par la forge (GH44 S3)',
  'auth:login-password': 'connexion = OIDC par la forge (GH44 S3) ; jamais de mot de passe via le serveur web',
  'auth:save-token': 'compte = session',
  'auth:get-token': 'renverrait le jeton forge au navigateur',
  'auth:delete-token': 'compte = session',
}

/**
 * Positions (dans `args`) des arguments « racine » de chaque channel — `repoPath`, `workspaceDir`,
 * `containerDir`… : chemins auxquels les services joignent des identifiants. Ils doivent être
 * absolus et dans l'espace de l'utilisateur (un chemin relatif serait résolu depuis le dossier
 * courant du serveur). Table dérivée des signatures des handlers ; `channel-policy.test.ts`
 * vérifie qu'elle reste synchronisée.
 */
export const ROOT_ARGS: Record<string, number[]> = {
  'auth:project-username': [0], 'baseline:create': [0], 'baseline:delete': [0],
  'baseline:get': [0], 'baseline:get-integration-branch': [0], 'baseline:list': [0],
  'baseline:set-integration-branch': [0], 'campaigns:add-tests': [0, 4], 'campaigns:close': [0],
  'campaigns:create': [0, 2], 'campaigns:delete': [0], 'campaigns:duplicate-test': [0, 4],
  'campaigns:execution-sheet-apply': [0, 2, 3], 'campaigns:get': [0], 'campaigns:list': [0],
  'campaigns:preview-params': [0, 3], 'campaigns:remove-entries': [0],
  'campaigns:update': [0],
  'campaigns:update-run': [0], 'campaigns:update-run-params': [0], 'dashboards:add-widget': [0],
  'dashboards:create': [0], 'dashboards:delete': [0], 'dashboards:delete-widget': [0],
  'dashboards:get': [0], 'dashboards:list': [0], 'dashboards:order-get': [0],
  'dashboards:order-set': [0], 'dashboards:param-values-get': [0], 'dashboards:param-values-set': [0],
  'dashboards:set-scope': [0], 'dashboards:set-widget-order': [0],
  'dashboards:update': [0], 'dashboards:update-widget': [0], 'drawio:read': [0],
  'git:head-sha': [0], 'history:backfill': [0], 'history:get': [0], 'image:read': [0], 'image:write-paste': [0], 'impact-analysis:create': [0],
  'impact-analysis:delete': [0], 'impact-analysis:get': [0], 'impact-analysis:list': [0],
  'impact-analysis:local': [0, 1], 'impact-analysis:update-status': [0],
  'interface:compliance-matrix': [0], 'interface:coverage': [0, 1], 'merge-resolution:list': [0],
  'merge-resolution:open': [0], 'parameters:create': [0, 2], 'parameters:delete': [0, 2],
  'parameters:list': [0, 1], 'parameters:update': [0, 3], 'parameters:usages': [0, 2],
  'polenta-repo:get': [0], 'polenta-repo:save': [0], 'pref:get-field-visibility': [0],
  'pref:set-field-visibility': [0], 'queries:create': [0],
  'queries:delete': [0], 'queries:history-add': [0],
  'queries:history-delete': [0], 'queries:history-list': [0], 'queries:list': [0],
  'queries:order-get': [0], 'queries:order-set': [0], 'queries:set-scope': [0],
  'queries:update': [0], 'suivi:describe-ids': [0, 1], 'suivi:object-types': [0, 1],
  'suivi:resolve-target': [0, 1], 'suivi:run': [0, 1], 'suivi:updates-apply': [0],
  'suivi:updates-ignore': [0], 'suivi:updates-list': [0], 'requirements:create': [0, 2], 'requirements:get': [0],
  'requirements:link-create': [0], 'requirements:link-delete': [0], 'requirements:links': [0],
  'requirements:links-all': [0], 'requirements:list': [0], 'requirements:open-draft': [0, 3],
  'requirements:transition': [0, 3], 'requirements:update': [0, 3], 'requirements:versions': [0],
  'revalidation:clear': [0, 2], 'revalidation:list': [0, 1], 'reviews:approve-object': [0],
  'reviews:close': [0], 'reviews:create': [0], 'reviews:get': [0], 'reviews:list': [0],
  'reviews:revoke-approval': [0], 'schema:get': [0], 'schema:invalidate': [0],
  'schema:move-element': [0], 'schema:preview-value-renames': [0], 'schema:rename-fields': [0], 'schema:rename-values': [0], 'schema:save': [0], 'sync:auto-sync': [0], 'sync:branches': [0],
  'sync:can-merge-remote': [0], 'sync:checkout-branch': [0], 'sync:checkout-commit': [0],
  'sync:commit': [0], 'sync:commit-diff': [0], 'sync:commit-files': [0], 'sync:create-branch': [0],
  'sync:create-branch-at': [0], 'sync:create-tag': [0], 'sync:delete-branch': [0],
  'sync:delete-remote-branch': [0], 'sync:delete-tag': [0], 'sync:diff': [0],
  'sync:diff-between': [0], 'sync:diff-file-between': [0], 'sync:discard': [0],
  'sync:discard-all': [0], 'sync:fast-forward-branch': [0], 'sync:fetch': [0], 'sync:graph': [0],
  'sync:integration-state': [0], 'sync:is-merged': [0], 'sync:log': [0], 'sync:merge': [0],
  'sync:merge-into': [0], 'sync:pull': [0], 'sync:pull-fast-forward-only': [0], 'sync:push': [0],
  'sync:push-branch': [0], 'sync:rebase': [0], 'sync:resolve-refs': [0],
  'sync:resync-integration': [0], 'sync:stage': [0], 'sync:stage-all': [0], 'sync:status': [0],
  'sync:tags': [0], 'sync:unstage': [0], 'sync:unstage-all': [0], 'tests:create': [0, 2],
  'tests:execute': [0, 3], 'tests:get': [0], 'tests:list': [0], 'tests:open-draft': [0, 3],
  'tests:runs': [0], 'tests:update': [0, 3], 'traceability:acknowledge': [0],
  'traceability:diff-requirements': [0], 'traceability:export-csv': [0, 2],
  'traceability:impact': [0, 3], 'traceability:matrix': [0, 2],
  'traceability:missing-links': [0, 1], 'traceability:test-plan': [0, 2], 'tree:get': [0],
  'tree:save': [0], 'web:delete-workspace': [0], 'web:drawio-import': [0],
  'web:execution-sheet-export': [0], 'web:execution-sheet-preview': [0], 'web:export': [0],
  'web:image-import': [0], 'workspace:create-from-clone': [0], 'workspace:create-new': [0],
  'workspace:create-on-server': [0], 'forge:repo-access': [0], 'forge:org-members': [0],
  'integration:create': [0], 'integration:designate': [0], 'integration:state': [0],
  'workspace:detect': [0], 'workspace:get-tree': [0], 'workspace:init': [0, 1],
  'workspace:is-empty-dir': [0], 'workspace:mark-recent': [0], 'workspace:open': [0],
  'workspace:open-project': [0], 'workspace:rebuild-tree': [0], 'workspace:remove-repo-dir': [0],
  'workspace:rename-repo-dir': [0], 'workspace:resolve': [0], 'workspace:set-mount-override': [0],
}

/** Nom de paramètre de handler désignant une racine (utilisé par le test de synchronisation). */
export const ROOT_PARAM_NAME = /^(?!rel)[a-zA-Z]*(RepoPath|repoPath|repoPaths|Dir|dir)$|^filePath$/

/**
 * Arguments de premier niveau en texte libre (index dans `args`, événement exclu) : non soumis à la
 * règle « pas de segment `..` » de la garde de chemins.
 */
export const CONTENT_ARGS: Record<string, number[]> = {
  'sync:commit': [1], // message
  'merge-resolution:validate': [2], // contenu du fichier
  'requirements:open-draft': [2], // commentaire
}

/**
 * Channels propres au serveur web (`web-handlers.ts`), en plus du noyau partagé. Ils passent par la
 * même garde de chemins.
 */
export const WEB_ONLY_CHANNELS = [
  'app:get-version',
  'web:workspaces-root',
  'web:list-workspaces',
  'web:new-workspace-dir',
  'web:delete-workspace',
  'web:image-import',
  'web:drawio-import',
  'web:execution-sheet-preview',
  'web:execution-sheet-export',
  'web:export',
] as const

const WEB_ONLY: ReadonlySet<string> = new Set(WEB_ONLY_CHANNELS)

export function isExposed(channel: string): boolean {
  return WEB_EXPOSED.has(channel) || WEB_ONLY.has(channel)
}
