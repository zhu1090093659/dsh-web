# @linxin666/dsh-client-ui-market

[English](README.md) | 中文

DSH Web GUI 设置页的创意工坊商店卡片：唯一的「创意工坊」一级分区在 GUI 内浏览 [dsh-market.com](https://dsh-market.com) 的皮肤、宠物与插件，并一键安装到本机；已安装内容由各自的设置分区管理（皮肤中心、宠物、官方插件分区内的插件管理）。

## 功能

- 三类目录（皮肤 / 宠物 / 插件），排序与创意工坊站一致：设备点赞优先（同票回落清单顺序）、搜索框、每卡预览链接（皮肤打开实时试穿模拟器）。
- 一键安装资产（回环浏览器）：皮肤下载到 `$DSH_HOME/skins/<id>/`，宠物下载到 `$DSH_HOME/pets/<id>/` —— 这两个正是皮肤中心与宠物注册表已扫描的 DSH home 目录，无需重启（重新打开卡片即生效）。覆盖已有目录前弹确认并原子替换。
- 一键安装插件：通过可选的 `pluginManager` 服务（由 `@linxin666/dsh-client-ui-plugin-manager` 提供）；未安装时降级为复制命令索引。
- 远程浏览器只读：隐藏安装按钮，保留创意工坊站链接与复制命令兜底。

## 安装

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-market
```

重启 `dsh web` 后，设置页出现「创意工坊」分区，直接展开本商店卡片（皮肤 / 宠物 / 插件三个类目）。皮肤中心、宠物与官方「插件」分区里的插件管理各自是独立的设置分区。

## 配置

- 启用开关：卡片在插件配置区带自己的总开关（持久化于 `dsh-web-ui-market` 设置命名空间）；关闭后隐藏目录内容、仅保留开关本身。
- 无其他配置项；目录数据始终来自 dsh-market.com。

## 已知限制

- 远程（非回环）浏览器完全无法驱动安装，只能看到只读目录与复制命令兜底。
- 资产安装要求创意工坊站可达；清单或下载失败时，已存在的资产目录保持原样。
- 点赞按设备计（浏览器保存匿名指纹），与任何登录体系无关。

## 数据遥测

浏览器半区每个 UTC 日向 dsh-market.com 发送一次匿名安装心跳：仅含一个 localStorage 随机 ID 与本包名，无其他数据。服务端只存储该 ID 的加盐哈希，不存 IP，且只暴露聚合计数。完整契约见 [docs/telemetry.md](../../docs/telemetry.md)。

## 架构

- host 半区（`src/index.ts`）注册 `dsh-web-ui-market` 设置命名空间并挂载仅回环的网关（`/api/market/installed`、`/api/market/install-skin`、`/api/market/install-pet`）。
- 安装器核心（`src/core/installer.ts`）自行从 `dsh-market.com` 拉取清单、按保守白名单校验每个路径、原子写入（临时目录后 rename）——失败下载不会留下半成品目录；客户端从不提供 URL 或文件列表。
- 创意工坊每项资产带明确的文件清单，`scripts/market-build` 重新生成 `market/dist` 后，新皮肤包即自动可装。

## 安全模型

- 安装路由仅回环可访问（与插件管理器同一门禁）；远程浏览器无法驱动。
- 下载内容全部来自 `https://dsh-market.com`（URL 由验证后的清单重建）；皮肤 CSS 由皮肤中心运行时净化后才应用。
- 清单（1 MiB）、单项资产文件数（200）与单文件大小（200 MiB）均设上限，每次请求带 30 秒超时；超限或超时的清单/下载会明确失败，已存在的资产目录保持原样。
- 每次安装都会向资产目录写入 `dsh-market.provenance.json`：每个已安装文件的 sha256，钉住 `https://dsh-market.com` 来源。皮肤中心据此仅在市场皮肤的磁盘字节与市场所服务的内容哈希一致时运行其 hooks（issue #1073）；手工投放或被篡改的目录保持拒绝 hooks。
- 插件安装走与插件管理器页相同的确认与 CLI 路径。
- 卡片在调用插件管理器前校验清单安装来源：仅接受 npm 包名（可带版本标签）与纯 https:// git
  地址；ssh://、file://、http:// 及相对路径、裸仓库名一律拒绝并报错，不发起安装。
