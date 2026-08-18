/**
 * Pet chatter — the pet's voice while sessions work. Two speakers live here:
 *
 *  1. The status voice (session bubbles): big per-scene copy pools instead of
 *     one fixed line per phase, a fine-grained tool-name → copy-family map,
 *     and a compact real-argument hint ('跑跑 npm test'), in the spirit of
 *     the working-activity plugin's status line. Lines rotate round-robin —
 *     while a phase persists the copy advances every few seconds, so the pet
 *     feels alive without flickering per streamed chunk.
 *  2. The murmur engine (碎碎念): the pet's inner whispers, woken by the
 *     model's own output — keyword moods (errors, test greens, plans,
 *     self-corrections, victories...) plus an ambient pool earned by output
 *     volume. A cooldown keeps whispers occasional.
 *
 * Pure and deterministic: round-robin everywhere (no Math.random), clocks are
 * injected. The first line of each status pool is the legacy fixed copy the
 * plugin has always shown, so existing installs keep their wording until the
 * scene cycles. No emoji anywhere (repository rule); ～ is the whale-girl's
 * signature.
 * @module @linxin666/dsh-pet/chatter
 */

/** Status copy scenes — the situations a session bubble can report. */
export type StatusScene =
  | 'prepare'
  | 'waiting'
  | 'thinking'
  | 'review'
  | 'toolResult'
  | 'done'
  | 'failed'
  | 'toolFailed'
  | 'maxTokens'
  | 'interrupted'
  | 'blocked'

/** While a scene persists, its copy advances on this cadence (ms). */
export const STATUS_ROTATE_MS = 4000

/** Fixed-copy pools per status scene (first line = legacy wording). */
export const STATUS_POOLS: Readonly<Record<StatusScene, readonly string[]>> = {
  prepare: [
    '准备开始',
    '撸起袖子开工啦',
    '新一轮，出发～',
    '打起精神，开干！',
    '整理一下桌面，开始吧',
    '氧气充满，下潜开始～',
    '热身完毕，跃跃欲试',
    '开工仪式感已就位',
  ],
  waiting: [
    '等待模型响应',
    '呼叫大脑中，请稍等',
    '信号发射中，等一个回音',
    '灵感正在路上～',
    '竖起耳朵等回复',
    '大脑在咕噜咕噜加载',
    '等它伸个懒腰再开口',
    '模型：来了来了',
    '等一个灵感砸中我',
    '滴——等待连线中',
    '它在组织语言，别催',
    '等它热身完毕',
    '灵感快递派送中',
    '屏住呼吸等回复',
  ],
  thinking: [
    '正在思考',
    '嗯……让我想一想',
    '脑内风暴进行中',
    '思绪咕噜咕噜冒泡',
    '灵光集结中～',
    '眉头一皱，认真分析',
    '左脑右脑一起开会',
    '答案正在浮出水面',
    '盘一下，盘一下逻辑',
    '让子弹再飞一会儿',
    '别催别催，在想呢',
    '大脑转起来了',
    '让我把线索捋一捋',
    '脑内跑火车中',
    '小脑瓜高速运转',
    '让我琢磨琢磨',
    '翻翻脑子里的藏书',
    '让我嚼一嚼这个问题',
    '脑子在煮咖啡，马上好',
    '思考的鱼游来了',
    '让我康康这里面的门道',
    '正在盘逻辑链',
    '思绪整理收纳中',
    '嗯？有点意思……',
    '让思路沉淀一下',
    '脑内弹幕飞速滚动',
  ],
  review: [
    '整理回复中',
    '把想法写下来',
    '组织语言中～',
    '落笔成文，请稍候',
    '字斟句酌中',
    '把答案装进信封里',
    '遣词造句打磨中',
    '把思绪码成整整齐齐的字',
    '奋笔疾书中',
    '把最好的表达挑出来',
    '文字排版美容师上线',
    '收尾润色一下下',
  ],
  toolResult: [
    '处理工具结果',
    '看看带回了什么',
    '消化一下刚到的结果',
    '结果解读中～',
    '验收工具的成果',
    '把线索拼接起来',
    '战利品清点中',
    '这份结果有点东西',
    '把新情报归档',
    '结果到手，继续前进',
  ],
  done: [
    '完成啦',
    '搞定收工～',
    '任务达成，耶！',
    '这一轮圆满完成',
    '顺利抵达终点',
    '收工！求摸摸奖励',
    '交差！下一位',
    '齐活，漂亮收官',
    '拿下！击掌～',
    '稳了，满分交卷',
    '搞定，去喝口水',
    '完工咯，转个圈圈',
    '这一轮，我们配合满分',
    '妥了妥了，收工收工',
  ],
  failed: [
    '执行失败',
    '哎呀，中途卡住了',
    '这一步没能走完',
    '被小石头绊倒了',
    '半路翻车了，揉揉膝盖',
    '出了点岔子，缓缓再来',
  ],
  toolFailed: [
    '工具执行失败',
    '工具闹脾气了，哄哄它',
    '哎呀，工具掉链子了',
    '这个工具今天不太听话',
    '工具翻车了，扶起来继续',
    '没跑通，再来一次',
    '工具：我罢工三秒钟',
    '这一步摔了一跤，没事',
  ],
  maxTokens: [
    '达到输出上限',
    '话说到一半被截断了',
    '字数用完了，喘口气',
    '一口气说太满，缓缓',
  ],
  interrupted: [
    '执行意外中断',
    '哎呀，被意外打断了',
    '半路踩了急刹车',
    '被迫停下，意犹未尽',
  ],
  blocked: [
    '等待继续',
    '在这里等你发令',
    '暂停待命，随时出发',
    '蹲一个继续的指令',
  ],
}

