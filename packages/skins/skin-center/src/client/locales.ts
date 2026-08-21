/**
 * Skin-center locale dictionaries. The plugin-card name, its description,
 * and every control of the in-GUI skin center is localized through the
 * standard `t` seat.
 */

/** Copy keys owned by this plugin. */
export type SkinCenterKey =
  | 'title'
  | 'cardDescription'
  | 'enabled'
  | 'enabledHint'
  | 'offNote'
  | 'intro'
  | 'official'
  | 'officialTagline'
  | 'active'
  | 'tryingOn'
  | 'tryOn'
  | 'loading'
  | 'exitTryOn'
  | 'apply'
  | 'applying'
  | 'restore'
  | 'applyFailed'
  | 'appliedUnconfirmed'
  | 'appliedNeedRestart'
  | 'theme'
  | 'themeLight'
  | 'themeDark'
  | 'tryOnError'
  | 'backgroundOpacity'
  | 'backgroundBlurEmpty'
  | 'backgroundBlurContent'
  | 'inputCardBlur'
  | 'inputCardBlurHint'
  | 'backgroundBlurHint'
  | 'backgroundBlurInert'
  | 'backgroundHint'
  | 'backgroundHintInert'
  | 'wallpaperTitle'
  | 'wallpaperEnable'
  | 'wallpaperHint'
  | 'wallpaperLoadError'
  | 'wallpaperLibraryFound'
  | 'wallpaperLibraryManual'
  | 'wallpaperRefresh'
  | 'wallpaperMode'
  | 'wallpaperModeLive'
  | 'wallpaperModeFrame'
  | 'wallpaperFit'
  | 'wallpaperFitCover'
  | 'wallpaperFitContain'
  | 'wallpaperFitFill'
  | 'wallpaperClear'
  | 'wallpaperDim'
  | 'wallpaperBlur'
  | 'wallpaperPauseHidden'
  | 'wallpaperSound'
  | 'wallpaperSoundHint'
  | 'wallpaperVolume'
  | 'wallpaperImport'
  | 'wallpaperImportHint'
  | 'wallpaperReimport'
  | 'wallpaperRemove'
  | 'wallpaperUpdateAvailable'
  | 'wallpaperEmpty'
  | 'wallpaperLegal'
  | 'wallpaperTypeVideo'
  | 'wallpaperTypeWeb'
  | 'wallpaperTypeScene'
  | 'wallpaperTypeApp'
  | 'wallpaperDirs'
  | 'wallpaperDirsEmpty'
  | 'wallpaperDirsHint'
  | 'wallpaperDirPlaceholder'
  | 'wallpaperDirAdd'
  | 'customThemeTitle'
  | 'customThemeTagline'
  | 'customThemeEdit'
  | 'customThemeCloseEdit'
  | 'customThemeMode'
  | 'customThemeLight'
  | 'customThemeDark'
  | 'customThemeAccent'
  | 'customThemeBackground'
  | 'customThemeForeground'
  | 'customThemeContrast'
  | 'customThemeReset'
  | 'customThemeResetHint'
  | 'customThemeSaveFailed'

