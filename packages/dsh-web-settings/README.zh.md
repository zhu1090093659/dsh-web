# @linxin666/dsh-client-ui-web-ui-settings

[English](README.md) | 中文

面向 DSH 设置页的 dsh web UI 设置插件组：在 DSH 设置页注册一个一级菜单项（与通用设置 / 模式 / 插件 / Agent 预设同级），归组全家桶插件的启用开关与配置表单。

## 是什么

- **全家桶设置分区**：在 DSH 设置页注册一级菜单项，以静态标题和卡片归组其余 dsh web UI 全家桶插件（task-board、remote-web-ui、describe-image）。各插件卡默认折叠，独立展开后显示启用开关与配置表单。
- **一级设置分区**：皮肤中心、桌面宠物与「创意工坊」（商店卡片）各自作为一级设置分区注册，直接展开；官方「插件」分区内置安装器，插件管理 Tab 由 `dsh-plugin-manager` 提供。
- **家族插件不依赖本分组**：本包声明家族卡片注册的 list 槽 `web-ui.plugin.item`。本包已加载时家族插件注册进该槽；本包缺席时改注册官方插件管理页的 keyed 槽 `plugins.bundle.config`（以自身 bundle 包名为 key），因此只装家族插件、未装本分组的 profile 同样能触达每张卡片。
- **原生设置通道**：0.1.7 的设置面以 profile entry id 定位每个配置表单。Host 侧桥接按 profile 行反查各全家桶命名空间所属的 entry id，并在 describe 响应里回传；浏览器半区据此绑定原生共享表单（`ctx.configForms`）。无法解析 entry id 的页面才退回 loopback HTTP 通道。
- **旧版设置接管**：0.1.7 的设置子系统一次性导入 `settings.yaml` 并改名，但它是按「分区名即 profile entry id」写入的，而全家桶的行 id 是 `ui-pet` / `web-ui-pet`、`web-ui-usage` 等，因此全家桶分区（`pet`、`dsh-usage` …）匹配不到任何 entry，其值只能留在改名文件里成为孤儿。本包把这些分区一次性接管——写入服务其命名空间的 entry，或写入 Config 声明了同名字段的那个 entry——且绝不覆盖用户已设置的值，见下文「旧版设置导入」。

## 安装

### 从 npm 安装（推荐）

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-web-ui-settings@latest
```

### 从仓库安装（开发调试）

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-web-settings
```

安装后重启 `dsh web`，设置页出现该菜单项。

## 配置

`trustedProxyHosts` 为空时，桥接仍仅限 loopback。认证反向代理与 DSH 运行在同一 Host 的部署，可以显式加入准确的 authority，并指定保存代理共享令牌的环境变量名：

```yaml
- id: ui-web-ui-settings
  config:
    trustedProxyHosts:
      - dsh.example.com
    proxyTokenEnv: DSH_WEB_UI_SETTINGS_PROXY_TOKEN
```

为 DSH 和反向代理设置该环境变量。请生成专用的高熵值，不要把令牌值写入 `cordis.patch.yml`。在认证处理完成后，先替换内部请求头，再把请求转发到仅监听 loopback 的 DSH。Caddy 的 upstream 部分如下：

```caddyfile
reverse_proxy 127.0.0.1:3080 {
    header_up X-Dsh-Web-Ui-Settings-Proxy-Token {$DSH_WEB_UI_SETTINGS_PROXY_TOKEN}
}
```

带值的 `header_up` 会覆盖客户端提供的同名请求头。不要再同时删除同一字段：Caddy 2.6 会在分组操作中先设置、后删除。如果 Caddy 的 systemd 单元以 `caddy run --environ` 启动，请去掉该参数或严格保护其输出，因为该参数会在启动时打印环境变量。

`settings.yaml` 中的 `web_settings_namespaces` 继续决定桥接开放哪些全家桶命名空间；未配置时使用内置全家桶列表。Host 首次启动时会一次性导入 `settings.yaml` 并重命名为 `settings.yaml.imported`，因此桥接依次读取该改名文件、0.1.7 之前的旧文档，只有在文件名确实指向设置文档时才把 Host 上报的 profile patch 当作设置文档。修改插件配置需要重启 DSH，`web_settings_namespaces` 则在每次桥接调用时重新读取。

## 旧版设置导入

0.1.7 之前，`$DSH_HOME/settings.yaml` 以「每个全家桶插件一个顶层分区」的形式保存设置（`pet:`、`dsh-usage:`、`dsh-liangshen:` …）。新的设置子系统会一次性导入该文档并改名为 `settings.yaml.imported`，但它按「分区名即 profile entry id」逐个分区写入，而全家桶的行 id 是 `ui-pet` / `web-ui-pet`、`web-ui-usage` 等。这些分区因此匹配不到任何 entry：Host 记为 rejected 并把它们留在改名文件里，全家桶设置全部回退到 schema 默认值。

组合完成（loader 就绪）后，本包按两条有序规则接管这些分区：

1. **别名规则**：分区名先经桥接服务命名空间所用的同一套表解析——先查全家桶命名空间别名，再查该命名空间在 profile 中对应的 entry id。
2. **字段规则**：别名规则无法定位的分区，改为匹配「已服务 entry 的 Config 顶层字段」；必须恰好有唯一一个 entry 声明该同名字段，该 entry 即认领该分区。插件把旧命名空间折叠进自身 Config 的情况由此落地：皮肤中心的 Config 声明了 `skin-background`、`skin-custom-theme`、`skin-wallpaper` 三个字段，因此这三个同名的旧分区属于这些字段路径。

