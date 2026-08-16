# @linxin666/dsh-plugin-manager

[English](README.md) | 中文

dsh Web GUI 的插件启停管理器：覆盖官方「插件」分区里只读的「全部」插件列表，
给每一行加上启用/停用开关。开关通过 Cordis Loader 即时生效，并写入
`~/.dsh/cordis.patch.yml`，重启后保持。全部走官方 DSH 机制，不修改 DSH 源码。

## 功能

- 设置 → 插件 → 插件列表：管理器占用官方清单 tab 的格子（id `all`）并以
  更低的 slot 优先级注册，只读列表被替换为同样的列表 + 每行启停开关。
- 列表与官方清单一致：每个已加载的 Loader 条目，含模块名、entry id、实时
  fiber 状态与启用/停用标签。
- 每行一个启用/停用开关。开关直接调用 Loader 条目更新，插件立即挂载或卸载
  ——无需重启。
- 每个开关都会写入用户 patch 层 `<dshHome>/cordis.patch.yml`（默认
  `~/.dsh/cordis.patch.yml`）的 id-targeted `disabled` 覆盖；dsh web 热重载
  该文件，下次启动也会再读，因此开关是持久的。
- 启动粘合条目（include 行、管理器自身、`cordis:include` / `cordis:group`、
  HMR 与 timer 模块）受保护、不显示开关；官方 @deepseek-ai 插件标记为
  「官方」。
- 即时切换失败时，停用意图回退到账本 `<dshHome>/plugin-manager.json`，下次
  启动重放。启用永不延迟：启动失败的插件不应拖垮整个 boot。

## 安装

### 从 npm（推荐）

```sh
dsh plugin --profile web add @linxin666/dsh-plugin-manager
```

### 从仓库（开发）

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-plugin-manager
```

重启 `dsh web`，打开 设置 → 插件 → 插件列表。

## 配置

本插件没有设置命名空间，行为固定：

| 方面 | 行为 |
| --- | --- |
| 范围 | 全部已加载插件条目（官方与第三方）；group 行跳过。 |
| 即时切换 | 通过 Cordis Loader 调用 `entry.update({ disabled })`——事务性，失败自动回滚。 |
| 持久化 | `<dshHome>/cordis.patch.yml` 的 id-targeted `disabled` 覆盖（原子写，保留注释）；dsh web 即时应用并在每次启动时读取。 |
| 兜底 | 停用失败时把意图记入 `<dshHome>/plugin-manager.json`，loader 稳定后重放；启用永不延迟。 |
| 保护 | `include`、管理器自身条目、`cordis:include` / `cordis:group`、HMR 与 timer 模块不可停用。 |

## 安全模型

- 全部 `/api/dsh-plugin-manager/*` 路由仅限 loopback：非本机地址、伪造 Host
  头与跨站来源一律 403（与 dsh-ssh 同款围栏）。
- 插件只写两处：用户 patch 层 `<dshHome>/cordis.patch.yml`（原子写）与兜底
  账本 `<dshHome>/plugin-manager.json`（0600 原子写）。
- 插件不添加 agent 工具、不发布系统提示词公告，是纯用户侧管理面。

## 已知限制

- 覆盖只替换「全部」tab 的渲染内容，不替换其 tab 栏行：官方清单插件仍启用
  时，分区会投影出两个「插件列表」格子（两者都渲染本插件的列表）。在 profile
  patch 中停用官方 `ui-settings-plugin-inventory` 条目即可保留单个 tab
  （本仓库的挂载已这样做）。
- 模块启动失败的插件无法从界面启用（启用无重启兜底），且插件管理器自身条目
  受保护，不能从自己的列表停用。
- 持久开关只作用于当前 dsh home；不同的 `DSH_HOME` profile 有各自的 patch
  层。

## License

Apache-2.0。
