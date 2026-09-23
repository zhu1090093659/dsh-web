# Agent Note: 批次 issue 1646-1665——无条件通道门、侧栏 agent-opens 套接字与 issue 标签竞态

Status: implemented

## Problem

四条未关闭报告与一条已关闭重复项暴露了三个缺陷与两项处置：

1. **#1665——配对设备可以解除 `/remote` 门。** `packages/dsh-remote-web-ui/src/remote-api.ts` 在 `requirePairingForLan` 为 false 时整段跳过配对 cookie 校验。该策略值是设置键，而全家桶设置桥（`/api/dsh-web-ui-settings`）为设置对等刻意对配对设备重新开放——于是配对设备可把它置为 false，此后通道放行任何能到达端口的调用者。通道不是中立转发：它用进程自身的 harness 浏览器认证凭据（`inner-auth.ts`）重新发起每一次转发调用，因此被放行的未配对调用者得以驱动完整 host API——聊天、会话、工具——而桌面面板仍显示「已停止 / 0 台设备」，`stop()` 也不触碰该策略。
2. **#1646——侧栏「模型主动打开」推送套接字从未走通道。** `wsPaths` 与 `REMOTE_UPGRADE_PATHS` 列了 `/sidebar/ws/terminal` 与 `/sidebar/ws/agent-terminals`，唯独没有 `/sidebar/ws/agent-opens`。在配对远程下浏览器把未重写路径直连隧道源站、握手被拒，`dsh-better-sidebar` 重试五次后放弃，`sidebar_open` 永远到不了设备（`delivered:false`，只在下次 attach 时重放）。
3. **issue 模板执行器关闭了每一份非协作者的 Bug 报告。** `issue-template-enforcer.yml` 硬要求 `bug` 标签，而该标签由 `auto-label-issues.yml` 在它自己的 `issues: opened` 事件里补上。两个 workflow 都跑在 `opened` 上，因此存在竞态，执行器读到的是标签尚不存在时的快照。GitHub 只对表单提交原子附加该标签，所以经 API 或 CLI 提交的报告（贡献者流程）在任何人读到之前就被以 `not_planned` 关闭——#1646 与 #1648，同一位报告者，两次。

## Decision

**`/remote` 的通道门是无条件的，它不是来自设置的授权输入。** `requirePairingForLan` 被从 `RemoteApiDeps` 中彻底移除（而非默认为 true），使未来任何调用点都无法通过传值重新引入该旁路：HTTP 处理器与升级处理器一律要求有效配对凭据（cookie、无 cookie 请求头，或握手上的 `device` 查询参数）。局域网策略只保留两个含义——桌面半区是否安装客户端重写，以及普通 `/api` 面自身的姿态——不再能放宽通道。`stop()` 因此无需改动：它本已清空设备表，下一个请求即 403（由测试钉定）。设置桥仍按 [remote control reuses the official UI](../../architecture/2026-08-29-remote-control-reuses-official-ui.zh.md) 对配对设备开放；改变的是经它写入不再能解除门。

**侧栏一族按集合覆盖，并以漂移守卫替代手工清单。** `/sidebar/ws/agent-opens` 同时加入 `wsPaths`（解析期引导补丁与运行时补丁共用）与 `REMOTE_UPGRADE_PATHS`（host 按精确路径注册升级）。由于「在前者而不在后者」等于被重写到死路由——正是 #1646 报告的症状——`tests/remote-contract.spec.ts` 现在从 `wsPaths` 推导期望的升级集合并断言相等，下一条遗漏套接字会在测试套件里失败，而不是发布出去。

**issue 模板执行器只依据 issue 正文判定 Bug 属性。** 标签成员资格不再被读取：信号是 `Issue 类型` 小节，按大小写不敏感匹配表单输出的 Bug 取值。表单提交时 `labels: ["bug"]` 的原子附加仍然生效，`auto-label-issues.yml` 保持原样、在自己的事件上为 API 提交的报告打标；两个 workflow 现在是相互独立而非有序的。

余下两条报告属于处置而非代码改动：

- **#1642（`dsh web` 重启后壳 rev 过期）**——失效对象是 loader entry 的组合 URL 与其进程 nonce，归属官方 `@deepseek-ai/dsh-client-modules`。本仓库现有的防线（`/pair-app` 与 app shell 的 `no-store`、network-first 的重开 service worker、15 秒引导看门狗）只覆盖导航与文档层，这也解释了为什么清除站点数据即可恢复。归上游跟踪；仓库侧可做的加固（回退缓存壳前先探测当前源活性，以及让看门狗落到重新配对页而非裸 reload）作为后续项记录在 issue 上，本次不实现。
- **#1654（任务看板主线/支线关注通道）**——来自贡献者的功能提案，作者明确表示愿意实现。方向已认可并保持开放，等作者的 M0 PR；本次不构建，因此不进入本批次决策。