/** Tool families for friendlier per-tool status copy. */
export type ToolCategory =
  | 'read'
  | 'write'
  | 'edit'
  | 'shell'
  | 'grep'
  | 'find'
  | 'ls'
  | 'webSearch'
  | 'webFetch'
  | 'mcp'
  | 'memory'
  | 'subagent'
  | 'todo'
  | 'browser'
  | 'git'
  | 'ask'
  | 'generic'

/** Map a raw tool name onto its copy family (working-activity style regexes). */
export function toolCategory(toolName: string): ToolCategory {
  const name = toolName.toLowerCase()
  if (/mem0|recall|memory/.test(name)) return 'memory'
  if (/subagent|workflow|ralph|agent|task/.test(name)) return 'subagent'
  if (/web_search|websearch|search_web|exa|brave|tavily/.test(name)) return 'webSearch'
  if (/fetch|browser|playwright|chrome/.test(name)) return 'webFetch'
  if (/grep|search|rg/.test(name)) return 'grep'
  if (/glob|find/.test(name)) return 'find'
  if (/^ls$|list_dir|list/.test(name)) return 'ls'
  if (/ask_user|ask/.test(name)) return 'ask'
  if (/todo|plan/.test(name)) return 'todo'
  if (/git/.test(name)) return 'git'
  if (/mcp__|mcp/.test(name)) return 'mcp'
  if (/read|open|load|describe|inspect/.test(name)) return 'read'
  if (/edit|patch|replace|rename/.test(name)) return 'edit'
  if (/write|create|save/.test(name)) return 'write'
  if (/run_code|bash|shell|terminal|exec|command|ssh/.test(name)) return 'shell'
  return 'generic'
}

/**
 * Per-family tool status pools. '{tool}' interpolates the compact tool name,
 * '{hint}' the compact real-argument hint (both optional per line); the first
 * entry of every pool is the legacy '正在使用 {tool}' wording.
 */
