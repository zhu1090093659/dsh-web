/**
 * Retry and payload contract for scripts/deploy-market.
 *
 * The Deploy Market lane went red on Cloudflare API throttling: the CLI only
 * backs off when the 429 carries a Retry-After header, so the script itself has
 * to retry transient failures and keep every other failure on the fail-fast
 * path. The CLI turns a false "ok" into fail(), which prints the message and
 * exits 1, so these tests drive the policy through an injected attempt list and
 * an injected wait: no child process, no network, no clock.
 *
 * The secret bindings ride a 0600 file (cf workers secrets update --type
 * secret_text --text @path) instead of stdin, while every failure line prints
 * cmd + args, so the
 * payload tests below pin both halves: the value reaches the child, and the
 * value never reaches the log.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  MAX_ATTEMPTS,
  RETRY_BACKOFF_MS,
  TAIL_LINES,
  classifyTransientFailure,
  createTail,
  failureMessage,
  rayIdFrom,
  retryDelayMs,
  runWithRetries,
  secretNamesFrom,
  secretUpdateArgs,
  spawnAttempt,
  withSecretFile,
} = require('./deploy-market')

/** The exact text the failing Deploy Market runs stopped on. */
const THROTTLED = 'Received a malformed response from the API - GET /accounts/***/workers/services/dsh-market -> 429 Too Many Requests'

/** What cf prints for the same throttle: the API error names the status. */
const CF_THROTTLED = 'Status code: 429'

const CF = 'cf'
const DEPLOY_ARGS = ['deploy']

/**
 * Drive the retry policy over a planned child history: each entry is the
 * { status, tail } one attempt would produce, and the last entry repeats once
 * the policy asks for more runs than the plan holds. The recording wait and
 * retry callbacks stand in for the clock and the job log.
 */
async function runPlan(entries, overrides) {
  const runs = []
  const waits = []
  const retries = []
  const runAttempt = async () => {
    const entry = entries[Math.min(runs.length, entries.length - 1)]
    runs.push(entry)
    return entry
  }
  const wait = async (ms) => { waits.push(ms) }
  const onRetry = (info) => { retries.push(info) }
  const result = await runWithRetries(runAttempt, Object.assign({ wait, onRetry }, overrides))
  return { result, runs, waits, retries }
}

test('the retry schedule pauses 5s, 20s, then 60s and stops with the attempt cap', () => {
  // Given the documented budget of four runs per cf invocation
  assert.equal(MAX_ATTEMPTS, 4)
  assert.deepEqual(RETRY_BACKOFF_MS, [5000, 20000, 60000])
  // When each failed attempt asks for the pause before the next one
  // Then the schedule is spent by attempt three and attempt four waits for nothing
  assert.deepEqual([1, 2, 3, 4].map((attempt) => retryDelayMs(attempt)), [5000, 20000, 60000, null])
})

test('a throttled cf call that clears on the next attempt ends with status 0 and logs the retry', async () => {
  // Given the 429 cf prints, without a Retry-After header, and success on the second run
  const { result, runs, waits, retries } = await runPlan([
    { status: 1, tail: CF_THROTTLED },
    { status: 0, tail: 'Uploaded dsh-market (3.21 sec)' },
  ])
  // When the deploy runs the command
  // Then it ends with exit status 0 after one retry, and the retry is visible to the operator
  assert.equal(result.ok, true)
  assert.equal(result.status, 0)
  assert.equal(result.attempts, 2)
  assert.equal(runs.length, 2)
  assert.deepEqual(waits, [5000])
  assert.deepEqual(retries, [{ attempt: 1, attempts: 4, reason: 'http-429', pauseMs: 5000 }])
})

test('a malformed API response that clears on the next attempt ends with status 0 and logs the retry', async () => {
  // Given the CLI reported an unparsable API response on the first run
  const { result, runs, waits, retries } = await runPlan([
    { status: 1, tail: 'Received a malformed response from the API - GET /accounts/***/workers/services/dsh-market' },
    { status: 0, tail: 'Deployed dsh-market triggers' },
  ])
  // When the deploy runs the command
  // Then the same single retry carries it to exit status 0
  assert.equal(result.ok, true)
  assert.equal(result.status, 0)
  assert.equal(runs.length, 2)
  assert.deepEqual(waits, [5000])
  assert.equal(retries[0].reason, 'malformed-api-response')
})

