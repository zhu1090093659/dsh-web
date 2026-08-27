/**
 * Decode the legacy per-project jsonl.zstd session logs (the stock DSH
 * persistence backend's on-disk format) and encode synthetic fixtures for
 * tests. Pure byte/JSON layer: no filesystem, no database.
 *
 * Layout being decoded (written by @deepseek-ai/dsh-session-persistence-jsonl):
 *   <sessionsRoot>/<projectKey>/<sessionSegment>/session.jsonl.zstd
 * The file is a series of independently compressed Zstandard frames; frame 1
 * carries exactly one line, the session header, and later frames carry event
 * lines. Segment names mirror the raw session id, which carried no `session-`
 * prefix in older writers.
 * @module better-session-manager/core/legacy-log
 */
import { constants as zlibConstants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'

/** Current legacy store version the writer stamps into every header line. */
export const SESSION_FORMAT_VERSION = 0

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/**
 * Walk a zstd frame structurally and return the byte offset just past its
 * final block (and checksum, when the header declares one). Mirrors the
 * concatenated-frame layout the official writer produces: independent frames
 * appended back-to-back, so each can be decompressed on its own slice.
 *
 * Block headers are little-endian triples (3 bytes): bit 0 last-block,
 * bits 1-2 type, bits 3+ size. Frame header size derives from the frame
 * header descriptor bitfield (RFC 8878).
 * @returns end offset, or -1 when the walk hits a broken/truncated structure.
 */
export function zstdFrameEnd(buffer: Buffer, start: number): number {
  const descriptor = buffer[start + 4]
  const fcsFlag = descriptor >> 6 & 0b11
  const singleSegment = (descriptor >> 5 & 1) === 1
  const checksumFlag = (descriptor >> 2 & 1) === 1
  const dictFlag = descriptor & 0b11
  let pos = start + 5
  if (!singleSegment) pos += 1
  // FCS field size: absent (flag 0, streaming) or one byte when
  // Single_Segment pins the frame to end at EOF; otherwise 2/4/8 bytes.
  pos += fcsFlag === 0 ? (singleSegment ? 1 : 0) : [0, 2, 4, 8][fcsFlag - 1]
  pos += [0, 1, 2, 4][dictFlag]
  for (;;) {
    if (pos + 3 > buffer.length) return -1
    const header = buffer.readUIntLE(pos, 3)
    const last = (header & 1) === 1
    const blockSize = header >> 3
    pos += 3 + blockSize
    if ((header >> 1 & 0b11) === 0b11) return -1 // reserved block type
    if (last) break
  }
  if (checksumFlag) pos += 4
  return pos
}

export interface DecodedLog {
  chunks: string[]
  tornTail: boolean
}

/**
 * Split a concatenated multi-frame log into decoded plaintext chunks. Node's
 * synchronous decompressor returns after the FIRST complete frame, which is
 * exactly why a whole-buffer call cannot serve here. A structurally broken or
 * truncated final frame recovers whatever prefix still decodes and flags the
 * loss — mirrors the reader's torn-tail recovery.
 */
export function decodeZstdLog(buffer: Buffer): DecodedLog {
  const chunks: string[] = []
  let tornTail = false
  let cursor = buffer.indexOf(ZSTD_MAGIC)
  while (cursor >= 0 && cursor < buffer.length) {
    const end = zstdFrameEnd(buffer, cursor)
    if (end < 0 || end > buffer.length) {
      try {
        chunks.push(zstdDecompressSync(buffer.subarray(cursor)).toString('utf8'))
      } catch { /* unrecoverable remainder */ }
      tornTail = true
      break
    }
    chunks.push(zstdDecompressSync(buffer.subarray(cursor, end)).toString('utf8'))
    cursor = end
  }
  return { chunks, tornTail }
}

/** Storage-row tags produced by the writer's chunk packing (`{tag, seq0, time0, data:{dt[],texts[]}}`). */
export const PACKED_ROW_TAGS = ['text-chunks', 'reasoning-chunks', 'tool-call-chunks'] as const

/** A decoded storage row: either an envelope event or one of the packed rows above. */
export interface RawStorageRow {
  type?: string
  seq?: number
  seq0?: number
  [key: string]: unknown
}

/** Parsed session header line (`{"type":"session",...}`). */
export interface SessionHeader {
  type?: string
  id?: string
  version?: number
  createdAt?: number
  cwd?: string
  parentSession?: string
  seedLength?: number
  origin?: string
  delegationDepth?: number
  [key: string]: unknown
}

export interface ParsedSessionLog {
  header: SessionHeader
  events: RawStorageRow[]
  tornTail: boolean
}

/**
 * Decode one `session.jsonl.zstd` payload. The first decoded line must be the
 * session header at the supported format version; remaining lines are storage
 * rows in log order.
 */
export function parseSessionLog(buffer: Buffer): ParsedSessionLog {
  const { chunks, tornTail } = decodeZstdLog(buffer)
  const lines = chunks.join('').split('\n').filter((line) => line.length > 0)
  if (lines.length === 0) throw new Error('empty log')
  let header: SessionHeader
  try {
    header = JSON.parse(lines[0]) as SessionHeader
  } catch (error) {
    throw new Error(`malformed header line: ${(error as Error).message}`)
  }
  if (header.type !== 'session') throw new Error(`first line is not a session header (${String(header.type)})`)
  if (header.version !== SESSION_FORMAT_VERSION) throw new Error(`unsupported format version ${JSON.stringify(header.version)} (expected ${SESSION_FORMAT_VERSION})`)
  const events: RawStorageRow[] = []
  for (let i = 1; i < lines.length; i++) {
    try {
      events.push(JSON.parse(lines[i]) as RawStorageRow)
    } catch (error) {
      throw new Error(`malformed event line ${i + 1}: ${(error as Error).message}`)
    }
  }
  return { header, events, tornTail }
}

/**
 * Compose one legacy log exactly like the official writer does: frame 1 holds
 * the header line, later frames hold batches of event lines. Used by tests to
 * build fixtures and by docs examples.
 */
export function encodeSessionLog(header: Record<string, unknown>, eventBatches: readonly Record<string, unknown>[][]): Buffer {
  const frames = [zstdCompressSync(JSON.stringify(header) + '\n', { params: { [zlibConstants.ZSTD_c_checksumFlag]: 1 } })]
  for (const batch of eventBatches) {
    frames.push(zstdCompressSync(batch.map((line) => JSON.stringify(line)).join('\n') + '\n', { params: { [zlibConstants.ZSTD_c_checksumFlag]: 1 } }))
  }
  return Buffer.concat(frames)
}
