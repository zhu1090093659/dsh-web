/**
 * Copy for the SSH provider's browser half: a zh dictionary with the English
 * counterpart beside it. The zh side is the key-set source of truth;
 * `packages/dsh-i18n` mirrors the keys into the centralized ru dictionary and
 * `pnpm i18n:check` enforces the parity.
 *
 * Prefixes: `settings.*` is the section inside the board's own settings card
 * (its shared chrome plus this provider's switches), `detail.*` is the
 * task-detail seat, `run.*` is the run-phase vocabulary the detail seat and
 * the card badge share, and `card.*` is the badge itself.
 *
 * @module dsh-task-board-ssh/client/locales
 */

/** Extension copy, key source of truth. */
export const zh = {
  'settings.title': 'SSH 远程执行',
  'settings.description': '把这张看板的卡片送到经 dsh-ssh 触达的主机上执行。',
  'settings.enabled': '启用远程执行',
  'settings.enabledHint': '关闭后本扩展不再登记详情区与卡片徽标，也不再向主机派发运行；本区块保留，随时可以重新开启。已经产生的运行记录与远端日志不受影响。',
  'settings.enabledHintBrief': '默认开启；关闭即撤下详情区与徽标。',
  'settings.defaultMode': '默认模式',
  'settings.defaultModeHint': '新建目标时预填的模式；每张卡片仍可各自改写。',
  'settings.defaultAgent': '默认 Agent',
  'settings.defaultAgentHint': '新建目标时预填的远端 CLI；每张卡片仍可各自改写。',
  'settings.defaultHost': '默认主机',
  'settings.defaultHostHint': '新卡片的目标表单用它预填主机选择器；每张卡片仍可各自改写。',
  'settings.defaultHostPlaceholder': 'dsh-ssh 主机别名',
  'settings.perHostCap': '每主机并发上限',
  'settings.perHostCapHint': '同一台主机上同时运行的卡片数，超出的请求按提交顺序排队。',
  'settings.agentCommandHint.dsh': '留空即用 dsh headless 命令行；模板必须引用 {prompt_file}。',
  'settings.agentCommandHint.claude': '留空即用 claude -p 命令行；模板必须引用 {prompt_file}。',
  'settings.agentCommandHint.codex': '留空即用 codex exec 命令行；模板必须引用 {prompt_file}。',
  'settings.agentCommandPlaceholder': '{prompt_file}',
  'settings.disabledNotice': '关闭中：以下默认值与命令覆写暂不生效，打开上面的开关即可继续配置。',
  'settings.on': '开',
  'settings.offLabel': '关',
  'settings.inherit': '继承默认',
  'settings.overridden': '已覆盖',
  'settings.reset': '重置',
  'settings.invalidValue': '该取值不被接受',
  'settings.collapse': '收起设置',
  'settings.expand': '展开设置',
  'settings.notExposed': '当前 DSH 版本未向设置页暴露本插件的配置命名空间，表单不可用。可编辑 ~/.dsh/settings.yaml 直接配置，或将本命名空间加入 Host 设置白名单后重启。',
  'settings.readOnly': '当前部署的设置只读。',
  'settings.saveFailed': '部署未接受这些值，已保留供你修改。',

  'detail.target': '执行目标',
  'detail.setTarget': '设置执行目标',
  'detail.editTarget': '编辑目标',
  'detail.cancelEdit': '收起目标',
  'detail.mode': '模式',
  'detail.mode.direct': '直接执行',
  'detail.mode.proxy': '本地代理',
  'detail.modeHintDirect': '在主机上直接起一个 headless agent，本机离线也不影响它。',
  'detail.modeHintProxy': '本机开一个会话，用 ssh 工具驱动主机；本机离线即中断。',
  'detail.host': '主机',
  'detail.hostNone': '没有可用主机',
  'detail.hostMissing': '在 dsh-ssh 设置里添加主机后，这里才能选择。',
  'detail.hostUnknown': '已不在 dsh-ssh 的主机列表中：{alias}',
  'detail.agent': 'Agent',
  'detail.agent.dsh': 'dsh',
  'detail.agent.claude': 'Claude Code',
  'detail.agent.codex': 'Codex',
  'detail.agent.custom': '自定义',
  'detail.agentCommand': '启动命令',
  'detail.agentResumeCommand': '续跑命令',
  'detail.workspace': '工作区',
  'detail.workspace.in-place': '远端目录',
  'detail.workspace.git': 'Git 分支',
  'detail.workspace.path': '远端路径',
  'detail.workspace.source': '仓库来源',
  'detail.workspace.source.url': '远端仓库',
  'detail.workspace.source.workspace': '本机仓库',
  'detail.workspace.url': '仓库地址',
  'detail.workspace.base': '起始分支',
  'detail.workspace.workspaceId': '本机工作区',
  'detail.workspace.workspaceIdPlaceholder': '工作区标识',
  'detail.save': '保存目标',
  'detail.saving': '保存中',
  'detail.saveFailed': '目标未保存：{error}',
  'detail.targetSummary': '{host} · {agent} · {workspace}',
  'detail.rejected': '看板没有接受这次操作。',
  'detail.error.host': '选择一台主机。',
  'detail.error.path': '填写主机上的绝对路径，需以 / 开头。',
  'detail.error.agentCommand': '启动命令必须引用 {prompt_file}。',
  'detail.error.url': '填写主机能访问的仓库地址，不能含空格。',
  'detail.error.workspaceId': '填写本机工作区的标识。',
  'detail.error.generic': '该取值不被接受：{error}',

  'detail.log': '运行日志',
  'detail.logEmpty': '还没有输出',
  'detail.logTruncated': '更早的输出已滚出窗口',
  'detail.logLatest': '跳到最新',
  'detail.followUp': '追问',
  'detail.followUpPlaceholder': '写下要它继续做的事',
  'detail.followUpSend': '发送',
  'detail.followUpQueued': '本轮结束后发送',
  'detail.followUpFailed': '追问没有送达：{error}',
  'detail.cancel': '取消执行',
  'detail.cancelling': '取消中',
  'detail.refresh': '重新读取',
  'detail.actionFailed': '操作没有完成：{error}',
  'detail.branch': '分支 {branch}',

  'run.idle': '待运行',
  'run.queued': '排队',
  'run.running': '运行中',
  'run.succeeded': '已完成',
  'run.failed': '失败',
  'run.cancelled': '已取消',
  'run.lost': '失联',

  'card.badgeTitle': '{host} · {state}',
} as const