## Alternatives considered

- **#1665：把设置桥加入 `LOCAL_ONLY_PREFIXES`。** issue 的第一条建议，否决：配对设备的设置对等是已记录决策（桥当初是被刻意重新开放的），且整个配置面——而非仅这一个键——都走通道。拉黑单条路径会把同类缺陷留给下一个「用于门控某物的策略键」。
- **#1665：让该策略字段仅物理本地可写。** 否决作为主修复：它在插件并不拥有的通用设置接缝里硬编码逐键例外，且若通道日后承载桌面自身的设置卡会静默破坏。修门消除的是整类问题，而非一个实例。
- **#1665：策略关闭时仍要求设备凭据，但保留该参数。** 否决，比删除更弱：一个保留却被忽略的参数会诱导读者（或新调用点）相信它授权了什么。删除它让错误写法不可表达。
- **#1665：让 `stop()` 把策略复位为 true。** issue 的第四条建议。否决，作为防线不完整：它留下写入与停止之间的窗口，并使撤销依赖一次无关的设置写入。无条件门在使用点闭合了这条链。
- **#1646：通用代理 `/sidebar/ws/*` 全部升级。** 否决，理由同网关 mux 笔记否决通用 `/api` 升级代理：webserver 按精确路径派发升级，前缀代理会与拥有该套接字的插件竞争，且每条套接字都会失去自己的设备门。改为用漂移守卫测试解决维护成本。
- **#1646：改 `dsh-better-sidebar` 使用相对路径。** 否决：该套接字按构造就是同源的，遗漏在本插件的重写表，而不在调用方的 URL 拼接。
- **执行器：把已知的机器人捷径做成白名单，例如标签缺失视为「未知」并在下一个事件复核。** 否决：仍需要第二个事件才能收敛，而 `auto-label-issues.yml` 本就在 `edited` 上触发；依据正文判定在首轮即收敛。
- **执行器：除 `opened` 外再触发 `labeled`。** 否决：它只是把同一份报告推迟到更晚的事件上关闭，而不是根本不关，并且让每个 issue 的 workflow 运行次数翻倍。

## Consequences

- 未配对调用者再也无法经 `/remote` 触达 host API 的任何部分，无论设置文件怎么写。报告的链路（配对 → 把策略写为关 → 丢弃 cookie）现在在第一个未配对请求上即以 `403 unpaired` 失败。
- `requirePairingForLan` 仍是普通 `/api` 面一个真实、用户可见的策略；桌面设置卡提示描述的是重写决策，依然准确。用户此前可依赖的一项行为——关掉策略以继续使用过期的已重写客户端——按设计消失了：策略关闭时桌面就不再安装重写。
- 配对远程浏览器现在实时收到 `sidebar_open` 推送；该套接字与两位同门呈现相同的门行为（未配对 403，配对则转发）。
- 经 API 提交且模板完整的 Bug 报告能在执行器下存活。真正跳过模板的报告仍会被关闭，那正是执行器的目的。
- `wsPaths`/`REMOTE_UPGRADE_PATHS` 这对表现在由测试机械耦合，#1646 的失败模式会在评审期大声失败，而不是在运行时静默失败。

## Testing

- `packages/dsh-remote-web-ui/tests/remote-api.spec.ts`：局域网策略关闭时未配对请求仍被拒；配对设备持续可用，并在 `stop()` 落地的那一刻失去访问；配对设备仍可写设置桥，而同一写入来自未配对调用者时在代理段之前即被拒；控制面对配对设备保持拒绝，而配置面照常代理。
- `packages/dsh-remote-web-ui/tests/remote-upgrade.spec.ts`：未配对升级以 `403 Forbidden` 被拒且永不触达上游，替换掉原先断言策略关闭旁路的那条测试。
- `packages/dsh-remote-web-ui/tests/remote-channel.spec.ts` 与 `tests/remote-channel-boot.spec.ts`：`/sidebar/ws/agent-opens` 在运行时补丁与生成的引导脚本中都被重写。
- `packages/dsh-remote-web-ui/tests/remote-contract.spec.ts`：升级路由集合由 `wsPaths` 推导并断言相等，三条侧栏套接字按名钉定。
- 包套件：34 个文件 379 个测试全绿，另加 `typecheck`。
- 执行器改动是 workflow YAML，无单测；通过阅读两个 workflow 的触发器与表单的 `labels:` 键、并对照那两个被关闭的 issue 复现竞态来验证。
