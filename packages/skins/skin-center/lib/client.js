window.__ModuleLoader__.load({
	id: "@linxin666/dsh-client-ui-skin-center",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/generated/skins.ts
		/** Every skin, ordered by packages/skins/<name>/skin.json `order`. */
		const SKIN_CENTER_ENTRIES = [
			{
				"id": "qq98",
				"name": "QQ2008 怀旧版",
				"nameEn": "QQ2008 Retro",
				"author": "dsh-web-ui",
				"tagline": "水晶蓝桌面 · 玻璃深蓝标题栏 · 戴围巾企鹅",
				"description": "dsh web ui 家族收录的第一个皮肤：QQ2008 水晶蓝年代。深蓝渐变桌面、玻璃质感标题栏、浅蓝状态栏和圆角高光控件，配一只戴围巾的企鹅。",
				"tags": [
					"retro",
					"qq",
					"2008",
					"crystal-blue",
					"nostalgia"
				],
				"accent": "#2b7cd9",
				"bodyAttr": "data-dsh-retro",
				"package": "@linxin666/dsh-client-ui-skin-qq98",
				"order": 1
			},
			{
				"id": "ths",
				"name": "同花顺风格",
				"nameEn": "Tonghuashun Trading",
				"author": "dsh-web-ui",
				"tagline": "品牌红标题栏 · 实时行情状态栏 · 灰蓝数据终端",
				"description": "同花顺风格炒股主题：品牌红标题栏带上证指数行情签，状态栏红涨绿跌，自选股风格的侧边栏和交易终端面板，写代码也像盯盘。",
				"tags": [
					"stock",
					"trading",
					"terminal",
					"red"
				],
				"accent": "#e60012",
				"bodyAttr": "data-dsh-ths",
				"package": "@linxin666/dsh-client-ui-skin-ths",
				"order": 2
			},
			{
				"id": "xp",
				"name": "Windows XP (Luna)",
				"nameEn": "Windows XP Luna",
				"author": "dsh-web-ui",
				"tagline": "Luna 蓝窗口条 · 绿色开始按钮 · Bliss 蓝天桌面",
				"description": "Windows XP (Luna) 复古主题：蓝色渐变窗口条带窗口按钮、米色状态栏（大写/数字/滚动指示灯）、侧边栏任务栏上的绿色「开始」按钮、资源管理器风格树行和 Bliss 蓝天桌面，全局直角。",
				"tags": [
					"retro",
					"xp",
					"luna",
					"windows",
					"start-button"
				],
				"accent": "#316ac5",
				"bodyAttr": "data-dsh-xp",
				"package": "@linxin666/dsh-client-ui-skin-xp",
				"order": 3
			},
			{
				"id": "blue-fantasy",
				"name": "蓝色幻想",
				"nameEn": "Blue Fantasy",
				"author": "powerdog996（DreamSkin 社区）· dsh-web-ui 适配",
				"tagline": "鲸鱼插画背景 · periwinkle 靛蓝调色板 · 半透明面板",
				"description": "DreamSkin「DeepSeek-鲸鱼娘」Codex 桌面主题的 dsh 适配：鲸鱼插画背景垫在半透明面板之下，遮罩随亮/暗主题实时切换，periwinkle 靛蓝色调重映射到全部 dsh token。",
				"tags": [
					"dreamskin",
					"whale",
					"indigo",
					"art",
					"translucent"
				],
				"accent": "#4a5fa8",
				"bodyAttr": "data-dsh-blue-fantasy",
				"package": "@linxin666/dsh-client-ui-skin-blue-fantasy",
				"order": 4
			},
			{
				"id": "dragon-heir",
				"name": "龙的传人",
				"nameEn": "Dragon Heir",
				"author": "dsh-web-ui",
				"tagline": "不屈龙魂 · 万里长城双主题 · 朱砂龙印",
				"description": "龙的传人 — 一面是不屈龙魂（墨龙穿云、朱砂印章、不屈锋芒），一面是万里长城（青黛山色、金晖镀墙、苍茫暮色）。亮暗主题各自配一幅画与一枚龙印 favicon，面板半透明磨砂，让画透出来。",
				"tags": [
					"dragon",
					"loong",
					"chinese",
					"ink-wash",
					"great-wall",
					"dual-theme"
				],
				"accent": "#c3272b",
				"bodyAttr": "data-dsh-dragon-heir",
				"package": "@linxin666/dsh-client-ui-skin-dragon-heir",
				"order": 5
			},
			{
				"id": "minecraft",
				"name": "Minecraft 方块世界",
				"nameEn": "Minecraft Voxel",
				"author": "dsh-web-ui",
				"tagline": "动态全景天空盒 · 方块按钮 · 告示牌输入框",
				"description": "复刻《我的世界》主界面氛围的方块皮肤：程序化绘制的像素全景天空盒（方块山、像素云、方块树、草方块地面）在身后缓慢旋转，界面浮在石板上；按钮还原 MC 菜单按钮（灰石板、悬停变黄、按下下沉），输入框做成带钉子的木告示牌。",
				"tags": [
					"minecraft",
					"voxel",
					"pixel",
					"game",
					"panorama",
					"skybox"
				],
				"accent": "#7cbd4b",
				"bodyAttr": "data-dsh-minecraft",
				"package": "@linxin666/dsh-client-ui-skin-minecraft",
				"order": 6
			},
			{
				"id": "whale-song",
				"name": "鲸吟",
				"nameEn": "Whale Song",
				"author": "dsh-web-ui",
				"tagline": "深海鲸语女神背景 · 冰蓝海洋调色板 · 金色细线点缀",
				"description": "《鲸吟》— 深海鲸语女神主题：无文字纯氛围背景画（蓝发女神与鲸群居左、冰蓝星座网格与金线点缀、右侧大量留白）垫在半透明面板之下，遮罩随亮/暗主题实时切换，冰蓝/浅青/深海军蓝/钴蓝冷色体系重映射到全部 dsh token，暗色变体为深海夜航调。",
				"tags": [
					"whale",
					"ocean",
					"ice-blue",
					"goddess",
					"art",
					"translucent"
				],
				"accent": "#4d8fd4",
				"bodyAttr": "data-dsh-whale-song",
				"package": "@linxin666/dsh-client-ui-skin-whale-song",
				"order": 7
			},
			{
				"id": "trading",
				"name": "交易终端",
				"nameEn": "Trading Terminal",
				"author": "dsh-web-ui",
				"tagline": "实时行情跑马灯 · 长桥港美股行情 · 红涨绿跌交易终端",
				"description": "结合 dsh-fun-ticker 行情跑马灯与 dsh-longbridge 港美股行情的炒股皮肤：顶栏滚动 A股/港股/美股/指数/加密/外汇报价（装 fun-ticker 后跟随你的自选列表），状态栏展示长桥行情快照与 A股/港股/美股交易时段，写代码也像盯盘。",
				"tags": [
					"stock",
					"trading",
					"ticker",
					"live",
					"terminal",
					"longbridge"
				],
				"accent": "#f23645",
				"bodyAttr": "data-dsh-trading",
				"package": "@linxin666/dsh-client-ui-skin-trading",
				"order": 8
			},
			{
				"id": "miku",
				"name": "初音未来 · 电子歌姬",
				"nameEn": "Hatsune Miku",
				"author": "涂山苏苏",
				"tagline": "蓝紫双马尾 · 01 编号 · 音符波形 · 电子歌姬主题",
				"description": "以世界第一的虚拟歌姬初音未来为灵感的主题皮肤：蓝紫洋红渐变贯穿全局，音符与声波曲线点缀在半透明面板之间，标题栏与状态栏带有 01 编号徽标与音乐波形，半透明毛玻璃面板透出背景图——沉浸式电子歌姬氛围。",
				"tags": [
					"miku",
					"vocaloid",
					"blue",
					"music",
					"idol",
					"waveform"
				],
				"accent": "#2e9bff",
				"bodyAttr": "data-dsh-miku",
				"package": "@linxin666/dsh-client-ui-skin-miku",
				"order": 9
			},
			{
				"id": "qq2006",
				"name": "QQ2006 经典版",
				"nameEn": "QQ2006 Classic",
				"author": "CCMKCCMK",
				"tagline": "经典蓝色窗口 · 紧凑桌面控件 · 怀旧状态栏",
				"description": "受 QQ2006 桌面客户端启发的轻量皮肤：蓝色渐变标题栏、浅蓝状态栏、紧凑按钮和水晶蓝界面。全部图形由代码绘制，不携带第三方二进制素材。",
				"tags": [
					"retro",
					"qq",
					"2006",
					"classic-blue",
					"nostalgia"
				],
				"accent": "#1677c8",
				"bodyAttr": "data-dsh-qq2006",
				"package": "@linxin666/dsh-client-ui-skin-qq2006",
				"order": 10
			},
			{
				"id": "harbor",
				"name": "夕港",
				"nameEn": "Harbor",
				"author": "moeblack",
				"tagline": "暮光蓝港 · 日落橙辉 · 半透明夜色面板",
				"description": "《夕港》黄昏港口主题：动漫少女黄昏港口背景（暮光蓝天空渐入日落橙）垫在半透明面板之下，遮罩随亮/暗主题实时切换，深暮蓝 #141a2e 底与日落橙 #ff9d5c 主色重映射到 dsh token，亮色是薄暮纱、暗色是深海夜航纱，同一幅画两种读法。",
				"tags": [
					"harbor",
					"dusk",
					"twilight",
					"sunset",
					"amber",
					"art",
					"translucent"
				],
				"accent": "#ff9d5c",
				"bodyAttr": "data-dsh-harbor",
				"package": "@linxin666/dsh-client-ui-skin-harbor",
				"order": 11
			}
		];
		//#endregion
		//#region src/client/manifest.ts
		/**
		* Boot-manifest readiness checks for the one-click apply flow.
		*
		* The host half writes the skin patch synchronously, but the web app's boot
		* graph (the `window.__DSH_BOOT__` JSON inside the served HTML) is
		* regenerated asynchronously by the config watcher. A page reloaded right
		* after the patch write can therefore boot into the previous skin. These
		* helpers let the frontend poll the served document until the manifest
		* actually reflects the target before reloading.
		* @module @linxin666/dsh-client-ui-skin-center/manifest
		*/
		/** Bundle URL pattern of any skin entry in the boot manifest. */
		const SKIN_BUNDLE_URL = /\/plugins\/@linxin666\/dsh-client-ui-skin-(?!center)[a-z0-9-]+\/client\.js/;
		/**
		* Whether a served GUI document's boot manifest enables the given skin.
		* A `null` target means the stock look: no skin bundle URL may be present
		* (the skin-center plugin's own bundle always loads and is excluded).
		* @param documentHtml - the served GUI document (contains the boot JSON).
		* @param target - skin id, or `null` for the stock look.
		* @returns whether the manifest already enables the target.
		*/
		function manifestHasSkin(documentHtml, target) {
			if (target === null) return !SKIN_BUNDLE_URL.test(documentHtml);
			return documentHtml.includes(`/plugins/@linxin666/dsh-client-ui-skin-${target}/client.js`);
		}
		//#endregion
		//#region src/client/try-on.ts
		/**
		* Try-on engine for the in-GUI skin center.
		*
		* A skin's client bundle is executed through the REAL module system, not a
		* shim and not eval: the host route `/api/skin-center/bundle/<id>` serves
		* the skin's prebuilt `lib/client.js` as a same-origin script (mirroring
		* the kernel's own defaultLoadBundle — see dsh-client-modules), and its
		* body calls `window.__ModuleLoader__.load({id, factory})`, which only
		* REGISTERS the factory. `window.__DSH_MODULES__.import(package)` (the
		* kernel's ClientModuleSystem, contract C5/C6) then materializes it — which
		* auto-injects the skin's CSS `<style data-plugin>` tag — and
		* `surface.apply(miniCtx)` mounts the skin exactly as the fiber system
		* would, returning a full disposer. That makes try-on and its teardown the
		* real code paths, with no CSP `unsafe-eval` dependence and no startup
		* cost: the ~700KB of embedded art base64 is only parsed when a skin is
		* actually tried on.
		*
		* Mutual exclusion: the GUI never hosts two skins at once. The currently
		* ACTIVE skin is owned by its own cordis fiber (its disposer is not
		* reachable), so try-on retracts the active skin's visual writes by recipe:
		* remove its body attribute (its stylesheet goes inert), clear the
		* body-level backdrop inline styles (blue-fantasy's whale art), detach only
		* known skin chrome body children (title/status bars marked `data-skin-chrome`
		* or carrying the skin's body attribute, leaving other plugins' portals and
		* toasts in place), and neutralize known global-rule leaks (xp's sidebar
		* taskbar/start). Everything is snapshotted and restored on exit in original
		* order. The active skin's own fiber is never touched, so exiting try-on
		* returns the page to exactly the pre-try-on state.
		*
		* A ghost MutationObserver may survive retraction (blue-fantasy re-writes
		* its backdrop on theme flips), so during try-on a neutralizing observer
		* re-clears the backdrop props whenever `data-ds-dark-theme` changes.
		*/
		/** Body-level backdrop properties skins may write inline (blue-fantasy). */
		const BACKDROP_PROPS = [
			"background-image",
			"background-position",
			"background-size",
			"background-attachment",
			"background-repeat"
		];
		/**
		* Per-skin neutralization CSS: rules that hide visual leaks whose styles
		* are NOT scoped under the skin's body attribute (they live on app elements
		* the skin touches, so detaching chrome cannot remove them). Matched by
		* css-module class substring, which is stable across rebuilds.
		*/
		const NEUTRALIZE_CSS = { xp: [`[data-pane='sidebar'] [class*='xpTaskbar']{background:transparent!important;border-top:none!important;box-shadow:none!important}`, `[data-pane='sidebar'] [class*='xpStart']{display:none!important}`].join("") };
		/** Host base path of the skin bundle route (registered by src/routes.ts). */
		const BUNDLE_ROUTE = "/api/skin-center/bundle";
		/**
		* Execute one skin's client bundle as a real same-origin script, mirroring
		* the kernel's own defaultLoadBundle (dsh-client-modules): the script body
		* calls `window.__ModuleLoader__.load({id, factory})`, which only registers
		* the factory — materialization is the caller's separate `import` step. No
		* eval: try-on works under any CSP that allows same-origin scripts (the
		* shell itself loads plugin bundles this way), and a failed fetch rejects
		* so the caller can restore the active skin instead of leaving it retracted.
		* @param url - same-origin bundle URL.
		* @returns a promise resolving once the script executed.
		*/
		function loadBundleScript(url) {
			return new Promise((resolve, reject) => {
				const el = document.createElement("script");
				el.async = true;
				el.src = url;
				el.addEventListener("load", () => {
					el.remove();
					resolve();
				}, { once: true });
				el.addEventListener("error", () => {
					el.remove();
					reject(/* @__PURE__ */ new Error(`skin-center: bundle script ${url} failed to load`));
				}, { once: true });
				document.head.append(el);
			});
		}
		/** Read the page's composed boot-graph entry ids (only enabled plugins appear). */
		function bootEntryIds() {
			return window.__DSH_BOOT__?.entries?.map((entry) => entry.id) ?? [];
		}
		/** The skin package currently ACTIVE in the boot graph, if it is one of ours. */
		function activeSkinEntry() {
			const ids = new Set(bootEntryIds());
			return SKIN_CENTER_ENTRIES.find((entry) => ids.has(entry.package));
		}
		/**
		* Whether a direct body child is skin chrome owned by `skin`: marked with the
		* `data-skin-chrome` marker (minecraft/dragon-heir) or carrying the skin's
		* scoping body attribute. Everything else — other plugins' portals, toasts and
		* overlays appended to body — is left alone.
		*/
		function isSkinChrome(el, skin) {
			if (el.hasAttribute("data-skin-chrome")) return true;
			return skin !== null && el.hasAttribute(skin.bodyAttr);
		}
		function miniCtx() {
			const disposers = [];
			return {
				effect(callback) {
					disposers.push(callback());
					return () => {};
				},
				get() {},
				__disposeAll() {
					for (const dispose of disposers.reverse()) dispose();
				}
			};
		}
		/**
		* One live try-on session: owns the tried-on skin's disposer plus the
		* captured active-skin visuals, and restores everything on exit.
		*/
		var TryOnController = class {
			session = null;
			/**
			* Generation counter. A newer try-on or exit increments it, so an in-flight
			* `tryOn` (awaiting the real bundle load) can detect it was superseded and
			* drop only what it mounted instead of clobbering the newer session.
			*/
			epoch = 0;
			/**
			* Loads one skin's client bundle so its factory registers on the page's
			* `__ModuleLoader__`. Defaults to a same-origin script tag from the host
			* route `/api/skin-center/bundle/<id>`; tests inject a stub.
			*/
			loadBundle;
			constructor(options = {}) {
				this.loadBundle = options.loadBundle ?? ((entry) => loadBundleScript(`${BUNDLE_ROUTE}/${encodeURIComponent(entry.id)}`));
			}
			/** The skin currently being tried on, if any. */
			get trying() {
				return this.session?.entry ?? null;
			}
			/** Whether the official stock look (no skin) is being tried on. */
			get tryingOfficial() {
				return this.session !== null && this.session.entry === null;
			}
			/** Start trying on `entry` (replaces any live session). */
			async tryOn(entry) {
				if (entry.package === activeSkinEntry()?.package) return;
				this.exit();
				const epoch = ++this.epoch;
				const active = this.captureAndRetractActive();
				let dispose;
				try {
					dispose = await this.loadAndApply(entry);
				} catch (error) {
					if (epoch === this.epoch) this.restoreActive(active);
					throw error;
				}
				if (epoch !== this.epoch) {
					this.cleanupModule(entry);
					dispose();
					return;
				}
				this.session = {
					entry,
					dispose,
					active
				};
			}
			/**
			* Try on the official stock look: retract the active skin's visual writes
			* (same recipe as a skin try-on) and mount nothing. Exiting restores the
			* active skin exactly like any other try-on session.
			*/
			tryOnOfficial() {
				if (activeSkinEntry() === null) return;
				this.exit();
				this.epoch += 1;
				const active = this.captureAndRetractActive();
				this.session = {
					entry: null,
					dispose: () => {},
					active
				};
			}
			/** Exit the live session: dispose the tried-on skin, then restore the active skin. */
			exit() {
				const session = this.session;
				if (session === null) return;
				this.epoch += 1;
				this.session = null;
				session.dispose();
				if (session.entry !== null) this.cleanupModule(session.entry);
				this.restoreActive(session.active);
			}
			/** Execute + materialize + mount the target skin through the real loader. */
			async loadAndApply(entry) {
				const modules = window.__DSH_MODULES__;
				if (modules === void 0) throw new Error("skin-center: window.__DSH_MODULES__ missing");
				modules.invalidate(entry.package);
				await this.loadBundle(entry);
				const apply = (await modules.import(entry.package)).apply;
				if (typeof apply !== "function") throw new Error(`skin-center: "${entry.package}" client bundle exports no apply`);
				const ctx = miniCtx();
				try {
					apply(ctx);
				} catch (error) {
					this.cleanupModule(entry);
					document.body.removeAttribute(entry.bodyAttr);
					for (const el of [...document.body.children]) if (isSkinChrome(el, entry)) el.remove();
					throw error;
				}
				return ctx.__disposeAll;
			}
			/** Drop the tried-on module record + its injected style tag. */
			cleanupModule(entry) {
				window.__DSH_MODULES__?.invalidate(entry.package);
				for (const el of document.querySelectorAll(`style[data-plugin=${JSON.stringify(entry.package)}]`)) el.remove();
			}
			/**
			* Snapshot the active skin's visual writes and retract them so the tried-on
			* skin can take over the whole surface.
			*/
			captureAndRetractActive() {
				const skin = activeSkinEntry() ?? null;
				const body = document.body;
				const bodyAttr = skin === null ? null : body.getAttribute(skin.bodyAttr);
				if (skin !== null && bodyAttr !== null) body.removeAttribute(skin.bodyAttr);
				const bodyStyle = body.getAttribute("style");
				for (const prop of BACKDROP_PROPS) body.style.removeProperty(prop);
				const children = [...body.children];
				const chrome = /* @__PURE__ */ new Set();
				for (const el of children) if (el.id !== "root" && isSkinChrome(el, skin)) chrome.add(el);
				const detached = [];
				for (let i = 0; i < children.length; i++) {
					const el = children[i];
					if (!chrome.has(el)) continue;
					let anchor = null;
					for (let j = i + 1; j < children.length; j++) if (!chrome.has(children[j])) {
						anchor = children[j];
						break;
					}
					detached.push({
						el,
						anchor
					});
				}
				for (const { el } of detached) el.remove();
				const clearObserver = new MutationObserver(() => {
					for (const prop of BACKDROP_PROPS) body.style.removeProperty(prop);
				});
				clearObserver.observe(body, {
					attributes: true,
					attributeFilter: ["data-ds-dark-theme"]
				});
				const neutralizeCss = skin === null ? void 0 : NEUTRALIZE_CSS[skin.id];
				return {
					skin,
					bodyAttr,
					bodyStyle,
					detached,
					clearObserver,
					neutralizeStyle: neutralizeCss === void 0 ? null : this.injectStyle(neutralizeCss)
				};
			}
			/** Restore the active skin's captured visual state. */
			restoreActive(active) {
				const body = document.body;
				if (active.skin !== null && active.bodyAttr !== null) body.setAttribute(active.skin.bodyAttr, active.bodyAttr);
				if (active.bodyStyle !== null) body.setAttribute("style", active.bodyStyle);
				else body.removeAttribute("style");
				for (const { el, anchor } of active.detached) body.insertBefore(el, anchor !== null && anchor.parentNode === body ? anchor : null);
				active.clearObserver?.disconnect();
				active.neutralizeStyle?.remove();
			}
			injectStyle(css) {
				const tag = document.createElement("style");
				tag.dataset.skinCenterNeutralize = "";
				tag.textContent = css;
				document.head.append(tag);
				return tag;
			}
		};
		//#endregion
		//#region \0dsh-css:packages/skins/skin-center/src/client/skin-center.module.css.mjs
		const css = "body[data-dsh-skin-center] .eDzMgW_pluginCard{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}body[data-dsh-skin-center] .eDzMgW_pluginCard:hover{border-color:var(--dsw-alias-label-dimmed)}body[data-dsh-skin-center] .eDzMgW_pluginCardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}body[data-dsh-skin-center] .eDzMgW_cardHeader{appearance:none;width:100%;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}body[data-dsh-skin-center] .eDzMgW_cardHeader:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}body[data-dsh-skin-center] .eDzMgW_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}body[data-dsh-skin-center] .eDzMgW_pluginName{color:var(--dsw-alias-label-primary);align-items:baseline;gap:8px;font-size:15px;font-weight:600;line-height:1.4;display:flex}body[data-dsh-skin-center] .eDzMgW_cardDescription{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}body[data-dsh-skin-center] .eDzMgW_chevron,body[data-dsh-skin-center] .eDzMgW_chevronOpen{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}body[data-dsh-skin-center] .eDzMgW_chevronOpen{transform:rotate(180deg)}body[data-dsh-skin-center] .eDzMgW_cardBody{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:12px;margin:0 16px;padding:12px 0 8px;display:flex}body[data-dsh-skin-center] .eDzMgW_head{flex-direction:column;gap:6px;display:flex}body[data-dsh-skin-center] .eDzMgW_titleBadge{color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px;font-weight:500}body[data-dsh-skin-center] .eDzMgW_intro{color:var(--dsw-alias-label-secondary,#6b7280);font-size:12.5px;line-height:1.55}body[data-dsh-skin-center] .eDzMgW_themeRow{align-items:center;gap:8px;margin-top:2px;display:flex}body[data-dsh-skin-center] .eDzMgW_themeLabel{color:var(--dsw-alias-label-secondary,#6b7280);margin-right:2px;font-size:12px}body[data-dsh-skin-center] .eDzMgW_themeButton{border:1px solid var(--dsw-alias-border-l3,#cbd5e1);background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#172a45);cursor:pointer;border-radius:6px;padding:5px 10px;font-size:12px;line-height:1;transition:background .12s,border-color .12s,color .12s}body[data-dsh-skin-center] .eDzMgW_themeButton:hover{border-color:var(--dsw-alias-border-l4,#94a3b8)}body[data-dsh-skin-center] .eDzMgW_themeButton:active{border-color:var(--dsw-alias-brand-primary,#2b7cd9);background:var(--dsw-alias-button-primary-dimmed,#e8f1fc);color:var(--dsw-alias-brand-primary,#1e63b8)}body[data-dsh-skin-center] .eDzMgW_themeButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2b7cd9);outline-offset:2px}body[data-dsh-skin-center] .eDzMgW_themeButtonActive{border-color:var(--dsw-alias-brand-primary,#2b7cd9);background:var(--dsw-alias-button-primary-dimmed,#e8f1fc);color:var(--dsw-alias-brand-primary,#1e63b8)}body[data-dsh-skin-center] .eDzMgW_list{flex-direction:column;gap:10px;display:flex}body[data-dsh-skin-center] .eDzMgW_card{border:1px solid var(--dsw-alias-border-l1,#e2e8f0);background:var(--dsw-alias-bg-layer-2,#fff);border-radius:10px;flex-direction:column;gap:8px;padding:12px 14px;display:flex}body[data-dsh-skin-center] .eDzMgW_cardHead{align-items:center;gap:10px;min-width:0;display:flex}body[data-dsh-skin-center] .eDzMgW_swatch{width:14px;height:14px;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l4,#0f172a1f);border-radius:50%;flex:none}body[data-dsh-skin-center] .eDzMgW_cardName{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:13.5px;font-weight:600;overflow:hidden}body[data-dsh-skin-center] .eDzMgW_cardTagline{color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;line-height:1.45}body[data-dsh-skin-center] .eDzMgW_badge{letter-spacing:.02em;border-radius:999px;flex:none;min-width:0;margin-left:auto;padding:2px 8px;font-size:11px;font-weight:600}body[data-dsh-skin-center] .eDzMgW_badgeActive{color:var(--dsw-alias-state-success-primary,#0f6b3a);background:var(--dsw-alias-state-success-tertiary,#dcf3e5)}body[data-dsh-skin-center] .eDzMgW_badgeTrying{color:var(--dsw-alias-brand-primary,#1e63b8);background:var(--dsw-alias-button-primary-dimmed,#e2edfc)}body[data-dsh-skin-center] .eDzMgW_actions{flex-wrap:wrap;align-items:center;gap:8px;display:flex}body[data-dsh-skin-center] .eDzMgW_button{border:1px solid var(--dsw-alias-border-l3,#cbd5e1);background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#172a45);cursor:pointer;border-radius:7px;padding:6px 12px;font-size:12px;line-height:1;transition:background .12s,border-color .12s,color .12s}body[data-dsh-skin-center] .eDzMgW_button:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary,#2b7cd9);color:var(--dsw-alias-brand-primary,#1e63b8)}body[data-dsh-skin-center] .eDzMgW_button:active:not(:disabled){border-color:var(--dsw-alias-button-primary-hover,#1e63b8);background:var(--dsw-alias-button-primary-dimmed,#e8f1fc);color:var(--dsw-alias-brand-primary,#1e63b8)}body[data-dsh-skin-center] .eDzMgW_button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2b7cd9);outline-offset:2px}body[data-dsh-skin-center] .eDzMgW_buttonPrimary{border-color:var(--dsw-alias-brand-primary,#2b7cd9);background:var(--dsw-alias-button-primary-fill,#2b7cd9);color:var(--dsw-alias-label-primary-foreground,#fff)}body[data-dsh-skin-center] .eDzMgW_buttonPrimary:hover:not(:disabled){border-color:var(--dsw-alias-button-primary-hover,#1e63b8);background:var(--dsw-alias-button-primary-hover,#1e63b8);color:var(--dsw-alias-label-primary-foreground,#fff)}body[data-dsh-skin-center] .eDzMgW_buttonPrimary:active:not(:disabled),body[data-dsh-skin-center] .eDzMgW_buttonPrimary:focus-visible:not(:disabled){border-color:var(--dsw-alias-button-primary-hover,#1e63b8);background:var(--dsw-alias-button-primary-hover,#1e63b8)}body[data-dsh-skin-center] .eDzMgW_buttonGhost{background:0 0;border-color:#0000}body[data-dsh-skin-center] .eDzMgW_button:disabled{opacity:.55;cursor:default}body[data-dsh-skin-center] .eDzMgW_error{color:var(--dsw-alias-state-error-primary,#b42318);font-size:12px}body[data-dsh-skin-center] .eDzMgW_backgroundRow{flex-direction:column;gap:6px;padding:8px 0;display:flex}body[data-dsh-skin-center] .eDzMgW_backgroundHead{align-items:center;gap:8px;display:flex}body[data-dsh-skin-center] .eDzMgW_backgroundLabel{color:var(--dsw-alias-label-primary,#172a45);font-size:12.5px;font-weight:600}body[data-dsh-skin-center] .eDzMgW_backgroundValue{font-variant-numeric:tabular-nums;color:var(--dsw-alias-brand-primary,#2b7cd9);flex:none;margin-left:auto;font-size:12px}body[data-dsh-skin-center] .eDzMgW_backgroundRange{background:var(--dsw-alias-bg-layer-3,#e2e8f0);-webkit-appearance:none;appearance:none;cursor:pointer;border-radius:999px;width:100%;height:4px;margin:0}body[data-dsh-skin-center] .eDzMgW_backgroundRange::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;border:2px solid var(--dsw-alias-label-primary-foreground,#fff);background:var(--dsw-alias-brand-primary,#2b7cd9);width:14px;height:14px;box-shadow:0 0 0 1px var(--dsw-alias-border-l4,#0f172a1f);cursor:pointer;border-radius:50%}body[data-dsh-skin-center] .eDzMgW_backgroundRange::-moz-range-thumb{border:2px solid var(--dsw-alias-label-primary-foreground,#fff);background:var(--dsw-alias-brand-primary,#2b7cd9);width:12px;height:12px;box-shadow:0 0 0 1px var(--dsw-alias-border-l4,#0f172a1f);cursor:pointer;border-radius:50%}body[data-dsh-skin-center] .eDzMgW_backgroundRange:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2b7cd9);outline-offset:2px}body[data-dsh-skin-center] .eDzMgW_backgroundHint{color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;line-height:1.5}body[data-dsh-skin-center] .eDzMgW_backgroundHintMuted{color:var(--dsw-alias-label-tertiary,#9aa4b5);font-size:12px;line-height:1.5}@media (prefers-reduced-motion:reduce){body[data-dsh-skin-center] .eDzMgW_pluginCard,body[data-dsh-skin-center] .eDzMgW_cardHeader,body[data-dsh-skin-center] .eDzMgW_themeButton,body[data-dsh-skin-center] .eDzMgW_button,body[data-dsh-skin-center] .eDzMgW_chevron,body[data-dsh-skin-center] .eDzMgW_chevronOpen{transition:none}}";
		const tagId = "@linxin666/dsh-client-ui-skin-center/skin-center.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@linxin666/dsh-client-ui-skin-center";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var skin_center_module_css_default = {
			"actions": "eDzMgW_actions",
			"backgroundHead": "eDzMgW_backgroundHead",
			"backgroundHint": "eDzMgW_backgroundHint",
			"backgroundHintMuted": "eDzMgW_backgroundHintMuted",
			"backgroundLabel": "eDzMgW_backgroundLabel",
			"backgroundRange": "eDzMgW_backgroundRange",
			"backgroundRow": "eDzMgW_backgroundRow",
			"backgroundValue": "eDzMgW_backgroundValue",
			"badge": "eDzMgW_badge",
			"badgeActive": "eDzMgW_badgeActive",
			"badgeTrying": "eDzMgW_badgeTrying",
			"button": "eDzMgW_button",
			"buttonGhost": "eDzMgW_buttonGhost",
			"buttonPrimary": "eDzMgW_buttonPrimary",
			"card": "eDzMgW_card",
			"cardBody": "eDzMgW_cardBody",
			"cardDescription": "eDzMgW_cardDescription",
			"cardHead": "eDzMgW_cardHead",
			"cardHeader": "eDzMgW_cardHeader",
			"cardName": "eDzMgW_cardName",
			"cardTagline": "eDzMgW_cardTagline",
			"chevron": "eDzMgW_chevron",
			"chevronOpen": "eDzMgW_chevronOpen",
			"error": "eDzMgW_error",
			"head": "eDzMgW_head",
			"headText": "eDzMgW_headText",
			"intro": "eDzMgW_intro",
			"list": "eDzMgW_list",
			"pluginCard": "eDzMgW_pluginCard",
			"pluginCardOpen": "eDzMgW_pluginCardOpen",
			"pluginName": "eDzMgW_pluginName",
			"swatch": "eDzMgW_swatch",
			"themeButton": "eDzMgW_themeButton",
			"themeButtonActive": "eDzMgW_themeButtonActive",
			"themeLabel": "eDzMgW_themeLabel",
			"themeRow": "eDzMgW_themeRow",
			"titleBadge": "eDzMgW_titleBadge"
		};
		//#endregion
		//#region src/client/SkinCenter.tsx
		/**
		* The skin-center plugin card: one disclosure card inside the Web UI plugin
		* group (插件配置 → Web UI 插件), listing every installed skin plus the
		* official stock look. Live try-on executes the real bundle inside the GUI
		* (light/dark preview, full restore on exit); Apply is one click — the host
		* half runs `dsh-skin use` through /api/skin-center/apply, the config
		* watcher hot-reloads the patch, and the page reloads into the new skin.
		* Copy rides the standard `t` seat; the theme preview control drives the
		* official theme service (persisted, same as the Appearance row).
		*/
		/** The apply target of the official stock-look card. */
		const OFFICIAL = "official";
		/** Skin ids that read the background-scrim variable and paint a backdrop. */
		const BACKDROP_SKIN_IDS = /* @__PURE__ */ new Set(["blue-fantasy", "whale-song"]);
		/**
		* Render the skin-center card: a disclosure header naming the plugin, with
		* the skin list (official default + every installed skin; try-on / theme
		* preview / one-click apply) inside its body.
		* @param props - card props.
		* @returns the plugin card.
		*/
		function SkinCenter({ t, controller, theme, background }) {
			const snapshot = (0, react.useSyncExternalStore)(theme.subscribe, theme.getTheme);
			const opacity = (0, react.useSyncExternalStore)(background.subscribe, background.opacity);
			const activePackage = activeSkinEntry()?.package;
			const activeId = activeSkinEntry()?.id;
			const backdropActive = activeId !== void 0 && BACKDROP_SKIN_IDS.has(activeId);
			const [open, setOpen] = (0, react.useState)(false);
			const [tryingId, setTryingId] = (0, react.useState)(null);
			const [tryingOfficial, setTryingOfficial] = (0, react.useState)(false);
			const [applying, setApplying] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const mounted = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			const tryOn = (entry) => {
				setError(null);
				controller.tryOn(entry).then(() => {
					setTryingId(entry.id);
					setTryingOfficial(false);
				}).catch(() => {
					setError(t("tryOnError"));
					setTryingId(null);
					setTryingOfficial(false);
				});
			};
			const tryOnOfficial = () => {
				setError(null);
				try {
					controller.tryOnOfficial();
				} catch {
					setError(t("tryOnError"));
					setTryingOfficial(false);
					return;
				}
				setTryingId(null);
				setTryingOfficial(true);
			};
			const exitTryOn = () => {
				controller.exit();
				setTryingId(null);
				setTryingOfficial(false);
			};
			/**
			* Poll the host state until the config watcher reports the target active
			* (the patch write lands before the watcher re-applies it), or time out.
			* @param target - skin id, or `official` for the stock look.
			* @returns whether the target became active within the poll budget.
			*/
			const confirmActive = (target) => new Promise((resolve) => {
				const expected = target === OFFICIAL ? "none" : target;
				let tries = 0;
				const tick = () => {
					if (!mounted.current) {
						resolve(false);
						return;
					}
					tries += 1;
					fetch("/api/skin-center/state").then(async (response) => {
						const payload = await response.json().catch(() => null);
						if (response.ok && payload?.ok === true && payload.active === expected) {
							resolve(true);
							return;
						}
						if (tries >= 20 || !mounted.current) resolve(false);
						else window.setTimeout(tick, 250);
					}).catch(() => {
						if (tries >= 20 || !mounted.current) resolve(false);
						else window.setTimeout(tick, 250);
					});
				};
				tick();
			});
			/**
			* Poll the served GUI document until the boot manifest actually enables
			* the target (the config watcher regenerates it asynchronously after the
			* patch write — reloading earlier boots the page into the previous skin),
			* or time out.
			* @param target - skin id, or `official` for the stock look.
			* @returns whether the manifest caught up within the poll budget.
			*/
			const manifestReady = (target) => new Promise((resolve) => {
				const expected = target === OFFICIAL ? null : target;
				let tries = 0;
				const tick = () => {
					if (!mounted.current) {
						resolve(false);
						return;
					}
					tries += 1;
					fetch(window.location.href, { cache: "no-store" }).then(async (response) => {
						const html = await response.text().catch(() => null);
						if (html !== null && manifestHasSkin(html, expected)) {
							resolve(true);
							return;
						}
						if (tries >= 40 || !mounted.current) resolve(false);
						else window.setTimeout(tick, 500);
					}).catch(() => {
						if (tries >= 40 || !mounted.current) resolve(false);
						else window.setTimeout(tick, 500);
					});
				};
				tick();
			});
			/**
			* One-click apply: the host half runs `dsh-skin use <target>` (or
			* `use official`), the config watcher hot-reloads the patch within
			* seconds, then this page reloads to pick up the new boot graph. The
			* reload waits for both the patch (state poll) and the regenerated boot
			* manifest (manifest poll) so the page never boots into the old skin.
			* @param target - skin id, or `official` for the stock look.
			*/
			const applySkin = (target) => {
				setError(null);
				setApplying(target);
				fetch("/api/skin-center/apply", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(target === OFFICIAL ? { official: true } : { skin: target })
				}).then(async (response) => {
					const payload = await response.json().catch(() => null);
					if (!response.ok || payload?.ok !== true) throw new Error(payload?.error ?? `HTTP ${response.status}`);
					setApplying(null);
					confirmActive(target).then((confirmed) => {
						if (!mounted.current) return;
						if (!confirmed) {
							const command = target === OFFICIAL ? "dsh-skin use official" : `dsh-skin use ${target}`;
							setError(`${t("appliedUnconfirmed")} — ${command}`);
							return;
						}
						manifestReady(target).then((ready) => {
							if (!mounted.current) return;
							if (ready) window.location.reload();
							else {
								const command = target === OFFICIAL ? "dsh-skin use official" : `dsh-skin use ${target}`;
								setError(`${t("appliedUnconfirmed")} — ${command}`);
							}
						});
					});
				}).catch((cause) => {
					setApplying(null);
					const detail = cause instanceof Error ? cause.message : String(cause);
					const command = target === OFFICIAL ? "dsh-skin use official" : `dsh-skin use ${target}`;
					setError(`${t("applyFailed")} (${detail}) — ${command}`);
				});
			};
			const dark = snapshot.active.colorScheme === "dark";
			/** One row: try-on control + apply button. Shared by the official card and every skin card. */
			const actionButtons = (opts) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: skin_center_module_css_default.actions,
				children: [opts.isActive ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: `${skin_center_module_css_default.button} ${skin_center_module_css_default.buttonGhost}`,
					disabled: true,
					children: t("tryOn")
				}) : opts.isTrying ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: `${skin_center_module_css_default.button} ${skin_center_module_css_default.buttonPrimary}`,
					onClick: exitTryOn,
					children: t("exitTryOn")
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: `${skin_center_module_css_default.button} ${skin_center_module_css_default.buttonPrimary}`,
					onClick: opts.onTryOn,
					children: t("tryOn")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: skin_center_module_css_default.button,
					disabled: applying !== null,
					onClick: () => {
						applySkin(opts.key);
					},
					children: applying === opts.key ? t("applying") : opts.applyLabel
				})]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: open ? `${skin_center_module_css_default.pluginCard} ${skin_center_module_css_default.pluginCardOpen}` : skin_center_module_css_default.pluginCard,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: skin_center_module_css_default.cardHeader,
					"aria-expanded": open,
					"aria-label": `${t(open ? "collapse" : "expand")}: ${t("title")}`,
					onClick: () => {
						setOpen((current) => !current);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: skin_center_module_css_default.headText,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: skin_center_module_css_default.pluginName,
							children: [t("title"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: skin_center_module_css_default.titleBadge,
								children: String(SKIN_CENTER_ENTRIES.length)
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: skin_center_module_css_default.cardDescription,
							title: t("cardDescription"),
							children: t("cardDescription")
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
						width: "14",
						height: "14",
						viewBox: "0 0 14 14",
						fill: "none",
						xmlns: "http://www.w3.org/2000/svg",
						className: open ? `${skin_center_module_css_default.chevron} ${skin_center_module_css_default.chevronOpen}` : skin_center_module_css_default.chevron,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
							d: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z",
							fill: "currentColor"
						})
					})]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: skin_center_module_css_default.cardBody,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: skin_center_module_css_default.head,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: skin_center_module_css_default.intro,
								title: t("intro"),
								children: t("intro")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: skin_center_module_css_default.themeRow,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: skin_center_module_css_default.themeLabel,
										children: t("theme")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: `${skin_center_module_css_default.themeButton} ${dark ? "" : skin_center_module_css_default.themeButtonActive}`,
										onClick: () => {
											theme.setTheme("light");
										},
										children: t("themeLight")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: `${skin_center_module_css_default.themeButton} ${dark ? skin_center_module_css_default.themeButtonActive : ""}`,
										onClick: () => {
											theme.setTheme("dark");
										},
										children: t("themeDark")
									})
								]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: skin_center_module_css_default.backgroundRow,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: skin_center_module_css_default.backgroundHead,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: skin_center_module_css_default.backgroundLabel,
										children: t("backgroundOpacity")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: skin_center_module_css_default.backgroundValue,
										"aria-hidden": "true",
										children: [opacity, "%"]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									id: "skin-center-background-opacity",
									className: skin_center_module_css_default.backgroundRange,
									type: "range",
									min: "0",
									max: "100",
									step: "5",
									value: opacity,
									"aria-valuetext": `${opacity}%`,
									"aria-label": t("backgroundOpacity"),
									onChange: (event) => {
										background.set(Number(event.target.value));
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: backdropActive ? skin_center_module_css_default.backgroundHint : skin_center_module_css_default.backgroundHintMuted,
									children: backdropActive ? t("backgroundHint") : t("backgroundHintInert")
								})
							]
						}),
						error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: skin_center_module_css_default.error,
							children: error
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: skin_center_module_css_default.list,
							children: [(() => {
								const isActive = activePackage === void 0;
								const isTrying = tryingOfficial;
								const badge = isActive ? t("active") : isTrying ? t("tryingOn") : null;
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: skin_center_module_css_default.card,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: skin_center_module_css_default.cardHead,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: skin_center_module_css_default.swatch,
													style: { background: "#98a1ab" },
													"aria-hidden": "true"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: skin_center_module_css_default.cardName,
													title: t("official"),
													children: t("official")
												}),
												badge !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: `${skin_center_module_css_default.badge} ${isActive ? skin_center_module_css_default.badgeActive : skin_center_module_css_default.badgeTrying}`,
													children: badge
												})
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: skin_center_module_css_default.cardTagline,
											title: t("officialTagline"),
											children: t("officialTagline")
										}),
										actionButtons({
											key: OFFICIAL,
											isActive,
											isTrying,
											onTryOn: tryOnOfficial,
											applyLabel: t("restore")
										})
									]
								}, OFFICIAL);
							})(), SKIN_CENTER_ENTRIES.map((entry) => {
								const isActive = entry.package === activePackage;
								const isTrying = entry.id === tryingId;
								const badge = isActive ? t("active") : isTrying ? t("tryingOn") : null;
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: skin_center_module_css_default.card,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: skin_center_module_css_default.cardHead,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: skin_center_module_css_default.swatch,
													style: { background: entry.accent },
													"aria-hidden": "true"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: skin_center_module_css_default.cardName,
													title: entry.nameEn,
													children: entry.nameEn
												}),
												badge !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: `${skin_center_module_css_default.badge} ${isActive ? skin_center_module_css_default.badgeActive : skin_center_module_css_default.badgeTrying}`,
													children: badge
												})
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: skin_center_module_css_default.cardTagline,
											title: entry.tagline,
											children: entry.tagline
										}),
										actionButtons({
											key: entry.id,
											isActive,
											isTrying,
											onTryOn: () => {
												tryOn(entry);
											},
											applyLabel: t("apply")
										})
									]
								}, entry.id);
							})]
						})
					]
				}) : null]
			});
		}
		//#endregion
		//#region src/client/background.ts
		/** The namespace string the Host registers (mirrors src/index.ts). */
		const SKIN_BACKGROUND_NS = "skin-background";
		/** Field of the background value inside the namespace section. */
		const OPACITY_FIELD = "backgroundOpacity";
		/** CSS custom property written to document.body and read by backdrop skins. */
		const SCRIM_VAR = "--dsw-skin-scrim";
		/**
		* Own the skin-background scope: read the latest occlusion, apply it to the
		* body CSS variable instantly, and persist changes through the settings scope.
		*/
		var BackgroundController = class {
			value = 0;
			listeners = /* @__PURE__ */ new Set();
			scope;
			/**
			* @param scope - the bound skin-background settings scope.
			*/
			constructor(scope) {
				this.scope = scope;
				this.value = this.read();
				this.apply();
				scope.subscribe(() => {
					this.value = this.read();
					this.apply();
					this.publish();
				});
			}
			opacity() {
				return this.value;
			}
			subscribe(listener) {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			}
			set(opacity) {
				const clamped = Math.max(0, Math.min(100, Math.round(opacity)));
				this.value = clamped;
				this.apply();
				this.publish();
				this.scope.set(OPACITY_FIELD, clamped);
			}
			/** The effective section value, clamped 0-100, defaulting to 0. */
			read() {
				const raw = this.scope.getSnapshot().value?.backgroundOpacity;
				if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
				return Math.max(0, Math.min(100, raw));
			}
			/** Write the current occlusion onto the body CSS variable (0..1 alpha). */
			apply() {
				document.body.style.setProperty(SCRIM_VAR, String(this.value / 100));
			}
			publish() {
				for (const listener of this.listeners) listener();
			}
		};
		//#endregion
		//#region src/client/locales.ts
		const en = {
			title: "Skin Center",
			cardDescription: "Try on any installed skin live in the GUI — exit restores instantly, applying persists in one click.",
			expand: "Expand",
			collapse: "Collapse",
			intro: "Try on any skin live — it takes effect instantly, exit restores the current look. Apply persists it across restarts.",
			official: "Official default",
			officialTagline: "The stock DSH look with no skin applied.",
			active: "Active",
			tryingOn: "Trying on",
			tryOn: "Try on",
			exitTryOn: "Exit try-on",
			apply: "Apply",
			applying: "Applying…",
			restore: "Restore",
			applyFailed: "Apply failed",
			appliedUnconfirmed: "Applied, but the change has not been confirmed — refresh the page if the skin did not switch",
			theme: "Theme preview",
			themeLight: "Light",
			themeDark: "Dark",
			tryOnError: "Try-on failed — see console",
			backgroundOpacity: "Background occlusion",
			backgroundHint: "Instantly veils the backdrop behind the panels — higher values obscure the art to help you focus.",
			backgroundHintInert: "Only applies to skins that paint a backdrop (Blue Fantasy / Whale Song). Applies to the official default automatically once such a skin is active."
		};
		const zh = {
			title: "皮肤中心",
			cardDescription: "在 GUI 内即时试穿任意皮肤，退出即完全还原；应用一键完成并自动刷新。",
			expand: "展开",
			collapse: "收起",
			intro: "任意皮肤可即时试穿，退出即完全还原；「应用」一键持久化，页面自动刷新生效。",
			official: "官方默认",
			officialTagline: "还原 DSH 官方默认外观，不应用任何皮肤。",
			active: "当前激活",
			tryingOn: "试穿中",
			tryOn: "试穿",
			exitTryOn: "退出试穿",
			apply: "应用",
			applying: "应用中…",
			restore: "恢复默认",
			applyFailed: "应用失败",
			appliedUnconfirmed: "已写入配置但尚未确认生效——若皮肤未切换请手动刷新页面",
			theme: "主题预览",
			themeLight: "亮色",
			themeDark: "暗色",
			tryOnError: "试穿失败，详见控制台",
			backgroundOpacity: "背景遮挡",
			backgroundHint: "即时为面板背后的背景加遮罩——数值越高越能弱化插画，帮你集中注意力。",
			backgroundHintInert: "仅对带背景图插画的皮肤（蓝色幻想 / 鲸吟）生效；官方默认无背景图，该滑块对这些皮肤自动生效。"
		};
		//#endregion
		//#region src/client/index.ts
		/** Locale namespace owned by this plugin. */
		const NS = "skinCenter";
		/** Required services: slots + locale (plugin card), theme (preview toggle), and settingsScope + its transport (background scrim). */
		const inject = [
			"slots",
			"locale",
			"theme",
			"settingsScope",
			"connection",
			"remote"
		];
		/**
		* Register the skin-center dictionaries, the body scope attribute, and the
		* Skins plugin card inside the Web UI plugin group.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-skin-center: dictionaries");
			ctx.effect(() => {
				document.body.dataset.dshSkinCenter = "";
				return () => {
					delete document.body.dataset.dshSkinCenter;
				};
			}, "ui-skin-center: body scope");
			const theme = ctx.get("theme");
			const controller = new TryOnController();
			const background = new BackgroundController((ctx.get("webUiSettings") ?? ctx.settingsScope).bind({ namespace: SKIN_BACKGROUND_NS }));
			const injected = () => ({
				controller,
				theme: {
					getTheme: () => theme.getTheme(),
					subscribe: (listener) => ctx.on("theme/change", listener),
					setTheme: (id) => theme.setTheme(id)
				},
				background: {
					opacity: () => background.opacity(),
					subscribe: (listener) => background.subscribe(listener),
					set: (opacity) => background.set(opacity)
				}
			});
			ctx.slots.inject("web-ui.plugin.item", () => ctx.slots.register({
				name: "web-ui.plugin.item",
				id: "skins",
				order: 110,
				locale: NS,
				inject: injected
			}, SkinCenter));
		}
		//#endregion
		exports.NS = NS;
		exports.TryOnController = TryOnController;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map