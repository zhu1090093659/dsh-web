'use strict';

/**
 * DeepSeek Harness desktop — Electron main process.
 *
 * The app owns one dsh host child process: it seeds $DSH_HOME/profiles/web
 * from the bundled profile when needed, spawns the bundled Node runtime on a
 * dedicated loopback port (never the plain `dsh web` defaults 3080/3081),
 * waits for the GUI, and loads the tokenized URL the host prints. The host is
 * this app's own separate instance — it runs next to any `dsh web` the user
 * starts themselves, and this app owns its full lifecycle (graceful stop on
 * quit, forced after 5s).
 */

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  resolveRuntimePaths,
  resolveDshHome,
  childEnv,
  readStampFile,
  profileAction,
  applyProfileSeed,
  findHostPort,
  waitForGui,
  parseTokenUrlLine,
  ensureProfileFallbacks,
  checkVcRuntime,
  isProgrammaticLaunch,
} = require('./runtime.cjs');

const READY_TIMEOUT_MS = 180000;
const LOG_TAIL_LINES = 200;
/** The host prints its tokenized GUI URL on this stdout line. */

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {import('node:child_process').ChildProcess | null} */
let hostChild = null;
let quitting = false;
let logStream = null;
/** URL printed by the host (with the per-process token), set once seen. */
let tokenUrl = null;
/** Ring buffer of recent host output for the error page. */
const logTail = [];

function resourcesRoot() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'resources');
}

function logFilePath() {
  return path.join(app.getPath('logs'), 'dsh-host.log');
}

function pushLogLine(line) {
  logTail.push(line);
  if (logTail.length > LOG_TAIL_LINES) logTail.shift();
  if (logStream !== null) logStream.write(line + '\n');
  const url = parseTokenUrlLine(line);
  if (url !== undefined) tokenUrl = url;
}

function setStatus(text) {
  if (mainWindow !== null && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop:status', text);
}

function startHost(runtime, home, port) {
  const nodePaths = [
    path.join(runtime.runtimeRoot, 'host', 'node_modules'),
    path.join(home, 'profiles', 'node_modules'),
  ];
  if (process.platform === 'win32' && process.env.APPDATA) {
    const globalNpm = path.join(process.env.APPDATA, 'npm', 'node_modules');
    if (fs.existsSync(globalNpm)) nodePaths.push(globalNpm);
  }
  const args = [runtime.hostBin, 'web', '--no-open', '--host', '127.0.0.1', '--port', String(port)];
  const child = spawn(runtime.nodeBin, args, {
    cwd: home,
    env: childEnv(home, runtime.nodeHome, process.platform, process.env, nodePaths),
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  const onData = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line !== '') pushLogLine(line);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  return child;
}

function stopHost(child) {
  return new Promise((resolvePromise) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolvePromise();
      return;
    }
    const force = setTimeout(() => {
      if (process.platform === 'win32') {
        execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => resolvePromise());
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          try { child.kill('SIGKILL'); } catch { /* already gone */ }
        }
        resolvePromise();
      }
    }, 5000);
    child.once('exit', () => {
      clearTimeout(force);
      resolvePromise();
    });
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(child.pid), '/T'], () => { /* graceful attempt only */ });
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'DeepSeek Harness',
    backgroundColor: '#0b1220',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(url) && !url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  return window;
}

async function showError(message) {
  if (mainWindow === null || mainWindow.isDestroyed()) return;
  await mainWindow.loadFile(path.join(__dirname, 'error.html'));
  mainWindow.webContents.send('desktop:error', {
    message,
    log: logTail.join('\n'),
    logFile: logFilePath(),
  });
}

