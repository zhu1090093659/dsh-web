/**
 * GitHub provider extension copy: zh-first dictionary with an English
 * counterpart. The zh side is the key-set source of truth;
 * `packages/dsh-i18n` mirrors the keys into the centralized ru dictionary and
 * `pnpm i18n:check` enforces the parity.
 *
 * Prefixes: `settings.*` is the plugin card (its shared chrome plus this
 * extension's own switches), `detail.*` is the task-detail seat, `summary.*`
 * is the repository/credential summary shown by the settings seat and the card,
 * `prompt.*` is the execution-prompt panel of the task-detail seat, and
 * `common.*` is shared button copy.
 */

/** Extension copy, key source of truth. */
export const zh = {
  'settings.title': 'GitHub Issues 同步',
  'settings.description': '同步 GitHub Issues 为看板卡片，列变化写回 issue 标签。',
  'settings.integrationOff': '本扩展当前关闭：仓库与凭据设置暂不加载，看板卡片与详情区也不会出现它的区块。把上面的开关打开即可继续配置。',
  'settings.enabled': '启用同步',
  'settings.enabledHint': '关闭后本扩展不向任务看板注册任何东西：停止轮询、停止写回、注销 agent 工具、清空同步状态，详情区与卡片徽章随之消失；本设置卡保留并显示为未运行，随时可以重新开启。看板与已同步的卡片数据都不受影响。',
  'settings.enabledHintBrief': '默认开启；关闭即停止同步与写回，并撤下看板区块。',
  'settings.announce': '向 agent 播报',
  'settings.announceHint': '开启后每条 agent 系统提示都会包含本扩展的说明与触发词；关闭则只在用户主动提及时生效。默认关闭，保持系统提示干净。',
  'settings.announceHintBrief': '默认关闭；开启后系统提示附带本扩展说明与触发词。',
  'settings.on': '开',
  'settings.off': '关',
  'settings.inherit': '继承默认',
  'settings.overridden': '已覆盖',
  'settings.reset': '重置',
  'settings.invalidValue': '该取值不被接受',
  'settings.notExposed': '当前 DSH 版本未向设置页暴露本插件的配置命名空间，表单不可用。可编辑 ~/.dsh/settings.yaml 直接配置，或将本命名空间加入 Host 设置白名单后重启。',
  'settings.readOnly': '当前部署的设置只读。',
  'settings.expand': '展开设置',
  'settings.collapse': '收起设置',
  'settings.saveFailed': '部署未接受这些值，已保留供你修改。',

  'setup.apiUnavailable': '无法访问本机 Host 配置接口：{error}',
  'setup.healthOk': '后台同步：最近成功于 {at}。',
  'setup.healthStale': '后台同步：已 {minutes} 分钟未成功同步。',
  'setup.healthNever': '后台同步：本次启动尚未成功同步。',
  'setup.healthErrors': '最近一次同步报告了 {count} 条错误，详情见宿主日志（dsh-task-board-github）。',
  'setup.credentialConfigured': '凭据：已配置（{name} · {source}）',
  'setup.credentialMissing': '凭据：未配置（在下方粘贴 Token，存入本机凭据库 {name}）',
  'setup.credentialSourceUnknown': '未知',
  'setup.assignee': '指派账号',
  'setup.assigneeChip': '{login}',
  'setup.assigneePlaceholder': '@me 或登录名',
  'setup.unassignedChip': '无指派',
  'setup.inclusionLabel': '纳入标签',
  'setup.inclusionLabelPlaceholder': '标签（默认 dsh）',
  'setup.proxyDetected': '代理：{url}（{source}）',
  'setup.proxyDirect': '未检测到代理，直连 GitHub。',
  'setup.proxyDirectMode': '直连：不经任何代理。',
  'setup.proxyHint': '自动模式依次读环境变量与系统代理，均无则直连；NO_PROXY 始终生效。仅支持 http/https 代理。',
  'setup.proxyModeAuto': '自动检测',
  'setup.proxyModeCustom': '自定义代理',
  'setup.proxyModeDirect': '直连',
  'setup.proxyModeLabel': '代理模式',
  'setup.proxySourceCustom': '自定义',
  'setup.proxySourceEnv': '环境变量',
  'setup.proxySourceSystem': '系统代理',
  'setup.proxyTitle': '网络代理',
  'setup.proxyUrlLabel': '代理地址',
  'setup.proxyUrlPlaceholder': 'http://127.0.0.1:7890',
  'setup.repositoriesCount': '仓库（{count}）',
  'setup.repositoriesEmpty': '尚未配置仓库。',
  'setup.repositoriesExpand': '展开仓库列表',
  'setup.repositoriesCollapse': '收起仓库列表',
  'setup.repositoriesHint': '带纳入标签或指派给指定账号的 issue 同步成卡片；「无指派」纳入无人指派的 issue。修改即时生效，高级项在 profile patch 声明。',
  'setup.repositoryAdd': '添加',
  'setup.repositoryLabel': '仓库',
  'setup.repositoryPlaceholder': 'owner/repo 或 GitHub 链接',
  'setup.repositoryRemove': '移除',
  'setup.test': '测试连接',
  'setup.testFailed': '测试失败：{error}',
  'setup.testLogin': '已认证账号：{login}',
  'setup.testNoCredential': '没有可用凭据，GitHub 未认证；先保存一个 Token 再测试。',
  'setup.testing': '测试中…',
  'setup.tokenClear': '清除凭据',
  'setup.tokenEmpty': '请先粘贴 Token',
  'setup.tokenHint': 'Token 只发送本机 Host 一次并存入 DSH 凭据库，浏览器不回读明文；repo 权限的 fine-grained token 即可。',
  'setup.tokenLabel': 'GitHub Token',
  'setup.tokenPlaceholder': '粘贴 Token（ghp_… / github_pat_…）',
  'setup.tokenSave': '保存凭据',
  'setup.tokenSaved': '已保存，下一次同步即刻使用新凭据。',
  'setup.tokenSaving': '保存中…',

  'summary.title': 'GitHub 集成',
  'summary.repositories': '已配置仓库 ({count})',
  'summary.label': '标签',
  'summary.autoPr': '自动创建 PR',
  'summary.noRepositories': '未配置 GitHub 仓库（在本扩展行的 profile patch 里声明 repositories）',
  'summary.credentialReady': 'Host 凭据：有效',
  'summary.credentialMissing': 'Host 凭据：未检测到（请设置 GITHUB_TOKEN 环境变量，或用 tokenEnv 指定变量名）',
  'summary.notRunning': '扩展当前未运行：打开开关后才会显示同步状态。',

  'card.openIssue': '在 GitHub 打开 {reference}',
  'detail.title': 'GitHub Issue',
  'detail.state.open': '开启',
  'detail.state.closed': '已关闭',
  'detail.syncedAt': '同步于 {time}',
  'detail.syncError': '同步异常：{error}',
  'detail.refresh': '同步 Issue',
  'detail.refreshing': '正在同步…',
  'detail.pr': 'Pull Request',
  'detail.prNumber': 'PR #{number}',
  'detail.prState.open': '开启',
  'detail.prState.closed': '已关闭',
  'detail.prState.merged': '已合并',
  'detail.prDraft': '草稿',
  'detail.createPr': '创建 PR',
  'detail.createPrTitle': '创建 Pull Request',
  'detail.headBranch': '远程来源分支 (Head)',
  'detail.headBranchPlaceholder': '例如 feature-branch',
  'detail.baseBranch': '目标基线分支 (Base)',
  'detail.linkPr': '关联 PR',
  'detail.linkPrTitle': '关联已有 Pull Request',
  'detail.prNumberInput': 'PR 编号',
  'detail.deactivated': '该 Issue 在 GitHub 上已移除包含标签，已在看板停用。',

  'prompt.title': '执行 Prompt',
  'prompt.templateHint': '执行 Prompt 由模板生成：issue 头信息、执行要求与回写规则固定，issue 原文原样附在来源声明里。AI 分析是可选的一段，只补充目标、步骤与完成标准。',
  'prompt.edited': '执行 Prompt 已被手动修改：同步不再覆盖它；重新生成需要确认覆盖。',
  'prompt.frozen': '卡片已开始执行，执行 Prompt 已冻结。',
  'prompt.analysisNone': '尚未生成 AI 分析。',
  'prompt.analysisFresh': 'AI 分析由 {model} 生成于 {time}，已写入执行 Prompt。',
  'prompt.analysisStale': 'issue 已在 AI 分析之后更新：旧分析已从执行 Prompt 中移除，可重新生成。',
  'prompt.analysisPending': '正在生成 AI 分析…',
  'prompt.analysisError': 'AI 分析失败：{error}',
  'prompt.noCodeChange': '模型判断该 issue 不需要改代码（通知或讨论类），可考虑移到待规划，避免执行时为推进目标制造改动。',
  'prompt.moveBacklog': '移到待规划',
  'prompt.modelLabel': '分析模型',
  'prompt.modelPlaceholder': 'provider/model，留空则用仓库设置、卡片模型或宿主默认',
  'prompt.generate': 'AI 生成分析',
  'prompt.regenerate': '重新生成',
  'prompt.overwrite': '覆盖并重新生成',
  'prompt.clear': '移除 AI 分析',
  'prompt.goal': '目标',
  'prompt.steps': '建议步骤',
  'prompt.acceptance': '完成标准',
  'prompt.notes': '备注',

  'common.cancel': '取消',
}

