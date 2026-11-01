# Market deploy 429 on the Workers services API - evidence for Cloudflare support

Status: resolved 2026-11-01 - the account API budget was being spent by our own relay control plane, not by a Cloudflare-side flag
Date: 2026-10-27
Account: redacted (`CLOUDFLARE_ACCOUNT_ID` in GitHub Actions, printed as `***` in logs)
Worker: `dsh-market` (custom domain `dsh-market.com`, zone `dsh-market.com`)

## Root cause (2026-11-01)

The account was never flagged. Its API budget was genuinely being spent, continuously, by the `dsh-market` worker's own relay control plane.

- The budget is real and readable from the response headers: `ratelimit-policy: "default";q=1200;w=300` with `ratelimit: "default";r=0` on every refusal, and `retry-after: 300`. A quiet probe that recovered the account half (`tokenValid: true`) still saw `r=0` on the Workers half, which is what a flagged account would have looked like too.
- Every relay claim converges a Cloudflare tunnel and its CNAME through the account API (`List Cloudflare Tunnels`, `Update Tunnel configuration`, `List DNS Records`, `Get Tunnel Token`): four calls per claim. The audit log for one 78 second window held 49 `List Cloudflare Tunnels` and one `Update Tunnel configuration`, every one of them from this worker's token and from a Cloudflare Workers egress address.
- The claim endpoint was taking roughly 200 authenticated claims per second: `relay_rate_limit` carried 7552 distinct `id:` buckets (35004 attempts) and 8845 distinct `ip:` buckets (33769 attempts) across three 60 second windows, against 16036 rows in `relay_registrations`.
- Four calls per claim at that rate is two orders of magnitude above 1200 per 300 s, so the budget sat at `r=0`; every claim that then failed made its client retry, which spent the next window the same way. That loop ran for six days.
- Blocking the two control-plane paths at the zone edge (`/api/relay/claim`, `/api/relay/register`) recovered the budget inside one window (`r`: 43, 166, 292, 413, 536, 657, 1199), which closes the causal loop: the relay was the consumer, not Cloudflare.

The traffic was not an attack. `relay_registrations` grew by 340 to 585 rows per day for the two weeks before this report, every row carrying a distinct `*.trycloudflare.com` target announced by the plugin, and the claim endpoint authenticates before it counts, so those attempts held valid secrets.

No Cloudflare support ticket is needed. The fix set: the relay's default transport moves to the bridge path (no account objects, zero API calls per claim), a D1-backed global budget gate refuses a claim before it can spend an account call, `relay_rate_limit` is pruned by the cron instead of growing without bound (it held 6775893 rows, 576 MB, when this was found), and registrations are to be gated on a paired device rather than open to anyone holding a self-chosen secret.

## To Cloudflare support

Our GitHub Actions lane deploys a static-asset Worker with `wrangler deploy`. Since 2026-10-26 it fails on the first Workers Scripts API call with `429 Too Many Requests` on `GET /accounts/{account_id}/workers/services/dsh-market`, and it has now failed five times over about 36 hours from different runner egress regions. The same run's D1 API calls succeed seconds earlier. Four attempts spread over 85 seconds, each from a fresh Ray, all returned 429. We would like to know whether this account is under a Workers Scripts API limit or a flagged state, and what clears it.

## What the lane does

`node scripts/deploy-market` runs three wrangler commands: `d1 migrations apply dsh-market --remote`, `deploy`, and two `secret put` / `secret list` checks. The 429 always fires on the first API request of `wrangler deploy`, about one second after the step starts, before any bundle or asset upload. The wangler version installed by the lane is `wrangler@4` (4.153.0 in the failing runs).

## Evidence

| GitHub run | UTC | Ray ID | Edge | Result on `GET /accounts/{account_id}/workers/services/dsh-market` |
| --- | --- | --- | --- | --- |
| 40350674320 | 2026-10-26 15:34 | not captured | - | 429 |
| 40367640238 | 2026-10-26 17:20 | not captured | - | 429 |
| 40430514377 | 2026-10-27 01:05 | captured in the log tail | DFW | 429 |
| 40447020886 | 2026-10-27 03:58 | a50ec893fa760c73, a50ec8b86d90b45f, a50ec93f2e2dacca, a50ecabb5a0e1e27 | MSP | 429 on all four attempts of one run |

The 429 body is not JSON, so wrangler reports `Received a malformed response from the API`; no `Retry-After` header is present.

## What we ruled out

- **Client version.** Run 40285936221 (2026-10-26 07:27) deployed successfully with wrangler 4.152.0; the failing runs use 4.153.0. Both bundles carry the same 14 `workers/services` call sites, so the version is not the variable.
- **Transient throttling.** Retries now run at 5 s, 20 s and 60 s (four attempts in total). Every attempt in run 40447020886 returned 429 from a different Ray, which rules out a momentary spike.
- **Cloudflare incident.** `www.cloudflarestatus.com` reported the Workers components operational throughout, with no open incident for the Workers APIs.
- **Token scope.** The same token and account id complete `wrangler d1 migrations apply --remote` in the same job seconds before the failing call, and the lane deployed successfully many times before 2026-10-26 15:34.
- **Deployment size or config.** The 429 arrives before any upload step, so payload size and asset count are not involved.

## Ask

1. Confirm whether this account is currently rate limited or flagged on the Workers Scripts API, and what resets that state.
2. Confirm whether `GET /accounts/{account_id}/workers/services/{script_name}` returning 429 (rather than 403 or 404) is expected for an account in that state.
3. If the limit is per-token or per-account, say which counter it is and what the window is, so we can pace the lane instead of retrying blindly.

## What we already shipped on our side

`scripts/deploy-market` retries the transient signatures (HTTP 429, HTTP 5xx in the shapes wrangler prints, "malformed response from the API", and socket-level errors) up to four attempts, and a failure now carries the reason, the attempt count, every Ray ID and a bounded tail of the captured output, so the next occurrence is diagnosable from the job log alone. Decision record: [the deploy retry note](../.agents/notes/implemented/bug-fix/2026-10-27-market-deploy-retries-throttled-api.md).
