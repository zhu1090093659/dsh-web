# @linxin666/dsh-round-jump

English | [中文](README.zh.md)

A right-edge hover popup that lists every user round in the current
conversation and jumps to the picked one — a navigation map for long
sessions where scrolling back to "that question from round 17" is
needle-in-a-haystack work.

Hover the rightmost 16px column of the viewport for ~180ms and the popup
slides in: each of your messages becomes one entry (sequence number + text
preview), ordered oldest first. Click an entry to scroll the conversation to
that round. A "load all history" button pulls every older page (the platform
pages history 50 messages at a time) and then scrolls to the oldest message.

## What it does

- **Client half** (all of the feature): registers a surface into the
  session-scoped `conversation.composer.dock` slot, then portals the floating
  popup onto `document.body` so the hot zone and panel are viewport-global.
  Rounds come from the official conversation snapshot (`useSession` →
  `ConversationSnapshot.chat`): nodes with `kind === 'user'`, walked in
  `chat.order`. A jump uses the node's stable `key`, which is the same value
  the shipped ChatNodeSeat stamps onto `data-chat-anchor-key`. Older history
  loads through the framework `ctx.conversation.loadOlder()` (one page per
  call); the load-all action loops it until `hasMore` clears, bounded at
  200 pages (10k messages).
- **Host half**: a no-op placeholder so the package resolves as a profile
  bundle and its `dsh.client` declaration gets scanned into the web plugin
  roster.

## Installation

```sh
# From npm (once published)
dsh plugin --profile web add @linxin666/dsh-round-jump

# From the repository (development loop)
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-round-jump
```

Restart `dsh web`, then hover the right edge of the viewport.

## Usage

1. Move the mouse to the rightmost edge of the window (the 16px hot zone)
   and hold it there for about 180ms.
2. The "跳转到我的消息" (jump to my messages) popup slides in from the
   right, listing every user round with a sequence number and a preview.
3. Click a round to smoothly scroll the conversation to that message. The
   popup closes; moving away from the hot zone or pressing `Esc` also closes
   it.
4. Click "加载全部历史" (load all history) to page through every older
   page at once and land on the oldest message.

## Known Limitations and Deferred Work

- **Preview text only**: the popup shows a two-line text preview per round,
  not images or tool blocks; a round whose content has no text block shows an
  empty preview line.
- **Load-all is bounded**: sessions longer than 10k messages keep their
  remaining "load older" button after the 200-page ceiling; loading that much
  DOM at once is intentionally not forced.
- **Jump targets rendered rows only**: a round whose row is outside the
  loaded history window cannot be scrolled to until its page is loaded (the
  load-all button is the workaround).

## Model Experience

None: this plugin renders conversation navigation in the browser and reads
the conversation snapshot only; nothing here reaches a model request or
writes session state.

#### KV Cache effect

None.
