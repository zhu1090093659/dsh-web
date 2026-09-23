# @linxin666/dsh-client-ui-skin-furina

[English](README.md) | 中文

适用于dsh-web的芙宁娜主题。

## 安装

皮肤中心插件是唯一的加载器：先装它（或装全家桶聚合包），再从[创意工坊](https://dsh-market.com)把本皮肤安装到 `$DSH_HOME/skins/furina/`，然后在「设置 → 皮肤中心」里选中。同一时刻只激活一个皮肤，卡片切换无需重启。

```sh
# 加载器（二选一）
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-center@latest
dsh plugin --profile web add @linxin666/dsh-web-all@latest
# 从仓库安装（开发调试）：本皮肤位于皮肤中心包内
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/skins/skin-center
```

`$(pwd)` 指克隆本仓库后的目录。

本地 `link:` 安装需要先构建仓库产物（`lib/` 被 git 忽略）；通过 git 安装（`dsh plugin --profile web add github:<org>/dsh-web#<sha>`）时 `prepare` 脚本会自动构建 `lib/`，pnpm ≥10 首次安装还需把 pnpm 打印的包键加入 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 后再重试。仓库辅助脚本 `dsh-skin use furina` 也可以在终端切换皮肤。

## 背景图

`src/client/art.ts` 内嵌主题的 `background.jpg`（2278×1280）压缩为 1920×1079 JPEG q76（约 210KB）的 data URL；文件头注释里有精确的重生成步骤。亮色遮罩是冰纱，暗色遮罩是深靛蓝纱——都按图的最亮/最暗区域调过，保证文字可读。

## 预览

亮色（[preview/light.png](preview/light.png)）· 暗色（[preview/dark.png](preview/dark.png)）——在 0807 基线裸 web profile 上截图。

## 要求

环境半透明是 token 级的（`--dsw-alias-bg-*`、`--dsw-specific-sidebar-fill`），与面板布局无关。刻意不用 `backdrop-filter`：带模糊的祖先会成为 fixed 覆盖层的包含块（设置面板会被锁进侧边栏）。

## 模型体验

无。皮肤只改浏览器 DOM，不触及模型请求。

#### KV Cache 影响

无；本包不组装也不发送任何 provider 请求。

## 版权声明

本主题所使用的背景图片及装饰素材，部分系从互联网公开渠道搜集所得，其版权（包括著作权、肖像权等）均归原权利人所有，我们仅作合理展示之用。若您认为任何素材侵犯了您的合法权益，请通过下述联系方式向我们提交有效的权利证明及侵权材料，我们承诺在收到通知后 3个工作日内核实并采取删除、屏蔽或断开链接等必要处理措施；因网络信息繁杂，若无法追溯原始作者，敬请谅解，并欢迎权利人主动与我们沟通以便标注来源或协商授权。联系邮箱：`gino0922@163.com`。本声明自发布之日起生效，并保留最终解释权。