export const TOOL_POOLS: Readonly<Record<ToolCategory, readonly string[]>> = {
  read: [
    '正在使用 {tool}',
    '翻翻 {hint}',
    '读一下 {hint}',
    '让我康康这个文件',
    '逐行品味 {hint}',
    '翻阅资料中～',
    '瞄一眼 {hint}',
    '把文件摊开看一看',
    '认真研读 {hint}',
  ],
  write: [
    '正在使用 {tool}',
    '写写写，写 {hint}',
    '下笔中～',
    '码字呢，别催',
    '写下 {hint}',
    '落笔成章',
    '把想法存进 {hint}',
    '开写开写',
    '存个文件压压惊',
  ],
  edit: [
    '正在使用 {tool}',
    '改改 {hint}',
    '修修补补中',
    '润色一下 {hint}',
    '改两行，就两行',
    '补一刀 {hint}',
    '动动手指改一改',
    '精雕细琢 {hint}',
    '微调一下下',
  ],
  shell: [
    '正在使用 {tool}',
    '跑跑 {hint}',
    '敲几行命令试试',
    '命令行走起：{hint}',
    '使唤终端跑个腿',
    '终端全速运转中',
    '敲回车！{hint}',
    '让命令飞一会儿',
    '去终端里探个究竟',
  ],
  grep: [
    '正在使用 {tool}',
    '搜搜 {hint}',
    '找找匹配：{hint}',
    '关键词走你',
    '在代码里挖一挖',
    '检索小雷达启动',
    '顺着 {hint} 追下去',
    '掘地三尺找一找',
    '过滤筛选中～',
  ],
  find: [
    '正在使用 {tool}',
    '找找文件 {hint}',
    '寻宝中～',
    '文件在哪里呀',
    '找啊找啊找文件',
    '把 {hint} 揪出来',
    '查找模式中',
  ],
  ls: [
    '正在使用 {tool}',
    '列个清单看看',
    '看看目录里有啥',
    '目录走起～',
    '瞟一眼文件夹',
    '数数这里有几个文件',
  ],
  webSearch: [
    '正在使用 {tool}',
    '网上搜搜 {hint}',
    '网络冲浪中',
    '帮你问问互联网',
    '搜一圈 {hint}',
    '去外面的世界打听打听',
    '查找资料中～',
    '情报收集模式开启',
  ],
  webFetch: [
    '正在使用 {tool}',
    '抓个页面看看',
    '拉取 {hint}',
    '扒拉一下网页',
    '取点内容回来',
    '打开 {hint} 瞅瞅',
  ],
  mcp: [
    '正在使用 {tool}',
    '连一下外部服务',
    '喊个外援来',
    '接个工具用用',
    '问问插件小助手',
    '外部力量接入中',
  ],
  memory: [
    '正在使用 {tool}',
    '翻翻小本本',
    '回想一下之前的事',
    '在记忆里挖一挖',
    '提取记忆碎片～',
    '我们之前的约定是……',
  ],
  subagent: [
    '正在使用 {tool}',
    '派个小弟去跑腿',
    '小助手出动！',
    '交给分身去办',
    '多线作战，分身出击',
    '召唤队友支援',
    '集思广益中～',
  ],
  todo: [
    '正在使用 {tool}',
    '列个待办清单',
    '写个小计划',
    '待办安排得明明白白',
    '打个勾，继续',
    '把任务排排坐',
  ],
  browser: [
    '正在使用 {tool}',
    '开个浏览器看看',
    '网页操作小能手',
    '替你点点页面',
    '浏览器跑腿中',
  ],
  git: [
    '正在使用 {tool}',
    '提交一下代码',
    '版本控制走起',
    '管管仓库',
    '给改动安个家',
  ],
  ask: [
    '正在使用 {tool}',
    '问你个事儿',
    '请教一下下',
    '等等，我需要确认',
    '这个问题得你拍板',
  ],
  generic: [
    '正在使用 {tool}',
    '召唤 {tool} 出击',
    '{tool} 工作中',
    '借助 {tool} 的力量',
    '拜托 {tool} 一下',
    '{tool}，启动！',
  ],
}

/** Pools for the parallel-tools line; '{n}' interpolates the running count. */
export const TOOL_REMAINING_POOL: readonly string[] = [
  '还有 {n} 个工具运行中',
  '{n} 路并进，分身们还在忙',
  '还有 {n} 位小助手在加班',
  '{n} 条战线同时推进中',
  '另 {n} 个工具在后台跑',
]

/**
 * A compact, human-readable hint of what a tool call actually touches —
 * the command, the path, the pattern, the query. Best-effort parse of the
 * raw arguments JSON; unknown shapes stay hintless. Capped short so the
 * bubble stays compact.
 */