export const en: Record<SkinCenterKey, string> = {
  title: 'Skin Center',
  cardDescription: 'Try on any installed skin live in the GUI — exit restores instantly, applying persists in one click.',
  enabled: 'Enable skin center',
  enabledHint: 'When off, try-on, apply and background controls are disabled; turn it back on to resume.',
  offNote: 'The skin center is turned off.',
  intro: 'Try on any skin live — it takes effect instantly, exit restores the current look. Apply persists it across restarts.',
  official: 'Official default',
  officialTagline: 'The stock DSH look with no skin applied.',
  active: 'Active',
  tryingOn: 'Trying on',
  tryOn: 'Try on',
  loading: 'Loading…',
  exitTryOn: 'Exit try-on',
  apply: 'Apply',
  applying: 'Applying…',
  restore: 'Restore',
  applyFailed: 'Apply failed',
  appliedUnconfirmed: 'Applied, but the change has not been confirmed — refresh the page in dev mode; packaged installs (DSH Desktop) need an app restart',
  appliedNeedRestart: 'Applied and confirmed, but the host did not hot-reload — restart dsh to take effect',
  theme: 'Theme preview',
  themeLight: 'Light',
  themeDark: 'Dark',
  tryOnError: 'Try-on failed — see console',
  backgroundOpacity: 'Background occlusion',
  backgroundBlurEmpty: 'Blur when empty',
  backgroundBlurContent: 'Blur with content',
  inputCardBlur: 'Input card blur',
  inputCardBlurHint: 'Blurs only the area behind the input card while backdrop art is visible; it does not blur the entire wallpaper.',
  backgroundBlurHint: 'Applies a separate Gaussian blur to the backdrop for the empty conversation and the conversation with content; 0 disables.',
  backgroundBlurInert: 'Visible only with skins that paint a backdrop; the official default has none.',
  backgroundHint: 'Instantly veils the backdrop behind the panels — higher values obscure the art to help you focus.',
  backgroundHintInert: 'Only applies to skins that paint a backdrop (Blue Fantasy / Whale Song). Applies to the official default automatically once such a skin is active.',
  wallpaperTitle: 'Wallpaper Engine',
  wallpaperEnable: 'Enable wallpapers',
  wallpaperHint: 'Use your local Wallpaper Engine library as the GUI backdrop: video, web, and scene wallpapers render live (scene wallpapers need WebGL).',
  wallpaperLoadError: 'Wallpaper library failed to load',
  wallpaperLibraryFound: 'Wallpaper Engine library detected',
  wallpaperLibraryManual: 'Manual folders only (no Wallpaper Engine install found; set folders in the skin-wallpaper settings)',
  wallpaperRefresh: 'Refresh',
  wallpaperMode: 'Render mode',
  wallpaperModeLive: 'Live',
  wallpaperModeFrame: 'Static frame',
  wallpaperFit: 'Sizing mode',
  wallpaperFitCover: 'Cover (fill)',
  wallpaperFitContain: 'Fit (entire image)',
  wallpaperFitFill: 'Stretch',
  wallpaperClear: 'Turn off wallpaper',
  wallpaperDim: 'Wallpaper dimming',
  wallpaperBlur: 'Wallpaper blur',
  wallpaperPauseHidden: 'Pause when window hidden',
  wallpaperSound: 'Wallpaper sound',
  wallpaperSoundHint: 'Play video wallpaper audio. The browser may keep it silent until you click or press a key once.',
  wallpaperVolume: 'Wallpaper volume',
  wallpaperImport: 'Import',
  wallpaperImportHint: 'Copy this wallpaper into local storage, so it keeps working even if the Steam library moves or changes',
  wallpaperReimport: 'Update',
  wallpaperRemove: 'Remove',
  wallpaperUpdateAvailable: 'The workshop original changed since import — update the local copy',
  wallpaperEmpty: 'No wallpapers found. Subscribe in the Wallpaper Engine workshop, or add manual folders to the skin-wallpaper settings.',
  wallpaperLegal: 'Wallpapers belong to their Workshop authors. Everything stays on this machine for personal use; nothing is uploaded or shared.',
  wallpaperTypeVideo: 'Video',
  wallpaperTypeWeb: 'Web',
  wallpaperTypeScene: 'Scene (static)',
  wallpaperTypeApp: 'Unsupported',
  wallpaperDirs: 'Manual folders',
  wallpaperDirsEmpty: 'No manual folders yet.',
  wallpaperDirsHint: 'No Wallpaper Engine (e.g. macOS)? Point a folder at any .mp4/.webm files, a wallpaper project folder, or a folder of projects — they become your wallpaper library.',
  wallpaperDirPlaceholder: '/path/to/wallpapers or ~/Movies/wallpapers',
  wallpaperDirAdd: 'Add',
  customThemeTitle: 'Custom theme',
  customThemeTagline: 'A separately saved palette derived from the official default theme.',
  customThemeEdit: 'Edit',
  customThemeCloseEdit: 'Collapse',
  customThemeMode: 'Editing mode',
  customThemeLight: 'Light',
  customThemeDark: 'Dark',
  customThemeAccent: 'Accent',
  customThemeBackground: 'Background',
  customThemeForeground: 'Foreground',
  customThemeContrast: 'Contrast',
  customThemeReset: 'Restore current mode default',
  customThemeResetHint: 'Only resets the selected light or dark profile.',
  customThemeSaveFailed: 'Could not save custom theme changes.',
}

