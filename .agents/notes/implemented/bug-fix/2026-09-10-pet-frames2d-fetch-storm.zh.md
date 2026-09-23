# Agent Note: frames2d 预热把 1100+ 个帧请求瞬时灌进浏览器

Status: implemented

## Problem

运行实例的 GUI 控制台同时出现两类失败：宠物帧请求（`/pet/jyn/thumb/bingjing-gongzhu-staff/*.webp`）报 `net::ERR_INSUFFICIENT_RESOURCES`，以及宿主 GUI bundle 抛出的两条未捕获错误 `cannot get property "remote.session" without inject`。

宠物这半边是 dsh-web 缺陷。已安装的 `jyn` 宠物声明 16 个 track 共 1134 帧，frames2d 预热（warm pass）在一个同步循环里对全部 track 的全部帧发起 fetch，没有并发上限。对活页插桩实测：单次页面加载共 2320 个 fetch、在途峰值 2271、失败 821——超出浏览器每渲染进程在途请求上限，整批帧失败，页面自身的请求也被拖垮，而每个失败的 fetch 还会回退到 `new Image()`，在风暴未排空时重复请求同一 URL。失败解码还被永久记忆，波及的 track 在重新挂载前一直缺帧。

## Decision

frames2d 渲染器的全部帧请求现在经由一个有界池（并发 8）：

- 预热按「phase 可达 track 优先、其余库在后」入队，在池的保护下保留「一次解码、播放不等待」的原契约。
- 播放需求（`paintCanvas`）的加载插队到队首，先于预热积压。插队判断放在 memo 查找之前——预热入队的帧一入队就带着 memo，不提前判断就会命中缓存短路。
- 失败的解码从 memo 中移除，之后的播放会重试，而不是把失败记到重新挂载为止。
- dispose 排空队列，未启动的任务以空操作放行，位图释放屏障得以落定。

随包入库的聚合产物（`packages/dsh-web-all/lib/client.js`）已用修复重建。

记录在案、本次不修的观察：`remote.session` inject 报错在本修复前后每次刷新页面都会出现，其调用栈完全落在宿主自己的 `assets/index-*.js` bundle 与官方 `dsh-client-ui-renderer` / `dsh-client-ui-model-selection` 客户端里，没有任何 `@linxin666` 帧。这是已安装宿主 cohort 的上游启动期问题（composer 模型 seat 照常渲染可用），不是 dsh-web 代码。

## Testing

- 活页 GUI，对运行实例做插桩刷新：修复前 2320 fetch / 峰值 2271 / 失败 821；修复后 1189 fetch / 峰值 19 / 失败 0，宠物画布单次挂载，控制台无错误。
- `frames2d.test.ts` 新增三个 canvas 路径用例：24 帧预热下池上限不被突破、播放需求插队到积压之前、失败帧被重试而非永久记忆。包套件 492 个测试通过。
- `pnpm typecheck`、`pnpm test`、`pnpm docs:check`、`pnpm i18n:check` 通过。

## Alternatives considered

- **彻底去掉预热（全部按需解码）。** 否决：预热是渲染器零等待契约背后的实测设计决策；池保留契约的同时消除对浏览器上限的突破。
- **只调大并发数、不排队。** 否决：能快速预热 1100 帧的固定高上限必然重现越限；低上限不排队则把需求加载串在预热之后。
- **失败帧带退避重试。** 否决为过度设计：加上限后失败归零（验证中为 0），memo 删除的按需重试已覆盖瞬时故障，无需额外机制。

## Consequences

- 大体积宠物挂载不再拖垮页面；真正失败的帧（服务宕机、资产损坏）会在下一次播放时自愈，而不是空白到重新挂载。
- 池约束的是单次挂载的压力；重新挂载仍会（经 HTTP 缓存）重走整个库，宠物若被紧密循环地反复挂载仍会抖动——结构性防线仍是单次挂载守卫。
- 上游的 `remote.session` 启动报错仍会出现在控制台；它属于宿主侧且对模型 seat 无碍，但在宿主 cohort 修复前会持续出现在用户报告里。