async function boot() {
  const runtime = resolveRuntimePaths(resourcesRoot(), process.platform, process.arch, app.isPackaged);
  const home = resolveDshHome(process.env, os.homedir());
  pushLogLine('[desktop] dsh home: ' + home);

  if (process.platform === 'win32' && !checkVcRuntime()) {
    pushLogLine('[desktop] warning: Visual C++ runtime (vcruntime140.dll) is missing');
    if (mainWindow !== null && !mainWindow.isDestroyed()) {
      void dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['前往微软官网下载 (Download)', '稍后手动安装 (Later)'],
        defaultId: 0,
        cancelId: 1,
        title: '缺少系统组件 (Prerequisite Missing)',
        message: '检测到当前系统缺少微软 Visual C++ 运行库（vcruntime140.dll）。',
        detail: '没有该运行库，后台 Node 宿主服务可能无法启动。建议立即安装后再使用。',
      }).then((result) => {
        if (result.response === 0) {
          void shell.openExternal('https://aka.ms/vs/17/release/vc_redist.x64.exe');
        }
      });
    }
  }

  if (!fs.existsSync(runtime.nodeBin)) throw new Error('bundled Node runtime is missing: ' + runtime.nodeBin);
  if (!fs.existsSync(runtime.hostBin)) throw new Error('bundled dsh host is missing: ' + runtime.hostBin);

  const stamp = readStampFile(runtime.stampFile);
  const stampText = stamp === undefined ? 'unknown' : [stamp.node, stamp.host, stamp.webAll].join(' / ');
  const profileDir = path.join(home, 'profiles', 'web');
  const action = profileAction(profileDir, stampText);
  if (action !== 'leave') {
    setStatus(action === 'seed' ? 'Installing the bundled web profile…' : 'Updating the bundled web profile…');
    pushLogLine('[desktop] profile action: ' + action + ' (' + stampText + ')');
    applyProfileSeed(runtime.profileSeed, profileDir, action, stampText, { appVersion: app.getVersion() });
  }

  try {
    ensureProfileFallbacks(home, path.join(runtime.runtimeRoot, 'host'));
  } catch (error) {
    pushLogLine('[desktop] fallback healing warning: ' + String(error && error.message ? error.message : error));
  }

  setStatus('Starting the dsh host…');
  const port = await findHostPort();
  pushLogLine('[desktop] spawning the desktop host on 127.0.0.1:' + port
    + ' (the user\u2019s own dsh web defaults 3080/3081 are never taken)');
  hostChild = startHost(runtime, home, port);
  const child = hostChild;
  let exited = false;
  child.once('exit', (code, signal) => {
    exited = true;
    pushLogLine('[desktop] host exited: code=' + String(code) + ' signal=' + String(signal));
    if (!quitting) void showError('The dsh host process stopped unexpectedly.');
  });
  await waitForGui(port, { deadlineMs: READY_TIMEOUT_MS, isAlive: () => !exited });
  // The token URL line can land a moment after the port answers; give it a
  // short grace period before falling back to the bare (401) URL.
  for (let waited = 0; tokenUrl === null && waited < 5000; waited += 250) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  const target = tokenUrl ?? ('http://127.0.0.1:' + port + '/');
  pushLogLine('[desktop] GUI ready, loading ' + (tokenUrl === null ? 'the bare URL (no token line seen)' : 'the tokenized URL'));
  await mainWindow.loadURL(target);
}

async function run() {
  mainWindow = createWindow();
  await mainWindow.loadFile(path.join(__dirname, 'splash.html'));
  try {
    await boot();
  } catch (error) {
    pushLogLine('[desktop] boot failed: ' + String(error && error.message ? error.message : error));
    await showError(String(error && error.message ? error.message : error));
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    // Programmatic spawns of this executable (doctor supervisor and
    // provisioning children, CLI helpers) must never raise the window: they
    // are headless Node children that fail the single-instance lock on
    // purpose, and focusing on every retry is the #1382 popup loop.
    if (isProgrammaticLaunch(argv)) return;
    if (mainWindow !== null) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(run).catch((error) => {
    console.error(error);
    app.quit();
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  if (hostChild !== null) {
    event.preventDefault();
    const child = hostChild;
    hostChild = null;
    void stopHost(child).then(() => app.quit());
  }
});

ipcMain.on('desktop:retry', () => {
  if (quitting) return;
  void run();
});

ipcMain.on('desktop:reveal-log', () => {
  shell.showItemInFolder(logFilePath());
});

ipcMain.on('desktop:quit', () => {
  app.quit();
});

app.whenReady().then(() => {
  try {
    fs.mkdirSync(path.dirname(logFilePath()), { recursive: true });
    logStream = fs.createWriteStream(logFilePath(), { flags: 'a' });
  } catch {
    logStream = null;
  }
});
