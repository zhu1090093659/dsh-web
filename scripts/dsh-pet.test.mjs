/**
 * Tests for scripts/dsh-pet — the pet-center validate/install CLI
 * (issue #623, milestone M2 P6). Fixture-driven; install targets a temporary
 * DSH_HOME so the real user home is never touched.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'dsh-pet')

function tmp() {
  return mkdtempSync(join(tmpdir(), 'dsh-pet-cli-'))
}

function makeSpritePet(dir, manifest = {}) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'pet.json'), JSON.stringify({
    id: 'test-cat', displayName: 'Test Cat', ...manifest,
  }))
  writeFileSync(join(dir, 'spritesheet.webp'), Buffer.from([0x52, 0x49, 0x46, 0x46]))
  return dir
}

function makeLive2dPet(dir, { omitReference = false, unknownGroup = false } = {}) {
  mkdirSync(join(dir, 'motions'), { recursive: true })
  mkdirSync(join(dir, 'tex'), { recursive: true })
  writeFileSync(join(dir, 'pet.json'), JSON.stringify({
    petManifestVersion: 2,
    id: 'test-live',
    displayName: 'Test Live',
    license: 'CC0-1.0',
    renderer: 'live2d',
    live2d: {
      model: 'm.model3.json',
      motions: unknownGroup ? { idle: 'Idle', done: 'NoSuchGroup' } : { idle: 'Idle', done: 'TapBody' },
    },
  }))
  writeFileSync(join(dir, 'm.model3.json'), JSON.stringify({
    Version: 3,
    FileReferences: {
      Moc: 'm.moc3',
      Textures: ['tex/t0.png'],
      Motions: {
        Idle: [{ File: 'motions/idle.motion3.json' }],
        TapBody: [{ File: 'motions/tap.motion3.json' }],
      },
    },
    HitAreas: [{ Id: 'Body', Name: 'Body' }],
  }))
  writeFileSync(join(dir, 'm.moc3'), Buffer.from([1]))
  writeFileSync(join(dir, 'tex', 't0.png'), Buffer.from([2]))
  writeFileSync(join(dir, 'motions', 'idle.motion3.json'), '{}')
  if (!omitReference) writeFileSync(join(dir, 'motions', 'tap.motion3.json'), '{}')
  return dir
}

function run(args, env = {}) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    return {
      code: error.status ?? 1,
      stdout: (error.stdout ?? '').toString(),
      stderr: (error.stderr ?? '').toString(),
    }
  }
}

test('validate accepts a v1 sprite2d pet via compat read', () => {
  const dir = makeSpritePet(join(tmp(), 'cat'))
  const result = run(['validate', dir])
  assert.equal(result.code, 0, result.stderr + result.stdout)
  assert.match(result.stdout, /v1 manifest compat-read/)
  assert.match(result.stdout, /valid: test-cat/)
})

test('validate accepts a complete live2d pet and checks its closure', () => {
  const dir = makeLive2dPet(join(tmp(), 'live'))
  const result = run(['validate', dir])
  assert.equal(result.code, 0, result.stderr + result.stdout)
  assert.match(result.stdout, /renderer live2d/)
})

test('validate rejects a live2d pet with a missing referenced asset', () => {
  const dir = makeLive2dPet(join(tmp(), 'live'), { omitReference: true })
  const result = run(['validate', dir])
  assert.equal(result.code, 1)
  assert.ok((result.stderr + result.stdout).includes('referenced asset missing: motions/tap.motion3.json'))
})

test('validate warns (not fails) on motion groups the model lacks', () => {
  const dir = makeLive2dPet(join(tmp(), 'live'), { unknownGroup: true })
  const result = run(['validate', dir])
  assert.equal(result.code, 0)
  assert.match(result.stdout, /NoSuchGroup/)
})

test('validate rejects a structurally invalid manifest', () => {
  const dir = makeSpritePet(join(tmp(), 'bad'), { petManifestVersion: 2, renderer: 'sprite2d' })
  // missing license + sprite2d block -> fail-closed
  const result = run(['validate', dir])
  assert.equal(result.code, 1)
  assert.match(result.stdout, /license/)
})

test('install copies a valid pet into DSH_HOME/pets and respects --force', () => {
  const home = tmp()
  const dir = makeSpritePet(join(tmp(), 'cat'))
  const first = run(['install', dir], { DSH_HOME: home })
  assert.equal(first.code, 0, first.stderr + first.stdout)
  const installed = join(home, 'pets', 'test-cat')
  assert.ok(existsSync(join(installed, 'pet.json')))
  assert.ok(existsSync(join(installed, 'spritesheet.webp')))
  const second = run(['install', dir], { DSH_HOME: home })
  assert.equal(second.code, 1)
  assert.match(second.stderr, /--force/)
  const forced = run(['install', dir, '--force'], { DSH_HOME: home })
  assert.equal(forced.code, 0, forced.stderr + forced.stdout)
})

test('install refuses an invalid pet and writes nothing', () => {
  const home = tmp()
  const dir = makeSpritePet(join(tmp(), 'bad'), { petManifestVersion: 2, renderer: 'sprite2d' })
  const result = run(['install', dir], { DSH_HOME: home })
  assert.equal(result.code, 1)
  assert.ok(!existsSync(join(home, 'pets')))
})

test('usage errors exit 2 with guidance', () => {
  assert.equal(run([]).code, 2)
  assert.equal(run(['validate']).code, 2)
  assert.equal(run(['bogus', 'x']).code, 2)
})

test('validate accepts a voice.json and warns on content issues (M4, #677)', () => {
  const dir = makeSpritePet(join(tmp(), 'voiced'))
  writeFileSync(join(dir, 'voice.json'), JSON.stringify({
    status: { done: ['自定义完工'], bogusScene: ['x'] },
    panel: { labels: { feed: '投喂' }, actions: ['feed', 'bogus'] },
  }))
  const result = run(['validate', dir])
  assert.equal(result.code, 0, result.stderr + result.stdout)
  assert.match(result.stdout, /unknown status scene bogusScene/)
  assert.match(result.stdout, /unknown panel action dropped: bogus/)
})

test('validate rejects a voice.json that is not valid JSON (M4, #677)', () => {
  const dir = makeSpritePet(join(tmp(), 'broken-voice'))
  writeFileSync(join(dir, 'voice.json'), '{ nope')
  const result = run(['validate', dir])
  assert.equal(result.code, 1)
  assert.ok((result.stderr + result.stdout).includes('voice.json is not valid JSON'))
})

test('validate rejects a voice.json whose root is not an object (M4, #677)', () => {
  const dir = makeSpritePet(join(tmp(), 'array-voice'))
  writeFileSync(join(dir, 'voice.json'), JSON.stringify([1, 2]))
  const result = run(['validate', dir])
  assert.equal(result.code, 1)
  assert.ok((result.stderr + result.stdout).includes('voice.json must be a JSON object'))
})

test('install copies voice.json into DSH_HOME/pets (M4, #677)', () => {
  const dir = makeSpritePet(join(tmp(), 'voiced-install'))
  writeFileSync(join(dir, 'voice.json'), JSON.stringify({ status: { done: ['装好的'] } }))
  const home = tmp()
  const result = run(['install', dir], { DSH_HOME: home })
  assert.equal(result.code, 0, result.stderr + result.stdout)
  assert.ok(existsSync(join(home, 'pets', 'test-cat', 'voice.json')))
})