test('a Node network failure that clears on the next attempt ends with status 0 and logs the retry', async () => {
  // Given the tail measured on a real deploy: cf's error box printing undici's
  // "fetch failed" with no cause, no status and no Ray ID
  const fetchFailed = [
    '┌ Error',
    '│ fetch failed',
    '└',
    'deploy-market: cf d1 migrations apply 95f4e8ae-444a-46d0-98be-c367a9dbe6e8 --dir migrations failed (exit 1)',
  ].join(String.fromCharCode(10))
  const { result, runs, waits, retries } = await runPlan([
    { status: 1, tail: fetchFailed },
    { status: 0, tail: 'Applied 1 migration' },
  ])
  // When the deploy runs the command
  // Then the network blip is retried instead of ending the lane on the first run
  assert.equal(result.ok, true)
  assert.equal(result.status, 0)
  assert.equal(runs.length, 2)
  assert.deepEqual(waits, [5000])
  assert.deepEqual(retries, [{ attempt: 1, attempts: 4, reason: 'socket-error', pauseMs: 5000 }])
})

test('an exhausted retry budget fails with the captured evidence and the Cloudflare Ray ID', async () => {
  // Given every run is throttled and Cloudflare printed its Ray ID in the body
  const throttledTail = [
    'Status code: 429',
    'Body: {"success":false,"errors":[],"messages":[],"ray_id":"8a1b2c3d4e5f6789"}',
  ].join(String.fromCharCode(10))
  const { result, runs, waits } = await runPlan([{ status: 1, tail: throttledTail }])
  // When the budget runs out
  // Then the command is reported failed after the fourth run, with no pause left to spend
  assert.equal(result.ok, false)
  assert.equal(result.status, 1)
  assert.equal(result.reason, 'http-429')
  assert.equal(runs.length, 4)
  assert.deepEqual(waits, [5000, 20000, 60000])
  // And the failure message quotes the attempt count, the evidence, and the Ray ID
  const message = failureMessage(CF, DEPLOY_ARGS, result)
  assert.match(message, /^cf deploy failed \(exit 1\)/)
  assert.match(message, /still transient \(http-429\) after 4 attempts/)
  assert.match(message, /Status code: 429/)
  assert.match(message, /ray_id/)
  assert.equal(message.split('8a1b2c3d4e5f6789').length - 1, 2)
  assert.match(message, /captured output tail \(at most 200 lines\):/)
})

test('a non-transient failure is attempted exactly once and keeps the fail-fast message', async () => {
  // Given cf rejected the token, which no retry can fix
  const authFailure = [
    'Status code: 401',
    'Body: {"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}',
  ].join(String.fromCharCode(10))
  const { result, runs, waits, retries } = await runPlan([{ status: 1, tail: authFailure }])
  // When the deploy runs the command
  // Then it fails on the first run without pausing for a retry
  assert.equal(result.ok, false)
  assert.equal(result.status, 1)
  assert.equal(result.attempts, 1)
  assert.equal(result.reason, null)
  assert.equal(runs.length, 1)
  assert.deepEqual(waits, [])
  assert.deepEqual(retries, [])
  // And the message is byte-identical to the one the lane printed before the retry existed
  assert.equal(failureMessage(CF, DEPLOY_ARGS, result), 'cf deploy failed (exit 1)')
})

test('the transient classifier recognizes throttling, server errors, malformed responses and socket failures', () => {
  // Given the failure texts the CLI prints for a transient API condition
  const transient = [
    [CF_THROTTLED, 'http-429'],
    [THROTTLED, 'http-429'],
    ['GET /accounts/abc/workers/services/dsh-market -> 429 Too Many Requests', 'http-429'],
    // The lines cf's typed Workers commands print: status text, then the
    // request path. All four were measured against the real CLI.
    ['429 Too Many Requests · HTTP /accounts/000/workers/scripts/dsh-market/secrets', 'http-429'],
    ['503 Service Unavailable · HTTP /accounts/000/workers/scripts/dsh-market/secrets', 'http-5xx'],
    ['502 Bad Gateway · HTTP /accounts/000/workers/scripts/dsh-market/secrets', 'http-5xx'],
    ['500 Internal Server Error · HTTP /accounts/000/workers/scripts/dsh-market/secrets', 'http-5xx'],
    // A status the renderer's text table does not map has an empty text and no
    // trim, so the separator follows two spaces - 522 is the one with an
    // incident on record here.
    ['522  · HTTP /accounts/000/d1/database/95f4e8ae/query', 'http-5xx'],
    // A tail carrying both statuses reports the reason that retries first.
    [['503 Service Unavailable · HTTP /accounts/000/workers/scripts/dsh-market/secrets',
      '429 Too Many Requests · HTTP /accounts/000/workers/scripts/dsh-market/secrets'].join(String.fromCharCode(10)), 'http-429'],
    ['Status code: 503', 'http-5xx'],
    ['HTTP 503 Service Unavailable', 'http-5xx'],
    ['status: 500', 'http-5xx'],
    ['statusCode: 502', 'http-5xx'],
    ['statusCode: 522', 'http-5xx'],
    ['request failed -> 522 Connection timed out', 'http-5xx'],
    ['Received a malformed response from the API - unexpected end of JSON input', 'malformed-api-response'],
    ['read ECONNRESET', 'socket-error'],
    ['connect ETIMEDOUT 104.16.0.1:443', 'socket-error'],
    ['write EPIPE', 'socket-error'],
    ['Error: socket hang up', 'socket-error'],
    // Node's network layer in its own wording: undici's message as cf prints it
    // inside the error box, and the node-fetch spelling of the same failure.
    ['fetch failed', 'socket-error'],
    ['FetchError: request to https://api.cloudflare.com/client/v4/accounts/000/d1/database/95f4e8ae/query failed', 'socket-error'],
  ]
  // When each text is classified
  // Then every one of them names the condition worth another attempt
  for (const [text, reason] of transient) {
    assert.equal(classifyTransientFailure(text), reason, text)
  }
})

