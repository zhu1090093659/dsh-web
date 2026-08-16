/**
 * Locale strings for the panel surfaces (zh/en). The client registers the
 * dictionary through the locale service like the sibling plugins; copy is
 * deliberately short and technical.
 * @module dsh-aionui-panel/client/locales
 */

const zh = {
  'explorer.tabs.files': '文件',
  'explorer.tabs.changes': '变更',
  'explorer.search.placeholder': '按文件名搜索',
  'explorer.search.modeName': '文件名',
  'explorer.search.modeContent': '内容',
  'explorer.search.contentPlaceholder': '搜索文件内容',
  'explorer.search.searching': '搜索中…',
  'explorer.search.empty': '没有匹配的文件',
  'explorer.search.contentEmpty': '没有匹配的文件内容',
  'explorer.search.error': '搜索失败',
  'explorer.search.truncated': '结果过多，仅显示前 {count} 条',
  'explorer.search.contentTruncated': '结果过多，仅显示前 {count} 个文件',
  'explorer.tree.empty': '项目为空',
  'explorer.collapse': '收起面板',
  'explorer.expand': '展开面板',
  'explorer.openPreview': '打开预览',
  'explorer.drag.dropHint': '松手插入文件路径',
  'explorer.copyCurrentPath': '复制当前路径',
  'explorer.copyGlobalPath': '复制全局路径',
  'scm.repositories': '存储库',
  'scm.changes': '变更',
  'scm.staged': '已暂存',
  'scm.unstaged': '变更',
  'scm.untracked': '未跟踪',
  'scm.conflicted': '冲突',
  'scm.stage': '暂存',
  'scm.unstage': '取消暂存',
  'scm.discard': '放弃更改',
  'scm.stageAll': '全部暂存',
  'scm.discardAll': '全部放弃',
  'scm.empty': '没有更改',
  'scm.notRepo': '当前目录不是 git 仓库',
  'scm.gitMissing': '未检测到 git，请先安装 git 后重试',
  'scm.loading': '读取状态中…',
  'scm.failed': '操作失败',
  'scm.viewList': '列表视图',
  'scm.viewTree': '树视图',
  'scm.discardConfirmTracked': '放弃对 {count} 个文件的更改？此操作不可恢复。',
  'scm.discardConfirmUntracked': '删除 {count} 个未跟踪文件？此操作不可恢复。',
  'preview.noTabs': '没有打开的预览',
  'preview.newUrlTab': '新建 URL 预览',
  'preview.collapsePanel': '收起预览面板',
  'preview.source': '源码',
  'preview.preview': '预览',
  'preview.editor': '编辑器',
  'preview.split': '分屏',
  'preview.refresh': '刷新',
  'preview.refresh.updated': '文件已在磁盘更新',
  'preview.save': '保存',
  'preview.download': '下载',
  'preview.openExternal': '在系统应用中打开',
  'preview.dirty': '未保存的更改',
  'preview.closeLeft': '关闭左侧',
  'preview.closeRight': '关闭右侧',
  'preview.closeOthers': '关闭其他',
  'preview.closeAll': '关闭全部',
  'preview.closeConfirmTitle': '关闭未保存的标签页',
  'preview.closeConfirmBody': '{count} 个标签页有未保存的更改，关闭将丢失这些更改。',
  'preview.saved': '已保存',
  'preview.saveConflict': '文件已在磁盘上被修改，保存冲突：请刷新后重试',
  'preview.errorOversized': '文件过大，仅加载前 80,000 字符',
  'preview.unsupported': '此格式暂不支持预览',
  'preview.downloadHint': '可在系统应用中打开或下载查看',
  'preview.url.placeholder': '输入网址，回车打开',
  'preview.url.hint': '按 Esc 还原',
  'common.cancel': '取消',
  'common.confirm': '确定',
  'common.close': '关闭',
  'common.copy': '复制',
  'common.delete': '删除',
  'common.copyPath': '复制路径',
  'common.copied': '已复制',
} as const

