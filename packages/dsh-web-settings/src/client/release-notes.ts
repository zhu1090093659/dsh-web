/**
 * Structured release-notes source for the Web UI version-notes card.
 *
 * The dsh-web-ui repo already publishes categorized release notes
 * (scripts/release-notes.mjs auto-generates them from conventional commits,
 * and docs/release-notes/<tag>.md keeps a maintainer-curated bilingual copy).
 * This module repackages those notes into a typed, bundle-friendly shape the
 * client renders — a couple of Highlights up top plus the full New / Improved /
 * Fixed change lists, mirroring the Reasonix changelog layout the card
 * implements.
 *
 * Maintainers: keep this in sync with the release you are shipping. Each entry
 * follows the shape documented on `ReleaseEntry`. Add the newest release to
 * the TOP of `RELEASES` and bump `CURRENT_VERSION` to its version tag.
 */

/** One notable change in a release. */
export interface ReleaseChange {
  /** Display category: new feature / improvement / bug fix. */
  kind: 'new' | 'improved' | 'fixed'
  /** Short headline. */
  title: string
  /** One-sentence description. */
  desc: string
  /** Linked issue/PR references (numbers only). */
  refs?: string[]
}

/** The "New" / "Improved" / "Fixed" buckets of a release. */
export interface ReleaseSections {
  /** Brand-new capabilities. */
  new: string[]
  /** Refinements of existing behavior. */
  improved: string[]
  /** Bug fixes. */
  fixed: string[]
}

/** One shipped release. */
export interface ReleaseEntry {
  /** Version tag, e.g. "0.3.2" (no leading v). */
  version: string
  /** ISO date the release shipped. */
  date: string
  /** One-line summary shown under the version heading. */
  lede: string
  /** Top highlights, rendered as the Reasonix-style cards. */
  highlights: ReleaseChange[]
  /** Full per-category change lists. */
  sections: ReleaseSections
}

/** The version currently installed (the newest entry in RELEASES). */
export const CURRENT_VERSION = '0.3.2'

/** Every release the version-notes card knows about, newest first. */
export const RELEASES: ReleaseEntry[] = [
  {
    version: '0.3.2',
    date: '2026-08-23',
    lede: '聚焦市场与皮肤中心：新增 Maid Atelier 皮肤、市场机器可发现性优化，并修复了并发策略写入与皮肤清理问题。',
    highlights: [
      { kind: 'new', title: 'Maid Atelier 皮肤', desc: '新增 maid-atelier 皮肤资产，含生命周期钩子、资产管理与 DOM 观察逻辑。', refs: [] },
      { kind: 'improved', title: '市场机器可发现性', desc: '市场主页通过 Accept 协商提供 markdown，并发布 robots.txt / sitemap.xml 供 AI 代理发现。', refs: [] },
      { kind: 'fixed', title: '并发策略写入不再中止宿主', desc: 'doctor 并发写策略文件不再中止宿主启动。', refs: [] },
    ],
    sections: {
      new: [
        '[skins] 新增 maid-atelier 皮肤资产并更新样式基础设施',
        '[market] 通过 Accept 协商为 agent 提供 markdown 主页',
        '[market] 发布市场 API 的 RFC 9727 api-catalog',
        '[market] 发布 robots.txt 与 sitemap.xml 以提升 agent 可发现性',
      ],
      improved: [
        '[market] 为主页添加 Link 响应头以支持 agent 发现',
        '[market] 在 robots.txt 中声明 AI 使用的内容信号与爬虫访问',
      ],
      fixed: [
        '[doctor] 并发写策略文件不再中止宿主启动',
        '[skin-center] maid-atelier 清理时恢复动态 body 样式属性',
        '[skin-center] 应用皮肤时清除墙纸',
        '[market] 将市场标识符限定到 dsh-web-ui-market 命名空间',
        '[remote-web-ui] 移除移动端工作区目录行中的 emoji',
      ],
    },
  },
  {
    version: '0.3.0',
    date: '2026-08-23',
    lede: '大规模发布：皮肤中心壁纸与主题、DSH 市场整合、移动端审批面板与工作区创建，以及大量稳定性修复。',
    highlights: [
      { kind: 'new', title: '移动端审批/提问面板', desc: '移动端审批与提问面板、轮次指示、工作区创建、工具卡片。', refs: ['1024', '1025', '1017', '977', '529'] },
      { kind: 'new', title: '皮肤中心壁纸增强', desc: '自动检测 macOS 壁纸，支持系统原生目录选择器浏览壁纸文件夹。', refs: [] },
      { kind: 'improved', title: 'DSH 市场整合', desc: '皮肤中心、宠物与社区插件合并为一个 DSH 市场菜单，浏览器卡片支持一键安装。', refs: [] },
      { kind: 'fixed', title: 'describe-image 安全加固', desc: '阻止私有图片目标并将本地路径限制在会话工作区内。', refs: [] },
    ],
    sections: {
      new: [
        '[skin-center] 自动检测 macOS 壁纸（Aerial 动态壁纸与桌面图片）',
        '[remote] 移动端审批/提问面板、轮次指示、工作区创建、工具卡片、UUID polyfill',
        '[skins] 新增 war-thunder 战场主题',
        '[market] 将 gallery 升级为 dsh-market.com 上的 DSH 市场',
        '[pets] 添加鲸鱼精修待机预览并显示全身领奖台缩略图',
      ],
      improved: [
        '[market] 将 DSH Market 更名为 Workshop（创意工坊）',
        '[skins] Pink Sakura 侧边栏选中行使用猫爪标记',
        '[skin-center] 通过系统原生目录选择器浏览壁纸文件夹',
      ],
      fixed: [
        '[skin-center] 重写过期注释以通过 runtime-deps 门禁',
        '[session-id] 重复点击与卸载时清除复制状态定时器',
        '[describe-image] 阻止私有图片目标并限制本地路径在会话工作区内',
        '[git-graph] 搜索框使用品牌色 2px 焦点边框',
      ],
    },
  },
]