test('the transient classifier leaves auth, config, and content failures to fail fast', () => {
  // Given failures that another attempt cannot change
  const failFast = [
    'Status code: 401',
    'Status code: 404',
    'Authentication error [code: 10000]',
    'You are not authorized to access this resource',
    'Missing entry-point to Worker script or to assets directory',
    'workers.api.error.duplicate [code: 10504]',
    'Deploy failed: invalid value for "assets.directory"',
    'The D1 database 1b2c3d4e5f6a was not found in account abc',
    'Uploaded 1500 assets (500 new)',
    // "500" and "5xx" in ordinary output stay out: the cf branch needs its separator.
    'Uploaded 1500 assets (500 KiB) in 3.21 sec',
    'edge returned 5xx for 12 requests',
    '503 Service Unavailable on /accounts/000/workers/scripts/dsh-market/secrets',
    // A number and the separator alone are not a status: the leading code must
    // be a 5xx for the cf branch to fire.
    '1500 assets · HTTP smoke',
    'edge returned 5xx · HTTP smoke',
    'at Object.<anonymous> (/app/node_modules/wrangler/wrangler-dist/cli.js:500:12)',
    // The Node network-layer branch must not widen into the word "failed": a
    // rejected upload and a config that never parsed both end the deploy
    // whatever the attempt count.
    'upload failed: 400 bad request',
    'config validation failed',
  ]
  // When each text is classified
  // Then none of them is treated as transient
  for (const text of failFast) {
    assert.equal(classifyTransientFailure(text), null, text)
  }
})

test('a smaller injected attempt budget spends only the pauses it still has', async () => {
  // Given a budget of two runs that both fail transiently
  const { result, runs, waits } = await runPlan([{ status: 1, tail: CF_THROTTLED }], { attempts: 2 })
  // When the policy runs out of attempts
  // Then it stops after the second run with the single pause it was entitled to
  assert.equal(result.ok, false)
  assert.equal(result.attempts, 2)
  assert.equal(runs.length, 2)
  assert.deepEqual(waits, [5000])
})

test('the captured tail keeps the last lines and drops the earlier ones', () => {
  // Given more output lines than the evidence bound allows
  const printed = []
  for (let i = 1; i <= TAIL_LINES + 5; i++) printed.push('line ' + i)
  // When the run finishes
  const tail = createTail()
  tail.chunk(printed.join(String.fromCharCode(10)) + String.fromCharCode(10))
  const kept = tail.flush().split(String.fromCharCode(10))
  // Then exactly the tail is kept, starting at the first line inside the bound
  assert.equal(kept.length, TAIL_LINES)
  assert.equal(kept[0], 'line 6')
  assert.equal(kept[kept.length - 1], 'line ' + (TAIL_LINES + 5))
})

test('a line split across two chunks stays one captured line', () => {
  // Given a child whose output arrives in the middle of a line
  const tail = createTail(3)
  tail.chunk('alpha' + String.fromCharCode(10) + 'be')
  tail.chunk('ta' + String.fromCharCode(10) + 'gamma')
  // When the run finishes
  // Then the split line is reassembled instead of quoted twice
  assert.deepEqual(tail.flush().split(String.fromCharCode(10)), ['alpha', 'beta', 'gamma'])
})

