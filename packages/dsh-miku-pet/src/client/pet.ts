// 宠物页面：单个宠物实例（PetCard）+ 多开容器（PetMulti）。
// 工厂形态与 settings.ts 一致：client 半侧不能顶层 import react，
// react 能力由 DSH 运行时注入（rt），组件在工厂内制造。
// 动作配置在本模块持有：PetMulti 加载后赋值，PetCard 只读（单一事实来源 = config.jsonc）。
import { pick, rollKind, pickCategoryAction } from './pickers';
import { planMove } from './motion';
import { assertClientConfig, EMPTY_CONF, applyUserOverrides, stripJsonc, type UserOverrides } from './config';
import { CANVAS_H, FEET_Y, HIT_BOX, DRAG_THRESHOLD } from './constants';
import { petBridge } from './settings';
import type { ClientConfig, Corner, Pet } from './types';
import type * as ReactNS from 'react';
import type { Dispatch, ReactNode, SetStateAction, useEffect, useRef } from 'react';
import type { jsx } from 'react/jsx-runtime';

/** 运行时配置（PetMulti 加载后赋值；PetCard 只读） */
let config: ClientConfig = EMPTY_CONF;

/** 内联 CSS —— 注入一次（官方插件标准做法） */
const css = [
  '.miku-pet-root{position:fixed;z-index:40;pointer-events:none;user-select:none}',
  '.miku-pet-root[data-corner="bottom-right"]{right:var(--miku-pet-mx,24px);bottom:var(--miku-pet-my,0)}',
  '.miku-pet-root[data-corner="bottom-left"]{left:var(--miku-pet-mx,24px);bottom:var(--miku-pet-my,0)}',
  '.miku-pet-root[data-corner="top-right"]{right:var(--miku-pet-mx,24px);top:var(--miku-pet-my,0)}',
  '.miku-pet-root[data-corner="top-left"]{left:var(--miku-pet-mx,24px);top:var(--miku-pet-my,0)}',
  '.miku-pet-stage{position:relative;width:var(--miku-pet-size,240px);height:var(--miku-pet-size,240px);pointer-events:none}',
  '.miku-pet-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;opacity:0;transition:opacity .18s ease;transform-origin:center}',
  '.miku-pet-video.is-front{opacity:1}',
  '.miku-pet-hit{position:absolute;pointer-events:auto;cursor:default;z-index:1}',
  '.miku-pet-hit.dragging{cursor:grabbing}',
  // 悬停菜单(宠物下方小卡片;悬停出现,可改名)
  '.miku-pet-menu{position:absolute;z-index:6;left:50%;transform:translateX(-50%);top:calc(100% + 6px);pointer-events:auto;display:flex;flex-direction:column;gap:4px;min-width:120px;max-width:200px;background:rgba(22,25,34,.94);border:1px solid rgba(255,255,255,.16);border-radius:8px;padding:6px 8px;font-size:12px;line-height:18px;color:#e9ecf4;box-shadow:0 6px 18px rgba(0,0,0,.4)}',
  '.miku-pet-menu b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.miku-pet-menu-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
  '.miku-pet-menu input{margin:0;flex:1;min-width:0;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.22);border-radius:5px;color:#e9ecf4;font-size:12px;padding:2px 6px;outline:none}',
  '.miku-pet-menu input:focus{border-color:#4c8dff}',
  '.miku-pet-menu button{appearance:none;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.1);color:#e9ecf4;border-radius:5px;font-size:12px;padding:2px 8px;cursor:pointer}',
  '.miku-pet-menu button:hover{background:rgba(255,255,255,.2)}',
  '.miku-pet-menu button.primary{background:#2f6bff;border-color:#2f6bff}',
  '.miku-pet-menu button.primary:hover{background:#3d76ff}',
  '.miku-pet-menu button:disabled{opacity:.55;cursor:default}',
  // 对话气泡(点击/随机动作按动作弹出对应台词;贴近头顶上方)
  '.miku-pet-bubble{position:absolute;z-index:5;left:50%;transform:translateX(-50%);bottom:calc(100% + 4px);max-width:180px;background:rgba(255,255,255,.96);border:1.5px solid #17a8c9;border-radius:12px 12px 12px 3px;color:#0b5c6d;font-size:12px;line-height:1.4;padding:5px 9px;pointer-events:none;box-shadow:0 2px 10px rgba(23,168,201,.3);animation:miku-bubble-in .18s ease-out;text-align:center;white-space:normal}',
  '@keyframes miku-bubble-in{from{transform:translateX(-50%) scale(.6);opacity:0}to{transform:translateX(-50%) scale(1);opacity:1}}',
  // 左侧属性彩条(饥饿/心情/活力 0-100;悬停时与菜单一起显示)
  '.miku-pet-stats{position:absolute;z-index:4;right:calc(100% + 6px);top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:3px;pointer-events:none;background:rgba(22,25,34,.55);border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:5px 6px;min-width:88px}',
  '.miku-pet-stat{display:flex;align-items:center;gap:4px;font-size:10px;line-height:12px;color:#dfe3ec;white-space:nowrap}',
  '.miku-pet-stat-label{text-align:left;color:#cdd3e0}',
  '.miku-pet-stat-track{flex:1;height:5px;min-width:34px;background:rgba(255,255,255,.16);border-radius:3px;overflow:hidden}',
  '.miku-pet-stat-fill{display:block;height:100%;border-radius:3px;transition:width .25s ease}',
  '.miku-pet-stat-num{width:22px;text-align:right;color:#8b93a5;font-variant-numeric:tabular-nums}',
  // 商店物品卡片(整体放大:面板/图/文字/按钮)
  '.miku-pet-shop-row{display:flex;gap:10px;align-items:center;min-width:0}',
  '.miku-pet-shop-img{width:58px;height:58px;object-fit:contain;border-radius:8px;background:rgba(0,0,0,.06);flex:none}',
  '.miku-pet-shop-info{flex:1;min-width:0;font-size:15px;line-height:21px;color:#e9ecf4}',
  '.miku-pet-shop-info b{display:block;font-size:13px;color:#b45309;font-weight:600}',
  '.miku-pet-shop-panel .miku-pet-menu-row b{font-size:17px}',
  '.miku-pet-shop-panel button{font-size:14px;padding:5px 14px}',
  // 商店独立窗口(网页中央模态)
  '.miku-pet-shop-overlay{position:fixed;inset:0;z-index:60;background:rgba(8,10,16,.55);display:flex;align-items:center;justify-content:center;pointer-events:auto}',
  '.miku-pet-shop-panel{pointer-events:auto;background:rgba(22,25,34,.98);border:1px solid rgba(255,255,255,.16);border-radius:16px;padding:22px 26px;min-width:380px;max-width:500px;display:flex;flex-direction:column;gap:12px;box-shadow:0 18px 50px rgba(0,0,0,.5);animation:miku-shop-in .16s ease-out}',
  '@keyframes miku-shop-in{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}',
  // 明亮主题适配:面板白底黑字。
  // 前缀 html body .miku-pet-root[data-miku-lit][data-miku-root] 特异性 (0,4,2)+,
  // 且各面板自身带 [data-miku-lit]((0,5,2)+),稳压皮肤 patches 的
  // html[data-dsh-skin] body[data-ds-dark-theme] [class*=menu](0,3,2) !important 深蓝渐变;
  // 同时写 background + background-color 双属性。
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit]{background:#fff!important;background-color:#fff!important;background-image:none!important;border:1px solid rgba(0,0,0,.14)!important;border-color:rgba(0,0,0,.14)!important;color:#1f2329!important;box-shadow:0 6px 18px rgba(0,0,0,.18)}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] .miku-pet-menu-row{background:transparent!important;background-color:transparent!important;background-image:none!important;color:#1f2329!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-shop-panel[data-miku-lit] .miku-pet-menu-row{background:transparent!important;background-color:transparent!important;background-image:none!important;color:#1f2329!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] .miku-pet-menu-row b{color:#1f2329!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] input{background:#fff!important;background-color:#fff!important;border:1px solid rgba(0,0,0,.2)!important;color:#1f2329!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] button{background:rgba(0,0,0,.05)!important;background-color:rgba(0,0,0,.05)!important;border:1px solid rgba(0,0,0,.16)!important;color:#1f2329!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] button:hover{background:rgba(0,0,0,.1)!important;background-color:rgba(0,0,0,.1)!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] button.primary{background:rgba(0,0,0,.12)!important;background-color:rgba(0,0,0,.12)!important;border-color:rgba(0,0,0,.2)!important;color:#1f2329!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] button.primary:hover{background:rgba(0,0,0,.18)!important;background-color:rgba(0,0,0,.18)!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] button:disabled{opacity:.55!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-shop-panel[data-miku-lit] button{background:rgba(0,0,0,.05)!important;background-color:rgba(0,0,0,.05)!important;border:1px solid rgba(0,0,0,.16)!important;color:#1f2329!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-shop-panel[data-miku-lit] button:hover{background:rgba(0,0,0,.1)!important;background-color:rgba(0,0,0,.1)!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-shop-panel[data-miku-lit] button.primary{background:rgba(0,0,0,.12)!important;background-color:rgba(0,0,0,.12)!important;border-color:rgba(0,0,0,.2)!important;color:#1f2329!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-shop-panel[data-miku-lit] button.primary:hover{background:rgba(0,0,0,.18)!important;background-color:rgba(0,0,0,.18)!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-stats[data-miku-lit]{background:rgba(255,255,255,.92)!important;background-color:rgba(255,255,255,.92)!important;border:1px solid rgba(0,0,0,.12)!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-stats[data-miku-lit] .miku-pet-stat{color:#2a2f38!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-stats[data-miku-lit] .miku-pet-stat-label{color:#4a5261!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-stats[data-miku-lit] .miku-pet-stat-track{background:rgba(0,0,0,.1)!important;background-color:rgba(0,0,0,.1)!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-stats[data-miku-lit] .miku-pet-stat-num{color:#6b7280!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-shop-overlay{background:rgba(8,10,16,.55)!important;background-color:rgba(8,10,16,.55)!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-shop-panel[data-miku-lit]{background:#fff!important;background-color:#fff!important;background-image:none!important;border:1px solid rgba(0,0,0,.14)!important;border-color:rgba(0,0,0,.14)!important;color:#1f2329!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-shop-panel[data-miku-lit] .miku-pet-shop-info{color:#2a2f38!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-shop-panel[data-miku-lit] .miku-pet-shop-info b{color:#b45309!important}',
  'html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-shop-panel[data-miku-lit] .miku-pet-shop-img{background:rgba(0,0,0,.06)!important;background-color:rgba(0,0,0,.06)!important}',
  '@media (prefers-reduced-motion: reduce){.miku-pet-video{transition:none}}',
].join('\n');
const cssTag = 'miku-pet/style.css';
function injectCss(): void {
  if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + cssTag + '"]') === null) {
    const tag = document.createElement('style');
    tag.dataset.plugin = 'miku-pet';
    tag.dataset.pluginCss = cssTag;
    tag.textContent = css;
    document.head.appendChild(tag);
  }
}