无论由哪条规则定位 entry，写入路径的判定相同：当该 entry 的 Config 声明了与分区同名的顶层字段时，分区写入该字段（即插件把旧命名空间折叠进自身 Config 的情形——皮肤中心的 `skin-background` 由别名规则定位，同样落在该字段内）；否则写入 entry 根，也就是 Config 直接承载分区字段的普通全家桶插件。两条规则都能认领的分区，别名规则优先。所有写入都走官方路径 `ctx.settings.update(entryId, patch, expectedRevision)`（`expectedRevision` 取自该 entry 的 descriptor），并记入下方标记文件，因此至多导入一次。

导入绝不覆盖用户已有内容：凡 entry 的 user 层已持有的字段路径都会从 patch 中剔除，且逐层判定——已持有的嵌套键保留原值，其未被触碰的兄弟字段照常导入，而已持有的整棵子树（含数组）永远不重写。没有任何 entry 服务的分区、entry 表单未声明其字段的分区，以及被两个及以上已服务 entry 声明同名字段的分区，都不会被盲写，只在 Host 日志中如实报告。每次运行都会记录结果（imported / already recorded / skipped / refused），且整个修复不阻塞激活：`ctx.settings` 或 config editor 缺失时它什么都不做。

每个成功落地的分区记入 `$DSH_HOME/dsh-web-settings-legacy-import.json`（默认 `~/.dsh/dsh-web-settings-legacy-import.json`），一个体量很小的版本化 JSON 文档：

```json
{
  "version": 1,
  "sections": {
    "pet": {
      "entryId": "web-ui-pet",
      "path": [],
      "fields": ["visible", "size"],
      "importedAt": "2026-09-22T00:00:00.000Z"
    },
    "skin-wallpaper": {
      "entryId": "web-ui-skin-center",
      "path": ["skin-wallpaper"],
      "fields": ["selection", "dim"],
      "importedAt": "2026-09-22T00:00:00.000Z"
    }
  }
}
```

`entryId` 是分区写入的 entry，`path` 是在该 entry 内的字段路径（别名规则写入 entry 根时为空数组，字段规则匹配时形如 `[name]`），`fields` 是在该路径下写入的分区自身字段名。更早版本写下的标记文件里没有 `path` 键，其含义同样是 entry 根。

标记文件让导入只发生一次：已记录的分区不会再次导入，因此用户之后清空的值会保持为空。被 Host 拒绝的分区、Host 当前未服务的 entry、以及本构建读不懂的标记文件都不会被记录，留待下次启动重试；版本号未知的标记文件会被原样保留，而不是覆盖式重导。删除该标记文件即可重新触发导入——user 层的检查依然会拒绝覆盖 entry 已持有的任何内容。

## 安全模型

- 远程桥接默认关闭。直接访问仍与此前一致，同时要求 loopback socket 和 loopback Host。
- 认证代理访问要求 loopback socket、规范且已配置的 Host、浏览器同源请求，以及由代理向 upstream 注入的共享令牌。浏览器不会收到该令牌。
- 反向代理是认证边界：DSH 必须只监听 loopback，认证必须排在 `reverse_proxy` 之前，内部请求头必须由代理替换而不能透传客户端值。
- 桥接只开放已注册全家桶命名空间与 `web_settings_namespaces` 的交集，不开放凭据、本机路径或其他 DSH 特权 API。

## 故障排查

### "Failed to load plugins ... keyed slot `settings.plugin.item` requires options.key"（DSH 0.1.0-rc.6+）

0.1.17 及更早版本把组卡片注册进 keyed 槽 `settings.plugin.item` 时传的是 `id` 而不是必填的 `key`；DSH 0.1.0-rc.6 起在 loader entry 应用阶段直接拒绝这种注册，Web GUI 因此以 "Failed to load plugins" 启动失败。

0.1.18 起注册改到一级 `settings.section` 槽（list 槽，用 `id` 定位），0.2.0 已发布；`main` 上的代码与 rc.6 / rc.7 兼容。仍在报错的 profile 带的是冻结的旧安装：

1. 把 profile `package.json` 里所有 `@linxin666/*` 依赖升到 `^0.2.0`（至少 `^0.1.18`）。
2. 重装 profile 依赖（`pnpm install`）；Windows 下重建陈旧的 `node_modules/@linxin666/*` junction 链接（先 `cmd /c rmdir <链接>` 再 `cmd /c mklink /J <链接> <目标>`）。
3. 重启 `dsh web`。

参见 [issue #513](https://github.com/zhu1090093659/dsh-web/issues/513)。

## 已知限制

- 仅当依赖的 `@deepseek-ai/dsh-client-ui-settings` 存在时，该菜单项才会出现在 dsh 设置页。
- 认证代理模式本身不提供认证；没有正确配置并排序认证代理的部署必须让 `trustedProxyHosts` 保持为空。
- 兼容桥只服务 dsh-web 全家桶设置，不会让 DSH 官方设置或凭据平面可被远程访问。
- 旧版设置导入的覆盖范围是全家桶设置面：分区既会匹配本包所服务的全家桶命名空间（别名规则），也会匹配这些已服务 entry 声明的 Config 顶层字段（字段规则）。属于 DSH 官方设置面或其他非全家桶插件的分区会留在 `settings.yaml.imported` 中，只记为 skipped。
- 字段规则 fail closed：被两个及以上已服务 entry 声明的同名字段，与无人声明的字段一样，分区继续留在改名文件中。

## 数据遥测

浏览器半区每个 UTC 日向 dsh-market.com 发送一次匿名安装心跳：仅含一个 localStorage 随机 ID 与本包名，无其他数据。服务端只存储该 ID 的加盐哈希，不存 IP，且只暴露聚合计数。完整契约见 [docs/telemetry.md](../../docs/telemetry.md)。
