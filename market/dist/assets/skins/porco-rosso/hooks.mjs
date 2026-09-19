/**
 * Studio Ghibli Porco Rosso (红猪) skin hooks (Simplified Edition).
 *
 * Retains core audiovisual & aesthetic elements:
 * 1. Quick Wallpaper Switcher (Auto Adaptive / Sunset / Summer Clouds / Secret Cove)
 *    with localStorage persistence.
 * 2. Retro Vinyl Music Player in Sidebar Footer:
 *    • 帰らざる日々 (Joe Hisaishi / Piano)
 *    • さくらんぼの実る頃 (Tokiko Kato / Chanson)
 * 3. Savoia S.21 Aviator Flight Badge with propeller & wallpaper trigger.
 *
 * Completely removes agent-reactive DOM observers, dialog matrices, and speech balloons
 * to guarantee 100% UI stability, zero DOM contention, and smooth performance.
 */

export default function defineSkinHooks() {
  return {
    apply(ctx) {
      if (typeof document === 'undefined') return;

      // WS-08：登记所有定时器，确保 dispose 后可取消
      let disposed = false;
      const timers = new Set();
      const later = (fn, ms) => {
        const id = setTimeout(() => {
          timers.delete(id);
          if (!disposed) fn();
        }, ms);
        timers.add(id);
        return id;
      };

      // WS-06：标签页隐藏时暂停皮肤的无限动画与帧循环
      const syncTabHidden = () => {
        document.body.toggleAttribute('data-dsh-tab-hidden', document.hidden);
      };
      document.addEventListener('visibilitychange', syncTabHidden);
      syncTabHidden();

      const WALLPAPER_KEY = 'dsh.theme.porco-rosso.wallpaper';
      const BACKGROUNDS = [
        { id: "auto", label: "日夜自适应", file: "" },
        { id: "cove", label: "秘密海湾 (昼)", file: "porco001.jpg" },
        { id: "flight", label: "平流天河 (夜)", file: "porco002.jpg" },
      ];

      /**
       * 每张壁纸的实测遮罩强度。由 scripts/calibrate-wallpaper-contrast.mjs 生成：
       * 目标为「典型区域 p50 ≥ 7:1、明亮区域 p90 ≥ 4.5:1」，
       * 面板透明度按最不利的 --dsh-skin-bubble-alpha = 0.35 计算，并含 0.04 安全余量。
       * 修改壁纸资产后必须重新生成本表（CI 门禁会校验）。
       */
      const VEIL_BY_THEME = {
        light: {
          "porco001.jpg": "rgba(251, 248, 241, 0.45)",
          "porco002.jpg": "rgba(251, 248, 241, 0.45)",
        },
        dark: {
          "porco001.jpg": "rgba(15, 20, 31, 0.30)",
          "porco002.jpg": "transparent",
        },
      };

      let bgIndex = 0;

      // Read saved wallpaper
      try {
        const savedId = localStorage.getItem(WALLPAPER_KEY);
        const idx = BACKGROUNDS.findIndex(b => b.id === savedId);
        if (idx >= 0) bgIndex = idx;
      } catch (_) {}

      // Apply wallpaper: targets skin-center background decoration layer
      const applyWallpaper = (target) => {
        try {
          localStorage.setItem(WALLPAPER_KEY, target.id);
        } catch (_) {}

        const isDark = ctx.theme.get() === 'dark' || document.body.hasAttribute('data-ds-dark-theme');
        let fileName = target.file;
        if (!fileName) {
          fileName = isDark ? 'ghost-fleet.jpg' : 'porco001.jpg';
        }

        const bgUrl = `${ctx.assetBase}/assets/${fileName}`;

        const updateLayer = () => {
          if (disposed) return;
          const bgLayer = ctx.layers?.background || document.querySelector('[data-dsh-skin-layer="background"]');
          if (bgLayer) {
            bgLayer.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:-2;pointer-events:none;overflow:hidden;';

            let imgA = bgLayer.querySelector('.porco-bg-a');
            let imgB = bgLayer.querySelector('.porco-bg-b');
            let scrimOverlay = bgLayer.querySelector('.porco-scrim-overlay');

            if (!imgA) {
              imgA = document.createElement('img');
              imgA.className = 'porco-bg-a';
              imgA.alt = '';
              imgA.setAttribute('aria-hidden', 'true');
              imgA.style.cssText = 'position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;object-fit:cover;pointer-events:none;transition:opacity 0.6s cubic-bezier(0.4,0,0.2,1);opacity:0;z-index:1;';
              bgLayer.prepend(imgA);
            }
            if (!imgB) {
              imgB = document.createElement('img');
              imgB.className = 'porco-bg-b';
              imgB.alt = '';
              imgB.setAttribute('aria-hidden', 'true');
              imgB.style.cssText = 'position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;object-fit:cover;pointer-events:none;transition:opacity 0.6s cubic-bezier(0.4,0,0.2,1);opacity:0;z-index:2;';
              bgLayer.insertBefore(imgB, imgA.nextSibling);
            }
            if (!scrimOverlay) {
              scrimOverlay = document.createElement('div');
              scrimOverlay.className = 'porco-scrim-overlay';
              scrimOverlay.setAttribute('aria-hidden', 'true');
              scrimOverlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3;transition:background 0.4s ease;';
              bgLayer.appendChild(scrimOverlay);
            }

            // 接管 background 层：移除声明式 media（未打标的 img 与 scrim div）。
            // 声明式 backgroundMedia 仍是 hooks 不可用时的降级路径；hooks 生效期间
            // 它必须被显式清除，否则其 scrim 会被我们的 z-index:1/2 图片遮挡成死 DOM。
            bgLayer
              .querySelectorAll('img:not(.porco-bg-a):not(.porco-bg-b), div:not(.porco-scrim-overlay)')
              .forEach((node) => node.remove());

            // 双向自适应遮罩：浅色×暗壁纸 与 深色×亮壁纸 都要处理
            const isDarkNow = ctx.theme.get() === 'dark' || document.body.hasAttribute('data-ds-dark-theme');
            scrimOverlay.style.background =
              VEIL_BY_THEME[isDarkNow ? 'dark' : 'light'][fileName] ?? 'transparent';

            // Cross fade between buffer A and buffer B
            const isANow = imgA.style.opacity === '1';
            const incoming = isANow ? imgB : imgA;
            const outgoing = isANow ? imgA : imgB;

            if (outgoing.src.endsWith(fileName) && outgoing.style.opacity === '1') {
              return;
            }

            incoming.src = bgUrl;
            incoming.onload = () => {
              if (disposed) return;
              incoming.style.opacity = '1';
              outgoing.style.opacity = '0';
            };
          }
        };

        updateLayer();
        later(updateLayer, 60);
      };

      applyWallpaper(BACKGROUNDS[bgIndex]);

      // Music playlist
      const playlist = [
        {
          id: "satie-gymnopedie-1",
          title: "Gymnopédie No. 1",
          artist: "Erik Satie",
          tag: "Piano",
          file: "satie-gymnopedie-1.mp3",
        },
        {
          id: "chopin-nocturne-op9",
          title: "Nocturne Op. 9 No. 2",
          artist: "Frédéric Chopin",
          tag: "Nocturne",
          file: "chopin-nocturne-op9.mp3",
        },
      ];

      let currentMusicIndex = 0;
      let isPlaying = false;

      const VOLUME_KEY = 'dsh.theme.porco-rosso.volume';
      let currentVolume = 0.45;
      try {
        const savedVol = localStorage.getItem(VOLUME_KEY);
        if (savedVol !== null && !isNaN(Number(savedVol))) {
          currentVolume = Math.max(0, Math.min(1, Number(savedVol)));
        }
      } catch (_) {}

      const audio = new Audio();
      audio.preload = 'none';
      audio.volume = currentVolume;

      // Inject Styles (WS-07: Scoped via ctx.scopeAttr)
      const styleTag = document.createElement('style');
      styleTag.id = 'porco-skin-hooks-styles';
      const s = `html[data-dsh-skin="${ctx.scopeAttr}"]`;
      styleTag.textContent = `
        @keyframes porco-disc-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes porco-prop-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          ${s} .porco-disc-spin-target { animation: none !important; }
        }
        body[data-dsh-tab-hidden] ${s} .porco-disc-spin-target { animation-play-state: paused !important; }
        ${s} .porco-badge-card:focus-visible,
        ${s} .porco-music-card:focus-visible,
        ${s} .porco-action-btn:focus-visible,
        ${s} .porco-bg-btn:focus-visible,
        ${s} .porco-popover-item:focus-visible {
          outline: 2px solid #c32026;
          outline-offset: 2px;
        }
        ${s} .porco-footer-container {
          display: flex;
          flex-direction: column;
          gap: 6px;
          width: 100%;
          box-sizing: border-box;
          font-family: inherit;
          margin-top: auto;
          padding: 6px 0;
        }
        ${s} .porco-badge-card {
          box-sizing: border-box;
          display: flex;
          align-items: center;
          gap: 9px;
          border-radius: 12px;
          padding: 7px 11px;
          cursor: pointer;
          user-select: none;
          transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease, background 0.3s ease, border-color 0.2s ease;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
        }
        ${s} .porco-badge-card:hover {
          transform: translateY(-1.5px);
        }
        ${s} .porco-badge-card:active {
          transform: scale(0.98);
        }
        ${s} .porco-badge-wings {
          width: 26px;
          height: 26px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.3s ease;
        }
        ${s} .porco-badge-content {
          display: flex;
          flex-direction: column;
          line-height: 1.25;
          min-width: 0;
          flex: 1;
        }
        ${s} .porco-badge-meta-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }
        ${s} .porco-badge-title {
          font-size: 11.5px;
          font-weight: 700;
          letter-spacing: 0.5px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        ${s} .porco-bg-btn {
          font-size: 9.5px;
          padding: 1px 6px;
          border-radius: 10px;
          font-weight: 600;
          letter-spacing: 0.3px;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.2s ease, transform 0.15s ease;
          line-height: 1.4;
          outline: none;
          max-width: 108px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        ${s} .porco-bg-btn:hover {
          transform: scale(1.05);
        }
        ${s} .porco-badge-sub {
          font-size: 10px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          letter-spacing: 0.3px;
          opacity: 0.85;
        }
        ${s} .porco-music-card {
          box-sizing: border-box;
          display: flex;
          align-items: center;
          gap: 9px;
          border-radius: 12px;
          padding: 7px 11px;
          cursor: pointer;
          user-select: none;
          transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease, background 0.3s ease, border-color 0.2s ease;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
        }
        ${s} .porco-music-card:hover {
          transform: translateY(-1.5px);
        }
        ${s} .porco-music-card:active {
          transform: scale(0.98);
        }
        ${s} .porco-music-info {
          display: flex;
          flex-direction: column;
          line-height: 1.25;
          min-width: 0;
          flex: 1;
        }
        ${s} .porco-music-title-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        ${s} .porco-music-title {
          font-size: 11.5px;
          font-weight: 700;
          letter-spacing: 0.3px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        ${s} .porco-music-tag {
          font-size: 9px;
          padding: 1px 5px;
          border-radius: 4px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          white-space: nowrap;
        }
        ${s} .porco-music-sub {
          font-size: 10px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          opacity: 0.85;
        }
        ${s} .porco-music-actions {
          display: flex;
          align-items: center;
          gap: 3px;
          margin-left: auto;
          flex-shrink: 0;
        }
        ${s} .porco-action-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          cursor: pointer;
          transition: background 0.15s ease, transform 0.15s ease;
          background: transparent;
          border: none;
          padding: 0;
          outline: none;
        }
        ${s} .porco-action-btn:hover {
          background: rgba(195, 32, 38, 0.15);
          transform: scale(1.15);
        }
        /* Collapsed / Rail sidebar mode adjustments */
        ${s} [data-sidebar-collapsed] .porco-badge-content,
        ${s} [data-sidebar-collapsed] .porco-music-info {
          display: none !important;
        }
        ${s} [data-sidebar-collapsed] .porco-badge-card,
        ${s} [data-sidebar-collapsed] .porco-music-card {
          width: 36px;
          height: 36px;
          padding: 0;
          justify-content: center;
          margin: 0 auto;
        }
        /* Mini Wallpaper Grid Popover */
        ${s} .porco-wallpaper-popover {
          position: fixed;
          bottom: 96px;
          left: 18px;
          width: 310px;
          max-height: 420px;
          border-radius: 14px;
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
          z-index: 99999;
          display: none;
          flex-direction: column;
          overflow: hidden;
          font-family: inherit;
          animation: porco-pop-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes porco-pop-in {
          from { opacity: 0; transform: translateY(8px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        ${s} .porco-popover-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px 8px 12px;
          border-bottom: 1px solid rgba(125, 125, 125, 0.2);
          font-size: 12px;
          font-weight: 700;
        }
        ${s} .porco-popover-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 7px;
          padding: 10px;
          overflow-y: auto;
          max-height: 350px;
        }
        ${s} .porco-popover-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
          border-radius: 8px;
          padding: 4px;
          cursor: pointer;
          border: 2px solid transparent;
          transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease;
          user-select: none;
        }
        ${s} .porco-popover-item:hover {
          transform: scale(1.03);
          background: rgba(125, 125, 125, 0.15);
        }
        ${s} .porco-popover-item.active {
          border-color: #c32026;
          box-shadow: 0 0 8px rgba(195, 32, 38, 0.45);
        }
        ${s} .porco-thumb-img {
          width: 100%;
          height: 64px;
          object-fit: cover;
          border-radius: 6px;
          display: block;
        }
        ${s} .porco-thumb-label {
          font-size: 10px;
          font-weight: 600;
          text-align: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        ${s} .porco-vol-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 46px;
          height: 3px;
          border-radius: 2px;
          background: rgba(125, 125, 125, 0.35);
          outline: none;
          cursor: pointer;
        }
        ${s} .porco-vol-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #c32026;
          cursor: pointer;
        }
      `;
      document.head.appendChild(styleTag);

      // --- Root Container ---
      const container = document.createElement('div');
      container.className = 'porco-footer-container';
      container.setAttribute('data-porco-footer-container', 'true');

      // --- Visual Overflow Tooltip Bubble ---
      const tipBubble = document.createElement('div');
      tipBubble.className = 'porco-overflow-tooltip';
      tipBubble.setAttribute('role', 'tooltip');
      tipBubble.style.cssText = `
        position: fixed;
        display: none;
        z-index: 999999;
        pointer-events: none;
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 11px;
        line-height: 1.35;
        white-space: nowrap;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        font-family: inherit;
        opacity: 0;
        transition: opacity 0.12s ease;
      `;
      document.body.appendChild(tipBubble);

      const showTooltip = (anchorEl, text) => {
        if (!text || !anchorEl || !anchorEl.isConnected) return;
        tipBubble.textContent = text;
        tipBubble.style.display = 'block';

        const isDark = ctx.theme.get() === 'dark' || document.body.hasAttribute('data-ds-dark-theme');
        if (isDark) {
          tipBubble.style.background = 'rgba(28, 20, 16, 0.96)';
          tipBubble.style.border = '1px solid rgba(245, 158, 11, 0.45)';
          tipBubble.style.color = '#fef3c7';
        } else {
          tipBubble.style.background = 'rgba(254, 250, 242, 0.96)';
          tipBubble.style.border = '1px solid rgba(195, 32, 38, 0.40)';
          tipBubble.style.color = '#2c1810';
        }

        const rect = anchorEl.getBoundingClientRect();
        const tipRect = tipBubble.getBoundingClientRect();
        let top = rect.top - tipRect.height - 6;
        if (top < 8) {
          top = rect.bottom + 6;
        }
        let left = rect.left;
        if (left + tipRect.width > window.innerWidth - 8) {
          left = window.innerWidth - tipRect.width - 8;
        }
        if (left < 8) left = 8;

        tipBubble.style.left = `${left}px`;
        tipBubble.style.top = `${top}px`;
        tipBubble.style.opacity = '1';
      };

      const hideTooltip = () => {
        tipBubble.style.opacity = '0';
        tipBubble.style.display = 'none';
      };

      // --- Dynamic Overflow Tooltip Helper ---
      const tipUpdaters = [];
      const setupOverflowTip = (element, getFullText, fallbackTitle = '') => {
        element.setAttribute('data-has-overflow-tip', 'true');
        const updateTip = (showPopup = false) => {
          if (!element || !element.isConnected) return;
          const isOverflowing = (element.scrollWidth - element.clientWidth) >= 1;
          if (isOverflowing) {
            const full = typeof getFullText === 'function' ? getFullText() : (getFullText || element.textContent || '').trim();
            if (full) {
              element.title = full;
              if (showPopup) showTooltip(element, full);
            }
          } else {
            hideTooltip();
            if (fallbackTitle) {
              element.title = fallbackTitle;
            } else {
              element.removeAttribute('title');
            }
          }
        };

        element.addEventListener('mouseenter', () => updateTip(true));
        element.addEventListener('mouseleave', () => {
          hideTooltip();
          updateTip(false);
        });
        tipUpdaters.push(() => updateTip(false));
        return () => updateTip(false);
      };

      // --- 1. Porco Flight Badge Element ---
      const badgeCard = document.createElement('div');
      badgeCard.className = 'porco-badge-card';
      badgeCard.setAttribute('data-porco-footer-badge', 'true');
      badgeCard.setAttribute('role', 'group');

      // Savoia Wings SVG Emblem
      const wingsWrap = document.createElement('div');
      wingsWrap.className = 'porco-badge-wings';
      wingsWrap.innerHTML = `
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M 2 12 C 6 8.5, 11 9.5, 12 11.5 C 13 9.5, 18 8.5, 22 12 C 18 14.5, 13 13.5, 12 12 C 11 13.5, 6 14.5, 2 12 Z" fill="#d4af37" stroke="#b45309" stroke-width="0.8" />
          <path d="M 2 11.5 C 5 11.8, 8 12.5, 12 12.8" stroke="#f59e0b" stroke-width="0.6" />
          <path d="M 22 11.5 C 19 11.8, 16 12.5, 12 12.8" stroke="#f59e0b" stroke-width="0.6" />
          <circle cx="12" cy="12" r="3.5" fill="#d4af37" stroke="#b45309" stroke-width="0.8" />
          <circle cx="12" cy="12" r="2" fill="#c32026" id="porco-prop-center" />
          <circle cx="12" cy="12" r="0.8" fill="#ffffff" />
        </svg>
      `;
      badgeCard.appendChild(wingsWrap);

      // Badge Content
      const badgeContent = document.createElement('div');
      badgeContent.className = 'porco-badge-content';

      const metaRow = document.createElement('div');
      metaRow.className = 'porco-badge-meta-row';

      const badgeTitle = document.createElement('span');
      badgeTitle.className = 'porco-badge-title';
      badgeTitle.textContent = '红猪 • 飞行勋章';
      const updateBadgeTitleTip = setupOverflowTip(badgeTitle, () => badgeTitle.textContent);
      metaRow.appendChild(badgeTitle);

      const actionsWrap = document.createElement('div');
      actionsWrap.style.cssText = 'display: flex; align-items: center; gap: 4px; flex-shrink: 0;';

      const themeBtn = document.createElement('button');
      themeBtn.type = 'button';
      themeBtn.className = 'porco-bg-btn';
      themeBtn.title = '切换深色/浅色模式';
      actionsWrap.appendChild(themeBtn);

      const bgBtn = document.createElement('button');
      bgBtn.type = 'button';
      bgBtn.className = 'porco-bg-btn';
      bgBtn.textContent = `🖼️ ${BACKGROUNDS[bgIndex].label}`;
      bgBtn.title = '切换亚得里亚海巡航壁纸';
      const updateBgBtnTip = setupOverflowTip(bgBtn, () => bgBtn.textContent, '切换亚得里亚海巡航壁纸');
      actionsWrap.appendChild(bgBtn);
      metaRow.appendChild(actionsWrap);
      badgeContent.appendChild(metaRow);

      const badgeSub = document.createElement('span');
      badgeSub.className = 'porco-badge-sub';
      badgeSub.textContent = 'SAVOIA S.21 • 亚得里亚海巡航';
      const updateBadgeSubTip = setupOverflowTip(badgeSub, () => badgeSub.textContent);
      badgeContent.appendChild(badgeSub);

      badgeCard.appendChild(badgeContent);
      container.appendChild(badgeCard);

      // --- 2. Retro Vinyl Music Player ---
      const musicCard = document.createElement('div');
      musicCard.className = 'porco-music-card';
      musicCard.setAttribute('data-porco-music-player', 'true');
      musicCard.setAttribute('role', 'group');
      musicCard.setAttribute('tabindex', '0');

      const disc = document.createElement('div');
      disc.classList.add('porco-disc-spin-target');
      disc.style.cssText = `
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: radial-gradient(circle, #d4af37 18%, #c32026 22%, #a8171d 68%, #6b0c11 100%);
        box-shadow: 0 2px 5px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: transform 0.3s ease;
      `;
      const centerHole = document.createElement('div');
      centerHole.style.cssText = 'width: 5px; height: 5px; border-radius: 50%; background: #ffffff; box-shadow: 0 0 2px rgba(0,0,0,0.4);';
      disc.appendChild(centerHole);
      musicCard.appendChild(disc);

      const musicInfo = document.createElement('div');
      musicInfo.className = 'porco-music-info';

      const titleRow = document.createElement('div');
      titleRow.className = 'porco-music-title-row';

      const musicTitle = document.createElement('span');
      musicTitle.className = 'porco-music-title';
      const updateMusicTitleTip = setupOverflowTip(musicTitle, () => `${playlist[currentMusicIndex].title} - ${playlist[currentMusicIndex].artist}`);
      titleRow.appendChild(musicTitle);

      const tagBadge = document.createElement('span');
      tagBadge.className = 'porco-music-tag';
      titleRow.appendChild(tagBadge);
      musicInfo.appendChild(titleRow);

      const musicSubtitle = document.createElement('span');
      musicSubtitle.className = 'porco-music-sub';
      const updateMusicSubTip = setupOverflowTip(musicSubtitle, () => musicSubtitle.textContent);
      musicInfo.appendChild(musicSubtitle);

      musicCard.appendChild(musicInfo);

      const actions = document.createElement('div');
      actions.className = 'porco-music-actions';

      const playIcon = document.createElement('button');
      playIcon.type = 'button';
      playIcon.className = 'porco-action-btn';
      playIcon.setAttribute('aria-label', '播放/暂停');
      playIcon.innerHTML = `
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
          <path d="M 8 5 v 14 l 11 -7 Z" />
        </svg>
      `;
      actions.appendChild(playIcon);

      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'porco-action-btn';
      nextBtn.setAttribute('aria-label', '下一首');
      nextBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
          <path d="M 6 5 v 14 l 9 -7 Z M 16 5 v 14 h 2.5 V 5 Z" />
        </svg>
      `;
      actions.appendChild(nextBtn);

      const volWrap = document.createElement('div');
      volWrap.style.cssText = 'position: relative; display: flex; align-items: center; gap: 2px;';

      const volBtn = document.createElement('span');
      volBtn.className = 'porco-action-btn';
      volBtn.style.cssText = 'font-size: 11px; cursor: pointer; user-select: none;';

      const updateVolIcon = () => {
        if (audio.muted || audio.volume === 0) {
          volBtn.textContent = '🔇';
          volBtn.title = '已静音 (点击恢复音量)';
        } else if (audio.volume < 0.5) {
          volBtn.textContent = '🔉';
          volBtn.title = `音量: ${Math.round(audio.volume * 100)}% (点击静音)`;
        } else {
          volBtn.textContent = '🔊';
          volBtn.title = `音量: ${Math.round(audio.volume * 100)}% (点击静音)`;
        }
      };
      updateVolIcon();

      const volSlider = document.createElement('input');
      volSlider.type = 'range';
      volSlider.min = '0';
      volSlider.max = '1';
      volSlider.step = '0.05';
      volSlider.value = String(currentVolume);
      volSlider.className = 'porco-vol-slider';
      volSlider.title = '滑动调节音量';

      volBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (audio.muted || audio.volume === 0) {
          audio.muted = false;
          audio.volume = currentVolume > 0 ? currentVolume : 0.45;
          volSlider.value = String(audio.volume);
        } else {
          audio.muted = true;
        }
        updateVolIcon();
      });

      volSlider.addEventListener('click', (e) => e.stopPropagation());
      volSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        const v = Number(e.target.value);
        audio.muted = false;
        audio.volume = v;
        currentVolume = v;
        try {
          localStorage.setItem(VOLUME_KEY, String(v));
        } catch (_) {}
        updateVolIcon();
      });

      volWrap.appendChild(volBtn);
      volWrap.appendChild(volSlider);
      actions.appendChild(volWrap);

      musicCard.appendChild(actions);
      container.appendChild(musicCard);

      // --- 3. Player Logic ---
      const ICON_PLAY = `
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
          <path d="M 8 5 v 14 l 11 -7 Z" />
        </svg>
      `;
      const ICON_PAUSE = `
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
          <path d="M 6 5 h 4 v 14 H 6 Z M 14 5 h 4 v 14 H 14 Z" />
        </svg>
      `;

      /**
       * Single source of truth for the player's visual state: track counter,
       * subtitle, play/pause icon, vinyl spin and the accent border.
       */
      const updatePlayState = () => {
        const track = playlist[currentMusicIndex];
        const counter = `[${currentMusicIndex + 1}/${playlist.length}]`;

        if (isPlaying) {
          musicSubtitle.textContent = `正在播放 ${counter} • ${track.artist}`;
          playIcon.innerHTML = ICON_PAUSE;
          playIcon.setAttribute('aria-label', '暂停');
          disc.style.animation = 'porco-disc-spin 3.2s linear infinite';
        } else {
          musicSubtitle.textContent = `波鲁克黑胶 ${counter} • ${track.artist}`;
          playIcon.innerHTML = ICON_PLAY;
          playIcon.setAttribute('aria-label', '播放');
          disc.style.animation = 'none';
        }
        updateMusicSubTip();

        musicCard.setAttribute(
          'aria-label',
          `红猪黑胶 ${counter}: [${track.tag}] ${track.title} - ${track.artist}`,
        );
        applyCardTheme();
      };

      const setTrack = (index, autoPlay = false) => {
        currentMusicIndex = (index + playlist.length) % playlist.length;
        const track = playlist[currentMusicIndex];

        musicTitle.textContent = track.title;
        updateMusicTitleTip();
        tagBadge.textContent = track.tag;

        audio.src = `${ctx.assetBase}/assets/${track.file}`;

        if (autoPlay) {
          audio.play().then(() => {
            isPlaying = true;
            updatePlayState();
          }).catch((err) => {
            console.warn('[PorcoRosso] Playback prevented:', err);
            isPlaying = false;
            updatePlayState();
          });
        } else {
          isPlaying = false;
          updatePlayState();
        }
      };

      const togglePlay = (e) => {
        if (e && e.target && e.target.closest('.porco-action-btn') === nextBtn) return;

        if (isPlaying) {
          audio.pause();
          isPlaying = false;
          updatePlayState();
        } else {
          audio.play().then(() => {
            isPlaying = true;
            updatePlayState();
          }).catch((err) => {
            console.warn('[PorcoRosso] Playback prevented:', err);
            isPlaying = false;
            updatePlayState();
          });
        }
      };

      const nextTrack = (e) => {
        if (e) e.stopPropagation();
        setTrack(currentMusicIndex + 1, isPlaying);
      };

      audio.addEventListener('ended', () => {
        setTrack(currentMusicIndex + 1, true);
      });

      playIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePlay(e);
      });
      musicCard.addEventListener('click', (e) => {
        if (e.target.closest('button, input')) return;
        togglePlay(e);
      });
      musicCard.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target.closest('button, input')) return;
          e.preventDefault();
          togglePlay();
        } else if (e.key === 'ArrowRight' || e.key === 'n') {
          e.preventDefault();
          nextTrack();
        } else if (e.key === 'ArrowLeft' || e.key === 'p') {
          e.preventDefault();
          setTrack(currentMusicIndex - 1, isPlaying);
        }
      });
      nextBtn.addEventListener('click', nextTrack);

      // --- 4. Theme & Wallpaper Click Handlers ---
      themeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const currentlyDark = ctx.theme.get() === 'dark' || document.body.hasAttribute('data-ds-dark-theme');
        const nextScheme = currentlyDark ? 'light' : 'dark';

        document.body.toggleAttribute('data-ds-dark-theme', nextScheme === 'dark');
        applyTheme();

        try {
          await fetch('/api/settings/mutate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              type: 'client-request',
              rpcId: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
              method: 'settings/mutate',
              payload: {
                args: {
                  ns: 'ui-theme',
                  ops: [{ op: 'set', path: ['preference'], value: nextScheme }]
                }
              }
            })
          });
        } catch (err) {
          console.warn('[PorcoRosso] Failed to persist theme preference:', err);
        }
      });

      // --- 5. Theme Palette Sync ---
      /** Repaint card palettes only. Safe to call on every play/pause. */
      const applyCardTheme = () => {
        const isDark = ctx.theme.get() === 'dark' || document.body.hasAttribute('data-ds-dark-theme');
        themeBtn.textContent = isDark ? '🌙 暗色' : '☀️ 亮色';
        themeBtn.title = isDark ? '当前为深色模式，点击切换为浅色' : '当前为浅色模式，点击切换为深色';

        if (isDark) {
          badgeCard.style.background = 'rgba(28, 20, 16, 0.85)';
          badgeCard.style.border = '1px solid rgba(245, 158, 11, 0.25)';
          badgeCard.style.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.35)';
          badgeTitle.style.color = '#fef3c7';
          badgeSub.style.color = '#d1bfa7';
          themeBtn.style.background = 'rgba(195, 32, 38, 0.25)';
          themeBtn.style.border = '1px solid rgba(245, 158, 11, 0.35)';
          themeBtn.style.color = '#fde68a';
          bgBtn.style.background = 'rgba(195, 32, 38, 0.25)';
          bgBtn.style.border = '1px solid rgba(245, 158, 11, 0.35)';
          bgBtn.style.color = '#fde68a';

          musicCard.style.background = 'rgba(28, 20, 16, 0.85)';
          musicCard.style.border = isPlaying ? '1px solid #e11d48' : '1px solid rgba(245, 158, 11, 0.25)';
          musicCard.style.boxShadow = isPlaying ? '0 4px 14px rgba(225, 29, 72, 0.35)' : '0 4px 14px rgba(0, 0, 0, 0.35)';
          musicTitle.style.color = '#fef3c7';
          musicSubtitle.style.color = '#d1bfa7';
          playIcon.style.color = '#f87171';
          nextBtn.style.color = '#f87171';
          volBtn.style.color = '#f87171';
          tagBadge.style.background = 'rgba(225, 29, 72, 0.25)';
          tagBadge.style.color = '#fecdd3';
          tagBadge.style.border = '1px solid rgba(225, 29, 72, 0.4)';

          popover.style.background = 'rgba(28, 20, 16, 0.96)';
          popover.style.border = '1px solid rgba(245, 158, 11, 0.35)';
          popover.style.color = '#fef3c7';
          popoverCycle.style.background = 'rgba(195, 32, 38, 0.25)';
          popoverCycle.style.border = '1px solid rgba(245, 158, 11, 0.35)';
          popoverCycle.style.color = '#fde68a';
        } else {
          badgeCard.style.background = 'rgba(251, 248, 241, 0.90)';
          badgeCard.style.border = '1px solid rgba(120, 75, 35, 0.22)';
          badgeCard.style.boxShadow = '0 4px 14px rgba(43, 34, 27, 0.12)';
          badgeTitle.style.color = '#23180f';
          badgeSub.style.color = '#5e4c3e';
          themeBtn.style.background = 'rgba(195, 32, 38, 0.10)';
          themeBtn.style.border = '1px solid rgba(195, 32, 38, 0.25)';
          themeBtn.style.color = '#c32026';
          bgBtn.style.background = 'rgba(195, 32, 38, 0.10)';
          bgBtn.style.border = '1px solid rgba(195, 32, 38, 0.25)';
          bgBtn.style.color = '#c32026';

          musicCard.style.background = 'rgba(251, 248, 241, 0.90)';
          musicCard.style.border = isPlaying ? '1px solid #c32026' : '1px solid rgba(120, 75, 35, 0.22)';
          musicCard.style.boxShadow = isPlaying ? '0 4px 14px rgba(195, 32, 38, 0.18)' : '0 4px 14px rgba(43, 34, 27, 0.12)';
          musicTitle.style.color = '#23180f';
          musicSubtitle.style.color = '#5e4c3e';
          playIcon.style.color = '#c32026';
          nextBtn.style.color = '#c32026';
          volBtn.style.color = '#c32026';
          tagBadge.style.background = 'rgba(195, 32, 38, 0.12)';
          tagBadge.style.color = '#c32026';
          tagBadge.style.border = '1px solid rgba(195, 32, 38, 0.28)';

          popover.style.background = 'rgba(251, 248, 241, 0.96)';
          popover.style.border = '1px solid rgba(120, 75, 35, 0.25)';
          popover.style.color = '#23180f';
          popoverCycle.style.background = 'rgba(195, 32, 38, 0.10)';
          popoverCycle.style.border = '1px solid rgba(195, 32, 38, 0.25)';
          popoverCycle.style.color = '#c32026';
        }
      };

      // --- Wallpaper Direct Palette Popover ---
      const popover = document.createElement('div');
      popover.className = 'porco-wallpaper-popover';

      const popoverHeader = document.createElement('div');
      popoverHeader.className = 'porco-popover-header';

      const popoverTitle = document.createElement('span');
      popoverTitle.textContent = `亚得里亚海壁纸 (${BACKGROUNDS.length})`;
      popoverHeader.appendChild(popoverTitle);

      const popoverActions = document.createElement('div');
      popoverActions.style.cssText = 'display: flex; align-items: center; gap: 8px;';

      const popoverCycle = document.createElement('button');
      popoverCycle.type = 'button';
      popoverCycle.className = 'porco-bg-btn';
      popoverCycle.textContent = '▶ 下一张';
      popoverCycle.title = '轮换下一张壁纸';
      popoverActions.appendChild(popoverCycle);

      const popoverClose = document.createElement('span');
      popoverClose.className = 'porco-action-btn';
      popoverClose.textContent = '✕';
      popoverClose.setAttribute('role', 'button');
      popoverClose.setAttribute('tabindex', '0');
      popoverClose.setAttribute('aria-label', '关闭浮层');
      popoverClose.style.cssText = 'font-size: 11px; cursor: pointer; padding: 2px 5px;';
      popoverClose.title = '关闭浮层';
      popoverClose.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          popover.style.display = 'none';
        }
      });
      popoverActions.appendChild(popoverClose);

      popoverHeader.appendChild(popoverActions);
      popover.appendChild(popoverHeader);

      const popoverGrid = document.createElement('div');
      popoverGrid.className = 'porco-popover-grid';

      const gridItems = [];

      BACKGROUNDS.forEach((bg, idx) => {
        const item = document.createElement('div');
        item.className = `porco-popover-item ${idx === bgIndex ? 'active' : ''}`;
        item.setAttribute('data-bg-id', bg.id);
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.setAttribute('aria-label', `选择壁纸: ${bg.label}`);

        const thumbImg = document.createElement('img');
        thumbImg.className = 'porco-thumb-img';
        thumbImg.alt = bg.label;
        const previewFile = bg.file || 'porco001.jpg';
        thumbImg.src = `${ctx.assetBase}/assets/${previewFile}`;
        item.appendChild(thumbImg);

        const thumbLabel = document.createElement('span');
        thumbLabel.className = 'porco-thumb-label';
        thumbLabel.textContent = bg.label;
        setupOverflowTip(thumbLabel, () => bg.label);
        item.appendChild(thumbLabel);

        item.addEventListener('click', (e) => {
          e.stopPropagation();
          bgIndex = idx;
          const target = BACKGROUNDS[bgIndex];
          bgBtn.textContent = `🖼️ ${target.label}`;
          updateBgBtnTip();
          applyWallpaper(target);
          updateGridActive();
          popover.style.display = 'none';
        });

        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            item.click();
          }
        });

        gridItems.push(item);
        popoverGrid.appendChild(item);
      });

      const updateGridActive = () => {
        gridItems.forEach((item, idx) => {
          if (idx === bgIndex) {
            item.classList.add('active');
          } else {
            item.classList.remove('active');
          }
        });
      };

      popover.appendChild(popoverGrid);
      document.body.appendChild(popover);

      const togglePopover = (e) => {
        if (e) e.stopPropagation();
        const isOpen = popover.style.display === 'flex';
        if (isOpen) {
          popover.style.display = 'none';
        } else {
          updateGridActive();
          const rect = badgeCard.getBoundingClientRect();
          popover.style.bottom = `${Math.max(20, window.innerHeight - rect.top + 6)}px`;
          popover.style.left = `${Math.max(12, rect.left)}px`;
          popover.style.display = 'flex';
        }
      };

      bgBtn.addEventListener('click', togglePopover);
      popoverCycle.addEventListener('click', (e) => {
        e.stopPropagation();
        bgIndex = (bgIndex + 1) % BACKGROUNDS.length;
        const target = BACKGROUNDS[bgIndex];
        bgBtn.textContent = `🖼️ ${target.label}`;
        updateBgBtnTip();
        applyWallpaper(target);
        updateGridActive();
      });
      popoverClose.addEventListener('click', (e) => {
        e.stopPropagation();
        popover.style.display = 'none';
      });

      const handleClickOutside = (e) => {
        if (popover.style.display === 'flex' && !popover.contains(e.target) && !bgBtn.contains(e.target)) {
          popover.style.display = 'none';
        }
      };
      document.addEventListener('click', handleClickOutside);
      const handleKeyDown = (e) => {
        if (e.key === 'Escape' && popover.style.display === 'flex') {
          popover.style.display = 'none';
        }
      };
      document.addEventListener('keydown', handleKeyDown);

      /** Full theme reaction: palette + wallpaper (light/dark auto source). */
      const applyTheme = () => {
        applyCardTheme();
        later(() => {
          applyWallpaper(BACKGROUNDS[bgIndex]);
        }, 30);
      };

      const unsubTheme = ctx.theme.subscribe(applyTheme);

      // Paint the initial track + counter now that the palette fn exists.
      setTrack(0, false);

      // --- 6. Mount into Sidebar Footer (One-Shot) ---
      let mounted = false;
      const mountIntoSidebar = () => {
        if (mounted) return true;
        const footer = document.querySelector('div:has(> [data-slot="sidebar.footer.action"])');
        if (footer && footer.parentElement) {
          footer.parentElement.insertBefore(container, footer);
          container.style.position = 'static';
          mounted = true;
          return true;
        }

        const sidebar = document.querySelector('[data-slot="sidebar"], div:has(> [data-slot="sidebar"])');
        if (sidebar) {
          sidebar.appendChild(container);
          container.style.position = 'relative';
          container.style.margin = '6px 10px';
          mounted = true;
          return true;
        }
        return false;
      };

      let mountObserver = null;
      if (!mountIntoSidebar()) {
        container.style.position = 'fixed';
        container.style.bottom = '18px';
        container.style.left = '20px';
        container.style.zIndex = '9999';
        container.style.maxWidth = '280px';
        document.body.appendChild(container);

        mountObserver = new MutationObserver(() => {
          if (mountIntoSidebar()) {
            container.style.bottom = 'auto';
            container.style.left = 'auto';
            container.style.zIndex = 'auto';
            container.style.maxWidth = 'none';
            if (mountObserver) {
              mountObserver.disconnect();
              mountObserver = null;
            }
          }
        });
        mountObserver.observe(document.body, { childList: true, subtree: true });
      }

      applyTheme();

      // --- Safety-net delegated hover for any other overflowing text ---
      const handleOverflowMouseOver = (e) => {
        const target = e.target;
        if (!target || !(target instanceof HTMLElement)) return;
        if (target.hasAttribute('data-has-overflow-tip')) return;
        if (target.hasAttribute('title') && !target.hasAttribute('data-dynamic-overflow-tip')) return;

        if ((target.scrollWidth - target.clientWidth) >= 1) {
          const text = (target.textContent || '').trim();
          if (text) {
            target.title = text;
            target.setAttribute('data-dynamic-overflow-tip', 'true');
            showTooltip(target, text);
          }
        } else if (target.getAttribute('data-dynamic-overflow-tip') === 'true') {
          target.removeAttribute('title');
          target.removeAttribute('data-dynamic-overflow-tip');
          hideTooltip();
        }
      };

      const handleOverflowMouseOut = (e) => {
        const target = e.target;
        if (!target || !(target instanceof HTMLElement)) return;
        if (target.getAttribute('data-dynamic-overflow-tip') === 'true') {
          target.removeAttribute('title');
          target.removeAttribute('data-dynamic-overflow-tip');
          hideTooltip();
        }
      };

      container.addEventListener('mouseover', handleOverflowMouseOver);
      container.addEventListener('mouseout', handleOverflowMouseOut);
      popover.addEventListener('mouseover', handleOverflowMouseOver);
      popover.addEventListener('mouseout', handleOverflowMouseOut);

      const handleWindowResize = () => {
        for (const update of tipUpdaters) update();
      };
      window.addEventListener('resize', handleWindowResize);

      let resizeObserver = null;
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          for (const update of tipUpdaters) update();
        });
        resizeObserver.observe(container);
      }

      later(() => {
        for (const update of tipUpdaters) update();
      }, 80);

      // --- 7. Clean Disposal ---
      ctx.onCleanup(() => {
        disposed = true;
        for (const id of timers) clearTimeout(id);
        timers.clear();
        document.removeEventListener('visibilitychange', syncTabHidden);
        document.body.removeAttribute('data-dsh-tab-hidden');
        unsubTheme();
        if (mountObserver) mountObserver.disconnect();
        window.removeEventListener('resize', handleWindowResize);
        if (resizeObserver) resizeObserver.disconnect();
        document.removeEventListener('click', handleClickOutside);
        document.removeEventListener('keydown', handleKeyDown);
        popover.remove();
        tipBubble.remove();
        audio.pause();
        audio.src = '';
        container.remove();
        styleTag.remove();
      });
    },
  };
}
