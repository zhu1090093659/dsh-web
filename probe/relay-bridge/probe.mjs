#!/usr/bin/env node
/**
 * Desktop measurement card for the relay-bridge probe.
 *
 * Same caliber as the phone's log lines: dial is the WebSocket open, hello is one
 * request round trip, and the request median is taken over real protocol calls.
 * Also reads the connector's own streaming endpoint to check that a chunked
 * response really arrives chunk by chunk through the Durable Object.
 *
 * Usage: node probe.mjs wss://<name>.1090093659.workers.dev
 */

const SAMPLE_COUNT = Number(process.env.PROBE_N ?? '5');
const CALL_TIMEOUT_MS = 60000;

const rawOrigin = process.argv[2] ?? process.env.PROBE_ORIGIN ?? '';
if (rawOrigin === '') {
  console.error('usage: node probe.mjs wss://<host>');
  process.exit(2);
}
const trimmed = rawOrigin.replace(/\/+$/, '');
const httpOrigin = trimmed.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
const wsUrl = httpOrigin.replace(/^http/, 'ws') + '/ios/v1';

const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};
const round = (value) => (value === null ? null : Math.round(value * 10) / 10);

async function readStream() {
  const startedAt = performance.now();
  const response = await fetch(httpOrigin + '/_probe/stream');
  const arrivals = [];
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    arrivals.push({ atMs: Math.round(performance.now() - startedAt), bytes: value?.byteLength ?? 0 });
  }
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    arrivals,
  };
}

function readFrame(event, pending) {
  const data = event.data;
  if (typeof data !== 'string') return;
  let frame;
  try {
    frame = JSON.parse(data);
  } catch {
    return;
  }
  if (frame.t !== 'res') return;
  const entry = pending.get(frame.id);
  if (entry === undefined) return;
  pending.delete(frame.id);
  clearTimeout(entry.timer);
  entry.resolve(frame);
}

async function dial() {
  const pending = new Map();
  let nextId = 0;
  const startedAt = performance.now();
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('websocket failed to open')), { once: true });
  });
  const dialMs = performance.now() - startedAt;
  ws.addEventListener('message', (event) => readFrame(event, pending));
  const call = (method, payload) => {
    const id = ++nextId;
    const sentAt = performance.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(method + ' timed out'));
      }, CALL_TIMEOUT_MS);
      pending.set(id, { resolve: (frame) => resolve({ frame, rttMs: performance.now() - sentAt }), timer });
      ws.send(JSON.stringify({ t: 'req', id, m: method, p: payload }));
    });
  };
  return { ws, dialMs, call };
}

const card = { origin: httpOrigin, wsUrl };

try {
  card.stream = await readStream();
} catch (error) {
  card.stream = { error: String(error?.message ?? error) };
}

const link = await dial();
card.dialMs = round(link.dialMs);
const hello = await link.call('hello', { proto: 1, minor: 0, client: 'relay-bridge-probe', cap: [] });
card.helloMs = round(hello.rttMs);
card.helloAuth = hello.frame.r?.auth ?? hello.frame.e?.code ?? 'unknown';
card.helloServer = hello.frame.r?.server ?? 'unknown';

const samples = [];
for (let index = 0; index < SAMPLE_COUNT; index += 1) {
  const titles = await link.call('session.titles', { ids: [] });
  samples.push({ rttMs: round(titles.rttMs), ok: titles.frame.ok === true });
}
card.titleRtts = samples.map((row) => row.rttMs);
card.titleMedianMs = round(median(card.titleRtts));
card.titleAllOk = samples.every((row) => row.ok);
link.ws.close();

process.stdout.write(JSON.stringify(card, null, 2) + '\n');