const en: Record<keyof typeof zh, string> = {
  'explorer.tabs.files': 'Files',
  'explorer.tabs.changes': 'Changes',
  'explorer.search.placeholder': 'Search file names',
  'explorer.search.modeName': 'File name',
  'explorer.search.modeContent': 'Content',
  'explorer.search.contentPlaceholder': 'Search file contents',
  'explorer.search.searching': 'Searching…',
  'explorer.search.empty': 'No matching files',
  'explorer.search.contentEmpty': 'No content matches',
  'explorer.search.error': 'Search failed',
  'explorer.search.truncated': 'Too many results, showing first {count}',
  'explorer.search.contentTruncated': 'Too many results, showing first {count} files',
  'explorer.tree.empty': 'The project is empty',
  'explorer.collapse': 'Collapse panel',
  'explorer.expand': 'Expand panel',
  'explorer.openPreview': 'Open preview',
  'explorer.drag.dropHint': 'Release to insert the file path',
  'explorer.copyCurrentPath': 'Copy current path',
  'explorer.copyGlobalPath': 'Copy global path',
  'scm.repositories': 'Repositories',
  'scm.changes': 'Changes',
  'scm.staged': 'Staged',
  'scm.unstaged': 'Changes',
  'scm.untracked': 'Untracked',
  'scm.conflicted': 'Conflict',
  'scm.stage': 'Stage',
  'scm.unstage': 'Unstage',
  'scm.discard': 'Discard',
  'scm.stageAll': 'Stage all',
  'scm.discardAll': 'Discard all',
  'scm.empty': 'No changes',
  'scm.notRepo': 'Not a git repository',
  'scm.gitMissing': 'Git is not installed. Install git and reload to use the changes panel',
  'scm.loading': 'Loading status…',
  'scm.failed': 'Operation failed',
  'scm.viewList': 'List view',
  'scm.viewTree': 'Tree view',
  'scm.discardConfirmTracked': 'Discard changes in {count} files? This cannot be undone.',
  'scm.discardConfirmUntracked': 'Delete {count} untracked files? This cannot be undone.',
  'preview.noTabs': 'No open previews',
  'preview.newUrlTab': 'New URL preview',
  'preview.collapsePanel': 'Collapse preview panel',
  'preview.source': 'Source',
  'preview.preview': 'Preview',
  'preview.editor': 'Editor',
  'preview.split': 'Split',
  'preview.refresh': 'Refresh',
  'preview.refresh.updated': 'File updated on disk',
  'preview.save': 'Save',
  'preview.download': 'Download',
  'preview.openExternal': 'Open in system app',
  'preview.dirty': 'Unsaved changes',
  'preview.closeLeft': 'Close left',
  'preview.closeRight': 'Close right',
  'preview.closeOthers': 'Close others',
  'preview.closeAll': 'Close all',
  'preview.closeConfirmTitle': 'Close unsaved tabs',
  'preview.closeConfirmBody': '{count} tabs have unsaved changes. Closing will lose them.',
  'preview.saved': 'Saved',
  'preview.saveConflict': 'File changed on disk. Save conflict: refresh and retry',
  'preview.errorOversized': 'File too large, only the first 80,000 characters loaded',
  'preview.unsupported': 'Preview not supported for this format',
  'preview.downloadHint': 'Open in a system app or download to view',
  'preview.url.placeholder': 'Enter a URL and press Enter',
  'preview.url.hint': 'Press Esc to revert',
  'common.cancel': 'Cancel',
  'common.confirm': 'OK',
  'common.close': 'Close',
  'common.copy': 'Copy',
  'common.delete': 'Delete',
  'common.copyPath': 'Copy path',
  'common.copied': 'Copied',
}

export type AionUiPanelKey = keyof typeof zh

/** The dictionary namespace this plugin owns. */
export const NS = 'aionui-panel'

/** Format one copy string with {name} placeholders. */
export function format(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? `{${key}}`))
}

/** Simple dictionary access (zh/en by a global flag the client sets). */
export const dictionaries: Record<'zh' | 'en', Record<AionUiPanelKey, string>> = { zh, en }

let currentLanguage: 'zh' | 'en' = 'zh'

/** Set the active language (the client mirrors the locale service). */
export function setLanguage(language: string): void {
  currentLanguage = language === 'en' ? 'en' : 'zh'
}

/** Translate one key with optional params. */
export function t(key: AionUiPanelKey, params?: Record<string, string | number>): string {
  const table = dictionaries[currentLanguage] ?? zh
  const template = table[key] ?? zh[key]
  return params === undefined ? template : format(template, params)
}
