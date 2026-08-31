# dsh-perf

[English](README.md) | 中文

面向流式与多会话场景的性能观测与治理插件。

## 它会做什么

全部以插件实现（不 fork core、不做运行时魔法），分三层：

1. **观测**：Host 侧 `PerfMeter` 订阅 cordis `session/event` 总线（每会话/总事件速率、类型分布）、`agent/status` 迁移流（idle/running 时间线）、事件循环延迟（perf_hooks）与内存；loopback 守卫的 `GET /api/dsh-perf/stats` 暴露聚合指标；浏览器 HUD 面板（默认关闭）显示服务端指标 + 本地 FPS / Longtask 采样。
2. **治理**：`cordis.patch.yml` 声明式覆盖 `session-persistence-jsonl` 的写批延迟（200ms → 500ms，流式期 fsync 批次约降 2.5 倍）；`mode: off | balanced | aggressive` 与告警预设（轻/标准/严格）在 Settings 面板热切换。
3. **降载与取证**：会话列表 store 发布门控把流式期间「仅投影身份变化」的 flush（usage/token 计数等）合并到约 1Hz 尾部补发（可见字段变化仍立即发布），30 秒里的无效整树重渲染从 30 次降到 3 次；消息行用 `content-visibility:auto` 近似虚拟化，HUD 关闭时也独立生效（dsh-better-sidebar 渲染的侧栏会话行刻意不做同样处理——固定 32px 占位行高会把行钉在固定位置、干扰其自身布局，该规则已移除）；`会话尾部完整性探针`在运行中的 Web GUI 里监听回合结束边沿，核对最终消息 finalNode、窗口尾与主机 history 尾部的 seq 一致性、编辑框残留（忙碌态点「停止」后草稿保留的签名），结果写入 localStorage 环形缓冲并 console.warn，用于定位「跑完不显示最终内容」的现场；agent 空闲徽标。

## 安装

在你的 profile（如 `~/.dsh/profiles/web`）中：

```bash
pnpm add @linxin666/dsh-perf
```

并在 `cordis.patch.yml`（或 bundle patch）中插入：

```yaml
- insert:
    - id: dsh-perf
      name: '@linxin666/dsh-perf'
      config:
        enabled: true
        mode: balanced
        meterIntervalMs: 2000
        statsWindowSeconds: 120
        alertPreset: standard
        hudEnabled: false
        renderDegrade: true
```

重启 `dsh web`（Web 模式加载期不启用 HMR）使 host 半生效；客户端半刷新页面即生效。HUD 面板与各开关在「设置 → Web 插件 → 性能引擎」卡片中开启。

## 配置

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关；关闭后 host 停止订阅/采样、HUD 隐藏、CSS 降载停用 |
| `mode` | `balanced` | `off` / `balanced` / `aggressive` |
| `meterIntervalMs` | `2000` | 采样周期（1s-60s，热切换） |
| `statsWindowSeconds` | `120` | 速率窗口（10s-1h） |
| `alertPreset` | `standard` | `light`（10 会话 / 1000 ev·s⁻¹）/ `standard`（5 / 300）/ `strict`（3 / 150） |
| `hudEnabled` | `false` | HUD 检测面板（浏览器侧） |
| `renderDegrade` | `true` | 渲染降载（列表发布门控；消息行保留 `content-visibility:auto`） |

## HUD / 面板

- 服务端：events/s、活跃会话数、事件循环 p99/mean 延迟、RSS/Heap、实际写批延迟（从运行时持久化服务读取）。
- 浏览器：FPS（近 1s）、Longtask（近 60s，含最大耗时），以及按插件活动度计分板——按各 `data-dsh-plugin` 根归因的节点新增速率（Top 3 + rest）；不发语义属性的插件在主线程上吃多少就只会落到 `rest=` 里而不是隐身；超出单次回调预算的节点同桶计入；`dsh-perf-debug=1` 暴露 `window.__dshPerfAttribution` 句柄（原始快照、长任务记录、来源 Top）；× 将面板收缩为小标签（点击展开）。
- host 端点连续 3 次不可达时自动隐藏（host 半缺失时静默降级）。
- 空闲 agent 在会话行尾显示 `·idle` 徽标（来自 `agent/status` 迁移事件，零上游改动）。

## 边界与上游

- `/api/dsh-perf/stats` 仅提供聚合指标（不含会话内容）；loopback 守卫复用 shared/host/loopback.ts（同源 + 127/8 + sec-fetch 标记）。
- 发射侧聚合与推送帧批量在 core（agent-loop / client-runtime），插件不替换它们；实测证据在 repo 的 docs/dsh-perf-optimization-report.md（内部研究，不走上游 PR）。
