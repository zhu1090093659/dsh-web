window.__ModuleLoader__.load({
	id: "@linxin666/dsh-client-ui-skin-minecraft",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0dsh-css:/Users/zcl/code/dsh-web-ui/packages/skins/minecraft/src/client/minecraft.module.css.mjs
		const css = "body[data-dsh-minecraft]{--dsw-font-family:\"Courier New\", \"PingFang SC\", \"Microsoft YaHei\", \"SimSun\", monospace;--ds-font-family-code:\"Courier New\", \"Consolas\", monospace;color:#e7ead7;background:linear-gradient(#84d0f6 0%,#b4e3f9 62%,#f0faf3 100%)}.IGNzMG_mcStage{z-index:0;perspective:70vmax;pointer-events:none;background:linear-gradient(#84d0f6 0%,#b4e3f9 62%,#f0faf3 100%);position:fixed;inset:0;overflow:hidden}.IGNzMG_mcSkybox{width:0;height:0;transform-style:preserve-3d;will-change:transform;animation:90s linear infinite IGNzMG_mc-pan;position:absolute;top:50%;left:50%}@keyframes IGNzMG_mc-pan{0%{transform:rotateY(0)}to{transform:rotateY(360deg)}}@media (prefers-reduced-motion:reduce){.IGNzMG_mcSkybox{animation:none}.IGNzMG_mcScrim{background:#060a074d}body[data-dsh-minecraft] button,body[data-dsh-minecraft] input:not([type=checkbox]):not([type=radio]),body[data-dsh-minecraft] textarea,body[data-dsh-minecraft] a,body[data-dsh-minecraft] .aionui-btn,body[data-dsh-minecraft] .aionui-collapse-chevron,body[data-dsh-minecraft] .aionui-floating-expand,body[data-dsh-minecraft] .aionui-explorer-handle:after,body[data-dsh-minecraft] .aionui-preview-handle:after{transition:none}}.IGNzMG_mcFace{width:60.6vmax;height:60.6vmax;image-rendering:pixelated;backface-visibility:hidden;background-size:cover;position:absolute;top:-30.3vmax;left:-30.3vmax}.IGNzMG_mcFace1{transform:translateZ(30vmax)}.IGNzMG_mcFace2{transform:rotateY(180deg)translateZ(30vmax)}.IGNzMG_mcFace3{transform:rotateY(-90deg)translateZ(30vmax)}.IGNzMG_mcFace4{transform:rotateY(90deg)translateZ(30vmax)}.IGNzMG_mcFaceTop{transform:rotateX(90deg)translateZ(30vmax)}.IGNzMG_mcFaceBottom{transform:rotateX(-90deg)translateZ(30vmax)}.IGNzMG_mcScrim{z-index:0;pointer-events:none;background:#060a071f;position:fixed;inset:0}body[data-dsh-minecraft][data-ds-dark-theme] .IGNzMG_mcScrim{background:#03060459}body[data-dsh-minecraft] [id=root]{z-index:1;background:#0d18106b;border:2px solid #0b0f14;position:relative;box-shadow:inset 0 0 0 1px #ffffff0d,0 10px 42px #0000008c}body[data-dsh-minecraft] [id=root]>div:has([data-pane]){background:0 0}body[data-dsh-minecraft][data-ds-dark-theme] [id=root]{background:#060a07a8;box-shadow:inset 0 0 0 1px #ffffff08,0 10px 42px #000000b3}body[data-dsh-minecraft][data-ds-dark-theme] [id=root]>div:has([data-pane]){background:0 0}body[data-dsh-minecraft] [data-pane=sidebar]>div,body[data-dsh-minecraft] [data-pane=conversation],body[data-dsh-minecraft] [data-pane=details]{background:#0e1c1147}body[data-dsh-minecraft] [data-pane=sidebar],body[data-dsh-minecraft] [data-pane=conversation]>div{background:0 0}body[data-dsh-minecraft][data-ds-dark-theme] [data-pane=sidebar]>div,body[data-dsh-minecraft][data-ds-dark-theme] [data-pane=conversation],body[data-dsh-minecraft][data-ds-dark-theme] [data-pane=details]{background:#05090680}body[data-dsh-minecraft][data-ds-dark-theme] [data-pane=conversation]>div{background:0 0}body[data-dsh-minecraft] button{font-family:var(--dsw-font-family);color:#fff;text-shadow:1px 1px #00000080;background-color:#8b8b8b;background-image:repeating-linear-gradient(0deg,#0000001a 0 2px,#0000 2px 4px),repeating-linear-gradient(90deg,#ffffff0d 0 2px,#0000 2px 4px);border:2px solid #101418;border-radius:0;font-weight:700;transition:background-color 90ms,color 90ms,box-shadow 90ms,transform 90ms,filter 90ms;box-shadow:inset 0 2px #ffffff73,inset 2px 0 #ffffff47,inset -2px 0 #0000004d,inset 0 -3px #00000073}body[data-dsh-minecraft] button:focus-visible{outline-offset:2px;outline:3px solid #ffffa0}body[data-dsh-minecraft] button:hover:not(:disabled){color:#ffffa0;background-color:#a8b9d2;box-shadow:inset 0 2px #ffffff8c,inset 2px 0 #ffffff61,inset -2px 0 #00000040,inset 0 -3px #00000059}body[data-dsh-minecraft] button:active:not(:disabled){transform:translateY(1px);box-shadow:inset 0 1px #ffffff4d,inset 0 0 0 1px #00000040,inset 0 -2px #0000008c}body[data-dsh-minecraft] button:disabled{cursor:not-allowed;color:#ffffff73;background-color:#6b6b6b;box-shadow:inset 0 2px #fff3,inset 0 -3px #0000004d}body[data-dsh-minecraft] button:disabled:hover{color:#ffffff73;background-color:#6b6b6b}body[data-dsh-minecraft] input:not([type=checkbox]):not([type=radio]),body[data-dsh-minecraft] textarea,body[data-dsh-minecraft] select{font-family:var(--dsw-font-family);color:#f5ecd8;text-shadow:1px 1px #00000059;background-color:#9a6238;background-image:radial-gradient(3px at 10px 9px,#261a0ef2 2px,#0000 2.5px),radial-gradient(3px at calc(100% - 10px) 9px,#261a0ef2 2px,#0000 2.5px),radial-gradient(3px at 10px calc(100% - 9px),#261a0ef2 2px,#0000 2.5px),radial-gradient(3px at calc(100% - 10px) calc(100% - 9px),#261a0ef2 2px,#0000 2.5px),repeating-linear-gradient(0deg,#3a241038 0 2px,#0000 2px 5px),linear-gradient(#b5794a 0%,#96603a 100%);border:3px solid #4a2f14;border-radius:0;font-weight:600;box-shadow:inset 0 0 0 1px #00000059}body[data-dsh-minecraft] input:not([type=checkbox]):not([type=radio]):focus,body[data-dsh-minecraft] textarea:focus,body[data-dsh-minecraft] select:focus{color:#fff;border-color:#f2ead4;box-shadow:inset 0 0 0 1px #00000059,0 0 0 2px #f2ead459}body[data-dsh-minecraft] input::placeholder,body[data-dsh-minecraft] textarea::placeholder{color:#f5ecd88c;opacity:1}body[data-dsh-minecraft] input:disabled,body[data-dsh-minecraft] textarea:disabled,body[data-dsh-minecraft] select:disabled{cursor:not-allowed;opacity:.5;color:#f5ecd899;box-shadow:none}body[data-dsh-minecraft] input:not([type=checkbox]):not([type=radio]),body[data-dsh-minecraft] textarea{transition:border-color 90ms,color 90ms}body[data-dsh-minecraft] select{-webkit-appearance:none;appearance:none;background-image:radial-gradient(3px at 10px 9px,#261a0ef2 2px,#0000 2.5px),radial-gradient(3px at calc(100% - 10px) 9px,#261a0ef2 2px,#0000 2.5px),radial-gradient(3px at 10px calc(100% - 9px),#261a0ef2 2px,#0000 2.5px),radial-gradient(3px at calc(100% - 10px) calc(100% - 9px),#261a0ef2 2px,#0000 2.5px),repeating-linear-gradient(0deg,#3a241038 0 2px,#0000 2px 5px),linear-gradient(#b5794a 0%,#96603a 100%),url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='6'%3E%3Cpath d='M0 0h8L4 6z' fill='%23362a1c'/%3E%3C/svg%3E\");background-position:calc(100% - 10px);background-repeat:no-repeat;padding-right:26px}body[data-dsh-minecraft] ::-webkit-scrollbar{width:13px;height:13px}body[data-dsh-minecraft] ::-webkit-scrollbar-track{background:#0d161099;border-left:2px solid #0b0f14}body[data-dsh-minecraft] ::-webkit-scrollbar-thumb{background:#7d7d7d;border:2px solid #101418;box-shadow:inset 0 2px #ffffff59,inset 0 -2px #00000059}body[data-dsh-minecraft] ::-webkit-scrollbar-thumb:hover{background:#a8b9d2}body[data-dsh-minecraft] ::-webkit-scrollbar-corner{background:0 0}body[data-dsh-minecraft] ::selection{color:#000;background:#ffffa0}body[data-dsh-minecraft] :focus-visible{outline-offset:1px;outline:2px solid #fff}body[data-dsh-minecraft] a{color:#ffffa0;transition:color 90ms}body[data-dsh-minecraft] a:visited{color:#d6d69a}body[data-dsh-minecraft] a:hover{color:#fff}body[data-dsh-minecraft]{--dsw-static-amber-100:#f3e7c8;--dsw-static-amber-400:#d9a53c;--dsw-static-amber-500:#b57e1e;--dsw-static-amber-600:#9a6a17;--dsw-static-amber-900:#4a3512;--dsw-static-blue-100:#cfe0ef;--dsw-static-blue-300:#9fb9d8;--dsw-static-blue-400:#6f95c4;--dsw-static-blue-450:#557faf;--dsw-static-blue-500:#38628f;--dsw-static-blue-50:#e8eff7;--dsw-static-blue-50p:#dce8f4;--dsw-static-blue-600:#2b4f78;--dsw-static-blue-75:#d4e2f0;--dsw-static-blue-800:#1d3a5c;--dsw-static-blue-950:#122940;--dsw-static-deepseek-100:#cfe0ef;--dsw-static-deepseek-200:#b6cde3;--dsw-static-deepseek-300:#9fb9d8;--dsw-static-deepseek-400:#6f95c4;--dsw-static-deepseek-450:#557faf;--dsw-static-deepseek-500:#38628f;--dsw-static-deepseek-50:#e8eff7;--dsw-static-deepseek-600:#2b4f78;--dsw-static-deepseek-700-delete:#1d3a5c;--dsw-static-deepseek-800:#1d3a5c;--dsw-static-deepseek-900:#1a3350;--dsw-static-green-100:#d8e8c8;--dsw-static-green-400:#83c94e;--dsw-static-green-500:#5a9e38;--dsw-static-green-900:#24381c;--dsw-static-neutral-00:#fff;--dsw-static-neutral-1000:#000;--dsw-static-neutral-100:#d6d6d6;--dsw-static-neutral-150:#cbcbcb;--dsw-static-neutral-200:silver;--dsw-static-neutral-250:#b5b5b5;--dsw-static-neutral-300:#a8a8a8;--dsw-static-neutral-400:#8f8f8f;--dsw-static-neutral-500:#767676;--dsw-static-neutral-50:#e6e6e6;--dsw-static-neutral-550:#6a6a6a;--dsw-static-neutral-600:#5c5c5c;--dsw-static-neutral-700:#4a4a4a;--dsw-static-neutral-800:#383838;--dsw-static-neutral-850:#2e2e2e;--dsw-static-neutral-900:#242424;--dsw-static-neutral-bluish-00:#fff;--dsw-static-neutral-bluish-1000:#000;--dsw-static-neutral-bluish-100:#d4d8de;--dsw-static-neutral-bluish-150:#c8cdd5;--dsw-static-neutral-bluish-200:#bcc2cc;--dsw-static-neutral-bluish-300:#9ea7b4;--dsw-static-neutral-bluish-400:#848f9f;--dsw-static-neutral-bluish-500:#6b7788;--dsw-static-neutral-bluish-50:#e8eaee;--dsw-static-neutral-bluish-600:#586475;--dsw-static-neutral-bluish-60:#e2e5ea;--dsw-static-neutral-bluish-700:#3d4654;--dsw-static-neutral-bluish-75:#dde1e7;--dsw-static-neutral-bluish-750:#333b47;--dsw-static-neutral-bluish-800:#2a313b;--dsw-static-neutral-bluish-850:#22282f;--dsw-static-neutral-bluish-875:#1f252c;--dsw-static-neutral-bluish-900:#1c2127;--dsw-static-neutral-bluish-950:#14181d;--dsw-alias-label-primary:#e7ead7;--dsw-alias-label-primary-bluish:#d4e4d4;--dsw-alias-label-primary-dimmed:#c4cbb2;--dsw-alias-label-primary-foreground:#eef4fb;--dsw-alias-label-primary-inverted:#eef4fb;--dsw-alias-label-secondary:#b3bda3;--dsw-alias-label-tertiary:#8b9680;--dsw-alias-label-quaternary:#6b7561;--dsw-alias-label-caption:#a0ab92;--dsw-alias-label-dimmed:#8b9680;--dsw-alias-separator-primary:#ffffff17;--dsw-alias-line-secondary:#ffffff1c;--dsw-alias-interactive-bg-hover:#ffffff12;--dsw-alias-interactive-bg-active:#ffffff1c;--dsw-alias-interactive-bg-hover-solid:#2b4f78;--dsw-alias-interactive-bg-hover-accent:#83c94e2e;--dsw-alias-interactive-bg-hover-danger:#d45a5a29;--dsw-alias-bg-base:#18221b;--dsw-alias-bg-layer-1:#1a251d;--dsw-alias-bg-layer-2:#1d2920;--dsw-alias-bg-layer-3:#212e24;--dsw-alias-bg-overlay:#060907b8;--dsw-alias-bg-mask-1:#06090766;--dsw-alias-bg-mask-2:#06090738;--dsw-alias-bg-mask-3:#0609078c;--dsw-alias-border-l1:#ffffff0f;--dsw-alias-border-l2-darkmode-thin:#ffffff14;--dsw-alias-border-l2:#ffffff1f;--dsw-alias-border-l3:#ffffff29;--dsw-alias-border-l4:#fff3;--dsw-alias-bg-skeleton:#273128;--dsw-alias-toast-bg:#212d26;--dsw-alias-tooltip-bg:#212d26;--dsw-alias-markdown-code-block:#1e2620;--dsw-alias-markdown-code-block-banner:#273128;--dsw-alias-markdown-inline-code:#2a352c;--dsw-alias-markdown-tag:#2b4f78;--dsw-alias-markdown-placeholder:#8b9680;--dsw-alias-markdown-citation:#212d26;--dsw-alias-scrollbar-bg-l1:#0d161080;--dsw-alias-scrollbar-bg-l2:#0d161080;--dsw-alias-scrollbar-hover-l1:#a8b9d2;--dsw-alias-scrollbar-hover-l2:#a8b9d2;--dsw-alias-button-primary-fill:#2b4f78;--dsw-alias-button-primary-hover:#38628f;--dsw-alias-button-primary-dimmed:#2b4f788c;--dsw-alias-button-ghost-active-fill:#ffffff14;--dsw-alias-button-ghost-active-hover:#ffffff1f;--dsw-alias-button-contrast-fill:#1a2413;--dsw-alias-button-tool-bar-fill:#8b8b8b80;--dsw-alias-brand-primary:#83c94e;--dsw-alias-brand-primary-invert:#1a2413;--dsw-alias-brand-text:#83c94e;--dsw-alias-state-business-primary:#83c94e;--dsw-alias-state-business-subtle:#83c94e2e;--dsw-alias-state-business-tertiary:#83c94e1a;--dsw-alias-state-success-primary:#4f8a33;--dsw-alias-state-success-secondary:#4f8a3329;--dsw-alias-state-success-tertiary:#4f8a3317;--dsw-alias-state-warn-primary:#d9a53c;--dsw-alias-state-warn-label:#f3d9a0;--dsw-alias-state-warn-secondary:#d9a53c29;--dsw-alias-state-warn-tertiary:#d9a53c17;--dsw-alias-state-error-primary:#d45a5a;--dsw-alias-state-error-secondary:#d45a5a29;--dsw-alias-state-warning-primary:#d9a53c;--dsw-specific-bubble:#26332a;--dsw-specific-bubble-highlight:#2e3d32;--dsw-specific-sidebar-fill:#0c160f8c;--dsw-specific-sidebar-nav-item-active:#2b4f78;--dsw-specific-sidebar-nav-item-active-accent:#83c94e;--dsw-specific-sidebar-nav-item-hover:#26322ad9;--dsw-specific-menu:#212d26;--dsw-specific-selector:#212d26;--dsw-specific-tip:#212d26;--dsw-specific-input-major:#0f1811e6;--dsw-specific-login-input:#0f1811e6;--aion-bg-base:#e8eadf;--aion-bg-1:#d9ddd1;--aion-bg-2:#cdd2c3;--aion-bg-3:#a7af9d;--aion-bg-4:#8b9680;--aion-bg-hover:#e2e6da;--aion-bg-active:#c2c8b6;--aion-text-primary:#1d2521;--aion-text-secondary:#3f4a43;--aion-text-tertiary:#6b7561;--aion-text-disabled:#9ba497;--aion-primary:#38628f;--aion-success:#5a8f2c;--aion-warning:#b57e1e;--aion-danger:#b6442e;--aion-brand:#78896c;--aion-aou-1:#eef0e9;--aion-aou-2:#dfe3d8;--aion-aou-3:#c6cdbd;--aion-aou-4:#a4b0a0;--aion-aou-5:#7f917c;--aion-aou-6:#5c7057;--aion-fill-2:#e2e6da;--aion-fill-3:#cdd2c3;--aion-border-base:#a7af9d;--aion-overlay-shadow:0 8px 22px #141e1659, inset 0 0 0 1px #ffffff26;--aion-font-sans:var(--dsw-font-family);--aion-font-mono:var(--ds-font-family-code)}body[data-dsh-minecraft][data-ds-dark-theme]{--aion-bg-base:#16201a;--aion-bg-1:#1a251d;--aion-bg-2:#212e24;--aion-bg-3:#2d3b31;--aion-bg-4:#3a4a3e;--aion-bg-hover:#223026;--aion-bg-active:#26352a;--aion-text-primary:#e7ead7;--aion-text-secondary:#b3bda3;--aion-text-tertiary:#8b9680;--aion-text-disabled:#5c665c;--aion-primary:#2b4f78;--aion-success:#5a9e38;--aion-warning:#d9a53c;--aion-danger:#d45a5a;--aion-brand:#83c94e;--aion-aou-1:#1c2620;--aion-aou-2:#27452c;--aion-aou-3:#39624a;--aion-aou-4:#52742e;--aion-aou-5:#83c94e;--aion-aou-6:#aed08a;--aion-fill-2:#ffffff0f;--aion-fill-3:#ffffff1f;--aion-border-base:#2d3b31;--aion-overlay-shadow:0 12px 32px #0009, inset 0 0 0 1px #ffffff0a;--aion-font-sans:var(--dsw-font-family);--aion-font-mono:var(--ds-font-family-code)}body[data-dsh-minecraft] [data-aionui-explorer-col],body[data-dsh-minecraft] [data-aionui-preview-col]{background-color:var(--aion-bg-1);border-left:2px solid #0b0f14;box-shadow:inset 0 0 0 1px #ffffff0d,0 8px 26px #00000059}body[data-dsh-minecraft][data-ds-dark-theme] [data-aionui-explorer-col],body[data-dsh-minecraft][data-ds-dark-theme] [data-aionui-preview-col]{border-left:2px solid #0b0f14;box-shadow:inset 0 0 0 1px #ffffff08,0 8px 26px #00000080}body[data-dsh-minecraft] .aionui-root,body[data-dsh-minecraft] [data-aionui-explorer-col]>div,body[data-dsh-minecraft] [data-aionui-preview-col]>div{font-family:var(--dsw-font-family);background-color:#0000}body[data-dsh-minecraft] .aionui-root{color:var(--aion-text-primary)}body[data-dsh-minecraft] .aionui-root ::-webkit-scrollbar{width:10px;height:10px}body[data-dsh-minecraft] .aionui-root ::-webkit-scrollbar-track{background:#0d16108c;border-left:2px solid #0b0f14}body[data-dsh-minecraft] .aionui-root ::-webkit-scrollbar-thumb{background:#7d7d7d;border:2px solid #101418;border-radius:0;box-shadow:inset 0 2px #ffffff59,inset 0 -2px #00000059}body[data-dsh-minecraft] .aionui-root ::-webkit-scrollbar-thumb:hover{background:#a8b9d2}body[data-dsh-minecraft] .aionui-root ::-webkit-scrollbar-corner{background:0 0}body[data-dsh-minecraft] .aionui-btn{color:#fff;text-shadow:1px 1px #00000080;background-color:#8b8b8b;background-image:repeating-linear-gradient(0deg,#0000001a 0 2px,#0000 2px 4px),repeating-linear-gradient(90deg,#ffffff0d 0 2px,#0000 2px 4px);border:2px solid #101418;border-radius:0;height:30px;padding:0 14px;transition:background-color 90ms,color 90ms,box-shadow 90ms,transform 90ms,filter 90ms,opacity 90ms;box-shadow:inset 0 2px #ffffff73,inset 2px 0 #ffffff47,inset -2px 0 #0000004d,inset 0 -3px #00000073}body[data-dsh-minecraft] .aionui-btn:hover:not(:disabled){color:#ffffa0;background-color:#a8b9d2;box-shadow:inset 0 2px #ffffff8c,inset 2px 0 #ffffff61,inset -2px 0 #00000040,inset 0 -3px #00000059}body[data-dsh-minecraft] .aionui-btn:active:not(:disabled){transform:translateY(1px);box-shadow:inset 0 1px #ffffff4d,inset 0 0 0 1px #00000040,inset 0 -2px #0000008c}body[data-dsh-minecraft] .aionui-btn:focus-visible{outline-offset:2px;outline:3px solid #ffffa0}body[data-dsh-minecraft] .aionui-btn:disabled,body[data-dsh-minecraft] .aionui-btn:disabled:hover{cursor:not-allowed;opacity:.45;color:#ffffff80;text-shadow:none;background-color:#6b6b6b;transform:none;box-shadow:inset 0 2px #fff3,inset 0 -3px #0000004d}body[data-dsh-minecraft] .aionui-btn-primary{color:#fff;border-color:#101418;border-bottom-width:3px}body[data-dsh-minecraft] .aionui-btn-primary:hover:not(:disabled){opacity:1;filter:brightness(1.12)}body[data-dsh-minecraft] .aionui-btn-danger{color:#fff;border-color:#101418;border-bottom-width:3px}body[data-dsh-minecraft] .aionui-btn-danger:hover:not(:disabled){opacity:1;filter:brightness(1.15)}body[data-dsh-minecraft] .aionui-collapse-chevron{color:#fff;background-color:#8b8b8b;background-image:repeating-linear-gradient(0deg,#0000001a 0 2px,#0000 2px 4px);border:2px solid #101418;border-radius:0;width:26px;height:26px;transition:background-color 90ms,color 90ms,transform 90ms;box-shadow:inset 0 2px #ffffff73,inset 0 -2px #00000073}body[data-dsh-minecraft] .aionui-collapse-chevron:hover:not(:disabled){color:#ffffa0;background-color:#a8b9d2}body[data-dsh-minecraft] .aionui-collapse-chevron:active:not(:disabled){transform:translateY(1px)}body[data-dsh-minecraft] .aionui-collapse-chevron:focus-visible{outline-offset:2px;outline:3px solid #ffffa0}body[data-dsh-minecraft] .aionui-collapse-chevron:disabled,body[data-dsh-minecraft] .aionui-collapse-chevron:disabled:hover{cursor:not-allowed;opacity:.4;color:#ffffff80;background-color:#6b6b6b;transform:none}body[data-dsh-minecraft] .aionui-explorer-handle:after,body[data-dsh-minecraft] .aionui-preview-handle:after{background-color:#6b7561;border-radius:0;transition:background-color 90ms}body[data-dsh-minecraft] .aionui-explorer-handle:hover:after,body[data-dsh-minecraft] .aionui-explorer-handle:active:after,body[data-dsh-minecraft] .aionui-preview-handle:hover:after,body[data-dsh-minecraft] .aionui-preview-handle:active:after{background-color:#83c94e}body[data-dsh-minecraft] .aionui-explorer-handle:focus-visible,body[data-dsh-minecraft] .aionui-preview-handle:focus-visible{outline-offset:2px;outline:3px solid #ffffa0}body[data-dsh-minecraft] .aionui-floating-expand{color:#fff;background-color:#8b8b8b;background-image:repeating-linear-gradient(0deg,#0000001a 0 2px,#0000 2px 4px);border:2px solid #101418;border-right:none;border-radius:0;width:24px;transition:background-color 90ms,color 90ms,transform 90ms,filter 90ms;box-shadow:inset 2px 0 #ffffff47,inset -2px 0 #0000004d}body[data-dsh-minecraft] .aionui-floating-expand:hover:not(:disabled){color:#ffffa0;background-color:#a8b9d2}body[data-dsh-minecraft] .aionui-floating-expand:active:not(:disabled){transform:translateY(1px)}body[data-dsh-minecraft] .aionui-floating-expand:focus-visible{outline-offset:2px;outline:3px solid #ffffa0}body[data-dsh-minecraft] .aionui-floating-expand:disabled,body[data-dsh-minecraft] .aionui-floating-expand:disabled:hover{cursor:not-allowed;opacity:.4;color:#ffffff80;background-color:#6b6b6b;transform:none}body[data-dsh-minecraft] .aionui-menu{border:2px solid #101418;border-radius:0}body[data-dsh-minecraft] .aionui-menu-item{border-radius:0}body[data-dsh-minecraft] .aionui-menu-item:hover:not(.aionui-menu-item-disabled){background-color:#83c94e38}body[data-dsh-minecraft] .aionui-menu-item:focus-visible{outline-offset:-3px;outline:3px solid #ffffa0}body[data-dsh-minecraft] .aionui-menu-item:active:not(.aionui-menu-item-disabled){background-color:#83c94e52}body[data-dsh-minecraft] .aionui-menu-item-disabled{color:var(--aion-text-disabled)}body[data-dsh-minecraft] .aionui-menu-item-disabled:hover{background:0 0}body[data-dsh-minecraft] .aionui-menu-sep{background:#0b0f14}body[data-dsh-minecraft] .aionui-overlay{background:#0408058c}body[data-dsh-minecraft] .aionui-dialog{border:2px solid #0b0f14;border-radius:0;box-shadow:inset 0 0 0 1px #ffffff12,0 16px 44px #0000008c}body[data-dsh-minecraft] .aionui-toast{border:2px solid #101418;border-radius:0;box-shadow:inset 0 0 0 1px #ffffff0f,0 8px 22px #0006}body[data-dsh-minecraft] .aionui-root input,body[data-dsh-minecraft] .aionui-root textarea{border-radius:0}body[data-dsh-minecraft] .aionui-root input:focus,body[data-dsh-minecraft] .aionui-root textarea:focus{outline-offset:0}body[data-dsh-minecraft] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+1),body[data-dsh-minecraft] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+1){color:#38628f}body[data-dsh-minecraft] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+2),body[data-dsh-minecraft] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+2){color:#5a9e38}body[data-dsh-minecraft] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+3),body[data-dsh-minecraft] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+3){color:#b57e1e}body[data-dsh-minecraft] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+4),body[data-dsh-minecraft] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+4){color:#b6442e}body[data-dsh-minecraft] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+5),body[data-dsh-minecraft] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+5){color:#78896c}body[data-dsh-minecraft] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n),body[data-dsh-minecraft] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n){color:#83c94e}body[data-dsh-minecraft][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+1),body[data-dsh-minecraft][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+1){color:#4a7db8}body[data-dsh-minecraft][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+2),body[data-dsh-minecraft][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+2){color:#83c94e}body[data-dsh-minecraft][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+3),body[data-dsh-minecraft][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+3){color:#d9a53c}body[data-dsh-minecraft][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+4),body[data-dsh-minecraft][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+4){color:#d45a5a}body[data-dsh-minecraft][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n+5),body[data-dsh-minecraft][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n+5){color:#a4b0a0}body[data-dsh-minecraft][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=node]:nth-child(6n),body[data-dsh-minecraft][data-ds-dark-theme] [data-gitgraph-lanes]>[data-gitgraph-glyph=merge]:nth-child(6n){color:#aed08a}body[data-dsh-minecraft] [data-gitgraph-dialog]{border:2px solid #0b0f14;border-radius:0;box-shadow:inset 0 0 0 1px #ffffff12,0 16px 44px #0000008c}body[data-dsh-minecraft] [data-gitgraph-ref]:not([data-gitgraph-ref-current]){border:1px solid #ffffff2e;border-radius:0}";
		const tagId = "@linxin666/dsh-client-ui-skin-minecraft/minecraft.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@linxin666/dsh-client-ui-skin-minecraft";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var minecraft_module_css_default = {
			"mc-pan": "IGNzMG_mc-pan",
			"mcFace": "IGNzMG_mcFace",
			"mcFace1": "IGNzMG_mcFace1",
			"mcFace2": "IGNzMG_mcFace2",
			"mcFace3": "IGNzMG_mcFace3",
			"mcFace4": "IGNzMG_mcFace4",
			"mcFaceBottom": "IGNzMG_mcFaceBottom",
			"mcFaceTop": "IGNzMG_mcFaceTop",
			"mcScrim": "IGNzMG_mcScrim",
			"mcSkybox": "IGNzMG_mcSkybox",
			"mcStage": "IGNzMG_mcStage"
		};
		//#endregion
		//#region src/client/index.ts
		/** The product title the skin pins (captured by the shell's DocumentTitle after settle). */
		const SKIN_TITLE = "Minecraft · DeepSeek 在线";
		/** Resolve one module class name (fallback only satisfies the indexed-access type). */
		const cls = (name) => minecraft_module_css_default[name] ?? "";
		const PX = 8;
		const GROUND = 400;
		const W = 640;
		const H = 640;
		/** One rect of the pixel scene. */
		function r(x, y, w, h, fill, extra = "") {
			return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra}/>`;
		}
		/** Deterministic PRNG (mulberry32) so scattered props are stable per face. */
		function mulberry32(seed) {
			let a = seed >>> 0;
			return () => {
				a = a + 1831565813 | 0;
				let t = Math.imul(a ^ a >>> 15, 1 | a);
				t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
				return ((t ^ t >>> 14) >>> 0) / 4294967296;
			};
		}
		/** A blocky cloud: three overlapping white slabs with a top cap. */
		function cloud(x, y, s) {
			const u = PX * s;
			return [
				r(x, y + u, 3 * u, u, "#fdfdfd"),
				r(x + u, y, 2 * u, u, "#fdfdfd"),
				r(x + 3 * u, y + u, 2 * u, u, "#fdfdfd"),
				r(x + u, y + u, u, u, "#e6eef2")
			].join("");
		}
		/** A faint distant cloud slab near the horizon. */
		function farCloud(x, y, w) {
			return r(x, y, w, 6, "rgba(255,255,255,0.55)");
		}
		/** A stepped blocky hill: layers shrink by two blocks every two rows. */
		function hill(x, blocks, height, fill, cap) {
			let out = "";
			for (let i = 0; i < height; i++) {
				const w = Math.max(blocks - Math.floor(i / 2) * 2, 2);
				const color = i === height - 1 && cap ? cap : fill;
				out += r(x + (blocks - w) / 2 * PX, GROUND - (i + 1) * PX, w * PX, PX, color);
			}
			return out;
		}
		/** A blocky tree: brown trunk, layered green crown. */
		function tree(x, scale = 1) {
			const u = PX * scale;
			return [
				r(x + u, GROUND - 3 * u, 2 * u, 3 * u, "#6b4a2b"),
				r(x, GROUND - 6 * u, 4 * u, 3 * u, "#43ad54"),
				r(x + u, GROUND - 7 * u, 2 * u, u, "#34a046")
			].join("");
		}
		/** A blocky villager house: plank wall, glowing windows, door, stepped roof, chimney. */
		function house(x, s) {
			const u = PX * s;
			const wall = s >= 2 ? "#c9b28a" : "#b89d7a";
			return [
				r(x, GROUND - 4 * u, 5 * u, 4 * u, wall),
				r(x + u, GROUND - 3 * u, u, u, "#f5e6a0"),
				r(x + 3 * u, GROUND - 3 * u, u, u, "#f5e6a0"),
				r(x + 2 * u, GROUND - 2 * u, u, 2 * u, "#5d3d22"),
				r(x, GROUND - 6 * u, 5 * u, u, "#8a5a3a"),
				r(x + u, GROUND - 7 * u, 3 * u, u, "#7a4f33"),
				r(x + 4 * u, GROUND - 7 * u, u, u, "#7d7d7d")
			].join("");
		}
		/** A lakeside: sandy shore, blue water with light ripples. */
		function lake(x, y, w) {
			return [
				r(x, y, w, 4, "#e8d8a0"),
				r(x, y + 4, w, 26, "#3f76e4"),
				r(x + 10, y + 12, Math.round(w * .3), 3, "rgba(255,255,255,0.4)"),
				r(x + Math.round(w * .55), y + 20, Math.round(w * .28), 3, "rgba(255,255,255,0.32)")
			].join("");
		}
		/** A red mushroom with white dots. */
		function mushroom(x, y) {
			return [
				r(x + 4, y + 8, 8, 8, "#f0e8d8"),
				r(x, y, 16, 8, "#d84545"),
				r(x + 4, y + 2, 4, 4, "#f7f2e8")
			].join("");
		}
		/** A pumpkin with a green stem. */
		function pumpkin(x, y) {
			return [
				r(x + 4, y - 4, 8, 4, "#4f8a33"),
				r(x, y, 16, 16, "#e07a2f"),
				r(x + 3, y + 3, 4, 4, "#c96a26")
			].join("");
		}
		/** A small gray rock. */
		function rock(x, y) {
			return [r(x + 8, y - 4, 8, 4, "#a5a5a5"), r(x, y, 20, 12, "#8d8d8d")].join("");
		}
		/** A tiny pixel bird: body and swept wing. */
		function bird(x, y) {
			return [r(x + 4, y - 2, 8, 2, "#2e2e2e"), r(x, y, 4, 4, "#2e2e2e")].join("");
		}
		/** A tuft of tall grass. */
		function tallGrass(x, y) {
			return [r(x, y, 3, 10, "#4f9e35"), r(x + 3, y + 2, 3, 8, "#5fb23f")].join("");
		}
		/** A tiny flower dot sitting on the grass edge. */
		function flower(x, y, fill) {
			return r(x, y, 4, 4, fill);
		}
		/** The shared grass-block ground strip (tall, bright meadow). */
		function ground() {
			let tufts = "";
			for (let x = 8; x < W; x += 32) tufts += r(x, 412, PX, PX, "#7dc94b");
			return [
				r(0, GROUND, W, 12, "#8ed458"),
				r(0, 412, W, H - GROUND - 12, "#96643a"),
				tufts
			].join("");
		}
		/** Render one side-face scene (640x360). */
		function renderScene(scene) {
			const body = [];
			body.push(r(0, 0, W, GROUND, "url(#sky)"));
			if (scene.sun) {
				const [sx, sy] = scene.sun;
				body.push(r(sx - 12, sy - 12, 36, 36, "rgba(255,255,255,0.35)"));
				body.push(r(sx, sy, 12, 12, "#ffffff"));
			}
			for (const [x, y, s] of scene.clouds ?? []) body.push(cloud(x, y, s));
			for (const [x, y, w] of scene.farClouds ?? []) body.push(farCloud(x, y, w));
			for (const [x, y] of scene.birds ?? []) body.push(bird(x, y));
			for (const [i, [x, b, h, fill]] of (scene.hills ?? []).entries()) {
				const cap = scene.caps?.includes(i) ? "#dfeaf2" : void 0;
				body.push(hill(x, b, h, fill, cap));
			}
			body.push(ground());
			if (scene.lake) body.push(lake(scene.lake[0], 402, scene.lake[2]));
			const forbid = [];
			if (scene.lake) forbid.push([scene.lake[0] - 48, scene.lake[0] + scene.lake[2] + 48]);
			for (const [hx, hs] of scene.houses ?? []) forbid.push([hx - 40, hx + 5 * PX * hs + 40]);
			const rnd = mulberry32(scene.seed ?? 7);
			const scatterAt = (count, place) => {
				let placed = 0;
				let tries = 0;
				while (placed < count && tries < count * 40) {
					tries++;
					const x = 24 + Math.floor(rnd() * (W - 96));
					if (forbid.some(([a, b]) => x >= a && x <= b)) continue;
					place(x);
					placed++;
				}
			};
			if (scene.scatterTrees) {
				const extra = scene.scatterTrees;
				scatterAt(extra, (x) => body.push(tree(x, 1 + Math.floor(rnd() * 2))));
			}
			for (const [x, s] of scene.trees ?? []) body.push(tree(x, s));
			for (const [x, s] of scene.houses ?? []) body.push(house(x, s));
			if (scene.scatterProps) scatterAt(scene.scatterProps, (x) => {
				const kind = Math.floor(rnd() * 10);
				if (kind < 3) body.push(flower(x, 404, kind === 0 ? "#f5d442" : kind === 1 ? "#e05656" : "#f2f2f2"));
				else if (kind < 5) body.push(mushroom(x, 402));
				else if (kind < 7) body.push(pumpkin(x, 404));
				else if (kind < 8) body.push(rock(x, 404));
				else body.push(tallGrass(x, 402));
			});
			return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#84d0f6"/><stop offset="0.62" stop-color="#b4e3f9"/><stop offset="1" stop-color="#f0faf3"/></linearGradient></defs>${body.join("")}</svg>`;
		}
		/** The four side faces, each a different biome (Mojang's panorama has six; ours has four sides). */
		const SCENES = [
			{
				sun: [120, 64],
				clouds: [[
					300,
					90,
					1
				], [
					470,
					150,
					1
				]],
				farClouds: [[
					200,
					378,
					90
				], [
					420,
					386,
					120
				]],
				birds: [[540, 100]],
				hills: [[
					60,
					12,
					9,
					"#8fa8b8"
				], [
					380,
					16,
					11,
					"#8fa8b8"
				]],
				caps: [1],
				houses: [
					[30, 1],
					[110, 1],
					[190, 2]
				],
				trees: [
					[420, 1],
					[540, 2],
					[600, 1]
				],
				scatterTrees: 3,
				scatterProps: 6,
				seed: 11
			},
			{
				sun: [480, 90],
				clouds: [
					[
						80,
						120,
						1
					],
					[
						250,
						70,
						2
					],
					[
						520,
						170,
						1
					]
				],
				farClouds: [[
					120,
					384,
					100
				]],
				birds: [[220, 80], [380, 60]],
				hills: [
					[
						30,
						10,
						7,
						"#93aabb"
					],
					[
						260,
						14,
						10,
						"#7d95a5"
					],
					[
						500,
						12,
						8,
						"#93aabb"
					]
				],
				caps: [1],
				lake: [
					280,
					402,
					190
				],
				trees: [
					[120, 2],
					[540, 1],
					[560, 2],
					[60, 1]
				],
				scatterTrees: 3,
				scatterProps: 5,
				seed: 23
			},
			{
				sun: [80, 130],
				clouds: [[
					360,
					90,
					2
				], [
					560,
					60,
					1
				]],
				farClouds: [[
					40,
					380,
					130
				], [
					300,
					388,
					90
				]],
				hills: [[
					150,
					18,
					13,
					"#75899a"
				], [
					480,
					14,
					9,
					"#8fa8b8"
				]],
				caps: [0],
				trees: [
					[60, 1],
					[300, 2],
					[430, 1],
					[600, 1]
				],
				scatterTrees: 7,
				scatterProps: 9,
				seed: 37
			},
			{
				sun: [340, 70],
				clouds: [
					[
						90,
						80,
						1
					],
					[
						200,
						160,
						2
					],
					[
						500,
						120,
						1
					]
				],
				farClouds: [[
					160,
					382,
					110
				], [
					430,
					388,
					90
				]],
				birds: [
					[110, 90],
					[260, 60],
					[560, 110]
				],
				hills: [
					[
						20,
						16,
						13,
						"#7d95a5"
					],
					[
						200,
						20,
						15,
						"#6d8398"
					],
					[
						540,
						17,
						12,
						"#7d95a5"
					]
				],
				caps: [1, 2],
				trees: [
					[140, 1],
					[330, 2],
					[480, 1],
					[600, 1]
				],
				scatterTrees: 3,
				scatterProps: 7,
				seed: 41
			}
		];
		/** Top face: open sky with clouds (512x512). */
		function topSvg() {
			return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" shape-rendering="crispEdges"><defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7ec3ee"/><stop offset="1" stop-color="#a9dcf7"/></linearGradient></defs>${r(0, 0, 512, 512, "url(#t)")}${cloud(96, 160, 2)}${cloud(280, 300, 2)}${cloud(200, 60, 1)}${cloud(380, 120, 1)}${farCloud(60, 420, 120)}</svg>`;
		}
		/** Bottom face: grass block field seen from above, with flowers and a mushroom (512x512). */
		function bottomSvg() {
			let cells = "";
			for (let gx = 0; gx < 512; gx += 64) for (let gy = 0; gy < 512; gy += 64) {
				const dark = (gx / 64 + gy / 64) % 3 === 0;
				cells += r(gx + 16, gy + 16, 16, 16, dark ? "#7dc94b" : "#96da62");
				cells += r(gx + 40, gy + 40, 8, 8, dark ? "#96da62" : "#7dc94b");
			}
			const props = [
				flower(96, 96, "#f5d442"),
				flower(360, 160, "#e05656"),
				flower(440, 400, "#f5d442"),
				mushroom(160, 384),
				rock(392, 300)
			].join("");
			return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" shape-rendering="crispEdges"><rect width="512" height="512" fill="#8ed458"/>${cells}${props}</svg>`;
		}
		/** One panorama face as a data-URI background image. */
		function faceImage(svg) {
			return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
		}
		/**
		* Apply the Minecraft skin: body attribute, panorama skybox (stage + cube
		* of six faces + dimming scrim), title. All writes are retracted by the
		* effect disposer on dispose.
		* @param ctx - owning context (the effect lifecycle owns retraction).
		*/
		function apply(ctx) {
			const body = document.body;
			const originalTitle = document.title;
			body.setAttribute("data-dsh-minecraft", "");
			const stage = document.createElement("div");
			stage.className = cls("mcStage");
			const skybox = document.createElement("div");
			skybox.className = cls("mcSkybox");
			const sideSvg = SCENES.map(renderScene);
			const sideNames = [
				"front",
				"back",
				"left",
				"right"
			];
			for (let i = 0; i < 6; i++) {
				const face = document.createElement("div");
				face.className = `${cls("mcFace")} ${cls(i < 4 ? `mcFace${i + 1}` : i === 4 ? "mcFaceTop" : "mcFaceBottom")}`;
				face.style.backgroundImage = faceImage(i < 4 ? sideSvg[i] : i === 4 ? topSvg() : bottomSvg());
				face.dataset.skinChrome = `face-${sideNames[i] ?? (i === 4 ? "top" : "bottom")}`;
				skybox.append(face);
			}
			stage.append(skybox);
			const scrim = document.createElement("div");
			scrim.className = cls("mcScrim");
			scrim.dataset.skinChrome = "scrim";
			stage.dataset.skinChrome = "stage";
			document.title = SKIN_TITLE;
			body.append(stage, scrim);
			ctx.effect(() => () => {
				body.removeAttribute("data-dsh-minecraft");
				stage.remove();
				scrim.remove();
				if (document.title === SKIN_TITLE) document.title = originalTitle;
			}, "ui-skin-minecraft: panorama skybox");
		}
		//#endregion
		exports.apply = apply;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map