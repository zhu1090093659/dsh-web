# Agent Note: The LAN-bind block asks the installed host which bind addresses it accepts

Status: implemented

Superseded in part by [the LAN forwarder](../architecture/2026-10-20-lan-forwarder-replaces-bind-block.md): the managed block is removed, and the capability probe now decides which LAN address the runtime forwarder may listen on and what the status frame reports. The decision recorded here — ask the installed host which binds it accepts instead of guessing — still holds.

## Problem

`packages/dsh-remote-web-ui` ships the LAN-bind toggle as a managed block in
the profile `cordis.patch.yml`, and the "on" state pinned `host: '0.0.0.0'`.
Since `@deepseek-ai/dsh-host-webserver@0.2.1-rc.2` the webserver `Config`
schema rejects wildcard addresses, so that block is refused by config validation
and every later `dsh web` start fails (issue #1893). Calling the schema on the
installed module gives the acceptance table directly:

| `host` value | `WebServer.Config({ host, port })` on the installed 0.2.1-rc.2 |
| --- | --- |
| `127.0.0.1` | accept |
| `::1` | accept |
| `192.168.1.5` | accept |
| `0.0.0.0` | reject: `host "0.0.0.0" is an unspecified (wildcard) address, which is not supported` |
| `::` | reject: the same unspecified (wildcard) refusal |
| `localhost` | reject: `host "localhost" is not a concrete IPv4 or IPv6 address literal` |
| `example.com` | reject: not a concrete IPv4 or IPv6 address literal |

The block becomes a startup brick, and three properties of the shipped shape are
why the plugin cannot get out of it on its own:

- **The plugin loads only after the webserver.** `src/index.ts` declares
  `inject = ['webServer', 'typertGateway', 'connection']`, so the row does not
  mount until the webserver does — and the webserver never starts. The boot
  re-assert that rewrites the block, the settings card and the status endpoint
  all sit behind the same edge; there is no code of this plugin that runs before
  the refusal.
- **`disabled: true` does not help.** The refused literal lives in a separate
  `- id: webserver` row that this plugin wrote earlier. Disabling the plugin row
  removes the only writer of that row and leaves the row itself in place, still
  pinning the value the schema rejects.
- **The declared host floor is exactly the line that rejects the block.** Both
  `peerDependencies['@deepseek-ai/dsh']` and `dsh.engines.dsh` read
  `>=0.2.1-rc.2` ([dsh host floor tracks cohort](../architecture/2026-09-01-dsh-host-floor-tracks-cohort.md)),
  so a profile that legitimately pinned `0.0.0.0` on an earlier line upgrades
  into this state by doing nothing wrong. The repair has to work inside the
  cohort the package declares, not above it.

The CLI `--host` flag feeds the same `Config`, so `dsh web --host 0.0.0.0` is
refused on this cohort too: the wildcard literal is unreachable by every route
the plugin and the operator have. The cohort move that put the package on this
line ([SDK cohort 0.2.1-rc.2](../architecture/2026-10-17-sdk-cohort-0.2.1-rc.2.md))
adapted the webserver `port` getter and left the bind guard unexamined; this
note records the bind half.

## Decision

The [Owning Note](../architecture/2026-08-29-remote-control-reuses-official-ui.md)
keeps owning the managed-block design — the markers, strip-and-rewrite, the
static values, the same-id full-config replacement, the boot re-assert and the
`pendingRestart` comparison are all unchanged. This note supersedes exactly one
premise inside it: that the block may pin the wildcard literal `0.0.0.0`.

- **A capability probe over the installed schema.** A memoized
  `wildcardBindSupported()` asks the installed
  `@deepseek-ai/dsh-host-webserver` module's own `Config` whether it accepts a
  wildcard literal, and answers false when the module cannot be interrogated (a
  failed import, an unexpected throw). The host's own schema is the one authority
  that cannot drift away from the host, whatever the line is called.
- **Both build entry points keep that module external.** `tsdown.prepare.config.ts` re-exports `tsdown.config.ts` instead of restating `clientBundle`, so development, npm and git-install builds share one external list. The published plugin contains no bundled `WebServer`/`writeResponse` implementation (issue #2082).
- **The block pins what the host accepts.** `desiredBindHost(lanBind, startupHost, capability)`
  decides in this order: `127.0.0.1` while the toggle is off; the CLI `--host`
  when it is a concrete address literal; `0.0.0.0` only while the probe reports
  wildcard support; otherwise this machine's first advertisable LAN IPv4 — the
  head of `lanIPv4Addresses()` in `src/lan.ts`, the same interface order the QR
  and the console line already use; and `undefined` when that list is empty.
- **Refuse to write, never refuse to boot.** An `undefined` plan writes no block
  at all and reports `lanBlocked` with its reason, instead of pinning a literal
  the next start will reject. On a host that refuses wildcards, a machine with no
  LAN address gets an honest card rather than a profile that no longer boots.
- **"Not loopback" replaces `=== '0.0.0.0'` as the reachability decision.** Whether
  the GUI is on the LAN is decided by the bound host not being a loopback
  literal, not by equality with the wildcard: `lanBases`, the status `lanUrls`,
  the firewall summary and the boot's LAN-exposure warning all key off that. A
  concrete-interface bind exposes the GUI exactly the way an all-interfaces bind
  did, so the old test would have silently dropped LAN reachability for the only
  bind this cohort permits.
- **The status frame states the capability.** It gains `desiredHost`,
  `wildcardSupported`, `supportedHosts` and `lanBlocked`, so the settings card
  can say which address will be pinned, that the host refuses wildcards, and why
  nothing could be pinned — instead of offering a toggle that quietly does
  nothing.
- **Toggle off still pins `127.0.0.1`.** Same-id patch rows replace a row's
  `config` wholesale, so the block stays complete and static with the official
  row's compression keys, and the replay of a toggle round keeps working.
- **A legacy `0.0.0.0` block needs one manual cleanup.** That profile cannot be
  repaired by the plugin for the same reason it cannot start, and no boot of this
  version rewrites it. The documented edit removes the two marker lines and the
  `- id: webserver` item only — the discipline `stripManagedBlock` already
  applies. Rows appended through the YAML document API land inside the marked
  region, so deleting the region would take the user's own rows with it
  ([the displaced-markers fix](2026-09-06-issues-1389-1390-1381-fixes.md)).

## Alternatives considered

- **Compare the host version against `0.2.1-rc.2`.** Rejected: the refusal is a
  property of one schema, not a version fact. A comparison would have to model
  pre-release ordering correctly (a plain string compare puts `rc.10` before
  `rc.2`), be re-learned at every cohort boundary, and still be wrong for a
  host patched or pinned outside the version string. The installed module can be
  asked the real question in one call.
- **Read the published `Config` schema text or the address guard instead of
  executing it.** Rejected: the published `lib/index.js` is a bundle whose
  message text is not a contract, so matching source or error strings couples the
  fix to a build shape. The module does export host predicates (`isWildcardHost`,
  `isLoopbackHost`, `normalizeBindAddress`, `bindUrlHost`), but those describe
  address classes while the schema decides acceptance — including the mapped and
  loopback forms a text match gets wrong. Executing `Config` answers for the
  exact value the block would write.
- **Keep `0.0.0.0` and only refuse to boot later (the issue's option 2).**
  Half-kept, half-dropped: the "do not brick" half survives as the early refusal
  and the explicit `lanBlocked` report, while the "keep the wildcard" half is
  dropped because no host on this cohort accepts it. Keeping the literal would
  guarantee that LAN access never works and move the same failure to a worse
  moment.
- **Inherit the CLI `--host` verbatim.** Rejected: the flag is a startup fact,
  not a capability fact, and `--host 0.0.0.0` feeds the same schema — inheriting
  it verbatim reproduces the brick. The decision keeps the useful part (a concrete
  literal the operator asked for wins) and drops the part that cannot work.
- **Write no block at all and require the operator to bind manually.** Rejected:
  that deletes the toggle rather than fixing it. The card exists so a person
  without CLI knowledge can turn LAN access on, and requiring a manual
  `--host <address>` leaves the card with nothing to do. The decision reaches the
  same "no block" outcome only for machines that genuinely have no address, and
  says so.
- **Migrate the block from a different boot phase — a cordis plugin that loads
  before the webserver.** Rejected: the profile patch is input to composition, so
  a rewrite performed earlier in the same start arrives after the refused row was
  already read and validated, and a second plugin package would be shipped only
  to perform a repair that the same-start ordering cannot deliver. A host-level
  migration of the user's profile is not this repository's surface.

## Consequences

- LAN access on this cohort requires a concrete interface address. A DHCP lease
  change that moves the machine's address needs a fresh toggle or start round,
  because the block pins one literal.
- A multi-homed machine pins one address: the first advertisable candidate, the
  same order `lanIPv4Addresses()` already uses. Under the old wildcard bind every
  interface answered; now the others do not, and the advertised LAN URLs name
  only the pinned address.
- A legacy `0.0.0.0` block still needs the one manual cleanup described above; no
  boot of this version can repair it, and the plugin's own writers never touch a
  block they did not plan.
- On this cohort the CLI `--host 0.0.0.0` route is gone, and the package READMEs
  say so: deliberate LAN exposure happens through the settings card, which pins a
  concrete address.
- The status frame grows four fields. The card reads them to explain a blocked
  machine, and the three locale dictionaries carry the explanation.
- The next host cohort can restore the wildcard bind by shipping a schema that
  accepts it: the probe follows the schema, so this note's decision needs no new
  branch.

## Testing

- The acceptance table in `## Problem` is measured, not inferred:
  `WebServer.Config({ host, port })` from the installed
  `@deepseek-ai/dsh-host-webserver@0.2.1-rc.2` (resolved inside
  `packages/dsh-remote-web-ui`) accepts `127.0.0.1`, `::1` and `192.168.1.5`, and
  rejects `0.0.0.0`, `::`, `localhost` and `example.com` with the quoted
  messages.
- `desiredBindHost` is a pure helper and keeps its direct unit coverage in
  `tests/lan-bind-plan.spec.ts`, where it is already pinned; the capability and
  address-list inputs extend that coverage rather than adding a test seam.
- `tests/host-bind-capability.spec.ts` also resolves the prepare build and pins the host-webserver external; the prepare build itself verifies that the emitted host bundle imports that package instead of defining `WebServer` or `writeResponse`.
- The three locale dictionaries (zh, en, ru) and the card copy are covered by
  `pnpm i18n:check`; the package lane for the host half is
  `pnpm --filter @linxin666/dsh-remote-web-ui test` plus `pnpm typecheck`.
