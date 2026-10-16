# Agent Note: the phone chooses its pairing origin at connect time, and only reachable LAN literals are advertised

Status: implemented

## Problem

A pairing link names exactly one base, and the desktop panel turned that into a
question for the user: one radio row per constructible LAN literal plus one for
the public (tunneled/relayed) base. The user cannot answer it. The desktop has
no way to know whether the phone that is about to scan the code sits on the same
network as this machine, and the list got longer exactly where the question got
harder — a multi-homed host (Wi-Fi plus Ethernet plus a VPN) produced three or
four rows that all looked equally plausible from the machine's side.

The derivation behind those rows was also too generous. Every non-internal IPv4
interface address was advertised, including the TUN gateway a fake-IP proxy
samples (Clash/Surge/Mihomo hand out `198.18.0.0/15` addresses, and a macOS host
running one reported `198.18.0.1`). No phone on the physical network can route
to that address, so the row that "worked" from the desktop was the one row that
guaranteed a dead pairing page on the phone — and it was listed like any other
candidate, for the user to notice and avoid.

## Decision

- **The QR link names the public base.** `POST /api/pair/issue` builds its URL
  from `publicBaseUrl` whenever one is configured, whatever LAN literals exist:
  it is the only base a phone anywhere can dial, so the link no longer depends on
  the scanning phone's network. The per-request `address` payload still names a
  specific LAN literal for a scripted caller, and the manual override below can
  pin the LAN base.
- **The device-gated landing decides at connect time.** `/pair-app` is the
  plugin's own page, already rendered ahead of the official shell's boot, so it
  carries a second inline script (`src/lan-source.ts`) that probes the advertised
  LAN origins with one no-cors GET each at the new `/pair-ping` beacon under an
  800 ms budget. The first candidate that answers becomes the phone's origin: the
  landing navigates to `<lan-origin>/pair-app?grant=<fresh one-time grant>` and
  the UI boots from the LAN origin. The decision, with the candidate set it was
  made against, is written to `sessionStorage`; the same set is not probed again,
  a changed set is.
- **The probe cannot block pairing.** It is fire-and-forget on a page that is
  already served and already usable: no candidate answering, a timeout, a
  storage failure, or a missing `fetch` all leave the public page in place. Only
  `auto` (below) ships a hop at all.
- **A failed hop falls back.** A decision that says `lan` while the page is *not*
  on a LAN candidate, taken within two minutes, is read as a switch that did not
  stick — the phone re-scanned the QR — and it settles on `public` instead of
  hopping into the same hole again. A later re-visit re-probes.
- **The LAN credential for the hop is a fresh one-time grant, not the token.** The
  grant table lives in the process, not per origin, so a grant minted while
  serving the public landing is redeemable by the LAN interface, and the hop
  re-pairs the *same* device session instead of minting a second one. It is
  published only inside the response body of a landing the device already
  authenticated.
- **Only reachable literals are advertised.** `src/lan.ts`
  (`lanIPv4Addresses` / `lanIPv4Candidates`) drops tunnels and VPN adapters by
  interface name (`utun*`, `tun*`, `tap*`, `ppp*`, `ipsec*`, `wg*`, `wireguard*`,
  `tailscale*`, `nordlynx*`, `proton*`, `openvpn*`, `zt*`), container and VM
  bridges (`docker*`, `veth*`, `virbr*`, `vmnet*`, `vboxnet*`, `vEthernet*`,
  `br-*`), and every address no peer can route to: `0.0.0.0/8`, `127.0.0.0/8`,
  `100.64.0.0/10` (CGNAT, where Tailscale lives), `169.254.0.0/16`, the
  `198.18.0.0/15` fake-IP range, multicast and reserved. `bridge0`/`br0` are
  deliberately kept: a real bridged LAN (macOS Internet Sharing) is an address
  the phone does dial. The same filtered list feeds the QR base, the landing's
  candidates, the fence's trusted literals, and the posture probe, so the
  advertised set and the accepted set cannot diverge. The rule is a denial list,
  not an RFC1918 allowlist: a standalone host whose only interface is a routable
  literal keeps a constructible base.
- **`pairingSource` is the manual override.** A patch-only config field
  (`auto` default | `public` | `lan`), re-read per request: `auto` is the QR
  names the public base and the landing may hop, `public` pins the public base
  and ships no probe, `lan` serves the QR from the first LAN literal directly.
  The settings card carries no control for it, so a save from the card cannot
  clear it.
- **The panel states the fact instead of asking.** The radio group, its
  handlers, the `lanAddresses` half of the issue response and the
  `address.label` / `address.public` / `address.lan` / `address.hint` keys are
  gone; the panel shows one line saying which source the current link carries.

## How the probe gets past the mixed-content fence