export const zh: Record<SkinCenterKey, string> = {
  title: '皮肤中心',
  cardDescription: '在 GUI 内即时试穿任意皮肤，退出即完全还原；应用一键完成并自动刷新。',
  enabled: '启用皮肤中心',
  enabledHint: '关闭后停用试穿、应用与背景控件，重新打开即恢复。',
  offNote: '皮肤中心已关闭。',
  intro: '任意皮肤可即时试穿，退出即完全还原；「应用」一键持久化，页面自动刷新生效。',
  official: '官方默认',
  officialTagline: '还原 DSH 官方默认外观，不应用任何皮肤。',
  active: '当前激活',
  tryingOn: '试穿中',
  tryOn: '试穿',
  loading: '加载中…',
  exitTryOn: '退出试穿',
  apply: '应用',
  applying: '应用中…',
  restore: '恢复默认',
  applyFailed: '应用失败',
  appliedUnconfirmed: '已写入配置但尚未确认生效——开发模式请刷新页面；打包版（DSH Desktop）需重启应用后生效',
  appliedNeedRestart: '已写入配置并确认生效，但宿主未热重载——请重启 dsh 后生效',
  theme: '主题预览',
  themeLight: '亮色',
  themeDark: '暗色',
  tryOnError: '试穿失败，详见控制台',
  backgroundOpacity: '背景遮挡',
  backgroundBlurEmpty: '空对话背景模糊',
  backgroundBlurContent: '有对话背景模糊',
  inputCardBlur: '输入卡模糊',
  inputCardBlurHint: '仅模糊输入卡背后的区域，不会让整张壁纸变糊。',
  backgroundBlurHint: '对话为空与有内容时分别应用不同的背景高斯模糊强度，0 为关闭。',
  backgroundBlurInert: '仅对带背景图插画的皮肤可见；官方默认无背景图。',
  backgroundHint: '即时为面板背后的背景加遮罩——数值越高越能弱化插画，帮你集中注意力。',
  backgroundHintInert: '仅对带背景图插画的皮肤（蓝色幻想 / 鲸吟）生效；官方默认无背景图，该滑块对这些皮肤自动生效。',
  wallpaperTitle: 'Wallpaper Engine',
  wallpaperEnable: '启用动态壁纸',
  wallpaperHint: '把本机 Wallpaper Engine 壁纸库用作 GUI 背景：视频、网页与场景壁纸均动态渲染（场景壁纸需要 WebGL）。',
  wallpaperLoadError: '壁纸库加载失败',
  wallpaperLibraryFound: '已检测到 Wallpaper Engine 壁纸库',
  wallpaperLibraryManual: '仅手动目录（未检测到 Wallpaper Engine 安装，可在 skin-wallpaper 设置里添加目录）',
  wallpaperRefresh: '刷新',
  wallpaperMode: '渲染模式',
  wallpaperModeLive: '动态',
  wallpaperModeFrame: '静态帧',
  wallpaperFit: '适应方式',
  wallpaperFitCover: '铺满裁剪',
  wallpaperFitContain: '完整缩放',
  wallpaperFitFill: '拉伸铺满',
  wallpaperClear: '关闭壁纸',
  wallpaperDim: '壁纸暗化',
  wallpaperBlur: '壁纸模糊',
  wallpaperPauseHidden: '窗口隐藏时暂停',
  wallpaperSound: '壁纸声音',
  wallpaperSoundHint: '播放视频壁纸的声音。浏览器可能在首次点击或按键前保持静音。',
  wallpaperVolume: '壁纸音量',
  wallpaperImport: '导入',
  wallpaperImportHint: '把该壁纸复制到本地存储，Steam 库迁移或变动后仍可继续使用',
  wallpaperReimport: '更新',
  wallpaperRemove: '移除',
  wallpaperUpdateAvailable: '工坊原件在导入后有更新——同步更新本地副本',
  wallpaperEmpty: '未发现壁纸。可先在 Wallpaper Engine 创意工坊订阅，或在 skin-wallpaper 设置里添加手动目录。',
  wallpaperLegal: '壁纸素材版权归创意工坊作者所有，仅供本机个人使用，不上传、不分享。',
  wallpaperTypeVideo: '视频',
  wallpaperTypeWeb: '网页',
  wallpaperTypeScene: '场景(静态)',
  wallpaperTypeApp: '不支持',
  wallpaperDirs: '手动目录',
  wallpaperDirsEmpty: '还没有手动目录。',
  wallpaperDirsHint: '没有 Wallpaper Engine（如 macOS）？把任意 .mp4/.webm 视频、单个壁纸项目文件夹或项目合集文件夹加进来，就是你的壁纸库。',
  wallpaperDirPlaceholder: '/path/to/wallpapers 或 ~/Movies/wallpapers',
  wallpaperDirAdd: '添加',
  customThemeTitle: '自定义主题',
  customThemeTagline: '基于官方默认主题生成并独立保存的配色方案。',
  customThemeEdit: '编辑',
  customThemeCloseEdit: '收起',
  customThemeMode: '编辑模式',
  customThemeLight: '浅色',
  customThemeDark: '深色',
  customThemeAccent: '强调色',
  customThemeBackground: '背景色',
  customThemeForeground: '前景色',
  customThemeContrast: '对比度',
  customThemeReset: '恢复当前模式默认',
  customThemeResetHint: '只重置当前选择的浅色或深色配置。',
  customThemeSaveFailed: '自定义主题修改保存失败。',
}