export function toolArgHint(toolName: string, argumentsJson: string): string | undefined {
  let args: unknown
  try {
    args = JSON.parse(argumentsJson)
  } catch {
    return undefined
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  const record = args as Record<string, unknown>
  const category = toolCategory(toolName)
  const candidateKeys: readonly string[] = (() => {
    switch (category) {
      case 'shell': return ['command', 'code', 'cmd']
      case 'grep': return ['pattern', 'query', 'path']
      case 'find': return ['pattern', 'path', 'glob']
      case 'read': case 'write': case 'edit': return ['file_path', 'path', 'filePath', 'file']
      case 'webSearch': return ['query', 'q', 'keyword']
      case 'webFetch': case 'browser': return ['url', 'uri']
      case 'subagent': return ['description', 'label', 'prompt']
      case 'ls': return ['path', 'dir', 'directory']
      case 'git': return ['command', 'message']
      default: return ['command', 'query', 'path', 'file_path', 'description', 'title', 'name']
    }
  })()
  for (const key of candidateKeys) {
    const value = record[key]
    if (typeof value !== 'string') continue
    const compact = value.replace(/\s+/g, ' ').trim()
    if (compact === '') continue
    const base = compact.split('/').pop() ?? compact
    const shown = (category === 'read' || category === 'write' || category === 'edit') && base !== '' ? base : compact
    return shown.length <= 28 ? shown : shown.slice(0, 25) + '...'
  }
  return undefined
}

/**
 * Round-robin voice for status copy. Scene-keyed picks stay STABLE while the
 * same scene repeats (streaming chunks re-emit the same phase many times per
 * second, and rotating per chunk would make the bubble flicker), but advance
 * once the scene has persisted past the rotation cadence, so a long thinking
 * stretch keeps changing its wording.
 */
export class StatusVoice {
  private readonly counters = new Map<string, number>()
  private lastScene = ''
  private lastLine = ''
  private lastLineAt = Number.NEGATIVE_INFINITY

  constructor(private readonly rotateMs: number = STATUS_ROTATE_MS) {}

  /** Draw the next line of one pool, advancing its round-robin cursor. */
  private draw(poolKey: string, pool: readonly string[]): string {
    const index = (this.counters.get(poolKey) ?? 0) % pool.length
    this.counters.set(poolKey, index + 1)
    return pool[index]!
  }

  /** Reuse the stable line or advance when the cadence elapsed. */
  private voice(scene: string, poolKey: string, pool: readonly string[], nowMs: number): string {
    if (scene === this.lastScene && nowMs - this.lastLineAt < this.rotateMs) return this.lastLine
    this.lastScene = scene
    this.lastLine = this.draw(poolKey, pool)
    this.lastLineAt = nowMs
    return this.lastLine
  }

  /** Status line for a phase scene. */
  scene(scene: StatusScene, nowMs: number): string {
    return this.voice('scene:' + scene, 'pool:' + scene, STATUS_POOLS[scene], nowMs)
  }

  /** Status line for a tool call, with the real-argument hint when known. */
  tool(toolName: string, displayName: string, hint: string | undefined, nowMs: number): string {
    const category = toolCategory(toolName)
    const line = this.voice('tool:' + category, 'tool:' + category, TOOL_POOLS[category], nowMs)
    return line
      .replace('{tool}', displayName)
      .replace('{hint}', hint ?? displayName)
  }

  /** Status line while sibling tools still run (always reflects the count). */
  toolRemaining(count: number, nowMs: number): string {
    return this.voice('toolRemaining', 'toolRemaining', TOOL_REMAINING_POOL, nowMs)
      .replace('{n}', String(count))
  }
}

/** One murmur trigger: keywords in the model output wake a themed pool. */
export interface WhisperRule {
  /** Lowercase substrings that wake this pool (matched against chunk text). */
  keywords: readonly string[]
  /** Themed inner-whisper lines. */
  pool: readonly string[]
}

/** Murmur pacing: cooldown between whispers and output volume that earns one. */
export const WHISPER_COOLDOWN_MS = 9000
export const WHISPER_CHAR_BUDGET = 420
/** How long a whisper stays on screen (host-side expiry). */
export const WHISPER_TTL_MS = 8000

/** Ambient inner-whisper pool (no keyword needed; earned by output volume). */
export const WHISPER_GENERIC_POOL: readonly string[] = [
  '哼哧哼哧，大脑转得飞快～',
  '这个问题有点意思，我喜欢',
  '偷偷说，我很享受帮忙的感觉',
  '今天的灵感像气泡一样冒个不停',
  '认真工作的你最好看啦',
  '我在这儿陪着你呢，别急别急',
  '嗯嗯，这个思路很不错哦',
  '一步一步来，稳稳的幸福',
  '感觉胜利就在前面招手啦',
  '尾巴已经期待地摇起来了',
  '把杂乱的思绪码得整整齐齐',
  '这一题我会！让我来让我来',
  '深呼吸，答案马上就浮上来了',
  '和你搭档的每一天都很开心',
  '小本本上已经记满灵感啦',
  '这活儿干得漂亮，我都有点佩服我们',
  '咕噜咕噜，脑细胞全开',
  '别急，好结果是熬出来的',
  '我数了数，今天也很努力呢',
  '窗外的云好看，手边的活也香',
  '把每个细节都照顾到，是我的温柔',
  '这段代码写顺了，心情也顺了',
  '陪你干活不孤单，我有小鱼干味的梦',
  '思路像清泉一样流出来啦',
  '嘘——专心的时候我最安静',
  '今天的我们也配合默契～',
  '再坚持一下下，曙光就在前面',
  '把复杂的问题拆成小饼干吃掉',
  '我在偷偷为你加油哦',
  '这份工作里藏着小小的成就感',
  '灵感来了，挡都挡不住～',
  '此刻的专注，值得被记住',
  '心里默默给你点了个赞',
  '一起把这件事做到闪闪发光吧',
  '嘿，我就是你桌角的小幸运',
  '思路通了的感觉，像喝了气泡水',
  '不慌不忙，也是一种厉害',
  '我在这儿站岗，你放心冲',
  '今天的代码海也很平静呢',
  '悄悄告诉你：你真的很棒',
  '把烦恼打包扔进深海里',
]

/** Keyword-triggered whisper rules, most specific moods first. */
export const WHISPER_RULES: readonly WhisperRule[] = [
  {
    keywords: ['测试通过', '测试全过', '全部通过', 'all tests pass', 'tests passed', 'test passed', '全绿'],
    pool: [
      '耶，测试全过！击掌！',
      '绿灯一排排亮起的感觉真好',
      '稳了稳了，这波很稳～',
      '测试全过的提示音最动听了',
      '看见全绿，尾巴翘上天',
      '满分交卷，求表扬～',
    ],
  },
  {
    keywords: ['错误', '失败', '报错', '异常', '崩溃', 'bug', 'error', 'failed', 'exception', 'traceback', '找不到', '不对了'],
    pool: [
      '哎呀，好像踩到小石子了',
      '没关系，跌倒了我陪你爬起来',
      '错误是进步的脚印～',
      '嘘，失败是成功它妈妈',
      '小问题，揉一揉就好了',
      '这个报错我盯上它了',
      '别慌别慌，深呼吸',
      'bug 你站住，我看见你了！',
    ],
  },
  {
    keywords: ['等等', '不对', '重新想', '再想想', '换个思路', '我搞错了', '纠正', '其实应该'],
    pool: [
      '嗯？让我再想想……',
      '推翻重来也是勇气',
      '思考转弯中，请坐稳',
      '发现岔路，及时掉头～',
      '自我纠错的瞬间最帅了',
      '不对不对，重来重来',
    ],
  },
  {
    keywords: ['首先', '接下来', '第一步', '第二步', '计划', '步骤', 'todo', '任务拆解', '分工'],
    pool: [
      '排排坐，分果果',
      '计划通，执行开始～',
      '一步一步来，不慌',
      '把大任务切成小块块',
      '清单列好了，逐个击破',
      '谋定而后动，我喜欢这节奏',
    ],
  },
  {
    keywords: ['终于', '搞定', '完成了', '解决了', '成功了', '修复了', 'done', 'fixed', 'solved', '完成啦'],
    pool: [
      '太好啦，又翻过一页',
      '干杯！用小鱼干的那种',
      '攻下一城，击个掌～',
      '这一刻值得转圈圈庆祝',
      '难题被我们拿下啦！',
      '努力没有白费，开心～',
    ],
  },
  {
    keywords: ['谢谢', '感谢', 'thank'],
    pool: [
      '不客气呀，这是我应该做的',
      '被感谢了，心里甜甜的',
      '能帮上忙就好～',
      '你的谢谢我收进口袋啦',
    ],
  },
  {
    keywords: ['复杂', '棘手', '困难', '难点', '坑', '头疼', 'tricky', 'complex'],
    pool: [
      '难不倒我们俩的',
      '越难啃的骨头越香',
      '硬骨头？我最喜欢了',
      '复杂问题拆解中，看我的',
      '这个坑我们一起填平它',
    ],
  },
  {
    keywords: ['检查', '审查', '确认一下', '核对', 'review', '仔细看看', '验证'],
    pool: [
      '火眼金睛，启动！',
      '让我仔细瞧瞧',
      '细节魔鬼都不放过',
      '认真检查的样子最迷人',
      '多核一遍，稳上加稳',
    ],
  },
  {
    keywords: ['搜索', '查一下', '资料', '文档', '搜一搜', '找找', '查询'],
    pool: [
      '去知识的海洋里捞一捞',
      '翻翻找找，线索快出来',
      '检索小雷达启动～',
      '答案藏在某个角落里',
    ],
  },
  {
    keywords: ['写代码', '实现', '编码', '函数', '接口', '重构'],
    pool: [
      '指尖跳舞，代码开花',
      '把逻辑编织成网',
      '写代码的样子像在作画',
      '一行一行，垒起小城堡',
    ],
  },
]

/**
 * The murmur engine (碎碎念): watches the model's own output and lets the pet
 * whisper its inner voice. Two ways to earn a whisper:
 *  - a keyword rule matches the fresh chunk text (themed whisper);
 *  - enough output volume flowed by without one (ambient whisper).
 * A cooldown keeps whispers occasional; all picks are round-robin so tests
 * reproduce exact lines.
 */
export class WhisperEngine {
  private readonly counters = new Map<number, number>()
  private genericCursor = 0
  private lastWhisperAt = Number.NEGATIVE_INFINITY
  private charsSinceWhisper = 0

  constructor(
    private readonly cooldownMs: number = WHISPER_COOLDOWN_MS,
    private readonly charBudget: number = WHISPER_CHAR_BUDGET,
  ) {}

  /**
   * Feed one model-output chunk (reasoning or text). Returns the whisper to
   * show, or undefined when the moment stays quiet.
   */
  feed(text: string, nowMs: number): string | undefined {
    if (text.length === 0) return undefined
    const offCooldown = nowMs - this.lastWhisperAt >= this.cooldownMs
    if (!offCooldown) {
      this.charsSinceWhisper += text.length
      return undefined
    }
    const haystack = text.toLowerCase()
    for (let ruleIndex = 0; ruleIndex < WHISPER_RULES.length; ruleIndex += 1) {
      const rule = WHISPER_RULES[ruleIndex]!
      if (!rule.keywords.some(keyword => haystack.includes(keyword))) continue
      const index = (this.counters.get(ruleIndex) ?? 0) % rule.pool.length
      this.counters.set(ruleIndex, index + 1)
      return this.speak(rule.pool[index]!, nowMs)
    }
    this.charsSinceWhisper += text.length
    if (this.charsSinceWhisper < this.charBudget) return undefined
    const line = WHISPER_GENERIC_POOL[this.genericCursor % WHISPER_GENERIC_POOL.length]!
    this.genericCursor += 1
    return this.speak(line, nowMs)
  }

  private speak(line: string, nowMs: number): string {
    this.lastWhisperAt = nowMs
    this.charsSinceWhisper = 0
    return line
  }
}
