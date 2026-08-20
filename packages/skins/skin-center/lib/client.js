window.__ModuleLoader__.load({
	id: "@linxin666/dsh-client-ui-skin-center",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/wallpaper.ts
		/** The namespace string the Host registers (mirrors src/index.ts). */
		const SKIN_WALLPAPER_NS = "skin-wallpaper";
		const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)));
		/** Style one fixed, non-interactive, under-everything layer. */
		function styleLayer(element, zIndex) {
			element.style.position = "fixed";
			element.style.inset = "0";
			element.style.zIndex = String(zIndex);
			element.style.pointerEvents = "none";
			element.style.overflow = "hidden";
			element.setAttribute("aria-hidden", "true");
		}
		/** Style a full-bleed cover child (video / img / iframe). */
		function styleCover(element, fit = "cover") {
			element.style.width = "100%";
			element.style.height = "100%";
			element.style.objectFit = fit;
			element.style.border = "0";
			element.style.display = "block";
		}
		/** Max static-frame capture edge (the backdrop never needs more pixels). */
		const FRAME_MAX_EDGE = 1920;
		/**
		* Default full-viewport-surface detector for WE wallpaper neutralization
		* (#734): an element is a shell surface when its rendered box is the full
		* viewport height AND its computed background-color equals the resolved
		* --dsw-alias-bg-base color. The height check uses GEOMETRY, not the literal
		* computed "100%": real browsers return the used value in px (e.g. "913px")
		* for rendered elements, and the literal "100%" only appears on unrendered
		* 0x0 subtrees — a style-string check would silently never tag the
		* AppFrame / conversation / details roots. jsdom does no layout (every rect
		* is 0 and clientHeight is 0), so when no viewport height is measurable the
		* check falls back to the style string to keep jsdom tests meaningful. The
		* color check matches the official shell frame/root containers which paint
		* the app base background at full height and only carry hashed CSS-module
		* classes, so this selector-free check never depends on class names. Returns
		* false when the token cannot be resolved.
		*/
		function defaultWallpaperSurface(el, doc) {
			const win = doc.defaultView;
			if (win === null) return false;
			let rectHeight = 0;
			let viewportHeight = 0;
			let heightStyle = "";
			let background = "";
			try {
				rectHeight = el.getBoundingClientRect().height;
				viewportHeight = doc.documentElement.clientHeight || win.innerHeight || 0;
				const cs = win.getComputedStyle(el);
				heightStyle = cs.height;
				background = cs.backgroundColor;
			} catch {
				return false;
			}
			if (!(rectHeight > 0 ? Math.abs(rectHeight - viewportHeight) <= 2 : heightStyle === "100%" || heightStyle === "100vh")) return false;
			const base = resolveCssColor(doc, "--dsw-alias-bg-base");
			return base !== null && background === base;
		}
		/** Resolve a color custom property to its computed CSS color, if any. */
		function resolveCssColor(doc, name) {
			const win = doc.defaultView;
			if (win === null || doc.documentElement === null) return null;
			let raw = win.getComputedStyle(doc.documentElement).getPropertyValue(name).trim();
			if (raw === "" && doc.body !== null) raw = win.getComputedStyle(doc.body).getPropertyValue(name).trim();
			if (raw === "") return null;
			const probe = doc.createElement("div");
			probe.style.setProperty("background-color", raw);
			doc.documentElement.appendChild(probe);
			try {
				return win.getComputedStyle(probe).backgroundColor;
			} catch {
				return null;
			} finally {
				probe.remove();
			}
		}
		/**
		* Workspace-list end-fade detector (#734): a gradient-background element inside
		* the sidebar workspaces slot. The official `data-slot="sidebar.workspaces"`
		* anchor is stable; the fade element only carries hashed CSS-module classes, so
		* this selects it by computed style instead of class names.
		*/
		function defaultWorkspaceFade(el, doc) {
			const win = doc.defaultView;
			if (win === null) return false;
			try {
				return win.getComputedStyle(el).backgroundImage.includes("gradient");
			} catch {
				return false;
			}
		}
		/**
		* Own the skin-wallpaper scope: keep the mounted layers in sync with the
		* persisted selection and the card-driven descriptor resolution.
		*/
		var WallpaperController = class {
			enabledValue = true;
			selectionValue = "";
			modeValue = "live";
			fitValue = "cover";
			pauseOnHiddenValue = true;
			soundValue = false;
			volumeValue = 100;
			dimValue = 25;
			blurValue = 0;
			dirsValue = [];
			listeners = /* @__PURE__ */ new Set();
			scope;
			options;
			doc;
			/** The descriptor of the applied selection, resolved by the card. */
			applied = null;
			/** The try-on descriptor while a preview is up. */
			previewing = null;
			mediaLayer = null;
			scrimLayer = null;
			videoElement = null;
			rootNeutralizer = null;
			/** Shell surfaces tagged with data-dsh-wallpaper-surface during this mount. */
			taggedSurfaces = [];
			disposed = false;
			constructor(scope, options = {}) {
				this.scope = scope;
				this.options = options;
				this.doc = options.doc ?? document;
				this.readAll();
				scope.subscribe(() => {
					this.readAll();
					if (this.enabledValue && this.selectionValue && (!this.applied || this.applied.id !== this.selectionValue)) this.fetchAndSync();
					else {
						this.render();
						this.publish();
					}
				});
				this.doc.addEventListener("visibilitychange", this.onVisibility);
				this.doc.addEventListener("pointerdown", this.onFirstGesture);
				this.doc.addEventListener("keydown", this.onFirstGesture);
				if (this.enabledValue && this.selectionValue) this.fetchAndSync();
			}
			fetchAndSync() {
				if (!this.selectionValue || !this.doc) return;
				const targetId = this.selectionValue;
				const fetchFn = this.options.fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(this.doc.defaultView ?? globalThis) : void 0);
				if (!fetchFn) return;
				fetchFn(`${this.options.apiBase ?? "/api/skin-center/we"}/inventory`).then(async (response) => {
					if (this.disposed || !response.ok) return;
					const payload = await response.json().catch(() => null);
					if (payload?.ok === true && Array.isArray(payload.wallpapers)) {
						const item = payload.wallpapers.find((w) => w.id === targetId);
						if (item && this.selectionValue === targetId) {
							this.applied = item;
							this.render();
							this.publish();
						}
					}
				}).catch(() => {});
			}
			enabled = () => this.enabledValue;
			selection = () => this.selectionValue;
			mode = () => this.modeValue;
			fit = () => this.fitValue;
			dim = () => this.dimValue;
			wallpaperBlur = () => this.blurValue;
			pauseOnHidden = () => this.pauseOnHiddenValue;
			sound = () => this.soundValue;
			volume = () => this.volumeValue;
			dirs = () => this.dirsValue;
			addDir(dir) {
				const trimmed = dir.trim();
				if (trimmed === "" || this.dirsValue.includes(trimmed)) return;
				this.dirsValue = [...this.dirsValue, trimmed];
				this.publish();
				this.scope.set("weLibraryDirs", this.dirsValue);
			}
			removeDir(dir) {
				const next = this.dirsValue.filter((d) => d !== dir);
				if (next.length === this.dirsValue.length) return;
				this.dirsValue = next;
				this.publish();
				this.scope.set("weLibraryDirs", this.dirsValue);
			}
			activeId = () => {
				const current = this.previewing ?? this.applied;
				return this.mediaLayer !== null && current !== null ? current.id : null;
			};
			trying = () => this.previewing !== null;
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			setEnabled(value) {
				this.enabledValue = value;
				this.render();
				this.publish();
				this.scope.set("enabled", value);
			}
			setMode(mode) {
				this.modeValue = mode;
				this.render();
				this.publish();
				this.scope.set("mode", mode);
			}
			setFit(fit) {
				this.fitValue = fit;
				this.render();
				this.publish();
				this.scope.set("fit", fit);
			}
			setDim(value) {
				this.dimValue = clamp(value, 0, 90);
				this.render();
				this.publish();
				this.scope.set("dim", this.dimValue);
			}
			setBlur(value) {
				this.blurValue = clamp(value, 0, 60);
				this.render();
				this.publish();
				this.scope.set("wallpaperBlur", this.blurValue);
			}
			setPauseOnHidden(value) {
				this.pauseOnHiddenValue = value;
				this.publish();
				this.scope.set("pauseOnHidden", value);
			}
			setSound(value) {
				this.soundValue = value;
				this.applySound();
				this.publish();
				this.scope.set("sound", value);
			}
			setVolume(value) {
				this.volumeValue = clamp(value, 0, 100);
				this.applySound();
				this.publish();
				this.scope.set("volume", this.volumeValue);
			}
			applySelection(descriptor) {
				this.applied = descriptor;
				this.previewing = null;
				this.selectionValue = descriptor.id;
				this.render();
				this.publish();
				this.scope.set("selection", descriptor.id);
			}
			clearSelection() {
				this.applied = null;
				this.previewing = null;
				this.selectionValue = "";
				this.render();
				this.publish();
				this.scope.set("selection", "");
			}
			sync(descriptor) {
				this.applied = descriptor;
				this.render();
			}
			tryOn(descriptor) {
				this.previewing = descriptor;
				this.render();
				this.publish();
			}
			exitTryOn() {
				if (this.previewing === null) return;
				this.previewing = null;
				this.render();
				this.publish();
			}
			dispose() {
				this.disposed = true;
				this.doc.removeEventListener("visibilitychange", this.onVisibility);
				this.doc.removeEventListener("pointerdown", this.onFirstGesture);
				this.doc.removeEventListener("keydown", this.onFirstGesture);
				this.teardownLayers();
			}
			readAll() {
				const value = this.scope.getSnapshot().value ?? {};
				this.enabledValue = typeof value.enabled === "boolean" ? value.enabled : true;
				this.selectionValue = typeof value.selection === "string" ? value.selection : "";
				this.modeValue = value.mode === "frame" ? "frame" : "live";
				const rawFit = value.fit;
				this.fitValue = rawFit === "contain" || rawFit === "fill" ? rawFit : "cover";
				this.pauseOnHiddenValue = typeof value.pauseOnHidden === "boolean" ? value.pauseOnHidden : true;
				this.soundValue = typeof value.sound === "boolean" ? value.sound : false;
				this.volumeValue = typeof value.volume === "number" && Number.isFinite(value.volume) ? clamp(value.volume, 0, 100) : 100;
				this.dimValue = typeof value.dim === "number" && Number.isFinite(value.dim) ? clamp(value.dim, 0, 90) : 25;
				this.blurValue = typeof value.wallpaperBlur === "number" && Number.isFinite(value.wallpaperBlur) ? clamp(value.wallpaperBlur, 0, 60) : 0;
				this.dirsValue = Array.isArray(value.weLibraryDirs) ? value.weLibraryDirs.filter((d) => typeof d === "string" && d.trim() !== "") : [];
			}
			/** Resume a policy-blocked video on the first user gesture (#580). */
			onFirstGesture = () => {
				if (this.videoElement === null || !this.videoElement.paused) return;
				this.videoElement.play()?.catch(() => {});
			};
			onVisibility = () => {
				if (!this.pauseOnHiddenValue) return;
				if (this.videoElement !== null) if (this.doc.hidden) this.videoElement.pause();
				else this.videoElement.play()?.catch(() => {});
				const scenePlayer = this.mediaLayer?.firstElementChild ?? null;
				if (scenePlayer instanceof HTMLIFrameElement && scenePlayer.dataset.dshScenePlayer === "") try {
					scenePlayer.contentWindow?.postMessage({
						type: "dsh-set-pause",
						paused: this.doc.hidden
					}, window.location.origin);
				} catch {}
			};
			/** Reconcile the DOM with (enabled, previewing ?? applied, mode, dim, blur). */
			render() {
				if (this.disposed) return;
				const current = this.enabledValue ? this.previewing ?? this.applied : null;
				if (current === null) {
					this.teardownLayers();
					return;
				}
				this.ensureLayers(current);
			}
			ensureLayers(descriptor) {
				if (this.rootNeutralizer === null) {
					this.rootNeutralizer = this.doc.createElement("style");
					this.rootNeutralizer.dataset.dshWallpaperRoot = "";
					this.rootNeutralizer.textContent = `
        [id="root"] { background: transparent; }
        html[data-dsh-wallpaper-active],
        body[data-dsh-wallpaper-active],
        html[data-dsh-skin][data-dsh-wallpaper-active],
        html[data-dsh-skin][data-dsh-wallpaper-active] body,
        html[data-dsh-skin] body[data-dsh-wallpaper-active],
        body[data-dsh-wallpaper-active][data-ds-dark-theme],
        html[data-dsh-wallpaper-active] [id="root"] {
          background-color: transparent !important;
          background-image: none !important;
        }
        /* The composer seat paints an opaque base fade under the input card
           (rc.8: a linear gradient to --dsw-alias-bg-base, z-index 7; some
           builds additionally use a ::before with backdrop-filter). Remove it
           while the WE wallpaper is mounted so the backdrop shows behind the
           input area (issue #734). It is anchored on the stable semantic
           attribute data-composer-seat that the official shell outputs, so it
           does not depend on hashed class names. */
        html[data-dsh-wallpaper-active] [data-composer-seat],
        html[data-dsh-wallpaper-active] [data-composer-seat]::before {
          background: none !important;
          backdrop-filter: none !important;
        }
        /* Full-viewport shell surfaces (AppFrame frame, conversation root,
           details root) paint the opaque app base background via hashed
           CSS-module classes. While a WE wallpaper is mounted the controller
           tags them with the own marker data-dsh-wallpaper-surface
           (markWallpaperSurfaces), and this rule neutralizes them with no
           class-name dependency (issue #734). */
        html[data-dsh-wallpaper-active] [data-dsh-wallpaper-surface] {
          background-color: transparent !important;
          background-image: none !important;
        }
      `;
					this.doc.head.appendChild(this.rootNeutralizer);
				}
				this.doc.body.dataset.dshWallpaperActive = "true";
				this.doc.documentElement.dataset.dshWallpaperActive = "true";
				this.markSurfaces();
				if (this.mediaLayer === null) {
					this.mediaLayer = this.doc.createElement("div");
					styleLayer(this.mediaLayer, -3);
					this.doc.body.appendChild(this.mediaLayer);
				}
				if (this.scrimLayer === null) {
					this.scrimLayer = this.doc.createElement("div");
					styleLayer(this.scrimLayer, -2);
					this.doc.body.appendChild(this.scrimLayer);
				}
				const mediaKey = descriptor.id + ":" + this.modeValue;
				if (this.mediaLayer.dataset.mediaKey !== mediaKey) {
					this.mediaLayer.dataset.mediaKey = mediaKey;
					this.mediaLayer.replaceChildren();
					this.videoElement = null;
					const child = this.buildMedia(descriptor);
					if (child !== null) this.mediaLayer.appendChild(child);
				}
				this.applyFit();
				const blur = this.blurValue > 0 ? "blur(" + String(this.blurValue) + "px)" : "";
				this.mediaLayer.style.filter = blur;
				this.mediaLayer.style.transform = this.blurValue > 0 ? "scale(1.05)" : "";
				this.scrimLayer.style.background = "rgba(0, 0, 0, " + String(this.dimValue / 100) + ")";
			}
			/** Push the current sizing mode onto the mounted media element. */
			applyFit() {
				const child = this.mediaLayer?.firstElementChild ?? null;
				if (child instanceof HTMLElement) styleCover(child, this.fitValue);
				if (child instanceof HTMLIFrameElement && child.dataset.dshScenePlayer === "") try {
					child.contentWindow?.postMessage({
						type: "dsh-set-fit",
						fit: this.fitValue
					}, window.location.origin);
				} catch {}
			}
			/** Build the cover child for one descriptor + mode; null when unrenderable. */
			buildMedia(descriptor) {
				if (descriptor.type === "video") {
					if (this.modeValue === "live" && descriptor.videoUrl !== null) return this.buildVideo(descriptor.videoUrl);
					if (descriptor.videoUrl !== null) return this.buildVideoFrame(descriptor.videoUrl, descriptor.previewUrl);
					return this.buildImage(descriptor.previewUrl);
				}
				if (descriptor.type === "web") {
					if (this.modeValue === "live" && descriptor.webUrl !== null) {
						const iframe = this.doc.createElement("iframe");
						iframe.src = descriptor.webUrl;
						iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
						iframe.setAttribute("tabindex", "-1");
						styleCover(iframe, this.fitValue);
						return iframe;
					}
					return this.buildImage(descriptor.previewUrl);
				}
				if (descriptor.type === "scene") {
					if (this.modeValue === "live" && descriptor.videoUrl !== null) return this.buildVideo(descriptor.videoUrl, descriptor.frameUrl, descriptor.previewUrl);
					if (this.modeValue === "live" && descriptor.sceneUrl) {
						const iframe = this.doc.createElement("iframe");
						iframe.src = descriptor.sceneUrl;
						iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
						iframe.setAttribute("tabindex", "-1");
						iframe.dataset.dshScenePlayer = "";
						styleCover(iframe, this.fitValue);
						iframe.addEventListener("load", () => {
							try {
								iframe.contentWindow?.postMessage({
									type: "dsh-set-fit",
									fit: this.fitValue
								}, window.location.origin);
							} catch {}
						});
						return iframe;
					}
					if (this.modeValue === "frame" && descriptor.videoUrl !== null && descriptor.frameUrl === null) return this.buildVideoFrame(descriptor.videoUrl, descriptor.previewUrl);
					return this.buildImage(descriptor.frameUrl ?? descriptor.previewUrl, descriptor.previewUrl);
				}
				return this.buildImage(descriptor.previewUrl);
			}
			/** Push the persisted sound/volume settings onto the mounted video. */
			applySound() {
				if (this.videoElement === null) return;
				this.videoElement.muted = !this.soundValue;
				this.videoElement.volume = this.volumeValue / 100;
			}
			buildVideo(url, frameUrl = null, previewUrl = null) {
				const video = this.doc.createElement("video");
				video.src = url;
				video.muted = !this.soundValue;
				video.volume = this.volumeValue / 100;
				video.loop = true;
				video.autoplay = true;
				video.playsInline = true;
				video.setAttribute("aria-hidden", "true");
				styleCover(video, this.fitValue);
				this.videoElement = video;
				if (frameUrl !== null || previewUrl !== null) video.addEventListener("error", () => {
					const nextUrl = frameUrl ?? previewUrl;
					const nextFallback = frameUrl !== null ? previewUrl : null;
					const img = this.buildImage(nextUrl, nextFallback);
					if (img && video.parentElement) video.parentElement.replaceChild(img, video);
				}, { once: true });
				video.play()?.catch(() => {});
				return video;
			}
			/** Static-frame mode for video: capture the first frame into an image. */
			buildVideoFrame(url, previewUrl) {
				const image = this.doc.createElement("img");
				styleCover(image, this.fitValue);
				if (previewUrl !== null) image.src = previewUrl;
				const video = this.doc.createElement("video");
				video.muted = true;
				video.playsInline = true;
				video.preload = "auto";
				video.src = url;
				video.addEventListener("loadeddata", () => {
					try {
						const scale = Math.min(1, FRAME_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
						const canvas = this.doc.createElement("canvas");
						canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
						canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
						const context = canvas.getContext("2d");
						if (context === null) return;
						context.drawImage(video, 0, 0, canvas.width, canvas.height);
						image.src = canvas.toDataURL("image/jpeg", .85);
						video.removeAttribute("src");
						video.load();
					} catch {}
				}, { once: true });
				return image;
			}
			buildImage(url, fallbackUrl = null) {
				if (url === null) return null;
				const image = this.doc.createElement("img");
				image.src = url;
				image.alt = "";
				if (fallbackUrl !== null && fallbackUrl !== url) image.addEventListener("error", () => {
					if (image.src !== fallbackUrl) image.src = fallbackUrl;
				}, { once: true });
				styleCover(image, this.fitValue);
				return image;
			}
			/** Tag the official shell full-viewport background surfaces (AppFrame
			* frame, conversation root, details root) and the sidebar workspace-list
			* end fade with the own marker data-dsh-wallpaper-surface so the
			* neutralizer can target them without hashed class names (#734). Idempotent
			* across renders within one mount; untagged on teardown. */
			markSurfaces() {
				const root = this.doc.getElementById("root");
				if (root !== null) {
					const isSurface = this.options.declareSurface ?? defaultWallpaperSurface;
					const stack = [root];
					while (stack.length > 0) {
						const node = stack.pop();
						if (node === void 0) continue;
						if (node instanceof HTMLElement && !node.hasAttribute("data-dsh-wallpaper-surface") && isSurface(node, this.doc)) {
							node.setAttribute("data-dsh-wallpaper-surface", "");
							this.taggedSurfaces.push(node);
						}
						for (const child of Array.from(node.children)) stack.push(child);
					}
				}
				this.markWorkspaceFades();
			}
			/** Tag the sidebar workspaces list-end fade with the same own marker (#734). */
			markWorkspaceFades() {
				const slot = this.doc.querySelector("[data-slot=\"sidebar.workspaces\"]");
				if (slot === null) return;
				const isFade = this.options.declareWorkspaceFade ?? defaultWorkspaceFade;
				const stack = [slot];
				while (stack.length > 0) {
					const node = stack.pop();
					if (node === void 0) continue;
					if (node instanceof HTMLElement && !node.hasAttribute("data-dsh-wallpaper-surface") && isFade(node, this.doc)) {
						node.setAttribute("data-dsh-wallpaper-surface", "");
						this.taggedSurfaces.push(node);
					}
					for (const child of Array.from(node.children)) stack.push(child);
				}
			}
			untagSurfaces() {
				for (const el of this.taggedSurfaces) el.removeAttribute("data-dsh-wallpaper-surface");
				this.taggedSurfaces = [];
			}
			teardownLayers() {
				this.untagSurfaces();
				delete this.doc.body.dataset.dshWallpaperActive;
				delete this.doc.documentElement.dataset.dshWallpaperActive;
				if (this.rootNeutralizer !== null) {
					this.rootNeutralizer.remove();
					this.rootNeutralizer = null;
				}
				if (this.videoElement !== null) {
					this.videoElement.pause();
					this.videoElement = null;
				}
				if (this.mediaLayer !== null) {
					this.mediaLayer.remove();
					this.mediaLayer = null;
				}
				if (this.scrimLayer !== null) {
					this.scrimLayer.remove();
					this.scrimLayer = null;
				}
			}
			publish() {
				for (const listener of this.listeners) listener();
			}
		};
		/** Resolve a persisted selection id against an inventory list: exact id first, then the imported copy. */
		function resolveSelection(wallpapers, selection) {
			return wallpapers.find((w) => w.id === selection) ?? wallpapers.find((w) => w.id === "imported/" + selection);
		}
		/**
		* Restore the persisted wallpaper selection at boot: resolve it against the
		* host inventory and mount it, without waiting for the skin-center panel to
		* open — the panel's mount effect is the only other sync() caller, so a page
		* load with a persisted selection otherwise renders nothing until the card
		* is opened. Best-effort and idempotent: the first non-empty selection wins;
		* the panel re-resolves on open if the inventory is still in flight or fails.
		*/
		function installBootRestore(wallpaper) {
			let synced = false;
			const restore = () => {
				if (synced) return;
				const selected = wallpaper.selection();
				if (selected === "") return;
				synced = true;
				(async () => {
					try {
						const response = await fetch("/api/skin-center/we/inventory");
						if (!response.ok) return;
						const payload = await response.json().catch(() => null);
						if (payload?.ok !== true || !Array.isArray(payload.wallpapers)) return;
						const match = resolveSelection(payload.wallpapers, selected);
						if (match !== void 0) wallpaper.sync(match);
					} catch {}
				})();
			};
			restore();
			wallpaper.subscribe(restore);
		}
		//#endregion
		//#region \0dsh-css:packages/skins/skin-center/src/client/skin-center.module.css.mjs
		const css = "body[data-dsh-skin-center] .eDzMgW_sectionList{margin:0;padding:0;list-style:none}body[data-dsh-skin-center] .eDzMgW_pluginCard{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}body[data-dsh-skin-center] .eDzMgW_pluginCard:hover{border-color:var(--dsw-alias-label-dimmed)}body[data-dsh-skin-center] .eDzMgW_cardHeaderStatic{align-items:center;gap:12px;width:100%;padding:14px 16px;display:flex}body[data-dsh-skin-center] .eDzMgW_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}body[data-dsh-skin-center] .eDzMgW_pluginName{color:var(--dsw-alias-label-primary);align-items:baseline;gap:8px;font-size:15px;font-weight:600;line-height:1.4;display:flex}body[data-dsh-skin-center] .eDzMgW_cardDescription{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}body[data-dsh-skin-center] .eDzMgW_cardBody{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:12px;margin:0 16px;padding:12px 0 8px;display:flex}body[data-dsh-skin-center] .eDzMgW_head{flex-direction:column;gap:6px;display:flex}body[data-dsh-skin-center] .eDzMgW_titleBadge{color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px;font-weight:500}body[data-dsh-skin-center] .eDzMgW_intro{color:var(--dsw-alias-label-secondary,#6b7280);font-size:12.5px;line-height:1.55}body[data-dsh-skin-center] .eDzMgW_themeRow{align-items:center;gap:8px;margin-top:2px;display:flex}body[data-dsh-skin-center] .eDzMgW_themeLabel{color:var(--dsw-alias-label-secondary,#6b7280);margin-right:2px;font-size:12px}body[data-dsh-skin-center] .eDzMgW_themeButton{border:1px solid var(--dsw-alias-border-l3,#cbd5e1);background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#172a45);cursor:pointer;border-radius:6px;padding:5px 10px;font-size:12px;line-height:1;transition:background .12s,border-color .12s,color .12s}body[data-dsh-skin-center] .eDzMgW_themeButton:hover{border-color:var(--dsw-alias-border-l4,#94a3b8)}body[data-dsh-skin-center] .eDzMgW_themeButton:active{border-color:var(--dsw-alias-brand-primary,#2b7cd9);background:var(--dsw-alias-button-primary-dimmed,#e8f1fc);color:var(--dsw-alias-brand-primary,#1e63b8)}body[data-dsh-skin-center] .eDzMgW_themeButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2b7cd9);outline-offset:2px}body[data-dsh-skin-center] .eDzMgW_themeButtonActive{border-color:var(--dsw-alias-brand-primary,#2b7cd9);background:var(--dsw-alias-button-primary-dimmed,#e8f1fc);color:var(--dsw-alias-brand-primary,#1e63b8)}body[data-dsh-skin-center] .eDzMgW_list{flex-direction:column;gap:10px;display:flex}body[data-dsh-skin-center] .eDzMgW_card{border:1px solid var(--dsw-alias-border-l1,#e2e8f0);background:var(--dsw-alias-bg-layer-2,#fff);border-radius:10px;flex-direction:column;gap:8px;padding:12px 14px;display:flex}body[data-dsh-skin-center] .eDzMgW_cardHead{align-items:center;gap:10px;min-width:0;display:flex}body[data-dsh-skin-center] .eDzMgW_swatch{width:14px;height:14px;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l4,#0f172a1f);border-radius:50%;flex:none}body[data-dsh-skin-center] .eDzMgW_cardName{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:13.5px;font-weight:600;overflow:hidden}body[data-dsh-skin-center] .eDzMgW_cardTagline{color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;line-height:1.45}body[data-dsh-skin-center] .eDzMgW_badge{letter-spacing:.02em;border-radius:999px;flex:none;min-width:0;margin-left:auto;padding:2px 8px;font-size:11px;font-weight:600}body[data-dsh-skin-center] .eDzMgW_badgeActive{color:var(--dsw-alias-state-success-primary,#0f6b3a);background:var(--dsw-alias-state-success-tertiary,#dcf3e5)}body[data-dsh-skin-center] .eDzMgW_badgeTrying{color:var(--dsw-alias-brand-primary,#1e63b8);background:var(--dsw-alias-button-primary-dimmed,#e2edfc)}body[data-dsh-skin-center] .eDzMgW_actions{flex-wrap:wrap;align-items:center;gap:8px;display:flex}body[data-dsh-skin-center] .eDzMgW_button{border:1px solid var(--dsw-alias-border-l3,#cbd5e1);background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#172a45);cursor:pointer;border-radius:7px;padding:6px 12px;font-size:12px;line-height:1;transition:background .12s,border-color .12s,color .12s}body[data-dsh-skin-center] .eDzMgW_button:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary,#2b7cd9);color:var(--dsw-alias-brand-primary,#1e63b8)}body[data-dsh-skin-center] .eDzMgW_button:active:not(:disabled){border-color:var(--dsw-alias-button-primary-hover,#1e63b8);background:var(--dsw-alias-button-primary-dimmed,#e8f1fc);color:var(--dsw-alias-brand-primary,#1e63b8)}body[data-dsh-skin-center] .eDzMgW_button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2b7cd9);outline-offset:2px}body[data-dsh-skin-center] .eDzMgW_buttonPrimary{border-color:var(--dsw-alias-brand-primary,#2b7cd9);background:var(--dsw-alias-button-primary-fill,#2b7cd9);color:var(--dsw-alias-label-primary-foreground,#fff)}body[data-dsh-skin-center] .eDzMgW_buttonPrimary:hover:not(:disabled){border-color:var(--dsw-alias-button-primary-hover,#1e63b8);background:var(--dsw-alias-button-primary-hover,#1e63b8);color:var(--dsw-alias-label-primary-foreground,#fff)}body[data-dsh-skin-center] .eDzMgW_buttonPrimary:active:not(:disabled),body[data-dsh-skin-center] .eDzMgW_buttonPrimary:focus-visible:not(:disabled){border-color:var(--dsw-alias-button-primary-hover,#1e63b8);background:var(--dsw-alias-button-primary-hover,#1e63b8)}body[data-dsh-skin-center] .eDzMgW_buttonGhost{background:0 0;border-color:#0000}body[data-dsh-skin-center] .eDzMgW_button:disabled{opacity:.55;cursor:default}body[data-dsh-skin-center] .eDzMgW_error{color:var(--dsw-alias-state-error-primary,#b42318);font-size:12px}body[data-dsh-skin-center] .eDzMgW_enableRow{flex-wrap:wrap;align-items:center;gap:8px;padding:8px 0;display:flex}body[data-dsh-skin-center] .eDzMgW_enableLabel{color:var(--dsw-alias-label-primary,#172a45);font-size:12.5px;font-weight:600}body[data-dsh-skin-center] .eDzMgW_enableHint{min-width:100%;color:var(--dsw-alias-label-secondary,#6b7280);flex:1;margin:0;font-size:12px;line-height:1.5}body[data-dsh-skin-center] .eDzMgW_switch{border:1px solid var(--dsw-alias-border-l3,#cbd5e1);background:var(--dsw-alias-bg-layer-3,#e2e8f0);cursor:pointer;border-radius:999px;flex:none;align-items:center;width:40px;height:22px;padding:2px;transition:background .12s,border-color .12s;display:inline-flex;position:relative}body[data-dsh-skin-center] .eDzMgW_switchOn{border-color:var(--dsw-alias-brand-primary,#2b7cd9);background:var(--dsw-alias-brand-primary,#2b7cd9)}body[data-dsh-skin-center] .eDzMgW_switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2b7cd9);outline-offset:2px}body[data-dsh-skin-center] .eDzMgW_switchThumb{background:var(--dsw-alias-label-primary-foreground,#fff);width:18px;height:18px;box-shadow:0 0 0 1px var(--dsw-alias-border-l4,#0f172a1f);border-radius:50%;transition:transform .12s;display:block;transform:translate(0)}body[data-dsh-skin-center] .eDzMgW_switchOn .eDzMgW_switchThumb{transform:translate(18px)}body[data-dsh-skin-center] .eDzMgW_offNote{color:var(--dsw-alias-label-secondary,#6b7280);margin:0;font-size:12.5px;line-height:1.5}body[data-dsh-skin-center] .eDzMgW_backgroundRow{flex-direction:column;gap:6px;padding:8px 0;display:flex}body[data-dsh-skin-center] .eDzMgW_backgroundHead{align-items:center;gap:8px;display:flex}body[data-dsh-skin-center] .eDzMgW_backgroundLabel{color:var(--dsw-alias-label-primary,#172a45);font-size:12.5px;font-weight:600}body[data-dsh-skin-center] .eDzMgW_backgroundValue{font-variant-numeric:tabular-nums;color:var(--dsw-alias-brand-primary,#2b7cd9);flex:none;margin-left:auto;font-size:12px}body[data-dsh-skin-center] .eDzMgW_backgroundRange{background:var(--dsw-alias-label-tertiary,#9aa4b5);background:color-mix(in srgb, var(--dsw-alias-label-tertiary,#9aa4b5) 45%, transparent);width:100%;height:4px;box-shadow:0 0 0 1px var(--dsw-alias-border-l3,#cbd5e1);-webkit-appearance:none;appearance:none;cursor:pointer;border-radius:999px;margin:0}body[data-dsh-skin-center] .eDzMgW_backgroundRange::-webkit-slider-runnable-track{background:var(--dsw-alias-bg-layer-3,#e2e8f0);border-radius:999px;height:4px}body[data-dsh-skin-center] .eDzMgW_backgroundRange::-moz-range-track{background:var(--dsw-alias-bg-layer-3,#e2e8f0);border-radius:999px;height:4px}body[data-dsh-skin-center] .eDzMgW_backgroundRange::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;border:2px solid var(--dsw-alias-label-primary-foreground,#fff);background:var(--dsw-alias-brand-primary,#2b7cd9);width:14px;height:14px;box-shadow:0 0 0 1px var(--dsw-alias-border-l4,#0f172a1f);cursor:pointer;border-radius:50%}body[data-dsh-skin-center] .eDzMgW_backgroundRange::-moz-range-thumb{border:2px solid var(--dsw-alias-label-primary-foreground,#fff);background:var(--dsw-alias-brand-primary,#2b7cd9);width:12px;height:12px;box-shadow:0 0 0 1px var(--dsw-alias-border-l4,#0f172a1f);cursor:pointer;border-radius:50%}body[data-dsh-skin-center] .eDzMgW_backgroundRange:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2b7cd9);outline-offset:2px}body[data-dsh-skin-center] .eDzMgW_backgroundHint{color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;line-height:1.5}body[data-dsh-skin-center] .eDzMgW_backgroundHintMuted{color:var(--dsw-alias-label-tertiary,#9aa4b5);font-size:12px;line-height:1.5}@media (prefers-reduced-motion:reduce){body[data-dsh-skin-center] .eDzMgW_pluginCard,body[data-dsh-skin-center] .eDzMgW_themeButton,body[data-dsh-skin-center] .eDzMgW_button,body[data-dsh-skin-center] .eDzMgW_switch,body[data-dsh-skin-center] .eDzMgW_switchThumb{transition:none}}body[data-dsh-skin-center] .eDzMgW_wallpaperSection{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:10px;padding-top:10px;display:flex}body[data-dsh-skin-center] .eDzMgW_wallpaperStatus{color:var(--dsw-alias-label-secondary,#6b7280);align-items:center;gap:8px;font-size:12px;display:flex}body[data-dsh-skin-center] .eDzMgW_wallpaperStatusError{color:var(--dsw-alias-state-danger,#c53030)}body[data-dsh-skin-center] .eDzMgW_wallpaperControls{flex-direction:column;gap:10px;display:flex}body[data-dsh-skin-center] .eDzMgW_wallpaperGrid{grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;display:grid}body[data-dsh-skin-center] .eDzMgW_wallpaperCard{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2,#fff);border-radius:10px;flex-direction:column;gap:6px;padding:8px;transition:border-color .16s;display:flex}body[data-dsh-skin-center] .eDzMgW_wallpaperCard:hover{border-color:var(--dsw-alias-label-dimmed)}body[data-dsh-skin-center] .eDzMgW_wallpaperThumbWrap{aspect-ratio:16/9;background:var(--dsw-alias-bg-layer-1,#f1f5f9);border-radius:6px;position:relative;overflow:hidden}body[data-dsh-skin-center] .eDzMgW_wallpaperThumb{object-fit:cover;width:100%;height:100%;display:block}body[data-dsh-skin-center] .eDzMgW_wallpaperThumbEmpty{width:100%;height:100%}body[data-dsh-skin-center] .eDzMgW_wallpaperType{color:var(--dsw-alias-label-primary,#172a45);background:var(--dsw-alias-bg-layer-2,#ffffffd9);border-radius:4px;padding:3px 6px;font-size:10.5px;line-height:1;position:absolute;top:6px;left:6px}body[data-dsh-skin-center] .eDzMgW_wallpaperThumbWrap .eDzMgW_badge{position:absolute;top:6px;right:6px}body[data-dsh-skin-center] .eDzMgW_wallpaperName{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:1.35;overflow:hidden}body[data-dsh-skin-center] .eDzMgW_wallpaperActions{flex-wrap:wrap;gap:6px;display:flex}";
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
			"cardHeaderStatic": "eDzMgW_cardHeaderStatic",
			"cardName": "eDzMgW_cardName",
			"cardTagline": "eDzMgW_cardTagline",
			"enableHint": "eDzMgW_enableHint",
			"enableLabel": "eDzMgW_enableLabel",
			"enableRow": "eDzMgW_enableRow",
			"error": "eDzMgW_error",
			"head": "eDzMgW_head",
			"headText": "eDzMgW_headText",
			"intro": "eDzMgW_intro",
			"list": "eDzMgW_list",
			"offNote": "eDzMgW_offNote",
			"pluginCard": "eDzMgW_pluginCard",
			"pluginName": "eDzMgW_pluginName",
			"sectionList": "eDzMgW_sectionList",
			"swatch": "eDzMgW_swatch",
			"switch": "eDzMgW_switch",
			"switchOn": "eDzMgW_switchOn",
			"switchThumb": "eDzMgW_switchThumb",
			"themeButton": "eDzMgW_themeButton",
			"themeButtonActive": "eDzMgW_themeButtonActive",
			"themeLabel": "eDzMgW_themeLabel",
			"themeRow": "eDzMgW_themeRow",
			"titleBadge": "eDzMgW_titleBadge",
			"wallpaperActions": "eDzMgW_wallpaperActions",
			"wallpaperCard": "eDzMgW_wallpaperCard",
			"wallpaperControls": "eDzMgW_wallpaperControls",
			"wallpaperGrid": "eDzMgW_wallpaperGrid",
			"wallpaperName": "eDzMgW_wallpaperName",
			"wallpaperSection": "eDzMgW_wallpaperSection",
			"wallpaperStatus": "eDzMgW_wallpaperStatus",
			"wallpaperStatusError": "eDzMgW_wallpaperStatusError",
			"wallpaperThumb": "eDzMgW_wallpaperThumb",
			"wallpaperThumbEmpty": "eDzMgW_wallpaperThumbEmpty",
			"wallpaperThumbWrap": "eDzMgW_wallpaperThumbWrap",
			"wallpaperType": "eDzMgW_wallpaperType"
		};
		//#endregion
		//#region src/client/WallpaperPanel.tsx
		/**
		* The wallpaper panel of the skin-center card: lists the user's local
		* Wallpaper Engine library (video / web / scene wallpapers) with live
		* try-on, one-click apply, local import, and render tuning. Rendering and
		* persistence ride the WallpaperController (wallpaper.ts); the library,
		* media, import and scene-frame bytes come from the host's /we routes.
		*
		* Compliance: wallpapers are the user's own local files (their Workshop
		* subscriptions or manual folders). The panel never downloads or shares
		* content; import only copies files within the user's machine.
		*/
		/** Host base path of the wallpaper API (mirrors src/we-routes.ts). */
		const WE_API = "/api/skin-center/we";
		/** Post one wallpaper action and return whether it succeeded. */
		async function postWe(path, id) {
			try {
				const response = await fetch(WE_API + path, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ id })
				});
				const payload = await response.json().catch(() => null);
				if (!response.ok || payload?.ok !== true) return payload?.error ?? "HTTP " + String(response.status);
				return null;
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
		}
		/** The type badge copy key of one wallpaper. */
		function typeKey(item) {
			switch (item.type) {
				case "video": return "wallpaperTypeVideo";
				case "web": return "wallpaperTypeWeb";
				case "scene": return "wallpaperTypeScene";
				default: return "wallpaperTypeApp";
			}
		}
		/** Render the Wallpaper Engine section of the skin-center card. */
		function WallpaperPanel({ t, wallpaper }) {
			const enabled = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.enabled);
			const selection = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.selection);
			const mode = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.mode);
			const fit = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.fit);
			const dim = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.dim);
			const blur = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.wallpaperBlur);
			const pauseOnHidden = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.pauseOnHidden);
			const sound = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.sound);
			const volume = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.volume);
			const activeId = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.activeId);
			const trying = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.trying);
			const dirs = (0, react.useSyncExternalStore)(wallpaper.subscribe, wallpaper.dirs);
			const [dirInput, setDirInput] = (0, react.useState)("");
			const [items, setItems] = (0, react.useState)(null);
			const [installDir, setInstallDir] = (0, react.useState)(null);
			const [loadError, setLoadError] = (0, react.useState)(null);
			const [actionError, setActionError] = (0, react.useState)(null);
			const [workingId, setWorkingId] = (0, react.useState)(null);
			const mounted = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			/** Fetch the inventory and reconcile the mounted layer with the selection. */
			const load = (0, react.useCallback)(() => {
				fetch("/api/skin-center/we/inventory").then(async (response) => {
					const payload = await response.json().catch(() => null);
					if (!mounted.current) return;
					if (!response.ok || payload?.ok !== true || !Array.isArray(payload.wallpapers)) {
						setLoadError(payload?.error ?? "HTTP " + String(response.status));
						setItems([]);
						return;
					}
					setLoadError(null);
					setItems(payload.wallpapers);
					setInstallDir(typeof payload.installDir === "string" ? payload.installDir : null);
					const selected = wallpaper.selection();
					wallpaper.sync(resolveSelection(payload.wallpapers, selected) ?? null);
				}).catch((error) => {
					if (!mounted.current) return;
					setLoadError(error instanceof Error ? error.message : String(error));
					setItems([]);
				});
			}, [wallpaper]);
			(0, react.useEffect)(load, [load]);
			/** Run one import/remove action with the shared busy + error state. */
			const runAction = (id, path, after) => {
				setActionError(null);
				setWorkingId(id);
				postWe(path, id).then((error) => {
					if (!mounted.current) return;
					setWorkingId(null);
					if (error !== null) {
						setActionError(error);
						return;
					}
					after?.();
					load();
				});
			};
			const descriptorOf = (item) => ({
				id: item.id,
				title: item.title,
				type: item.type,
				videoUrl: item.videoUrl,
				webUrl: item.webUrl,
				frameUrl: item.frameUrl,
				sceneUrl: item.sceneUrl,
				previewUrl: item.previewUrl
			});
			/** Whether one entry can be mounted at all in the current mode. */
			const renderable = (item) => item.playable || item.frameUrl !== null || item.previewUrl !== null;
			const activeSelection = selection;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: skin_center_module_css_default.wallpaperSection,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: skin_center_module_css_default.enableRow,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: skin_center_module_css_default.enableLabel,
							title: t("wallpaperEnable"),
							children: t("wallpaperTitle")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "switch",
							"aria-checked": enabled,
							"aria-label": t("wallpaperEnable"),
							className: enabled ? skin_center_module_css_default.switch + " " + skin_center_module_css_default.switchOn : skin_center_module_css_default.switch,
							onClick: () => {
								wallpaper.setEnabled(!enabled);
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: skin_center_module_css_default.switchThumb })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: skin_center_module_css_default.enableHint,
							children: t("wallpaperHint")
						})
					]
				}), enabled && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: skin_center_module_css_default.wallpaperStatus,
						children: [loadError !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: skin_center_module_css_default.wallpaperStatusError,
							children: [
								t("wallpaperLoadError"),
								": ",
								loadError
							]
						}) : items === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("loading") }) : installDir !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							t("wallpaperLibraryFound"),
							" · ",
							items.length
						] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							t("wallpaperLibraryManual"),
							" · ",
							items.length
						] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: skin_center_module_css_default.button,
							onClick: load,
							children: t("wallpaperRefresh")
						})]
					}),
					activeSelection !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: skin_center_module_css_default.wallpaperControls,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: skin_center_module_css_default.themeRow,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: skin_center_module_css_default.themeLabel,
										children: t("wallpaperMode")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: skin_center_module_css_default.themeButton + (mode === "live" ? " " + skin_center_module_css_default.themeButtonActive : ""),
										onClick: () => {
											wallpaper.setMode("live");
										},
										children: t("wallpaperModeLive")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: skin_center_module_css_default.themeButton + (mode === "frame" ? " " + skin_center_module_css_default.themeButtonActive : ""),
										onClick: () => {
											wallpaper.setMode("frame");
										},
										children: t("wallpaperModeFrame")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: skin_center_module_css_default.button + " " + skin_center_module_css_default.buttonGhost,
										onClick: () => {
											wallpaper.clearSelection();
										},
										children: t("wallpaperClear")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: skin_center_module_css_default.themeRow,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: skin_center_module_css_default.themeLabel,
										children: t("wallpaperFit")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: skin_center_module_css_default.themeButton + (fit === "cover" ? " " + skin_center_module_css_default.themeButtonActive : ""),
										onClick: () => {
											wallpaper.setFit("cover");
										},
										children: t("wallpaperFitCover")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: skin_center_module_css_default.themeButton + (fit === "contain" ? " " + skin_center_module_css_default.themeButtonActive : ""),
										onClick: () => {
											wallpaper.setFit("contain");
										},
										children: t("wallpaperFitContain")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: skin_center_module_css_default.themeButton + (fit === "fill" ? " " + skin_center_module_css_default.themeButtonActive : ""),
										onClick: () => {
											wallpaper.setFit("fill");
										},
										children: t("wallpaperFitFill")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: skin_center_module_css_default.backgroundRow,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: skin_center_module_css_default.backgroundHead,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: skin_center_module_css_default.backgroundLabel,
											children: t("wallpaperDim")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: skin_center_module_css_default.backgroundValue,
											"aria-hidden": "true",
											children: [dim, "%"]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: skin_center_module_css_default.backgroundRange,
										type: "range",
										min: "0",
										max: "90",
										step: "5",
										value: dim,
										"aria-label": t("wallpaperDim"),
										onChange: (event) => {
											wallpaper.setDim(Number(event.target.value));
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: skin_center_module_css_default.backgroundHead,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: skin_center_module_css_default.backgroundLabel,
											children: t("wallpaperBlur")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: skin_center_module_css_default.backgroundValue,
											"aria-hidden": "true",
											children: [blur, "px"]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: skin_center_module_css_default.backgroundRange,
										type: "range",
										min: "0",
										max: "60",
										step: "1",
										value: blur,
										"aria-label": t("wallpaperBlur"),
										onChange: (event) => {
											wallpaper.setBlur(Number(event.target.value));
										}
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: skin_center_module_css_default.enableRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: skin_center_module_css_default.enableLabel,
									children: t("wallpaperPauseHidden")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "switch",
									"aria-checked": pauseOnHidden,
									"aria-label": t("wallpaperPauseHidden"),
									className: pauseOnHidden ? skin_center_module_css_default.switch + " " + skin_center_module_css_default.switchOn : skin_center_module_css_default.switch,
									onClick: () => {
										wallpaper.setPauseOnHidden(!pauseOnHidden);
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: skin_center_module_css_default.switchThumb })
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: skin_center_module_css_default.enableRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: skin_center_module_css_default.enableLabel,
									title: t("wallpaperSoundHint"),
									children: t("wallpaperSound")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "switch",
									"aria-checked": sound,
									"aria-label": t("wallpaperSound"),
									className: sound ? skin_center_module_css_default.switch + " " + skin_center_module_css_default.switchOn : skin_center_module_css_default.switch,
									onClick: () => {
										wallpaper.setSound(!sound);
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: skin_center_module_css_default.switchThumb })
								})]
							}),
							sound && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: skin_center_module_css_default.backgroundRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: skin_center_module_css_default.backgroundHead,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: skin_center_module_css_default.backgroundLabel,
										children: t("wallpaperVolume")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: skin_center_module_css_default.backgroundValue,
										"aria-hidden": "true",
										children: [volume, "%"]
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: skin_center_module_css_default.backgroundRange,
									type: "range",
									min: "0",
									max: "100",
									step: "5",
									value: volume,
									"aria-label": t("wallpaperVolume"),
									onChange: (event) => {
										wallpaper.setVolume(Number(event.target.value));
									}
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: skin_center_module_css_default.wallpaperDirs,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: skin_center_module_css_default.themeLabel,
								children: t("wallpaperDirs")
							}),
							dirs.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: skin_center_module_css_default.backgroundHintMuted,
								children: t("wallpaperDirsEmpty")
							}),
							dirs.map((dir) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: skin_center_module_css_default.wallpaperDir,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: skin_center_module_css_default.wallpaperDirPath,
									title: dir,
									children: dir
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: skin_center_module_css_default.wallpaperDirRemove,
									"aria-label": t("wallpaperRemove"),
									onClick: () => {
										wallpaper.removeDir(dir);
										load();
									},
									children: "×"
								})]
							}, dir)),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: skin_center_module_css_default.wallpaperDirAdd,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: skin_center_module_css_default.wallpaperDirInput,
									type: "text",
									value: dirInput,
									placeholder: t("wallpaperDirPlaceholder"),
									onChange: (event) => {
										setDirInput(event.target.value);
									},
									onKeyDown: (event) => {
										if (event.key === "Enter" && dirInput.trim() !== "") {
											wallpaper.addDir(dirInput);
											setDirInput("");
											load();
										}
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: skin_center_module_css_default.button,
									disabled: dirInput.trim() === "",
									onClick: () => {
										wallpaper.addDir(dirInput);
										setDirInput("");
										load();
									},
									children: t("wallpaperDirAdd")
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: skin_center_module_css_default.backgroundHintMuted,
								children: t("wallpaperDirsHint")
							})
						]
					}),
					actionError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: skin_center_module_css_default.error,
						children: actionError
					}),
					items !== null && items.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: skin_center_module_css_default.wallpaperGrid,
						children: items.map((item) => {
							const isApplied = item.id === activeSelection;
							const isMounted = item.id === activeId;
							const busy = workingId === item.id;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: skin_center_module_css_default.wallpaperCard,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: skin_center_module_css_default.wallpaperThumbWrap,
										children: [
											item.previewUrl !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
												className: skin_center_module_css_default.wallpaperThumb,
												src: item.previewUrl,
												alt: "",
												loading: "lazy"
											}) : item.videoUrl !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("video", {
												className: skin_center_module_css_default.wallpaperThumb,
												src: item.videoUrl,
												preload: "metadata",
												muted: true,
												playsInline: true,
												"aria-hidden": "true"
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: skin_center_module_css_default.wallpaperThumbEmpty,
												"aria-hidden": "true"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: skin_center_module_css_default.wallpaperType,
												children: t(typeKey(item))
											}),
											isMounted && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: skin_center_module_css_default.badge + " " + (trying ? skin_center_module_css_default.badgeTrying : skin_center_module_css_default.badgeActive),
												children: trying ? t("tryingOn") : t("active")
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: skin_center_module_css_default.wallpaperName,
										title: item.title,
										children: item.title
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: skin_center_module_css_default.wallpaperActions,
										children: [
											isMounted && trying ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: skin_center_module_css_default.button + " " + skin_center_module_css_default.buttonPrimary,
												onClick: () => {
													wallpaper.exitTryOn();
												},
												children: t("exitTryOn")
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: skin_center_module_css_default.button + " " + skin_center_module_css_default.buttonPrimary,
												disabled: !renderable(item) || isMounted && isApplied || busy,
												onClick: () => {
													wallpaper.tryOn(descriptorOf(item));
												},
												children: t("tryOn")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: skin_center_module_css_default.button,
												disabled: !renderable(item) || isApplied || busy,
												onClick: () => {
													wallpaper.applySelection(descriptorOf(item));
												},
												children: isApplied ? t("active") : t("apply")
											}),
											item.source === "imported" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [item.updateAvailable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: skin_center_module_css_default.button,
												disabled: busy,
												title: t("wallpaperUpdateAvailable"),
												onClick: () => {
													runAction(item.id, "/reimport");
												},
												children: busy ? t("loading") : t("wallpaperReimport")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: skin_center_module_css_default.button + " " + skin_center_module_css_default.buttonGhost,
												disabled: busy,
												onClick: () => {
													runAction(item.id, "/remove", () => {
														if (wallpaper.selection() === item.id) wallpaper.clearSelection();
													});
												},
												children: t("wallpaperRemove")
											})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: skin_center_module_css_default.button,
												disabled: busy,
												title: t("wallpaperImportHint"),
												onClick: () => {
													runAction(item.id, "/import");
												},
												children: busy ? t("loading") : t("wallpaperImport")
											})
										]
									})
								]
							}, item.id);
						})
					}),
					items !== null && items.length === 0 && loadError === null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: skin_center_module_css_default.backgroundHintMuted,
						children: t("wallpaperEmpty")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: skin_center_module_css_default.backgroundHintMuted,
						children: t("wallpaperLegal")
					})
				] })]
			});
		}
		//#endregion
		//#region src/client/SkinCenter.tsx
		/**
		* The skin-center card: rendered as the content of a first-level settings
		* section, listing the official stock look plus every skin in the v2 catalog
		* (built-in asset directories inside the skin-center package + user dirs
		* under $DSH_HOME/skins).
		*
		* v2 architecture (issue #506): skins are pure asset directories loaded by
		* the skin-center runtime. Try-on and apply both go through the same atomic
		* switch engine (src/client/runtime/skin-controller.ts) — try-on simply
		* skips persistence, and apply is one click with NO page reload, no
		* cordis.patch.yml rewrite, no boot-graph regeneration. The "trying on"
		* badge tracks the controller's live state, so closing and reopening the
		* settings panel keeps showing the skin that is still being previewed.
		* Copy rides the standard `t` seat; the theme preview control drives the
		* official theme service (persisted, same as the Appearance row).
		*/
		/** The apply target of the official stock-look card. */
		const OFFICIAL = "official";
		/**
		* Render the skin-center card: a static header naming the plugin, with the
		* always-visible skin list (official default + every catalog skin; try-on /
		* theme preview / one-click apply) rendered below it.
		* @param props - card props.
		* @returns the plugin card.
		*/
		function SkinCenter({ t, runtime, theme, background, wallpaper }) {
			const snapshot = (0, react.useSyncExternalStore)((listener) => theme.subscribe(listener), () => theme.getTheme());
			const enabled = (0, react.useSyncExternalStore)(background.subscribe, background.enabled);
			const opacity = (0, react.useSyncExternalStore)(background.subscribe, background.opacity);
			const blurEmpty = (0, react.useSyncExternalStore)(background.subscribe, background.blurEmpty);
			const blurContent = (0, react.useSyncExternalStore)(background.subscribe, background.blurContent);
			const catalog = (0, react.useSyncExternalStore)(runtime.subscribe, runtime.catalog);
			const state = (0, react.useSyncExternalStore)(runtime.subscribe, runtime.controller.getState);
			const activeId = state.active;
			const previewing = state.previewing;
			const tryingId = state.trying;
			const backdropActive = (activeId === null ? null : runtime.find(activeId))?.manifest.contributes.backgroundMedia !== void 0;
			const [busyId, setBusyId] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const mounted = (0, react.useRef)(false);
			const requestSeq = (0, react.useRef)(0);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			const run = (target, action) => {
				const seq = ++requestSeq.current;
				setError(null);
				setBusyId(target);
				action().catch(() => {
					if (!mounted.current || seq !== requestSeq.current) return;
					setError(t("applyFailed"));
				}).finally(() => {
					if (!mounted.current || seq !== requestSeq.current) return;
					setBusyId(null);
				});
			};
			const tryOn = (entry) => {
				run(entry.manifest.id, () => runtime.controller.tryOn(entry.manifest.id, entry));
			};
			const tryOnOfficial = () => {
				run(OFFICIAL, () => runtime.controller.tryOn(null, null));
			};
			const exitTryOn = () => {
				run(tryingId ?? OFFICIAL, () => runtime.controller.exitTryOn());
			};
			/**
			* One-click apply: atomic client-side switch + persisted selection. No
			* reload, no boot-graph wait — the tapIndex adapter makes the next page
			* load boot straight into this skin.
			* @param target - skin id, or `official` for the stock look.
			*/
			const applySkin = (target) => {
				if (target === OFFICIAL) {
					run(OFFICIAL, () => runtime.controller.switchTo(null, null));
					return;
				}
				const entry = runtime.find(target);
				if (entry === null) {
					setError(t("applyFailed"));
					return;
				}
				run(target, () => runtime.controller.switchTo(target, entry));
			};
			const dark = snapshot.active.colorScheme === "dark";
			/** One row: try-on control + apply button. Shared by the official card and every skin card. */
			const actionButtons = (opts) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: skin_center_module_css_default.actions,
				children: [opts.isActive && !opts.isTrying ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
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
					disabled: busyId === opts.key,
					onClick: opts.onTryOn,
					children: busyId === opts.key ? t("loading") : t("tryOn")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: skin_center_module_css_default.button,
					disabled: busyId !== null,
					onClick: () => {
						applySkin(opts.key);
					},
					children: busyId === opts.key ? t("applying") : opts.applyLabel
				})]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: skin_center_module_css_default.pluginCard,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: skin_center_module_css_default.cardHeaderStatic,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: skin_center_module_css_default.headText,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: skin_center_module_css_default.pluginName,
							children: [t("title"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: skin_center_module_css_default.titleBadge,
								children: String(catalog?.length ?? 0)
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: skin_center_module_css_default.cardDescription,
							title: t("cardDescription"),
							children: t("cardDescription")
						})]
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: skin_center_module_css_default.cardBody,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: skin_center_module_css_default.enableRow,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: skin_center_module_css_default.enableLabel,
								title: t("enabled"),
								children: t("enabled")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								role: "switch",
								"aria-checked": enabled,
								"aria-label": t("enabled"),
								className: enabled ? skin_center_module_css_default.switch + " " + skin_center_module_css_default.switchOn : skin_center_module_css_default.switch,
								onClick: () => {
									background.setEnabled(!enabled);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: skin_center_module_css_default.switchThumb })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: skin_center_module_css_default.enableHint,
								children: t("enabledHint")
							})
						]
					}), enabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
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
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: skin_center_module_css_default.backgroundRow,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: skin_center_module_css_default.backgroundHead,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: skin_center_module_css_default.backgroundLabel,
										children: t("backgroundBlurEmpty")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: skin_center_module_css_default.backgroundValue,
										"aria-hidden": "true",
										children: [blurEmpty, "px"]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									id: "skin-center-background-blur-empty",
									className: skin_center_module_css_default.backgroundRange,
									type: "range",
									min: "0",
									max: "20",
									step: "1",
									value: blurEmpty,
									"aria-valuetext": `${blurEmpty}px`,
									"aria-label": t("backgroundBlurEmpty"),
									onChange: (event) => {
										background.setBlurEmpty(Number(event.target.value));
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: skin_center_module_css_default.backgroundHead,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: skin_center_module_css_default.backgroundLabel,
										children: t("backgroundBlurContent")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: skin_center_module_css_default.backgroundValue,
										"aria-hidden": "true",
										children: [blurContent, "px"]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									id: "skin-center-background-blur-content",
									className: skin_center_module_css_default.backgroundRange,
									type: "range",
									min: "0",
									max: "20",
									step: "1",
									value: blurContent,
									"aria-valuetext": `${blurContent}px`,
									"aria-label": t("backgroundBlurContent"),
									onChange: (event) => {
										background.setBlurContent(Number(event.target.value));
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: backdropActive ? skin_center_module_css_default.backgroundHint : skin_center_module_css_default.backgroundHintMuted,
									children: backdropActive ? t("backgroundBlurHint") : t("backgroundBlurInert")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WallpaperPanel, {
							t,
							wallpaper
						}),
						error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: skin_center_module_css_default.error,
							children: error
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: skin_center_module_css_default.list,
							children: [(() => {
								const isActive = activeId === null && !previewing;
								const isTrying = previewing && tryingId === null;
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
							})(), (catalog ?? []).map((entry) => {
								const id = entry.manifest.id;
								const isActive = id === activeId && !previewing;
								const isTrying = previewing && id === tryingId;
								const badge = isActive ? t("active") : isTrying ? t("tryingOn") : null;
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: skin_center_module_css_default.card,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: skin_center_module_css_default.cardHead,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: skin_center_module_css_default.swatch,
													style: { background: entry.manifest.accent ?? "#98a1ab" },
													"aria-hidden": "true"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: skin_center_module_css_default.cardName,
													title: entry.manifest.nameEn,
													children: entry.manifest.nameEn
												}),
												badge !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: `${skin_center_module_css_default.badge} ${isActive ? skin_center_module_css_default.badgeActive : skin_center_module_css_default.badgeTrying}`,
													children: badge
												})
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: skin_center_module_css_default.cardTagline,
											title: entry.manifest.tagline ?? "",
											children: entry.manifest.tagline ?? ""
										}),
										actionButtons({
											key: id,
											isActive,
											isTrying,
											onTryOn: () => {
												tryOn(entry);
											},
											applyLabel: t("apply")
										})
									]
								}, id);
							})]
						})
					] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: skin_center_module_css_default.offNote,
						role: "status",
						children: t("offNote")
					})]
				})]
			});
		}
		/** Render the skin-center card as a first-level settings page. */
		function SkinCenterSection(props) {
			const { t, runtime, theme, background, wallpaper } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
				className: skin_center_module_css_default.sectionList,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkinCenter, {
					t,
					runtime,
					theme,
					background,
					wallpaper
				})
			});
		}
		//#endregion
		//#region src/client/background.ts
		/** The namespace string the Host registers (mirrors src/index.ts). */
		const SKIN_BACKGROUND_NS = "skin-background";
		/** Field of the background value inside the namespace section. */
		const OPACITY_FIELD = "backgroundOpacity";
		/** Field of the empty-conversation backdrop blur inside the namespace section. */
		const BLUR_EMPTY_FIELD = "backgroundBlurEmpty";
		/** Field of the with-content backdrop blur inside the namespace section. */
		const BLUR_CONTENT_FIELD = "backgroundBlurContent";
		/** CSS custom property written to document.body and read by backdrop skins. */
		const SCRIM_VAR = "--dsw-skin-scrim";
		/**
		* Selector for a conversation message row inside the shell's center column.
		* Official shell message rows carry `data-chat-anchor-key`; the
		* `data-pane="conversation"` attribute is stamped by the dsh-web-ui-all compat
		* shim on the center column, where the _userRow / _compactionRow /
		* _contextRow / _turnErrorRow suffixes are CSS-module message-row classes
		* (hash prefix varies, suffix is stable).
		*/
		const CONVERSATION_CONTENT_SELECTOR = [
			"[data-chat-anchor-key]",
			"[data-pane=\"conversation\"] [class*=\"_userRow\"]",
			"[data-pane=\"conversation\"] [class*=\"_compactionRow\"]",
			"[data-pane=\"conversation\"] [class*=\"_contextRow\"]",
			"[data-pane=\"conversation\"] [class*=\"_turnErrorRow\"]"
		].join(", ");
		/**
		* Own the skin-background scope: read the latest occlusion + blur strengths,
		* apply them to the body instantly, and persist changes through the settings
		* scope.
		*/
		var BackgroundController = class {
			enabledValue = true;
			opacityValue = 0;
			blurEmptyValue = 0;
			blurContentValue = 0;
			listeners = /* @__PURE__ */ new Set();
			scope;
			/** The fixed backdrop-filter element, present only while active blur > 0. */
			blurElement = null;
			/** The body MutationObserver, installed lazily once a blur is active. */
			observer = null;
			/** Pending requestAnimationFrame id for a coalesced recheck. */
			rafId = null;
			/** Guard: after dispose no scheduled work may reinstall anything. */
			disposed = false;
			/**
			* @param scope - the bound skin-background settings scope.
			*/
			constructor(scope) {
				this.scope = scope;
				this.enabledValue = this.readEnabled();
				this.opacityValue = this.readOpacity();
				this.blurEmptyValue = this.readBlur(BLUR_EMPTY_FIELD);
				this.blurContentValue = this.readBlur(BLUR_CONTENT_FIELD);
				this.applyOcclusion();
				this.syncBlur();
				scope.subscribe(() => {
					this.enabledValue = this.readEnabled();
					this.opacityValue = this.readOpacity();
					this.blurEmptyValue = this.readBlur(BLUR_EMPTY_FIELD);
					this.blurContentValue = this.readBlur(BLUR_CONTENT_FIELD);
					this.applyOcclusion();
					this.syncBlur();
					this.publish();
				});
			}
			enabled = () => this.enabledValue;
			setEnabled(value) {
				this.enabledValue = value;
				this.applyOcclusion();
				this.syncBlur();
				this.publish();
				this.scope.set("enabled", value);
			}
			opacity = () => this.opacityValue;
			blurEmpty = () => this.blurEmptyValue;
			blurContent = () => this.blurContentValue;
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			set(opacity) {
				const clamped = Math.max(0, Math.min(100, Math.round(opacity)));
				this.opacityValue = clamped;
				this.applyOcclusion();
				this.publish();
				this.scope.set(OPACITY_FIELD, clamped);
			}
			setBlurEmpty(value) {
				const clamped = this.clampBlur(value);
				this.blurEmptyValue = clamped;
				this.ensureObserver();
				this.syncBlur();
				this.publish();
				this.scope.set(BLUR_EMPTY_FIELD, clamped);
			}
			setBlurContent(value) {
				const clamped = this.clampBlur(value);
				this.blurContentValue = clamped;
				this.ensureObserver();
				this.syncBlur();
				this.publish();
				this.scope.set(BLUR_CONTENT_FIELD, clamped);
			}
			dispose() {
				this.disposed = true;
				if (this.rafId !== null) {
					cancelAnimationFrame(this.rafId);
					this.rafId = null;
				}
				this.removeBlurElement();
				if (this.observer !== null) {
					this.observer.disconnect();
					this.observer = null;
				}
			}
			/** The effective master-switch section value, defaulting to true when absent. */
			readEnabled() {
				const raw = this.scope.getSnapshot().value?.enabled;
				return typeof raw !== "boolean" ? true : raw;
			}
			/** The effective occlusion section value, clamped 0-100, defaulting to 0. */
			readOpacity() {
				const raw = this.scope.getSnapshot().value?.backgroundOpacity;
				if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
				return Math.max(0, Math.min(100, raw));
			}
			/** The effective blur section value for one field, clamped 0-20, defaulting to 0. */
			readBlur(field) {
				const raw = this.scope.getSnapshot().value?.[field];
				if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
				return this.clampBlur(raw);
			}
			clampBlur(value) {
				return Math.max(0, Math.min(20, Math.round(value)));
			}
			/** Write the current occlusion onto the body CSS variable (0..1 alpha). */
			applyOcclusion() {
				if (!this.enabledValue) {
					document.body.style.removeProperty(SCRIM_VAR);
					return;
				}
				document.body.style.setProperty(SCRIM_VAR, String(this.opacityValue / 100));
			}
			/**
			* Apply the active blur: empty or with-content strength depending on the
			* conversation state. A value > 0 ensures the fixed blur element exists
			* with the matching backdrop-filter; 0 removes it.
			*/
			syncBlur() {
				if (this.disposed) return;
				if (!this.enabledValue) {
					this.removeBlurElement();
					return;
				}
				this.ensureObserver();
				const active = this.hasConversationContent() ? this.blurContentValue : this.blurEmptyValue;
				if (active > 0) this.ensureBlurElement(active);
				else this.removeBlurElement();
			}
			/** True when the conversation pane hosts at least one message row. */
			hasConversationContent() {
				return document.querySelector(CONVERSATION_CONTENT_SELECTOR) !== null;
			}
			/** Create (if needed) and size the fixed backdrop-filter element. */
			ensureBlurElement(active) {
				if (this.blurElement === null) {
					const element = document.createElement("div");
					element.style.position = "fixed";
					element.style.inset = "0";
					element.style.zIndex = "-1";
					element.style.pointerEvents = "none";
					element.setAttribute("aria-hidden", "true");
					this.blurElement = element;
					document.body.appendChild(element);
				}
				const blur = "blur(" + active + "px)";
				this.blurElement.style.backdropFilter = blur;
				this.blurElement.style.setProperty("-webkit-backdrop-filter", blur);
			}
			/** Remove the fixed blur element, if present. */
			removeBlurElement() {
				if (this.blurElement === null) return;
				this.blurElement.remove();
				this.blurElement = null;
			}
			/**
			* Install the MutationObserver on document.body only when either blur
			* field is active, so a fully-disabled blur never pays the observation
			* cost. Runs lazily on the first non-zero set.
			*/
			ensureObserver() {
				if (this.disposed || this.observer !== null) return;
				if (this.blurEmptyValue <= 0 && this.blurContentValue <= 0) return;
				this.observer = new MutationObserver(() => this.scheduleRecheck());
				this.observer.observe(document.body, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: ["class"]
				});
			}
			/** Coalesce burst mutations into one rAF-delayed recheck. */
			scheduleRecheck() {
				if (this.disposed || this.rafId !== null) return;
				this.rafId = requestAnimationFrame(() => {
					this.rafId = null;
					if (this.disposed) return;
					this.syncBlur();
				});
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
			enabled: "Enable skin center",
			enabledHint: "When off, try-on, apply and background controls are disabled; turn it back on to resume.",
			offNote: "The skin center is turned off.",
			intro: "Try on any skin live — it takes effect instantly, exit restores the current look. Apply persists it across restarts.",
			official: "Official default",
			officialTagline: "The stock DSH look with no skin applied.",
			active: "Active",
			tryingOn: "Trying on",
			tryOn: "Try on",
			loading: "Loading…",
			exitTryOn: "Exit try-on",
			apply: "Apply",
			applying: "Applying…",
			restore: "Restore",
			applyFailed: "Apply failed",
			appliedUnconfirmed: "Applied, but the change has not been confirmed — refresh the page in dev mode; packaged installs (DSH Desktop) need an app restart",
			appliedNeedRestart: "Applied and confirmed, but the host did not hot-reload — restart dsh to take effect",
			theme: "Theme preview",
			themeLight: "Light",
			themeDark: "Dark",
			tryOnError: "Try-on failed — see console",
			backgroundOpacity: "Background occlusion",
			backgroundBlurEmpty: "Blur when empty",
			backgroundBlurContent: "Blur with content",
			backgroundBlurHint: "Applies a separate Gaussian blur to the backdrop for the empty conversation and the conversation with content; 0 disables.",
			backgroundBlurInert: "Visible only with skins that paint a backdrop; the official default has none.",
			backgroundHint: "Instantly veils the backdrop behind the panels — higher values obscure the art to help you focus.",
			backgroundHintInert: "Only applies to skins that paint a backdrop (Blue Fantasy / Whale Song). Applies to the official default automatically once such a skin is active.",
			wallpaperTitle: "Wallpaper Engine",
			wallpaperEnable: "Enable wallpapers",
			wallpaperHint: "Use your local Wallpaper Engine library as the GUI backdrop: video, web, and scene wallpapers render live (scene wallpapers need WebGL).",
			wallpaperLoadError: "Wallpaper library failed to load",
			wallpaperLibraryFound: "Wallpaper Engine library detected",
			wallpaperLibraryManual: "Manual folders only (no Wallpaper Engine install found; set folders in the skin-wallpaper settings)",
			wallpaperRefresh: "Refresh",
			wallpaperMode: "Render mode",
			wallpaperModeLive: "Live",
			wallpaperModeFrame: "Static frame",
			wallpaperFit: "Sizing mode",
			wallpaperFitCover: "Cover (fill)",
			wallpaperFitContain: "Fit (entire image)",
			wallpaperFitFill: "Stretch",
			wallpaperClear: "Turn off wallpaper",
			wallpaperDim: "Wallpaper dimming",
			wallpaperBlur: "Wallpaper blur",
			wallpaperPauseHidden: "Pause when window hidden",
			wallpaperSound: "Wallpaper sound",
			wallpaperSoundHint: "Play video wallpaper audio. The browser may keep it silent until you click or press a key once.",
			wallpaperVolume: "Wallpaper volume",
			wallpaperImport: "Import",
			wallpaperImportHint: "Copy this wallpaper into local storage, so it keeps working even if the Steam library moves or changes",
			wallpaperReimport: "Update",
			wallpaperRemove: "Remove",
			wallpaperUpdateAvailable: "The workshop original changed since import — update the local copy",
			wallpaperEmpty: "No wallpapers found. Subscribe in the Wallpaper Engine workshop, or add manual folders to the skin-wallpaper settings.",
			wallpaperLegal: "Wallpapers belong to their Workshop authors. Everything stays on this machine for personal use; nothing is uploaded or shared.",
			wallpaperTypeVideo: "Video",
			wallpaperTypeWeb: "Web",
			wallpaperTypeScene: "Scene (static)",
			wallpaperTypeApp: "Unsupported",
			wallpaperDirs: "Manual folders",
			wallpaperDirsEmpty: "No manual folders yet.",
			wallpaperDirsHint: "No Wallpaper Engine (e.g. macOS)? Point a folder at any .mp4/.webm files, a wallpaper project folder, or a folder of projects — they become your wallpaper library.",
			wallpaperDirPlaceholder: "/path/to/wallpapers or ~/Movies/wallpapers",
			wallpaperDirAdd: "Add"
		};
		const zh = {
			title: "皮肤中心",
			cardDescription: "在 GUI 内即时试穿任意皮肤，退出即完全还原；应用一键完成并自动刷新。",
			enabled: "启用皮肤中心",
			enabledHint: "关闭后停用试穿、应用与背景控件，重新打开即恢复。",
			offNote: "皮肤中心已关闭。",
			intro: "任意皮肤可即时试穿，退出即完全还原；「应用」一键持久化，页面自动刷新生效。",
			official: "官方默认",
			officialTagline: "还原 DSH 官方默认外观，不应用任何皮肤。",
			active: "当前激活",
			tryingOn: "试穿中",
			tryOn: "试穿",
			loading: "加载中…",
			exitTryOn: "退出试穿",
			apply: "应用",
			applying: "应用中…",
			restore: "恢复默认",
			applyFailed: "应用失败",
			appliedUnconfirmed: "已写入配置但尚未确认生效——开发模式请刷新页面；打包版（DSH Desktop）需重启应用后生效",
			appliedNeedRestart: "已写入配置并确认生效，但宿主未热重载——请重启 dsh 后生效",
			theme: "主题预览",
			themeLight: "亮色",
			themeDark: "暗色",
			tryOnError: "试穿失败，详见控制台",
			backgroundOpacity: "背景遮挡",
			backgroundBlurEmpty: "空对话背景模糊",
			backgroundBlurContent: "有对话背景模糊",
			backgroundBlurHint: "对话为空与有内容时分别应用不同的背景高斯模糊强度，0 为关闭。",
			backgroundBlurInert: "仅对带背景图插画的皮肤可见；官方默认无背景图。",
			backgroundHint: "即时为面板背后的背景加遮罩——数值越高越能弱化插画，帮你集中注意力。",
			backgroundHintInert: "仅对带背景图插画的皮肤（蓝色幻想 / 鲸吟）生效；官方默认无背景图，该滑块对这些皮肤自动生效。",
			wallpaperTitle: "Wallpaper Engine",
			wallpaperEnable: "启用动态壁纸",
			wallpaperHint: "把本机 Wallpaper Engine 壁纸库用作 GUI 背景：视频、网页与场景壁纸均动态渲染（场景壁纸需要 WebGL）。",
			wallpaperLoadError: "壁纸库加载失败",
			wallpaperLibraryFound: "已检测到 Wallpaper Engine 壁纸库",
			wallpaperLibraryManual: "仅手动目录（未检测到 Wallpaper Engine 安装，可在 skin-wallpaper 设置里添加目录）",
			wallpaperRefresh: "刷新",
			wallpaperMode: "渲染模式",
			wallpaperModeLive: "动态",
			wallpaperModeFrame: "静态帧",
			wallpaperFit: "适应方式",
			wallpaperFitCover: "铺满裁剪",
			wallpaperFitContain: "完整缩放",
			wallpaperFitFill: "拉伸铺满",
			wallpaperClear: "关闭壁纸",
			wallpaperDim: "壁纸暗化",
			wallpaperBlur: "壁纸模糊",
			wallpaperPauseHidden: "窗口隐藏时暂停",
			wallpaperSound: "壁纸声音",
			wallpaperSoundHint: "播放视频壁纸的声音。浏览器可能在首次点击或按键前保持静音。",
			wallpaperVolume: "壁纸音量",
			wallpaperImport: "导入",
			wallpaperImportHint: "把该壁纸复制到本地存储，Steam 库迁移或变动后仍可继续使用",
			wallpaperReimport: "更新",
			wallpaperRemove: "移除",
			wallpaperUpdateAvailable: "工坊原件在导入后有更新——同步更新本地副本",
			wallpaperEmpty: "未发现壁纸。可先在 Wallpaper Engine 创意工坊订阅，或在 skin-wallpaper 设置里添加手动目录。",
			wallpaperLegal: "壁纸素材版权归创意工坊作者所有，仅供本机个人使用，不上传、不分享。",
			wallpaperTypeVideo: "视频",
			wallpaperTypeWeb: "网页",
			wallpaperTypeScene: "场景(静态)",
			wallpaperTypeApp: "不支持",
			wallpaperDirs: "手动目录",
			wallpaperDirsEmpty: "还没有手动目录。",
			wallpaperDirsHint: "没有 Wallpaper Engine（如 macOS）？把任意 .mp4/.webm 视频、单个壁纸项目文件夹或项目合集文件夹加进来，就是你的壁纸库。",
			wallpaperDirPlaceholder: "/path/to/wallpapers 或 ~/Movies/wallpapers",
			wallpaperDirAdd: "添加"
		};
		//#endregion
		//#region src/client/runtime/effect-ledger.ts
		function createEffectLedger(now = () => Date.now()) {
			let seq = 0;
			let nextActivation = 1;
			const log = [];
			const live = /* @__PURE__ */ new Map();
			const disposed = /* @__PURE__ */ new Set();
			function push(activationId, kind, label, replacesSeq) {
				seq += 1;
				log.push({
					seq,
					activationId,
					kind,
					label,
					replacesSeq,
					at: now()
				});
				return seq;
			}
			function release(effect, activationId) {
				if (effect.released) return;
				effect.released = true;
				push(activationId, "release", effect.label);
				try {
					effect.teardown();
				} catch {
					push(activationId, "cleanup-failed", effect.label);
				}
			}
			return {
				beginActivation() {
					const id = nextActivation++;
					live.set(id, []);
					push(id, "create", "activation");
					return id;
				},
				record(activationId, label, teardown) {
					const bucket = live.get(activationId);
					if (!bucket || disposed.has(activationId)) throw new Error(`effect "${label}" recorded on disposed/unknown activation ${activationId}`);
					const entrySeq = push(activationId, "create", label);
					bucket.push({
						seq: entrySeq,
						label,
						teardown,
						released: false
					});
					return entrySeq;
				},
				replace(activationId, label, previousSeq, teardown) {
					const bucket = live.get(activationId);
					if (!bucket || disposed.has(activationId)) throw new Error(`effect "${label}" replaced on disposed/unknown activation ${activationId}`);
					if (previousSeq !== void 0) {
						const previous = bucket.find((e) => e.seq === previousSeq);
						if (previous) release(previous, activationId);
					}
					const entrySeq = push(activationId, "replace", label, previousSeq);
					bucket.push({
						seq: entrySeq,
						label,
						teardown,
						released: false
					});
					return entrySeq;
				},
				disposeActivation(activationId) {
					if (disposed.has(activationId)) return;
					disposed.add(activationId);
					const bucket = live.get(activationId) ?? [];
					for (const effect of [...bucket].reverse()) release(effect, activationId);
				},
				isDisposed(activationId) {
					return disposed.has(activationId);
				},
				entries() {
					return log;
				}
			};
		}
		//#endregion
		//#region src/client/runtime/semantic-adapter.ts
		/**
		* The v1 rule table. Single ownership: only the skin-center edits this.
		* Anchors verified against @deepseek-ai rc.7 (see docs/archive survey).
		*/
		const SEMANTIC_RULES_V1 = [
			{
				selector: "[data-slot=\"root\"]",
				attrs: [["data-dsh-surface", "root"]],
				note: "ui-renderer root outlet"
			},
			{
				selector: "[data-slot=\"sidebar\"]",
				attrs: [["data-dsh-surface", "sidebar"]],
				note: "layout sidebar outlet"
			},
			{
				selector: "[data-slot=\"conversation\"]",
				attrs: [["data-dsh-surface", "conversation"]],
				note: "layout conversation outlet"
			},
			{
				selector: "[data-slot=\"conversation.session.header\"]",
				attrs: [["data-dsh-surface", "session-header"]],
				note: "conversation header outlet"
			},
			{
				selector: "[data-slot=\"conversation.composer\"]",
				attrs: [["data-dsh-surface", "composer"]],
				note: "composer chain outlet"
			},
			{
				selector: "[data-slot=\"details\"]",
				attrs: [["data-dsh-surface", "details"]],
				note: "layout details outlet"
			},
			{
				selector: "[data-shell-overlay]",
				attrs: [["data-dsh-surface", "overlay"]],
				note: "frame overlay attribute"
			},
			{
				selector: "[data-slot=\"shell.overlay\"]",
				attrs: [["data-dsh-surface", "overlay"]],
				note: "shell overlay outlet"
			},
			{
				selector: "[role=\"dialog\"]:has([data-slot=\"settings.section\"])",
				attrs: [["data-dsh-surface", "settings"]],
				note: "settings dialog (composite: dialog containing the section outlet)"
			},
			{
				selector: "[data-chat-flow-kind]",
				attrs: [["data-dsh-part", "message-row"]],
				note: "chat flow item"
			},
			{
				selector: "[data-streaming]",
				attrs: [["data-dsh-part", "message-body"]],
				note: "assistant markdown root"
			},
			{
				selector: "[data-conversation-scroll]",
				attrs: [["data-dsh-part", "scrollport"]],
				note: "conversation scrollport"
			},
			{
				selector: "textarea[data-phase]",
				attrs: [["data-dsh-part", "composer-input"]],
				note: "composer textarea"
			},
			{
				selector: "[data-decoration=\"chip\"]",
				attrs: [["data-dsh-part", "composer-chip"]],
				note: "composer reference chip"
			},
			{
				selector: "[data-queue-dock]",
				attrs: [["data-dsh-part", "queue-dock"]],
				note: "queued turns dock"
			},
			{
				selector: "[data-turn-tail]",
				attrs: [["data-dsh-part", "turn-tail"]],
				note: "turn tail row"
			},
			{
				selector: "[data-side]",
				attrs: [["data-dsh-part", "resize-handle"]],
				note: "column resize handle"
			},
			{
				selector: "[data-dsh-taskboard-view], [data-dsh-taskboard-board], [data-dsh-taskboard-entry]",
				attrs: [["data-dsh-plugin", "task-board"]],
				note: "task-board panel/board/sidebar entry"
			},
			{
				selector: "[data-dsh-ssh-view], [data-dsh-ssh-entry]",
				attrs: [["data-dsh-plugin", "ssh"]],
				note: "ssh panel/sidebar entry"
			},
			{
				selector: "[data-gitgraph-chip-anchor], [data-gitgraph-dialog]",
				attrs: [["data-dsh-plugin", "git-graph"]],
				note: "git-graph chip/dialog"
			},
			{
				selector: "[data-dsh-pet-root]",
				attrs: [["data-dsh-plugin", "pet"]],
				note: "pet global root"
			},
			{
				selector: "[data-dsh-taskboard-entry], [data-dsh-ssh-entry]",
				attrs: [["data-dsh-part", "sidebar-entry"]],
				note: "shared injected sidebar entry rows"
			}
		];
		function createSemanticAdapter(doc) {
			const rules = SEMANTIC_RULES_V1.map((rule) => ({
				rule,
				usable: true,
				matchedInPass: 0
			}));
			let observer = null;
			let stamped = 0;
			let running = false;
			const applyRule = (live, el) => {
				if (!live.usable) return;
				let hit = false;
				try {
					hit = el.matches(live.rule.selector);
				} catch {
					live.usable = false;
					return;
				}
				if (!hit) return;
				live.matchedInPass += 1;
				for (const [name, value] of live.rule.attrs) if (el.getAttribute(name) !== value) {
					el.setAttribute(name, value);
					stamped += 1;
				}
			};
			const applyToTree = (rootEl) => {
				for (const live of rules) {
					if (!live.usable) continue;
					applyRule(live, rootEl);
					let matches = [];
					try {
						matches = Array.from(rootEl.querySelectorAll(live.rule.selector));
					} catch {
						live.usable = false;
						continue;
					}
					for (const el of matches) applyRule(live, el);
				}
			};
			const fullPass = () => {
				for (const live of rules) live.matchedInPass = 0;
				if (doc.documentElement) applyToTree(doc.documentElement);
			};
			return {
				get running() {
					return running;
				},
				start() {
					if (running) return;
					running = true;
					fullPass();
					observer = new doc.defaultView.MutationObserver((records) => {
						try {
							for (const record of records) for (const node of Array.from(record.addedNodes)) if (node.nodeType === 1) applyToTree(node);
						} catch {}
					});
					observer.observe(doc.body ?? doc.documentElement, {
						childList: true,
						subtree: true
					});
				},
				stop() {
					running = false;
					observer?.disconnect();
					observer = null;
				},
				diagnostics() {
					return {
						invalidRules: rules.filter((r) => !r.usable).map((r) => r.rule.selector),
						unmatchedRules: rules.filter((r) => r.usable && r.matchedInPass === 0).map((r) => r.rule.selector),
						stamped
					};
				}
			};
		}
		//#endregion
		//#region src/client/runtime/decoration-layers.ts
		const LAYER_ATTR = "data-dsh-skin-layer";
		/**
		* Per-layer paint order. The background sits at -2: negative z-index
		* elements paint ABOVE the html/body backgrounds (so a skin's own opaque
		* root background-color renders BEHIND its art — the v1 layering) yet below
		* every panel surface. It shares -2 with the WE scrim, which never paints
		* at the same time (an active WE wallpaper suppresses skin media, enforced
		* by the controller). The skin-background blur veil (-1) still samples the
		* art above it. Ambient effects paint above the veils; the strip/foreground
		* layers stay below the official overlay band (>=1000).
		*/
		const LAYER_STYLE = {
			background: "position:fixed;top:0;right:0;bottom:0;left:0;z-index:-2;pointer-events:none;",
			ambient: "position:fixed;top:0;right:0;bottom:0;left:0;z-index:30;pointer-events:none;",
			top: "position:fixed;top:0;left:0;right:0;z-index:40;pointer-events:none;",
			bottom: "position:fixed;bottom:0;left:0;right:0;z-index:40;pointer-events:none;",
			sidebar: "position:fixed;top:0;bottom:0;left:0;z-index:40;pointer-events:none;",
			foreground: "position:fixed;top:0;right:0;bottom:0;left:0;z-index:41;pointer-events:none;"
		};
		function ensureOne(doc, name) {
			const existing = doc.querySelector(`[${LAYER_ATTR}="${name}"]`);
			if (existing) {
				existing.style.cssText = LAYER_STYLE[name];
				return existing;
			}
			const el = doc.createElement("div");
			el.setAttribute(LAYER_ATTR, name);
			el.setAttribute("aria-hidden", "true");
			el.style.cssText = LAYER_STYLE[name];
			doc.body.appendChild(el);
			return el;
		}
		/**
		* Ensure all six layers exist and return their handles. Idempotent; safe to
		* call on every activation.
		*/
		function ensureDecorationLayers(doc) {
			return {
				background: ensureOne(doc, "background"),
				ambient: ensureOne(doc, "ambient"),
				top: ensureOne(doc, "top"),
				bottom: ensureOne(doc, "bottom"),
				sidebar: ensureOne(doc, "sidebar"),
				foreground: ensureOne(doc, "foreground")
			};
		}
		//#endregion
		//#region src/client/runtime/skin-controller.ts
		function createSkinController(deps) {
			const doc = deps.doc;
			const ledger = deps.ledger;
			const apiBase = deps.apiBase ?? "/api/skin-center/v2";
			const fetchImpl = deps.fetchImpl ?? fetch.bind(doc.defaultView);
			const layers = ensureDecorationLayers(doc);
			const onError = deps.onError ?? (() => {});
			const themeGet = deps.themeGet ?? (() => doc.body?.hasAttribute("data-ds-dark-theme") ? "dark" : "light");
			const themeSubscribe = deps.themeSubscribe ?? ((listener) => {
				let last = themeGet();
				const observer = new doc.defaultView.MutationObserver(() => {
					const next = themeGet();
					if (next !== last) {
						last = next;
						listener(next);
					}
				});
				if (doc.body) observer.observe(doc.body, {
					attributes: true,
					attributeFilter: ["data-ds-dark-theme"]
				});
				return () => observer.disconnect();
			});
			const loadStylesheet = deps.loadStylesheet ?? ((href) => new Promise((resolveLink, rejectLink) => {
				const link = doc.createElement("link");
				link.rel = "stylesheet";
				link.href = href;
				const timer = setTimeout(() => rejectLink(/* @__PURE__ */ new Error(`stylesheet load timeout: ${href}`)), 15e3);
				link.onload = () => {
					clearTimeout(timer);
					resolveLink();
				};
				link.onerror = () => {
					clearTimeout(timer);
					rejectLink(/* @__PURE__ */ new Error(`stylesheet load failed: ${href}`));
				};
				doc.head.appendChild(link);
			}));
			let latestRequest = 0;
			let currentActivation = null;
			const initialSkinId = doc.documentElement?.getAttribute("data-dsh-skin") || null;
			let active = initialSkinId;
			/** The committed selection try-on restores (component scope). */
			let committed = {
				id: initialSkinId,
				entry: null
			};
			/** Last non-null applied entry, so refresh() can re-activate it. */
			let lastEntry = null;
			/** Last evaluated background-suppression verdict (refresh() skips no-ops). */
			let lastSuppressed = deps.suppressBackgroundMedia?.() === true;
			let trying = null;
			let previewing = false;
			const listeners = /* @__PURE__ */ new Set();
			let stateSnapshot = {
				active: initialSkinId,
				trying: null,
				previewing: false
			};
			const emit = () => {
				stateSnapshot = {
					active,
					trying,
					previewing
				};
				for (const listener of listeners) listener();
			};
			/**
			* Install one stylesheet as a tracked <link> (the load itself happened in
			* loadStylesheet; here we only register the teardown). Links keep relative
			* url() resolution intact — a <style> tag would resolve them against the
			* document and 404 every skin asset.
			*/
			function trackStylesheet(activation, label, href) {
				const link = doc.head.querySelector(`link[href="${href}"]`);
				ledger.record(activation, `style:${label}`, () => link?.remove());
			}
			const BODY_BG_PROPS = [
				"background-image",
				"background-position",
				"background-size",
				"background-attachment",
				"background-repeat"
			];
			/**
			* Write the skin background onto document.body with a snapshot for the
			* activation ledger. Only the CURRENT activation may restore: when an
			* older activation is disposed after a newer one already re-painted the
			* body, restoring its snapshot would clobber the newer paint (the same
			* value is written by both, so value comparison cannot arbitrate).
			*/
			function setBodyBackground(activation, values) {
				const style = doc.body.style;
				const previous = /* @__PURE__ */ new Map();
				const restore = () => {
					if (currentActivation !== activation) return;
					for (const [prop, value] of previous) if (value === "") style.removeProperty(prop);
					else style.setProperty(prop, value);
				};
				for (const prop of BODY_BG_PROPS) {
					previous.set(prop, style.getPropertyValue(prop));
					const value = values?.[prop] ?? "";
					if (value === "") style.removeProperty(prop);
					else style.setProperty(prop, value);
				}
				previous.set("--dsh-skin-scrim", style.getPropertyValue("--dsh-skin-scrim"));
				style.setProperty("--dsh-skin-scrim", values === null ? "0" : "1");
				ledger.record(activation, "background:body", restore);
			}
			function installBackground(activation, entry) {
				const media = entry.manifest.contributes.backgroundMedia;
				if (!media) {
					setBodyBackground(activation, null);
					return;
				}
				if (deps.suppressBackgroundMedia?.() === true) {
					setBodyBackground(activation, null);
					return;
				}
				const variant = themeGet() === "dark" ? media.dark ?? media.light : media.light ?? media.dark;
				if (!variant) {
					setBodyBackground(activation, null);
					return;
				}
				const image = `url(${`${apiBase}/skins/${entry.manifest.id}`}/${variant.src})`;
				setBodyBackground(activation, {
					"background-image": variant.scrim ? `${variant.scrim}, ${image}` : image,
					"background-position": "center",
					"background-size": "cover",
					"background-attachment": "fixed",
					"background-repeat": "no-repeat"
				});
			}
			async function installHooks(activation, entry) {
				if (!entry.manifest.facets?.client) return;
				const importHooks = deps.importHooks ?? ((url) => import(
					/* @vite-ignore */
					url
));
				try {
					const factory = (await importHooks(`${apiBase}/skins/${entry.manifest.id}/hooks.mjs`))?.default;
					if (typeof factory !== "function") throw new Error("hooks.mjs must default-export defineSkinHooks()");
					const hooks = factory();
					if (typeof hooks?.apply !== "function") throw new Error("defineSkinHooks() must return { apply }");
					const cleanups = [];
					const ctx = {
						skinId: entry.manifest.id,
						scopeAttr: entry.manifest.id,
						assetBase: `${apiBase}/skins/${entry.manifest.id}`,
						layers,
						theme: {
							get: themeGet,
							subscribe: themeSubscribe
						},
						onCleanup: (fn) => {
							cleanups.push(fn);
						}
					};
					hooks.apply(ctx);
					ledger.record(activation, "hooks", () => {
						try {
							hooks.dispose?.();
						} catch (error) {
							onError(`hooks dispose failed for ${entry.manifest.id}`, error);
						}
						for (const cleanup of cleanups.reverse()) try {
							cleanup();
						} catch (error) {
							onError(`hooks cleanup failed for ${entry.manifest.id}`, error);
						}
					});
				} catch (error) {
					onError(`hooks failed for ${entry.manifest.id}; static skin stays active`, error);
				}
			}
			async function persist(id) {
				if (deps.persist) {
					await deps.persist(id);
					return;
				}
				await fetchImpl(`${apiBase}/active`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ active: id })
				});
			}
			async function switchInternal(id, entry, shouldPersist) {
				const seq = ++latestRequest;
				const activation = ledger.beginActivation();
				try {
					if (id !== null && entry !== null) {
						const stylesheetHref = `${apiBase}/skins/${id}/stylesheet`;
						const patchesHref = entry.manifest.contributes.patches !== void 0 ? `${apiBase}/skins/${id}/patches` : null;
						await loadStylesheet(stylesheetHref);
						trackStylesheet(activation, "stylesheet", stylesheetHref);
						if (patchesHref !== null) {
							await loadStylesheet(patchesHref).catch(() => {});
							trackStylesheet(activation, "patches", patchesHref);
						}
						if (seq !== latestRequest) throw new StaleSwitch();
						installBackground(activation, entry);
						await installHooks(activation, entry);
					} else setBodyBackground(activation, null);
					if (seq !== latestRequest) throw new StaleSwitch();
					if (id === null) doc.documentElement.removeAttribute("data-dsh-skin");
					else doc.documentElement.setAttribute("data-dsh-skin", id);
					const previous = currentActivation;
					currentActivation = activation;
					active = id;
					if (entry !== null) lastEntry = entry;
					if (shouldPersist) {
						committed = {
							id,
							entry
						};
						trying = null;
						previewing = false;
					} else {
						previewing = id !== committed.id;
						trying = previewing ? id : null;
					}
					emit();
					if (previous !== null) ledger.disposeActivation(previous);
					if (shouldPersist) await persist(id).catch((error) => onError("failed to persist the skin selection", error));
					return active;
				} catch (error) {
					ledger.disposeActivation(activation);
					if (error instanceof StaleSwitch) return active;
					if (currentActivation === null) {
						active = null;
						committed = {
							id: null,
							entry: null
						};
						doc.documentElement.removeAttribute("data-dsh-skin");
						emit();
					}
					onError(`switch to ${id ?? "stock"} failed; previous skin intact`, error);
					return active;
				}
			}
			return {
				get active() {
					return active;
				},
				get layers() {
					return layers;
				},
				async switchTo(id, entry) {
					return await switchInternal(id, entry, true);
				},
				async tryOn(id, entry) {
					return await switchInternal(id, entry, false);
				},
				async exitTryOn() {
					return await switchInternal(committed.id, committed.entry, false);
				},
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				getState() {
					return stateSnapshot;
				},
				async refresh() {
					const suppressed = deps.suppressBackgroundMedia?.() === true;
					if (suppressed === lastSuppressed) return active;
					lastSuppressed = suppressed;
					const id = active;
					if (id !== null && lastEntry === null) return active;
					return await switchInternal(id, id === null ? null : lastEntry, false);
				},
				shutdown() {
					latestRequest += 1;
					if (currentActivation !== null) {
						ledger.disposeActivation(currentActivation);
						currentActivation = null;
					}
					active = null;
					trying = null;
					previewing = false;
					committed = {
						id: null,
						entry: null
					};
					emit();
					doc.documentElement.removeAttribute("data-dsh-skin");
				}
			};
		}
		var StaleSwitch = class extends Error {
			constructor() {
				super("superseded by a newer switch");
			}
		};
		//#endregion
		//#region src/client/runtime/boot.ts
		/**
		* Browser boot wiring for the v2 skin runtime (issue #506): one store per
		* document that owns the effect ledger, the skin controller, the semantic
		* adapter and the catalog snapshot. The settings card consumes the store;
		* the store outlives the card (settings panels unmount on close), so a
		* try-on preview survives closing and reopening the panel.
		*
		* Boot sequence: fetch the catalog snapshot once, read the persisted active
		* selection, and activate it (the tapIndex adapter already stamped the
		* attribute and preloaded the stylesheet for first paint; the controller
		* re-installs under ledger ownership so later switches stay atomic).
		* @module @linxin666/dsh-client-ui-skin-center/runtime/boot
		*/
		function bootSkinRuntime(options = {}) {
			const doc = options.doc ?? document;
			const apiBase = options.apiBase ?? "/api/skin-center/v2";
			const fetchImpl = options.fetchImpl ?? fetch.bind(doc.defaultView);
			const controller = createSkinController({
				doc,
				ledger: createEffectLedger(),
				apiBase,
				fetchImpl,
				suppressBackgroundMedia: options.suppressBackgroundMedia,
				onError: (message, error) => {
					console.error(`[skin-center] ${message}`, error);
				}
			});
			const adapter = createSemanticAdapter(doc);
			adapter.start();
			let catalog = null;
			let diagnostics = [];
			const listeners = /* @__PURE__ */ new Set();
			const emit = () => {
				for (const listener of listeners) listener();
			};
			async function refreshCatalog() {
				const res = await fetchImpl(`${apiBase}/catalog`);
				if (!res.ok) throw new Error(`catalog fetch -> ${res.status}`);
				const payload = await res.json();
				catalog = payload.skins ?? [];
				diagnostics = payload.diagnostics ?? [];
				emit();
			}
			const store = {
				controller,
				adapter,
				catalog: () => catalog,
				diagnostics: () => diagnostics,
				refreshCatalog,
				find(id) {
					return catalog?.find((s) => s.manifest.id === id) ?? null;
				},
				subscribe(listener) {
					const off = controller.subscribe(listener);
					listeners.add(listener);
					return () => {
						off();
						listeners.delete(listener);
					};
				},
				shutdown() {
					adapter.stop();
					controller.shutdown();
				}
			};
			{
				const root = doc.defaultView;
				root.__skinRuntime = store;
			}
			(async () => {
				try {
					await refreshCatalog();
					let active = doc.documentElement?.getAttribute("data-dsh-skin") || null;
					if (!active) {
						const payload = await (await fetchImpl(`${apiBase}/active`)).json();
						active = payload.ok && typeof payload.active === "string" ? payload.active : null;
					}
					if (active === null) return;
					const entry = store.find(active);
					if (entry === null) {
						await controller.switchTo(null, null);
						return;
					}
					await controller.switchTo(active, entry);
				} catch {
					await controller.switchTo(null, null).catch(() => {});
				}
			})();
			return store;
		}
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
		* Skin Center as a first-level settings section.
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
			const binder = ctx.get("webUiSettings") ?? ctx.settingsScope;
			const background = new BackgroundController(binder.bind({ namespace: SKIN_BACKGROUND_NS }));
			ctx.effect(() => () => background.dispose(), "ui-skin-center: background dispose");
			const wallpaper = new WallpaperController(binder.bind({ namespace: SKIN_WALLPAPER_NS }));
			ctx.effect(() => () => wallpaper.dispose(), "ui-skin-center: wallpaper dispose");
			installBootRestore(wallpaper);
			const runtime = bootSkinRuntime({ suppressBackgroundMedia: () => wallpaper.enabled() && wallpaper.activeId() !== null && wallpaper.activeId() !== "" });
			ctx.effect(() => () => runtime.shutdown(), "ui-skin-center: runtime shutdown");
			ctx.effect(() => wallpaper.subscribe(() => {
				runtime.controller.refresh();
			}), "ui-skin-center: wallpaper priority refresh");
			const injected = () => ({
				runtime,
				theme: {
					getTheme: () => theme.getTheme(),
					subscribe: (listener) => ctx.on("theme/change", listener),
					setTheme: (id) => theme.setTheme(id)
				},
				background: {
					enabled: () => background.enabled(),
					setEnabled: (value) => background.setEnabled(value),
					opacity: () => background.opacity(),
					blurEmpty: () => background.blurEmpty(),
					blurContent: () => background.blurContent(),
					subscribe: (listener) => background.subscribe(listener),
					set: (opacity) => background.set(opacity),
					setBlurEmpty: (value) => background.setBlurEmpty(value),
					setBlurContent: (value) => background.setBlurContent(value),
					dispose: () => background.dispose()
				},
				wallpaper: {
					enabled: () => wallpaper.enabled(),
					selection: () => wallpaper.selection(),
					mode: () => wallpaper.mode(),
					fit: () => wallpaper.fit(),
					dim: () => wallpaper.dim(),
					wallpaperBlur: () => wallpaper.wallpaperBlur(),
					pauseOnHidden: () => wallpaper.pauseOnHidden(),
					sound: () => wallpaper.sound(),
					volume: () => wallpaper.volume(),
					dirs: () => wallpaper.dirs(),
					addDir: (dir) => wallpaper.addDir(dir),
					removeDir: (dir) => wallpaper.removeDir(dir),
					activeId: () => wallpaper.activeId(),
					trying: () => wallpaper.trying(),
					subscribe: (listener) => wallpaper.subscribe(listener),
					setEnabled: (value) => wallpaper.setEnabled(value),
					setMode: (value) => wallpaper.setMode(value),
					setFit: (fit) => wallpaper.setFit(fit),
					setDim: (value) => wallpaper.setDim(value),
					setBlur: (value) => wallpaper.setBlur(value),
					setPauseOnHidden: (value) => wallpaper.setPauseOnHidden(value),
					setSound: (value) => wallpaper.setSound(value),
					setVolume: (value) => wallpaper.setVolume(value),
					applySelection: (descriptor) => wallpaper.applySelection(descriptor),
					clearSelection: () => wallpaper.clearSelection(),
					sync: (descriptor) => wallpaper.sync(descriptor),
					tryOn: (descriptor) => wallpaper.tryOn(descriptor),
					exitTryOn: () => wallpaper.exitTryOn(),
					dispose: () => wallpaper.dispose()
				}
			});
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "skin-center",
				order: 120,
				label: () => ctx.locale.bind("skinCenter")("title"),
				locale: "skinCenter",
				inject: injected
			}, SkinCenterSection));
		}
		//#endregion
		exports.NS = NS;
		exports.apply = apply;
		exports.bootSkinRuntime = bootSkinRuntime;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map