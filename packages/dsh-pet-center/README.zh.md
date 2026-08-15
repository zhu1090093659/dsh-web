# dsh-pet-center — 宠物中心

[English](README.md) | 中文

> 在设置里一键切换陪伴宠物：最初版的鲸鱼娘「dsh-pet」与引入的女仆鲸鱼娘「dsh-pet-maid」，支持试穿预览与应用。

## 功能

| 功能 | 说明 |
|---|---|
| 宠物列表 | 展示两个可选宠物：最初版鲸鱼娘（dsh-pet）与引入的女仆鲸鱼娘（dsh-pet-maid） |
| 试用预览 | 点「试用」立即切换到目标宠物查看效果，可随时「退出试用」还原 |
| 一键应用 | 点「应用」把选择持久化——写入 `~/.dsh/cordis.patch.yml` 的 managed 区段，配置监听器数秒内热更新，刷新页面生效，无需重启 |
| 当前状态 | 每个宠物显示「当前激活 / 试用中」徽标 |

## 安装

随全家桶聚合包 `@linxin666/dsh-web-ui-all` 一起安装（或单独安装 `@linxin666/dsh-client-ui-pet-center`），然后**重启 `dsh web`**，在「设置 → 插件 → Web UI 插件 → 宠物中心」打开。

## 架构

```
dsh-pet-center/
|-- src/
|   |-- index.ts        # host 半区：注册 /api/pet-center/* 路由
|   |-- pet-switch.ts   # 切换活动宠物：改写 ~/.dsh/cordis.patch.yml 的 managed 区段
|   |-- routes.ts       # /api/pet-center/state + /apply（同源 fence，防 CSRF）
|   `-- client/         # browser 半区
|       |-- index.ts    # 注册宠物中心卡到 web-ui.plugin.item 分组
|       |-- PetCenter.tsx   # 卡片 UI：列表 + 试用/应用 + 状态徽标
|       |-- locales.ts  # 中英文案
|       `-- pet-center.module.css
`-- cordis.patch.yml    # bundle patch：插入 ui-pet-center 行
```

## 机制

- 两个宠物都是聚合包的 bundle-wired 行（不需要 insert 行）。活动宠物 = managed 区段**不**禁用的那个。
- 「应用 / 试用」都调用宿主 `/api/pet-center/apply {pet}`，宿主改写 `~/.dsh/cordis.patch.yml` 的宠物 managed 区段（禁用另一个宠物），皮肤 managed 区段不受影响。
- 配置监听器（DSH config watcher）数秒内热更新，刷新页面后生效——仿皮肤中心的切换体验。

## 开发

```sh
pnpm --filter @linxin666/dsh-client-ui-pet-center build
pnpm --filter @linxin666/dsh-client-ui-pet-center test
```

## License

[Apache-2.0](LICENSE)
