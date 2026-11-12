/**
 * Locale dictionaries for the browser-view plugin. `zh` is the key-set source
 * of truth; `en` keeps a full key-for-key mirror (packages/AGENTS.md bilingual
 * rules). Registered through ctx.locale.register(NS, { zh, en }); the components
 * read every string through the injected `t` seat, so no copy is hardcoded in
 * JSX.
 *
 * The page-title keys are gone with the page header: a right-sidebar tab is
 * named by the shell's chip, and the chip's text comes from the tab type and
 * the published page title instead ('panel.title' / 'panel.close' had no
 * reader left once the "back to the conversation" control was removed).
 *
 * 'panel.tabs.empty' went with the always-drawn tab strip: the controlled
 * browser's chips now appear only when it holds more than one page, so there is
 * no empty strip left to caption.
 */

/** Simplified Chinese dictionary (key-set source of truth). */
export const zh = {
  'tab.title': '浏览器视图',
  'guide.description': '看 agent 正在操作的网页',
  'panel.tab.untitled': '未命名页面',
  'panel.url.empty': '还没有打开页面',
  'panel.address.label': '页面地址',
  'panel.toolbar.refresh': '刷新画面',
  'panel.frame.alt': 'agent 正在操作的页面画面',
  'panel.empty.title': '还没有画面',
  'panel.empty.hint': '让 agent 打开一个页面后，这里会实时显示它正在看的网页。',
  'panel.error.title': '浏览器视图出错',
  'panel.trace.idle': '暂无工具动作',
  'panel.status.connecting': '正在连接',
  'panel.status.loading': '加载中',
  'panel.status.live': '实时',
  'panel.mode.isolated': '隔离浏览器',
  'panel.mode.real': '真实浏览器',
  'config.summary': '真实浏览器 CDP 连接设置',
  'config.realBrowserEnabled': '使用真实浏览器（CDP）',
  'config.realBrowserEnabled.hint': '开启后，所有 DSH 会话都能操作此浏览器中的全部标签页。',
  'config.cdpEndpoint': 'CDP 地址',
  'config.cdpEndpoint.hint': '仅支持本机 loopback；Chrome 136+ 默认 profile 不支持远程调试。',
  'config.idleCloseDays': '闲置关闭（天）',
  'config.idleCloseDays.hint': 'DSH 自己打开的页面超过这个天数没有工具动作会被自动关闭；接管的真实页面不在此列，0 表示不关闭。',
  'config.unavailable': '设置暂不可用',
  'config.failed': '设置保存失败，请重试',
  'settings.title': '真实浏览器',
  'settings.description': '使用本机 Chrome / Edge 的登录状态与全部标签页。',
  'settings.enabled': '启用 CDP 接管',
  'settings.enabledHint': '开启后，所有 DSH 会话都能读取和操作此浏览器中的全部标签页。',
  'settings.cdpEndpoint': 'CDP 地址',
  'settings.cdpEndpointHint': '仅限本机 loopback；Chrome 136+ 默认 profile 不支持远程调试。',
  'settings.idleCloseDays': '闲置自动关闭（天）',
  'settings.idleCloseDaysHint': 'DSH 自己打开的页面超过这个天数没有工具动作就自动关闭；接管的真实页面不在此列，0 表示关闭该能力。',
  'settings.inherit': '继承',
  'settings.on': '开启',
  'settings.off': '关闭',
  'settings.overridden': '已覆盖',
  'settings.reset': '重置',
  'settings.invalidValue': '取值无效',
  'settings.collapse': '收起',
  'settings.expand': '展开',
  'settings.notExposed': '此部署未提供该插件设置。',
  'settings.readOnly': '只读',
  'settings.saveFailed': '保存失败',
}

/** The browser-view namespace key union. */
export type BrowserViewKey = keyof typeof zh

/** English dictionary, key-for-key complete against zh. */
export const en: Record<BrowserViewKey, string> = {
  'tab.title': 'Browser view',
  'guide.description': 'Watch the page the agent is driving',
  'panel.tab.untitled': 'Untitled page',
  'panel.url.empty': 'No page open yet',
  'panel.address.label': 'Page address',
  'panel.toolbar.refresh': 'Refresh the frame',
  'panel.frame.alt': 'Live view of the page the agent is driving',
  'panel.empty.title': 'No frames yet',
  'panel.empty.hint': 'Once the agent opens a page, this tab shows the page it is looking at.',
  'panel.error.title': 'Browser view error',
  'panel.trace.idle': 'No tool actions yet',
  'panel.status.connecting': 'Connecting',
  'panel.status.loading': 'Loading',
  'panel.status.live': 'Live',
  'panel.mode.isolated': 'Isolated browser',
  'panel.mode.real': 'Real browser',
  'config.summary': 'Real-browser CDP connection settings',
  'config.realBrowserEnabled': 'Use a real browser (CDP)',
  'config.realBrowserEnabled.hint': 'When enabled, every DSH session can operate every tab in this browser.',
  'config.cdpEndpoint': 'CDP endpoint',
  'config.cdpEndpoint.hint': 'Loopback only. Chrome 136+ does not allow remote debugging on its default profile.',
  'config.idleCloseDays': 'Idle close (days)',
  'config.idleCloseDays.hint': 'Pages DSH opened itself close once no browser tool has touched them for this many days. Adopted real-browser pages are never closed; 0 disables it.',
  'config.unavailable': 'Settings are unavailable',
  'config.failed': 'Could not save settings. Try again.',
  'settings.title': 'Real browser',
  'settings.description': 'Use the sign-in state and every tab of this machine\'s Chrome or Edge.',
  'settings.enabled': 'Enable CDP takeover',
  'settings.enabledHint': 'When enabled, every DSH session can read and operate every tab in this browser.',
  'settings.cdpEndpoint': 'CDP endpoint',
  'settings.cdpEndpointHint': 'Loopback only. Chrome 136+ does not allow remote debugging on its default profile.',
  'settings.idleCloseDays': 'Auto-close idle pages (days)',
  'settings.idleCloseDaysHint': 'Pages DSH opened itself close once no browser tool has touched them for this many days. Adopted real-browser pages are never closed; 0 disables it.',
  'settings.inherit': 'Inherit',
  'settings.on': 'On',
  'settings.off': 'Off',
  'settings.overridden': 'Overridden',
  'settings.reset': 'Reset',
  'settings.invalidValue': 'Invalid value',
  'settings.collapse': 'Collapse',
  'settings.expand': 'Expand',
  'settings.notExposed': 'This deployment does not expose the plugin settings.',
  'settings.readOnly': 'Read-only',
  'settings.saveFailed': 'Save failed',
}
