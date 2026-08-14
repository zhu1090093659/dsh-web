/**
 * T3 — mechanism characterization test.
 *
 * Proves, with the REAL @deepseek-ai/cordis and
 * @deepseek-ai/cordis-plugin-loader, the exact mechanism dsh-multi-pet relies
 * on:
 *   1. two entries both providing a Cordis `pet` service collide on the root
 *      realm (this is the C0 baseline failure), and
 *   2. adding an entry-local isolate (`isolate: { pet: true }`) to one entry
 *      lets both providers coexist, each resolving its own implementation.
 *
 * The loader is mounted the same way DSH boots it (`await ctx.plugin(Loader)`
 * then `ctx.get("loader")`, see dsh-app-boot's `boot()`).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { Loader } from '@deepseek-ai/cordis-plugin-loader'

const BASE_URL = new URL('./fixtures/', import.meta.url).href

async function makeLoader() {
  const ctx = new Context()
  ctx.baseUrl = BASE_URL
  await ctx.plugin(Loader)
  return { ctx, loader: ctx.get('loader') }
}

async function cleanup(ctx) {
  try {
    await ctx.fiber.dispose()
  } catch {
    // best-effort teardown; the test verdict is decided above
  }
}

test('baseline: two `pet` providers without isolation fail to coexist', async () => {
  const { ctx, loader } = await makeLoader()
  try {
    await loader.create({ id: 'pet-a', name: './provide-pet.mjs' })
    await assert.rejects(
      loader.create({ id: 'pet-b', name: './provide-pet.mjs' }),
      /has been registered/,
      'the second provider must hit the duplicate-service error',
    )
  } finally {
    await cleanup(ctx)
  }
})

test('entry-local isolate: two `pet` providers coexist and resolve separately', async () => {
  const { ctx, loader } = await makeLoader()
  try {
    await loader.create({ id: 'pet-a', name: './provide-pet.mjs', config: { tag: 'A' }, isolate: { pet: true } })
    await loader.create({ id: 'pet-b', name: './provide-pet.mjs', config: { tag: 'B' } })

    const entryA = loader.resolve('pet-a')
    const rootSymbol = ctx[Context.isolate].pet
    const localSymbol = entryA.ctx[Context.isolate].pet

    assert.ok(rootSymbol, 'root realm symbol exists')
    assert.ok(localSymbol, 'entry-local realm symbol exists')
    assert.notEqual(localSymbol, rootSymbol, 'the two pet services must live in different symbol realms')

    const rootImpl = ctx.reflect.store[rootSymbol]
    const localImpl = ctx.reflect.store[localSymbol]
    assert.ok(rootImpl, 'root `pet` implementation exists')
    assert.ok(localImpl, 'isolated `pet` implementation exists')
    assert.notEqual(localImpl, rootImpl, 'the two implementations must be distinct instances')
    assert.equal(rootImpl.value.tag, 'B')
    assert.equal(localImpl.value.tag, 'A')
  } finally {
    await cleanup(ctx)
  }
})