/** English counterpart; the key set mirrors {@link zh} exactly. */
export const en: Record<keyof typeof zh, string> = {
  'settings.title': 'GitHub Issues sync',
  'settings.description': 'Sync GitHub Issues into board cards; column changes write back to issue labels.',
  'settings.integrationOff': 'This extension is currently off: the repository and credential setup is not loaded, and its blocks disappear from the board cards and the task detail. Turn the switch above on to configure the integration.',
  'settings.enabled': 'Enable sync',
  'settings.enabledHint': 'When off, this extension registers nothing with the board: polling stops, write-back stops, the agent tools unregister and the sync status clears, and its detail section and card decoration disappear. This settings card stays reachable and reports that the extension is not running, so the switch can be turned back on. The board and the cards already synchronized are unaffected.',
  'settings.enabledHintBrief': 'On by default; off stops sync and write-back and hides the board blocks.',
  'settings.announce': 'Announce to agents',
  'settings.announceHint': 'On: every agent system prompt carries a note about this extension and its trigger words. Off: agents learn about it only when you mention it. Off by default, so prompts stay clean.',
  'settings.announceHintBrief': 'Off by default; on adds the extension note and trigger words to agent prompts.',
  'settings.on': 'On',
  'settings.off': 'Off',
  'settings.inherit': 'Inherit default',
  'settings.overridden': 'Overridden',
  'settings.reset': 'Reset',
  'settings.invalidValue': 'The value is not accepted',
  'settings.notExposed': "This DSH version does not expose this plugin's settings namespace to the configuration page, so the form is unavailable. Edit ~/.dsh/settings.yaml directly, or add the namespace to the Host settings allowlist and restart.",
  'settings.readOnly': 'This deployment serves settings read-only.',
  'settings.expand': 'Show settings',
  'settings.collapse': 'Hide settings',
  'settings.saveFailed': 'The deployment did not accept these values; they were left for you to correct.',

  'setup.apiUnavailable': 'Cannot reach the host configuration API: {error}',
  'setup.healthOk': 'Background sync: last success at {at}.',
  'setup.healthStale': 'Background sync: no successful sync for {minutes} minutes.',
  'setup.healthNever': 'Background sync: no successful sync since this host started.',
  'setup.healthErrors': 'The last sync reported {count} error(s); see the host log (dsh-task-board-github).',
  'setup.credentialConfigured': 'Credential: configured ({name} · {source})',
  'setup.credentialMissing': 'Credential: not configured (paste a token below; stored locally as {name})',
  'setup.credentialSourceUnknown': 'unknown',
  'setup.assignee': 'Inclusion assignee',
  'setup.assigneeChip': '{login}',
  'setup.assigneePlaceholder': '@me or a login',
  'setup.unassignedChip': 'Unassigned',
  'setup.inclusionLabel': 'Inclusion label',
  'setup.inclusionLabelPlaceholder': 'Label (default dsh)',
  'setup.proxyDetected': 'Proxy: {url} ({source})',
  'setup.proxyDirect': 'No proxy detected; connecting to GitHub directly.',
  'setup.proxyDirectMode': 'Direct: no proxy is used.',
  'setup.proxyHint': 'Auto reads environment variables then the system proxy, going direct when neither is set; NO_PROXY always applies. Only http/https proxies are supported.',
  'setup.proxyModeAuto': 'Auto-detect',
  'setup.proxyModeCustom': 'Custom proxy',
  'setup.proxyModeDirect': 'Direct',
  'setup.proxyModeLabel': 'Proxy mode',
  'setup.proxySourceCustom': 'custom',
  'setup.proxySourceEnv': 'environment',
  'setup.proxySourceSystem': 'system proxy',
  'setup.proxyTitle': 'Network proxy',
  'setup.proxyUrlLabel': 'Proxy address',
  'setup.proxyUrlPlaceholder': 'http://127.0.0.1:7890',
  'setup.repositoriesCount': 'Repositories ({count})',
  'setup.repositoriesEmpty': 'No repositories configured yet.',
  'setup.repositoriesExpand': 'Expand the repository list',
  'setup.repositoriesCollapse': 'Collapse the repository list',
  'setup.repositoriesHint': 'Issues with the inclusion label or assigned to the configured login become cards; "Unassigned" also takes issues nobody is assigned to. Changes apply immediately; advanced knobs stay in the profile patch.',
  'setup.repositoryAdd': 'Add',
  'setup.repositoryLabel': 'Repository',
  'setup.repositoryPlaceholder': 'owner/repo or a GitHub link',
  'setup.repositoryRemove': 'Remove',
  'setup.test': 'Test connection',
  'setup.testFailed': 'Test failed: {error}',
  'setup.testLogin': 'Authenticated as {login}',
  'setup.testNoCredential': 'No credential is available, so GitHub is unauthenticated; save a token first.',
  'setup.testing': 'Testing…',
  'setup.tokenClear': 'Clear credential',
  'setup.tokenEmpty': 'Paste a token first',
  'setup.tokenHint': 'The token is sent to the local host once and stored in the DSH credential store; the browser never reads it back. A fine-grained token with repo access is enough.',
  'setup.tokenLabel': 'GitHub token',
  'setup.tokenPlaceholder': 'Paste a token (ghp_… / github_pat_…)',
  'setup.tokenSave': 'Save credential',
  'setup.tokenSaved': 'Saved. The next sync uses the new credential immediately.',
  'setup.tokenSaving': 'Saving…',

  'summary.title': 'GitHub Integration',
  'summary.repositories': 'Configured Repositories ({count})',
  'summary.label': 'label',
  'summary.autoPr': 'auto PR',
  'summary.noRepositories': 'No GitHub repositories configured (declare repositories in this extension row of the profile patch)',
  'summary.credentialReady': 'Host credential: Valid',
  'summary.credentialMissing': 'Host credential: None detected (set the GITHUB_TOKEN environment variable, or name another one with tokenEnv)',
  'summary.notRunning': 'The extension is not running: its sync status appears once the switch is on.',

  'card.openIssue': 'Open {reference} on GitHub',
  'detail.title': 'GitHub Issue',
  'detail.state.open': 'Open',
  'detail.state.closed': 'Closed',
  'detail.syncedAt': 'Synced at {time}',
  'detail.syncError': 'Sync error: {error}',
  'detail.refresh': 'Sync Issue',
  'detail.refreshing': 'Syncing…',
  'detail.pr': 'Pull Request',
  'detail.prNumber': 'PR #{number}',
  'detail.prState.open': 'Open',
  'detail.prState.closed': 'Closed',
  'detail.prState.merged': 'Merged',
  'detail.prDraft': 'Draft',
  'detail.createPr': 'Create PR',
  'detail.createPrTitle': 'Create Pull Request',
  'detail.headBranch': 'Remote Head Branch',
  'detail.headBranchPlaceholder': 'e.g. feature-branch',
  'detail.baseBranch': 'Target Base Branch',
  'detail.linkPr': 'Link PR',
  'detail.linkPrTitle': 'Link Existing Pull Request',
  'detail.prNumberInput': 'PR Number',
  'detail.deactivated': 'Inclusion label was removed on GitHub; item is deactivated on the board.',

  'prompt.title': 'Execution prompt',
  'prompt.templateHint': 'The execution prompt is generated from a template: the issue header, the workflow and the write-back rules are fixed, and the issue body is appended verbatim inside a provenance wrap. The AI analysis is an optional section that only adds the goal, steps and completion criteria.',
  'prompt.edited': 'The execution prompt was edited by hand: synchronization no longer overwrites it, and regenerating needs a confirmation.',
  'prompt.frozen': 'The card has started executing; its execution prompt is frozen.',
  'prompt.analysisNone': 'No AI analysis yet.',
  'prompt.analysisFresh': 'AI analysis written by {model} at {time} is part of the execution prompt.',
  'prompt.analysisStale': 'The issue changed after the AI analysis: the old analysis was left out of the execution prompt. Generate it again to refresh it.',
  'prompt.analysisPending': 'Generating the AI analysis…',
  'prompt.analysisError': 'AI analysis failed: {error}',
  'prompt.noCodeChange': 'The model judged that this issue needs no code change (a notice or a discussion). Consider moving it to the backlog so a run does not invent changes to finish a goal.',
  'prompt.moveBacklog': 'Move to backlog',
  'prompt.modelLabel': 'Analysis model',
  'prompt.modelPlaceholder': 'provider/model; empty uses the repository setting, the card model or the host default',
  'prompt.generate': 'Generate AI analysis',
  'prompt.regenerate': 'Regenerate',
  'prompt.overwrite': 'Overwrite and regenerate',
  'prompt.clear': 'Remove AI analysis',
  'prompt.goal': 'Goal',
  'prompt.steps': 'Suggested steps',
  'prompt.acceptance': 'Completion criteria',
  'prompt.notes': 'Notes',

  'common.cancel': 'Cancel',
}

