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
			}
		];
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
		//#region \0dsh-css:/home/lzk22/dsh插件/worktrees/dsh-web-ui-trading/packages/skins/skin-center/src/client/skin-center.module.css.mjs
		const css = "body[data-dsh-skin-center] .N1Pa-G_pluginCard{border:1px solid var(--dsw-alias-border-l1,#e2e8f0);background:var(--dsw-alias-bg-layer-2,#fff);border-radius:8px;list-style:none;overflow:hidden}body[data-dsh-skin-center] .N1Pa-G_cardHeader{width:100%;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;align-items:center;padding:11px 14px;transition:background .12s;display:flex}body[data-dsh-skin-center] .N1Pa-G_cardHeader:hover{background:var(--dsw-alias-bg-layer-1,#f1f5f9)}body[data-dsh-skin-center] .N1Pa-G_cardHeader:active{background:var(--dsw-alias-bg-layer-3,#e6ecf4)}body[data-dsh-skin-center] .N1Pa-G_cardHeader:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2b7cd9);outline-offset:2px}body[data-dsh-skin-center] .N1Pa-G_headText{flex-direction:column;flex:1;gap:3px;min-width:0;display:flex}body[data-dsh-skin-center] .N1Pa-G_pluginName{color:var(--dsw-alias-label-primary,#172a45);align-items:baseline;gap:8px;font-size:13.5px;font-weight:600;display:flex}body[data-dsh-skin-center] .N1Pa-G_cardDescription{color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;line-height:1.4}body[data-dsh-skin-center] .N1Pa-G_chevron,body[data-dsh-skin-center] .N1Pa-G_chevronOpen{color:var(--dsw-alias-label-secondary,#6b7280);flex:none;margin-left:10px;font-size:12px;transition:transform .12s}body[data-dsh-skin-center] .N1Pa-G_chevronOpen{transform:rotate(180deg)}body[data-dsh-skin-center] .N1Pa-G_cardBody{border-top:1px solid var(--dsw-alias-border-l1,#e2e8f0);flex-direction:column;gap:12px;padding:12px 14px 14px;display:flex}body[data-dsh-skin-center] .N1Pa-G_head{flex-direction:column;gap:6px;display:flex}body[data-dsh-skin-center] .N1Pa-G_titleBadge{color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px;font-weight:500}body[data-dsh-skin-center] .N1Pa-G_intro{color:var(--dsw-alias-label-secondary,#6b7280);font-size:12.5px;line-height:1.55}body[data-dsh-skin-center] .N1Pa-G_themeRow{align-items:center;gap:8px;margin-top:2px;display:flex}body[data-dsh-skin-center] .N1Pa-G_themeLabel{color:var(--dsw-alias-label-secondary,#6b7280);margin-right:2px;font-size:12px}body[data-dsh-skin-center] .N1Pa-G_themeButton{border:1px solid var(--dsw-alias-border-l3,#cbd5e1);background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#172a45);cursor:pointer;border-radius:6px;padding:5px 10px;font-size:12px;line-height:1;transition:background .12s,border-color .12s,color .12s}body[data-dsh-skin-center] .N1Pa-G_themeButton:hover{border-color:var(--dsw-alias-border-l4,#94a3b8)}body[data-dsh-skin-center] .N1Pa-G_themeButton:active{border-color:var(--dsw-alias-brand-primary,#2b7cd9);background:var(--dsw-alias-button-primary-dimmed,#e8f1fc);color:var(--dsw-alias-brand-primary,#1e63b8)}body[data-dsh-skin-center] .N1Pa-G_themeButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2b7cd9);outline-offset:2px}body[data-dsh-skin-center] .N1Pa-G_themeButtonActive{border-color:var(--dsw-alias-brand-primary,#2b7cd9);background:var(--dsw-alias-button-primary-dimmed,#e8f1fc);color:var(--dsw-alias-brand-primary,#1e63b8)}body[data-dsh-skin-center] .N1Pa-G_list{flex-direction:column;gap:10px;display:flex}body[data-dsh-skin-center] .N1Pa-G_card{border:1px solid var(--dsw-alias-border-l1,#e2e8f0);background:var(--dsw-alias-bg-layer-2,#fff);border-radius:10px;flex-direction:column;gap:8px;padding:12px 14px;display:flex}body[data-dsh-skin-center] .N1Pa-G_cardHead{align-items:center;gap:10px;min-width:0;display:flex}body[data-dsh-skin-center] .N1Pa-G_swatch{width:14px;height:14px;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l4,#0f172a1f);border-radius:50%;flex:none}body[data-dsh-skin-center] .N1Pa-G_cardName{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:13.5px;font-weight:600;overflow:hidden}body[data-dsh-skin-center] .N1Pa-G_cardTagline{color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;line-height:1.45}body[data-dsh-skin-center] .N1Pa-G_badge{letter-spacing:.02em;border-radius:999px;flex:none;min-width:0;margin-left:auto;padding:2px 8px;font-size:11px;font-weight:600}body[data-dsh-skin-center] .N1Pa-G_badgeActive{color:var(--dsw-alias-state-success-primary,#0f6b3a);background:var(--dsw-alias-state-success-tertiary,#dcf3e5)}body[data-dsh-skin-center] .N1Pa-G_badgeTrying{color:var(--dsw-alias-brand-primary,#1e63b8);background:var(--dsw-alias-button-primary-dimmed,#e2edfc)}body[data-dsh-skin-center] .N1Pa-G_actions{flex-wrap:wrap;align-items:center;gap:8px;display:flex}body[data-dsh-skin-center] .N1Pa-G_button{border:1px solid var(--dsw-alias-border-l3,#cbd5e1);background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#172a45);cursor:pointer;border-radius:7px;padding:6px 12px;font-size:12px;line-height:1;transition:background .12s,border-color .12s,color .12s}body[data-dsh-skin-center] .N1Pa-G_button:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary,#2b7cd9);color:var(--dsw-alias-brand-primary,#1e63b8)}body[data-dsh-skin-center] .N1Pa-G_button:active:not(:disabled){border-color:var(--dsw-alias-button-primary-hover,#1e63b8);background:var(--dsw-alias-button-primary-dimmed,#e8f1fc);color:var(--dsw-alias-brand-primary,#1e63b8)}body[data-dsh-skin-center] .N1Pa-G_button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2b7cd9);outline-offset:2px}body[data-dsh-skin-center] .N1Pa-G_buttonPrimary{border-color:var(--dsw-alias-brand-primary,#2b7cd9);background:var(--dsw-alias-button-primary-fill,#2b7cd9);color:var(--dsw-alias-label-primary-foreground,#fff)}body[data-dsh-skin-center] .N1Pa-G_buttonPrimary:hover:not(:disabled){border-color:var(--dsw-alias-button-primary-hover,#1e63b8);background:var(--dsw-alias-button-primary-hover,#1e63b8);color:var(--dsw-alias-label-primary-foreground,#fff)}body[data-dsh-skin-center] .N1Pa-G_buttonPrimary:active:not(:disabled),body[data-dsh-skin-center] .N1Pa-G_buttonPrimary:focus-visible:not(:disabled){border-color:var(--dsw-alias-button-primary-hover,#1e63b8);background:var(--dsw-alias-button-primary-hover,#1e63b8)}body[data-dsh-skin-center] .N1Pa-G_buttonGhost{background:0 0;border-color:#0000}body[data-dsh-skin-center] .N1Pa-G_button:disabled{opacity:.55;cursor:default}body[data-dsh-skin-center] .N1Pa-G_error{color:var(--dsw-alias-state-error-primary,#b42318);font-size:12px}@media (prefers-reduced-motion:reduce){body[data-dsh-skin-center] .N1Pa-G_cardHeader,body[data-dsh-skin-center] .N1Pa-G_themeButton,body[data-dsh-skin-center] .N1Pa-G_button,body[data-dsh-skin-center] .N1Pa-G_chevron,body[data-dsh-skin-center] .N1Pa-G_chevronOpen{transition:none}}";
		const tagId = "@linxin666/dsh-client-ui-skin-center/skin-center.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@linxin666/dsh-client-ui-skin-center";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var skin_center_module_css_default = {
			"actions": "N1Pa-G_actions",
			"badge": "N1Pa-G_badge",
			"badgeActive": "N1Pa-G_badgeActive",
			"badgeTrying": "N1Pa-G_badgeTrying",
			"button": "N1Pa-G_button",
			"buttonGhost": "N1Pa-G_buttonGhost",
			"buttonPrimary": "N1Pa-G_buttonPrimary",
			"card": "N1Pa-G_card",
			"cardBody": "N1Pa-G_cardBody",
			"cardDescription": "N1Pa-G_cardDescription",
			"cardHead": "N1Pa-G_cardHead",
			"cardHeader": "N1Pa-G_cardHeader",
			"cardName": "N1Pa-G_cardName",
			"cardTagline": "N1Pa-G_cardTagline",
			"chevron": "N1Pa-G_chevron",
			"chevronOpen": "N1Pa-G_chevronOpen",
			"error": "N1Pa-G_error",
			"head": "N1Pa-G_head",
			"headText": "N1Pa-G_headText",
			"intro": "N1Pa-G_intro",
			"list": "N1Pa-G_list",
			"pluginCard": "N1Pa-G_pluginCard",
			"pluginName": "N1Pa-G_pluginName",
			"swatch": "N1Pa-G_swatch",
			"themeButton": "N1Pa-G_themeButton",
			"themeButtonActive": "N1Pa-G_themeButtonActive",
			"themeLabel": "N1Pa-G_themeLabel",
			"themeRow": "N1Pa-G_themeRow",
			"titleBadge": "N1Pa-G_titleBadge"
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
		/**
		* Render the skin-center card: a disclosure header naming the plugin, with
		* the skin list (official default + every installed skin; try-on / theme
		* preview / one-click apply) inside its body.
		* @param props - card props.
		* @returns the plugin card.
		*/
		function SkinCenter({ t, controller, theme }) {
			const snapshot = (0, react.useSyncExternalStore)(theme.subscribe, theme.getTheme);
			const activePackage = activeSkinEntry()?.package;
			const [open, setOpen] = (0, react.useState)(false);
			const [tryingId, setTryingId] = (0, react.useState)(null);
			const [tryingOfficial, setTryingOfficial] = (0, react.useState)(false);
			const [applying, setApplying] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
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
					tries += 1;
					fetch("/api/skin-center/state").then(async (response) => {
						const payload = await response.json().catch(() => null);
						if (response.ok && payload?.ok === true && payload.active === expected) {
							resolve(true);
							return;
						}
						if (tries >= 20) resolve(false);
						else window.setTimeout(tick, 250);
					}).catch(() => {
						if (tries >= 20) resolve(false);
						else window.setTimeout(tick, 250);
					});
				};
				tick();
			});
			/**
			* One-click apply: the host half runs `dsh-skin use <target>` (or
			* `use official`), the config watcher hot-reloads the patch within
			* seconds, then this page reloads to pick up the new boot graph.
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
						if (confirmed) window.location.reload();
						else {
							const command = target === OFFICIAL ? "dsh-skin use official" : `dsh-skin use ${target}`;
							setError(`${t("appliedUnconfirmed")} — ${command}`);
						}
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
				className: skin_center_module_css_default.pluginCard,
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
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: open ? skin_center_module_css_default.chevronOpen : skin_center_module_css_default.chevron,
						children: "▾"
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
			tryOnError: "Try-on failed — see console"
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
			tryOnError: "试穿失败，详见控制台"
		};
		//#endregion
		//#region src/client/index.ts
		/** Locale namespace owned by this plugin. */
		const NS = "skinCenter";
		/** Required services: slots + locale (plugin card) and theme (preview toggle). */
		const inject = [
			"slots",
			"locale",
			"theme"
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
			const injected = () => ({
				controller,
				theme: {
					getTheme: () => theme.getTheme(),
					subscribe: (listener) => ctx.on("theme/change", listener),
					setTheme: (id) => theme.setTheme(id)
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