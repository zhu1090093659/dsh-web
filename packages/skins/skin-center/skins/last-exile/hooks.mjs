/**
 * GONZO Last Exile (最后流亡) skin hooks.
 *
 * Sidebar footer widgets:
 * 1. Quick Wallpaper Switcher (Auto Adaptive / Grand Stream / Silvana / Clear Sky)
 *    with localStorage persistence, mounted on the Claudia flight badge.
 * 2. Claudia vinyl audio player with the four classic theme tracks:
 *    • 沖野俊太郎《Cloud Age Symphony》 (OP)
 *    • Hitomi (黑石瞳)《Over The Sky》 (ED)
 *    • Hitomi (黑石瞳)《Rays of hope》 (IN / OST2)
 *    • Dolce Triade《Lost Friend》 (OST / OST2)
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

      const WALLPAPER_KEY = 'dsh.theme.last-exile.wallpaper';
      const BACKGROUNDS = [
        { id: "auto", label: "日夜自适应", file: "" },
        { id: "vanship", label: "晴空先锋 (昼)", file: "vanship.jpg" },
        { id: "grandstream", label: "风暴夜空 (夜)", file: "grandstream.jpg" },
      ];

      /**
       * 每张壁纸的实测遮罩强度。由 scripts/calibrate-wallpaper-contrast.mjs 生成：
       * 目标为「典型区域 p50 ≥ 7:1、明亮区域 p90 ≥ 4.5:1」，
       * 面板透明度按最不利的 --dsh-skin-bubble-alpha = 0.35 计算，并含 0.04 安全余量。
       * 修改壁纸资产后必须重新生成本表（CI 门禁会校验）。
       */
      const VEIL_BY_THEME = {
        light: {
          "grandstream.jpg": "rgba(238, 240, 234, 0.30)",
          "vanship.jpg": "rgba(238, 240, 234, 0.60)",
        },
        dark: {
          "grandstream.jpg": "rgba(11, 22, 38, 0.35)",
          "vanship.jpg": "transparent",
        },
      };

      let bgIndex = 0;

      // Restore the persisted wallpaper choice
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
          fileName = isDark ? 'grandstream.jpg' : 'vanship.jpg';
        }

        const bgUrl = `${ctx.assetBase}/assets/${fileName}`;

        const updateLayer = () => {
          if (disposed) return;
          const bgLayer = ctx.layers?.background || document.querySelector('[data-dsh-skin-layer="background"]');
          if (bgLayer) {
            bgLayer.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:-2;pointer-events:none;overflow:hidden;';

            let imgA = bgLayer.querySelector('.exile-bg-a');
            let imgB = bgLayer.querySelector('.exile-bg-b');
            let scrimOverlay = bgLayer.querySelector('.exile-scrim-overlay');

            if (!imgA) {
              imgA = document.createElement('img');
              imgA.className = 'exile-bg-a';
              imgA.alt = '';
              imgA.setAttribute('aria-hidden', 'true');
              imgA.style.cssText = 'position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;object-fit:cover;pointer-events:none;transition:opacity 0.6s cubic-bezier(0.4,0,0.2,1);opacity:0;z-index:1;';
              bgLayer.prepend(imgA);
            }
            if (!imgB) {
              imgB = document.createElement('img');
              imgB.className = 'exile-bg-b';
              imgB.alt = '';
              imgB.setAttribute('aria-hidden', 'true');
              imgB.style.cssText = 'position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;object-fit:cover;pointer-events:none;transition:opacity 0.6s cubic-bezier(0.4,0,0.2,1);opacity:0;z-index:2;';
              bgLayer.insertBefore(imgB, imgA.nextSibling);
            }
            if (!scrimOverlay) {
              scrimOverlay = document.createElement('div');
              scrimOverlay.className = 'exile-scrim-overlay';
              scrimOverlay.setAttribute('aria-hidden', 'true');
              scrimOverlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3;transition:background 0.4s ease;';
              bgLayer.appendChild(scrimOverlay);
            }

            // 接管 background 层：移除声明式 media（未打标的 img 与 scrim div）。
            bgLayer
              .querySelectorAll('img:not(.exile-bg-a):not(.exile-bg-b), div:not(.exile-scrim-overlay)')
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

      const playlist = [
        {
          id: "debussy-clair-de-lune",
          title: "Clair de Lune",
          artist: "Claude Debussy",
          tag: "Nocturne",
          file: "debussy-clair-de-lune.mp3",
        },
        {
          id: "debussy-arabesque-2",
          title: "2nd Arabesque",
          artist: "Claude Debussy",
          tag: "Arabesque",
          file: "debussy-arabesque-2.mp3",
        },
      ];

      let currentIndex = 0;
      let isPlaying = false;

      const VOLUME_KEY = 'dsh.theme.last-exile.volume';
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

      // Keyframes for rotating Claudia vinyl disc & audio waves (WS-07: Scoped via ctx.scopeAttr)
      const styleTag = document.createElement('style');
      styleTag.id = 'exile-music-styles';
      const s = `html[data-dsh-skin="${ctx.scopeAttr}"]`;
      styleTag.textContent = `
        @keyframes exile-disc-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes exile-music-glow {
          0%, 100% { box-shadow: 0 0 6px rgba(6, 182, 212, 0.4), inset 0 0 4px rgba(34, 211, 238, 0.3); }
          50% { box-shadow: 0 0 12px rgba(6, 182, 212, 0.8), inset 0 0 8px rgba(34, 211, 238, 0.6); }
        }
        @media (prefers-reduced-motion: reduce) {
          ${s} .exile-disc-spin-target { animation: none !important; }
        }
        body[data-dsh-tab-hidden] ${s} .exile-disc-spin-target { animation-play-state: paused !important; }
        ${s} .exile-badge-card:focus-visible,
        ${s} .exile-music-card:focus-visible,
        ${s} .exile-action-btn:focus-visible,
        ${s} .exile-bg-btn:focus-visible,
        ${s} .exile-btn-hover:focus-visible,
        ${s} .exile-popover-item:focus-visible {
          outline: 2px solid #06b6d4;
          outline-offset: 2px;
        }
        ${s} .exile-footer-container {
          display: flex;
          flex-direction: column;
          gap: 6px;
          width: 100%;
          box-sizing: border-box;
          font-family: inherit;
          margin-top: auto;
          padding: 6px 0;
        }
        ${s} .exile-badge-card {
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
        ${s} .exile-badge-card:hover {
          transform: translateY(-1.5px);
        }
        ${s} .exile-badge-card:active {
          transform: scale(0.98);
        }
        ${s} .exile-badge-compass {
          width: 26px;
          height: 26px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.3s ease;
        }
        ${s} .exile-badge-card:hover .exile-badge-compass {
          transform: rotate(-8deg);
        }
        ${s} .exile-badge-content {
          display: flex;
          flex-direction: column;
          line-height: 1.25;
          min-width: 0;
          flex: 1;
        }
        ${s} .exile-badge-meta-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }
        ${s} .exile-badge-title {
          font-size: 11.5px;
          font-weight: 700;
          letter-spacing: 0.5px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        ${s} .exile-bg-btn {
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
        ${s} .exile-bg-btn:hover {
          transform: scale(1.05);
        }
        ${s} .exile-badge-sub {
          font-size: 10px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          letter-spacing: 0.3px;
          opacity: 0.85;
        }
        ${s} .exile-music-card {
          box-sizing: border-box;
          display: flex;
          align-items: center;
          gap: 10px;
          border-radius: 12px;
          padding: 8px 12px;
          cursor: pointer;
          user-select: none;
          transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease, background 0.3s ease, border-color 0.2s ease;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          font-family: inherit;
        }
        ${s} .exile-music-card:hover {
          transform: translateY(-2px);
        }
        ${s} .exile-music-card:active {
          transform: scale(0.98);
        }
        ${s} .exile-btn-hover {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 2px 4px;
          border-radius: 4px;
          transition: background 0.15s ease, transform 0.15s ease;
        }
        ${s} .exile-btn-hover:hover {
          background: rgba(125, 125, 125, 0.2);
          transform: scale(1.1);
        }
        /* Collapsed / Rail sidebar mode adjustments */
        ${s} [data-sidebar-collapsed] .exile-badge-content,
        ${s} [data-sidebar-collapsed] .exile-music-info {
          display: none !important;
        }
        ${s} [data-sidebar-collapsed] .exile-badge-card,
        ${s} [data-sidebar-collapsed] .exile-music-card {
          width: 36px;
          height: 36px;
          padding: 0;
          justify-content: center;
          margin: 0 auto;
        }
        /* Mini Wallpaper Grid Popover */
        ${s} .exile-wallpaper-popover {
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
          animation: exile-pop-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes exile-pop-in {
          from { opacity: 0; transform: translateY(8px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        ${s} .exile-popover-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px 8px 12px;
          border-bottom: 1px solid rgba(125, 125, 125, 0.2);
          font-size: 12px;
          font-weight: 700;
        }
        ${s} .exile-popover-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 7px;
          padding: 10px;
          overflow-y: auto;
          max-height: 350px;
        }
        ${s} .exile-popover-item {
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
        ${s} .exile-popover-item:hover {
          transform: scale(1.03);
          background: rgba(125, 125, 125, 0.15);
        }
        ${s} .exile-popover-item.active {
          border-color: #06b6d4;
          box-shadow: 0 0 8px rgba(6, 182, 212, 0.4);
        }
        ${s} .exile-thumb-img {
          width: 100%;
          height: 64px;
          object-fit: cover;
          border-radius: 6px;
          display: block;
        }
        ${s} .exile-thumb-label {
          font-size: 10px;
          font-weight: 600;
          text-align: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        ${s} .exile-vol-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 46px;
          height: 3px;
          border-radius: 2px;
          background: rgba(125, 125, 125, 0.35);
          outline: none;
          cursor: pointer;
        }
        ${s} .exile-vol-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: currentColor;
          cursor: pointer;
        }
      `;
      document.head.appendChild(styleTag);

      // --- Root Container ---
      const container = document.createElement('div');
      container.className = 'exile-footer-container';
      container.setAttribute('data-exile-footer-container', 'true');

      // --- Visual Overflow Tooltip Bubble ---
      const tipBubble = document.createElement('div');
      tipBubble.className = 'exile-overflow-tooltip';
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
          tipBubble.style.background = 'rgba(14, 28, 48, 0.96)';
          tipBubble.style.border = '1px solid rgba(34, 211, 238, 0.45)';
          tipBubble.style.color = '#e8f0f7';
        } else {
          tipBubble.style.background = 'rgba(238, 240, 234, 0.96)';
          tipBubble.style.border = '1px solid rgba(74, 88, 62, 0.40)';
          tipBubble.style.color = '#1b2220';
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

      // --- 1. Vanship Flight Badge (hosts the wallpaper switcher) ---
      const badgeCard = document.createElement('div');
      badgeCard.className = 'exile-badge-card';
      badgeCard.setAttribute('data-exile-footer-badge', 'true');
      badgeCard.setAttribute('role', 'group');

      // Sextant / compass emblem with a Claudia crystal core
      const compassWrap = document.createElement('div');
      compassWrap.className = 'exile-badge-compass';
      compassWrap.innerHTML = `
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="9.2" fill="none" stroke="#d4af37" stroke-width="1.1" />
          <circle cx="12" cy="12" r="6.6" fill="none" stroke="#b45309" stroke-width="0.6" stroke-dasharray="1.2 1.6" />
          <path d="M 12 2.8 v 2 M 12 19.2 v 2 M 2.8 12 h 2 M 19.2 12 h 2" stroke="#d4af37" stroke-width="1" stroke-linecap="round" />
          <path d="M 12 6.4 L 14 12 L 12 17.6 L 10 12 Z" fill="#06b6d4" stroke="#0e7490" stroke-width="0.6" />
          <path d="M 12 6.4 L 14 12 L 12 12 Z" fill="#22d3ee" />
          <circle cx="12" cy="12" r="1.3" fill="#4a583e" stroke="#2f3a33" stroke-width="0.5" />
        </svg>
      `;
      badgeCard.appendChild(compassWrap);

      const badgeContent = document.createElement('div');
      badgeContent.className = 'exile-badge-content';

      const metaRow = document.createElement('div');
      metaRow.className = 'exile-badge-meta-row';

      const badgeTitle = document.createElement('span');
      badgeTitle.className = 'exile-badge-title';
      badgeTitle.textContent = '先锋艇 • 飞行徽章';
      const updateBadgeTitleTip = setupOverflowTip(badgeTitle, () => badgeTitle.textContent);
      metaRow.appendChild(badgeTitle);

      const actionsWrap = document.createElement('div');
      actionsWrap.style.cssText = 'display: flex; align-items: center; gap: 4px; flex-shrink: 0;';

      const themeBtn = document.createElement('button');
      themeBtn.type = 'button';
      themeBtn.className = 'exile-bg-btn';
      themeBtn.title = '切换深色/浅色模式';
      actionsWrap.appendChild(themeBtn);

      const bgBtn = document.createElement('button');
      bgBtn.type = 'button';
      bgBtn.className = 'exile-bg-btn';
      bgBtn.textContent = `🖼️ ${BACKGROUNDS[bgIndex].label}`;
      bgBtn.title = '切换大风暴区航线壁纸';
      const updateBgBtnTip = setupOverflowTip(bgBtn, () => bgBtn.textContent, '切换大风暴区航线壁纸');
      actionsWrap.appendChild(bgBtn);
      metaRow.appendChild(actionsWrap);
      badgeContent.appendChild(metaRow);

      const badgeSub = document.createElement('span');
      badgeSub.className = 'exile-badge-sub';
      badgeSub.textContent = 'VANSHIP • 大风暴区航线';
      const updateBadgeSubTip = setupOverflowTip(badgeSub, () => badgeSub.textContent);
      badgeContent.appendChild(badgeSub);

      badgeCard.appendChild(badgeContent);
      container.appendChild(badgeCard);

      // --- 2. Claudia Vinyl Music Player ---
      const card = document.createElement('div');
      card.className = 'exile-music-card';
      card.setAttribute('data-exile-music-player', 'true');
      card.setAttribute('role', 'group');
      card.setAttribute('tabindex', '0');

      // Disc icon (Claudia cyan & brass gear vinyl)
      const disc = document.createElement('div');
      disc.classList.add('exile-disc-spin-target');
      disc.style.cssText = `
        width: 30px;
        height: 30px;
        border-radius: 50%;
        background: radial-gradient(circle, #d4af37 16%, #0891b2 22%, #0e7490 68%, #164e63 100%);
        box-shadow: 0 2px 6px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(34, 211, 238, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: transform 0.3s ease;
      `;
      const centerHole = document.createElement('div');
      centerHole.style.cssText = 'width: 8px; height: 8px; border-radius: 50%; background: #ffffff; box-shadow: 0 0 2px rgba(6,182,212,0.6);';
      disc.appendChild(centerHole);
      card.appendChild(disc);

      // Info block
      const info = document.createElement('div');
      info.className = 'exile-music-info';
      info.style.cssText = 'display: flex; flex-direction: column; line-height: 1.25; min-width: 0; flex: 1;';

      const titleRow = document.createElement('div');
      titleRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 6px;';

      const titleGroup = document.createElement('div');
      titleGroup.style.cssText = 'display: flex; align-items: center; gap: 5px; min-width: 0; flex: 1;';

      const tagBadge = document.createElement('span');
      tagBadge.style.cssText = 'font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 3px; flex-shrink: 0; line-height: 1.1;';
      titleGroup.appendChild(tagBadge);

      const title = document.createElement('span');
      title.className = 'exile-music-title';
      title.style.cssText = 'font-size: 11.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
      const updateMusicTitleTip = setupOverflowTip(title, () => title.textContent);
      titleGroup.appendChild(title);
      titleRow.appendChild(titleGroup);

      const ctrlGroup = document.createElement('div');
      ctrlGroup.style.cssText = 'display: flex; align-items: center; gap: 4px; flex-shrink: 0;';

      const playIcon = document.createElement('span');
      playIcon.className = 'exile-btn-hover';
      playIcon.textContent = '▶';
      playIcon.style.cssText = 'font-size: 11px; cursor: pointer;';
      playIcon.setAttribute('title', '播放 / 暂停');
      ctrlGroup.appendChild(playIcon);

      const nextBtn = document.createElement('span');
      nextBtn.className = 'exile-btn-hover';
      nextBtn.textContent = '⏭';
      nextBtn.style.cssText = 'font-size: 10px; cursor: pointer;';
      nextBtn.setAttribute('title', '切换下一首');
      ctrlGroup.appendChild(nextBtn);

      const volWrap = document.createElement('div');
      volWrap.style.cssText = 'position: relative; display: flex; align-items: center; gap: 2px;';

      const volBtn = document.createElement('span');
      volBtn.className = 'exile-btn-hover';
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
      volSlider.className = 'exile-vol-slider';
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
      ctrlGroup.appendChild(volWrap);

      titleRow.appendChild(ctrlGroup);
      info.appendChild(titleRow);

      const subtitle = document.createElement('span');
      subtitle.className = 'exile-music-sub';
      subtitle.style.cssText = 'font-size: 10px; opacity: 0.82; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
      const updateSubtitleTip = setupOverflowTip(subtitle, () => subtitle.textContent);
      info.appendChild(subtitle);
      card.appendChild(info);
      container.appendChild(card);

      // --- 3. Theme palette sync (cards only; safe on every play/pause) ---
      const applyCardTheme = () => {
        const isDark = ctx.theme.get() === 'dark' || document.body.hasAttribute('data-ds-dark-theme');
        themeBtn.textContent = isDark ? '🌙 暗色' : '☀️ 亮色';
        themeBtn.title = isDark ? '当前为深色模式（大风暴区），点击切换为浅色' : '当前为浅色模式（安纳托雷），点击切换为深色';

        if (isDark) {
          badgeCard.style.background = 'rgba(18, 35, 60, 0.90)';
          badgeCard.style.border = '1px solid rgba(34, 211, 238, 0.28)';
          badgeCard.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.50)';
          badgeTitle.style.color = '#e8f0f7';
          badgeSub.style.color = '#bacbdb';
          themeBtn.style.background = 'rgba(6, 182, 212, 0.20)';
          themeBtn.style.border = '1px solid rgba(34, 211, 238, 0.38)';
          themeBtn.style.color = '#22d3ee';
          bgBtn.style.background = 'rgba(6, 182, 212, 0.20)';
          bgBtn.style.border = '1px solid rgba(34, 211, 238, 0.38)';
          bgBtn.style.color = '#22d3ee';

          card.style.background = 'rgba(18, 35, 60, 0.90)';
          card.style.border = isPlaying ? '1px solid #06b6d4' : '1px solid rgba(34, 211, 238, 0.28)';
          card.style.boxShadow = isPlaying ? '0 4px 16px rgba(6, 182, 212, 0.25)' : '0 4px 16px rgba(0, 0, 0, 0.50)';
          title.style.color = '#e8f0f7';
          subtitle.style.color = '#bacbdb';
          playIcon.style.color = '#22d3ee';
          nextBtn.style.color = '#22d3ee';
          volBtn.style.color = '#22d3ee';
          tagBadge.style.background = 'rgba(6, 182, 212, 0.16)';
          tagBadge.style.color = '#22d3ee';
          tagBadge.style.border = '1px solid rgba(34, 211, 238, 0.35)';

          popover.style.background = 'rgba(14, 28, 48, 0.96)';
          popover.style.border = '1px solid rgba(34, 211, 238, 0.35)';
          popover.style.color = '#e8f0f7';
          popoverCycle.style.background = 'rgba(6, 182, 212, 0.20)';
          popoverCycle.style.border = '1px solid rgba(34, 211, 238, 0.38)';
          popoverCycle.style.color = '#22d3ee';
        } else {
          badgeCard.style.background = 'rgba(238, 240, 234, 0.92)';
          badgeCard.style.border = '1px solid rgba(74, 88, 62, 0.24)';
          badgeCard.style.boxShadow = '0 4px 16px rgba(22, 30, 24, 0.12)';
          badgeTitle.style.color = '#1b2220';
          badgeSub.style.color = '#45514a';
          themeBtn.style.background = 'rgba(143, 100, 16, 0.10)';
          themeBtn.style.border = '1px solid rgba(143, 100, 16, 0.26)';
          themeBtn.style.color = '#8f6410';
          bgBtn.style.background = 'rgba(143, 100, 16, 0.10)';
          bgBtn.style.border = '1px solid rgba(143, 100, 16, 0.26)';
          bgBtn.style.color = '#8f6410';

          card.style.background = 'rgba(238, 240, 234, 0.92)';
          card.style.border = isPlaying ? '1px solid #8f6410' : '1px solid rgba(74, 88, 62, 0.24)';
          card.style.boxShadow = isPlaying ? '0 4px 16px rgba(143, 100, 16, 0.18)' : '0 4px 16px rgba(22, 30, 24, 0.12)';
          title.style.color = '#1b2220';
          subtitle.style.color = '#45514a';
          playIcon.style.color = '#8f6410';
          nextBtn.style.color = '#8f6410';
          volBtn.style.color = '#8f6410';
          tagBadge.style.background = 'rgba(143, 100, 16, 0.12)';
          tagBadge.style.color = '#8f6410';
          tagBadge.style.border = '1px solid rgba(143, 100, 16, 0.28)';

          popover.style.background = 'rgba(238, 240, 234, 0.96)';
          popover.style.border = '1px solid rgba(74, 88, 62, 0.28)';
          popover.style.color = '#1b2220';
          popoverCycle.style.background = 'rgba(143, 100, 16, 0.10)';
          popoverCycle.style.border = '1px solid rgba(143, 100, 16, 0.26)';
          popoverCycle.style.color = '#8f6410';
        }
      };

      // --- 4. Wallpaper Palette Popover Setup ---
      const popover = document.createElement('div');
      popover.className = 'exile-wallpaper-popover';

      const popoverHeader = document.createElement('div');
      popoverHeader.className = 'exile-popover-header';

      const popoverTitle = document.createElement('span');
      popoverTitle.textContent = `航线壁纸 (${BACKGROUNDS.length})`;
      popoverHeader.appendChild(popoverTitle);

      const popoverActions = document.createElement('div');
      popoverActions.style.cssText = 'display: flex; align-items: center; gap: 8px;';

      const popoverCycle = document.createElement('button');
      popoverCycle.type = 'button';
      popoverCycle.className = 'exile-bg-btn';
      popoverCycle.textContent = '▶ 下一张';
      popoverCycle.title = '轮换下一张壁纸';
      popoverActions.appendChild(popoverCycle);

      const popoverClose = document.createElement('span');
      popoverClose.className = 'exile-btn-hover';
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
      popoverGrid.className = 'exile-popover-grid';

      const gridItems = [];

      BACKGROUNDS.forEach((bg, idx) => {
        const item = document.createElement('div');
        item.className = `exile-popover-item ${idx === bgIndex ? 'active' : ''}`;
        item.setAttribute('data-bg-id', bg.id);
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.setAttribute('aria-label', `选择壁纸: ${bg.label}`);

        const thumbImg = document.createElement('img');
        thumbImg.className = 'exile-thumb-img';
        thumbImg.alt = bg.label;
        const previewFile = bg.file || 'grandstream.jpg';
        thumbImg.src = `${ctx.assetBase}/assets/${previewFile}`;
        item.appendChild(thumbImg);

        const thumbLabel = document.createElement('span');
        thumbLabel.className = 'exile-thumb-label';
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

      // --- 4. Theme & Wallpaper click handlers ---
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
          console.warn('[last-exile] Failed to persist theme preference:', err);
        }
      });

      // --- 5. Track switching & playback state ---
      const updatePlayState = () => {
        if (isPlaying) {
          subtitle.textContent = `正在播放 [${currentIndex + 1}/${playlist.length}] • 点击暂停`;
          playIcon.textContent = '⏸';
          disc.style.animation = 'exile-disc-spin 3.5s linear infinite';
        } else {
          subtitle.textContent = `已就绪 [${currentIndex + 1}/${playlist.length}] • 点击播放`;
          playIcon.textContent = '▶';
          disc.style.animation = 'none';
        }
        updateSubtitleTip();
        applyCardTheme();
      };

      const setTrack = (index, shouldPlay = false) => {
        currentIndex = (index + playlist.length) % playlist.length;
        const track = playlist[currentIndex];
        audio.src = `${ctx.assetBase}/assets/${track.file}`;
        title.textContent = `${track.title} • ${track.artist}`;
        updateMusicTitleTip();
        tagBadge.textContent = track.tag;
        card.setAttribute('aria-label', `最后流亡主题曲: [${track.tag}] ${track.title} - ${track.artist}`);

        if (shouldPlay) {
          audio.play().then(() => {
            isPlaying = true;
            updatePlayState();
          }).catch((err) => {
            console.warn('[last-exile] Audio playback failed:', err);
            isPlaying = false;
            updatePlayState();
            subtitle.textContent = '请再次点击以播放';
            updateSubtitleTip();
          });
        } else {
          isPlaying = false;
          updatePlayState();
        }
      };

      // Play / Pause toggle
      const toggle = () => {
        if (!isPlaying) {
          audio.play().then(() => {
            isPlaying = true;
            updatePlayState();
          }).catch((err) => {
            console.warn('[last-exile] Audio playback failed:', err);
            subtitle.textContent = '请再次点击以播放';
            updateSubtitleTip();
          });
        } else {
          audio.pause();
          isPlaying = false;
          updatePlayState();
        }
      };

      // Next track handler
      const nextTrack = (e) => {
        if (e) e.stopPropagation();
        setTrack(currentIndex + 1, isPlaying);
      };

      // Auto play next track when current ends
      audio.addEventListener('ended', () => {
        setTrack(currentIndex + 1, true);
      });

      // Initialize track 0
      setTrack(0, false);

      playIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle();
      });
      card.addEventListener('click', (e) => {
        if (e.target.closest('button, input')) return;
        toggle();
      });
      nextBtn.addEventListener('click', nextTrack);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target.closest('button, input')) return;
          e.preventDefault();
          toggle();
        } else if (e.key === 'ArrowRight' || e.key === 'n') {
          e.preventDefault();
          nextTrack();
        } else if (e.key === 'ArrowLeft' || e.key === 'p') {
          e.preventDefault();
          setTrack(currentIndex - 1, isPlaying);
        }
      });

      // --- 6. Mount into Sidebar or Fallback to Floating ---
      let mounted = false;
      const mountIntoSidebar = () => {
        if (mounted) return true;
        // Try to find the sidebar footer or bottom container
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
          container.style.margin = '8px 12px';
          mounted = true;
          return true;
        }
        return false;
      };

      // If sidebar isn't ready immediately (e.g. initial React render), observe DOM
      let observer = null;
      if (!mountIntoSidebar()) {
        container.style.position = 'fixed';
        container.style.bottom = '18px';
        container.style.left = '20px';
        container.style.zIndex = '9999';
        container.style.maxWidth = '280px';
        document.body.appendChild(container);

        observer = new MutationObserver(() => {
          if (mountIntoSidebar()) {
            container.style.bottom = 'auto';
            container.style.left = 'auto';
            container.style.zIndex = 'auto';
            container.style.maxWidth = 'none';
            if (observer) {
              observer.disconnect();
              observer = null;
            }
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
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

      // Clean disposal
      ctx.onCleanup(() => {
        disposed = true;
        for (const id of timers) clearTimeout(id);
        timers.clear();
        document.removeEventListener('visibilitychange', syncTabHidden);
        document.body.removeAttribute('data-dsh-tab-hidden');
        unsubTheme();
        if (observer) observer.disconnect();
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
