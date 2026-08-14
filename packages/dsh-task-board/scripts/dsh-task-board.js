#!/usr/bin/env node
'use strict'

/**
 * dsh-task-board — one-command mount/unmount for the task-board GUI plugin.
 *
 * The plugin ships in the official profile-bundle shape: the repo's
 * package.json declares `dsh.bundle.patch` (this repo's cordis.patch.yml)
 * and `dsh.client`; mounting registers it in the web profile manifest
 * (~/.dsh/profiles/web/package.json, dependencies + dsh.profile.bundles)
 * and runs pnpm install in the profile directory. Restarting the dsh web
 * GUI makes the bundle layer load; a page refresh then shows the sidebar
 * entry.
 *
 * mount   : add the profile-manifest dependency + bundle row, pnpm install.
 * unmount : remove both rows, pnpm install — the GUI fully reverts; task
 *           data stays in the browser (localStorage).
 * status  : report the current mount state.
 *
 * Only the profile manifest rows owned by this plugin are touched; other
 * profile rows (skins, git-graph, pet, …) are left alone.
 */

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const HOME = process.env.HOME
const PROFILE_DIR = path.join(HOME, '.dsh', 'profiles', 'web')
const PROFILE_MANIFEST = path.join(PROFILE_DIR, 'package.json')
const PKG = '@linxin666/dsh-client-ui-task-board'
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

function readManifest() {
  return JSON.parse(fs.readFileSync(PROFILE_MANIFEST, 'utf8'))
}

function writeManifest(manifest) {
  fs.writeFileSync(PROFILE_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
}

function checkBuilt() {
  const client = path.join(REPO, 'lib', 'client.js')
  if (!fs.existsSync(client)) {
    console.warn(`[!] ${client} 不存在——请先在仓库里运行 npm run build（构建出 lib/client.js）再挂载。`)
    return false
  }
  return true
}

function ensureProfile() {
  if (!fs.existsSync(PROFILE_MANIFEST)) {
    throw new Error(`web profile manifest 不存在：${PROFILE_MANIFEST}（先运行 dsh web 或 dsh plugin --profile web 初始化）`)
  }
}

function installProfile() {
  execSync('pnpm install', { cwd: PROFILE_DIR, stdio: 'inherit' })
}

function mount() {
  if (!fs.existsSync(path.join(REPO, 'package.json'))) {
    throw new Error(`仓库缺少 package.json：${REPO}`)
  }
  checkBuilt()
  ensureProfile()

  const manifest = readManifest()
  const deps = manifest.dependencies ?? (manifest.dependencies = {})
  const bundles = manifest.dsh?.profile?.bundles ?? (manifest.dsh = { profile: { bundles: [] } }).profile.bundles
  const spec = `link:${REPO}`

  if (deps[PKG] !== undefined) {
    console.log(`[ok] ${PKG} 已在 dependencies（跳过）`)
  } else {
    deps[PKG] = spec
    console.log(`[ok] dependencies += ${PKG}: ${spec}`)
  }
  if (bundles.includes(PKG)) {
    console.log(`[ok] ${PKG} 已在 dsh.profile.bundles（跳过）`)
  } else {
    bundles.push(PKG)
    console.log(`[ok] dsh.profile.bundles += ${PKG}`)
  }
  writeManifest(manifest)
  installProfile()

  console.log('\n完成。重启 dsh web GUI（profile 层变更需要重启加载），刷新页面即可看到侧边栏「任务看板」入口。')
}

function unmount() {
  ensureProfile()
  const manifest = readManifest()
  const deps = manifest.dependencies ?? {}
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const changed = deps[PKG] !== undefined || bundles.includes(PKG)

  if (deps[PKG] !== undefined) {
    delete deps[PKG]
    console.log(`[ok] dependencies -= ${PKG}`)
  } else {
    console.log(`· dependencies 无 ${PKG}（跳过）`)
  }
  const idx = bundles.indexOf(PKG)
  if (idx !== -1) {
    bundles.splice(idx, 1)
    console.log(`[ok] dsh.profile.bundles -= ${PKG}`)
  } else {
    console.log(`· dsh.profile.bundles 无 ${PKG}（跳过）`)
  }
  if (changed) {
    writeManifest(manifest)
    installProfile()
  }

  console.log('\n完成。重启 dsh web GUI 后恢复原状；任务数据保留在浏览器 localStorage（如需清除：浏览器控制台执行 localStorage.removeItem("dsh.taskBoard.v1")）。')
}

function status() {
  ensureProfile()
  const manifest = readManifest()
  const deps = manifest.dependencies ?? {}
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const installed = fs.existsSync(path.join(PROFILE_DIR, 'node_modules', PKG))
  console.log(`插件 id    : ${PKG}`)
  console.log(`仓库       : ${REPO}`)
  console.log(`dependencies: ${deps[PKG] !== undefined ? `已声明 (${deps[PKG]})` : '未声明'}`)
  console.log(`bundles     : ${bundles.includes(PKG) ? '已列入 dsh.profile.bundles' : '未列入'}`)
  console.log(`node_modules: ${installed ? '已安装' : '未安装'} (${path.join(PROFILE_DIR, 'node_modules', PKG)})`)
  console.log(`lib/client.js: ${fs.existsSync(path.join(REPO, 'lib', 'client.js')) ? '已构建' : '未构建'}`)
}

const command = process.argv[2]
if (command === 'mount') mount()
else if (command === 'unmount') unmount()
else if (command === 'status') status()
else {
  console.error('用法: node scripts/dsh-task-board.js <mount|unmount|status>')
  process.exit(1)
}
