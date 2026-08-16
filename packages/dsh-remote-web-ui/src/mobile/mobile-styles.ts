/**
 * Mobile surface stylesheet, shipped as a string and injected at boot (the
 * standalone page has no CSS-module pipeline).
 */
export const mobileCss = `/* Mobile surface chrome: standalone stylesheet (no main-UI design tokens —
   this page boots without the shell). Light-first palette; the dark palette
   applies only when the header toggle sets [data-theme='dark']. */

:root {
  --m-bg: #f3f5f9;
  --m-bg-raised: #ffffff;
  --m-bg-input: #ffffff;
  --m-border: #dfe4ec;
  --m-text: #1c2333;
  --m-text-secondary: #4d5768;
  --m-text-tertiary: #8b95a7;
  --m-accent: #2f6fed;
  --m-accent-soft: rgba(47, 111, 237, 0.12);
  --m-danger: #d64545;
  --m-success: #1e9e6a;
  --m-radius: 12px;
  --m-shadow: 0 1px 2px rgba(16, 24, 40, 0.06);
  --m-shadow-raise: 0 6px 20px rgba(16, 24, 40, 0.1);
  --m-backdrop: rgba(15, 23, 42, 0.4);
}

:root[data-theme='dark'] {
  --m-bg: #111418;
  --m-bg-raised: #1a1f26;
  --m-bg-input: #20262e;
  --m-border: #2b333d;
  --m-text: #e8eaed;
  --m-text-secondary: #9aa3ad;
  --m-text-tertiary: #6b747f;
  --m-accent: #4f8cff;
  --m-accent-soft: rgba(79, 140, 255, 0.14);
  --m-danger: #e5534b;
  --m-success: #3fb68b;
  --m-radius: 12px;
  --m-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  --m-shadow-raise: 0 6px 20px rgba(0, 0, 0, 0.4);
  --m-backdrop: rgba(0, 0, 0, 0.55);
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  height: 100%;
  background: var(--m-bg);
  color: var(--m-text);
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Noto Sans SC', 'Segoe UI', sans-serif;
  font-size: 15px;
  line-height: 1.5;
  -webkit-text-size-adjust: 100%;
}

/* The app fills exactly one viewport: the page itself never scrolls, each
   view owns its scroll region (chat history, session lists) and the chat
   composer stays pinned to the bottom of the screen. */
#root {
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.mobile {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── header ─────────────────────────────────────────────────────────── */

.mobile-header {
  position: sticky;
  top: 0;
  z-index: 10;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: calc(env(safe-area-inset-top, 0px) + 12px) 16px 10px;
  background: color-mix(in srgb, var(--m-bg) 88%, transparent);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--m-border);
}

.mobile-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}

.mobile-titleInline {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobile-back {
  flex: none;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--m-text);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.12s ease, box-shadow 0.12s ease;
}

.mobile-back:active {
  background: var(--m-bg-raised);
}

.mobile-back:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--m-bg), 0 0 0 4px var(--m-accent);
}

.mobile-theme-toggle {
  flex: none;
  margin-left: auto;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--m-text-secondary);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease, box-shadow 0.12s ease;
}

.mobile-theme-toggle:active {
  background: var(--m-bg-raised);
}

.mobile-theme-toggle:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--m-bg), 0 0 0 4px var(--m-accent);
}

.mobile-theme-toggle svg {
  width: 18px;
  height: 18px;
}

/* ── lists ───────────────────────────────────────────────────────────── */

.mobile-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: 8px 0 calc(env(safe-area-inset-bottom, 0px) + 16px);
}

.mobile-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: calc(100% - 24px);
  margin: 0 12px 8px;
  padding: 13px 14px;
  border: 1px solid var(--m-border);
  border-radius: 14px;
  background: var(--m-bg-raised);
  box-shadow: var(--m-shadow);
  color: var(--m-text);
  text-align: left;
  cursor: pointer;
}

.mobile-row:active {
  background: color-mix(in srgb, var(--m-text) 5%, var(--m-bg-raised));
}

.mobile-rowMain {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.mobile-rowTitle {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
}

.mobile-rowMeta {
  flex: none;
  color: var(--m-text-tertiary);
  font-size: 12px;
}

.mobile-chevron {
  flex: none;
  color: var(--m-text-tertiary);
  font-size: 18px;
}

.mobile-live {
  margin-left: 6px;
  color: var(--m-success);
  font-size: 10px;
  vertical-align: middle;
}

/* ── empty / error states ────────────────────────────────────────────── */

.mobile-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px;
}

.mobile-muted {
  margin: 0;
  color: var(--m-text-tertiary);
}

.mobile-error {
  margin: 0;
  color: var(--m-danger);
}

.mobile-pad {
  padding: 8px 16px;
}

/* ── buttons ─────────────────────────────────────────────────────────── */

.mobile-button {
  height: 38px;
  padding: 0 18px;
  border: 1px solid var(--m-border);
  border-radius: 10px;
  background: var(--m-bg-raised);
  color: var(--m-text);
  font-size: 14px;
  cursor: pointer;
}

.mobile-button:disabled {
  opacity: 0.5;
}

.mobile-block {
  display: block;
  width: calc(100% - 32px);
  margin: 4px 16px;
}

/* Primary action (create session): accent fill, readable on both themes. */
.mobile-new {
  display: block;
  width: 100%;
  height: 44px;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--m-accent) 0%, #4c8dff 100%);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(47, 111, 237, 0.3);
}

.mobile-new:active {
  opacity: 0.88;
}

.mobile-new:disabled {
  opacity: 0.6;
}

.mobile-hint {
  display: block;
  margin-top: 2px;
  color: var(--m-text-tertiary);
  font-size: 12px;
}

/* ── chat ────────────────────────────────────────────────────────────── */

.chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.chat-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px calc(env(safe-area-inset-bottom, 0px) + 12px);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chat-msg {
  max-width: 88%;
  padding: 10px 12px;
  border-radius: var(--m-radius);
  font-size: 14.5px;
  line-height: 1.55;
  overflow-wrap: break-word;
  white-space: pre-wrap;
}

.chat-msg-user {
  align-self: flex-end;
  background: linear-gradient(135deg, var(--m-accent) 0%, #4c8dff 100%);
  color: #fff;
  border-bottom-right-radius: 4px;
  box-shadow: 0 1px 3px rgba(47, 111, 237, 0.28);
}

.chat-msg-assistant {
  align-self: flex-start;
  background: var(--m-bg-raised);
  border: 1px solid var(--m-border);
  border-bottom-left-radius: 4px;
  box-shadow: var(--m-shadow);
}

.chat-msg-pending .chat-msg-text::after {
  content: '▍';
  animation: chat-blink 1s steps(2) infinite;
}

@keyframes chat-blink {
  50% {
    opacity: 0;
  }
}

.chat-msg-failed {
  border-color: var(--m-danger);
}

.chat-msg-failtag {
  display: inline-block;
  margin-top: 6px;
  padding: 1px 8px;
  border: 1px solid var(--m-danger);
  border-radius: 999px;
  color: var(--m-danger);
  font-size: 11px;
}

.chat-msg-time {
  display: block;
  margin-top: 4px;
  color: var(--m-text-tertiary);
  font-size: 10.5px;
  line-height: 1.2;
}

.chat-msg-toggle {
  display: block;
  margin-top: 8px;
  padding: 4px 0;
  border: none;
  background: transparent;
  color: var(--m-accent);
  font-size: 13px;
  cursor: pointer;
}

/* Assistant markdown content (GFM subset; renderer in markdown.ts). */
.chat-md {
  white-space: normal;
}
.chat-md-collapsed {
  max-height: 45vh;
  overflow: hidden;
  position: relative;
}
.chat-md-collapsed::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 28px;
  background: linear-gradient(transparent, var(--m-bg-raised));
  pointer-events: none;
}
.chat-md-body p { margin: 0 0 8px; }
.chat-md-body p:last-child { margin-bottom: 0; }
.chat-md-body h1, .chat-md-body h2, .chat-md-body h3,
.chat-md-body h4, .chat-md-body h5, .chat-md-body h6 {
  margin: 12px 0 6px;
  font-weight: 650;
  line-height: 1.3;
}
.chat-md-body h1 { font-size: 1.35em; }
.chat-md-body h2 { font-size: 1.25em; }
.chat-md-body h3 { font-size: 1.15em; }
.chat-md-body h4, .chat-md-body h5, .chat-md-body h6 { font-size: 1.05em; }
.chat-md-body code {
  font-family: var(--m-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 0.9em;
  background: var(--m-accent-soft);
  padding: 1px 5px;
  border-radius: 4px;
}
.chat-md-body pre {
  margin: 8px 0;
  padding: 10px;
  background: #101726;
  color: #dbe4f5;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 12.5px;
  line-height: 1.5;
}
.chat-md-body pre code {
  background: transparent;
  padding: 0;
  color: inherit;
}
.chat-md-body ul, .chat-md-body ol { margin: 4px 0 8px; padding-left: 22px; }
.chat-md-body li { margin: 2px 0; }
.chat-md-body blockquote {
  margin: 8px 0;
  padding: 4px 10px;
  border-left: 3px solid var(--m-accent);
  background: var(--m-accent-soft);
  border-radius: 0 6px 6px 0;
  color: var(--m-text-secondary);
}
.chat-md-body table {
  margin: 8px 0;
  border-collapse: collapse;
  display: block;
  overflow-x: auto;
  font-size: 13px;
}
.chat-md-body th, .chat-md-body td {
  border: 1px solid var(--m-border);
  padding: 4px 8px;
}
.chat-md-body th { background: var(--m-accent-soft); }
.chat-md-body a { color: var(--m-accent); }
.chat-md-body hr { border: none; border-top: 1px solid var(--m-border); margin: 10px 0; }
.chat-md-body img { max-width: 100%; border-radius: 8px; }

/* ── message disclosures (reasoning / tools) ─────────────────────────── */

.chat-disclosure {
  margin-bottom: 8px;
  border: 1px solid var(--m-border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--m-bg) 55%, transparent);
  overflow: hidden;
}

.chat-disclosure-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: transparent;
  color: var(--m-text);
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}

.chat-disclosure-caret {
  flex: none;
  color: var(--m-text-tertiary);
  font-size: 14px;
  line-height: 1;
  transition: transform 0.15s ease;
}

.chat-disclosure-open .chat-disclosure-caret {
  transform: rotate(90deg);
}

.chat-disclosure-label {
  flex: none;
  color: var(--m-text-secondary);
}

.chat-reasoning[data-pending] .chat-disclosure-label {
  color: var(--m-accent);
}

.chat-disclosure-summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--m-text-tertiary);
  font-size: 12px;
}

.chat-disclosure-count {
  flex: none;
  color: var(--m-text-tertiary);
  font-size: 11px;
}

.chat-disclosure-body {
  padding: 8px 10px 10px;
  border-top: 1px dashed var(--m-border);
  color: var(--m-text-secondary);
  font-size: 12.5px;
  line-height: 1.6;
  overflow-wrap: break-word;
  white-space: pre-wrap;
  max-height: 40vh;
  overflow-y: auto;
}

.chat-tools-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chat-tool-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chat-tool-name {
  color: var(--m-text);
  font-size: 12.5px;
  font-weight: 600;
}

.chat-tool-args {
  margin: 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--m-bg-input);
  color: var(--m-text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  overflow-wrap: break-word;
  white-space: pre-wrap;
}

/* ── composer toolbar (model / permission chips) ─────────────────────── */

.chat-tools {
  display: flex;
  gap: 8px;
  padding: 6px 12px 0;
}

.chat-chip {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--m-border);
  border-radius: 999px;
  background: var(--m-bg-raised);
  box-shadow: var(--m-shadow);
  color: var(--m-text);
  font-size: 12px;
  cursor: pointer;
}

.chat-chip:active {
  border-color: var(--m-accent);
  background: var(--m-accent-soft);
}

.chat-chip-label {
  flex: none;
  color: var(--m-text-tertiary);
}

.chat-chip-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-chip-chevron {
  flex: none;
  color: var(--m-text-tertiary);
  font-size: 14px;
}

/* ── bottom sheets ───────────────────────────────────────────────────── */

.sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: var(--m-backdrop);
  animation: sheet-fade 0.18s ease;
}

@keyframes sheet-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.sheet {
  max-height: 74dvh;
  display: flex;
  flex-direction: column;
  background: var(--m-bg-raised);
  border: 1px solid var(--m-border);
  border-bottom: none;
  border-radius: 16px 16px 0 0;
  box-shadow: var(--m-shadow-raise);
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 10px);
  animation: sheet-up 0.22s ease;
}

@keyframes sheet-up {
  from {
    transform: translateY(40px);
    opacity: 0.6;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.sheet-handle {
  flex: none;
  align-self: center;
  width: 36px;
  height: 4px;
  margin: 8px 0 4px;
  border-radius: 999px;
  background: var(--m-border);
}

.sheet-title {
  flex: none;
  padding: 6px 16px 10px;
  font-size: 15px;
  font-weight: 600;
}

.sheet-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 12px 8px;
}

.sheet-status {
  padding: 18px 8px;
  color: var(--m-text-tertiary);
  font-size: 13px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.sheet-status-error {
  color: var(--m-danger);
}

.sheet-hint {
  margin: 0;
  color: var(--m-text-secondary);
  font-size: 12px;
  line-height: 1.5;
  max-width: 32em;
}

.sheet-error {
  margin: 0 0 8px;
  color: var(--m-danger);
  font-size: 12.5px;
}

.sheet-section {
  margin-bottom: 14px;
}

.sheet-section-title {
  padding: 4px 8px 6px;
  color: var(--m-text-tertiary);
  font-size: 12px;
  font-weight: 600;
}

.sheet-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--m-text);
  text-align: left;
  cursor: pointer;
}

.sheet-option:active {
  background: var(--m-bg-input);
}

.sheet-option-selected {
  border-color: var(--m-accent);
  background: color-mix(in srgb, var(--m-accent) 12%, transparent);
}

.sheet-option:disabled {
  opacity: 0.5;
}

.sheet-option-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sheet-option-title {
  font-size: 14px;
}

.sheet-option-desc {
  color: var(--m-text-tertiary);
  font-size: 12px;
  line-height: 1.4;
}

.sheet-option-check {
  flex: none;
  color: var(--m-accent);
  font-size: 15px;
  font-weight: 700;
}

.sheet-confirm-desc {
  margin: 0 4px 14px;
  color: var(--m-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.sheet-confirm-actions {
  display: flex;
  gap: 10px;
  padding: 4px;
}

.sheet-confirm-actions .mobile-button {
  flex: 1;
}

.sheet-confirm-danger {
  flex: 1;
  height: 38px;
  border: none;
  border-radius: 10px;
  background: var(--m-danger);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}

.sheet-confirm-danger:disabled {
  opacity: 0.5;
}

.chat-meta {
  margin-top: 4px;
  color: var(--m-text-tertiary);
  font-size: 11px;
}

.chat-typing {
  color: var(--m-text-tertiary);
  font-size: 13px;
  padding: 4px 2px;
}

.chat-inputbar {
  display: flex;
  gap: 8px;
  padding: 10px 12px calc(env(safe-area-inset-bottom, 0px) + 10px);
  border-top: 1px solid var(--m-border);
  background: var(--m-bg);
}

.chat-input {
  flex: 1;
  min-width: 0;
  min-height: 40px;
  max-height: 120px;
  /* Grow with the content (still bounded by min/max-height); browsers
     without field-sizing support ignore this line and keep the old size. */
  field-sizing: content;
  padding: 9px 12px;
  border: 1px solid var(--m-border);
  border-radius: 10px;
  background: var(--m-bg-input);
  color: var(--m-text);
  font: inherit;
  font-size: 14.5px;
  resize: none;
  outline: none;
}

.chat-input:focus {
  border-color: var(--m-accent);
}

.chat-send {
  flex: none;
  align-self: flex-end;
  height: 40px;
  padding: 0 16px;
  border: none;
  border-radius: 10px;
  background: var(--m-accent);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}

.chat-send:disabled {
  opacity: 0.5;
}

.chat-load-older {
  align-self: center;
  margin: 4px 0;
  border: none;
  background: transparent;
  color: var(--m-text-secondary);
  font-size: 13px;
  cursor: pointer;
  padding: 6px 10px;
}

/* Touch surfaces have no hover, so keyboard focus must be fully visible.
   One shared ring keeps every interactive control consistent and readable
   on both palettes. */
.mobile-row:focus-visible,
.mobile-button:focus-visible,
.mobile-new:focus-visible,
.chat-send:focus-visible,
.chat-chip:focus-visible,
.chat-msg-toggle:focus-visible,
.chat-load-older:focus-visible,
.chat-disclosure-head:focus-visible,
.sheet-option:focus-visible,
.sheet-confirm-danger:focus-visible,
.sheet-toggle-switch:focus-visible,
.chat-input:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--m-bg), 0 0 0 4px var(--m-accent);
}

/* ── chat context usage chip (chat-tools row) ───────────────────────── */

.chat-context {
  flex: none;
  align-self: center;
  padding: 2px 10px;
  border: 1px solid var(--m-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--m-text-tertiary) 10%, transparent);
  color: var(--m-text-tertiary);
  font-size: 11px;
  line-height: 1.6;
  white-space: nowrap;
}

.chat-context-warn {
  border-color: var(--m-danger);
  background: color-mix(in srgb, var(--m-danger) 14%, transparent);
  color: var(--m-danger);
}

/* ── display sheet toggle rows ──────────────────────────────────────── */

.sheet-toggle-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 8px;
  border-bottom: 1px solid var(--m-border);
}

.sheet-toggle-row:last-child {
  border-bottom: none;
}

.sheet-toggle-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sheet-toggle-title {
  font-size: 14px;
}

.sheet-toggle-desc {
  color: var(--m-text-tertiary);
  font-size: 12px;
  line-height: 1.4;
}

.sheet-toggle-switch {
  position: relative;
  flex: none;
  width: 44px;
  height: 26px;
  border: none;
  border-radius: 999px;
  background: var(--m-border);
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.sheet-toggle-switch-on {
  background: var(--m-accent);
}

.sheet-toggle-switch-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.2);
  transition: transform 0.15s ease;
}

.sheet-toggle-switch-on .sheet-toggle-switch-knob {
  transform: translateX(18px);
}

/* Accessibility: collapse every interaction/enter animation for
   reduced-motion users; surface layout itself stays static. */
@media (prefers-reduced-motion: reduce) {
  .mobile-theme-toggle,
  .mobile-back,
  .mobile-row,
  .mobile-button,
  .mobile-new,
  .chat-send,
  .chat-chip,
  .chat-msg-toggle,
  .chat-load-older,
  .chat-disclosure-head,
  .chat-disclosure-caret,
  .chat-msg-pending .chat-msg-text::after,
  .sheet-backdrop,
  .sheet,
  .sheet-option,
  .sheet-confirm-danger,
  .sheet-toggle-switch,
  .sheet-toggle-switch-knob,
  .chat-input {
    animation: none;
    transition: none;
  }
}
`
