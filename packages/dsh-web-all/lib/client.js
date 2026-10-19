window.__ModuleLoader__.load({
	id: "@linxin666/dsh-web-all",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client/body-mutations.ts
		/** Cross-bundle registry key; `Symbol.for` so every module copy agrees. */
		const HUB_KEY = Symbol.for("dsh-web.body-mutation-hub");
		const INVALIDATION_ONLY = Symbol.for("dsh-web.body-mutation-invalidation");
		function needsRecords(subscribers) {
			for (const listener of subscribers) if (!listener[INVALIDATION_ONLY]) return true;
			return false;
		}
		/**
		* Subscribe to a coalesced DOM re-check without retaining mutation records.
		* The marked wrapper also works with an older hub, which delivers records
		* that it simply ignores until a page reload picks up the updated hub.
		*/
		function subscribeBodyInvalidations(subscriber) {
			const listener = () => {
				subscriber();
			};
			listener[INVALIDATION_ONLY] = true;
			return subscribeBodyMutations(listener);
		}
		/**
		* Subscribe to body-level childList mutations.
		* @param subscriber - called at most once per animation frame with the records
		*   collected since the previous flush; must be safe to run repeatedly.
		* @returns the disposer removing this subscriber (and the observer when it was
		*   the last one).
		*/
		function subscribeBodyMutations(subscriber) {
			if (typeof globalThis === "undefined" || typeof document === "undefined") return () => {};
			if (typeof MutationObserver !== "function") return () => {};
			const registry = globalThis;
			let hub = registry[HUB_KEY];
			if (hub === void 0) {
				const subscribers = /* @__PURE__ */ new Set();
				const created = {
					observer: void 0,
					subscribers,
					pending: [],
					scheduled: false
				};
				const flush = () => {
					created.frame = void 0;
					created.scheduled = false;
					const batch = created.pending;
					created.pending = [];
					for (const listener of [...subscribers]) {
						if (!subscribers.has(listener)) continue;
						try {
							listener(batch);
						} catch {}
					}
				};
				const schedule = () => {
					if (created.scheduled) return;
					created.scheduled = true;
					if (typeof requestAnimationFrame === "function") created.frame = requestAnimationFrame(flush);
					else flush();
				};
				created.observer = new MutationObserver((records) => {
					if (needsRecords(subscribers)) for (const record of records) created.pending.push(record);
					schedule();
				});
				created.observer.observe(document.body ?? document.documentElement, {
					childList: true,
					subtree: true
				});
				registry[HUB_KEY] = created;
				hub = created;
			}
			const active = hub;
			active.subscribers.add(subscriber);
			let subscribed = true;
			return () => {
				if (!subscribed) return;
				subscribed = false;
				active.subscribers.delete(subscriber);
				if (!needsRecords(active.subscribers)) active.pending = [];
				if (active.subscribers.size === 0 && registry[HUB_KEY] === active) {
					active.observer.disconnect();
					if (active.frame !== void 0 && typeof cancelAnimationFrame === "function") cancelAnimationFrame(active.frame);
					active.frame = void 0;
					active.pending = [];
					active.scheduled = false;
					delete registry[HUB_KEY];
				}
			};
		}
		//#endregion
		//#region src/client/index.ts
		/** Column shims: element selector → attribute to stamp. */
		const COLUMN_SHIMS = [
			["[class*=\"sidebarCol\"]", "data-pane=\"sidebar\""],
			["[class*=\"centerCol\"]", "data-pane=\"conversation\""],
			["[class*=\"detailsCol\"]", "data-pane=\"details\""]
		];
		/** Stable hooks consumed by the responsive compat layer (never text/hash selectors). */
		const RESPONSIVE_CSS = `
[data-dsh-frame] { min-height: 0; }
/* Viewport lock for installs with no active visual. The identical lock lives in
   the skin-center shell-rendering stylesheet, but that stylesheet is inert
   unless a catalog skin, custom theme or wallpaper is active, so a stock
   install keeps html/body at their inherited "overflow: visible". Every
   conversation disclosure control (the tool/step-process collapse bar carrying
   the step summary, and the whole-turn process bar) calls focus() on itself
   when toggled; a focused element below any document overflow scrolls the page
   down by that overflow, which reads as the page being stretched downward with
   the titlebar and sidebar top pushed out of the viewport: issue #1135's
   symptom, reachable here with no skin active. Locking only the scrolling root
   (never the app root element, whose own lock clipped content in
   #1222/#1225) removes the overflow scroll target without touching the frame's
   box in any state. Scoped through :has() so the rule stays inert until the
   shell frame exists. */
html:has([data-dsh-frame]),
html:has([data-dsh-frame]) > body {
  height: 100%;
  width: 100%;
  overflow: hidden;
}
/* macOS window-drag guard. The official base stylesheet turns every DIRECT body
   child into a "-webkit-app-region: no-drag" region (its selector spares only
   the app's own root element), so a body-level element that spans the viewport
   subtracts the whole window from the macOS draggable region and cancels the
   official [data-window-drag] chrome rows with it: the window
   can no longer be dragged by its title area, and macOS no longer runs the
   system double-click action (zoom to fit the screen) there. "pointer-events:
   none" does not exempt an element from that computation - only a declaration
   of its own does. Family decorations are exactly such elements: the skin
   center mounts its six fixed decoration layers and the backdrop-blur veil as
   full-viewport body children and declares them non-interactive (aria-hidden,
   pointer-events: none; decoration must never eat clicks). The "initial"
   keyword is the initial value ("none"), which leaves the element and its whole
   subtree out of the app-region computation; the declaration must be !important
   because the official selector outranks this one. */
html[data-platform="darwin"] body > :is(
  [data-dsh-skin-layer],
  [data-dsh-boot-splash],
  [aria-hidden="true"]
) {
  -webkit-app-region: initial !important;
}
[data-dsh-frame] [data-dsh-responsive-part="composer"],
[data-dsh-frame] [data-dsh-responsive-part="sidebar-toggle"],
  [data-dsh-frame] [data-dsh-responsive-part="menu"] { touch-action: manipulation; }
@media (max-width: 768px) {
  [data-dsh-frame] [data-dsh-responsive-part="sidebar-toggle"] { min-width: 44px; min-height: 44px; }
  [data-dsh-frame] {
    box-sizing: border-box;
    height: 100dvh;
    min-height: 100dvh;
    max-height: 100dvh;
    grid-template-columns: minmax(0, 1fr) !important;
    grid-template-rows: 100%;
    padding-bottom: env(safe-area-inset-bottom);
  }
  /* The drawer contract is not a skin decision, and this rule is the END of
     that argument, not the start of one. Read this before raising it again.

     The skin-center loader force-scopes every skin selector under
     html[data-dsh-skin="<id>"] (scopeSelectorText prefixes the scope to every
     head), so a skin rule written as body [data-pane='sidebar'] { position:
     relative; } is served as html[data-dsh-skin="..."] body
     [data-pane='sidebar'] - specificity 0-2-2, above a plain 0-2-0. The pane
     then falls back into the single mobile grid column and pushes the
     conversation column out of the viewport (measured at a 700px viewport:
     conversation y=700, height=0 - no usable session area at all).

     position !important settles that case, but !important does not settle
     everything: when BOTH sides are important the cascade returns to
     specificity, and a skin rule like
     div:has(> [data-slot="sidebar"]) { position: relative !important; }
     (last-exile, porco-rosso, white-snake) is served as
     html[data-dsh-skin="..."] body div:has(...) - 0-2-3 - which still wins.
     The :is(...) below is deliberately redundant as a matcher and exists only
     to lift this rule to 0-3-0 so the drawer beats that shape too. It is
     verified against all seven affected skins; do not "simplify" it away.

     BOUNDARY: this is the ceiling. If a future skin outranks 0-3-0 here, the
     correct fix is to repair THAT SKIN, not to raise this specificity again.
     Positioning the sidebar pane is not a skin's job: those rules want the
     pane to be a containing block for their own glass layer, and position is
     a side effect of that intent, not the intent. A skin that needs a
     containing block should paint its layer inside the pane's slot child
     instead. Chasing skins here would turn the mobile contract into an arms
     race the shell cannot win. */
  [data-dsh-frame] [data-pane="sidebar"]:is([data-pane="sidebar"]) {
    position: absolute !important;
    inset-block: 0;
    inset-inline-start: 0;
    z-index: 1100;
    width: min(88vw, 320px) !important;
    max-width: 100%;
    box-shadow: 0 12px 32px rgb(0 0 0 / 24%);
    transform: translateX(0);
    transition: transform 160ms ease;
  }
  [data-dsh-frame]:not([data-sidebar-collapsed])::after {
    content: "";
    position: fixed;
    inset: 0;
    z-index: 1050;
    background: rgb(0 0 0 / 24%);
  }
  [data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"] {
    width: 52px !important;
    transform: none;
    pointer-events: none;
    background: transparent !important;
    border: 0 !important;
    box-shadow: none;
  }
  [data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"] > [data-slot="sidebar"] > :first-child > :not(:first-child),
  [data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"] > [data-slot="sidebar"] > :first-child > :first-child > :not([data-dsh-responsive-part="sidebar-toggle"]) {
    display: none !important;
  }
  [data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"] > [data-slot="sidebar"],
  [data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"] > [data-slot="sidebar"] > :first-child { background: transparent !important; }
  [data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"] [data-dsh-responsive-part="sidebar-toggle"] {
    pointer-events: auto;
    display: inline-flex !important;
  }
  /* The official settings dialog renders inside the sidebar foot, so collapsing
     the rail would both hide it (the rule above) and freeze it (a collapsed pane
     sets pointer-events: none). Restore only the subtree that actually carries an
     open dialog; with no dialog open the collapsed rail is unchanged (issue #1510). */
  [data-dsh-frame][data-sidebar-collapsed] [data-pane="sidebar"] > [data-slot="sidebar"] > :first-child > :not(:first-child):has([role="dialog"], [aria-modal="true"]) {
    display: flex !important;
    pointer-events: auto;
  }
  /* Center-view plugins own this marker; the aggregate shell owns its mobile offset. */
  [data-dsh-frame][data-sidebar-collapsed] [data-dsh-center-view-back] {
    margin-inline-start: 52px;
  }
  [data-dsh-frame] [data-pane="conversation"] {
    min-width: 0;
    width: 100%;
    min-height: 0;
  }
  [data-dsh-frame] [data-pane="details"] {
    display: none;
  }
  [data-dsh-frame]:not([data-details-collapsed]) [data-pane="details"] {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 1000;
    width: 100%;
    background: var(--dsw-alias-bg-base);
  }
  [data-dsh-frame][data-details-collapsed] [data-pane="details"] {
    display: none;
  }
  [data-dsh-frame] [data-dsh-responsive-part="composer"] {
    max-width: 100%;
    padding-inline: max(8px, env(safe-area-inset-left)) max(8px, env(safe-area-inset-right));
  }
  [data-dsh-frame] [data-slot="conversation.composer"],
  [data-dsh-frame] [data-composer-card],
  [data-dsh-frame] [data-input-scroll] {
    min-width: 0;
    max-width: 100%;
  }
  [data-dsh-frame] [data-composer-card] > :last-child {
    min-width: 0;
    max-width: 100%;
    flex-wrap: wrap;
  }
  [data-dsh-frame] [data-slot="conversation.input.model"] {
    min-width: 0;
    max-width: 45%;
  }
  [data-dsh-frame] [data-slot="conversation.input.model"] :is(button, span) {
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  [data-dsh-frame] textarea[data-phase] {
    min-width: 0;
    font-size: 16px;
  }
  [data-dsh-part="summon-button"] {
    right: max(12px, env(safe-area-inset-right));
    bottom: max(12px, env(safe-area-inset-bottom));
    z-index: 40 !important;
    width: 44px !important;
    height: 44px !important;
    min-width: 44px;
    min-height: 44px;
    padding: 0 !important;
    border-radius: 50% !important;
    font-size: 0 !important;
  }
  [data-dsh-part="summon-button"]::before {
    content: "";
    display: block;
    width: 18px;
    height: 13px;
    margin: auto;
    border: 2px solid currentColor;
    border-radius: 55% 65% 45% 55%;
    transform: rotate(-8deg);
  }
  [data-dsh-frame] [data-dsh-responsive-part="code"] {
    max-width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  [data-dsh-frame] [data-dsh-responsive-part="menu"] {
    max-width: min(92vw, 360px);
  }
}
@media (max-width: 768px) {
  [data-dsh-frame] [data-dsh-responsive-part="conversation-header"] {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: minmax(32px, auto) minmax(44px, auto);
    column-gap: 8px;
    padding: 8px 8px 0 60px !important;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-title-row"] {
    display: contents;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-title-cluster"] {
    box-sizing: border-box;
    grid-column: 1 / -1;
    grid-row: 1;
    min-width: 0;
    padding-inline-end: 44px;
    overflow: hidden;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-tablist"] {
    grid-column: 1;
    grid-row: 2;
    min-width: 0;
    margin-top: 0;
    padding-left: 0;
    gap: 16px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-tablist"]::-webkit-scrollbar {
    display: none;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-tablist"] > [role="tab"] {
    min-height: 44px;
    flex: none;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-utilities"] {
    grid-column: 2;
    grid-row: 2;
    z-index: 2;
    max-width: 42vw;
    min-height: 44px;
    margin-left: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-utilities"]::-webkit-scrollbar {
    display: none;
  }
  [data-dsh-frame] [data-dsh-responsive-part="session-utilities"] :is(button, [role="button"]) {
    min-width: 44px;
    min-height: 44px;
    flex: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  [data-dsh-frame] [data-pane="sidebar"] { transition: none; }
  [data-dsh-boot-splash] { transition: none; }
}
[data-dsh-boot-splash] {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: var(--dsw-alias-bg-base, #1e1e20);
  opacity: 1;
  pointer-events: none;
  transition: opacity 160ms cubic-bezier(0.4, 0, 0.2, 1);
}
[data-dsh-boot-splash][data-ready] {
  opacity: 0;
}
`;
		function ensureResponsiveStyle() {
			const existing = document.querySelector("style[data-dsh-compat=\"responsive\"]");
			if (existing !== null) return existing;
			const style = document.createElement("style");
			style.dataset.dshCompat = "responsive";
			style.textContent = RESPONSIVE_CSS;
			document.head.appendChild(style);
			return style;
		}
		function stampSemanticParts(frame) {
			let changed = false;
			const mark = (element, part) => {
				if (element.getAttribute("data-dsh-responsive-part") === part) return;
				element.setAttribute("data-dsh-responsive-part", part);
				changed = true;
			};
			frame.querySelectorAll("[data-slot=\"conversation.composer\"], [data-composer-card], [data-input-scroll], textarea[data-phase], [contenteditable=\"true\"]").forEach((element) => mark(element, "composer"));
			frame.querySelectorAll("pre").forEach((element) => mark(element, "code"));
			frame.querySelectorAll("[role=\"menu\"], [data-subagent-menu]").forEach((element) => mark(element, "menu"));
			frame.querySelectorAll("[role=\"treeitem\"]:not([data-dsh-part])").forEach((element) => mark(element, "sidebar-entry"));
			const conversation = frame.querySelector("[data-pane=\"conversation\"]");
			const slottedHeader = (conversation?.querySelector("[data-slot=\"conversation.session.header\"]"))?.querySelector(":scope > header") ?? null;
			const scrollport = conversation?.querySelector("[data-conversation-scroll]") ?? null;
			const siblingHeader = scrollport?.previousElementSibling ?? null;
			const conversationHeader = slottedHeader ?? (siblingHeader?.tagName === "HEADER" && siblingHeader.parentElement === scrollport?.parentElement ? siblingHeader : null);
			if (conversationHeader !== null) {
				mark(conversationHeader, "conversation-header");
				const titleRow = conversationHeader.firstElementChild;
				if (titleRow !== null && titleRow.getAttribute("role") !== "tablist") {
					mark(titleRow, "session-title-row");
					const titleCluster = titleRow.firstElementChild;
					const utilities = titleCluster?.nextElementSibling;
					if (titleCluster !== null && titleCluster !== void 0) mark(titleCluster, "session-title-cluster");
					if (utilities !== null && utilities !== void 0) mark(utilities, "session-utilities");
				}
				const tablist = conversationHeader.querySelector(":scope > [role=\"tablist\"]");
				if (tablist !== null) mark(tablist, "session-tablist");
			}
			const logoButtons = ((frame.querySelector("[data-pane=\"sidebar\"]")?.querySelector(":scope > [data-slot=\"sidebar\"]"))?.firstElementChild?.firstElementChild)?.querySelectorAll(":scope > button, :scope > [role=\"button\"]");
			const toggle = logoButtons?.item((logoButtons.length || 1) - 1);
			if (toggle !== null && toggle !== void 0) mark(toggle, "sidebar-toggle");
			return changed;
		}
		function installMobileSidebarDismiss(frame) {
			let raf = 0;
			const onClick = (event) => {
				const target = event.target;
				if (!(target instanceof Element)) return;
				if (typeof window.matchMedia !== "function" || !window.matchMedia("(max-width: 768px)").matches) return;
				const sidebar = frame.querySelector("[data-pane=\"sidebar\"]");
				const toggle = frame.querySelector("[data-dsh-responsive-part=\"sidebar-toggle\"]");
				if (!frame.hasAttribute("data-sidebar-collapsed") && sidebar !== null && !sidebar.contains(target)) {
					event.preventDefault();
					event.stopPropagation();
					toggle?.click();
					return;
				}
				if (target.closest("[data-dsh-responsive-part=\"sidebar-toggle\"]") !== null) return;
				const sessionRow = target.closest("[class*=\"sessionRow\"]");
				if (sessionRow === null && target.closest("[class*=\"projectRow\"]") !== null) {
					const actions = target.closest("[class*=\"rowActions\"]");
					if (actions === null) return;
					const buttons = actions.querySelectorAll("button");
					if (target.closest("button") !== buttons[buttons.length - 1]) return;
				}
				if (sessionRow === null && target.closest("[data-dsh-part=\"sidebar-entry\"]") === null && target.closest("[role=\"treeitem\"]") === null) return;
				if (raf !== 0) cancelAnimationFrame(raf);
				raf = requestAnimationFrame(() => {
					raf = 0;
					if (!frame.hasAttribute("data-sidebar-collapsed")) toggle?.click();
				});
			};
			frame.addEventListener("click", onClick, true);
			return () => {
				frame.removeEventListener("click", onClick, true);
				if (raf !== 0) cancelAnimationFrame(raf);
			};
		}
		/** One pass over the current DOM. Returns false once every stamp is already in place. */
		function applyShims() {
			let changed = false;
			for (const [selector, attribute] of COLUMN_SHIMS) {
				const el = document.querySelector(selector);
				const eq = attribute.indexOf("=");
				const name = attribute.slice(0, eq);
				const value = attribute.slice(eq + 1).replace(/^"|"$/g, "");
				if (el !== null && el.getAttribute(name) !== value) {
					el.setAttribute(name, value);
					changed = true;
				}
			}
			const frame = document.querySelector("[class*=\"sidebarCol\"]")?.parentElement ?? null;
			if (frame !== null && frame.getAttribute("data-dsh-frame") !== "") {
				frame.setAttribute("data-dsh-frame", "");
				changed = true;
			}
			if (frame !== null) changed = stampSemanticParts(frame) || changed;
			return changed;
		}
		function installBootShield() {
			if (typeof document === "undefined") return {
				dismiss: () => {},
				remove: () => {}
			};
			let splash = document.querySelector("div[data-dsh-boot-splash]");
			if (splash === null) {
				splash = document.createElement("div");
				splash.setAttribute("data-dsh-boot-splash", "");
				document.body.appendChild(splash);
			}
			let dismissed = false;
			let fadeTimer = 0;
			const dismiss = () => {
				if (dismissed) return;
				dismissed = true;
				splash?.setAttribute("data-ready", "");
				fadeTimer = window.setTimeout(() => {
					splash?.remove();
				}, 180);
			};
			const timeout = window.setTimeout(dismiss, 1e3);
			return {
				dismiss,
				remove: () => {
					window.clearTimeout(timeout);
					window.clearTimeout(fadeTimer);
					splash?.remove();
				}
			};
		}
		/** Required services: none — the shim must run before any DOM mount waits. */
		const inject = [];
		/**
		* Register the shim for the page lifetime.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => {
				const responsiveStyle = ensureResponsiveStyle();
				const bootShield = installBootShield();
				applyShims();
				let removeMobileDismiss = () => {};
				let dismissFrame = null;
				let resolvedFrame = null;
				const ensureMobileDismiss = () => {
					if (resolvedFrame !== null && !resolvedFrame.isConnected) resolvedFrame = null;
					const frame = resolvedFrame ?? document.querySelector("[data-dsh-frame]");
					resolvedFrame = frame;
					if (frame === null) return;
					bootShield.dismiss();
					if (frame === dismissFrame) return;
					removeMobileDismiss();
					removeMobileDismiss = installMobileSidebarDismiss(frame);
					dismissFrame = frame;
				};
				ensureMobileDismiss();
				const unsubscribeBody = subscribeBodyInvalidations(() => {
					applyShims();
					ensureMobileDismiss();
				});
				return () => {
					unsubscribeBody();
					bootShield.remove();
					responsiveStyle.remove();
					removeMobileDismiss();
				};
			});
		}
		//#endregion
		exports.RESPONSIVE_CSS = RESPONSIVE_CSS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map