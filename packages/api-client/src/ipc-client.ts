import type {
  ApiClient,
  CreateReviewDto,
  CreateBaselineDto,
  CreateSavedQueryDto,
  UpdateSavedQueryDto,
  AddHistoryEntryDto,
  CreateDashboardDto,
  UpdateDashboardDto,
  AddWidgetDto,
  UpdateWidgetDto,
  TemplateInput,
} from './types'
import type { ReviewStatus, QueryScope } from '@polenta/types'

// Global type injected by the preload script via contextBridge
declare global {
  interface Window {
    polenta: {
      invoke(channel: string, ...args: unknown[]): Promise<unknown>
      on(channel: string, cb: (...args: unknown[]) => void): () => void
      off(channel: string, cb: (...args: unknown[]) => void): void
    }
  }
}

/**
 * `transport` : appel IPC brut (par défaut `window.polenta.invoke`). GH45 — le renderer l'enveloppe
 * pour intercepter les erreurs d'accès à une forge en un seul point (renderer/api.ts).
 */
export function createIpcClient(
  transport: (channel: string, ...args: unknown[]) => Promise<unknown> = (channel, ...args) => window.polenta.invoke(channel, ...args),
): ApiClient {
  const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
    transport(channel, ...args) as Promise<T>

  return {
    web: {
      workspacesRoot: () => invoke('web:workspaces-root'),
      listWorkspaces: () => invoke('web:list-workspaces'),
      newWorkspaceDir: (nameHint) => invoke('web:new-workspace-dir', nameHint),
      deleteWorkspace: (workspaceDir, force) => invoke('web:delete-workspace', workspaceDir, force),
    },
    app: {
      setTitle: (title) => invoke('app:set-title', title),
      getVersion: () => invoke('app:get-version'),
      getSettings: () => invoke('app:get-settings'),
      setSettings: (patch) => invoke('app:set-settings', patch),
      openReleasePage: (url) => invoke('app:open-release-page', url),
      openLink: (url) => invoke('app:open-link', url),
      getMachineConfig: () => invoke('app:get-machine-config'),
      getTeamConfig: () => invoke('app:get-team-config'),
      refreshTeamConfig: () => invoke('app:refresh-team-config'),
      teamProjects: () => invoke('app:team-projects'),
      takePendingInvite: () => invoke('app:take-pending-invite'),
    },
    update: {
      getState: () => invoke('update:get-state'),
      install: () => invoke('update:install'),
    },
    schema: {
      get: (p) => invoke('schema:get', p),
      getAt: (p, ref) => invoke('schema:get-at', p, ref),
      save: (p, schema) => invoke('schema:save', p, schema),
      moveElement: (p, dto) => invoke('schema:move-element', p, dto),
      renameFields: (p, ref, renames) => invoke('schema:rename-fields', p, ref, renames),
      previewValueRenames: (p, ref, renames) => invoke('schema:preview-value-renames', p, ref, renames),
      renameValues: (p, ref, renames) => invoke('schema:rename-values', p, ref, renames),
      previewTypeRename: (p, workspaceDir, dto) => invoke('schema:preview-type-rename', p, workspaceDir, dto),
      renameType: (p, workspaceDir, dto) => invoke('schema:rename-type', p, workspaceDir, dto),
      previewDelete: (p, workspaceDir, target) => invoke('schema:preview-delete', p, workspaceDir, target),
      delete: (p, workspaceDir, target) => invoke('schema:delete', p, workspaceDir, target),
      invalidate: (p) => invoke('schema:invalidate', p),
    },
    tree: {
      get: (p, nodeId, typeId) => invoke('tree:get', p, nodeId, typeId),
      save: (p, tree) => invoke('tree:save', p, tree),
      generateId: () => invoke('tree:generate-id'),
    },
    forge: {
      accounts: () => invoke('forge:accounts'),
      listRepos: (accountKey) => invoke('forge:list-repos', accountKey),
      creatableOrgs: (accountKey) => invoke('forge:creatable-orgs', accountKey),
      repoAccess: (repoPath) => invoke('forge:repo-access', repoPath),
      orgMembers: (repoPath) => invoke('forge:org-members', repoPath),
    },
    workspace: {
      listRecents: () => invoke('workspace:list-recents'),
      markRecent: (workspaceDir) => invoke('workspace:mark-recent', workspaceDir),
      getLastOpened: () => invoke('workspace:get-last-opened'),
      clearLastOpened: () => invoke('workspace:clear-last-opened'),
      resolve: (workspaceDir) => invoke('workspace:resolve', workspaceDir),
      openProject: (dir) => invoke('workspace:open-project', dir),
      createNew: (containerDir, name) => invoke('workspace:create-new', containerDir, name),
      createFromClone: (containerDir, remoteUrl) => invoke('workspace:create-from-clone', containerDir, remoteUrl),
      findByRemote: (remoteUrl) => invoke('workspace:find-by-remote', remoteUrl),
      createOnServer: (containerDir, name, accountKey, org) => invoke('workspace:create-on-server', containerDir, name, accountKey, org),
      createComponentOnServer: (accountKey, org, name) => invoke('workspace:create-component-on-server', accountKey, org, name),
      // GH27
      isEmptyDir: (dir) => invoke('workspace:is-empty-dir', dir),
      // T69: flat workspace
      detect: (dir) => invoke('workspace:detect', dir),
      init: (workspaceDir, rootRepoPath) => invoke('workspace:init', workspaceDir, rootRepoPath),
      open: (workspaceDir) => invoke('workspace:open', workspaceDir),
      // T69 Sprint 2
      getTree: (workspaceDir) => invoke('workspace:get-tree', workspaceDir),
      rebuildTree: (workspaceDir) => invoke('workspace:rebuild-tree', workspaceDir),
      setMountOverride: (workspaceDir, override) => invoke('workspace:set-mount-override', workspaceDir, override),
      // T74
      removeRepoDir: (repoPath) => invoke('workspace:remove-repo-dir', repoPath),
      // T74 sprint 2
      renameRepoDir: (workspaceDir, oldMountName, newMountName) =>
        invoke('workspace:rename-repo-dir', workspaceDir, oldMountName, newMountName),
    },
    polentaRepo: {
      get: (repoPath) => invoke('polenta-repo:get', repoPath),
      save: (repoPath, manifest) => invoke('polenta-repo:save', repoPath, manifest),
    },
    auth: {
      saveToken: (r, t) => invoke('auth:save-token', r, t),
      getToken: (r) => invoke('auth:get-token', r),
      deleteToken: (r) => invoke('auth:delete-token', r),
      resolveIdentity: (r) => invoke('auth:resolve-identity', r),
      projectUsername: (p) => invoke('auth:project-username', p),
      hasAnyAccount: () => invoke('auth:has-any-account'),
      setup: (r, p) => invoke('auth:setup', r, p),
      startDeviceFlow: (r) => invoke('auth:device-flow-start', r),
      pollDeviceFlow: (r, d) => invoke('auth:device-flow-poll', r, d),
      detectForge: (serverUrl) => invoke('auth:detect-forge', serverUrl),
      loginWithPassword: (serverUrl, login, password, otp) => invoke('auth:login-password', serverUrl, login, password, otp),
      currentAccount: () => invoke('auth:current-account'),
      logout: () => invoke('auth:logout'),
      openPasswordChange: () => invoke('auth:open-password-change'),
    },
    sync: {
      status: (p) => invoke('sync:status', p),
      commit: (p, m) => invoke('sync:commit', p, m),
      push: (p) => invoke('sync:push', p),
      pull: (p) => invoke('sync:pull', p),
      fetch: (p, url, remote) => invoke('sync:fetch', p, url, remote),
      fastForwardBranch: (p, branch, remote) => invoke('sync:fast-forward-branch', p, branch, remote),
      pullFastForwardOnly: (p) => invoke('sync:pull-fast-forward-only', p),
      integrationState: (p, branch) => invoke('sync:integration-state', p, branch),
      canMergeRemoteIntoIntegration: (p, branch) => invoke('sync:can-merge-remote', p, branch),
      resyncIntegration: (p, branch) => invoke('sync:resync-integration', p, branch),
      autoSync: (p, branch) => invoke('sync:auto-sync', p, branch),
      settleAutoBranch: (p, branch) => invoke('sync:settle-auto-branch', p, branch),
      isMergedInto: (p, branch, into) => invoke('sync:is-merged', p, branch, into),
      log: (p, limit) => invoke('sync:log', p, limit),
      checkoutCommit: (p, sha) => invoke('sync:checkout-commit', p, sha),
      stage: (p, f) => invoke('sync:stage', p, f),
      stageAll: (p) => invoke('sync:stage-all', p),
      unstage: (p, f) => invoke('sync:unstage', p, f),
      unstageAll: (p) => invoke('sync:unstage-all', p),
      discard: (p, f) => invoke('sync:discard', p, f),
      discardAll: (p) => invoke('sync:discard-all', p),
      graph: (p, limit) => invoke('sync:graph', p, limit),
      diff: (p, f) => invoke('sync:diff', p, f),
      commitFiles: (p, sha) => invoke('sync:commit-files', p, sha),
      commitDiff: (p, sha, f) => invoke('sync:commit-diff', p, sha, f),
      branches: (p) => invoke('sync:branches', p),
      createBranch: (p, name) => invoke('sync:create-branch', p, name),
      checkoutBranch: (p, name) => invoke('sync:checkout-branch', p, name),
      deleteBranch: (p, name) => invoke('sync:delete-branch', p, name),
      tags: (p) => invoke('sync:tags', p),
      createTag: (p, tagName, commitSha) => invoke('sync:create-tag', p, tagName, commitSha),
      merge: (p, branch) => invoke('sync:merge', p, branch),
      mergeInto: (p, from, into) => invoke('sync:merge-into', p, from, into),
      createBranchAt: (p, name, sha) => invoke('sync:create-branch-at', p, name, sha),
      deleteRemoteBranch: (p, name, remote) => invoke('sync:delete-remote-branch', p, name, remote),
      deleteTag: (p, tagName) => invoke('sync:delete-tag', p, tagName),
      pushBranch: (p, name, remote) => invoke('sync:push-branch', p, name, remote),
      rebase: (p, onto) => invoke('sync:rebase', p, onto),
      diffBetween: (p, sha1, sha2) => invoke('sync:diff-between', p, sha1, sha2),
      diffFileBetween: (p, sha1, sha2, filepath) => invoke('sync:diff-file-between', p, sha1, sha2, filepath),
      diffElement: (p, filepath, baseSha, newSha) => invoke('sync:diff-element', p, filepath, baseSha, newSha),
      resolveRefs: (p) => invoke('sync:resolve-refs', p),
    },
    diffEdit: {
      saveWorkingFile: (p, filepath, text, baseline, workspaceDir) =>
        invoke('diff:save-working-file', p, filepath, text, baseline, workspaceDir),
    },
    mergeResolution: {
      open: (p, leftRef, rightRef, origin) => invoke('merge-resolution:open', p, leftRef, rightRef, origin),
      list: (repoPaths) => invoke('merge-resolution:list', repoPaths),
      get: (id) => invoke('merge-resolution:get', id),
      getFile: (id, path) => invoke('merge-resolution:get-file', id, path),
      saveFile: (id, path, draft) => invoke('merge-resolution:save-file', id, path, draft),
      validate: (id, path, text) => invoke('merge-resolution:validate', id, path, text),
      keepBoth: (id, path, apply) => invoke('merge-resolution:keep-both', id, path, apply),
      finalize: (id) => invoke('merge-resolution:finalize', id),
      abandon: (id) => invoke('merge-resolution:abandon', id),
    },
    git: {
      headSha: (p) => invoke('git:head-sha', p),
    },
    baseline: {
      list: (p, components) => invoke('baseline:list', p, components),
      get: (p, tag, components) => invoke('baseline:get', p, tag, components),
      create: (p, dto: CreateBaselineDto, workspaceDir) => invoke('baseline:create', p, dto, workspaceDir),
      getIntegrationBranch: (p) => invoke('baseline:get-integration-branch', p),
      setIntegrationBranch: (p, branch) => invoke('baseline:set-integration-branch', p, branch),
      delete: (p, tag, components) => invoke('baseline:delete', p, tag, components),
    },
    integration: {
      state: (p) => invoke('integration:state', p),
      designate: (p, branch) => invoke('integration:designate', p, branch),
      create: (p, suffix, from) => invoke('integration:create', p, suffix, from),
    },
    requirements: {
      list: (p, f) => invoke('requirements:list', p, f),
      get: (p, id) => invoke('requirements:get', p, id),
      create: (p, dto, workspaceDir) => invoke('requirements:create', p, dto, workspaceDir),
      update: (p, id, dto, workspaceDir) => invoke('requirements:update', p, id, dto, workspaceDir),
      openDraft: (p, id, targetStatus, workspaceDir, comment) => invoke('requirements:open-draft', p, id, targetStatus, workspaceDir, comment),
      transition: (p, id, dto, workspaceDir) => invoke('requirements:transition', p, id, dto, workspaceDir),
      // TODO: remove versioning API
      links: (p, id) => invoke('requirements:links', p, id),
      linksAll: (p) => invoke('requirements:links-all', p),
      linkCreate: (p, data, workspaceDir) => invoke('requirements:link-create', p, data, workspaceDir),
      linkDelete: (p, linkId, workspaceDir) => invoke('requirements:link-delete', p, linkId, workspaceDir),
    },
    links: {
      objects: (p, workspaceDir) => invoke('links:objects', p, workspaceDir),
      list: (p, workspaceDir) => invoke('links:list', p, workspaceDir),
      types: (p, workspaceDir) => invoke('links:types', p, workspaceDir),
    },
    tests: {
      list: (p) => invoke('tests:list', p),
      get: (p, id) => invoke('tests:get', p, id),
      create: (p, dto, workspaceDir) => invoke('tests:create', p, dto, workspaceDir),
      update: (p, id, dto, workspaceDir) => invoke('tests:update', p, id, dto, workspaceDir),
      execute: (p, id, dto, workspaceDir) => invoke('tests:execute', p, id, dto, workspaceDir),
      runs: (p, id) => invoke('tests:runs', p, id),
      typeDef: (p, ref, workspaceDir) => invoke('tests:type-def', p, ref, workspaceDir ?? null),
      openDraft: (p, id, targetStatus, workspaceDir, comment) => invoke('tests:open-draft', p, id, targetStatus, workspaceDir, comment),
    },
    traceability: {
      matrix: (p, f, workspaceDir) => invoke('traceability:matrix', p, f, workspaceDir),
      missingLinks: (p, workspaceDir) => invoke('traceability:missing-links', p, workspaceDir),
      legacyAcks: (p, id) => invoke('traceability:legacy-acks', p, id),
      testPlan: (p, dto, workspaceDir) => invoke('traceability:test-plan', p, dto, workspaceDir),
      exportCsv: (p, f, workspaceDir) => invoke('traceability:export-csv', p, f, workspaceDir),
      diffRequirements: (p, fromSha, toSha) => invoke('traceability:diff-requirements', p, fromSha, toSha),
    },
    history: {
      get: (p, kind, id) => invoke('history:get', p, kind, id),
      backfill: (p) => invoke('history:backfill', p),
    },
    revalidation: {
      list: (p, w) => invoke('revalidation:list', p, w),
      clear: (p, ids, w) => invoke('revalidation:clear', p, ids, w),
    },
    impactAnalysis: {
      local: (p, w) => invoke('impact-analysis:local', p, w),
    },
    reviews: {
      list: (p, status?: ReviewStatus) => invoke('reviews:list', p, status),
      get: (p, id) => invoke('reviews:get', p, id),
      create: (p, dto: CreateReviewDto) => invoke('reviews:create', p, dto),
      approveObject: (p, reviewId, objectId, reviewerId) =>
        invoke('reviews:approve-object', p, reviewId, objectId, reviewerId),
      revokeApproval: (p, reviewId, objectId, reviewerId) =>
        invoke('reviews:revoke-approval', p, reviewId, objectId, reviewerId),
      close: (p, reviewId, status) => invoke('reviews:close', p, reviewId, status),
    },
    campaigns: {
      list: (p, component, level) => invoke('campaigns:list', p, component, level),
      get: (p, id) => invoke('campaigns:get', p, id),
      create: (p, dto, workspaceDir) => invoke('campaigns:create', p, dto, workspaceDir),
      update: (p, id, dto) => invoke('campaigns:update', p, id, dto),
      updateRun: (p, campaignId, entryId, status, runId, displayed) =>
        invoke('campaigns:update-run', p, campaignId, entryId, status, runId, displayed),
      close: (p, id, status) => invoke('campaigns:close', p, id, status),
      addTests: (p, campaignId, testCaseIds, paramValuesByTest, workspaceDir, reqInstances, carried) =>
        invoke('campaigns:add-tests', p, campaignId, testCaseIds, paramValuesByTest, workspaceDir, reqInstances, carried),
      removeEntries: (p, campaignId, entryIds) => invoke('campaigns:remove-entries', p, campaignId, entryIds),
      duplicateTest: (p, campaignId, testCaseId, paramValues, workspaceDir, requirementId) =>
        invoke('campaigns:duplicate-test', p, campaignId, testCaseId, paramValues, workspaceDir, requirementId),
      previewParams: (p, source, testCaseIds, workspaceDir) =>
        invoke('campaigns:preview-params', p, source, testCaseIds, workspaceDir),
      updateRunParams: (p, campaignId, entryId, paramValues) =>
        invoke('campaigns:update-run-params', p, campaignId, entryId, paramValues),
      delete: (p, id) => invoke('campaigns:delete', p, id),
      executionSheet: {
        export: (p, campaignId, locale) => invoke('campaigns:execution-sheet-export', p, campaignId, locale),
        preview: (p, campaignId) => invoke('campaigns:execution-sheet-preview', p, campaignId),
        apply: (p, campaignId, filePath, workspaceDir) =>
          invoke('campaigns:execution-sheet-apply', p, campaignId, filePath, workspaceDir),
      },
    },
    dialog: {
      pickFolder: (title) => invoke('dialog:pick-folder', title),
      pickImageFile: () => invoke('dialog:pick-image-file'),
    },
    // GH197 — historique des exécutions
    executions: {
      history: (p, target, workspaceDir) => invoke('executions:history', p, target, workspaceDir ?? null),
    },
    drawio: {
      pickFile: (repoPath) => invoke('dialog:pick-drawio-file', repoPath),
      read: (repoPath, relativePath, ref) => invoke('drawio:read', repoPath, relativePath, ref ?? null),
      openExternal: (repoPath, relativePath) => invoke('drawio:open-external', repoPath, relativePath),
    },
    image: {
      pickFile: (repoPath) => invoke('image:pick-file', repoPath),
      read: (repoPath, relativePath, ref) => invoke('image:read', repoPath, relativePath, ref ?? null),
      writePaste: (repoPath, mimeType, base64) => invoke('image:write-paste', repoPath, mimeType, base64),
    },
    pref: {
      getFieldVisibility: (repoPath, username, typeKey) =>
        invoke('pref:get-field-visibility', repoPath, username, typeKey),
      setFieldVisibility: (repoPath, username, typeKey, views) =>
        invoke('pref:set-field-visibility', repoPath, username, typeKey, views),
      getPublishMerge: (repoPath, username, branch) => invoke('pref:get-publish-merge', repoPath, username, branch),
      setPublishMerge: (repoPath, username, branch, merge) =>
        invoke('pref:set-publish-merge', repoPath, username, branch, merge),
    },
    suivi: {
      run: (repoPath, workspaceDir, username, req, client) => invoke('suivi:run', repoPath, workspaceDir, username, req, client),
      describeIds: (repoPath, workspaceDir, ids, locale) => invoke('suivi:describe-ids', repoPath, workspaceDir, ids, locale),
      resolveTarget: (repoPath, workspaceDir, id) => invoke('suivi:resolve-target', repoPath, workspaceDir, id),
      templates: () => invoke('suivi:templates'),
      renderTemplate: ((kind: 'query' | 'widget', input: TemplateInput) => invoke('suivi:render-template', kind, input)) as ApiClient['suivi']['renderTemplate'],
      objectTypes: (repoPath, workspaceDir) => invoke('suivi:object-types', repoPath, workspaceDir),
      updatesList: (repoPath, username, locale) => invoke('suivi:updates-list', repoPath, username, locale),
      updatesApply: (repoPath, username, ids, locale) => invoke('suivi:updates-apply', repoPath, username, ids, locale),
      updatesIgnore: (repoPath, username, id, toVersion) => invoke('suivi:updates-ignore', repoPath, username, id, toVersion),
    },
    queries: {
      list: (repoPath, username) => invoke('queries:list', repoPath, username),
      create: (repoPath, username, dto: CreateSavedQueryDto) => invoke('queries:create', repoPath, username, dto),
      update: (repoPath, username, id, dto: UpdateSavedQueryDto) => invoke('queries:update', repoPath, username, id, dto),
      delete: (repoPath, username, id) => invoke('queries:delete', repoPath, username, id),
      historyList: (repoPath, username) => invoke('queries:history-list', repoPath, username),
      historyAdd: (repoPath, username, entry: AddHistoryEntryDto) => invoke('queries:history-add', repoPath, username, entry),
      historyDelete: (repoPath, username, id) => invoke('queries:history-delete', repoPath, username, id),
      getOrder: (repoPath, username) => invoke('queries:order-get', repoPath, username),
      setOrder: (repoPath, username, order) => invoke('queries:order-set', repoPath, username, order),
      setScope: (repoPath, username, id, scope: QueryScope) => invoke('queries:set-scope', repoPath, username, id, scope),
    },
    dashboards: {
      list: (repoPath, username, locale?: string) => invoke('dashboards:list', repoPath, username, locale),
      get: (repoPath, username, id) => invoke('dashboards:get', repoPath, username, id),
      create: (repoPath, username, dto: CreateDashboardDto) => invoke('dashboards:create', repoPath, username, dto),
      update: (repoPath, username, id, dto: UpdateDashboardDto) => invoke('dashboards:update', repoPath, username, id, dto),
      delete: (repoPath, username, id) => invoke('dashboards:delete', repoPath, username, id),
      setScope: (repoPath, username, id, scope: QueryScope) => invoke('dashboards:set-scope', repoPath, username, id, scope),
      addWidget: (repoPath, username, dashboardId, dto: AddWidgetDto) =>
        invoke('dashboards:add-widget', repoPath, username, dashboardId, dto),
      updateWidget: (repoPath, username, dashboardId, widgetId, dto: UpdateWidgetDto) =>
        invoke('dashboards:update-widget', repoPath, username, dashboardId, widgetId, dto),
      deleteWidget: (repoPath, username, dashboardId, widgetId) =>
        invoke('dashboards:delete-widget', repoPath, username, dashboardId, widgetId),
      setWidgetOrder: (repoPath, username, dashboardId, order) =>
        invoke('dashboards:set-widget-order', repoPath, username, dashboardId, order),
      getOrder: (repoPath, username) => invoke('dashboards:order-get', repoPath, username),
      setOrder: (repoPath, username, order) => invoke('dashboards:order-set', repoPath, username, order),
      getParamValues: (repoPath, username, dashboardId) => invoke('dashboards:param-values-get', repoPath, username, dashboardId),
      setParamValues: (repoPath, username, dashboardId, values) => invoke('dashboards:param-values-set', repoPath, username, dashboardId, values),
    },
    parameters: {
      list: (repoPath, workspaceDir) => invoke('parameters:list', repoPath, workspaceDir),
      usages: (repoPath, name, workspaceDir) => invoke('parameters:usages', repoPath, name, workspaceDir),
      create: (repoPath, param, workspaceDir) => invoke('parameters:create', repoPath, param, workspaceDir),
      update: (repoPath, name, patch, workspaceDir) => invoke('parameters:update', repoPath, name, patch, workspaceDir),
      delete: (repoPath, name, workspaceDir) => invoke('parameters:delete', repoPath, name, workspaceDir),
    },
    interface: {
      complianceMatrix: (workspaceDir) => invoke('interface:compliance-matrix', workspaceDir),
      coverage: (componentRepoPath, interfaceRepoPath, roles) =>
        invoke('interface:coverage', componentRepoPath, interfaceRepoPath, roles),
    },
    export: {
      save: (repoPath, kind, format, payload, printParams, suggestedName, templateRelPath) =>
        invoke('export:save', repoPath, kind, format, payload, printParams, suggestedName, templateRelPath),
      listTemplates: (format) => invoke('export-templates:list', format),
      installExampleTemplates: () => invoke('export-templates:install-examples'),
      drawioSnapshotReady: (index, rect) => invoke('export:drawio-snapshot-ready', index, rect),
      notifyPrintReady: () => invoke('export:print-ready'),
      showInFolder: (filePath) => invoke('export:show-in-folder', filePath),
      openFile: (filePath) => invoke('export:open-file', filePath),
    },
  }
}
