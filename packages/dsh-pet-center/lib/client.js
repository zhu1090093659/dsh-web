window.__ModuleLoader__.load({
	id: "@linxin666/dsh-client-ui-pet-center",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:D:\dsh-web-ui\packages\dsh-pet-center\src\client\pet-center.module.css.mjs
		const css = ".iuFXGG_card{list-style:none}.iuFXGG_header{cursor:pointer;text-align:left;width:100%;color:inherit;background:0 0;border:none;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;display:flex}.iuFXGG_headText{flex-direction:column;gap:2px;display:flex}.iuFXGG_name{font-weight:600}.iuFXGG_description{opacity:.7;font-size:12px}.iuFXGG_chevron{transition:transform .12s}.iuFXGG_chevronOpen{transition:transform .12s;transform:rotate(180deg)}.iuFXGG_pending{color:#d97706;font-size:11px}.iuFXGG_body{padding:4px 12px 12px}.iuFXGG_intro{opacity:.75;margin:0 0 10px;font-size:12px}.iuFXGG_list{flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;display:flex}.iuFXGG_item{border:1px solid #94a3b859;border-radius:10px;align-items:center;gap:10px;padding:8px 10px;display:flex}.iuFXGG_itemActive{background:#38bdf814;border-color:#38bdf8}.iuFXGG_itemTrying{background:#f59e0b14;border-color:#f59e0b}.iuFXGG_meta{flex:1;min-width:0}.iuFXGG_itemName{font-weight:600}.iuFXGG_itemTagline{opacity:.7;font-size:12px}.iuFXGG_badge{white-space:nowrap;border-radius:999px;padding:1px 8px;font-size:11px}.iuFXGG_badgeActive{color:#fff;background:#38bdf8}.iuFXGG_badgeTrying{color:#fff;background:#f59e0b}.iuFXGG_actions{gap:6px;display:flex}.iuFXGG_action{cursor:pointer;color:#0f172a;background:linear-gradient(#7dd3fc,#38bdf8);border:none;border-radius:6px;padding:4px 10px;font-size:12px;transition:filter .12s}.iuFXGG_action:hover{filter:brightness(1.08)}.iuFXGG_action:disabled{opacity:.5;cursor:not-allowed}@media (prefers-reduced-motion:reduce){.iuFXGG_action{transition:none}}";
		const tagId = "@linxin666/dsh-client-ui-pet-center/pet-center.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@linxin666/dsh-client-ui-pet-center";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var pet_center_module_css_default = {
			"action": "iuFXGG_action",
			"actions": "iuFXGG_actions",
			"badge": "iuFXGG_badge",
			"badgeActive": "iuFXGG_badgeActive",
			"badgeTrying": "iuFXGG_badgeTrying",
			"body": "iuFXGG_body",
			"card": "iuFXGG_card",
			"chevron": "iuFXGG_chevron",
			"chevronOpen": "iuFXGG_chevronOpen",
			"description": "iuFXGG_description",
			"headText": "iuFXGG_headText",
			"header": "iuFXGG_header",
			"intro": "iuFXGG_intro",
			"item": "iuFXGG_item",
			"itemActive": "iuFXGG_itemActive",
			"itemName": "iuFXGG_itemName",
			"itemTagline": "iuFXGG_itemTagline",
			"itemTrying": "iuFXGG_itemTrying",
			"list": "iuFXGG_list",
			"meta": "iuFXGG_meta",
			"name": "iuFXGG_name",
			"pending": "iuFXGG_pending"
		};
		//#endregion
		//#region src/client/PetCenter.tsx
		/**
		* The pet-center plugin card: one disclosure card inside the Web UI plugin
		* group (插件配置 → Web UI 插件 → 宠物中心), listing the two pet companions
		* (the original whale and the introduced whale maid). Try-on switches the
		* active pet live and can be reverted; Apply persists the choice. Both go
		* through the host /api/pet-center API, which rewrites the managed pet
		* section of ~/.dsh/cordis.patch.yml; the config watcher hot-reloads it
		* within seconds and a page refresh lands on the new pet.
		*/
		/** The pets the center can switch between. */
		const PET_OPTIONS = [{
			id: "pet",
			titleKey: "original",
			taglineKey: "originalTagline"
		}, {
			id: "pet-maid",
			titleKey: "introduced",
			taglineKey: "introducedTagline"
		}];
		/** Poll `active` until the host reports the target, or time out. */
		function confirmActive(target, budgetMs = 5e3) {
			return new Promise((resolve) => {
				const start = Date.now();
				const tick = () => {
					fetch("/api/pet-center/state").then(async (response) => {
						const payload = await response.json().catch(() => null);
						if (response.ok && payload?.ok === true && payload.active === target) {
							resolve(true);
							return;
						}
						if (Date.now() - start > budgetMs) resolve(false);
						else window.setTimeout(tick, 250);
					}).catch(() => {
						if (Date.now() - start > budgetMs) resolve(false);
						else window.setTimeout(tick, 250);
					});
				};
				tick();
			});
		}
		/** Read the currently active pet from the host. */
		function fetchActive() {
			return fetch("/api/pet-center/state").then((response) => response.json()).then((payload) => payload.ok === true && typeof payload.active === "string" ? payload.active : "pet").catch(() => "pet");
		}
		/**
		* Render the pet-center card: a disclosure header naming the plugin, with
		* the pet list (original whale + introduced whale maid; try-on preview /
		* one-click apply) inside its body.
		* @param props - card props.
		* @returns the plugin card.
		*/
		function PetCenter({ t }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [activeId, setActiveId] = (0, react.useState)(null);
			const [tryingId, setTryingId] = (0, react.useState)(null);
			const [preTarget, setPreTarget] = (0, react.useState)(null);
			const [applying, setApplying] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const ensureActive = async () => {
				if (activeId === null) setActiveId(await fetchActive());
			};
			ensureActive();
			const apply = async (target, markTrying) => {
				setError(null);
				setApplying(true);
				try {
					const response = await fetch("/api/pet-center/apply", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ pet: target })
					});
					const payload = await response.json().catch(() => null);
					if (!response.ok || payload?.ok !== true) {
						setError(t("applyFailed") + (payload !== null && typeof payload === "object" && "error" in payload ? `: ${String(payload.error)}` : ""));
						return;
					}
					if (markTrying) {
						setPreTarget((prev) => prev ?? activeId);
						setTryingId(target);
					} else {
						setTryingId(null);
						setPreTarget(null);
					}
					setActiveId(payload.active ?? target);
					if (!await confirmActive(target)) setError(t("appliedUnconfirmed"));
				} finally {
					setApplying(false);
				}
			};
			const exitTryOn = () => {
				if (preTarget !== null && preTarget !== tryingId) apply(preTarget, false);
				setTryingId(null);
				setPreTarget(null);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: pet_center_module_css_default.card,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: pet_center_module_css_default.header,
					"aria-expanded": open,
					"aria-label": `${t(open ? "collapse" : "expand")}: ${t("title")}`,
					onClick: () => {
						setOpen(!open);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: pet_center_module_css_default.headText,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: pet_center_module_css_default.name,
							children: t("title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: pet_center_module_css_default.description,
							children: t("cardDescription")
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: open ? pet_center_module_css_default.chevronOpen : pet_center_module_css_default.chevron,
						children: "▾"
					})]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: pet_center_module_css_default.body,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: pet_center_module_css_default.intro,
							children: t("intro")
						}),
						error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: pet_center_module_css_default.pending,
							role: "status",
							children: error
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: pet_center_module_css_default.list,
							children: PET_OPTIONS.map((pet) => {
								const isActive = activeId === pet.id;
								const isTrying = tryingId === pet.id;
								const badge = isActive && !isTrying ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: `${pet_center_module_css_default.badge} ${pet_center_module_css_default.badgeActive}`,
									"data-testid": `pet-${pet.id}-active`,
									children: t("active")
								}) : isTrying ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: `${pet_center_module_css_default.badge} ${pet_center_module_css_default.badgeTrying}`,
									children: t("tryingOn")
								}) : null;
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
									className: `${pet_center_module_css_default.item} ${isTrying ? pet_center_module_css_default.itemTrying : isActive ? pet_center_module_css_default.itemActive : ""}`,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: pet_center_module_css_default.meta,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: pet_center_module_css_default.itemName,
												children: t(pet.titleKey)
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: pet_center_module_css_default.itemTagline,
												children: t(pet.taglineKey)
											})]
										}),
										badge,
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: pet_center_module_css_default.actions,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: pet_center_module_css_default.action,
												disabled: applying || isTrying,
												onClick: () => {
													apply(pet.id, true);
												},
												"data-testid": `pet-${pet.id}-try`,
												children: t("tryOn")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: pet_center_module_css_default.action,
												disabled: applying || isActive,
												onClick: () => {
													apply(pet.id, false);
												},
												"data-testid": `pet-${pet.id}-apply`,
												children: t(applying && !isTrying ? "applying" : "apply")
											})]
										})
									]
								}, pet.id);
							})
						}),
						tryingId !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: pet_center_module_css_default.action,
							onClick: exitTryOn,
							style: { marginTop: 8 },
							children: t("exitTryOn")
						}) : null
					]
				}) : null]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		const en = {
			title: "Pet Center",
			cardDescription: "Switch between the original whale pet and the introduced whale-maid pet — try one on, then apply.",
			expand: "Expand",
			collapse: "Collapse",
			intro: "Choose which pet companion shows. Switching takes effect within seconds (the config watcher hot-reloads it); refresh the page to see the change.",
			original: "Original whale",
			originalTagline: "The original dsh-pet whale-girl companion.",
			introduced: "Introduced whale maid",
			introducedTagline: "The dsh-pet-maid whale-maid companion we brought in.",
			active: "Active",
			tryingOn: "Trying on",
			tryOn: "Try on",
			exitTryOn: "Exit try-on",
			apply: "Apply",
			applying: "Applying…",
			applyFailed: "Apply failed",
			appliedUnconfirmed: "Applied, but the change has not been confirmed — refresh the page if the pet did not switch"
		};
		const zh = {
			title: "宠物中心",
			cardDescription: "切换最初版的鲸鱼娘宠物与引入的女仆鲸鱼娘宠物——先试穿，再应用。",
			expand: "展开",
			collapse: "收起",
			intro: "选择显示哪个宠物陪伴。切换会写入配置，配置监听器数秒内热更新；刷新页面即可看到新宠物。",
			original: "最初版鲸鱼娘",
			originalTagline: "最初版的 dsh-pet 鲸鱼娘陪伴。",
			introduced: "引入的女仆鲸鱼娘",
			introducedTagline: "我们引入的 dsh-pet-maid 女仆鲸鱼娘陪伴。",
			active: "当前激活",
			tryingOn: "试用中",
			tryOn: "试用",
			exitTryOn: "退出试用",
			apply: "应用",
			applying: "应用中…",
			applyFailed: "应用失败",
			appliedUnconfirmed: "已写入配置但尚未确认生效——若宠物未切换请手动刷新页面"
		};
		//#endregion
		//#region src/client/index.ts
		/** Locale namespace owned by this plugin. */
		const NS = "petCenter";
		/** Required services: slots + locale (plugin card). */
		const inject = ["slots", "locale"];
		/**
		* Register the pet-center dictionaries and the Pet Center plugin card inside
		* the Web UI plugin group.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-pet-center: dictionaries");
			ctx.slots.inject("web-ui.plugin.item", () => ctx.slots.register({
				name: "web-ui.plugin.item",
				id: "pet-center",
				order: 125,
				locale: NS,
				inject: () => ({})
			}, PetCenter));
		}
		//#endregion
		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map