/** 随机待机规则（与桌面版 desktop-pet 一致）：待机时每 ROLL_INTERVAL_MS 判定一次，
 * 演动作概率 = animationWeights 的 action 档占比（config 默认 idle 40 / categories 60 → 60%）；
 * 连续 MAX_MISS 次未抽中 → 下次 100% 必演；演出成功或离开待机时计数清零。 */
const ROLL_INTERVAL_MS = 5_000;
const MAX_MISS = 2;
/** 帧/清单缓存破坏:每次页面加载一个时间戳 → 刷新页面必拿最新素材(宿主对 thumb 是 max-age=3600) */
const FRAME_V = Date.now();

// 左侧属性彩条定义(饥饿/心情/活力,0-100;颜色区分;悬停才显示)
const STAT_DEFS = [
  { key: 'hunger', label: '饥饿值', color: '#ff9f43' },
  { key: 'mood', label: '心情值', color: '#ff6b81' },
  { key: 'energy', label: '活力值', color: '#2ed573' },
] as const;
type StatKey = (typeof STAT_DEFS)[number]['key'];

// 商店物品(金币 → 恢复饥饿;金额按比例定,可改)
const SHOP_ITEMS = [
  { id: 'food1', img: '/miku-pet/thumb/shop/miku-pet-shop1.png', price: 5, hunger: 40, label: '香浓可口的超级无敌黄油面包' },
  { id: 'food2', img: '/miku-pet/thumb/shop/miku-pet-shop2.png', price: 10, hunger: 80, label: '闪闪发亮新鲜出炉的红豆沙包' },
];

