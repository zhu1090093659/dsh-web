# Agent Note: remote-web-ui docker and reverse proxy pairing adaptation

Status: implemented

## Problem

When DeepSeek Harness runs in containerized (e.g. Docker bridge network) or reverse-proxied topologies, the internal network interface sampled by the service (such as 172.22.0.5) differs from the host's actual LAN IP (such as 192.168.1.100) or proxy domain.

This caused a complete pairing deadlock:
1. The minted pairing QR code carried the unroutable internal container IP, making mobile phone scanning impossible from the host network.
2. Even when a user manually opened the host LAN address or copied the link, the incoming Host header did not match any of the server's sampled network interfaces. The pairing endpoints were rejected outright by the lanFence security guard with 403 Forbidden.
3. Even when attempting to submit the 128-bit pairing token via the web UI at the host address, the POST /api/pair/accept request was similarly blocked with 403 before token validation could occur.

## Decision

Enable seamless pairing across container-bridged networks, reverse proxies, and custom local domains while preserving strong security boundaries:

- Direct token acceptance with host authorization: Pairing endpoints (POST /api/pair/accept and GET /pair-accept) permit requests with private or local hostnames (RFC 1918 IPv4, IPv6 ULA, .local, .lan, .internal, .home.arpa, loopback) and non-cross-site markers (sec-fetch-site != 'cross-site' and matching Origin if present) to reach token verification. (Amended 2026-09-09: the `GET /pair-accept` and `GET /pair-app` pages are top-level navigations and now accept the marker-less case too — see [the pairing entry navigation fence](2026-09-09-pairing-entry-navigation-fence.md); the POST API path keeps the marker requirement.) Once the cryptographic one-time token is verified, the client's authority (Host:Port) is dynamically granted and recorded in dynamicTrustedHosts.
- Paired session re-authorization: When a request arrives from a private LAN host carrying a valid paired-device cookie issued by this service instance, its authority is automatically trusted and added to dynamicTrustedHosts, surviving client reconnects and service rebinds.
- Explicit host configuration and environment variables: Added trustedHosts configuration and supported DSH_REMOTE_TRUSTED_HOSTS (comma-separated authorities) and DSH_REMOTE_PUBLIC_BASE_URL environment variables for static network pre-configuration.
- Pairing panel UI enhancements: Exposed the raw pairing token with a dedicated copy button and contextual guidance for Docker/reverse-proxy topologies alongside the existing QR code and link copy actions.

## Testing

- Unit tests in packages/dsh-remote-web-ui/tests/docker-pairing.spec.ts verify:
  - Acceptance of tokens directly from external host IP (192.168.1.100:3080) when internal interface is 172.22.0.5:3080, and dynamic authorization of subsequent calls.
  - Verification of GET /pair-accept from external host with 303 redirection to app landing.
  - Rejection of cross-site requests (sec-fetch-site: cross-site) and origin mismatches on the API path; since the [navigation fence fix](2026-09-09-pairing-entry-navigation-fence.md) the entry pages accept a top-level document navigation with those markers.
  - Rejection of non-private external hosts when not pre-configured in whitelist.
  - Verification of explicit trustedHosts configuration.
- Full package test suite (31 files, 338 tests) passing cleanly.
- Full repository typecheck and documentation checks passing cleanly.
- Full i18n audit passing across zh, en, and ru dictionaries.

## Alternatives considered

- Requiring manual network configuration (host networking mode only): Docker host networking mode (--net=host) is not supported on Windows and macOS Docker Desktop, and forces port binding onto host namespaces, which breaks container isolation and port remapping.
- Disabling the Host fence entirely: Completely removing the Host header check would expose the pairing service to DNS rebinding attacks where arbitrary internet websites can invoke internal pairing endpoints from an unsuspecting browser.
- Opening pairing unconditionally to all IPs: Rejecting non-private addresses while permitting RFC 1918 and local names with strict sec-fetch-site and cryptographically secure token validation preserves the defense-in-depth model while enabling local container workflows.

## Consequences

Users running DSH in Docker, Kubernetes, or behind custom reverse proxies can now pair mobile and remote devices directly using the pairing token or custom host link without configuring complex host network workarounds. DNS rebinding and cross-site request forgery protections remain enforced on every API and subresource request; the pairing entry pages accept a top-level navigation from any initiator, which is what a QR link requires (see [the navigation fence fix](2026-09-09-pairing-entry-navigation-fence.md)).
