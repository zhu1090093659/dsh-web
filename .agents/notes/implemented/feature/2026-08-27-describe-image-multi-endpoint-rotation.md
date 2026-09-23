# Agent Note: Multi-Endpoint Rotation and Failover for Image Understanding

Status: implemented

## Problem

Users of the image understanding tool (describe_image) often configure free or pay-as-you-go third-party vision models (e.g. Zhipu GLM-4V, Alibaba DashScope Qwen-VL, etc.). A single endpoint frequently hits vendor RPM/TPM rate limits (HTTP 429) or transient outages during continuous interactions, and cannot balance quota usage across multiple free tiers (Issue #1234).

## Decision

Introduce multi-endpoint candidate lists, rotation scheduling, and automatic failover in @linxin666/dsh-tool-describe-image:

- **Configuration schema**: Added endpoints array to Config (each supporting 
ame, \baseURL, model, \apiKey, \apiKeyEnv, \apiStyle, maxOutputTokens, and enabled), along with \rotationMode (\round-robin or \failover) and \retryNextOnFailure (auto-retry on failure).
- **Full backward compatibility**: When endpoints is omitted, the plugin seamlessly falls back to the top-level single \baseURL + model configuration with zero breaking changes.
- **Execution engine**:
  - \round-robin: Maintains an instance invocation cursor to cycle through active endpoints sequentially.
  - \failover: Prioritizes the primary endpoint and falls back down the list only upon errors.
  - On 429, 5xx, or network failure with \retryNextOnFailure: true (default), tries the next candidate endpoint in order; if all fail, produces an aggregated summary of every endpoint error.
- **Transparent model return & semantic cache**: Returns the actual answering model id (output.model); semantic caching keys on the actual invoked endpoint specifications.
- **Settings Card UI**: Extended settings card to expose rotation strategy and retry toggles with bilingual support (zh/en).

## Alternatives considered

- **Single endpoint with multiple model IDs only**: Rejected — different vendors (Zhipu vs DashScope vs OpenAI relays) require distinct Base URLs, API Styles, and API keys.
- **Client-side rotation**: Rejected — describe_image is executed by the host on behalf of LLM tool calls; rotation and retry must reside in the host execution path to avoid failing agent turns.

## Consequences

Users can now distribute rate-limiting pressure across multiple vision endpoints and achieve seamless failover during single-provider outages. All existing configurations remain 100% backward compatible. Comprehensive unit tests covering rotation, failover, disabled-endpoint skipping, and credential isolation are added under 	ests/rotation.spec.ts.
