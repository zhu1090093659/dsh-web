/**
 * The community-plugins locale dictionaries for the index card. Static copy
 * for the card chrome plus one localized name/description pair per index
 * entry (`name.<id>` / `desc.<id>`), so the card localizes data-driven text
 * through the same `t` the rest of the settings UI uses — the document
 * `<html lang>` attribute is not a reliable locale signal in the GUI.
 */

import { COMMUNITY_PLUGINS } from './generated/community.ts'

/** Simplified Chinese copy for the card chrome (the key-set source of truth). */
const STATIC_ZH = {
  'settings.title': '社区插件',
  'settings.description': '社区贡献者开发与维护的插件，链接指向作者自己的仓库。',
  'settings.enabled': '启用社区插件索引',
  'settings.enabledHint': '此开关只控制索引列表的显示与否，关闭后在这里重新打开。',
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
  'author': '作者',
  'repository': '仓库',
  'copy': '复制',
  'copied': '已复制',
  'install': '复制安装命令',
  'noMatch': '没有匹配的社区插件。',
  'search.placeholder': '搜索名称、作者或简介',
  'search.label': '搜索社区插件',
  'filter.all': '全部',
  'result.count': '显示 {shown} / {total} 个',
  'badge.published': 'npm 已发布',
  'badge.source': '仓库安装',
  'category.ui': '界面与体验',
  'category.agent': 'Agent 与自动化',
  'category.tools': '开发者工具',
  'category.knowledge': '记忆与知识',
  'category.integration': '集成与分享',
  'category.security': '安全与运维',
  'category.utility': '实用工具',
  'installHint': '索引只登记、不安装代码。要运行某个插件，复制它的安装命令到终端执行；安装后，插件自带的开关与配置（若有）会出现在插件配置里。',
  'empty': '暂无社区插件登记。',
  'off': '社区插件索引已关闭。',
  'notice': '条目由贡献者自行登记，与 dsh-web-ui 的发布内容无关；使用前请自行评估。',
} satisfies Record<string, string>

/** English copy for the card chrome, checked complete against the zh key set. */
const STATIC_EN = {
  'settings.title': 'Community Plugins',
  'settings.description': "Plugins developed and maintained by community contributors, linking to each author's own repository.",
  'settings.enabled': 'Enable the community plugin index',
  'settings.enabledHint': 'This switch only controls whether the index list is shown; turn it back on here.',
  'settings.inherit': 'Inherit',
  'settings.on': 'On',
  'settings.off': 'Off',
  'settings.overridden': 'Overridden',
  'settings.reset': 'Reset to default',
  'settings.notExposed': "This DSH version does not expose this plugin's settings namespace to the configuration page, so the form is unavailable. Edit ~/.dsh/settings.yaml directly, or add the namespace to dsh-host-apiproxy's WEB_SETTINGS_NAMESPACES allowlist and restart.",
  'settings.readOnly': 'This deployment stores settings read-only.',
  'settings.expand': 'Show settings',
  'settings.collapse': 'Hide settings',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.discard': 'Discard',
  'settings.unsaved': 'Unsaved',
  'settings.saveFailed': 'The deployment did not accept these values; they were left for you to correct.',
  'settings.invalidNumber': 'Enter a number, or leave blank to use the default.',
  'author': 'Author',
  'repository': 'Repository',
  'copy': 'Copy',
  'copied': 'Copied',
  'install': 'Copy install command',
  'noMatch': 'No matching community plugin found.',
  'search.placeholder': 'Search name, author or description',
  'search.label': 'Search community plugins',
  'filter.all': 'All',
  'result.count': 'Showing {shown} / {total}',
  'badge.published': 'Published on npm',
  'badge.source': 'Install from repo',
  'category.ui': 'UI & Experience',
  'category.agent': 'Agents & Automation',
  'category.tools': 'Developer Tools',
  'category.knowledge': 'Memory & Knowledge',
  'category.integration': 'Integration & Sharing',
  'category.security': 'Security & Ops',
  'category.utility': 'Utilities',
  'installHint': 'The index only registers entries, it never installs code. To run a plugin, copy its install command into a terminal; once installed, the plugin provides its own switch and config (if any) in the plugin configuration section.',
  'empty': 'No community plugins registered yet.',
  'off': 'The community plugin index is turned off.',
  'notice': 'Entries are contributed by their authors and are separate from dsh-web-ui releases; evaluate before use.',
} satisfies Record<keyof typeof STATIC_ZH, string>

/** Build the runtime dictionary: static copy plus one localized name/description pair per index entry. */
function build(base: Record<string, string>, lang: 'zh' | 'en'): Record<string, string> {
  const dict: Record<string, string> = { ...base }
  for (const entry of COMMUNITY_PLUGINS) {
    dict[`name.${entry.id}`] = lang === 'zh' ? entry.name : entry.nameEn
    dict[`desc.${entry.id}`] = lang === 'zh'
      ? (entry.description ?? entry.descriptionEn ?? '')
      : (entry.descriptionEn ?? entry.description ?? '')
  }
  return dict
}

/** Simplified Chinese dictionary for the index card (chrome + per-entry copy). */
export const zh = build(STATIC_ZH, 'zh')

/** English dictionary, built from the same key set. */
export const en = build(STATIC_EN, 'en')

/** Key union for this namespace (chrome keys plus per-entry name/description keys). */
export type CommunityPluginKey = keyof typeof zh
