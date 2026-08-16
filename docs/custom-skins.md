# 自定义壁纸皮肤制作指南（Custom Wallpaper Skins）

> 本指南面向**最终用户**：不改 dsh-web-ui 源码、不发布 npm 包，在本地为 DSH Web GUI 制作属于自己的**背景壁纸皮肤**，并接入皮肤中心（试穿 / 透明度调节 / 应用）。

如果你是想把新皮肤**贡献进全家桶**（进入 `dsh-skins` 内置皮肤），请走 [docs/plugins.md](./plugins.md) 的仓库内流程；本指南对应的是**本地私有皮肤**。

---

## 一、背景：皮肤是什么

皮肤（skin）是一个**浏览器端 Cordis 客户端插件包**，结构固定为：

```text
<skins-root>/<skin-id>/
├── skin.json          # 皮肤清单（皮肤中心据此识别）
├── package.json       # 包清单（dsh.bundle.patch + dsh.client 声明）
├── cordis.patch.yml   # 插入一条 ui-skin-<id> 装载行
└── lib/
    ├── index.js       # host 半区入口（空实现即可）
    └── client.js      # 浏览器半区：实际画背景的代码
```

> `<skins-root>` 是皮肤根目录，见下文「三、皮肤根目录」。
> `<skin-id>` 限小写字母、数字、连字符，如 `my-wallpaper`。

## 二、四个文件的写法

### 1) `skin.json`（清单，必须合法才能被识别）

```json
{
  "id": "my-wallpaper",
  "name": "我的壁纸",
  "nameEn": "My Wallpaper",
  "author": "你的名字",
  "tagline": "自定义壁纸 · 支持透明度调节",
  "description": "把喜欢的图设为 DSH 背景。",
  "tags": ["wallpaper", "custom"],
  "accent": "#4a5fa8",
  "bodyAttr": "data-dsh-my-wallpaper",
  "package": "@linxin666/dsh-client-ui-skin-my-wallpaper",
  "wiring": { "id": "ui-skin-my-wallpaper", "bundleWired": false },
  "preview": { "light": "", "dark": "" },
  "order": 100
}
```

字段校验（与皮肤中心一致）：

- `id`：`^[a-z0-9-]+$`
- `package`：合法 npm 包名（`@scope/name` 或 `name`），不能含路径分隔符
- `wiring.id`：`^ui-skin-[a-z0-9-]+$`
- `bodyAttr`：应用皮肤时写到 `<body>` 上的属性名，客户端代码必须实际设置它

### 2) `package.json`

```json
{
  "name": "@linxin666/dsh-client-ui-skin-my-wallpaper",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "inject": [], "platform": "web" }
  },
  "license": "MIT",
  "files": ["lib", "skin.json", "cordis.patch.yml"]
}
```

`dsh.bundle.patch` 指向包内 `cordis.patch.yml`；`dsh.client` 声明这是 Web 平台客户端插件。

### 3) `cordis.patch.yml`

```yaml
- insert:
    - id: ui-skin-my-wallpaper
      name: '@linxin666/dsh-client-ui-skin-my-wallpaper'
```

### 4) `lib/`（核心）

`lib/index.js`（host 半区，皮肤是纯浏览器功能，空实现即可）：

```js
function apply() {}
export { apply };
```

`lib/client.js`（浏览器半区）—— 契约要点：

- 通过 `window.__ModuleLoader__.load({ id, factory })` 注册（与官方客户端插件同一加载机制）；
- 模块导出 `apply(ctx)`，皮肤中心挂载时调用，`ctx.effect(fn)` 注册卸载清理；
- `apply` 里：给 `<body>` 设置 `bodyAttr` 属性 → 注入 `<style data-plugin>`（半透明规则）→ 设置 body 背景图 → 监听明暗主题切换 → 卸载时全部还原。

最小骨架（背景图内嵌 base64 data URI）：

```js
window.__ModuleLoader__.load({
  id: "@linxin666/dsh-client-ui-skin-my-wallpaper",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const BODY_ATTR = "data-dsh-my-wallpaper";
    // 背景图：1920 宽 JPEG → base64（图片不进会话记录，只在浏览器端）
    const WALLPAPER = "data:image/jpeg;base64,...";

    // 半透明规则（见第五节 token 清单）
    const SKIN_CSS = `html{background:0 0}body[${BODY_ATTR}]{...}`;

    function apply(ctx) {
      const body = document.body;
      body.setAttribute(BODY_ATTR, "");
      const tag = document.createElement("style");
      tag.dataset.plugin = "@linxin666/dsh-client-ui-skin-my-wallpaper";
      tag.dataset.pluginCss = "my-wallpaper.css";
      tag.textContent = SKIN_CSS;
      document.head.appendChild(tag);
      const setBackdrop = () => {
        const dark = body.dataset.dsDarkTheme !== void 0;
        // 透明度联动皮肤中心的「背景遮罩」滑块（--dsw-skin-scrim，0..1）
        const veil = dark
          ? "rgba(8, 10, 20, var(--dsw-skin-scrim, 0.35))"
          : "rgba(8, 10, 20, var(--dsw-skin-scrim, 0.22))";
        body.style.backgroundImage =
          "linear-gradient(" + veil + " 0%, " + veil + " 100%), url(" + WALLPAPER + ")";
        body.style.backgroundPosition = "center";
        body.style.backgroundSize = "cover";
        body.style.backgroundAttachment = "fixed";
        body.style.backgroundRepeat = "no-repeat";
      };
      setBackdrop();
      const observer = new MutationObserver(setBackdrop);
      observer.observe(body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
      ctx.effect(() => () => {
        body.removeAttribute(BODY_ATTR);
        observer.disconnect();
        tag.remove();
        body.style.backgroundImage = "";
      }, "ui-skin-my-wallpaper: backdrop");
    }
    exports.apply = apply;
    return module.exports;
  }
});
```