/** Every key in the locale catalog. */
export type TaskBoardGithubKey = keyof typeof zh

/** The dictionary this module falls back to when no runtime seat is wired. */
function dictionary(): Record<TaskBoardGithubKey, string> {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
  return lang.toLowerCase().startsWith('en') ? en : zh
}

/**
 * SDK translate seat wired by the browser apply() once ctx.locale is bound.
 * When present it reads the ACTIVE locale at call time, so the provider's seats
 * follow a runtime language switch; the document-language pick above stays only
 * as the unwired fallback.
 */
let runtimeT: ((key: TaskBoardGithubKey, params?: Record<string, string>) => string) | undefined

/** Wire the SDK translate seat; pass undefined to restore the document-language pick. */
export function setRuntimeTranslate(t: ((key: TaskBoardGithubKey, params?: Record<string, string>) => string) | undefined): void {
  runtimeT = t
}

/**
 * Translate one key of this extension's catalog.
 *
 * The provider's child seats receive only the contract's owner props, so they
 * cannot be handed a locale binding the way a plugin card is; this module-level
 * lookup is what lets them render copy.
 * @param key - the catalog key.
 * @param params - optional {name} template values.
 * @returns the localized text.
 */
export function t(key: TaskBoardGithubKey, params?: Record<string, string>): string {
  if (runtimeT !== undefined) return runtimeT(key, params)
  let text: string = dictionary()[key]
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, value)
    }
  }
  return text
}
