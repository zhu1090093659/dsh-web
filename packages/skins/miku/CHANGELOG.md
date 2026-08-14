# Changelog

## 0.1.12 — 视觉全面优化（主题更新）

### 新增
- 初音光标：全界面鼠标指针变为初音图标（64x64，热点对准尖端；`dsh.miku.cursor=off` 可关闭）
- 配置项：`dsh.miku.title`（标题栏文字）、`dsh.miku.cells`（状态栏文字）、`dsh.miku.cursor`（光标开关）
- Safari 适配：支持 `prefers-reduced-transparency`（系统开启"降低透明度"时自动去掉毛玻璃，省 GPU 开销）

### 优化
- 背景图替换：使用用户提供的初音图（2560x1440，高质量 WebP 内嵌，无静态资源）
- 透明化：左侧导航栏、文件树 / 预览面板、对话区、输入框全部改为透明毛玻璃，背景图直接透出
- 文字配色：浅色主题正文改为亮青蓝（与背景图高光一致），输入框文字黑色（发送后消息保持亮青蓝）
- 输入框：蓝色半透明毛玻璃（`rgba(56,155,230,0.28)` + blur）
- 按钮：去掉白色玻璃渐变，统一为蓝色透明毛玻璃
- 拖拽分隔条：去掉白色边框与白条，命中区透明，仅保留 Miku 蓝分割线
- 状态栏：背景改为与标题栏一致的蓝紫洋红渐变，文字白色
- 设置界面：亮 / 暗主题统一为深蓝毛玻璃

### 修复
- 修复全局 `* { border-radius: 6px }` 覆盖标题栏按钮 / 状态栏单元格精确圆角的问题
- 修复 CSS 中重复的 scrollBody 规则（合并去重）

### 说明
- 光标素材来源：用户提供的 Windows 光标包（Moos柚眠），仅限个人使用，请勿商用或二次修改

---

# Changelog (English)

## 0.1.12 — Visual overhaul (theme update)

### Added
- Miku cursor: the whole window pointer becomes a Hatsune Miku icon (64x64, hotspot at the tip; `dsh.miku.cursor=off` disables it)
- Config keys: `dsh.miku.title` (title text), `dsh.miku.cells` (status text), `dsh.miku.cursor` (cursor toggle)
- Safari support: `prefers-reduced-transparency` (frosted glass degrades to plain fills when the system reduces transparency)

### Improved
- Backdrop replaced with the user's Miku image (2560x1440, high-quality WebP inlined; no static assets)
- Transparency: sidebar, explorer/preview panes, conversation and inputs are now transparent frosted glass — the art shows through directly
- Text colors: light-theme body text is bright cyan-blue (matches the art highlights); input text is black (sent messages stay bright cyan)
- Inputs: blue translucent frosted glass (`rgba(56,155,230,0.28)` + blur)
- Buttons: white glass gradient removed; unified to blue translucent frosted glass
- Drag handles: white borders/bands removed; transparent hit zone with a Miku-blue divider line
- Status bar: background now matches the title bar's blue-violet-magenta gradient with white text
- Settings: both themes share the same deep-blue frosted glass

### Fixed
- Global `* { border-radius: 6px }` no longer overrides the precise corner radii of title-bar buttons / status cells
- Duplicate scrollBody rules merged

### Note
- Cursor artwork source: the user's Windows cursor pack (Moos柚眠); personal use only — no commercial use or derivative works
