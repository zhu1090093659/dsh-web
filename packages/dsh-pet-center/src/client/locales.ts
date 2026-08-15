/**
 * Pet-center locale dictionaries. The plugin-card name, its description, and
 * every control of the in-GUI pet center is localized through the standard
 * `t` seat (no emoji — repo rule).
 */

/** Copy keys owned by this plugin. */
export type PetCenterKey =
  | 'title'
  | 'cardDescription'
  | 'expand'
  | 'collapse'
  | 'intro'
  | 'original'
  | 'originalTagline'
  | 'introduced'
  | 'introducedTagline'
  | 'active'
  | 'tryingOn'
  | 'tryOn'
  | 'exitTryOn'
  | 'apply'
  | 'applying'
  | 'applyFailed'
  | 'appliedUnconfirmed'

export const en: Record<PetCenterKey, string> = {
  title: 'Pet Center',
  cardDescription: 'Switch between the original whale pet and the introduced whale-maid pet — try one on, then apply.',
  expand: 'Expand',
  collapse: 'Collapse',
  intro: 'Choose which pet companion shows. Switching takes effect within seconds (the config watcher hot-reloads it); refresh the page to see the change.',
  original: 'Original whale',
  originalTagline: 'The original dsh-pet whale-girl companion.',
  introduced: 'Introduced whale maid',
  introducedTagline: 'The dsh-pet-maid whale-maid companion we brought in.',
  active: 'Active',
  tryingOn: 'Trying on',
  tryOn: 'Try on',
  exitTryOn: 'Exit try-on',
  apply: 'Apply',
  applying: 'Applying…',
  applyFailed: 'Apply failed',
  appliedUnconfirmed: 'Applied, but the change has not been confirmed — refresh the page if the pet did not switch',
}

export const zh: Record<PetCenterKey, string> = {
  title: '宠物中心',
  cardDescription: '切换最初版的鲸鱼娘宠物与引入的女仆鲸鱼娘宠物——先试穿，再应用。',
  expand: '展开',
  collapse: '收起',
  intro: '选择显示哪个宠物陪伴。切换会写入配置，配置监听器数秒内热更新；刷新页面即可看到新宠物。',
  original: '最初版鲸鱼娘',
  originalTagline: '最初版的 dsh-pet 鲸鱼娘陪伴。',
  introduced: '引入的女仆鲸鱼娘',
  introducedTagline: '我们引入的 dsh-pet-maid 女仆鲸鱼娘陪伴。',
  active: '当前激活',
  tryingOn: '试用中',
  tryOn: '试用',
  exitTryOn: '退出试用',
  apply: '应用',
  applying: '应用中…',
  applyFailed: '应用失败',
  appliedUnconfirmed: '已写入配置但尚未确认生效——若宠物未切换请手动刷新页面',
}
