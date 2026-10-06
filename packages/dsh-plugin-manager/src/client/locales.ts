/**
 * Locale dictionaries for the plugin-manager's official-page patch. The zh
 * dictionary is the key source; the en dictionary mirrors the exact key set.
 *
 * The key set covers only what this package renders: the check-for-updates
 * block on a bundle's page in the official Plugins panel, and the list-level
 * update toolbar mounted beside that panel's "Installed" heading.
 * The former tab's keys (inventory, conflicts, repair seeds, safe mode,
 * aggregate children) left with that tab.
 * @module @linxin666/dsh-client-ui-plugin-manager/client
 */

/** Simplified Chinese copy (the key-set source of truth). */
const STATIC_ZH = {
  'updateSection': '更新',
  'checkUpdates': '检查更新',
  'checking': '检查中…',
  'noUpdates': '已是最新版本。',
  'update': '更新',
  'updating': '更新中…',
  'latest': '最新 {version}',
  'updateRequiresDsh': '需要 DSH ≥ {min}',
  'updateBlockedDsh': '需要 DSH ≥ {min}，请先升级 DSH 再更新',
  'updateUnverifiedDsh': '无法确认本机 DSH 版本（需要 DSH ≥ {min}），已暂停更新',
  'restartHint': '插件变更将在重启应用后生效。',
  'updatesAvailable': '{count} 个可更新',
  'updateAll': '全部更新（{count}）',
  'updatingAll': '更新 {name}（{index}/{total}）',
  'updateAllDone': '更新完成，重启后生效。',
  'updatesPanelTitle': '插件更新',
  'thirdPartyOnly': '只检查第三方插件；官方 @deepseek-ai/ 包随 DSH 本体升级。',
  'restartNow': '立即重启',
  'restarting': '正在重启…',
  'restartConfirm': '确认重启',
  'restartPlanRelaunch': '会重启 DSH 服务，正在运行的任务会中断。',
  'restartPlanShell': '桌面版通过系统对话框重启：确认后会弹出官方的「应用无法启动或已意外停止」对话框，请在对话框中点「重启」。',
  'restartPlanManual': '当前进程无法自动重启，请手动重启 DSH。',
  'restartShellWarning': '它同时会写一份崩溃报告；也可以手动重启：退出 DeepSeek Harness（⌘Q）后重新打开。',
  'restartDesktopHint': '请在随后出现的系统对话框中选择「重启」。',
  'restartRelaunchHint': '已请求重启；服务恢复后刷新页面即可。',
  'restartManualHint': '当前进程无法自动重启，请手动重启 DSH。',
  'cancel': '取消',
  'failed': '操作失败：{reason}',
  'fetching': '正在获取插件信息…',
  'downloading': '正在下载…',
  'downloadingPercent': '正在下载 {percent}%',
  'extracting': '正在解压…',
  'writing': '正在写入配置…',
  'localOnlyTitle': '仅限本机操作',
  'localOnlyBody': '为了保护主机配置，插件管理只能从本机打开。'
} satisfies Record<string, string>

/** English copy, checked complete against the zh key set. */
const STATIC_EN = {
  'updateSection': 'Update',
  'checkUpdates': 'Check for updates',
  'checking': 'Checking…',
  'noUpdates': 'The installed version is the latest.',
  'update': 'Update',
  'updating': 'Updating…',
  'latest': 'Latest {version}',
  'updateRequiresDsh': 'Requires DSH >= {min}',
  'updateBlockedDsh': 'Requires DSH >= {min}; upgrade DSH before updating',
  'updateUnverifiedDsh': 'Cannot confirm the local DSH version (this update needs DSH >= {min}); update paused',
  'restartHint': 'Plugin changes take effect after restarting the application.',
  'updatesAvailable': '{count} updates available',
  'updateAll': 'Update all ({count})',
  'updatingAll': 'Updating {name} ({index}/{total})',
  'updateAllDone': 'Updated; restart to take effect.',
  'updatesPanelTitle': 'Plugin updates',
  'thirdPartyOnly': 'Third-party plugins only; @deepseek-ai/ packages upgrade with DSH itself.',
  'restartNow': 'Restart now',
  'restarting': 'Restarting…',
  'restartConfirm': 'Restart',
  'restartPlanRelaunch': 'The DSH service restarts; running tasks are interrupted.',
  'restartPlanShell': 'The desktop app restarts through its system dialog: confirming shows the official "DeepSeek Harness is unavailable" dialog; click Restart in it.',
  'restartPlanManual': 'This process cannot restart itself; restart DSH yourself.',
  'restartShellWarning': 'It also writes a crash report. You can instead restart manually: quit DeepSeek Harness (Cmd+Q) and open it again.',
  'restartDesktopHint': 'Choose Restart in the system dialog that follows.',
  'restartRelaunchHint': 'Restart requested; reload the page once the server is back.',
  'restartManualHint': 'This process cannot restart itself; restart DSH yourself.',
  'cancel': 'Cancel',
  'failed': 'Operation failed: {reason}',
  'fetching': 'Fetching plugin metadata…',
  'downloading': 'Downloading…',
  'downloadingPercent': 'Downloading {percent}%',
  'extracting': 'Extracting…',
  'writing': 'Writing configuration…',
  'localOnlyTitle': 'Available on this computer only',
  'localOnlyBody': 'To protect host configuration, plugin management is only available from a local browser.'
} satisfies Record<keyof typeof STATIC_ZH, string>

export const zh = STATIC_ZH
export const en = STATIC_EN
export type PluginManagerKey = keyof typeof STATIC_ZH