test('the Ray ID is read from each shape Cloudflare prints it in', () => {
  // Given the header, JSON and console shapes of the same Ray ID
  const shapes = [
    'X [ERROR] A request to the Cloudflare API (/accounts/abc/workers/services/dsh-market) failed.' + String.fromCharCode(10) + '  Ray ID: 8a1b2c3d4e5f6789',
    '{"success":false,"errors":[],"messages":[],"ray_id":"8a1b2c3d4e5f6789"}',
    'cf-ray: 8a1b2c3d4e5f6789-SJC',
  ]
  // When each shape is read
  // Then the Ray ID comes out of every one of them
  for (const text of shapes) {
    assert.match(rayIdFrom(text), /^8a1b2c3d4e5f6789/)
  }
  // And a text without a Ray ID yields nothing to quote
  assert.equal(rayIdFrom('workers api returned an unknown error'), null)
})

/** One captured child run that prints exactly this text, driven the way the deploy drives cf. */
function capturedRun(text) {
  return runWithRetries(
    () => spawnAttempt(process.execPath, ['-e', 'process.stdout.write(' + JSON.stringify(text) + ')'], undefined, { capture: true }),
    { wait: async () => {} },
  )
}

test('a captured run exposes the whole output, not just the tail', async () => {
  // Given a captured child that prints more lines than the evidence bound keeps
  const lines = TAIL_LINES + 25
  const script = 'for (let i = 1; i <= ' + String(lines) + '; i++) process.stdout.write("line-" + String(i) + "\\n")'
  const result = await runWithRetries(
    () => spawnAttempt(process.execPath, ['-e', script], undefined, { capture: true }),
    { wait: async () => {} },
  )

  // When the finished run is inspected
  // Then the output is complete -- it is what the binding check parses -- while
  //      the tail stays the bounded buffer the failure evidence reads
  assert.equal(result.ok, true)
  assert.equal(result.status, 0)
  assert.equal(result.output.split(String.fromCharCode(10)).length - 1, lines, 'every line the child printed is in the output')
  assert.equal(result.output.split(String.fromCharCode(10))[0], 'line-1', 'the output starts where the child started')
  assert.equal(result.tail.split(String.fromCharCode(10)).length, TAIL_LINES, 'the tail keeps its line bound')
  assert.equal(result.tail.split(String.fromCharCode(10))[0], 'line-' + String(lines - TAIL_LINES + 1), 'and it dropped exactly the oldest lines')
})

test('the binding check fails on an empty list and passes on a list that carries the name', async () => {
  // Given the two captured `cf workers secrets list` answers, driven through the
  //       same runner and the same parse the deploy's binding check uses
  const empty = await capturedRun('{"success":true,"errors":[],"result":[]}')
  const carrying = await capturedRun(JSON.stringify({ result: [{ name: 'TURNSTILE_SECRET' }, { name: 'ASSET_ATTEST_SECRET' }] }))

  // When each one is asked for the binding
  const emptyNames = secretNamesFrom(empty.output)
  const carryingNames = secretNamesFrom(carrying.output)

  // Then the empty list fails on its own parse -- the captured output arrived
  //      whole, it simply carries no name -- and a list with the name passes
  assert.equal(empty.output, '{"success":true,"errors":[],"result":[]}', 'the captured run kept its whole output')
  assert.equal(emptyNames, empty.output, 'an empty list yields no name: the text fallback is the raw answer')
  assert.equal(emptyNames.includes('TURNSTILE_SECRET'), false, 'so the binding check fails, as it must')
  assert.equal(carryingNames.includes('TURNSTILE_SECRET'), true, 'a binding present in the list passes')
  assert.equal(carryingNames.includes('ASSET_ATTEST_SECRET'), true)
  // And a dropped output reads as missing rather than as present, which is the
  // fail-closed direction this check exists for -- and why the passing case
  // above is what catches a run that stops carrying its output
  assert.equal(secretNamesFrom(undefined).includes('TURNSTILE_SECRET'), false)
})

test('the child runner relays a real command and reports its exit status with the captured tail', async () => {
  // Given a command that writes to both streams and exits non-zero
  const script = 'console.log("stdout marker"); console.error("stderr marker"); process.exit(3)'
  // When the runner executes it in capture mode
  const result = await spawnAttempt(process.execPath, ['-e', script], undefined, { capture: true })
  // Then the status travels back and both streams land in the captured output and the tail
  assert.equal(result.status, 3)
  assert.match(result.output, /stdout marker/)
  assert.match(result.output, /stderr marker/)
  assert.match(result.tail, /stderr marker/)
})