/** The English counterpart; the same key set, verified by the locale audit. */
export const en: Record<TaskBoardSshKey, string> = {
  'settings.title': 'SSH remote execution',
  'settings.description': 'Runs a card of this board on a host reached through dsh-ssh.',
  'settings.enabled': 'Enable remote execution',
  'settings.enabledHint': 'When off, this extension registers no task-detail section and no card badge, and dispatches no run to a host. This section stays so the switch can be turned back on; recorded runs and remote logs are untouched.',
  'settings.enabledHintBrief': 'On by default; turning it off withdraws the section and the badge.',
  'settings.defaultMode': 'Default mode',
  'settings.defaultModeHint': 'Prefills a new target; each card can still change its own.',
  'settings.defaultAgent': 'Default agent',
  'settings.defaultAgentHint': 'Prefills a new target; each card can still change its own.',
  'settings.defaultHost': 'Default host',
  'settings.defaultHostHint': 'Prefills the host picker of a new target; each card can still change its own.',
  'settings.defaultHostPlaceholder': 'dsh-ssh host alias',
  'settings.perHostCap': 'Per-host concurrency',
  'settings.perHostCapHint': 'Cards running at once on one host; anything beyond that waits in submission order.',
  'settings.agentCommandHint.dsh': 'Leave empty for the built-in dsh headless command line; the template must reference {prompt_file}.',
  'settings.agentCommandHint.claude': 'Leave empty for the built-in claude -p command line; the template must reference {prompt_file}.',
  'settings.agentCommandHint.codex': 'Leave empty for the built-in codex exec command line; the template must reference {prompt_file}.',
  'settings.agentCommandPlaceholder': '{prompt_file}',
  'settings.disabledNotice': 'Turned off: the defaults and command overrides below are inactive until the switch above is on.',
  'settings.on': 'On',
  'settings.offLabel': 'Off',
  'settings.inherit': 'Inherit default',
  'settings.overridden': 'Overridden',
  'settings.reset': 'Reset',
  'settings.invalidValue': 'This value is not accepted',
  'settings.collapse': 'Collapse settings',
  'settings.expand': 'Expand settings',
  'settings.notExposed': 'This DSH version does not expose the plugin settings namespace to the settings page, so the form is unavailable. Edit ~/.dsh/settings.yaml directly, or add the namespace to the Host settings allowlist and restart.',
  'settings.readOnly': 'This deployment serves its settings read-only.',
  'settings.saveFailed': 'The deployment did not accept these values; they are kept for you to edit.',

  'detail.target': 'Execution target',
  'detail.setTarget': 'Set an execution target',
  'detail.editTarget': 'Edit target',
  'detail.cancelEdit': 'Collapse target',
  'detail.mode': 'Mode',
  'detail.mode.direct': 'Direct',
  'detail.mode.proxy': 'Local proxy',
  'detail.modeHintDirect': 'Starts a headless agent on the host; it keeps running while this machine is offline.',
  'detail.modeHintProxy': 'Starts a local session that drives the host through the ssh tools; going offline ends it.',
  'detail.host': 'Host',
  'detail.hostNone': 'No host available',
  'detail.hostMissing': 'Add a host in the dsh-ssh settings before choosing one here.',
  'detail.hostUnknown': 'No longer in the dsh-ssh host list: {alias}',
  'detail.agent': 'Agent',
  'detail.agent.dsh': 'dsh',
  'detail.agent.claude': 'Claude Code',
  'detail.agent.codex': 'Codex',
  'detail.agent.custom': 'Custom',
  'detail.agentCommand': 'Start command',
  'detail.agentResumeCommand': 'Resume command',
  'detail.workspace': 'Workspace',
  'detail.workspace.in-place': 'Remote directory',
  'detail.workspace.git': 'Git branch',
  'detail.workspace.path': 'Remote path',
  'detail.workspace.source': 'Repository source',
  'detail.workspace.source.url': 'Remote repository',
  'detail.workspace.source.workspace': 'This workspace',
  'detail.workspace.url': 'Repository URL',
  'detail.workspace.base': 'Starting branch',
  'detail.workspace.workspaceId': 'Workspace',
  'detail.workspace.workspaceIdPlaceholder': 'Workspace id',
  'detail.save': 'Save target',
  'detail.saving': 'Saving',
  'detail.saveFailed': 'Target not saved: {error}',
  'detail.targetSummary': '{host} · {agent} · {workspace}',
  'detail.rejected': 'The board did not accept that action.',
  'detail.error.host': 'Choose a host.',
  'detail.error.path': 'Enter an absolute path on the host, starting with /.',
  'detail.error.agentCommand': 'The start command must reference {prompt_file}.',
  'detail.error.url': 'Enter a repository URL the host can reach, without spaces.',
  'detail.error.workspaceId': 'Enter the id of a local workspace.',
  'detail.error.generic': 'This value is not accepted: {error}',

  'detail.log': 'Run log',
  'detail.logEmpty': 'No output yet',
  'detail.logTruncated': 'Earlier output left the window',
  'detail.logLatest': 'Jump to latest',
  'detail.followUp': 'Follow-up',
  'detail.followUpPlaceholder': 'What it should do next',
  'detail.followUpSend': 'Send',
  'detail.followUpQueued': 'Sent after this turn ends',
  'detail.followUpFailed': 'The follow-up did not arrive: {error}',
  'detail.cancel': 'Cancel run',
  'detail.cancelling': 'Cancelling',
  'detail.refresh': 'Re-read',
  'detail.actionFailed': 'The action did not complete: {error}',
  'detail.branch': 'Branch {branch}',

  'run.idle': 'Ready',
  'run.queued': 'Queued',
  'run.running': 'Running',
  'run.succeeded': 'Done',
  'run.failed': 'Failed',
  'run.cancelled': 'Cancelled',
  'run.lost': 'Lost contact',

  'card.badgeTitle': '{host} · {state}',
}

/** One key of this extension's catalog. */
export type TaskBoardSshKey = keyof typeof zh

/** The dictionary this module falls back to when no runtime seat is wired. */
function dictionary(): Record<TaskBoardSshKey, string> {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
  return lang.toLowerCase().startsWith('en') ? en : zh
}

/**
 * SDK translate seat wired by the browser apply() once ctx.locale is bound.
 * When present it reads the ACTIVE locale at call time, so the provider's seats
 * follow a runtime language switch; the document-language pick above stays only
 * as the unwired fallback.
 */
let runtimeT: ((key: TaskBoardSshKey, params?: Record<string, string>) => string) | undefined

/** Wire the SDK translate seat; pass undefined to restore the document-language pick. */
export function setRuntimeTranslate(t: ((key: TaskBoardSshKey, params?: Record<string, string>) => string) | undefined): void {
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
export function t(key: TaskBoardSshKey, params?: Record<string, string>): string {
  if (runtimeT !== undefined) return runtimeT(key, params)
  let text: string = dictionary()[key]
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, value)
    }
  }
  return text
}
