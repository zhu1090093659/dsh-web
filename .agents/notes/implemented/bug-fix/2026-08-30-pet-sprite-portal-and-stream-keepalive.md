# Agent Note: Pet sprite chrome portals into the plugin root; remote stream socks probe with keepalive

Status: implemented

## Problem

Two phone-mirror gaps surfaced in the live round:

1. **The pet never actually hid on the phone.** `mobile-adapt.ts` suppresses `[data-dsh-plugin="pet"]` on the portrait surface, and the pet plugin's apply does create that root container — but `PetSprite` portals the whole float (`createPortal(float, document.body)`), so the sprite, its bubbles and its usage announcement escaped the hidden root. The rule hid only the empty container; the user kept seeing the pet — and its floating bubbles overlapped the conversation on the small viewport. The QA emulation had measured the container (`display:none`) and missed the portaled sprite; the live phone exposed it.
2. **Streamed replies reached the phone minutes late.** The desktop (loopback) got the reply instantly; the phone's reply (produced host-side at 07:50:19) displayed around 07:53-54. Evidence points to the long-lived mux WebSocket through the tunnel going half-open: the server writes are accepted by the kernel, the phone sees nothing, and recovery only happens after the OS-level retransmission timeout, on reconnect plus stream re-baseline.

## Decision

**The sprite chrome portals into the pet's owning root.** `PetSprite` gains `portalTarget?: Element` (default `document.body`); `PetDockEntry` forwards it; the apply passes the `[data-dsh-plugin="pet"]` container it already creates. The root now owns the whole surface — sprite, bubbles, panel, usage announcement — so the root-keyed portrait suppressor hides the pet as one unit, and the L2 semantic contract ("root owns its parts") holds instead of a part escaping the root. Visual layout is unchanged (the float stays `position: fixed`, the container is an unstyled div).

**The remote stream proxy probes its sockets.** `proxyLoopbackUpgrade` enables TCP keepalive (20 s) on both the outer and inner sockets: a half-open tunnel path is detected in seconds and both legs are destroyed, so the phone's mux client reconnects and the session stream re-baselines immediately instead of waiting out the OS RTO.

## Alternatives considered

- **Hide the portaled float via a CSS selector on the sprite itself.** Rejected: the float has no stable semantic attribute (hash-suffixed classes only), and two renderer mounts (frames2d/live2d) vary the deep DOM. The owning root exists precisely to be the stable key; the root was failing to own its portal.
- **Port the sprite into a body-level portal but tag it.** Rejected: it duplicates the root's purpose and keeps the surface split across two roots.
- **Application-level keepalive pings on the rewired sockets.** Rejected at this layer: the browser WebSocket API cannot send protocol pings, and app-level frames would need SDK cooperation.

## Consequences

- The phone mirror truly suppresses the pet: `[data-dsh-plugin="pet"]` `display:none` now hides the sprite, its bubbles and the usage announcement (verified on the QA instance: root `display:none`, sprite element inside the root).
- The desktop presentation is unchanged (the root is unstyled; the float keeps its fixed position).
- Half-open tunnel/edge gaps now recover in seconds instead of minutes; the session stream re-baselines on the client reconnect.
- The network environment remains a risk: this machine's fake-ip TUN proxy has wedged Chrome (external fetches failed machine-wide while curl worked) and the earlier cloudflared QUIC/1033 issues — the keepalive hardens the plugin's own sockets but cannot fix the upstream transport.

## Testing

- dsh-pet: 463 tests / 39 files green, including new portal-target cases (float lands in the provided root; falls back to document.body).
- dsh-remote-web-ui: 283 tests / 26 files green; typecheck + build green.
- Live (QA :3191, iPhone-emulated context): `[data-dsh-plugin="pet"]` root `display:none` with the sprite inside the root — nothing pet-related renders on the phone surface.
