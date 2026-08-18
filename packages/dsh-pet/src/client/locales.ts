/**
 * dsh-pet locale dictionaries (zh/en).
 * @module @linxin666/dsh-pet/client/locales
 */

/** Dictionary namespace this package registers. */
export const NS = 'pet'

/** Chinese copy. */
export const zh = {
  'pet.feed': '喂食',
  'pet.hide': '隐藏',
  'pet.rename': '改名',
  'pet.confirm': '确定',
  'pet.namePlaceholder': '输入新名字',
  'pet.summon': '召唤{name}',
  'pet.rank': '亲密度 {rank}',
  'pet.points': '{points} 点',
  'pet.treats': '小鱼干 ×{n}',
  'pet.state.loading': '宠物正在赶来…',
  'pet.state.error': '宠物迷路了（连接失败）',
  'pet.openSessionHint': '点击跳转到对应会话',
  'pet.moreSessions': '展开其余 {n} 个会话的气泡',
  'pet.collapseSessions': '收起会话气泡',
  // 一级设置页（settings.section 席位）。
  'settings.title': '宠物',
  'settings.description': '选择宠物并调整它的显示布局。',
  'settings.pet': '宠物',
  'settings.petHint': '选择显示哪只宠物；每只宠物独立命名，可在宠物悬浮面板改名。',
  'settings.enabled': '启用宠物',
  'settings.enabledHint': '关闭后隐藏宠物并停止轮询，可在设置里重新启用。',
  'settings.visible': '显示宠物',
  'settings.visibleHint': '关闭后宠物隐藏，可从聊天输入区重新召唤。',
  'settings.desktopEnabled': '启用桌面宠物',
  'settings.desktopEnabledHint': '让独立桌面宠物随当前 DSH 启停；首次启用需单独安装桌面运行环境。',
  'settings.runtimeChecking': '正在检查桌面运行环境…',
  'settings.runtimeReady': '桌面运行环境已就绪（Electron {version}）',
  'settings.runtimeUnsupported': '当前系统暂不支持桌面宠物运行环境。',
  'settings.runtimeMissing': '尚未安装桌面宠物运行环境。',
  'settings.runtimeInstallAction': '安装运行环境',
  'settings.runtimeDialogTitle': '安装桌面宠物运行环境',
  'settings.runtimeDialogDescription': '桌面宠物需要单独下载 Electron {version}。确认后才会开始下载，安装插件本身不会自动下载。',
  'settings.runtimeSource': '下载源',
  'settings.runtimeSourceOfficial': '官方源（GitHub）',
  'settings.runtimeSourceNpmmirror': 'npmmirror 镜像',
  'settings.runtimeSourceCustom': '自定义 HTTPS 镜像',
  'settings.runtimeCustomMirror': '自定义 HTTPS 镜像地址',
  'settings.runtimeDownloading': '正在下载…',
  'settings.runtimeInstalling': '正在解压并校验…',
  'settings.runtimeInstallingHint': '此步骤可能需要几分钟，请勿刷新或重复启动安装。',
  'settings.runtimeSecurity': '下载内容会按固定 SHA-256 校验；只有校验和安装成功后才会启用桌面宠物。',
  'settings.runtimeCancelDownload': '取消下载',
  'settings.runtimeCancel': '取消',
  'settings.runtimeDownloadAction': '下载并启用',
  'settings.runtimeRetry': '重试',
  'settings.runtimeErrorBusy': '另一个 DSH 进程正在安装运行环境，请稍后重试。',
  'settings.runtimeErrorChecksum': '下载文件校验失败，请更换下载源后重试。',
  'settings.runtimeErrorInsecureMirror': '自定义镜像必须使用 HTTPS。',
  'settings.runtimeErrorMirror': '请输入有效的自定义 HTTPS 镜像地址。',
  'settings.runtimeErrorInstall': '运行环境安装失败，请重试。',
  'settings.runtimeErrorDownload': '运行环境请求失败，请检查网络后重试。',
  'settings.runtimeErrorEnable': '运行环境已就绪，但桌面宠物开关未能保存，请重试。',
  'settings.size': '大小（px）',
  'settings.sizeHint': '精灵单元高度，范围 32–512。',
  'settings.right': '距右侧（px）',
  'settings.rightHint': '距视口右边缘的水平内缩距离。',
  'settings.bottom': '距底部（px）',
  'settings.bottomHint': '距视口底边的垂直内缩距离。',
  'settings.inherit': '继承',
  'settings.on': '开',
  'settings.off': '关',
  'settings.overridden': '已覆盖',
  'settings.reset': '恢复默认',
  'settings.notExposed': '当前 DSH 版本未向设置页暴露本插件的配置命名空间，表单不可用。可编辑 ~/.dsh/settings.yaml 直接配置，或为 dsh-host-apiproxy 的 WEB_SETTINGS_NAMESPACES 白名单补充本命名空间后重启。',
  'settings.readOnly': '当前部署的设置只读。',
  'settings.expand': '展开设置',
  'settings.collapse': '收起设置',
  'settings.save': '保存',
  'settings.saving': '保存中…',
  'settings.discard': '放弃',
  'settings.unsaved': '未保存',
  'settings.saveFailed': '部署未接受这些值，已保留供你修改。',
  'settings.invalidNumber': '请输入数字，留空则使用默认值。',
} as const