An https page normally may not fetch an `http://` subresource, which every LAN
candidate is. Measured against Chrome with a self-signed https origin (a public
DNS name, a private IP literal, and loopback) fetching `http://192.168.31.220/…`:
the request is delivered, the console reports only warnings, and the image
variant is explicitly *not* upgraded — "This request was not upgraded to HTTPS
because its URL's host is an IP address". IP-literal hosts are therefore outside
both the block and the upgrade, which is the shape the probe relies on. The
`fetch(..., { mode: 'no-cors' })` form resolves with an opaque response, so
reachability is the whole signal and no response body is needed.

## Testing

- `tests/lan.spec.ts`: the Clash TUN shape (`utun4` + `198.18.0.1` beside a real
  NIC) as the anchor, plus tunnel/VM interface names, every denied range and its
  neighbours, malformed literals, interface order, and the routable-only host.
- `tests/lan-source.spec.ts`: the generated script run against a fake window —
  first answer wins, grant encoding, no navigation twice, the budget expiry
  recording `public`, the already-on-LAN short circuit, the same-set skip, the
  changed-set re-probe, the fresh-failed-hop fallback, the stale re-probe, and
  unreadable/denied storage.
- `tests/routes.spec.ts`: the QR link names the public base with two LAN
  literals present, the landing carries the other candidates plus a fresh grant,
  no hop on the LAN origin or under either override, `public` without a configured
  base refusing as `lan-required`, and `/pair-ping` answering 204 for our
  authorities (including the cross-site marker shape the probe produces) and 403
  for a foreign Host.
- `tests/remote-entry.spec.tsx`: the panel states the source and renders no
  radio rows.

## Alternatives considered

- **Keeping the picker behind a disclosure.** Rejected: the question is
  unanswerable on the desktop, and the failure it produces (a phone on a page
  that never loads) is not one the user can diagnose from the panel that offered
  the choice.
- **Letting the server guess from the phone's address.** The tunnel edge forwards
  the client address, so a same-NAT phone could be inferred. Rejected: it cannot
  tell "same NAT" from "same LAN", and a wrong guess navigates the phone to an
  address it cannot reach with no way back — the same dead end the picker caused,
  now automatic.
- **A strict RFC1918/ULA allowlist.** Rejected: it would strand a host whose only
  interface carries a routable literal (a VPS, a standalone server) with no
  constructible base at all, turning a QR that used to work into the
  `lan-required` banner. The denial list drops the reported noise class without
  that regression. IPv6 ULA candidates stay out of scope: the sampling has always
  been IPv4-only, and advertising a bracketed literal would touch every URL
  builder for a case no affected deployment reported.
- **Interface-name filtering alone, or address-range filtering alone.** Both are
  needed and neither is sufficient: WireGuard's `10.x` passes every range rule,
  and a fake-IP gateway renumbered outside `198.18/15` would pass every name rule.
- **Navigating to a LAN candidate without probing it first.** Rejected: a
  navigation that fails has no return path in the browser, so the phone would be
  left on an error page with the paired page one back-button away.
- **Probing from the service worker or a hidden iframe.** Rejected: the service
  worker exists only on the secure public origin (never on the plain-HTTP LAN
  origin), and an iframe probe is blockable mixed content — the one form that
  does not survive the fence.
- **Re-using the pairing token to enter the LAN origin.** Rejected: the token was
  already spent at `/pair-accept`, and spending it again mints a second device
  session for one phone. A fresh grant bound to the existing device is exact.
- **Keeping the panel's `lanAddresses` response field.** Rejected: it existed so
  the picker could switch without a round trip, and nothing reads it once the
  picker is gone.

## Consequences

- A same-network phone trades one extra navigation (public landing → LAN
  landing) for a link that never rides the tunnel again, and the LAN page is
  reachable with no public dependency at all while it is open.
- The feature depends on a measured browser behaviour rather than a
  specification guarantee: if a future browser starts blocking or upgrading
  `http://` subresources on IP-literal hosts, every probe fails and the phone
  stays on the public source — degraded to today's default, never broken. The
  override keeps the LAN path reachable in that case.
- A hop that finds its one-time grant already gone lands on the bilingual re-pair
  page. Re-scanning the QR recovers, and the decision record is what makes that
  recovery land on `public` rather than on the same failed hop.
- The advertised candidate set is now a *deliberate* subset of the machine's
  interfaces, so an unusual deployment whose LAN address falls in a denied range
  or on a denied interface name loses its automatic LAN path and needs
  `pairingSource: 'lan'` (which bypasses the filter's advertisement only by
  naming the first LAN base the filter kept — a fully filtered host still needs
  its address reachable another way).
- `198.18.0.1` can no longer appear in a QR link, a landing candidate list, or the
  fence's trusted literals.