/** 属性值夹取:低于 0 → 0,高于 100 → 100 */
const clampStat = (v: number) => Math.min(100, Math.max(0, Math.round(v)));

/**
 * 制造宠物页面组件（工厂，与 makePetConfigSection 同理：react 由运行时注入）。
 * @param rt 运行时注入的 react 能力（h=jsx / useState / useEffect / useRef）
 * @returns PetMulti 多开容器组件（内部渲染多个 PetCard）
 */
export function makePetUI(rt: {
  h: typeof jsx;
  useState: <T>(init: T) => [T, Dispatch<SetStateAction<T>>];
  useEffect: typeof useEffect;
  useRef: typeof useRef;
}): () => ReactNode {
  const { h, useState, useEffect, useRef } = rt;
  injectCss();

  /** 单个宠物实例（配置由容器 PetMulti 传入） */
  function PetCard({ cfg }: { cfg: Pet }) {
    // ---- 尺寸（由配置传入；容器/设置页更新后即时跟随）----
    const [size, setSize] = useState(cfg.size);
    const halfW = size / 2;
    const halfH = size / 2;

    // ---- React 状态 ----
    const [anim, setAnim] = useState(config.animations.idle[0] ?? '');
    // 初始待机 = idle 循环(once=false 循环播放;随机演出由 5s 掷骰驱动)
    const [once, setOnce] = useState(false);
    const [facing, setFacing] = useState('left' as 'left' | 'right');
    const [dragging, setDragging] = useState(false);
    const [customPos, setCustomPos] = useState<null | { rx: number; ry: number }>(null);
    // 初始角落与边距（来自配置；可被容器更新覆盖）
    const [corner, setCorner] = useState<Corner>(cfg.position.corner);
    const [margin, setMargin] = useState({ x: cfg.position.marginX, y: cfg.position.marginY });

    // 配置变化即时跟随（容器重新合并 / 设置页保存后通过 petBridge.sync 触发）
    useEffect(() => {
      setSize(cfg.size);
      setCorner(cfg.position.corner);
      setMargin({ x: cfg.position.marginX, y: cfg.position.marginY });
    }, [cfg.size, cfg.position.corner, cfg.position.marginX, cfg.position.marginY]);
    const [seq, setSeq] = useState(0);

    // ---- 左侧属性彩条(饥饿/心情/活力 0-100,存 localStorage)----
    const STATS_KEY = 'miku-pet:stats';
    const [stats, setStats] = useState<Record<StatKey, number>>(() => {
      const clamp = (v: unknown) =>
        typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 100;
      try {
        const raw = JSON.parse(window.localStorage.getItem(STATS_KEY) ?? '{"hunger":100,"mood":100,"energy":100}');
        return { hunger: clamp(raw?.hunger), mood: clamp(raw?.mood), energy: clamp(raw?.energy) };
      } catch {
        return { hunger: 100, mood: 100, energy: 100 };
      }
    });
    useEffect(() => {
      try {
        window.localStorage.setItem(STATS_KEY, JSON.stringify(stats));
      } catch {
        /* 忽略 */
      }
    }, [stats]);

    // ---- 饥饿值衰减:每 60s 掉点(平时 -1;工作状态 -5),下限 0 ----
    const HUNGER_DECAY_MS = 60_000;
    const HUNGER_DECAY_NORMAL = 1;
    const HUNGER_DECAY_WORKING = 5;
    useEffect(() => {
      const timer = window.setInterval(() => {
        setStats((prev) => {
          const decay = workingRef.current ? HUNGER_DECAY_WORKING : HUNGER_DECAY_NORMAL;
          if (prev.hunger <= 0) return prev;
          return { ...prev, hunger: Math.max(0, prev.hunger - decay) };
        });
      }, HUNGER_DECAY_MS);
      return () => window.clearInterval(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- 悬停菜单 / 改名（名字存 localStorage，key 按宠物 id；零宿主依赖，改完即生效）----
    const nameKey = 'miku-pet:name:' + cfg.id;
    const [petName, setPetName] = useState(() => {
      try {
        return window.localStorage.getItem(nameKey) ?? cfg.name ?? '';
      } catch {
        return cfg.name ?? '';
      }
    });
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuView, setMenuView] = useState<'root' | 'rename' | 'wallet'>('root');
    // 商店为网页中央的独立窗口(模态),不进小菜单二级
    const [shopOpen, setShopOpen] = useState(false);
    const menuOpenRef = useRef(false);
    const [nameDraft, setNameDraft] = useState('');
    const menuTimerRef = useRef<number | null>(null);
    useEffect(() => {
      try {
        const saved = window.localStorage.getItem(nameKey);
        setPetName(saved ?? cfg.name ?? '');
      } catch {
        setPetName(cfg.name ?? '');
      }
    }, [nameKey, cfg.name]);

    // ---- 对话气泡:按动作名弹对应台词 ----
    const [bubble, setBubble] = useState('');
    const bubbleTimerRef = useRef<number | null>(null);
    const showBubble = (action: string) => {
      const pool = config.phrases?.[action];
      if (!pool || !pool.length) return;
      const text = pool[Math.floor(Math.random() * pool.length)];
      setBubble(text);
      if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
      bubbleTimerRef.current = window.setTimeout(() => setBubble(''), 2600);
    };

    // ---- 钱包(工作玩法):金币存 localStorage,余额下限 0;工作=循环判定(未被打断不停止) ----
    const COINS_KEY = 'miku-pet:coins';
    const WORK_DURATION_MS = 10_000; // 每轮工作 10s 判定一次,判定后继续下一轮
    const coinsRef = useRef(0);
    const [coins, setCoins] = useState(() => {
      try {
        const v = Number(window.localStorage.getItem(COINS_KEY));
        return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
      } catch {
        return 0;
      }
    });
    coinsRef.current = coins;
    const [working, setWorking] = useState(false);
    const workingRef = useRef(false);
    const workTimerRef = useRef<number | null>(null);
    const workPlay = (next: string, once: boolean) => {
      setAnim(next);
      setOnce(once);
      setSeq((s) => s + 1);
    };
    // 一轮:工作中循环 10s → 判定成败(+3/-1) → 播成败动画 → 继续下一轮(除非被打断)
    const workCycle = () => {
      if (!workingRef.current) return;
      workPlay(config.animations.work?.[0] ?? 'work', false);
      if (workTimerRef.current !== null) window.clearTimeout(workTimerRef.current);
      workTimerRef.current = window.setTimeout(() => {
        if (!workingRef.current) return; // 已打断,本轮不作判定
        const ok = Math.random() < 0.5;
        const result = ok ? 'success' : 'fail';
        workPlay(config.animations[result as 'success']?.[0] ?? result, true);
        const nextCoins = Math.max(0, coinsRef.current + (ok ? 3 : -1));
        coinsRef.current = nextCoins;
        setCoins(nextCoins);
        try {
          window.localStorage.setItem(COINS_KEY, String(nextCoins));
        } catch {
          /* 忽略 */
        }
        showBubble(result);
        if (workTimerRef.current !== null) window.clearTimeout(workTimerRef.current);
        workTimerRef.current = window.setTimeout(() => {
          workCycle(); // 判定后不停止,继续下一轮
        }, ok ? 1300 : 1900);
      }, WORK_DURATION_MS);
    };
    const doWork = () => {
      if (workingRef.current || dragRef.current.active) return; // 已在工作/拖拽中才挡
      workingRef.current = true;
      setWorking(true);
      closeMenuNow();
      workCycle();
    };
    const stopWork = () => {
      // 打断:立即停止循环(本轮回合不作判定),回待机;之后的点击/拖拽照常处理
      if (!workingRef.current) return;
      workingRef.current = false;
      setWorking(false);
      if (workTimerRef.current !== null) window.clearTimeout(workTimerRef.current);
      backToIdle();
    };
    // 商店购买:金币不足拒绝;成功扣金币并恢复饥饿(0-100 夹取)
    const buyItem = (item: { price: number; hunger: number }) => {
      if (coinsRef.current < item.price) {
        showBubble('金币不足…');
        return;
      }
      const next = coinsRef.current - item.price;
      coinsRef.current = next;
      setCoins(next);
      try {
        window.localStorage.setItem(COINS_KEY, String(next));
      } catch {
        /* 忽略 */
      }
      setStats((s) => ({ ...s, hunger: clampStat(s.hunger + item.hunger) }));
      showBubble(item.hunger >= 80 ? '大份下肚,精神满满~' : '吃饱饱啦~');
    };
    const openMenu = () => {
      if (dragRef.current.active || justDraggedRef.current) return;
      if (menuTimerRef.current !== null) window.clearTimeout(menuTimerRef.current);
      if (!menuOpenRef.current) setMenuView('root'); // 仅"重新打开"时回到一级;已打开的悬停不下钻状态
      menuOpenRef.current = true;
      setMenuOpen(true);
    };
    const closeMenuNow = () => {
      menuOpenRef.current = false;
      setMenuView('root');
      setMenuOpen(false);
    };
    const closeMenu = () => {
      if (menuView === 'rename') return; // 改名输入中不自动收起（避免打字时被指针离开误关）
      if (menuTimerRef.current !== null) window.clearTimeout(menuTimerRef.current);
      menuTimerRef.current = window.setTimeout(() => {
        closeMenuNow();
      }, 260);
    };
    const startRename = () => {
      setNameDraft(petName);
      setMenuView('rename');
    };
    const saveName = () => {
      const v = (nameDraft || '').trim().slice(0, 32);
      if (v) {
        try {
          window.localStorage.setItem(nameKey, v);
        } catch {
          /* 隐私模式等忽略 */
        }
        setPetName(v);
      }
      closeMenuNow();
    };

    // ---- DOM / 状态 refs ----
    const rootRef = useRef<HTMLDivElement | null>(null);
    const stageRef = useRef<HTMLDivElement | null>(null);
    // 帧序列播放:单 <img> + 定时器(替换原双 <video> webm 播放)
    const imgRef = useRef<HTMLImageElement | null>(null);
    const frameListRef = useRef<{ name: string; ms: number }[]>([]);
    const frameIdxRef = useRef(0);
    const frameTimerRef = useRef<number | null>(null);
    const onceRef = useRef(true);
    const curActionRef = useRef('');
    const genRef = useRef(0);
    const dragRef = useRef({ active: false, dragging: false, sx: 0, sy: 0, offX: 0, offY: 0 });
    const justDraggedRef = useRef(false);
    const idleMissRef = useRef(0); // 连续未抽中计数(连漏 MAX_MISS 次 → 下次必演)
    const animRef = useRef(anim);
    animRef.current = anim;

    /** 帧推进:按帧时长定时切换 img.src;一次性动作播完触发 handleEnded。 */
    const playFrame = (gen: number) => {
      const list = frameListRef.current;
      if (!list.length) return;
      if (frameIdxRef.current >= list.length) {
        if (onceRef.current) {
          handleEnded();
          return;
        }
        frameIdxRef.current = 0;
      }
      const f = list[frameIdxRef.current];
      frameIdxRef.current += 1;
      const img = imgRef.current;
      if (img) img.src = '/miku-pet/thumb/' + encodeURIComponent(curActionRef.current) + '/' + encodeURIComponent(f.name) + '?v=' + FRAME_V;
      if (frameTimerRef.current !== null) window.clearTimeout(frameTimerRef.current);
      frameTimerRef.current = window.setTimeout(() => playFrame(gen), f.ms);
    };

    const switchTo = (next: string, nextOnce: boolean) => {
      if (!next) return;
      const gen = ++genRef.current;
      curActionRef.current = next;
      onceRef.current = nextOnce;
      if (frameTimerRef.current !== null) window.clearTimeout(frameTimerRef.current);
      frameTimerRef.current = null;
      void fetch('/miku-pet/frames/' + encodeURIComponent(next) + '?v=' + FRAME_V)
        .then((r) => (r.ok ? r.json() : { frames: [] }))
        .then((data) => {
          if (gen !== genRef.current) return; // 过期请求丢弃
          frameListRef.current = (data.frames || []) as { name: string; ms: number }[];
          frameIdxRef.current = 0;
          playFrame(gen);
        })
        .catch(() => {});
    };

    // ---- 状态驱动播放 ----
    useEffect(() => {
      switchTo(anim, once);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [anim, once, seq]);
    useEffect(() => () => {
      stopMove();
      if (menuTimerRef.current !== null) window.clearTimeout(menuTimerRef.current);
      if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
      if (workTimerRef.current !== null) window.clearTimeout(workTimerRef.current);
    }, []);
    useEffect(() => {
      const onResize = () => setCustomPos((prev) => (prev ? { ...prev } : prev));
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }, []);

    // ---- 待机收尾：一切非待机动作播完都回到 idle 循环（随机演出交给 5s 掷骰）----
    const backToIdle = () => {
      idleMissRef.current = 0; // 演出成功/被打断 → 计数清零（桌面版一致）
      if (config.animations.idle.length) {
        setAnim(pick(config.animations.idle, animRef.current));
        setOnce(false);
        setSeq((s) => s + 1);
      }
    };

    const handleEnded = () => {
      const { animations } = config;
      if (dragRef.current.active) return;
      if (animations.turn.includes(animRef.current)) {
        const next = facing === 'left' ? 'right' : 'left';
        setFacing(next);
        facingRef.current = next; // 立即同步：翻转后的随机演出用新朝向过滤 noMirror（右侧不选文字类）
        backToIdle();
        return;
      }
      backToIdle(); // drag / clicks / 分类动作（挠头/眨眼/吃饭）播完一律回 idle 循环
    };

    // ---- 移动系统 ----
    const moveRef = useRef<number | null>(null);
    const moveTokenRef = useRef(0);
    const pendingMoveRef = useRef<null | {
      startRatio: number;
      startYRatio: number;
      targetRatio: number;
      dir: number;
      totalRatio: number;
      leadSec: number;
      tailSec: number;
    }>(null);
    const customPosRef = useRef(customPos);
    customPosRef.current = customPos;

    const currentCenterX = () => {
      const cp = customPosRef.current;
      if (cp) return cp.rx * window.innerWidth;
      const rootEl = rootRef.current;
      if (rootEl) return rootEl.getBoundingClientRect().left + halfW;
      return window.innerWidth - 24 - halfW;
    };
    const currentCenterY = () => {
      const cp = customPosRef.current;
      if (cp) return cp.ry * window.innerHeight;
      const rootEl = rootRef.current;
      if (rootEl) return rootEl.getBoundingClientRect().top + halfH;
      return window.innerHeight - 20 - halfH;
    };

    const startMoveDrive = (el: HTMLVideoElement) => {
      const pm = pendingMoveRef.current;
      if (!pm || moveRef.current !== null) return;
      pendingMoveRef.current = null;
      const { startRatio, startYRatio, targetRatio, dir, totalRatio, leadSec, tailSec } = pm;
      const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 10.09;
      const travelWindow = Math.max(0.1, duration - leadSec - tailSec);
      const token = ++moveTokenRef.current;
      const step = () => {
        if (moveTokenRef.current !== token) return;
        const t = el.currentTime || 0;
        const rootEl = rootRef.current;
        if (rootEl) {
          const W = window.innerWidth;
          const H = window.innerHeight;
          let ratioX;
          if (t <= leadSec) ratioX = startRatio;
          else if (t >= duration - tailSec) ratioX = targetRatio;
          else ratioX = startRatio + dir * totalRatio * ((t - leadSec) / travelWindow);
          const px = ratioX * W;
          const py = startYRatio * H;
          rootEl.style.left = px - halfW + 'px';
          rootEl.style.top = py - halfH + 'px';
          rootEl.style.right = 'auto';
          rootEl.style.bottom = 'auto';
        }
        if (t < duration - tailSec) moveRef.current = requestAnimationFrame(step);
        else {
          moveRef.current = null;
          setCustomPos({ rx: targetRatio, ry: startYRatio });
        }
      };
      moveRef.current = requestAnimationFrame(step);
    };

    const tryMove = () => {
      if (moveRef.current !== null || pendingMoveRef.current) return true;
      const moves = config.animations.moves;
      const actions = moves.actions;
      if (!actions.length) return false;
      const chosen = actions[Math.floor(Math.random() * actions.length)];
      const mp = Object.assign({}, moves.default, chosen.params || {});
      const dir = (facingRef.current === 'right') !== config.animations.turn.includes(animRef.current) ? 1 : -1;
      const W = window.innerWidth;
      const plan = planMove({
        cx: currentCenterX(),
        cy: currentCenterY(),
        W,
        H: window.innerHeight,
        dir,
        minDist: mp.minDist,
        maxDist: mp.maxDist,
        margin: mp.margin,
        halfW,
      });
      if (!plan) return false;
      pendingMoveRef.current = {
        ...plan,
        dir,
        leadSec: mp.leadSec,
        tailSec: mp.tailSec,
      };
      setOnce(true);
      setAnim(chosen.name);
      return true;
    };
    const stopMove = () => {
      pendingMoveRef.current = null;
      moveTokenRef.current++;
      if (moveRef.current !== null) {
        cancelAnimationFrame(moveRef.current);
        moveRef.current = null;
      }
    };

    const facingRef = useRef<'left' | 'right'>(facing);
    facingRef.current = facing;
    // 最新的 tryMove（5s 掷骰用；避免 interval 闭包捕获首帧渲染的旧 halfW/尺寸）
    const tryMoveRef = useRef(tryMove);
    tryMoveRef.current = tryMove;

    // ---- 随机待机表演：每 5s 判定一次（与桌面版 pet2d.js 一致）----
    // idle 循环播放；掷骰概率取 animationWeights（idle 40 / categories 60 → 60% 演）；
    // 连漏 MAX_MISS 次 → 下次必演；非待机（拖拽/移动/演出中）跳过且不记失败。
    useEffect(() => {
      const timer = window.setInterval(() => {
        const { animations, animationWeights } = config;
        if (dragRef.current.active || moveRef.current !== null || pendingMoveRef.current) return;
        const cur = animRef.current;
        if (!cur || !animations.idle.includes(cur)) return; // 仅待机（idle 循环）时判定
        const force = idleMissRef.current >= MAX_MISS;
        const roll = Math.random();
        const k = rollKind(roll, animationWeights);
        if (!force && k === 'idle') {
          idleMissRef.current += 1; // 未抽中 → 连漏计数
          return;
        }
        idleMissRef.current = 0;
        let kind: string;
        let next: string;
        if (k === 'turn' && animations.turn.length) {
          kind = 'TURN';
          next = pick(animations.turn, cur);
        } else if (k === 'move' && tryMoveRef.current()) {
          return; // 移动已接管播放（收尾回 idle 由 handleEnded 负责）
        } else {
          const act = pickCategoryAction(animations.categories, animations.idle, facingRef.current, cur);
          kind = act.id;
          next = act.name;
        }
        console.log(
          '[miku-pet] ' +
            new Date().toTimeString().slice(0, 8) +
            ' pet=' +
            cfg.id +
            ' facing=' +
            facingRef.current +
            ' roll=' +
            roll.toFixed(4) +
            ' -> [' +
            kind +
            '] ' +
            next,
        );
        setAnim(next);
        setOnce(true);
        setSeq((s) => s + 1);
        showBubble(next); // 随机动作 → 按动作弹对应气泡（无词库的动作自动忽略）
      }, ROLL_INTERVAL_MS);
      return () => window.clearInterval(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- 点击 vs 拖拽 ----
    const handlePointerDown = (e: ReactNS.PointerEvent<HTMLDivElement>) => {
      if (workingRef.current) stopWork(); // 点击/拖拽宠物 = 打断工作循环(之后照常处理)
      e.currentTarget.classList.add('dragging');
      stopMove();
      e.currentTarget.setPointerCapture(e.pointerId);
      const rootEl = rootRef.current;
      let offX = 0;
      let offY = 0;
      if (rootEl) {
        const rr = rootEl.getBoundingClientRect();
        offX = e.clientX - (rr.left + rr.width / 2);
        offY = e.clientY - (rr.top + rr.height / 2);
      }
      dragRef.current = { active: true, dragging: false, sx: e.clientX, sy: e.clientY, offX, offY };
    };
    const handlePointerMove = (e: ReactNS.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d.active) return;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (!d.dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        d.dragging = true;
        setDragging(true);
        // 拖拽姿势循环播放(once=false 持续循环,与桌面版 playAction('Drag', false) 一致)
        setOnce(false);
        if (config.animations.drag.length) setAnim(pick(config.animations.drag));
      }
      const rootEl = rootRef.current;
      if (rootEl) {
        rootEl.style.left = e.clientX - d.offX - halfW + 'px';
        rootEl.style.top = e.clientY - d.offY - halfH + 'px';
        rootEl.style.right = 'auto';
        rootEl.style.bottom = 'auto';
      }
      const stageEl = stageRef.current;
      if (stageEl) stageEl.style.transform = 'none';
    };
    const handlePointerUp = (e: ReactNS.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      const wasDragging = d.dragging;
      d.active = false;
      d.dragging = false;
      e.currentTarget.classList.remove('dragging');
      if (wasDragging) {
        justDraggedRef.current = true;
        setTimeout(() => {
          justDraggedRef.current = false;
        }, 100);
        setDragging(false);
        setCustomPos({ rx: (e.clientX - d.offX) / window.innerWidth, ry: (e.clientY - d.offY) / window.innerHeight });
        const stageEl = stageRef.current;
        if (stageEl) stageEl.style.transform = 'translateY(' + bottomPad + 'px)';
        // 拖拽结束:播一次"摔倒→站起"(standup,不参与随机、不进菜单),播完回 idle 循环;
        // 无 standup 池时维持旧行为(直接回 idle 循环)。与桌面版(pet2d.js)松手流程一致。
        const standupPool = config.animations.standup;
        if (standupPool && standupPool.length) {
          console.log(
            '[miku-pet] ' + new Date().toTimeString().slice(0, 8) + ' pet=' + cfg.id + ' drag-end -> standup: ' + standupPool.join(','),
          );
          setAnim(pick(standupPool, animRef.current));
          setOnce(true);
        } else {
          console.log('[miku-pet] ' + new Date().toTimeString().slice(0, 8) + ' pet=' + cfg.id + ' drag-end -> idle (no standup pool)');
          if (config.animations.idle.length) {
            setAnim(pick(config.animations.idle, animRef.current));
            setOnce(false);
          }
        }
      }
    };
    const handleClick = () => {
      const d = dragRef.current;
      if (d.active || d.dragging || justDraggedRef.current) return;
      if (once && !config.animations.idle.includes(animRef.current)) return;
      stopMove();
      setOnce(true);
      if (config.animations.clicks.length) {
        const n = pick(config.animations.clicks);
        setAnim(n);
        showBubble(n); // 点击 → 按回应动作弹对应气泡
      }
    };

    // ---- 渲染 ----
    const bottomPad = (size * (CANVAS_H - FEET_Y)) / CANVAS_H;
    const stageStyle = dragging ? { transform: 'none' } : { transform: 'translateY(' + bottomPad + 'px)' };
    const rootStyle = customPos
      ? (() => {
          const rx = customPos.rx;
          const ry = customPos.ry;
          const left = Math.min(Math.max(rx * window.innerWidth - halfW, 0), window.innerWidth - size);
          const top = Math.min(Math.max(ry * window.innerHeight - halfH, 0), window.innerHeight - size);
          return { left: left + 'px', top: top + 'px', right: 'auto', bottom: 'auto' };
        })()
      : {};
    const hitProps = {
      className: 'miku-pet-hit',
      style: {
        left: (HIT_BOX.x0 / 640) * 100 + '%',
        top: (HIT_BOX.y0 / 360) * 100 + '%',
        width: ((HIT_BOX.x1 - HIT_BOX.x0) / 640) * 100 + '%',
        height: ((HIT_BOX.y1 - HIT_BOX.y0) / 360) * 100 + '%',
      },
      onMouseEnter: (e: ReactNS.MouseEvent<HTMLDivElement>) => {
        if (!dragRef.current.active) e.currentTarget.style.cursor = 'grab';
      },
      onMouseLeave: (e: ReactNS.MouseEvent<HTMLDivElement>) => {
        if (!dragRef.current.active) e.currentTarget.style.cursor = 'default';
      },
      // 悬停菜单：进入显示、离开 260ms 后收起（留时间把鼠标挪进菜单）
      onPointerEnter: openMenu,
      onPointerLeave: closeMenu,
      onClick: handleClick,
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerUp,
      title: 'miku-pet',
    };
    // 悬停菜单（两级：一级=按钮列表；点击「改名」「钱包」进二级，「工作」直接执行）
    const menuNode = menuOpen
      ? h('div', {
          className: 'miku-pet-menu',
          'data-miku-lit': '1',
          onPointerEnter: openMenu,
          onPointerLeave: closeMenu,
          children:
            menuView === 'rename'
              ? [
                  h('div', { className: 'miku-pet-menu-row', children: [h('input', {
                    value: nameDraft,
                    maxLength: 32,
                    onInput: (e: ReactNS.FormEvent<HTMLInputElement>) => setNameDraft(e.currentTarget.value),
                    onKeyDown: (e: ReactNS.KeyboardEvent<HTMLInputElement>) => {
                      // 中文输入法组词中(回车确认候选字)不触发保存/取消
                      const native = e.nativeEvent as KeyboardEvent;
                      if (native.isComposing || native.keyCode === 229) return;
                      if (e.key === 'Enter') void saveName();
                      if (e.key === 'Escape') {
                        closeMenuNow();
                      }
                    },
                  })] }),
                  h('div', { className: 'miku-pet-menu-row', children: [
                    h('button', { className: 'primary', onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); void saveName(); }, children: '保存' }),
                    h('button', { onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); setMenuView('root'); }, children: '取消' }),
                  ] }),
                ]
              : menuView === 'wallet'
                ? [
                    h('div', { className: 'miku-pet-menu-row', children: [h('b', { children: '金币: ' + coins })] }),
                    h('div', { className: 'miku-pet-menu-row', children: [
                      h('button', { className: 'primary', onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); setMenuView('root'); }, children: '返回' }),
                    ] }),
                  ]
                : [
                    h('div', { className: 'miku-pet-menu-row', children: [h('b', { children: petName || '未命名' })] }),
                    h('div', { className: 'miku-pet-menu-row', children: [
                      h('button', { onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); startRename(); }, children: '改名' }),
                      h('button', {
                        onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); setMenuView('wallet'); },
                        children: '钱包',
                      }),
                      h('button', {
                        onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => {
                          e.stopPropagation();
                          closeMenuNow();
                          setShopOpen(true); // 商店 = 网页中央独立窗口
                        },
                        children: '商店',
                      }),
                      h('button', {
                        className: 'primary',
                        disabled: working,
                        onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); doWork(); },
                        children: working ? '工作中…' : '工作',
                      }),
                    ] }),
                  ],
        })
      : null;
    return h('div', {
      ref: rootRef,
      className: 'miku-pet-root',
      'data-corner': corner,
      'data-facing': facing,
      // 高特异性钩子:供覆盖规则压过 GUI 皮肤 patches(html[data-dsh-skin] body[data-ds-dark-theme] [class*=menu] !important)
      'data-miku-lit': '1',
      'data-miku-root': '1',
      style: Object.assign(
        { '--miku-pet-size': size + 'px', '--miku-pet-mx': margin.x + 'px', '--miku-pet-my': margin.y + 'px' },
        rootStyle,
        // 商店打开时把整个根提到最顶层,遮罩可覆盖页面全部(含应用自身浮层)
        shopOpen ? { zIndex: 99999 } : {},
      ),
      children: [
        h('div', {
          ref: stageRef,
          className: 'miku-pet-stage',
          style: stageStyle,
          children: [
            h('img', {
              ref: imgRef,
              className: 'miku-pet-video is-front',
              style: { transform: facing === 'right' ? 'scaleX(-1)' : 'scaleX(1)' },
              alt: 'miku-pet',
            }),
            h('div', hitProps),
          ],
        }),
        // 名字不再常驻显示(悬停菜单里就能看到,见 menuNode 首行)
        null,
        // 左侧属性彩条(饥饿/心情/活力 0-100;与菜单同显隐)
        menuOpen
          ? h('div', {
              className: 'miku-pet-stats',
              'data-miku-lit': '1',
              children: STAT_DEFS.map((d) =>
                h('div', { className: 'miku-pet-stat', children: [
                  h('span', { className: 'miku-pet-stat-label', children: d.label }),
                  h('span', { className: 'miku-pet-stat-track', children: [
                    h('span', { className: 'miku-pet-stat-fill', style: { width: stats[d.key] + '%', background: d.color } }),
                  ] }),
                  h('span', { className: 'miku-pet-stat-num', children: String(stats[d.key]) }),
                ] }),
              ),
            })
          : null,
        // 对话气泡（按动作弹台词；自动隐藏）
        bubble ? h('div', { className: 'miku-pet-bubble', children: bubble }) : null,
        // 悬停菜单
        menuNode,
        // 商店独立窗口（网页中央模态；点遮罩或「关闭」收起）
        shopOpen
          ? h('div', {
              className: 'miku-pet-shop-overlay',
              onClick: () => setShopOpen(false),
              children: h('div', {
                className: 'miku-pet-shop-panel',
                'data-miku-lit': '1',
                onClick: (e: ReactNS.MouseEvent<HTMLDivElement>) => e.stopPropagation(),
                children: [
                  h('div', { className: 'miku-pet-menu-row', children: [h('b', { children: '商店 · 金币: ' + coins })] }),
                  ...SHOP_ITEMS.map((it) =>
                    h('div', { className: 'miku-pet-shop-row', children: [
                      h('img', { className: 'miku-pet-shop-img', src: it.img, alt: it.id }),
                      h('div', { className: 'miku-pet-shop-info', children: [
                        it.label,
                        h('b', { children: it.price + ' 金币 / 恢复 ' + it.hunger + ' 饥饿' }),
                      ] }),
                      h('button', {
                        className: 'primary',
                        onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); buyItem(it); },
                        children: '购买',
                      }),
                    ] }),
                  ),
                  h('div', { className: 'miku-pet-menu-row', children: [
                    h('button', { className: 'primary', onClick: (e: ReactNS.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); setShopOpen(false); }, children: '关闭' }),
                  ] }),
                ],
              }),
            })
          : null,
      ],
    });
  }

  /** 多开容器：拉取配置 → 合并默认+用户层 pets → 渲染多个 PetCard */
  function PetMulti() {
    const [pets, setPets] = useState<Pet[]>([]);
    const [ready, setReady] = useState(false);

    useEffect(() => {
      let alive = true;
      (async () => {
        try {
          const r1 = await fetch('/miku-pet/config.jsonc?v=' + Date.now());
          if (!r1.ok) throw new Error('config.jsonc HTTP ' + r1.status);
          config = assertClientConfig(JSON.parse(stripJsonc(await r1.text())));
          const defaults = config.pets;
          // 用户覆盖层（覆盖片段：pets / animations / animationWeights，缺省回落默认）
          let user: UserOverrides = {};
          try {
            const r2 = await fetch('/miku-pet/config');
            if (r2.ok && r2.status !== 204) user = await r2.json().catch(() => ({}));
          } catch {
            /* 无用户层时忽略 */
          }
          config = applyUserOverrides(config, user);
          const merged = config.pets;
          if (!alive) return;
          petBridge.current = merged;
          petBridge.template = defaults.length ? defaults[0] : undefined;
          petBridge.sync = (list: Pet[]) => {
            setPets(list);
            petBridge.current = list;
          };
          setPets(merged);
          setReady(true);
        } catch (e) {
          console.error('[miku-pet] 配置加载失败', e); // 配置缺失/损坏：显式报错，不静默隐藏
        }
      })();
      return () => {
        alive = false;
        petBridge.sync = () => {};
      };
    }, []);

    return ready ? pets.map((p) => h(PetCard, { key: p.id, cfg: p })) : null;
  }

  return PetMulti;
}