test('the child runner carries the secret payload in a 0600 file that the run removes', async () => {
  // Given a command that reads the file its @path argument names
  const secret = 'turnstile-secret-value'
  const script = 'const fs=require("node:fs");const file=process.argv[1].slice(1);const mode=fs.statSync(file).mode&0o777;process.stdout.write("mode:"+mode.toString(8)+" read:"+fs.readFileSync(file,"utf8"))'
  let staged = null
  // When the runner stages the value and runs that command
  const result = await withSecretFile(secret, (file) => {
    staged = file
    return spawnAttempt(process.execPath, ['-e', script, '@' + file], undefined, { capture: true })
  })
  // Then the child read the exact value from a file only its owner can read
  assert.equal(result.status, 0)
  assert.match(result.output, /mode:600 read:turnstile-secret-value/)
  // And nothing is left on disk afterwards
  assert.equal(fs.existsSync(staged), false)
})

test('a staged secret is removed even when the process exits through the failure path', () => {
  // Given a child that stages a value and then exits the way fail() does
  const script = 'const { withSecretFile } = require(process.argv[1]);' +
    'withSecretFile("turnstile-secret-value", (file) => { process.stdout.write(file); process.exit(1) })'
  // When it exits
  const child = spawnSync(process.execPath, ['-e', script, require.resolve('./deploy-market')], { encoding: 'utf8' })
  // Then the exit hook removed the staged value instead of leaving it behind
  assert.equal(child.status, 1)
  assert.match(child.stdout, /deploy-market-[^/]*.secret$/)
  assert.equal(fs.existsSync(child.stdout), false)
})

test('a failed invocation leaves no staged secret behind', async () => {
  // Given a run whose upload throws
  let staged = null
  await assert.rejects(
    withSecretFile('turnstile-secret-value', (file) => { staged = file; throw new Error('upload failed') }),
    /upload failed/,
  )
  // Then the staged value is gone
  assert.equal(fs.existsSync(staged), false)
})

test('the secret upload argv carries the binding type cf requires without a TTY', () => {
  // Given a staged secret file
  const args = secretUpdateArgs('TURNSTILE_SECRET', '/tmp/deploy-market-probe/secret')
  // When the command line is built
  // Then it is the canonical cf form, --type included
  assert.deepEqual(args, [
    'workers', 'secrets', 'update', 'TURNSTILE_SECRET',
    '--worker', 'dsh-market',
    '--type', 'secret_text',
    '--text', '@/tmp/deploy-market-probe/secret',
  ])
})

test('the secret upload logs the file reference and never the value', async () => {
  // Given a secret that must not reach the job log
  const secret = 'turnstile-value-must-not-be-logged'
  let logged = ''
  // When the upload fails after the retry budget is spent
  await withSecretFile(secret, (file) => {
    const args = secretUpdateArgs('TURNSTILE_SECRET', file)
    // The retry line and the failure message both print cmd + args
    assert.equal(args.join(' ').includes(secret), false)
    logged = failureMessage(CF, args, { status: 1, attempts: MAX_ATTEMPTS, reason: 'http-429', tail: CF_THROTTLED })
  })
  // Then the evidence names the file, not the value
  assert.equal(logged.includes(secret), false)
  assert.match(logged, /^cf workers secrets update TURNSTILE_SECRET --worker dsh-market --type secret_text --text @/)
  assert.match(logged, /still transient \(http-429\) after 4 attempts/)
})

test('the secret listing is read from cf JSON in either envelope, with a text fallback', () => {
  // Given the API envelope cf prints, a bare result array, and a plain listing
  const envelope = JSON.stringify({
    success: true,
    errors: [],
    messages: [],
    result: [
      { name: 'TURNSTILE_SECRET', type: 'secret_text' },
      { name: 'ASSET_ATTEST_SECRET', type: 'secret_text' },
    ],
  })
  const bare = JSON.stringify([{ name: 'TURNSTILE_SECRET', type: 'secret_text' }])
  const text = 'TURNSTILE_SECRET' + String.fromCharCode(10) + 'ASSET_ATTEST_SECRET'
  // When each shape is read
  // Then every one of them names the bindings it lists
  assert.match(secretNamesFrom(envelope), /TURNSTILE_SECRET/)
  assert.match(secretNamesFrom(envelope), /ASSET_ATTEST_SECRET/)
  assert.match(secretNamesFrom(bare), /TURNSTILE_SECRET/)
  assert.match(secretNamesFrom(text), /TURNSTILE_SECRET/)
  // And a listing that names nothing cannot satisfy the fail-closed gate
  assert.equal(secretNamesFrom('{"success":true,"errors":[],"result":[]}').includes('TURNSTILE_SECRET'), false)
})
