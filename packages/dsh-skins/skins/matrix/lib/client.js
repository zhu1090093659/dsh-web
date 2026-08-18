window.__ModuleLoader__.load({
	id: "@linxin666/dsh-client-ui-skin-matrix",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0dsh-css:packages/skins/matrix/src/client/matrix.module.css.mjs
		const css = "body[data-dsh-matrix]{--dsw-font-family:\"Menlo\",\"Consolas\",\"JetBrains Mono\",\"Source Code Pro\",\"PingFang SC\",\"Microsoft YaHei\",monospace;--ds-font-family-code:\"Menlo\",\"Consolas\",\"JetBrains Mono\",\"Source Code Pro\",monospace;color:#7dffb3;background-color:#040805;background-image:radial-gradient(130% 90% at 50% 0,#0a1f12 0%,#040805 55%),repeating-linear-gradient(0deg,#00ff6606 0 1px,#0000 1px 3px);background-attachment:fixed}body[data-dsh-matrix] ::selection{color:#000;background:#00e676}body[data-dsh-matrix] a{color:#45e087}body[data-dsh-matrix] a:hover{color:#8dffc2}body[data-dsh-matrix]{--dsw-static-neutral-00:#030604;--dsw-static-neutral-1000:#b8ffd4;--dsw-static-neutral-100:#071009;--dsw-static-neutral-150:#08120b;--dsw-static-neutral-200:#0a140d;--dsw-static-neutral-250:#0d1a11;--dsw-static-neutral-300:#102015;--dsw-static-neutral-400:#14291b;--dsw-static-neutral-500:#1a3323;--dsw-static-neutral-50:#050b07;--dsw-static-neutral-550:#1f3d2a;--dsw-static-neutral-600:#264a33;--dsw-static-neutral-700:#2f5c3f;--dsw-static-neutral-750:#3a6e4d;--dsw-static-neutral-75:#060d09;--dsw-static-neutral-800:#47825c;--dsw-static-neutral-850:#5aa071;--dsw-static-neutral-875:#6bb884;--dsw-static-neutral-900:#7dffb3;--dsw-static-neutral-950:#9cffc9;--dsw-static-neutral-bluish-00:#030604;--dsw-static-neutral-bluish-1000:#b8ffd4;--dsw-static-neutral-bluish-100:#071009;--dsw-static-neutral-bluish-150:#08120b;--dsw-static-neutral-bluish-200:#0a140d;--dsw-static-neutral-bluish-300:#102015;--dsw-static-neutral-bluish-400:#14291b;--dsw-static-neutral-bluish-500:#1a3323;--dsw-static-neutral-bluish-50:#050b07;--dsw-static-neutral-bluish-600:#264a33;--dsw-static-neutral-bluish-60:#060d09;--dsw-static-neutral-bluish-700:#2f5c3f;--dsw-static-neutral-bluish-750:#3a6e4d;--dsw-static-neutral-bluish-75:#060d09;--dsw-static-neutral-bluish-800:#47825c;--dsw-static-neutral-bluish-850:#5aa071;--dsw-static-neutral-bluish-875:#6bb884;--dsw-static-neutral-bluish-900:#7dffb3;--dsw-static-neutral-bluish-950:#9cffc9;--dsw-static-green-100:#0d2014;--dsw-static-green-400:#00e676;--dsw-static-green-500:#00c853;--dsw-static-green-900:#06220f;--dsw-static-blue-100:#0d1a14;--dsw-static-blue-300:#123026;--dsw-static-blue-400:#1d4d38;--dsw-static-blue-450:#2a6b4a;--dsw-static-blue-500:#3a8f63;--dsw-static-blue-50:#060f0a;--dsw-static-blue-50p:#07110c;--dsw-static-blue-600:#4fb57a;--dsw-static-blue-75:#070f0b;--dsw-static-blue-800:#7fdfa6;--dsw-static-blue-950:#c2ffda;--dsw-static-deepseek-100:#0d2014;--dsw-static-deepseek-200:#123026;--dsw-static-deepseek-300:#123a2a;--dsw-static-deepseek-400:#1d4d38;--dsw-static-deepseek-450:#2a6b4a;--dsw-static-deepseek-500:#3a8f63;--dsw-static-deepseek-50:#060f0a;--dsw-static-deepseek-600:#4fb57a;--dsw-static-deepseek-700-delete:#63cf92;--dsw-static-deepseek-800:#7fdfa6;--dsw-static-deepseek-900:#9df0bd;--dsw-static-amber-100:#3a3006;--dsw-static-amber-400:#ffd54f;--dsw-static-amber-500:#ffc400;--dsw-static-amber-600:#e0a800;--dsw-static-amber-900:#2c2400;--dsw-static-red-100:#3a1210;--dsw-static-red-400:#e6544a;--dsw-static-red-500:#ff5252;--dsw-static-red-50:#2a0e0c;--dsw-static-red-600:#ff6e60;--dsw-static-red-900:#4a1512;--dsw-alias-bg-base:#040805;--dsw-alias-bg-layer-1:#071009;--dsw-alias-bg-layer-2:#0a140d;--dsw-alias-bg-layer-3:#0e1d12;--dsw-alias-bg-mask-1:#000000b8;--dsw-alias-bg-mask-2:#0006;--dsw-alias-bg-mask-3:#000000d9;--dsw-alias-bg-mask-photo:#000000e6;--dsw-alias-bg-module-platform:#071009;--dsw-alias-bg-multi-select:#0a1f12;--dsw-alias-bg-overlay:#08120b;--dsw-alias-bg-skeleton:#0f63;--dsw-alias-border-inverted2:#ffffff1f;--dsw-alias-border-inverted:#ffffff26;--dsw-alias-border-l1:#0f63;--dsw-alias-border-l2-darkmode-thin:#00ff6626;--dsw-alias-border-l2:#00ff6640;--dsw-alias-border-l3:#00ff6659;--dsw-alias-border-l4:#00ff6673;--dsw-alias-brand-primary-invert:#040805;--dsw-alias-brand-primary-new-colorprimary-new-color:#00e676;--dsw-alias-brand-primary:#00e676;--dsw-alias-brand-text:#00e676;--dsw-alias-button-contrast-fill:#c2ffda;--dsw-alias-button-elevated-fill:#0a140d;--dsw-alias-button-floating-fill:#0a140d;--dsw-alias-button-floating-hover:#0e1d12;--dsw-alias-button-ghost-active-border:#45e087;--dsw-alias-button-ghost-active-fill:#0a140d;--dsw-alias-button-ghost-active-hover:#0e1d12;--dsw-alias-button-info-fill:#00c853;--dsw-alias-button-info-hover:#00e676;--dsw-alias-button-primary-dimmed:#145f33;--dsw-alias-button-primary-fill:#00c853;--dsw-alias-button-primary-hover:#00e676;--dsw-alias-button-tool-bar-fill-invisible:#00e67640;--dsw-alias-button-tool-bar-fill:#00e67659;--dsw-alias-button-tool-bar-hover:#00e67680;--dsw-alias-interactive-bg-active:#00e67626;--dsw-alias-interactive-bg-hover-accent:#00e67633;--dsw-alias-interactive-bg-hover-danger:#ff525224;--dsw-alias-interactive-bg-hover-solid:#0e1d12;--dsw-alias-interactive-bg-hover:#00e6761f;--dsw-alias-label-caption:#2ba45f;--dsw-alias-label-dimmed:#1c7a46;--dsw-alias-label-primary-dimmed:#8dffc2;--dsw-alias-label-primary-foreground:#000;--dsw-alias-label-primary-inverted:#040805;--dsw-alias-label-primary:#7dffb3;--dsw-alias-label-secondary:#45e087;--dsw-alias-label-tertiary:#2ba45f;--dsw-alias-markdown-citation:#08120b;--dsw-alias-markdown-code-block-banner:#08120b;--dsw-alias-markdown-code-block:#050a06;--dsw-alias-markdown-code-segment-selected:#0e1d12;--dsw-alias-markdown-code-segment-unselected:#08120b;--dsw-alias-markdown-inline-code:#08120b;--dsw-alias-markdown-placeholder:#08120b;--dsw-alias-markdown-tag:#08120b;--dsw-alias-state-business-primary:#00e676;--dsw-alias-state-business-tertiary:#0a1f12;--dsw-alias-state-error-primary:#ff5252;--dsw-alias-state-error-secondary:#e6544a;--dsw-alias-state-success-primary:#00e676;--dsw-alias-state-success-secondary:#45e087;--dsw-alias-state-success-tertiary:#0d2014;--dsw-alias-state-warn-primary:#ffc400;--dsw-alias-toast-bg:#06220f;--dsw-specific-bubble-highlight:#0a1f12;--dsw-specific-bubble:#07130b;--dsw-specific-input-major:#040805;--dsw-specific-login-input:#040805;--dsw-specific-menu:#0a140d;--dsw-specific-selector:#0a140d;--dsw-specific-sidebar-fill:#060d08;--dsw-specific-sidebar-nav-item-active-accent:#00e676;--dsw-specific-sidebar-nav-item-active:#0a1f12;--dsw-specific-sidebar-nav-item-hover:#00e67614;--dsw-specific-tip:#0a140d;--aion-bg-base:#060d08;--aion-bg-1:#08120b;--aion-bg-2:#0a140d;--aion-bg-3:#1a3323;--aion-bg-4:#2a6b4a;--aion-bg-hover:#00e67614;--aion-bg-active:#00e67626;--aion-text-primary:#7dffb3;--aion-text-secondary:#45e087;--aion-text-tertiary:#2ba45f;--aion-text-disabled:#1c7a46;--aion-primary:#00e676;--aion-success:#00e676;--aion-warning:#ffc400;--aion-danger:#ff5252;--aion-brand:#00e676;--aion-aou-1:#08120b;--aion-aou-2:#0a1f12;--aion-aou-3:#123a2a;--aion-aou-4:#1d4d38;--aion-aou-5:#3a8f63;--aion-aou-6:#7dffb3;--aion-fill-2:#0a1f12;--aion-fill-3:#1d4d38;--aion-border-base:#1a3323;--aion-overlay-shadow:0 12px 32px #000c;--aion-font-sans:\"Menlo\",\"Consolas\",\"JetBrains Mono\",\"PingFang SC\",\"Microsoft YaHei\",monospace;--aion-font-mono:\"Menlo\",\"Consolas\",\"JetBrains Mono\",monospace}body[data-dsh-matrix] [id=root]{background:linear-gradient(#071009 0%,#040805 100%);border:1px solid #0f63;box-shadow:0 0 24px #00e6760d,0 4px 14px #0009}body[data-dsh-matrix] [data-pane=sidebar]>div{background:#060d08}body[data-dsh-matrix] [data-pane=sidebar]>div>:first-child{color:#b8ffd4;background:linear-gradient(#0a1f12 0%,#060d08 100%);border-bottom:1px solid #0f63;box-shadow:inset 0 1px #00ff660f}body[data-dsh-matrix] [data-pane=sidebar]>div>button{color:#7dffb3;background:#0a140d;border:1px solid #1a3323}body[data-dsh-matrix] [data-pane=sidebar]>div>button:hover{color:#b8ffd4;background:#0e1d12;border-color:#2a6b4a;box-shadow:0 0 8px #00e6761f}body[data-dsh-matrix] [data-pane=sidebar] [role=treeitem]{border-bottom:1px solid #00ff6608}body[data-dsh-matrix] [data-pane=sidebar] [role=treeitem]:hover{background:#00e67614}body[data-dsh-matrix] [data-pane=sidebar] [role=treeitem][aria-selected=true],body[data-dsh-matrix] [data-pane=sidebar] [role=treeitem][aria-selected=true] *{color:#c2ffda;background:#0a1f12;box-shadow:inset 2px 0 #00e676}body[data-dsh-matrix] [data-pane=sidebar] input,body[data-dsh-matrix] [data-pane=conversation]>div>header input{color:#7dffb3;background:#040805;border:1px solid #1a3323}body[data-dsh-matrix] [data-pane=sidebar] input:focus,body[data-dsh-matrix] [data-pane=conversation]>div>header input:focus{border-color:#00e676;box-shadow:0 0 0 1px #00e676,0 0 12px #00e67626}body[data-dsh-matrix] [data-pane=conversation]{background:#040805}body[data-dsh-matrix] [data-pane=conversation]>div>header{color:#b8ffd4;background:linear-gradient(#0a1f12 0%,#060d08 100%);border-bottom:1px solid #0f63}body[data-dsh-matrix] [data-pane=details]{background:#060d08;box-shadow:-1px 0 #00ff6614}body[data-dsh-matrix] [role=dialog]{border:1px solid #1a3323;box-shadow:0 8px 24px #0009}body[data-dsh-matrix] [role=dialog]>nav{background:#060d08;border-right:1px solid #1a3323}body[data-dsh-matrix] [role=dialog]>nav>div:first-child{color:#b8ffd4;background:linear-gradient(#0a1f12 0%,#060d08 100%);box-shadow:inset 0 1px #00ff660f}body[data-dsh-matrix] [role=dialog]>nav button{color:#7dffb3}body[data-dsh-matrix] [role=dialog]>nav button:hover{background:#00e67614}body[data-dsh-matrix] [role=dialog]>nav button[aria-current=true],body[data-dsh-matrix] [role=dialog]>nav button[aria-current=true] *{color:#c2ffda;background:#0a1f12;box-shadow:inset 2px 0 #00e676}body[data-dsh-matrix] [role=dialog]>div{background:#040805}body[data-dsh-matrix] [role=dialog]>div>div:first-child{background:#08120b;border-bottom:1px solid #1a3323}body[data-dsh-matrix] textarea,body[data-dsh-matrix] [contenteditable=true],body[data-dsh-matrix] input:not([type=checkbox]):not([type=radio]){color:#7dffb3;caret-color:#00e676}body[data-dsh-matrix] ::placeholder{color:#1c7a46}body[data-dsh-matrix] code,body[data-dsh-matrix] pre{font-family:Menlo,Consolas,JetBrains Mono,monospace}body[data-dsh-matrix] ::-webkit-scrollbar{width:10px;height:10px}body[data-dsh-matrix] ::-webkit-scrollbar-track{background:#040805}body[data-dsh-matrix] ::-webkit-scrollbar-thumb{background:#145f33;border:2px solid #040805;border-radius:6px}body[data-dsh-matrix] ::-webkit-scrollbar-thumb:hover{background:#1c7a46}body[data-dsh-matrix] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+1),body[data-dsh-matrix] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+1){color:#00e676}body[data-dsh-matrix] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+2),body[data-dsh-matrix] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+2){color:#2ffd8c}body[data-dsh-matrix] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+3),body[data-dsh-matrix] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+3){color:#b6ff3d}body[data-dsh-matrix] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+4),body[data-dsh-matrix] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+4){color:#1de9b6}body[data-dsh-matrix] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+5),body[data-dsh-matrix] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+5){color:#76ff03}body[data-dsh-matrix] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n),body[data-dsh-matrix] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n){color:#00c853}@media (prefers-reduced-motion:reduce){body[data-dsh-matrix] *{transition:none!important}}";
		const tagId = "@linxin666/dsh-client-ui-skin-matrix/matrix.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@linxin666/dsh-client-ui-skin-matrix";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region src/client/index.ts
		/** Katakana + ASCII glyphs for the digital rain (classic Matrix flavor). */
		const GLYPHS = "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF";
		/** Bitmap density cap: the rain is a low-opacity ambience layer, so beyond 2x
		* the extra pixels are invisible — cap to keep the fill cost bounded. */
		const DPR_CAP = 2;
		/**
		* Mount the low-opacity digital-rain overlay. Returns a disposer, or null
		* when the environment prefers reduced motion / has no canvas support.
		*/
		function mountRain() {
			if (typeof document === "undefined" || typeof window === "undefined") return null;
			if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
			const canvas = document.createElement("canvas");
			canvas.dataset.plugin = "dsh-matrix-skin";
			canvas.setAttribute("aria-hidden", "true");
			canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000;opacity:.10";
			document.body.appendChild(canvas);
			const g = canvas.getContext("2d");
			if (!g) {
				canvas.remove();
				return null;
			}
			const FONT = "16px Menlo,Consolas,monospace";
			let cols = [];
			let raf = 0;
			let last = 0;
			/** Bitmap scale for the current display density, capped at DPR_CAP. */
			const scale = () => Math.min(window.devicePixelRatio || 1, DPR_CAP);
			const resize = () => {
				const s = scale();
				canvas.width = Math.round(window.innerWidth * s);
				canvas.height = Math.round(window.innerHeight * s);
				g.setTransform(s, 0, 0, s, 0, 0);
				const n = Math.max(1, Math.floor(window.innerWidth / 18));
				cols = [];
				for (let i = 0; i < n; i++) cols.push({
					y: Math.random() * -window.innerHeight,
					speed: .5 + Math.random() * 1.3,
					chars: []
				});
			};
			const frame = (t) => {
				raf = 0;
				if (document.hidden) return;
				if (t - last < 50) {
					raf = requestAnimationFrame(frame);
					return;
				}
				last = t;
				g.fillStyle = "rgba(4,8,5,0.14)";
				g.fillRect(0, 0, window.innerWidth, window.innerHeight);
				g.font = FONT;
				cols.forEach((c, i) => {
					c.y += c.speed * 16;
					if (c.y > window.innerHeight + 40) {
						c.y = -40;
						c.chars = [];
					}
					c.chars.unshift(GLYPHS[Math.random() * 41 | 0]);
					if (c.chars.length > 14) c.chars.pop();
					const x = i * 18;
					for (let j = 0; j < c.chars.length; j++) {
						g.fillStyle = j === 0 ? "rgba(190,255,215,0.95)" : `rgba(0,230,118,${.9 - j * .05})`;
						g.fillText(c.chars[j], x, c.y - j * 16);
					}
				});
				raf = requestAnimationFrame(frame);
			};
			resize();
			window.addEventListener("resize", resize);
			raf = requestAnimationFrame(frame);
			return () => {
				cancelAnimationFrame(raf);
				window.removeEventListener("resize", resize);
				canvas.remove();
			};
		}
		/**
		* Activate the Matrix skin: set the body marker, force the dark-theme flag
		* (night-use feature), start the rain. The disposer retracts everything.
		*/
		function apply(ctx) {
			const body = document.body;
			if (!body) return;
			body.dataset.dshMatrix = "";
			const prevDark = body.dataset.dsDarkTheme;
			body.dataset.dsDarkTheme = "";
			const attrObs = new MutationObserver(() => {
				if (body.dataset.dshMatrix === void 0) return;
				if (body.dataset.dsDarkTheme === void 0) body.dataset.dsDarkTheme = "";
			});
			attrObs.observe(body, {
				attributes: true,
				attributeFilter: ["data-ds-dark-theme"]
			});
			let disposeRain = null;
			try {
				disposeRain = mountRain();
			} catch {
				disposeRain = null;
			}
			ctx.effect(() => () => {
				attrObs.disconnect();
				delete body.dataset.dshMatrix;
				if (prevDark === void 0) delete body.dataset.dsDarkTheme;
				else body.dataset.dsDarkTheme = prevDark;
				if (disposeRain) disposeRain();
			}, "dsh-matrix-skin: theme");
		}
		//#endregion
		exports.apply = apply;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map