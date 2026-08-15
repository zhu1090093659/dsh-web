import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { EpochHeader } from '@deepseek-ai/dsh-session'

/** User-configurable heuristic inputs. */
export interface EstimatorConfig {
  /** Approximate text characters represented by one token. */
  readonly charsPerToken?: number
  /** Fixed framing tokens assigned to each content block. */
  readonly blockOverhead?: number
  /** Fixed framing tokens assigned to each message or assistant response. */
  readonly roleOverhead?: number
}

/** Fully resolved positive-density estimator settings. */
export interface EstimatorSpec {
  readonly charsPerToken: number
  readonly blockOverhead: number
  readonly roleOverhead: number
}

/** Validate and default deployment-supplied estimator settings.
 * @param config - user-supplied estimator settings (all fields optional).
 * @returns the fully resolved positive-density estimator settings.
 */
export function resolveEstimatorConfig(config: EstimatorConfig): EstimatorSpec {
  const known = new Set(['charsPerToken', 'blockOverhead', 'roleOverhead'])
  for (const key of Object.keys(config)) {
    if (!known.has(key)) throw new Error(`live-stats: unknown config key "${key}"`)
  }
  const spec = {
    charsPerToken: config.charsPerToken ?? 4,
    blockOverhead: config.blockOverhead ?? 4,
    roleOverhead: config.roleOverhead ?? 4,
  }
  if (!Number.isFinite(spec.charsPerToken) || spec.charsPerToken <= 0) {
    throw new Error('live-stats: charsPerToken must be a positive finite number')
  }
  for (const key of ['blockOverhead', 'roleOverhead'] as const) {
    if (!Number.isInteger(spec[key]) || spec[key] < 0) {
      throw new Error(`live-stats: ${key} must be a non-negative integer`)
    }
  }
  return spec
}

/** Estimate one text-like block from its accumulated character count.
 * @param characters - accumulated character count of the block.
 * @param spec - resolved estimator settings.
 * @returns the estimated token count.
 */
export function estimateTextBlockTokens(characters: number, spec: EstimatorSpec): number {
  return Math.ceil(characters / spec.charsPerToken) + spec.blockOverhead
}

/** Estimate one tool call from its accumulated name and argument sizes.
 * @param nameCharacters - accumulated tool-name character count.
 * @param argumentCharacters - accumulated JSON-argument character count.
 * @param spec - resolved estimator settings.
 * @returns the estimated token count.
 */
export function estimateToolCallBlockTokens(
  nameCharacters: number,
  argumentCharacters: number,
  spec: EstimatorSpec,
): number {
  return Math.ceil(nameCharacters / spec.charsPerToken)
    + Math.ceil(argumentCharacters / spec.charsPerToken)
    + spec.blockOverhead
}

/** Estimate one assistant response from already priced non-empty blocks.
 * @param blockTokens - per-block token counts; empty means no priced blocks.
 * @param spec - resolved estimator settings.
 * @returns the estimated token count (zero for an empty block list).
 */
export function estimateAssistantBlockTokens(blockTokens: readonly number[], spec: EstimatorSpec): number {
  return blockTokens.length === 0
    ? 0
    : blockTokens.reduce((sum, tokens) => sum + tokens, 0) + spec.roleOverhead
}

/** How deeply tool-result content may nest before deep pricing stops. */
const MAX_CONTENT_DEPTH = 128

/** Cap on the serialized length of an untyped content block used for pricing.
 * A gigantic (or pathological) opaque block is priced from a bounded snapshot
 * of its JSON so the estimate stays finite and the per-chunk serialize cost
 * stays linear in the cap rather than the full structure.
 */
const MAX_UNKNOWN_BLOCK_CHARS = 4096

/** Price an untyped block from its bounded JSON representation.
 * @param block - the untyped content block to price.
 * @param spec - resolved estimator settings.
 * @returns the estimated token count (capped by the serialized-length bound).
 */
function estimateUnknownBlockTokens(block: ContentBlock, spec: EstimatorSpec): number {
  const serialized = JSON.stringify(block)
  const length = serialized.length > MAX_UNKNOWN_BLOCK_CHARS
    ? MAX_UNKNOWN_BLOCK_CHARS
    : serialized.length
  return spec.blockOverhead + Math.ceil(length / spec.charsPerToken)
}

/** Estimate model content with the configured provider-independent density.
 * @param blocks - the content blocks to price.
 * @param spec - resolved estimator settings.
 * @returns the estimated token count.
 */
export function estimateContentTokens(blocks: readonly ContentBlock[], spec: EstimatorSpec): number {
  return estimateContentBlocks(blocks, spec, 0)
}

/**
 * Price content blocks, recursing into tool-result content up to a depth cap.
 * The cap turns a pathological (or cyclic) content graph into bounded framing
 * charges instead of a stack overflow.
 */
function estimateContentBlocks(blocks: readonly ContentBlock[], spec: EstimatorSpec, depth: number): number {
  let tokens = 0
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        tokens += estimateTextBlockTokens(block.text.length, spec)
        break
      case 'tool-call':
        tokens += estimateToolCallBlockTokens(block.name.length, block.arguments.length, spec)
        break
      case 'tool-result':
        // Frame the block even when its nested content is too deep to price.
        tokens += depth >= MAX_CONTENT_DEPTH
          ? spec.blockOverhead
          : estimateContentBlocks(block.content, spec, depth + 1) + spec.blockOverhead
        break
      default:
        tokens += estimateUnknownBlockTokens(block, spec)
    }
  }
  return tokens
}

/** Estimate one model-visible message including role framing.
 * @param message - the message whose content and role are priced.
 * @param spec - resolved estimator settings.
 * @returns the estimated token count.
 */
export function estimateMessageTokens(message: Message, spec: EstimatorSpec): number {
  return estimateContentTokens(message.content, spec) + spec.roleOverhead
}

/** Estimate the system prompt and tool schemas carried outside the surface.
 * @param header - the epoch header, or null when none was recorded.
 * @param spec - resolved estimator settings.
 * @returns the estimated token count (zero for an absent header).
 */
export function estimateHeaderTokens(header: EpochHeader | null, spec: EstimatorSpec): number {
  if (header === undefined || header === null) return 0
  let tokens = 0
  if (header.system !== undefined) {
    tokens += Math.ceil(header.system.length / spec.charsPerToken) + spec.roleOverhead
  }
  if (header.tools !== undefined && header.tools.length > 0) {
    tokens += Math.ceil(JSON.stringify(header.tools).length / spec.charsPerToken) + spec.blockOverhead
  }
  return tokens
}
