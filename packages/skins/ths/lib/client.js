window.__ModuleLoader__.load({
	id: "@linxin666/dsh-client-ui-skin-ths",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0dsh-css:C:\Users\muhammad.alg_ext\Pictures\dsh-web-ui\packages\skins\ths\src\client\ths.module.css.mjs
		const css = "body[data-dsh-ths]{--dsw-font-family:\"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", \"WenQuanYi Micro Hei\", \"Segoe UI\", sans-serif;--ds-font-family-code:\"SFMono-Regular\", \"Menlo\", \"Consolas\", \"Liberation Mono\", monospace;color:#1f2733;box-sizing:border-box;background-color:#e9edf2;padding:34px 10px 28px}body[data-dsh-ths][data-ds-dark-theme]{color:#d7dde6;background-color:#10151d}body[data-dsh-ths] [id=root]{box-sizing:border-box;background:#fff;border:1px solid #b7bfc9;box-shadow:0 1px #e4e8ee,0 3px 12px #17202d1f}body[data-dsh-ths][data-ds-dark-theme] [id=root]{background:#141a22;border-color:#242e3b;box-shadow:0 1px #0c1118,0 3px 12px #00000080}body[data-dsh-ths] *{border-radius:2px!important}body[data-dsh-ths]{--dsw-static-amber-100:#f8ecd9;--dsw-static-amber-400:#d69a3a;--dsw-static-amber-500:#b07600;--dsw-static-amber-600:#966300;--dsw-static-amber-900:#3f2f10;--dsw-static-blue-100:#e2e9f1;--dsw-static-blue-300:#aec3d6;--dsw-static-blue-400:#8aa7c0;--dsw-static-blue-450:#6f92b0;--dsw-static-blue-500:#56799a;--dsw-static-blue-50:#f4f7fa;--dsw-static-blue-50p:#eef3f8;--dsw-static-blue-600:#46627f;--dsw-static-blue-75:#edf2f7;--dsw-static-blue-800:#2b4158;--dsw-static-blue-950:#182635;--dsw-static-deepseek-100:#e2e9f1;--dsw-static-deepseek-200:#ccd9e6;--dsw-static-deepseek-300:#aec3d6;--dsw-static-deepseek-400:#8aa7c0;--dsw-static-deepseek-450:#6f92b0;--dsw-static-deepseek-500:#56799a;--dsw-static-deepseek-50:#f4f7fa;--dsw-static-deepseek-600:#46627f;--dsw-static-deepseek-700-delete:#35506a;--dsw-static-deepseek-800:#2b4158;--dsw-static-deepseek-900:#223446;--dsw-static-green-100:#d6f0e1;--dsw-static-green-400:#35b26d;--dsw-static-green-500:#0d9b4f;--dsw-static-green-900:#14402a;--dsw-static-neutral-00:#fff;--dsw-static-neutral-1000:#131a22;--dsw-static-neutral-100:#f0f3f6;--dsw-static-neutral-150:#e9edf2;--dsw-static-neutral-200:#e3e8ee;--dsw-static-neutral-250:#dbe1e8;--dsw-static-neutral-300:#ccd4dd;--dsw-static-neutral-400:#aab5c1;--dsw-static-neutral-500:#8b98a8;--dsw-static-neutral-50:#f6f8fa;--dsw-static-neutral-550:#7e8b9b;--dsw-static-neutral-600:#6c7989;--dsw-static-neutral-700:#566374;--dsw-static-neutral-800:#3e4a59;--dsw-static-neutral-850:#333e4c;--dsw-static-neutral-900:#232c38;--dsw-static-neutral-bluish-00:#fff;--dsw-static-neutral-bluish-1000:#131a22;--dsw-static-neutral-bluish-100:#f0f3f6;--dsw-static-neutral-bluish-150:#e9edf2;--dsw-static-neutral-bluish-200:#e3e8ee;--dsw-static-neutral-bluish-300:#ccd4dd;--dsw-static-neutral-bluish-400:#aab5c1;--dsw-static-neutral-bluish-500:#8b98a8;--dsw-static-neutral-bluish-50:#f6f8fa;--dsw-static-neutral-bluish-600:#6c7989;--dsw-static-neutral-bluish-60:#f3f5f8;--dsw-static-neutral-bluish-700:#566374;--dsw-static-neutral-bluish-750:#495567;--dsw-static-neutral-bluish-75:#eef1f5;--dsw-static-neutral-bluish-800:#3e4a59;--dsw-static-neutral-bluish-850:#333e4c;--dsw-static-neutral-bluish-875:#2b3542;--dsw-static-neutral-bluish-900:#232c38;--dsw-static-neutral-bluish-950:#1b232d;--dsw-static-red-100:#fadcd9;--dsw-static-red-400:#e6544a;--dsw-static-red-500:#e60012;--dsw-static-red-50:#fdf0ef;--dsw-static-red-600:#c4000f;--dsw-static-red-900:#5c0f0a}body[data-dsh-ths][data-ds-dark-theme]{--dsw-static-amber-100:#3a2d14;--dsw-static-amber-400:#d69a3a;--dsw-static-amber-500:#b07600;--dsw-static-amber-600:#966300;--dsw-static-amber-900:#3f2f10;--dsw-static-blue-100:#1f2d3d;--dsw-static-blue-300:#2f445c;--dsw-static-blue-400:#3d5875;--dsw-static-blue-450:#4b6a8b;--dsw-static-blue-500:#5f81a4;--dsw-static-blue-50:#17222f;--dsw-static-blue-50p:#192531;--dsw-static-blue-600:#7398bb;--dsw-static-blue-75:#1b2735;--dsw-static-blue-800:#97b3cf;--dsw-static-blue-950:#b9cddf;--dsw-static-deepseek-100:#1f2d3d;--dsw-static-deepseek-200:#26374b;--dsw-static-deepseek-300:#2f445c;--dsw-static-deepseek-400:#3d5875;--dsw-static-deepseek-450:#4b6a8b;--dsw-static-deepseek-500:#5f81a4;--dsw-static-deepseek-50:#17222f;--dsw-static-deepseek-600:#7398bb;--dsw-static-deepseek-700-delete:#86a6c6;--dsw-static-deepseek-800:#97b3cf;--dsw-static-deepseek-900:#a8c0d8;--dsw-static-green-100:#1c3a2a;--dsw-static-green-400:#35b26d;--dsw-static-green-500:#2fbf71;--dsw-static-green-900:#14402a;--dsw-static-neutral-00:#151b23;--dsw-static-neutral-1000:#e6ecf3;--dsw-static-neutral-100:#202936;--dsw-static-neutral-150:#25303e;--dsw-static-neutral-200:#2a3645;--dsw-static-neutral-250:#303c4d;--dsw-static-neutral-300:#3a485a;--dsw-static-neutral-400:#4c5b6e;--dsw-static-neutral-500:#5f7085;--dsw-static-neutral-50:#1a212b;--dsw-static-neutral-550:#6a7b90;--dsw-static-neutral-600:#7a8ba0;--dsw-static-neutral-700:#93a3b6;--dsw-static-neutral-800:#b0bdcc;--dsw-static-neutral-850:#bcc8d5;--dsw-static-neutral-900:#cdd7e2;--dsw-static-neutral-bluish-00:#151b23;--dsw-static-neutral-bluish-1000:#e6ecf3;--dsw-static-neutral-bluish-100:#202936;--dsw-static-neutral-bluish-150:#25303e;--dsw-static-neutral-bluish-200:#2a3645;--dsw-static-neutral-bluish-300:#3a485a;--dsw-static-neutral-bluish-400:#4c5b6e;--dsw-static-neutral-bluish-500:#5f7085;--dsw-static-neutral-bluish-50:#1a212b;--dsw-static-neutral-bluish-600:#7a8ba0;--dsw-static-neutral-bluish-60:#1d2530;--dsw-static-neutral-bluish-700:#93a3b6;--dsw-static-neutral-bluish-750:#9faec0;--dsw-static-neutral-bluish-75:#1c2531;--dsw-static-neutral-bluish-800:#b0bdcc;--dsw-static-neutral-bluish-850:#bcc8d5;--dsw-static-neutral-bluish-875:#c6d1dc;--dsw-static-neutral-bluish-900:#cdd7e2;--dsw-static-neutral-bluish-950:#d9e1ea;--dsw-static-red-100:#4a2224;--dsw-static-red-400:#e6544a;--dsw-static-red-500:#ff5252;--dsw-static-red-50:#3a1c1e;--dsw-static-red-600:#d64040;--dsw-static-red-900:#5c1010}body[data-dsh-ths]{--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#f5f7f9;--dsw-alias-bg-layer-2:#eef1f5;--dsw-alias-bg-layer-3:#e7ebf0;--dsw-alias-bg-mask-1:#1018246b;--dsw-alias-bg-mask-2:#10182438;--dsw-alias-bg-mask-3:#1018248c;--dsw-alias-bg-mask-photo:#101824e0;--dsw-alias-bg-module-platform:#eef1f5;--dsw-alias-bg-multi-select:#e9edf2;--dsw-alias-bg-overlay:#eef1f5;--dsw-alias-bg-skeleton:#1018240f;--dsw-alias-border-inverted2:#fff9;--dsw-alias-border-inverted:#fff6;--dsw-alias-border-l1:#1018241a;--dsw-alias-border-l2-darkmode-thin:#10182424;--dsw-alias-border-l2:#10182429;--dsw-alias-border-l3:#1018243d;--dsw-alias-border-l4:#10182459;--dsw-alias-brand-primary-invert:#fff;--dsw-alias-brand-primary-new-colorprimary-new-color:#e60012;--dsw-alias-brand-primary:#e60012;--dsw-alias-brand-text:#e60012;--dsw-alias-button-contrast-fill:#2b3648;--dsw-alias-button-elevated-fill:#fff;--dsw-alias-button-floating-fill:#fff;--dsw-alias-button-floating-hover:#f2f4f7;--dsw-alias-button-ghost-active-border:#9aa6b4;--dsw-alias-button-ghost-active-fill:#e6ebf0;--dsw-alias-button-ghost-active-hover:#dde4eb;--dsw-alias-button-info-fill:#e60012;--dsw-alias-button-info-hover:#c4000f;--dsw-alias-button-primary-dimmed:#efb6ba;--dsw-alias-button-primary-fill:#e60012;--dsw-alias-button-primary-hover:#c4000f;--dsw-alias-button-tool-bar-fill-invisible:#56799a4d;--dsw-alias-button-tool-bar-fill:#56799a6b;--dsw-alias-button-tool-bar-hover:#56799a94;--dsw-alias-interactive-bg-active:#e600121a;--dsw-alias-interactive-bg-hover-accent:#e6001226;--dsw-alias-interactive-bg-hover-danger:#c4000f12;--dsw-alias-interactive-bg-hover-solid:#e9edf2;--dsw-alias-interactive-bg-hover:#56799a1a;--dsw-alias-label-caption:#8a97a6;--dsw-alias-label-dimmed:#a7b1bd;--dsw-alias-label-primary-dimmed:#4a5564;--dsw-alias-label-primary-foreground:#fff;--dsw-alias-label-primary-inverted:#fff;--dsw-alias-label-primary:#1f2733;--dsw-alias-label-secondary:#4a5564;--dsw-alias-label-tertiary:#6b7888;--dsw-alias-markdown-citation:#e9edf2;--dsw-alias-markdown-code-block-banner:#f5f7f9;--dsw-alias-markdown-code-block:#f5f7f9;--dsw-alias-markdown-code-segment-selected:#fff;--dsw-alias-markdown-code-segment-unselected:#eceff3;--dsw-alias-markdown-inline-code:#e9edf2;--dsw-alias-markdown-placeholder:#f0f3f6;--dsw-alias-markdown-tag:#eceff3;--dsw-alias-state-business-primary:#e60012;--dsw-alias-state-business-tertiary:#fadcd9;--dsw-alias-state-error-primary:#e60012;--dsw-alias-state-error-secondary:#e6544a;--dsw-alias-state-success-primary:#0d9b4f;--dsw-alias-state-success-secondary:#35b26d;--dsw-alias-state-success-tertiary:#d6f0e1;--dsw-alias-state-warn-primary:#b07600;--dsw-alias-toast-bg:#2b3648;--dsw-alias-tooltip-bg:#2b3648;--dsw-specific-bubble-highlight:#e2e9f1;--dsw-specific-bubble:#eef1f5;--dsw-specific-input-major:#fff;--dsw-specific-login-input:#fff;--dsw-specific-menu:#f5f7f9;--dsw-specific-selector:#e9edf2;--dsw-specific-sidebar-fill:#1b2636;--dsw-specific-sidebar-nav-item-active-accent:#e60012;--dsw-specific-sidebar-nav-item-active:#fdecea;--dsw-specific-sidebar-nav-item-hover:#f3f6f9;--dsw-specific-tip:#f5f7f9}body[data-dsh-ths][data-ds-dark-theme]{--dsw-alias-bg-base:#141a22;--dsw-alias-bg-layer-1:#1a222d;--dsw-alias-bg-layer-2:#1f2834;--dsw-alias-bg-layer-3:#252e3b;--dsw-alias-bg-mask-1:#00000080;--dsw-alias-bg-mask-2:#00000040;--dsw-alias-bg-mask-3:#0000008c;--dsw-alias-bg-mask-photo:#000000e0;--dsw-alias-bg-module-platform:#1f2834;--dsw-alias-bg-multi-select:#202a36;--dsw-alias-bg-overlay:#1d2631;--dsw-alias-bg-skeleton:#ffffff0f;--dsw-alias-border-inverted2:#fff9;--dsw-alias-border-inverted:#fff6;--dsw-alias-border-l1:#ffffff14;--dsw-alias-border-l2-darkmode-thin:#ffffff1f;--dsw-alias-border-l2:#ffffff29;--dsw-alias-border-l3:#ffffff3d;--dsw-alias-border-l4:#ffffff52;--dsw-alias-brand-primary-invert:#0e131a;--dsw-alias-brand-primary-new-colorprimary-new-color:#ff5a5a;--dsw-alias-brand-primary:#ff5a5a;--dsw-alias-brand-text:#ff5a5a;--dsw-alias-button-contrast-fill:#c8d2dd;--dsw-alias-button-elevated-fill:#1a222d;--dsw-alias-button-floating-fill:#1d2631;--dsw-alias-button-floating-hover:#222c39;--dsw-alias-button-ghost-active-border:#7e8c9c;--dsw-alias-button-ghost-active-fill:#252e3b;--dsw-alias-button-ghost-active-hover:#2a3442;--dsw-alias-button-info-fill:#e60012;--dsw-alias-button-info-hover:#ff1a2b;--dsw-alias-button-primary-dimmed:#4a262b;--dsw-alias-button-primary-fill:#e60012;--dsw-alias-button-primary-hover:#c4000f;--dsw-alias-button-tool-bar-fill-invisible:#b4c8e14d;--dsw-alias-button-tool-bar-fill:#b4c8e16b;--dsw-alias-button-tool-bar-hover:#b4c8e194;--dsw-alias-interactive-bg-active:#ff5a5a29;--dsw-alias-interactive-bg-hover-accent:#ff5a5a38;--dsw-alias-interactive-bg-hover-danger:#ff5a5a24;--dsw-alias-interactive-bg-hover-solid:#222c39;--dsw-alias-interactive-bg-hover:#b4c8e11a;--dsw-alias-label-caption:#64748a;--dsw-alias-label-dimmed:#55647a;--dsw-alias-label-primary-dimmed:#aebcce;--dsw-alias-label-primary-foreground:#fff;--dsw-alias-label-primary-inverted:#fff;--dsw-alias-label-primary:#e2e9f2;--dsw-alias-label-secondary:#b3c0d0;--dsw-alias-label-tertiary:#8d9bad;--dsw-alias-markdown-citation:#1a222d;--dsw-alias-markdown-code-block-banner:#161d27;--dsw-alias-markdown-code-block:#161d27;--dsw-alias-markdown-code-segment-selected:#202a36;--dsw-alias-markdown-code-segment-unselected:#1c2531;--dsw-alias-markdown-inline-code:#1d2631;--dsw-alias-markdown-placeholder:#1a222d;--dsw-alias-markdown-tag:#1d2631;--dsw-alias-state-business-primary:#ff5a5a;--dsw-alias-state-business-tertiary:#3a2026;--dsw-alias-state-error-primary:#ff5a5a;--dsw-alias-state-error-secondary:#e6544a;--dsw-alias-state-success-primary:#2fbf71;--dsw-alias-state-success-secondary:#35b26d;--dsw-alias-state-success-tertiary:#1c3a2a;--dsw-alias-state-warn-primary:#d69a3a;--dsw-alias-toast-bg:#3a4657;--dsw-alias-tooltip-bg:#2c3a4e;--dsw-specific-bubble-highlight:#26344a;--dsw-specific-bubble:#1f2834;--dsw-specific-input-major:#141a22;--dsw-specific-login-input:#141a22;--dsw-specific-menu:#1a222d;--dsw-specific-selector:#202a36;--dsw-specific-sidebar-fill:#0f141c;--dsw-specific-sidebar-nav-item-active-accent:#ff5a5a;--dsw-specific-sidebar-nav-item-active:#33262c;--dsw-specific-sidebar-nav-item-hover:#1d2733;--dsw-specific-tip:#1a222d}body[data-dsh-ths] ::selection{background:#e600122e}body[data-dsh-ths][data-ds-dark-theme] ::selection{background:#ff5a5a4d}.GhAeCq_thsTitlebar{z-index:1000000;color:#fff;user-select:none;background:linear-gradient(90deg,#e60012 0%,#b8000c 100%);border-bottom:1px solid #8a0009;align-items:center;gap:8px;height:32px;padding:0 6px;font:600 13px/32px PingFang SC,Hiragino Sans GB,Microsoft YaHei,Segoe UI,sans-serif;display:flex;position:fixed;top:0;left:0;right:0;box-shadow:inset 0 1px #ffffff2e}.GhAeCq_thsTitlebarTitle{white-space:nowrap;text-overflow:ellipsis;flex:1;overflow:hidden}.GhAeCq_thsTitlebarIcon{flex:none;align-items:center;display:inline-flex}.GhAeCq_thsTitlebarBtn{color:#fff;border-radius:2px;flex:none;justify-content:center;align-items:center;width:22px;height:20px;font-size:11px;line-height:1;display:inline-flex}.GhAeCq_thsTitlebarBtn:hover{background:#ffffff38}.GhAeCq_thsTitlebarTicker{color:#55616f;background:#fffffff0;border-radius:2px;flex:none;align-items:center;gap:6px;height:20px;margin-right:8px;padding:0 10px;font:600 11px/1 PingFang SC,Hiragino Sans GB,Microsoft YaHei,Segoe UI,sans-serif;display:inline-flex}.GhAeCq_thsTitlebarTickerVal{color:#1f2733;font-variant-numeric:tabular-nums;font-weight:700}.GhAeCq_thsTitlebarTickerChg{color:#e60012;font-weight:700}.GhAeCq_thsTitlebarTickerChg[data-trend=down]{color:#0d9b4f}.GhAeCq_thsStatusbar{z-index:1000000;color:#55616f;user-select:none;background:#edf1f5;border-top:1px solid #c9d1db;align-items:stretch;height:26px;font:11px/26px PingFang SC,Hiragino Sans GB,Microsoft YaHei,Segoe UI,sans-serif;display:flex;position:fixed;bottom:0;left:0;right:0}body[data-dsh-ths][data-ds-dark-theme] .GhAeCq_thsStatusbar{color:#8d9bad;background:#1a212c;border-top-color:#2a3442}.GhAeCq_thsStatusbarCell{white-space:nowrap;font-variant-numeric:tabular-nums;border-right:1px solid #d7dee7;flex:none;padding:0 12px}body[data-dsh-ths][data-ds-dark-theme] .GhAeCq_thsStatusbarCell{border-right-color:#2a3442}.GhAeCq_thsStatusbarCell[data-trend=up]{color:#e60012;font-weight:600}.GhAeCq_thsStatusbarCell[data-trend=down]{color:#0d9b4f;font-weight:600}.GhAeCq_thsStatusbarCell[data-trend=brand]{color:#e60012;font-weight:700}body[data-dsh-ths][data-ds-dark-theme] .GhAeCq_thsStatusbarCell[data-trend=up],body[data-dsh-ths][data-ds-dark-theme] .GhAeCq_thsStatusbarCell[data-trend=brand]{color:#ff5a5a}body[data-dsh-ths][data-ds-dark-theme] .GhAeCq_thsStatusbarCell[data-trend=down]{color:#2fbf71}.GhAeCq_thsStatusbarSpacer{flex:1}body[data-dsh-ths] [data-pane=sidebar]>div{background:linear-gradient(#f4f7fa 0%,#e9eef4 100%)}body[data-dsh-ths][data-ds-dark-theme] [data-pane=sidebar]>div{background:linear-gradient(#182029 0%,#141b24 100%)}body[data-dsh-ths] [data-pane=sidebar]>div>:first-child,body[data-dsh-ths] [data-pane=sidebar]>div>:first-child *{color:#fff}body[data-dsh-ths] [data-pane=sidebar]>div>:first-child{background:linear-gradient(#1b2636,#253348);border-bottom:2px solid #e60012;box-shadow:inset 0 1px #ffffff14}body[data-dsh-ths][data-ds-dark-theme] [data-pane=sidebar]>div>:first-child{background:linear-gradient(#101a2a,#16233a);border-bottom-color:#e60012}body[data-dsh-ths] [data-pane=sidebar]>div>:first-child button{color:#fff;background:0 0}body[data-dsh-ths] [data-pane=sidebar]>div>:first-child button:hover{background:#ffffff24}body[data-dsh-ths] [data-pane=sidebar]>div>:first-child svg rect[fill=currentColor]{fill:#e60012}body[data-dsh-ths] [data-pane=sidebar]>div>:first-child svg [fill=\"var(--dsw-alias-label-primary-inverted)\"]{fill:#fff}body[data-dsh-ths] [data-pane=sidebar]>div>button{color:#fff;background:linear-gradient(#c80010,#a5000d);border:1px solid #8a0009;font-weight:600;box-shadow:inset 0 1px #ffffff2e}body[data-dsh-ths] [data-pane=sidebar]>div>button:hover{background:linear-gradient(#d40012,#b0000e)}body[data-dsh-ths] [data-pane=sidebar] [role=treeitem]{border-bottom:1px solid #1018240d}body[data-dsh-ths] [data-pane=sidebar] [role=treeitem][aria-selected=true]{background:linear-gradient(90deg,#e6001224,#e600120d);box-shadow:inset 3px 0 #e60012}body[data-dsh-ths][data-ds-dark-theme] [data-pane=sidebar] [role=treeitem]{border-bottom-color:#ffffff0f}body[data-dsh-ths][data-ds-dark-theme] [data-pane=sidebar] [role=treeitem][aria-selected=true]{background:linear-gradient(90deg,#ff5a5a33,#ff5a5a0f);box-shadow:inset 3px 0 #ff5a5a}body[data-dsh-ths] [data-pane=sidebar] input{color:#1f2733;background:#fff;border:1px solid #10182429}body[data-dsh-ths] [data-pane=sidebar] input:focus{border-color:#e60012;box-shadow:0 0 0 2px #e6001224}body[data-dsh-ths][data-ds-dark-theme] [data-pane=sidebar] input{color:#e2e9f2;background:#141a22;border-color:#ffffff24}body[data-dsh-ths] [data-pane=sidebar]>div>:last-child{background:#f5f7f9;border-top:1px solid #1018241a}body[data-dsh-ths][data-ds-dark-theme] [data-pane=sidebar]>div>:last-child{background:#1a222d;border-top-color:#ffffff14}body[data-dsh-ths] [data-pane=conversation]{background:#fff}body[data-dsh-ths][data-ds-dark-theme] [data-pane=conversation]{background:#12181f}body[data-dsh-ths] [data-pane=conversation]>div>header{background:#eef1f5;border-bottom:1px solid #d9dfe7;border-left:3px solid #e60012}body[data-dsh-ths][data-ds-dark-theme] [data-pane=conversation]>div>header{background:#1c2531;border-bottom-color:#2b3543;border-left-color:#ff5a5a}body[data-dsh-ths] [data-pane=details]{background:#f4f6f9;box-shadow:-1px 0 #1018241a}body[data-dsh-ths][data-ds-dark-theme] [data-pane=details]{background:#161d27;box-shadow:-1px 0 #ffffff14}body[data-dsh-ths] [role=dialog]{border:1px solid #b7bfc9}body[data-dsh-ths][data-ds-dark-theme] [role=dialog]{border-color:#242e3b}body[data-dsh-ths] [role=dialog]>nav{background:#f5f7f9;border-right:1px solid #1018241a}body[data-dsh-ths][data-ds-dark-theme] [role=dialog]>nav{background:#1a222d;border-right-color:#ffffff14}body[data-dsh-ths] [role=dialog]>nav>div:first-child{color:#fff;background:linear-gradient(#1b2636,#253348);font-weight:600}body[data-dsh-ths][data-ds-dark-theme] [role=dialog]>nav>div:first-child{background:linear-gradient(#101a2a,#16233a)}body[data-dsh-ths] [role=dialog]>nav button:hover{background:#1018240f}body[data-dsh-ths][data-ds-dark-theme] [role=dialog]>nav button:hover{background:#ffffff14}body[data-dsh-ths] [role=dialog]>nav button[aria-current=true]{color:#c4000f;background:linear-gradient(90deg,#e6001224,#e600120d);font-weight:600;box-shadow:inset 3px 0 #e60012}body[data-dsh-ths][data-ds-dark-theme] [role=dialog]>nav button[aria-current=true]{color:#ff5a5a;background:linear-gradient(90deg,#ff5a5a33,#ff5a5a0f);box-shadow:inset 3px 0 #ff5a5a}body[data-dsh-ths] [role=dialog]>div{background:#fff}body[data-dsh-ths][data-ds-dark-theme] [role=dialog]>div{background:#141a22}body[data-dsh-ths] [role=dialog]>div>div:first-child{background:#f5f7f9;border-bottom:1px solid #1018241a}body[data-dsh-ths][data-ds-dark-theme] [role=dialog]>div>div:first-child{background:#1a222d;border-bottom-color:#ffffff14}body[data-dsh-ths]{--aion-bg-base:#fff;--aion-bg-1:#f4f6f9;--aion-bg-2:#eef1f5;--aion-bg-3:#e3e8ee;--aion-bg-4:#ccd4dd;--aion-bg-hover:#f0f3f6;--aion-bg-active:#e7ebf0;--aion-text-primary:#1f2733;--aion-text-secondary:#4a5564;--aion-text-tertiary:#6b7888;--aion-text-disabled:#a7b1bd;--aion-primary:#e60012;--aion-success:#0d9b4f;--aion-warning:#b07600;--aion-danger:#e60012;--aion-brand:#56799a;--aion-aou-1:#e2e9f1;--aion-aou-2:#aec3d6;--aion-aou-3:#8aa7c0;--aion-aou-4:#6f92b0;--aion-aou-5:#56799a;--aion-aou-6:#46627f;--aion-fill-2:#f0f3f6;--aion-fill-3:#e7ebf0;--aion-border-base:#e3e8ee;--aion-overlay-shadow:0 4px 20px #17202d2e, 0 1px 3px #17202d1f;--aion-font-sans:\"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", \"WenQuanYi Micro Hei\", \"Segoe UI\", sans-serif;--aion-font-mono:\"SFMono-Regular\", \"Menlo\", \"Consolas\", \"Liberation Mono\", monospace}body[data-dsh-ths][data-ds-dark-theme]{--aion-bg-base:#141a22;--aion-bg-1:#161d27;--aion-bg-2:#1c2531;--aion-bg-3:#252e3b;--aion-bg-4:#33404f;--aion-bg-hover:#1a222d;--aion-bg-active:#1f2834;--aion-text-primary:#e2e9f2;--aion-text-secondary:#b3c0d0;--aion-text-tertiary:#8d9bad;--aion-text-disabled:#55647a;--aion-primary:#ff5a5a;--aion-success:#2fbf71;--aion-warning:#d69a3a;--aion-danger:#ff5252;--aion-brand:#5f81a4;--aion-aou-1:#1f2d3d;--aion-aou-2:#2f445c;--aion-aou-3:#3d5875;--aion-aou-4:#4b6a8b;--aion-aou-5:#5f81a4;--aion-aou-6:#7398bb;--aion-fill-2:#ffffff14;--aion-fill-3:#ffffff1f;--aion-border-base:#252e3b;--aion-overlay-shadow:0 4px 24px #0009, 0 1px 3px #0006;--aion-font-sans:\"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", \"WenQuanYi Micro Hei\", \"Segoe UI\", sans-serif;--aion-font-mono:\"SFMono-Regular\", \"Menlo\", \"Consolas\", \"Liberation Mono\", monospace}body[data-dsh-ths] [data-aionui-explorer-col],body[data-dsh-ths] [data-aionui-preview-col]{background:#f4f6f9;border-left-color:#ccd4dd}body[data-dsh-ths][data-ds-dark-theme] [data-aionui-explorer-col],body[data-dsh-ths][data-ds-dark-theme] [data-aionui-preview-col]{background:#12181f;border-left-color:#2a3442}body[data-dsh-ths] .aionui-root{font-family:var(--aion-font-sans);color:var(--aion-text-primary)}body[data-dsh-ths] .aionui-explorer-handle,body[data-dsh-ths] .aionui-preview-handle{background:#ccd4dd}body[data-dsh-ths] .aionui-explorer-handle:hover,body[data-dsh-ths] .aionui-preview-handle:hover{background:var(--aion-brand)}body[data-dsh-ths][data-ds-dark-theme] .aionui-explorer-handle,body[data-dsh-ths][data-ds-dark-theme] .aionui-preview-handle{background:#2a3442}body[data-dsh-ths] .aionui-collapse-chevron{color:var(--aion-text-tertiary)}body[data-dsh-ths] .aionui-collapse-chevron:hover{color:var(--aion-primary)}body[data-dsh-ths] .aionui-floating-expand{color:#46627f;background:#fff;border:1px solid #ccd4dd;box-shadow:0 1px 3px #17202d24}body[data-dsh-ths] .aionui-floating-expand:hover{color:#e60012;border-color:#e60012}body[data-dsh-ths][data-ds-dark-theme] .aionui-floating-expand{color:#a8c0d8;background:#1a222d;border-color:#2a3442}body[data-dsh-ths][data-ds-dark-theme] .aionui-floating-expand:hover{color:#ff5a5a;border-color:#ff5a5a}body[data-dsh-ths] .aionui-overlay{background:#1018246b}body[data-dsh-ths][data-ds-dark-theme] .aionui-overlay{background:#00000080}body[data-dsh-ths] .aionui-dialog{box-shadow:var(--aion-overlay-shadow);background:#fff;border:1px solid #b7bfc9}body[data-dsh-ths][data-ds-dark-theme] .aionui-dialog{background:#141a22;border-color:#242e3b}body[data-dsh-ths] .aionui-btn{color:#1f2733;background:#f5f7f9;border:1px solid #ccd4dd}body[data-dsh-ths] .aionui-btn:hover{background:#eef1f5;border-color:#aab5c1}body[data-dsh-ths] .aionui-btn-primary{color:#fff;background:linear-gradient(#c80010,#a5000d);border:1px solid #8a0009;font-weight:600}body[data-dsh-ths] .aionui-btn-primary:hover{background:linear-gradient(#d40012,#b0000e)}body[data-dsh-ths] .aionui-btn-danger{color:#c4000f;background:#fdf0ef;border:1px solid #e6544a}body[data-dsh-ths] .aionui-btn-danger:hover{background:#fadcd9}body[data-dsh-ths][data-ds-dark-theme] .aionui-btn{color:#e2e9f2;background:#1a222d;border-color:#2a3442}body[data-dsh-ths][data-ds-dark-theme] .aionui-btn:hover{background:#252e3b;border-color:#3a485a}body[data-dsh-ths][data-ds-dark-theme] .aionui-btn-primary{background:#e60012;border-color:#8a0009}body[data-dsh-ths][data-ds-dark-theme] .aionui-btn-primary:hover{background:#ff1a2b}body[data-dsh-ths][data-ds-dark-theme] .aionui-btn-danger{color:#ff5a5a;background:#3a1c1e;border-color:#e6544a}body[data-dsh-ths][data-ds-dark-theme] .aionui-btn-danger:hover{background:#4a2224}body[data-dsh-ths] .aionui-menu{box-shadow:var(--aion-overlay-shadow);background:#f5f7f9;border:1px solid #ccd4dd}body[data-dsh-ths] .aionui-menu-item{color:var(--aion-text-primary)}body[data-dsh-ths] .aionui-menu-item:hover{background:var(--aion-bg-hover)}body[data-dsh-ths] .aionui-menu-item-disabled{color:var(--aion-text-disabled)}body[data-dsh-ths] .aionui-menu-sep{background:#1018241a}body[data-dsh-ths] .aionui-toast{color:#fff;box-shadow:var(--aion-overlay-shadow);background:#2b3648}body[data-dsh-ths][data-ds-dark-theme] .aionui-menu{background:#1a222d;border-color:#2a3442}body[data-dsh-ths][data-ds-dark-theme] .aionui-menu-item:hover{background:var(--aion-bg-hover)}body[data-dsh-ths][data-ds-dark-theme] .aionui-menu-sep{background:#ffffff14}body[data-dsh-ths][data-ds-dark-theme] .aionui-toast{color:#fff;background:#3a4657}body[data-dsh-ths] .aionui-preview-enter{animation:.18s ease-out GhAeCq_aionPreviewIn}@keyframes GhAeCq_aionPreviewIn{0%{opacity:0}to{opacity:1}}body[data-dsh-ths]{--ths-focus-ring:#e60012}body[data-dsh-ths][data-ds-dark-theme]{--ths-focus-ring:#ff5a5a}body[data-dsh-ths] .GhAeCq_thsTitlebarBtn,body[data-dsh-ths] [data-pane=sidebar] [role=treeitem],body[data-dsh-ths] [data-pane=sidebar] button,body[data-dsh-ths] [role=dialog]>nav button,body[data-dsh-ths] .aionui-btn,body[data-dsh-ths] .aionui-btn-primary,body[data-dsh-ths] .aionui-btn-danger,body[data-dsh-ths] .aionui-menu-item,body[data-dsh-ths] .aionui-explorer-handle,body[data-dsh-ths] .aionui-preview-handle,body[data-dsh-ths] .aionui-collapse-chevron,body[data-dsh-ths] .aionui-floating-expand{-webkit-tap-highlight-color:transparent;transition:background-color .12s,border-color .12s,color .12s,box-shadow .12s}body[data-dsh-ths] button:focus-visible,body[data-dsh-ths] [role=button]:focus-visible,body[data-dsh-ths] [role=treeitem]:focus-visible,body[data-dsh-ths] [role=tab]:focus-visible,body[data-dsh-ths] [role=menuitem]:focus-visible,body[data-dsh-ths] a:focus-visible,body[data-dsh-ths] input:focus-visible,body[data-dsh-ths] .aionui-btn:focus-visible,body[data-dsh-ths] .aionui-btn-primary:focus-visible,body[data-dsh-ths] .aionui-btn-danger:focus-visible,body[data-dsh-ths] .aionui-menu-item:focus-visible,body[data-dsh-ths] .aionui-collapse-chevron:focus-visible,body[data-dsh-ths] .aionui-floating-expand:focus-visible{outline:2px solid var(--ths-focus-ring);outline-offset:2px}body[data-dsh-ths] .GhAeCq_thsTitlebarBtn{-webkit-user-drag:none;user-select:none}body[data-dsh-ths] .GhAeCq_thsTitlebarBtn:active{background:#ffffff57}body[data-dsh-ths] [data-pane=sidebar] [role=treeitem]:not([aria-selected=true]):hover{background-color:var(--dsw-alias-interactive-bg-hover)}body[data-dsh-ths] [data-pane=sidebar] [role=treeitem]:not([aria-selected=true]):active{background-color:var(--dsw-alias-interactive-bg-hover-accent)}body[data-dsh-ths] [data-pane=sidebar]>div>:first-child button:active{background:#ffffff42}body[data-dsh-ths] [data-pane=sidebar]>div>button:active{background:linear-gradient(#b8000c,#8a0009);box-shadow:inset 0 2px 4px #0000003d}body[data-dsh-ths] [role=dialog]>nav button:active{background-color:var(--dsw-alias-interactive-bg-hover-accent)}body[data-dsh-ths] .aionui-btn:active{background:#e7ebf0;border-color:#aab5c1}body[data-dsh-ths] .aionui-btn-primary:active{background:linear-gradient(#b8000c,#8a0009);box-shadow:inset 0 2px 4px #0000003d}body[data-dsh-ths] .aionui-btn-danger:active{background:#f2c6c3;border-color:#e6544a}body[data-dsh-ths] .aionui-menu-item:active{background-color:var(--aion-bg-active)}body[data-dsh-ths][data-ds-dark-theme] .aionui-btn:active{background:#283443;border-color:#4c5b6e}body[data-dsh-ths][data-ds-dark-theme] .aionui-btn-primary:active{background:#c4000f;box-shadow:inset 0 2px 4px #0006}body[data-dsh-ths][data-ds-dark-theme] .aionui-btn-danger:active{background:#4a2224;border-color:#ff5a5a}body[data-dsh-ths] .aionui-explorer-handle:active,body[data-dsh-ths] .aionui-preview-handle:active{background:#46627f}body[data-dsh-ths][data-ds-dark-theme] .aionui-explorer-handle:active,body[data-dsh-ths][data-ds-dark-theme] .aionui-preview-handle:active{background:#7398bb}body[data-dsh-ths] .aionui-collapse-chevron:active{color:#c4000f}body[data-dsh-ths][data-ds-dark-theme] .aionui-collapse-chevron:active{color:#ff1a2b}body[data-dsh-ths] .aionui-floating-expand:active{color:#a5000d;border-color:#a5000d}body[data-dsh-ths][data-ds-dark-theme] .aionui-floating-expand:active{color:#ff1a2b;border-color:#ff1a2b}body[data-dsh-ths] [data-pane=sidebar] button:disabled,body[data-dsh-ths] [data-pane=sidebar] [role=treeitem][aria-disabled=true],body[data-dsh-ths] [role=dialog]>nav button:disabled,body[data-dsh-ths] .aionui-btn:disabled,body[data-dsh-ths] .aionui-btn[disabled],body[data-dsh-ths] .aionui-btn-primary:disabled,body[data-dsh-ths] .aionui-btn-primary[disabled],body[data-dsh-ths] .aionui-btn-danger:disabled,body[data-dsh-ths] .aionui-btn-danger[disabled]{opacity:.5;pointer-events:none}@media (prefers-reduced-motion:reduce){body[data-dsh-ths] *,body[data-dsh-ths] :before,body[data-dsh-ths] :after{transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}body[data-dsh-ths] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+1),body[data-dsh-ths] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+1){color:#56799a}body[data-dsh-ths] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+2),body[data-dsh-ths] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+2){color:#0d9b4f}body[data-dsh-ths] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+3),body[data-dsh-ths] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+3){color:#b07600}body[data-dsh-ths] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+4),body[data-dsh-ths] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+4){color:#46627f}body[data-dsh-ths] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+5),body[data-dsh-ths] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+5){color:#6f92b0}body[data-dsh-ths] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n),body[data-dsh-ths] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n){color:#2fbf71}body[data-dsh-ths][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+1),body[data-dsh-ths][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+1){color:#5f81a4}body[data-dsh-ths][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+2),body[data-dsh-ths][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+2){color:#2fbf71}body[data-dsh-ths][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+3),body[data-dsh-ths][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+3){color:#d69a3a}body[data-dsh-ths][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+4),body[data-dsh-ths][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+4){color:#4b6a8b}body[data-dsh-ths][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+5),body[data-dsh-ths][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+5){color:#7398bb}body[data-dsh-ths][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n),body[data-dsh-ths][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n){color:#4cc98a}body[data-dsh-ths] [data-gitgraph-dialog]{border-color:#b7bfc9}body[data-dsh-ths][data-ds-dark-theme] [data-gitgraph-dialog]{border-color:#242e3b}body[data-dsh-ths] [data-gitgraph-ref]:not([data-gitgraph-ref-current]){color:#4a5564;border:1px solid #ccd4dd}body[data-dsh-ths][data-ds-dark-theme] [data-gitgraph-ref]:not([data-gitgraph-ref-current]){color:#b3c0d0;border-color:#2a3442}body[data-dsh-ths] div:has(>div>[data-gitgraph-chip]){--dsw-alias-button-tool-bar-fill:#56799a14;--dsw-alias-border-l2:#46627f73;--dsw-alias-label-secondary:#46627f;--dsw-alias-label-tertiary:#6b7888;--dsw-alias-interactive-bg-hover:#56799a1f;--dsw-alias-interactive-bg-active:#56799a33}body[data-dsh-ths][data-ds-dark-theme] div:has(>div>[data-gitgraph-chip]){--dsw-alias-button-tool-bar-fill:#ffffff0f;--dsw-alias-border-l2:#5f81a473;--dsw-alias-label-secondary:#a8c0d8;--dsw-alias-label-tertiary:#8d9bad;--dsw-alias-interactive-bg-hover:#5f81a424;--dsw-alias-interactive-bg-active:#5f81a438}body[data-dsh-ths] div:has(>div>[data-gitgraph-chip])>button[aria-expanded=true],body[data-dsh-ths] [data-gitgraph-chip][aria-expanded=true]{background-color:#56799a24}body[data-dsh-ths][data-ds-dark-theme] div:has(>div>[data-gitgraph-chip])>button[aria-expanded=true],body[data-dsh-ths][data-ds-dark-theme] [data-gitgraph-chip][aria-expanded=true]{background-color:#5f81a429}";
		const tagId = "@linxin666/dsh-client-ui-skin-ths/ths.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@linxin666/dsh-client-ui-skin-ths";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var ths_module_css_default = {
			"aionPreviewIn": "GhAeCq_aionPreviewIn",
			"thsStatusbar": "GhAeCq_thsStatusbar",
			"thsStatusbarCell": "GhAeCq_thsStatusbarCell",
			"thsStatusbarSpacer": "GhAeCq_thsStatusbarSpacer",
			"thsTitlebar": "GhAeCq_thsTitlebar",
			"thsTitlebarBtn": "GhAeCq_thsTitlebarBtn",
			"thsTitlebarIcon": "GhAeCq_thsTitlebarIcon",
			"thsTitlebarTicker": "GhAeCq_thsTitlebarTicker",
			"thsTitlebarTickerChg": "GhAeCq_thsTitlebarTickerChg",
			"thsTitlebarTickerVal": "GhAeCq_thsTitlebarTickerVal",
			"thsTitlebarTitle": "GhAeCq_thsTitlebarTitle"
		};
		//#endregion
		//#region src/client/index.ts
		/** The product title the skin pins (captured by the shell's DocumentTitle after settle). */
		const SKIN_TITLE = "同花顺 · DeepSeek 在线";
		/** Refresh cadence of the code-workload index cell. */
		const CODE_INDEX_REFRESH_MS = 3e4;
		/** Status bar cells; the spacer cell splits the quote group from the status group. */
		const STOCK_CELLS = [
			{
				text: "同花顺",
				trend: "brand"
			},
			{
				text: "上证指数 3,342.17 ▲0.42%",
				trend: "up"
			},
			{
				text: "深证成指 10,846.59 ▲0.87%",
				trend: "up"
			},
			{
				text: "创业板指 2,201.33 ▼0.21%",
				trend: "down"
			},
			{
				text: "就绪",
				trend: "none"
			},
			{
				text: "已连接",
				trend: "none"
			},
			{
				text: "在线",
				trend: "none"
			}
		];
		/** Title bar window buttons (decorative glyphs, aria-hidden). */
		const TITLEBAR_GLYPHS = [
			"–",
			"□",
			"×"
		];
		/** Live-quote chip shown in the title bar before the window buttons. */
		const TICKER = {
			name: "上证指数",
			value: "3,342.17",
			change: "▲0.42%",
			trend: "up"
		};
		/**
		* Resolve one module class name. The css-modules record types as
		* `string | undefined` under noUncheckedIndexedAccess; every key used here
		* is a literal name in this package's own stylesheet, so the fallback is
		* unreachable in practice and only satisfies the indexed-access type.
		*/
		const cls = (name) => ths_module_css_default[name] ?? "";
		/** White candlestick mark, inline so the skin carries no static assets. */
		const CANDLE_SVG = [
			"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" viewBox=\"0 0 48 48\" aria-hidden=\"true\">",
			"<rect x=\"6\" y=\"14\" width=\"8\" height=\"20\" fill=\"#fff\"/>",
			"<rect x=\"9\" y=\"6\" width=\"2\" height=\"36\" fill=\"#fff\"/>",
			"<rect x=\"17\" y=\"20\" width=\"8\" height=\"18\" fill=\"#fff\"/>",
			"<rect x=\"20\" y=\"12\" width=\"2\" height=\"34\" fill=\"#fff\"/>",
			"<rect x=\"28\" y=\"10\" width=\"8\" height=\"16\" fill=\"#fff\"/>",
			"<rect x=\"31\" y=\"4\" width=\"2\" height=\"28\" fill=\"#fff\"/>",
			"</svg>"
		].join("");
		/** Brand-red square favicon carrying the 同 glyph, inline data URI. */
		const FAVICON_SVG = [
			"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"64\" viewBox=\"0 0 64 64\">",
			"<rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"12\" fill=\"#e60012\"/>",
			"<text x=\"32\" y=\"45\" font-size=\"36\" font-family=\"PingFang SC, Microsoft YaHei, sans-serif\" fill=\"#fff\" text-anchor=\"middle\">同</text>",
			"</svg>"
		].join("");
		/**
		* Apply the stock-trading skin: body attribute, chrome bars, title, favicon.
		* All writes are retracted by the effect disposer on dispose.
		* @param ctx - owning context (the effect lifecycle owns retraction).
		*/
		function apply(ctx) {
			const body = document.body;
			const originalTitle = document.title;
			body.dataset.dshThs = "";
			const titlebar = document.createElement("div");
			titlebar.className = cls("thsTitlebar");
			titlebar.dataset.skinChrome = "titlebar";
			const icon = document.createElement("span");
			icon.className = cls("thsTitlebarIcon");
			icon.innerHTML = CANDLE_SVG;
			const title = document.createElement("span");
			title.className = cls("thsTitlebarTitle");
			title.textContent = SKIN_TITLE;
			titlebar.append(icon, title);
			const ticker = document.createElement("span");
			ticker.className = cls("thsTitlebarTicker");
			const tickerName = document.createElement("span");
			tickerName.textContent = TICKER.name;
			const tickerValue = document.createElement("span");
			tickerValue.className = cls("thsTitlebarTickerVal");
			tickerValue.textContent = TICKER.value;
			const tickerChange = document.createElement("span");
			tickerChange.className = cls("thsTitlebarTickerChg");
			tickerChange.dataset.trend = TICKER.trend;
			tickerChange.textContent = TICKER.change;
			ticker.append(tickerName, tickerValue, tickerChange);
			titlebar.append(ticker);
			for (const glyph of TITLEBAR_GLYPHS) {
				const btn = document.createElement("span");
				btn.className = cls("thsTitlebarBtn");
				btn.setAttribute("aria-hidden", "true");
				btn.textContent = glyph;
				titlebar.append(btn);
			}
			const statusbar = document.createElement("div");
			statusbar.className = cls("thsStatusbar");
			statusbar.dataset.skinChrome = "statusbar";
			const spacer = document.createElement("span");
			spacer.className = cls("thsStatusbarSpacer");
			statusbar.append(spacer);
			for (const cell of STOCK_CELLS) {
				const el = document.createElement("span");
				el.className = cls("thsStatusbarCell");
				el.textContent = cell.text;
				if (cell.trend !== "none") el.dataset.trend = cell.trend;
				statusbar.append(el);
			}
			const codeIndexCell = document.createElement("span");
			codeIndexCell.className = cls("thsStatusbarCell");
			codeIndexCell.textContent = "代码指数 --";
			statusbar.append(codeIndexCell);
			const favicon = document.createElement("link");
			favicon.rel = "icon";
			favicon.href = `data:image/svg+xml;utf8,${encodeURIComponent(FAVICON_SVG)}`;
			document.head.append(favicon);
			document.title = SKIN_TITLE;
			body.append(titlebar, statusbar);
			const api = ctx.get("connection")?.api;
			const refreshCodeIndex = () => {
				if (api === void 0) return;
				(async () => {
					try {
						const list = await api.workspace.list({});
						if (!list.result.ok) return;
						let net = 0;
						for (const workspace of list.result.value.items) {
							const response = await api.codeKline.list({
								workspaceId: workspace.workspaceId,
								days: 1
							});
							if (!response.result.ok) continue;
							const candles = response.result.value.candles;
							const last = candles[candles.length - 1];
							if (last === void 0) continue;
							net += last.close - last.open;
						}
						const trend = net > 0 ? "up" : net < 0 ? "down" : "none";
						codeIndexCell.textContent = `代码指数 ${net > 0 ? "+" : ""}${net} 行`;
						if (trend !== "none") codeIndexCell.dataset.trend = trend;
						else delete codeIndexCell.dataset.trend;
					} catch {
						codeIndexCell.textContent = "代码指数 --";
					}
				})();
			};
			refreshCodeIndex();
			const refreshTimer = setInterval(refreshCodeIndex, CODE_INDEX_REFRESH_MS);
			ctx.effect(() => () => {
				clearInterval(refreshTimer);
				delete body.dataset.dshThs;
				titlebar.remove();
				statusbar.remove();
				favicon.remove();
				if (document.title === SKIN_TITLE) document.title = originalTitle;
			}, "ui-skin-ths: quote chrome");
		}
		//#endregion
		exports.apply = apply;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map