/** English copy. */
export const en = {
  'pet.feed': 'Feed',
  'pet.hide': 'Hide',
  'pet.rename': 'Rename',
  'pet.confirm': 'OK',
  'pet.namePlaceholder': 'Enter a new name',
  'pet.summon': 'Summon {name}',
  'pet.rank': 'Affinity {rank}',
  'pet.points': '{points} pts',
  'pet.treats': 'Treats ×{n}',
  'pet.state.loading': 'The pet is on its way…',
  'pet.state.error': 'The pet is lost (connection failed)',
  'pet.openSessionHint': 'Click to jump to this session',
  'pet.moreSessions': 'Expand {n} more session bubbles',
  'pet.collapseSessions': 'Collapse session bubbles',
  // First-level settings section (the `settings.section` seat).
  'settings.title': 'Pet',
  'settings.description': 'Pick a pet and tune its display layout.',
  'settings.pet': 'Pet',
  'settings.petHint': 'Choose which pet shows. Names are stored per pet; rename from the pet hover panel.',
  'settings.enabled': 'Enable the pet',
  'settings.enabledHint': 'When off, the pet hides and polling stops; re-enable it here.',
  'settings.visible': 'Show the pet',
  'settings.visibleHint': 'When off, the pet hides; summon it again from the input row.',
  'settings.desktopEnabled': 'Enable the desktop pet',
  'settings.desktopEnabledHint': 'Start and stop the standalone desktop pet with this DSH Host. First use requires a separate runtime installation.',
  'settings.runtimeChecking': 'Checking the desktop runtime…',
  'settings.runtimeReady': 'Desktop runtime ready (Electron {version})',
  'settings.runtimeUnsupported': 'The desktop pet runtime is not supported on this system.',
  'settings.runtimeMissing': 'The desktop pet runtime is not installed.',
  'settings.runtimeInstallAction': 'Install runtime',
  'settings.runtimeDialogTitle': 'Install the desktop pet runtime',
  'settings.runtimeDialogDescription': 'The desktop pet needs a separate Electron {version} download. Nothing is downloaded until you confirm here.',
  'settings.runtimeSource': 'Download source',
  'settings.runtimeSourceOfficial': 'Official source (GitHub)',
  'settings.runtimeSourceNpmmirror': 'npmmirror',
  'settings.runtimeSourceCustom': 'Custom HTTPS mirror',
  'settings.runtimeCustomMirror': 'Custom HTTPS mirror URL',
  'settings.runtimeDownloading': 'Downloading…',
  'settings.runtimeInstalling': 'Extracting and verifying…',
  'settings.runtimeInstallingHint': 'This can take a few minutes. Do not refresh or start another installation.',
  'settings.runtimeSecurity': 'The download is checked against a pinned SHA-256 digest. The desktop pet is enabled only after verification and installation succeed.',
  'settings.runtimeCancelDownload': 'Cancel download',
  'settings.runtimeCancel': 'Cancel',
  'settings.runtimeDownloadAction': 'Download and enable',
  'settings.runtimeRetry': 'Retry',
  'settings.runtimeErrorBusy': 'Another DSH process is installing the runtime. Try again shortly.',
  'settings.runtimeErrorChecksum': 'The downloaded file failed verification. Try another source.',
  'settings.runtimeErrorInsecureMirror': 'A custom mirror must use HTTPS.',
  'settings.runtimeErrorMirror': 'Enter a valid custom HTTPS mirror URL.',
  'settings.runtimeErrorInstall': 'The runtime could not be installed. Try again.',
  'settings.runtimeErrorDownload': 'The runtime request failed. Check the network and try again.',
  'settings.runtimeErrorEnable': 'The runtime is ready, but the desktop pet setting could not be saved. Try again.',
  'settings.size': 'Size (px)',
  'settings.sizeHint': 'Sprite cell height, 32\u2013512.',
  'settings.right': 'Right inset (px)',
  'settings.rightHint': 'Horizontal inset from the viewport right edge.',
  'settings.bottom': 'Bottom inset (px)',
  'settings.bottomHint': 'Vertical inset from the viewport bottom edge.',
  'settings.inherit': 'Inherit',
  'settings.on': 'On',
  'settings.off': 'Off',
  'settings.overridden': 'Overridden',
  'settings.reset': 'Reset to default',
  'settings.notExposed': 'This DSH version does not expose this plugin\'s settings namespace to the configuration page, so the form is unavailable. Edit ~/.dsh/settings.yaml directly, or add the namespace to dsh-host-apiproxy\'s WEB_SETTINGS_NAMESPACES allowlist and restart.',
  'settings.readOnly': 'This deployment stores settings read-only.',
  'settings.expand': 'Show settings',
  'settings.collapse': 'Hide settings',
  'settings.save': 'Save',
  'settings.saving': 'Saving\u2026',
  'settings.discard': 'Discard',
  'settings.unsaved': 'Unsaved',
  'settings.saveFailed': 'The deployment did not accept these values; they were left for you to correct.',
  'settings.invalidNumber': 'Enter a number, or leave blank to use the default.',
} as const

/** Key union for this namespace. */
export type PetKey = keyof typeof zh

/** The settings-card slice of the pet dictionary. */
export type SettingsCardKey = PetKey

/**
 * Active dictionary, picked by the document language at call time. The pet
 * mounts as a global floating surface (not a session-scoped slot), so it has
 * no framework locale seat and resolves its copy the same tiny way the
 * task-board's DOM-injected surface does.
 */
export function dictionary(): Record<PetKey, string> {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
  return lang.toLowerCase().startsWith('en') ? en : zh
}

/**
 * Translate a key with optional `{name}` template params. Mirrors the slot
 * `Translate` contract `(key, params?) => string` so it can be handed to the
 * same components that used to receive the framework-injected `t` seat. The
 * key is typed loosely (`string`) so the function is assignable to the slot's
 * `TranslateNS<'pet'>` (whose key domain also spans the shared common
 * vocabulary); a missing key degrades to the key itself rather than throwing.
 */
export function t(key: string, params?: Record<string, unknown>): string {
  let text: string = (dictionary() as Record<string, string>)[key] ?? key
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-pet UI copy. */
    pet: PetKey
  }
}