## 三、皮肤根目录（DSH_SKINS_DIR）

皮肤中心通过 `resolveSkinsDir()` 定位皮肤根目录，优先级：

1. 环境变量 **`DSH_SKINS_DIR`**（最高，推荐用于个人皮肤）
2. 安装目录下的 `node_modules/@linxin666` 作用域（dsh-skins 内置皮肤）
3. 历史路径 `node_modules/skins/`

个人使用：把皮肤目录放进任意目录（如 `G:\skins`），设置用户环境变量：

```
DSH_SKINS_DIR=G:\skins
```

重启 DSH 后，皮肤中心即从该目录扫描 `skin.json` 清单（每个子目录一个皮肤）。

> 注意：皮肤中心的**列表**当前取自客户端 bundle 编译时的清单快照，通过 `DSH_SKINS_DIR` 新增的皮肤可能**不显示在列表**里（后台试穿/应用接口可用）。参见 [issue #354：皮肤列表动态化](https://github.com/zhu1090093659/dsh-web-ui/issues/354)。

## 四、透明度滑块（--dsw-skin-scrim）

皮肤中心的「背景遮罩」滑块把 `--dsw-skin-scrim`（0..1）写到 `document.body`。皮肤在背景渐变里用 `var(--dsw-skin-scrim, 默认值)` 引用它，滑块拖动时浏览器实时重绘，无需 JS。

滑块（含模糊调节）当前只对声明了背景的皮肤 id 显示——内置皮肤中 `blue-fantasy`、`whale-song` 有该能力；**自定义皮肤要让滑块出现，需要把 id 加入皮肤中心客户端的背景皮肤白名单**（当前为编译期集合，插件更新会覆盖，见 [issue #354](https://github.com/zhu1090093659/dsh-web-ui/issues/354)）。

## 五、让背景图透出的完整 token 清单（关键）

只设置 body 背景是不够的——DSH 的面板、侧边栏默认是**不透明**的，会把背景图盖住。需要同时覆盖以下 token（亮色/暗色各一套，值为半透明色；以下为蓝色幻想皮肤同款调好的值）：

```css
body[data-dsh-my-wallpaper] {
  /* DSH 通用面板 */
  --dsw-alias-bg-base: #ffffff73;
  --dsw-alias-bg-layer-1: #f3f5fb80;
  --dsw-alias-bg-layer-2: #e9edf78c;
  --dsw-alias-bg-layer-3: #dde3f194;
  --dsw-alias-bg-mask-1: #1c254666;
  --dsw-alias-bg-mask-2: #1c254633;
  --dsw-alias-bg-mask-3: #1c25461a;
  --dsw-alias-bg-overlay: #ffffffd9;
  --dsw-alias-bg-module-platform: #ffffffb3;
  --dsw-alias-tooltip-bg: #ffffffd9;
  /* ★ 左侧边栏专用 token（易漏） */
  --dsw-specific-sidebar-fill: rgba(243, 245, 251, 0.5);
  /* ★ 右侧 aionui 面板的独立 token 体系 */
  --aion-bg-base: #ffffff73;
  --aion-bg-1: #f9fafb80;
  --aion-bg-2: #f2f3f58c;
  --aion-bg-3: #e5e6eb94;
  --aion-bg-hover: #ffffff99;
  --aion-bg-active: #ffffff80;
  --aion-fill-2: #f2f3f58c;
  --aion-fill-3: #e5e6eb94;
}
body[data-dsh-my-wallpaper][data-ds-dark-theme] { /* 暗色一套，见 packages/skins/blue-fantasy */ }
body[data-dsh-my-wallpaper] [id=root] { background: 0 0; } /* 根元素透明 */
```

> 这三个来源缺一不可：`--dsw-alias-bg-*`（主面板）、`--dsw-specific-sidebar-fill`（左侧边栏）、`--aion-bg-*`（右侧面板插件）。完整暗色值可参考 `packages/skins/blue-fantasy/lib/client.js` 与 `packages/skins/whale-song/lib/client.js`。

## 六、已知限制

- **打包版（DSH Desktop）应用皮肤后需要重启应用才生效**：点「应用」只写入配置，皮肤模块要随下次启动进入浏览器加载清单；界面提示的「刷新页面」对打包版不生效（开发模式无此问题）。
- **试穿（try-on）无需重启**，可即时预览。
- 背景图以 base64 内嵌进 `lib/client.js`，建议压到 1920 宽、JPEG q75 左右（约 200–400KB），避免包体过大拖慢加载。
