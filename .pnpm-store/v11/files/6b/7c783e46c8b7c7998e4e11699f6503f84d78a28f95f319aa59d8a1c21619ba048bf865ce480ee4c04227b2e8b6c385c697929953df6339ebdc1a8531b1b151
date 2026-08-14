"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// packages/playwright/src/worker/workerProcessEntry.ts
var import_common4 = require("../common");

// packages/playwright/src/worker/workerMain.ts
var import_common3 = require("../common");
var globals = __toESM(require("../globals"));
var import_expect = require("../matchers/expect");

// packages/playwright/src/util.ts
var import_fs = __toESM(require("fs"));
var import_path = __toESM(require("path"));
var import_util = __toESM(require("util"));
var debug = require("playwright-core/lib/utilsBundle").debug;
var mime = require("playwright-core/lib/utilsBundle").mime;
var { minimatch } = require("playwright-core/lib/utilsBundle");
var { calculateSha1 } = require("playwright-core/lib/coreBundle").utils;
var { sanitizeForFilePath } = require("playwright-core/lib/coreBundle").utils;
var { isRegExp } = require("playwright-core/lib/coreBundle").iso;
var { stringifyStackFrames, filteredStackTrace } = require("playwright-core/lib/coreBundle").utils;
var { ansiRegex, isString, stripAnsiEscapes } = require("playwright-core/lib/coreBundle").iso;
function filterStackTrace(e) {
  const name = e.name ? e.name + ": " : "";
  const cause = e.cause instanceof Error ? filterStackTrace(e.cause) : void 0;
  if (process.env.PWDEBUGIMPL)
    return { message: name + e.message, stack: e.stack || "", cause };
  const stackLines = stringifyStackFrames(filteredStackTrace(e.stack?.split("\n") || []));
  return {
    message: name + e.message,
    stack: `${name}${e.message}${stackLines.map((line) => "\n" + line).join("")}`,
    cause
  };
}
function serializeError(error) {
  if (error instanceof Error)
    return filterStackTrace(error);
  return {
    value: import_util.default.inspect(error)
  };
}
function relativeFilePath(file) {
  if (!import_path.default.isAbsolute(file))
    return file;
  return import_path.default.relative(process.cwd(), file);
}
function formatLocation(location) {
  return relativeFilePath(location.file) + ":" + location.line + ":" + location.column;
}
var windowsFilesystemFriendlyLength = 60;
function addSuffixToFilePath(filePath, suffix) {
  const ext = import_path.default.extname(filePath);
  const base = filePath.substring(0, filePath.length - ext.length);
  return base + suffix + ext;
}
function sanitizeFilePathBeforeExtension(filePath, ext) {
  ext ??= import_path.default.extname(filePath);
  const base = filePath.substring(0, filePath.length - ext.length);
  return sanitizeForFilePath(base) + ext;
}
function getContainedPath(parentPath, subPath = "") {
  const resolvedPath = import_path.default.resolve(parentPath, subPath);
  if (resolvedPath === parentPath || resolvedPath.startsWith(parentPath + import_path.default.sep))
    return resolvedPath;
  return null;
}
var debugTest = debug("pw:test");
async function normalizeAndSaveAttachment(outputPath, name, options = {}) {
  if (options.path === void 0 && options.body === void 0)
    return { name, contentType: "text/plain" };
  if ((options.path !== void 0 ? 1 : 0) + (options.body !== void 0 ? 1 : 0) !== 1)
    throw new Error(`Exactly one of "path" and "body" must be specified`);
  if (options.path !== void 0) {
    const hash = calculateSha1(options.path);
    if (!isString(name))
      throw new Error('"name" should be string.');
    const sanitizedNamePrefix = sanitizeForFilePath(name) + "-";
    const dest = import_path.default.join(outputPath, "attachments", sanitizedNamePrefix + hash + import_path.default.extname(options.path));
    await import_fs.default.promises.mkdir(import_path.default.dirname(dest), { recursive: true });
    await import_fs.default.promises.copyFile(options.path, dest);
    const contentType = options.contentType ?? (mime.getType(import_path.default.basename(options.path)) || "application/octet-stream");
    return { name, contentType, path: dest };
  } else {
    const contentType = options.contentType ?? (typeof options.body === "string" ? "text/plain" : "application/octet-stream");
    return { name, contentType, body: typeof options.body === "string" ? Buffer.from(options.body) : options.body };
  }
}

// packages/playwright/src/worker/fixtureRunner.ts
var import_common = require("../common");
var { ManualPromise } = require("playwright-core/lib/coreBundle").iso;
var { escapeWithQuotes } = require("playwright-core/lib/coreBundle").iso;
var { filterStackFile } = require("playwright-core/lib/coreBundle").utils;
var Fixture = class {
  constructor(runner, registration) {
    this.failed = false;
    this._deps = /* @__PURE__ */ new Set();
    this._usages = /* @__PURE__ */ new Set();
    this.runner = runner;
    this.registration = registration;
    this.value = null;
    const isUserFixture = this.registration.location && filterStackFile(this.registration.location.file);
    const title = this.registration.customTitle || this.registration.name;
    const location = isUserFixture ? this.registration.location : void 0;
    this._stepInfo = { title: `Fixture ${escapeWithQuotes(title, '"')}`, category: "fixture", location };
    if (this.registration.box === "self")
      this._stepInfo = void 0;
    else if (this.registration.box)
      this._stepInfo.group = isUserFixture ? "configuration" : "internal";
    this._setupDescription = {
      title,
      phase: "setup",
      location,
      slot: this.registration.timeout !== void 0 ? {
        timeout: this.registration.timeout,
        elapsed: 0
      } : this.registration.scope === "worker" ? {
        timeout: this.runner.workerFixtureTimeout,
        elapsed: 0
      } : void 0
    };
    this._teardownDescription = { ...this._setupDescription, phase: "teardown" };
  }
  async setup(testInfo, runnable) {
    this.runner.instanceForId.set(this.registration.id, this);
    if (typeof this.registration.fn !== "function") {
      this.value = this.registration.fn;
      return;
    }
    const run = () => testInfo._runWithTimeout({ ...runnable, fixture: this._setupDescription }, () => this._setupInternal(testInfo));
    if (this._stepInfo)
      await testInfo._runAsStep(this._stepInfo, run);
    else
      await run();
  }
  async _setupInternal(testInfo) {
    const params = {};
    for (const name of this.registration.deps) {
      const registration = this.runner.pool.resolve(name, this.registration);
      const dep = this.runner.instanceForId.get(registration.id);
      if (!dep) {
        this.failed = true;
        return;
      }
      dep._usages.add(this);
      this._deps.add(dep);
      params[name] = dep.value;
      if (dep.failed) {
        this.failed = true;
        return;
      }
    }
    let called = false;
    const useFuncStarted = new ManualPromise();
    const useFunc = async (value) => {
      if (called)
        throw new Error(`Cannot provide fixture value for the second time`);
      called = true;
      this.value = value;
      this._useFuncFinished = new ManualPromise();
      useFuncStarted.resolve();
      await this._useFuncFinished;
    };
    const workerInfo = { config: testInfo.config, parallelIndex: testInfo.parallelIndex, workerIndex: testInfo.workerIndex, project: testInfo.project };
    const info = this.registration.scope === "worker" ? workerInfo : testInfo;
    this._selfTeardownComplete = (async () => {
      try {
        await this.registration.fn(params, useFunc, info);
        if (!useFuncStarted.isDone())
          throw new Error(`use() was not called in fixture "${this.registration.name}"`);
      } catch (error) {
        this.failed = true;
        if (!useFuncStarted.isDone())
          useFuncStarted.reject(error);
        else
          throw error;
      }
    })();
    await useFuncStarted;
  }
  async teardown(testInfo, runnable) {
    try {
      const fixtureRunnable = { ...runnable, fixture: this._teardownDescription };
      if (!testInfo._timeoutManager.isTimeExhaustedFor(fixtureRunnable)) {
        const run = () => testInfo._runWithTimeout(fixtureRunnable, () => this._teardownInternal());
        if (this._stepInfo)
          await testInfo._runAsStep(this._stepInfo, run);
        else
          await run();
      }
    } finally {
      for (const dep of this._deps)
        dep._usages.delete(this);
      this.runner.instanceForId.delete(this.registration.id);
    }
  }
  async _teardownInternal() {
    if (typeof this.registration.fn !== "function")
      return;
    if (this._usages.size !== 0) {
      console.error("Internal error: fixture integrity at", this._teardownDescription.title);
      this._usages.clear();
    }
    if (this._useFuncFinished) {
      this._useFuncFinished.resolve();
      this._useFuncFinished = void 0;
      await this._selfTeardownComplete;
    }
  }
  _collectFixturesInTeardownOrder(scope, collector) {
    if (this.registration.scope !== scope)
      return;
    for (const fixture of this._usages)
      fixture._collectFixturesInTeardownOrder(scope, collector);
    collector.add(this);
  }
};
var FixtureRunner = class {
  constructor() {
    this.testScopeClean = true;
    this.instanceForId = /* @__PURE__ */ new Map();
    this.workerFixtureTimeout = 0;
  }
  setPool(pool) {
    if (!this.testScopeClean)
      throw new Error("Did not teardown test scope");
    if (this.pool && pool.digest !== this.pool.digest) {
      throw new Error([
        `Playwright detected inconsistent test.use() options.`,
        `Most common mistakes that lead to this issue:`,
        `  - Calling test.use() outside of the test file, for example in a common helper.`,
        `  - One test file imports from another test file.`
      ].join("\n"));
    }
    this.pool = pool;
  }
  _collectFixturesInSetupOrder(registration, collector) {
    if (collector.has(registration))
      return;
    for (const name of registration.deps) {
      const dep = this.pool.resolve(name, registration);
      this._collectFixturesInSetupOrder(dep, collector);
    }
    collector.add(registration);
  }
  async teardownScope(scope, testInfo, runnable) {
    const allFixtures = Array.from(this.instanceForId.values()).reverse();
    const collector = /* @__PURE__ */ new Set();
    for (const fixture of allFixtures)
      fixture._collectFixturesInTeardownOrder(scope, collector);
    let firstError;
    for (const fixture of collector) {
      try {
        await fixture.teardown(testInfo, runnable);
      } catch (error) {
        firstError = firstError ?? error;
      }
    }
    if (scope === "test")
      this.testScopeClean = true;
    if (firstError)
      throw firstError;
  }
  async resolveParametersForFunction(fn, testInfo, autoFixtures, runnable) {
    const collector = /* @__PURE__ */ new Set();
    const auto = [];
    for (const registration of this.pool.autoFixtures()) {
      let shouldRun = true;
      if (autoFixtures === "all-hooks-only")
        shouldRun = registration.scope === "worker" || registration.auto === "all-hooks-included";
      else if (autoFixtures === "worker")
        shouldRun = registration.scope === "worker";
      if (shouldRun)
        auto.push(registration);
    }
    auto.sort((r1, r2) => (r1.scope === "worker" ? 0 : 1) - (r2.scope === "worker" ? 0 : 1));
    for (const registration of auto)
      this._collectFixturesInSetupOrder(registration, collector);
    const names = getRequiredFixtureNames(fn);
    for (const name of names)
      this._collectFixturesInSetupOrder(this.pool.resolve(name), collector);
    for (const registration of collector)
      await this._setupFixtureForRegistration(registration, testInfo, runnable);
    const params = {};
    for (const name of names) {
      const registration = this.pool.resolve(name);
      const fixture = this.instanceForId.get(registration.id);
      if (!fixture || fixture.failed)
        return null;
      params[name] = fixture.value;
    }
    return { result: params };
  }
  async resolveParametersAndRunFunction(fn, testInfo, autoFixtures, runnable) {
    const params = await this.resolveParametersForFunction(fn, testInfo, autoFixtures, runnable);
    if (params === null) {
      return null;
    }
    await testInfo._runWithTimeout(runnable, () => fn(params.result, testInfo));
  }
  async _setupFixtureForRegistration(registration, testInfo, runnable) {
    if (registration.scope === "test")
      this.testScopeClean = false;
    let fixture = this.instanceForId.get(registration.id);
    if (fixture)
      return fixture;
    fixture = new Fixture(this, registration);
    await fixture.setup(testInfo, runnable);
    return fixture;
  }
  dependsOnWorkerFixturesOnly(fn, location) {
    const names = getRequiredFixtureNames(fn, location);
    for (const name of names) {
      const registration = this.pool.resolve(name);
      if (registration.scope !== "worker")
        return false;
    }
    return true;
  }
};
function getRequiredFixtureNames(fn, location) {
  return import_common.fixtures.fixtureParameterNames(fn, location ?? { file: "<unknown>", line: 1, column: 1 }, (e) => {
    throw new Error(`${formatLocation(e.location)}: ${e.message}`);
  });
}

// packages/playwright/src/worker/testInfo.ts
var import_fs3 = __toESM(require("fs"));
var import_path3 = __toESM(require("path"));

// packages/playwright/src/worker/timeoutManager.ts
var colors = require("playwright-core/lib/utilsBundle").colors;
var { ManualPromise: ManualPromise2 } = require("playwright-core/lib/coreBundle").iso;
var { monotonicTime } = require("playwright-core/lib/coreBundle").iso;
var kMaxDeadline = 2147483647;
var TimeoutManager = class {
  constructor(timeout) {
    this._ignoreTimeouts = false;
    this._slow = false;
    this._defaultSlot = { timeout, elapsed: 0 };
  }
  setIgnoreTimeouts(ignoreTimeouts) {
    if (this._ignoreTimeouts === ignoreTimeouts)
      return;
    this._ignoreTimeouts = ignoreTimeouts;
    if (this._running) {
      if (ignoreTimeouts)
        this._running.slot.elapsed += monotonicTime() - this._running.start;
      else
        this._running.start = monotonicTime();
      this._updateTimeout(this._running);
    }
  }
  interrupt() {
    if (this._running)
      this._running.timeoutPromise.reject(this._createTimeoutError(this._running));
  }
  isTimeExhaustedFor(runnable) {
    const slot = runnable.fixture?.slot || runnable.slot || this._defaultSlot;
    return slot.timeout > 0 && slot.elapsed >= slot.timeout - 1;
  }
  async withRunnable(runnable, cb) {
    if (this._running)
      throw new Error(`Internal error: duplicate runnable`);
    const running = this._running = {
      runnable,
      slot: runnable.fixture?.slot || runnable.slot || this._defaultSlot,
      start: monotonicTime(),
      deadline: kMaxDeadline,
      timer: void 0,
      timeoutPromise: new ManualPromise2()
    };
    let debugTitle = "";
    try {
      if (debugTest.enabled) {
        debugTitle = runnable.fixture ? `${runnable.fixture.phase} "${runnable.fixture.title}"` : runnable.type;
        const location = runnable.location ? ` at "${formatLocation(runnable.location)}"` : ``;
        debugTest(`started ${debugTitle}${location}`);
      }
      this._updateTimeout(running);
      return await Promise.race([
        cb(),
        running.timeoutPromise
      ]);
    } finally {
      if (running.timer)
        clearTimeout(running.timer);
      running.timer = void 0;
      running.slot.elapsed += monotonicTime() - running.start;
      this._running = void 0;
      if (debugTest.enabled)
        debugTest(`finished ${debugTitle}`);
    }
  }
  _updateTimeout(running) {
    if (running.timer)
      clearTimeout(running.timer);
    running.timer = void 0;
    if (this._ignoreTimeouts || !running.slot.timeout) {
      running.deadline = kMaxDeadline;
      return;
    }
    running.deadline = running.start + (running.slot.timeout - running.slot.elapsed);
    const timeout = running.deadline - monotonicTime() + 1;
    if (timeout <= 0)
      running.timeoutPromise.reject(this._createTimeoutError(running));
    else
      running.timer = setTimeout(() => running.timeoutPromise.reject(this._createTimeoutError(running)), timeout);
  }
  defaultSlot() {
    return this._defaultSlot;
  }
  slow() {
    if (this._slow)
      return;
    this._slow = true;
    const slot = this._running ? this._running.slot : this._defaultSlot;
    slot.timeout = slot.timeout * 3;
    if (this._running)
      this._updateTimeout(this._running);
  }
  setTimeout(timeout) {
    const slot = this._running ? this._running.slot : this._defaultSlot;
    slot.timeout = timeout;
    if (this._running)
      this._updateTimeout(this._running);
  }
  currentSlotDeadline() {
    return this._running ? this._running.deadline : kMaxDeadline;
  }
  currentSlotType() {
    return this._running ? this._running.runnable.type : "test";
  }
  _createTimeoutError(running) {
    let message = "";
    const timeout = running.slot.timeout;
    const runnable = running.runnable;
    switch (runnable.type) {
      case "test": {
        if (runnable.fixture) {
          if (runnable.fixture.phase === "setup")
            message = `Test timeout of ${timeout}ms exceeded while setting up "${runnable.fixture.title}".`;
          else
            message = `Tearing down "${runnable.fixture.title}" exceeded the test timeout of ${timeout}ms.`;
        } else {
          message = `Test timeout of ${timeout}ms exceeded.`;
        }
        break;
      }
      case "afterEach":
      case "beforeEach":
        message = `Test timeout of ${timeout}ms exceeded while running "${runnable.type}" hook.`;
        break;
      case "beforeAll":
      case "afterAll":
        message = `"${runnable.type}" hook timeout of ${timeout}ms exceeded.`;
        break;
      case "teardown": {
        if (runnable.fixture)
          message = `Worker teardown timeout of ${timeout}ms exceeded while ${runnable.fixture.phase === "setup" ? "setting up" : "tearing down"} "${runnable.fixture.title}".`;
        else
          message = `Worker teardown timeout of ${timeout}ms exceeded.`;
        break;
      }
      case "skip":
      case "slow":
      case "fixme":
      case "fail":
        message = `"${runnable.type}" modifier timeout of ${timeout}ms exceeded.`;
        break;
    }
    const fixtureWithSlot = runnable.fixture?.slot ? runnable.fixture : void 0;
    if (fixtureWithSlot)
      message = `Fixture "${fixtureWithSlot.title}" timeout of ${timeout}ms exceeded during ${fixtureWithSlot.phase}.`;
    message = colors.red(message);
    const location = (fixtureWithSlot || runnable).location;
    const error = new TimeoutManagerError(message);
    error.name = "";
    error.stack = message + (location ? `
    at ${location.file}:${location.line}:${location.column}` : "");
    return error;
  }
};
var TimeoutManagerError = class extends Error {
};

// packages/playwright/src/worker/testTracing.ts
var import_fs2 = __toESM(require("fs"));
var import_path2 = __toESM(require("path"));
var import_coreBundle = require("playwright-core/lib/coreBundle");
var yazl = require("playwright-core/lib/utilsBundle").yazl;
var yauzl = require("playwright-core/lib/utilsBundle").yauzl;
var { ManualPromise: ManualPromise3 } = require("playwright-core/lib/coreBundle").iso;
var { monotonicTime: monotonicTime2 } = require("playwright-core/lib/coreBundle").iso;
var { calculateSha1: calculateSha12, createGuid } = require("playwright-core/lib/coreBundle").utils;
var { SerializedFS } = require("playwright-core/lib/coreBundle").utils;
var { filteredStackTrace: filteredStackTrace2 } = require("playwright-core/lib/coreBundle").utils;
var testTraceEntryName = "test.trace";
var version = 8;
var traceOrdinal = 0;
var TestTracing = class {
  constructor(testInfo, artifactsDir) {
    this._traceEvents = [];
    this._temporaryTraceFiles = [];
    this._didFinishTestFunctionAndAfterEachHooks = false;
    this._testInfo = testInfo;
    this._artifactsDir = artifactsDir;
    this._tracesDir = import_path2.default.join(this._artifactsDir, "traces");
    this._contextCreatedEvent = {
      version,
      type: "context-options",
      origin: "testRunner",
      browserName: "",
      playwrightVersion: (0, import_coreBundle.getPlaywrightVersion)(),
      options: {},
      platform: process.platform,
      wallTime: Date.now(),
      monotonicTime: monotonicTime2(),
      sdkLanguage: "javascript"
    };
    this._appendTraceEvent(this._contextCreatedEvent);
  }
  _shouldCaptureTrace() {
    if (this._options?.mode === "on")
      return true;
    if (this._options?.mode === "retain-on-failure")
      return true;
    if (this._options?.mode === "on-first-retry" && this._testInfo.retry === 1)
      return true;
    if (this._options?.mode === "on-all-retries" && this._testInfo.retry > 0)
      return true;
    if (this._options?.mode === "retain-on-first-failure" && this._testInfo.retry === 0)
      return true;
    if (this._options?.mode === "retain-on-failure-and-retries")
      return true;
    return false;
  }
  async startIfNeeded(value) {
    const defaultTraceOptions = { screenshots: true, snapshots: true, sources: true, attachments: true, live: false, mode: "off" };
    if (!value) {
      this._options = defaultTraceOptions;
    } else if (typeof value === "string") {
      this._options = { ...defaultTraceOptions, mode: value === "retry-with-trace" ? "on-first-retry" : value };
    } else {
      const mode = value.mode || "off";
      this._options = { ...defaultTraceOptions, ...value, mode: mode === "retry-with-trace" ? "on-first-retry" : mode };
    }
    if (!this._shouldCaptureTrace()) {
      this._options = void 0;
      return;
    }
    if (!this._liveTraceFile && this._options.live) {
      this._liveTraceFile = { file: import_path2.default.join(this._tracesDir, `${this._testInfo.testId}-test.trace`), fs: new SerializedFS() };
      this._liveTraceFile.fs.mkdir(import_path2.default.dirname(this._liveTraceFile.file));
      const data = this._traceEvents.map((e) => JSON.stringify(e)).join("\n") + "\n";
      this._liveTraceFile.fs.writeFile(this._liveTraceFile.file, data);
    }
  }
  didFinishTestFunctionAndAfterEachHooks() {
    this._didFinishTestFunctionAndAfterEachHooks = true;
  }
  artifactsDir() {
    return this._artifactsDir;
  }
  tracesDir() {
    return this._tracesDir;
  }
  traceTitle() {
    return [import_path2.default.relative(this._testInfo.project.testDir, this._testInfo.file) + ":" + this._testInfo.line, ...this._testInfo.titlePath.slice(1)].join(" \u203A ");
  }
  generateNextTraceRecordingName() {
    const ordinalSuffix = traceOrdinal ? `-recording${traceOrdinal}` : "";
    ++traceOrdinal;
    const retrySuffix = this._testInfo.retry ? `-retry${this._testInfo.retry}` : "";
    return `${this._testInfo.testId}${retrySuffix}${ordinalSuffix}`;
  }
  _generateNextTraceRecordingPath() {
    const file = import_path2.default.join(this._artifactsDir, createGuid() + ".zip");
    this._temporaryTraceFiles.push(file);
    return file;
  }
  traceOptions() {
    return this._options;
  }
  maybeGenerateNextTraceRecordingPath() {
    if (this._didFinishTestFunctionAndAfterEachHooks && this._shouldAbandonTrace())
      return;
    return this._generateNextTraceRecordingPath();
  }
  _shouldAbandonTrace() {
    if (!this._options)
      return true;
    const testFailed = this._testInfo.status !== this._testInfo.expectedStatus;
    if (this._options.mode === "retain-on-failure-and-retries")
      return !testFailed && this._testInfo.retry === 0;
    return !testFailed && (this._options.mode === "retain-on-failure" || this._options.mode === "retain-on-first-failure");
  }
  async stopIfNeeded() {
    this._contextCreatedEvent.testTimeout = this._testInfo.timeout;
    if (!this._options)
      return;
    const error = await this._liveTraceFile?.fs.syncAndGetError();
    if (error)
      throw error;
    if (this._shouldAbandonTrace()) {
      for (const file of this._temporaryTraceFiles)
        await import_fs2.default.promises.unlink(file).catch(() => {
        });
      return;
    }
    const zipFile = new yazl.ZipFile();
    if (!this._options?.attachments) {
      for (const event of this._traceEvents) {
        if (event.type === "after")
          delete event.attachments;
      }
    }
    if (this._options?.sources) {
      const sourceFiles = /* @__PURE__ */ new Set();
      for (const event of this._traceEvents) {
        if (event.type === "before") {
          for (const frame of event.stack || [])
            sourceFiles.add(frame.file);
        }
      }
      for (const sourceFile of sourceFiles) {
        await import_fs2.default.promises.readFile(sourceFile, "utf8").then((source) => {
          zipFile.addBuffer(Buffer.from(source), "resources/src@" + calculateSha12(sourceFile) + ".txt");
        }).catch(() => {
        });
      }
    }
    const sha1s = /* @__PURE__ */ new Set();
    for (const event of this._traceEvents.filter((e) => e.type === "after")) {
      for (const attachment of event.attachments || []) {
        let contentPromise;
        if (attachment.path)
          contentPromise = import_fs2.default.promises.readFile(attachment.path).catch(() => void 0);
        else if (attachment.base64)
          contentPromise = Promise.resolve(Buffer.from(attachment.base64, "base64"));
        const content = await contentPromise;
        if (content === void 0)
          continue;
        const sha1 = calculateSha12(content);
        attachment.sha1 = sha1;
        delete attachment.path;
        delete attachment.base64;
        if (sha1s.has(sha1))
          continue;
        sha1s.add(sha1);
        zipFile.addBuffer(content, "resources/" + sha1);
      }
    }
    const traceContent = Buffer.from(this._traceEvents.map((e) => JSON.stringify(e)).join("\n"));
    zipFile.addBuffer(traceContent, testTraceEntryName);
    await new Promise((resolve, reject) => {
      zipFile.end(void 0, () => {
        zipFile.outputStream.pipe(import_fs2.default.createWriteStream(this._generateNextTraceRecordingPath())).on("close", resolve).on("error", reject);
      });
    });
    const tracePath = this._testInfo.outputPath("trace.zip");
    await mergeTraceFiles(tracePath, this._temporaryTraceFiles);
    this._testInfo.attachments.push({ name: "trace", path: tracePath, contentType: "application/zip" });
  }
  appendForError(error) {
    const rawStack = error.stack?.split("\n") || [];
    const stack = rawStack ? filteredStackTrace2(rawStack) : [];
    this._appendTraceEvent({
      type: "error",
      message: this._formatError(error),
      stack
    });
  }
  _formatError(error) {
    const parts = [error.message || String(error.value)];
    if (error.cause)
      parts.push("[cause]: " + this._formatError(error.cause));
    return parts.join("\n");
  }
  appendStdioToTrace(type, chunk) {
    this._appendTraceEvent({
      type,
      timestamp: monotonicTime2(),
      text: typeof chunk === "string" ? chunk : void 0,
      base64: typeof chunk === "string" ? void 0 : chunk.toString("base64")
    });
  }
  appendBeforeActionForStep(options) {
    this._appendTraceEvent({
      type: "before",
      callId: options.stepId,
      stepId: options.stepId,
      parentId: options.parentId,
      startTime: monotonicTime2(),
      class: "Test",
      method: options.category,
      title: options.title,
      params: Object.fromEntries(Object.entries(options.params || {}).map(([name, value]) => [name, generatePreview(value)])),
      stack: options.stack,
      group: options.group
    });
  }
  appendAfterActionForStep(callId, error, attachments = [], annotations) {
    this._appendTraceEvent({
      type: "after",
      callId,
      endTime: monotonicTime2(),
      attachments: serializeAttachments(attachments),
      annotations,
      error
    });
  }
  _appendTraceEvent(event) {
    this._traceEvents.push(event);
    if (this._liveTraceFile)
      this._liveTraceFile.fs.appendFile(this._liveTraceFile.file, JSON.stringify(event) + "\n", true);
  }
};
function serializeAttachments(attachments) {
  if (attachments.length === 0)
    return void 0;
  return attachments.filter((a) => a.name !== "trace").map((a) => {
    return {
      name: a.name,
      contentType: a.contentType,
      path: a.path,
      base64: a.body?.toString("base64")
    };
  });
}
function generatePreview(value, visited = /* @__PURE__ */ new Set()) {
  if (visited.has(value))
    return "";
  visited.add(value);
  if (typeof value === "string")
    return value;
  if (typeof value === "number")
    return value.toString();
  if (typeof value === "boolean")
    return value.toString();
  if (value === null)
    return "null";
  if (value === void 0)
    return "undefined";
  if (Array.isArray(value))
    return "[" + value.map((v) => generatePreview(v, visited)).join(", ") + "]";
  if (typeof value === "object")
    return "Object";
  return String(value);
}
async function mergeTraceFiles(fileName, temporaryTraceFiles) {
  temporaryTraceFiles = temporaryTraceFiles.filter((file) => import_fs2.default.existsSync(file));
  if (temporaryTraceFiles.length === 1) {
    await import_fs2.default.promises.rename(temporaryTraceFiles[0], fileName);
    return;
  }
  const mergePromise = new ManualPromise3();
  const zipFile = new yazl.ZipFile();
  const entryNames = /* @__PURE__ */ new Set();
  zipFile.on("error", (error) => mergePromise.reject(error));
  for (let i = temporaryTraceFiles.length - 1; i >= 0; --i) {
    const tempFile = temporaryTraceFiles[i];
    const promise = new ManualPromise3();
    yauzl.open(tempFile, (err, inZipFile) => {
      if (err) {
        promise.reject(err);
        return;
      }
      let pendingEntries = inZipFile.entryCount;
      inZipFile.on("entry", (entry) => {
        let entryName = entry.fileName;
        if (entry.fileName === testTraceEntryName) {
        } else if (entry.fileName.match(/trace\.[a-z]*$/)) {
          entryName = i + "-" + entry.fileName;
        }
        if (entryNames.has(entryName)) {
          if (--pendingEntries === 0)
            promise.resolve();
          return;
        }
        entryNames.add(entryName);
        inZipFile.openReadStream(entry, (err2, readStream) => {
          if (err2) {
            promise.reject(err2);
            return;
          }
          zipFile.addReadStream(readStream, entryName);
          if (--pendingEntries === 0)
            promise.resolve();
        });
      });
    });
    await promise;
  }
  zipFile.end(void 0, () => {
    zipFile.outputStream.pipe(import_fs2.default.createWriteStream(fileName)).on("close", () => {
      void Promise.all(temporaryTraceFiles.map((tempFile) => import_fs2.default.promises.unlink(tempFile))).then(() => {
        mergePromise.resolve();
      }).catch((error) => mergePromise.reject(error));
    }).on("error", (error) => mergePromise.reject(error));
  });
  await mergePromise;
}

// packages/playwright/src/worker/util.ts
function testInfoError(error) {
  const result = serializeError(error);
  const matcherResult = error instanceof Error ? error.matcherResult : void 0;
  if (matcherResult?.ariaSnapshot !== void 0)
    result.errorContext = matcherResult.ariaSnapshot;
  return result;
}

// packages/playwright/src/worker/testInfo.ts
var import_common2 = require("../common");
var { ManualPromise: ManualPromise4 } = require("playwright-core/lib/coreBundle").iso;
var { captureRawStack, stringifyStackFrames: stringifyStackFrames2, filteredStackTrace: filteredStackTrace3 } = require("playwright-core/lib/coreBundle").utils;
var { escapeWithQuotes: escapeWithQuotes2 } = require("playwright-core/lib/coreBundle").iso;
var { monotonicTime: monotonicTime3 } = require("playwright-core/lib/coreBundle").iso;
var { createGuid: createGuid2 } = require("playwright-core/lib/coreBundle").utils;
var { sanitizeForFilePath: sanitizeForFilePath2, trimLongString } = require("playwright-core/lib/coreBundle").utils;
var { currentZone } = require("playwright-core/lib/coreBundle").utils;
var emtpyTestInfoCallbacks = {
  onStepBegin: () => {
  },
  onStepEnd: () => {
  },
  onAttach: () => {
  },
  onTestPaused: () => Promise.reject(new Error("TestInfoImpl not initialized"))
};
var TestInfoImpl = class {
  constructor(configInternal, projectInternal, workerParams, test, retry, callbacks) {
    this._snapshotNames = { lastAnonymousSnapshotIndex: 0, lastNamedSnapshotIndex: {} };
    this._ariaSnapshotNames = { lastAnonymousSnapshotIndex: 0, lastNamedSnapshotIndex: {} };
    this._interruptedPromise = new ManualPromise4();
    this._lastStepId = 0;
    this._steps = [];
    this._stepMap = /* @__PURE__ */ new Map();
    this._onDidFinishTestFunctionCallbacks = /* @__PURE__ */ new Set();
    this._hasNonRetriableError = false;
    this._hasUnhandledError = false;
    this._allowSkips = false;
    this.duration = 0;
    this.annotations = [];
    this.attachments = [];
    this.status = "passed";
    this.snapshotSuffix = "";
    this.errors = [];
    this._ignoreTimeoutsCounter = 0;
    this.testId = test?.id ?? "";
    this._callbacks = callbacks;
    this._startTime = monotonicTime3();
    this._startWallTime = Date.now();
    this._requireFile = test?._requireFile ?? "";
    this._uniqueSymbol = /* @__PURE__ */ Symbol("testInfoUniqueSymbol");
    this._workerParams = workerParams;
    this.repeatEachIndex = workerParams.repeatEachIndex;
    this.retry = retry;
    this.workerIndex = workerParams.workerIndex;
    this.parallelIndex = workerParams.parallelIndex;
    this._projectInternal = projectInternal;
    this.project = projectInternal.project;
    this._configInternal = configInternal;
    this.config = configInternal.config;
    this.title = test?.title ?? "";
    this.titlePath = test?.titlePath() ?? [];
    this.file = test?.location.file ?? "";
    this.line = test?.location.line ?? 0;
    this.column = test?.location.column ?? 0;
    this.tags = test?.tags ?? [];
    this.fn = test?.fn ?? (() => {
    });
    this.expectedStatus = test?.expectedStatus ?? "skipped";
    this._timeoutManager = new TimeoutManager(this.project.timeout);
    if (configInternal.configCLIOverrides.debug === "inspector")
      this._setIgnoreTimeouts(true);
    this.outputDir = (() => {
      const relativeTestFilePath = import_path3.default.relative(this.project.testDir, this._requireFile.replace(/\.(spec|test)\.(js|ts|jsx|tsx|mjs|mts|cjs|cts)$/, ""));
      const sanitizedRelativePath = relativeTestFilePath.replace(process.platform === "win32" ? new RegExp("\\\\", "g") : new RegExp("/", "g"), "-");
      const fullTitleWithoutSpec = this.titlePath.slice(1).join(" ");
      let testOutputDir = trimLongString(sanitizedRelativePath + "-" + sanitizeForFilePath2(fullTitleWithoutSpec), windowsFilesystemFriendlyLength);
      if (projectInternal.id)
        testOutputDir += "-" + sanitizeForFilePath2(projectInternal.id);
      if (this.retry)
        testOutputDir += "-retry" + this.retry;
      if (this.repeatEachIndex)
        testOutputDir += "-repeat" + this.repeatEachIndex;
      return import_path3.default.join(this.project.outputDir, testOutputDir);
    })();
    this.snapshotDir = (() => {
      const relativeTestFilePath = import_path3.default.relative(this.project.testDir, this._requireFile);
      return import_path3.default.join(this.project.snapshotDir, relativeTestFilePath + "-snapshots");
    })();
    this._attachmentsPush = this.attachments.push.bind(this.attachments);
    const attachmentsPush = (...attachments) => {
      for (const a of attachments)
        this._attach(a, this._parentStep()?.stepId);
      return this.attachments.length;
    };
    Object.defineProperty(this.attachments, "push", {
      value: attachmentsPush,
      writable: true,
      enumerable: false,
      configurable: true
    });
    this._tracing = new TestTracing(this, workerParams.artifactsDir);
    this.skip = import_common2.transform.wrapFunctionWithLocation((location, ...args) => this._modifier("skip", location, args));
    this.fixme = import_common2.transform.wrapFunctionWithLocation((location, ...args) => this._modifier("fixme", location, args));
    this.fail = import_common2.transform.wrapFunctionWithLocation((location, ...args) => this._modifier("fail", location, args));
    this.slow = import_common2.transform.wrapFunctionWithLocation((location, ...args) => this._modifier("slow", location, args));
  }
  get error() {
    return this.errors[0];
  }
  set error(e) {
    if (e === void 0)
      throw new Error("Cannot assign testInfo.error undefined value!");
    this.errors[0] = e;
  }
  get timeout() {
    return this._timeoutManager.defaultSlot().timeout;
  }
  set timeout(timeout) {
  }
  _deadline() {
    return { deadline: this._timeoutManager.currentSlotDeadline(), timeout: this.timeout };
  }
  _modifier(type, location, modifierArgs) {
    if (typeof modifierArgs[1] === "function") {
      throw new Error([
        "It looks like you are calling test.skip() inside the test and pass a callback.",
        "Pass a condition instead and optional description instead:",
        `test('my test', async ({ page, isMobile }) => {`,
        `  test.skip(isMobile, 'This test is not applicable on mobile');`,
        `});`
      ].join("\n"));
    }
    if (modifierArgs.length >= 1 && !modifierArgs[0])
      return;
    const description = modifierArgs[1];
    this.annotations.push({ type, description, location });
    if (type === "slow") {
      this._timeoutManager.slow();
    } else if (type === "skip" || type === "fixme") {
      this.expectedStatus = "skipped";
      throw new TestSkipError("Test is skipped: " + (description || ""));
    } else if (type === "fail") {
      if (this.expectedStatus !== "skipped")
        this.expectedStatus = "failed";
    }
  }
  _findLastPredefinedStep(steps) {
    for (let i = steps.length - 1; i >= 0; i--) {
      const child = this._findLastPredefinedStep(steps[i].steps);
      if (child)
        return child;
      if ((steps[i].category === "hook" || steps[i].category === "fixture") && !steps[i].endWallTime)
        return steps[i];
    }
  }
  _parentStep() {
    return currentZone().data("stepZone") ?? this._findLastPredefinedStep(this._steps);
  }
  _addStep(data, parentStep) {
    const stepId = `${data.category}@${++this._lastStepId}`;
    if (data.category === "hook" || data.category === "fixture") {
      parentStep = this._findLastPredefinedStep(this._steps);
    } else {
      if (!parentStep)
        parentStep = this._parentStep();
    }
    const filteredStack = filteredStackTrace3(captureRawStack());
    let boxedStack = parentStep?.boxedStack;
    let location = data.location;
    if (!boxedStack && data.box) {
      boxedStack = filteredStack.slice(1);
      location = location || boxedStack[0];
    }
    location = location || filteredStack[0];
    const step = {
      ...data,
      stepId,
      group: parentStep?.group ?? data.group,
      boxedStack,
      location,
      steps: [],
      attachmentIndices: [],
      info: new TestStepInfoImpl(this, stepId, data.title, parentStep?.info),
      complete: (result) => {
        if (step.endWallTime)
          return;
        step.endWallTime = Date.now();
        if (result.attachments) {
          for (const attachment of result.attachments)
            this._attach(attachment, stepId);
        }
        if (result.error) {
          if (typeof result.error === "object" && !result.error?.[stepSymbol])
            result.error[stepSymbol] = step;
          const error = testInfoError(result.error);
          if (step.boxedStack)
            error.stack = `${error.message}
${stringifyStackFrames2(step.boxedStack).join("\n")}`;
          step.error = error;
        }
        if (result.softError) {
          step.infectParentStepsWithError = true;
          this._failWithError(result.softError);
        }
        if (result.shouldNotRetryTest)
          this._hasNonRetriableError = true;
        if (!step.error) {
          for (const childStep of step.steps) {
            if (childStep.error && childStep.infectParentStepsWithError) {
              step.error = childStep.error;
              step.infectParentStepsWithError = true;
              break;
            }
          }
        }
        if (!step.group) {
          const payload = {
            testId: this.testId,
            stepId,
            wallTime: step.endWallTime,
            error: step.error ? import_common2.ipc.toTestInfoErrorPayload(step.error) : void 0,
            suggestedRebaseline: result.suggestedRebaseline,
            annotations: step.info.annotations
          };
          this._callbacks.onStepEnd(payload);
        }
        if (step.group !== "internal") {
          const errorForTrace = step.error ? { name: "", message: step.error.message || "", stack: step.error.stack } : void 0;
          const attachments = step.attachmentIndices.map((i) => this.attachments[i]);
          this._tracing.appendAfterActionForStep(stepId, errorForTrace, attachments, step.info.annotations);
        }
      }
    };
    const parentStepList = parentStep ? parentStep.steps : this._steps;
    parentStepList.push(step);
    this._stepMap.set(stepId, step);
    if (!step.group) {
      const payload = {
        testId: this.testId,
        stepId,
        parentStepId: parentStep ? parentStep.stepId : void 0,
        title: step.title,
        category: step.category,
        wallTime: Date.now(),
        location: step.location
      };
      this._callbacks.onStepBegin(payload);
    }
    if (step.group !== "internal") {
      this._tracing.appendBeforeActionForStep({
        stepId,
        parentId: parentStep?.stepId,
        title: step.shortTitle ?? step.title,
        category: step.category,
        params: step.params,
        stack: step.location ? [step.location] : [],
        group: step.group
      });
    }
    return step;
  }
  _abort(location, message) {
    this.annotations.push({ type: "abort", description: message, location });
    throw new TestAbortError("Test aborted" + (message ? ": " + message : ""));
  }
  _interrupt() {
    this._interruptedPromise.resolve();
    this._timeoutManager.interrupt();
    if (this.status === "passed")
      this.status = "interrupted";
  }
  _failWithError(root) {
    if (this.status === "passed" || this.status === "skipped")
      this.status = root instanceof TimeoutManagerError ? "timedOut" : "failed";
    const visit = (error) => {
      const serialized = testInfoError(error);
      const step = error === root && typeof error === "object" ? error?.[stepSymbol] : void 0;
      if (step && step.boxedStack)
        serialized.stack = `${error.name}: ${error.message}
${stringifyStackFrames2(step.boxedStack).join("\n")}`;
      this.errors.push(serialized);
      this._tracing.appendForError(serialized);
      const children = error?.errors;
      if (Array.isArray(children)) {
        for (const child of children)
          visit(child);
      }
    };
    visit(root);
  }
  async _runAsStep(stepInfo, cb) {
    const step = this._addStep(stepInfo);
    try {
      await cb();
      step.complete({});
    } catch (error) {
      step.complete({ error });
      throw error;
    }
  }
  async _runWithTimeout(runnable, cb) {
    try {
      await this._timeoutManager.withRunnable(runnable, async () => {
        try {
          await cb();
        } catch (e) {
          if (this._allowSkips && e instanceof TestSkipError) {
            if (this.status === "passed")
              this.status = "skipped";
          } else {
            this._failWithError(e);
          }
          throw e;
        }
      });
    } catch (error) {
      if (!this._interruptedPromise.isDone() && error instanceof TimeoutManagerError)
        this._failWithError(error);
      throw error;
    }
  }
  _isFailure() {
    return this.status !== "skipped" && this.status !== this.expectedStatus;
  }
  _currentHookType() {
    const type = this._timeoutManager.currentSlotType();
    return ["beforeAll", "afterAll", "beforeEach", "afterEach"].includes(type) ? type : void 0;
  }
  _setIgnoreTimeouts(ignoreTimeouts) {
    this._ignoreTimeoutsCounter += ignoreTimeouts ? 1 : -1;
    this._timeoutManager.setIgnoreTimeouts(this._ignoreTimeoutsCounter > 0);
  }
  async _didFinishTestFunction() {
    const shouldPause = this._workerParams.pauseAtEnd && !this._isFailure() || this._workerParams.pauseOnError && this._isFailure();
    if (shouldPause) {
      await Promise.race([
        this._callbacks.onTestPaused({ testId: this.testId, errors: this._isFailure() ? this.errors.map(import_common2.ipc.toTestInfoErrorPayload) : [], status: this.status }),
        this._interruptedPromise
      ]);
    }
    for (const cb of this._onDidFinishTestFunctionCallbacks)
      await cb();
  }
  // ------------ TestInfo methods ------------
  async attach(name, options = {}) {
    const step = this._addStep({
      title: `Attach ${escapeWithQuotes2(name, '"')}`,
      category: "test.attach"
    });
    this._attach(
      await normalizeAndSaveAttachment(this.outputPath(), name, options),
      step.stepId
    );
    step.complete({});
  }
  _attach(attachment, stepId) {
    const index = this._attachmentsPush(attachment) - 1;
    let step = stepId ? this._stepMap.get(stepId) : void 0;
    if (!!step?.group)
      step = void 0;
    if (step) {
      step.attachmentIndices.push(index);
    } else {
      const stepId2 = `attach@${createGuid2()}`;
      this._tracing.appendBeforeActionForStep({ stepId: stepId2, title: `Attach ${escapeWithQuotes2(attachment.name, '"')}`, category: "test.attach", stack: [] });
      this._tracing.appendAfterActionForStep(stepId2, void 0, [attachment]);
    }
    this._callbacks.onAttach({
      testId: this.testId,
      name: attachment.name,
      contentType: attachment.contentType,
      path: attachment.path,
      body: attachment.body?.toString("base64"),
      stepId: step?.stepId
    });
  }
  outputPath(...pathSegments) {
    const outputPath = this._getOutputPath(...pathSegments);
    import_fs3.default.mkdirSync(this.outputDir, { recursive: true });
    return outputPath;
  }
  _getOutputPath(...pathSegments) {
    const joinedPath = import_path3.default.join(...pathSegments);
    const outputPath = getContainedPath(this.outputDir, joinedPath);
    if (outputPath)
      return outputPath;
    throw new Error(`The outputPath is not allowed outside of the parent directory. Please fix the defined path.

	outputPath: ${joinedPath}`);
  }
  _fsSanitizedTestName() {
    const fullTitleWithoutSpec = this.titlePath.slice(1).join(" ");
    return sanitizeForFilePath2(trimLongString(fullTitleWithoutSpec));
  }
  _resolveSnapshotPaths(kind, name, updateSnapshotIndex, anonymousExtension) {
    const snapshotNames = kind === "aria" ? this._ariaSnapshotNames : this._snapshotNames;
    const defaultExtensions = { "aria": ".aria.yml", "screenshot": ".png", "snapshot": ".txt" };
    const ariaAwareExtname = (filePath) => kind === "aria" && filePath.endsWith(".aria.yml") ? ".aria.yml" : import_path3.default.extname(filePath);
    let subPath;
    let ext;
    let relativeOutputPath;
    if (!name) {
      const index = snapshotNames.lastAnonymousSnapshotIndex + 1;
      if (updateSnapshotIndex === "updateSnapshotIndex")
        snapshotNames.lastAnonymousSnapshotIndex = index;
      const fullTitleWithoutSpec = [...this.titlePath.slice(1), index].join(" ");
      ext = anonymousExtension ?? defaultExtensions[kind];
      subPath = sanitizeFilePathBeforeExtension(trimLongString(fullTitleWithoutSpec) + ext, ext);
      relativeOutputPath = sanitizeFilePathBeforeExtension(trimLongString(fullTitleWithoutSpec, windowsFilesystemFriendlyLength) + ext, ext);
    } else {
      if (Array.isArray(name)) {
        subPath = import_path3.default.join(...name);
        relativeOutputPath = import_path3.default.join(...name);
        ext = ariaAwareExtname(subPath);
      } else {
        ext = ariaAwareExtname(name);
        subPath = sanitizeFilePathBeforeExtension(name, ext);
        relativeOutputPath = sanitizeFilePathBeforeExtension(trimLongString(name, windowsFilesystemFriendlyLength), ext);
      }
      const index = (snapshotNames.lastNamedSnapshotIndex[relativeOutputPath] || 0) + 1;
      if (updateSnapshotIndex === "updateSnapshotIndex")
        snapshotNames.lastNamedSnapshotIndex[relativeOutputPath] = index;
      if (index > 1)
        relativeOutputPath = addSuffixToFilePath(relativeOutputPath, `-${index - 1}`);
    }
    const legacyTemplate = "{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-projectName}{-snapshotSuffix}{ext}";
    let template;
    if (kind === "screenshot") {
      template = this._projectInternal.expect?.toHaveScreenshot?.pathTemplate || this._projectInternal.snapshotPathTemplate || legacyTemplate;
    } else if (kind === "aria") {
      const ariaDefaultTemplate = "{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{ext}";
      template = this._projectInternal.expect?.toMatchAriaSnapshot?.pathTemplate || this._projectInternal.snapshotPathTemplate || ariaDefaultTemplate;
    } else {
      template = this._projectInternal.snapshotPathTemplate || legacyTemplate;
    }
    const nameArgument = import_path3.default.join(import_path3.default.dirname(subPath), import_path3.default.basename(subPath, ext));
    const absoluteSnapshotPath = this._applyPathTemplate(template, nameArgument, ext);
    return { absoluteSnapshotPath, relativeOutputPath };
  }
  _applyPathTemplate(template, nameArgument, ext) {
    const relativeTestFilePath = import_path3.default.relative(this.project.testDir, this._requireFile);
    const parsedRelativeTestFilePath = import_path3.default.parse(relativeTestFilePath);
    const projectNamePathSegment = sanitizeForFilePath2(this.project.name);
    const snapshotPath = template.replace(/\{(.)?testDir\}/g, "$1" + this.project.testDir).replace(/\{(.)?snapshotDir\}/g, "$1" + this.project.snapshotDir).replace(/\{(.)?snapshotSuffix\}/g, this.snapshotSuffix ? "$1" + this.snapshotSuffix : "").replace(/\{(.)?testFileDir\}/g, "$1" + parsedRelativeTestFilePath.dir).replace(/\{(.)?platform\}/g, "$1" + process.platform).replace(/\{(.)?projectName\}/g, projectNamePathSegment ? "$1" + projectNamePathSegment : "").replace(/\{(.)?testName\}/g, "$1" + this._fsSanitizedTestName()).replace(/\{(.)?testFileBaseName\}/g, "$1" + parsedRelativeTestFilePath.name).replace(/\{(.)?testFileName\}/g, "$1" + parsedRelativeTestFilePath.base).replace(/\{(.)?testFilePath\}/g, "$1" + relativeTestFilePath).replace(/\{(.)?arg\}/g, "$1" + nameArgument).replace(/\{(.)?ext\}/g, ext ? "$1" + ext : "");
    return import_path3.default.normalize(import_path3.default.resolve(this._configInternal.configDir, snapshotPath));
  }
  snapshotPath(...args) {
    let name = args;
    let kind = "snapshot";
    const options = args[args.length - 1];
    if (options && typeof options === "object") {
      kind = options.kind ?? kind;
      name = args.slice(0, -1);
    }
    if (!["snapshot", "screenshot", "aria"].includes(kind))
      throw new Error(`testInfo.snapshotPath: unknown kind "${kind}", must be one of "snapshot", "screenshot" or "aria"`);
    return this._resolveSnapshotPaths(kind, name.length <= 1 ? name[0] : name, "dontUpdateSnapshotIndex").absoluteSnapshotPath;
  }
  setTimeout(timeout) {
    this._timeoutManager.setTimeout(timeout);
  }
  artifactsDir() {
    return this._workerParams.artifactsDir;
  }
};
var TestStepInfoImpl = class {
  constructor(testInfo, stepId, title, parentStep) {
    this.annotations = [];
    this._testInfo = testInfo;
    this._stepId = stepId;
    this._title = title;
    this._parentStep = parentStep;
    this.skip = import_common2.transform.wrapFunctionWithLocation((location, ...args) => {
      if (args.length > 0 && !args[0])
        return;
      const description = args[1];
      this.annotations.push({ type: "skip", description, location });
      throw new StepSkipError(description);
    });
  }
  async _runStepBody(skip, body, location) {
    if (skip) {
      this.annotations.push({ type: "skip", location });
      return void 0;
    }
    try {
      return await body(this);
    } catch (e) {
      if (e instanceof StepSkipError)
        return void 0;
      throw e;
    }
  }
  async attach(name, options) {
    this._testInfo._attach(await normalizeAndSaveAttachment(this._testInfo.outputPath(), name, options), this._stepId);
  }
  get titlePath() {
    const parent = this._parentStep ?? this._testInfo;
    return [...parent.titlePath, this._title];
  }
};
var TestSkipError = class extends Error {
};
var TestAbortError = class extends Error {
};
var StepSkipError = class extends Error {
};
var stepSymbol = /* @__PURE__ */ Symbol("step");

// packages/playwright/src/worker/workerMain.ts
var colors2 = require("playwright-core/lib/utilsBundle").colors;
var { ManualPromise: ManualPromise5 } = require("playwright-core/lib/coreBundle").iso;
var { removeFolders } = require("playwright-core/lib/coreBundle").utils;
var { gracefullyCloseAll } = require("playwright-core/lib/coreBundle").utils;
var { filteredStackTrace: filteredStackTrace4 } = require("playwright-core/lib/coreBundle").utils;
var WorkerMain = class extends import_common3.ProcessRunner {
  constructor(params) {
    super();
    // Accumulated fatal errors that cannot be attributed to a test.
    this._fatalErrors = [];
    // The stage of the full cleanup. Once "finished", we can safely stop running anything.
    this._didRunFullCleanup = false;
    // Whether the worker was stopped due to an unhandled error in a test marked with test.fail().
    // This should force dispatcher to use a new worker instead.
    this._stoppedDueToUnhandledErrorInTestFail = false;
    // Whether the worker was requested to stop.
    this._isStopped = false;
    // This promise resolves once the single "run test group" call finishes.
    this._runFinished = new ManualPromise5();
    this._currentTest = null;
    this._lastRunningTests = [];
    this._totalRunningTests = 0;
    // Suites that had their beforeAll hooks, but not afterAll hooks executed.
    // These suites still need afterAll hooks to be executed for the proper cleanup.
    // Contains dynamic annotations originated by modifiers with a callback, e.g. `test.skip(() => true)`.
    this._activeSuites = /* @__PURE__ */ new Map();
    process.env.TEST_WORKER_INDEX = String(params.workerIndex);
    process.env.TEST_PARALLEL_INDEX = String(params.parallelIndex);
    globals.setIsWorkerProcess();
    this._params = params;
    this._fixtureRunner = new FixtureRunner();
    this._runFinished.resolve();
    process.on("unhandledRejection", (reason) => this.unhandledError(reason));
    process.on("uncaughtException", (error) => this.unhandledError(error));
    process.stdout.write = (chunk, cb) => {
      this.dispatchEvent("stdOut", import_common3.ipc.stdioChunkToParams(chunk));
      this._currentTest?._tracing.appendStdioToTrace("stdout", chunk);
      if (typeof cb === "function")
        process.nextTick(cb);
      return true;
    };
    if (!process.env.PW_RUNNER_DEBUG) {
      process.stderr.write = (chunk, cb) => {
        this.dispatchEvent("stdErr", import_common3.ipc.stdioChunkToParams(chunk));
        this._currentTest?._tracing.appendStdioToTrace("stderr", chunk);
        if (typeof cb === "function")
          process.nextTick(cb);
        return true;
      };
    }
  }
  _stop() {
    if (!this._isStopped) {
      this._isStopped = true;
      this._currentTest?._interrupt();
    }
    return this._runFinished;
  }
  async gracefullyClose() {
    try {
      await this._stop();
      if (!this._config) {
        return;
      }
      const fakeTestInfo = new TestInfoImpl(this._config, this._project, this._params, void 0, 0, emtpyTestInfoCallbacks);
      const runnable = { type: "teardown" };
      await fakeTestInfo._runWithTimeout(runnable, () => this._loadIfNeeded()).catch(() => {
      });
      await this._fixtureRunner.teardownScope("test", fakeTestInfo, runnable).catch(() => {
      });
      await this._fixtureRunner.teardownScope("worker", fakeTestInfo, runnable).catch(() => {
      });
      await fakeTestInfo._runWithTimeout(runnable, () => gracefullyCloseAll()).catch(() => {
      });
      this._fatalErrors.push(...fakeTestInfo.errors);
    } catch (e) {
      this._fatalErrors.push(testInfoError(e));
    }
    if (this._fatalErrors.length) {
      this._appendProcessTeardownDiagnostics(this._fatalErrors[this._fatalErrors.length - 1]);
      const payload = { fatalErrors: this._fatalErrors.map(import_common3.ipc.toTestInfoErrorPayload) };
      this.dispatchEvent("teardownErrors", payload);
    }
  }
  _appendProcessTeardownDiagnostics(error) {
    if (!this._lastRunningTests.length)
      return;
    const count = this._totalRunningTests === 1 ? "1 test" : `${this._totalRunningTests} tests`;
    let lastMessage = "";
    if (this._lastRunningTests.length < this._totalRunningTests)
      lastMessage = `, last ${this._lastRunningTests.length} tests were`;
    const message = [
      "",
      "",
      colors2.red(`Failed worker ran ${count}${lastMessage}:`),
      ...this._lastRunningTests.map((test) => formatTestTitle(test, this._project.project.name))
    ].join("\n");
    if (error.message) {
      if (error.stack) {
        let index = error.stack.indexOf(error.message);
        if (index !== -1) {
          index += error.message.length;
          error.stack = error.stack.substring(0, index) + message + error.stack.substring(index);
        }
      }
      error.message += message;
    } else if (error.value) {
      error.value += message;
    }
  }
  unhandledError(error) {
    if (!this._currentTest) {
      if (!this._fatalErrors.length)
        this._fatalErrors.push(testInfoError(error));
      void this._stop();
      return;
    }
    if (!this._currentTest._hasUnhandledError) {
      this._currentTest._hasUnhandledError = true;
      this._currentTest._failWithError(error);
    }
    const isExpectError = error instanceof Error && !!error.matcherResult;
    const shouldContinueInThisWorker = this._currentTest.expectedStatus === "failed" && isExpectError;
    if (!shouldContinueInThisWorker) {
      this._stoppedDueToUnhandledErrorInTestFail = true;
      void this._stop();
    }
  }
  async _loadIfNeeded() {
    if (this._config)
      return;
    const config = await import_common3.configLoader.deserializeConfig(this._params.config);
    const project = config.projects.find((p) => p.id === this._params.projectId);
    if (!project)
      throw new Error(`Project "${this._params.projectId}" not found in the worker process. Make sure project name does not change.`);
    this._config = config;
    this._project = project;
    this._poolBuilder = import_common3.poolBuilder.PoolBuilder.createForWorker(this._project);
    this._fixtureRunner.workerFixtureTimeout = this._project.project.timeout;
  }
  async runTestGroup(runPayload) {
    this._runFinished = new ManualPromise5();
    const entries = new Map(runPayload.entries.map((e) => [e.testId, e]));
    let fatalUnknownTestIds;
    try {
      await this._loadIfNeeded();
      const fileSuite = await import_common3.testLoader.loadTestFile(runPayload.file, this._config);
      const suite = import_common3.suiteUtils.bindFileSuiteToProject(this._project, fileSuite);
      if (this._params.repeatEachIndex)
        import_common3.suiteUtils.applyRepeatEachIndex(this._project, suite, this._params.repeatEachIndex);
      import_common3.suiteUtils.filterTestsRemoveEmptySuites(suite, (test) => entries.has(test.id));
      const tests = suite.allTests();
      for (const test of tests)
        test.annotations.push(...entries.get(test.id).planAnnotations);
      const unknownTestIds = new Set(entries.keys());
      for (const test of tests)
        unknownTestIds.delete(test.id);
      if (unknownTestIds.size) {
        fatalUnknownTestIds = [...unknownTestIds];
        void this._stop();
        return;
      }
      this._poolBuilder.buildPools(suite);
      this._activeSuites = /* @__PURE__ */ new Map();
      this._didRunFullCleanup = false;
      for (let i = 0; i < tests.length; i++) {
        if (this._isStopped && this._didRunFullCleanup)
          break;
        const entry = entries.get(tests[i].id);
        entries.delete(tests[i].id);
        debugTest(`test started "${tests[i].title}"`);
        await this._runTest(tests[i], entry.retry, tests[i + 1]);
        debugTest(`test finished "${tests[i].title}"`);
      }
    } catch (e) {
      this._fatalErrors.push(testInfoError(e));
      void this._stop();
    } finally {
      const donePayload = {
        fatalErrors: this._fatalErrors.map(import_common3.ipc.toTestInfoErrorPayload),
        skipTestsDueToSetupFailure: [],
        fatalUnknownTestIds,
        stoppedDueToUnhandledErrorInTestFail: this._stoppedDueToUnhandledErrorInTestFail
      };
      for (const test of this._skipRemainingTestsInSuite?.allTests() || []) {
        if (entries.has(test.id))
          donePayload.skipTestsDueToSetupFailure.push(test.id);
      }
      this.dispatchEvent("done", donePayload);
      this._fatalErrors = [];
      this._skipRemainingTestsInSuite = void 0;
      this._runFinished.resolve();
    }
  }
  async customMessage(payload) {
    try {
      if (this._currentTest?.testId !== payload.testId)
        throw new Error("Test has already stopped");
      const response = await this._currentTest._onCustomMessageCallback?.(payload.request);
      return { response };
    } catch (error) {
      return { response: {}, error: import_common3.ipc.toTestInfoErrorPayload(testInfoError(error)) };
    }
  }
  resume(payload) {
    this._resumePromise?.resolve(payload);
  }
  async _runTest(test, retry, nextTest) {
    const testInfo = new TestInfoImpl(this._config, this._project, this._params, test, retry, {
      onStepBegin: (payload) => this.dispatchEvent("stepBegin", payload),
      onStepEnd: (payload) => this.dispatchEvent("stepEnd", payload),
      onAttach: (payload) => this.dispatchEvent("attach", payload),
      onTestPaused: (payload) => {
        this._resumePromise = new ManualPromise5();
        this.dispatchEvent("testPaused", payload);
        return this._resumePromise;
      }
    });
    const processAnnotation = (annotation) => {
      testInfo.annotations.push(annotation);
      switch (annotation.type) {
        case "fixme":
        case "skip":
          testInfo.expectedStatus = "skipped";
          break;
        case "fail":
          if (testInfo.expectedStatus !== "skipped")
            testInfo.expectedStatus = "failed";
          break;
        case "slow":
          testInfo._timeoutManager.slow();
          break;
      }
    };
    if (!this._isStopped)
      this._fixtureRunner.setPool(test._pool);
    const suites = getSuites(test);
    const reversedSuites = suites.slice().reverse();
    const nextSuites = new Set(getSuites(nextTest));
    testInfo._timeoutManager.setTimeout(test.timeout);
    for (const annotation of test.annotations)
      processAnnotation(annotation);
    for (const suite of suites) {
      const extraAnnotations = this._activeSuites.get(suite) || [];
      for (const annotation of extraAnnotations)
        processAnnotation(annotation);
    }
    this._currentTest = testInfo;
    globals.setCurrentTestInfo(testInfo);
    (0, import_expect.setExpectConfig)({
      testInfo,
      filteredStackTrace: filteredStackTrace4,
      ignoreSnapshots: testInfo._projectInternal.project.ignoreSnapshots,
      updateSnapshots: testInfo.config.updateSnapshots,
      timeout: testInfo._projectInternal.expect?.timeout,
      toHaveScreenshot: testInfo._projectInternal.expect?.toHaveScreenshot,
      toMatchSnapshot: testInfo._projectInternal.expect?.toMatchSnapshot,
      toMatchAriaSnapshot: testInfo._projectInternal.expect?.toMatchAriaSnapshot,
      toPass: testInfo._projectInternal.expect?.toPass
    });
    this.dispatchEvent("testBegin", buildTestBeginPayload(testInfo));
    const isSkipped = testInfo.expectedStatus === "skipped";
    const hasAfterAllToRunBeforeNextTest = reversedSuites.some((suite) => {
      return this._activeSuites.has(suite) && !nextSuites.has(suite) && suite._hooks.some((hook) => hook.type === "afterAll");
    });
    if (isSkipped && nextTest && !hasAfterAllToRunBeforeNextTest) {
      testInfo.status = "skipped";
      this.dispatchEvent("testEnd", buildTestEndPayload(testInfo));
      return;
    }
    this._totalRunningTests++;
    this._lastRunningTests.push(test);
    if (this._lastRunningTests.length > 10)
      this._lastRunningTests.shift();
    let shouldRunAfterEachHooks = false;
    testInfo._allowSkips = true;
    await (async () => {
      await testInfo._runWithTimeout({ type: "test" }, async () => {
        const traceFixtureRegistration = test._pool.resolve("trace");
        if (!traceFixtureRegistration)
          return;
        if (typeof traceFixtureRegistration.fn === "function")
          throw new Error(`"trace" option cannot be a function`);
        await testInfo._tracing.startIfNeeded(traceFixtureRegistration.fn);
      });
      if (this._isStopped || isSkipped) {
        testInfo.status = "skipped";
        return;
      }
      await removeFolders([testInfo.outputDir]);
      let testFunctionParams = null;
      await testInfo._runAsStep({ title: "Before Hooks", category: "hook" }, async () => {
        for (const suite of suites)
          await this._runBeforeAllHooksForSuite(suite, testInfo);
        shouldRunAfterEachHooks = true;
        await this._runEachHooksForSuites(suites, "beforeEach", testInfo);
        const params = await this._fixtureRunner.resolveParametersForFunction(test.fn, testInfo, "test", { type: "test" });
        if (params !== null)
          testFunctionParams = params.result;
      });
      if (testFunctionParams === null) {
        return;
      }
      await testInfo._runWithTimeout({ type: "test" }, async () => {
        const fn = test.fn;
        await fn(testFunctionParams, testInfo);
      });
    })().catch(() => {
    });
    testInfo.duration = testInfo._timeoutManager.defaultSlot().elapsed | 0;
    testInfo._allowSkips = true;
    const afterHooksTimeout = calculateMaxTimeout(this._project.project.timeout, testInfo.timeout);
    const afterHooksSlot = { timeout: afterHooksTimeout, elapsed: 0 };
    await testInfo._runAsStep({ title: "After Hooks", category: "hook" }, async () => {
      let firstAfterHooksError;
      try {
        await testInfo._runWithTimeout({ type: "test", slot: afterHooksSlot }, () => testInfo._didFinishTestFunction());
      } catch (error) {
        firstAfterHooksError = firstAfterHooksError ?? error;
      }
      try {
        if (shouldRunAfterEachHooks)
          await this._runEachHooksForSuites(reversedSuites, "afterEach", testInfo, afterHooksSlot);
      } catch (error) {
        firstAfterHooksError = firstAfterHooksError ?? error;
      }
      testInfo._tracing.didFinishTestFunctionAndAfterEachHooks();
      try {
        await this._fixtureRunner.teardownScope("test", testInfo, { type: "test", slot: afterHooksSlot });
      } catch (error) {
        firstAfterHooksError = firstAfterHooksError ?? error;
      }
      for (const suite of reversedSuites) {
        if (!nextSuites.has(suite) || testInfo._isFailure()) {
          try {
            await this._runAfterAllHooksForSuite(suite, testInfo);
          } catch (error) {
            firstAfterHooksError = firstAfterHooksError ?? error;
          }
        }
      }
      if (firstAfterHooksError)
        throw firstAfterHooksError;
    }).catch(() => {
    });
    if (testInfo._isFailure())
      this._isStopped = true;
    if (this._isStopped) {
      this._didRunFullCleanup = true;
      await testInfo._runAsStep({ title: "Worker Cleanup", category: "hook" }, async () => {
        let firstWorkerCleanupError;
        const teardownSlot = { timeout: this._project.project.timeout, elapsed: 0 };
        try {
          await this._fixtureRunner.teardownScope("test", testInfo, { type: "test", slot: teardownSlot });
        } catch (error) {
          firstWorkerCleanupError = firstWorkerCleanupError ?? error;
        }
        for (const suite of reversedSuites) {
          try {
            await this._runAfterAllHooksForSuite(suite, testInfo);
          } catch (error) {
            firstWorkerCleanupError = firstWorkerCleanupError ?? error;
          }
        }
        try {
          await this._fixtureRunner.teardownScope("worker", testInfo, { type: "teardown", slot: teardownSlot });
        } catch (error) {
          firstWorkerCleanupError = firstWorkerCleanupError ?? error;
        }
        if (firstWorkerCleanupError)
          throw firstWorkerCleanupError;
      }).catch(() => {
      });
    }
    const tracingSlot = { timeout: this._project.project.timeout, elapsed: 0 };
    await testInfo._runWithTimeout({ type: "test", slot: tracingSlot }, async () => {
      await testInfo._tracing.stopIfNeeded();
    }).catch(() => {
    });
    testInfo.duration = testInfo._timeoutManager.defaultSlot().elapsed + afterHooksSlot.elapsed | 0;
    this._currentTest = null;
    globals.setCurrentTestInfo(null);
    (0, import_expect.setExpectConfig)({ testInfo: null, filteredStackTrace: filteredStackTrace4, ignoreSnapshots: false, updateSnapshots: "missing" });
    this.dispatchEvent("testEnd", buildTestEndPayload(testInfo));
    const preserveOutput = this._config.config.preserveOutput === "always" || this._config.config.preserveOutput === "failures-only" && testInfo._isFailure();
    if (!preserveOutput)
      await removeFolders([testInfo.outputDir]);
  }
  _collectHooksAndModifiers(suite, type, testInfo) {
    const runnables = [];
    for (const modifier of suite._modifiers) {
      const modifierType = this._fixtureRunner.dependsOnWorkerFixturesOnly(modifier.fn, modifier.location) ? "beforeAll" : "beforeEach";
      if (modifierType !== type)
        continue;
      const fn = async (fixtures3) => {
        const result = await modifier.fn(fixtures3);
        testInfo._modifier(modifier.type, modifier.location, [!!result, modifier.description]);
      };
      import_common3.fixtures.inheritFixtureNames(modifier.fn, fn);
      runnables.push({
        title: `${modifier.type} modifier`,
        location: modifier.location,
        type: modifier.type,
        fn
      });
    }
    runnables.push(...suite._hooks.filter((hook) => hook.type === type));
    return runnables;
  }
  async _runBeforeAllHooksForSuite(suite, testInfo) {
    if (this._activeSuites.has(suite))
      return;
    const extraAnnotations = [];
    this._activeSuites.set(suite, extraAnnotations);
    await this._runAllHooksForSuite(suite, testInfo, "beforeAll", extraAnnotations);
  }
  async _runAllHooksForSuite(suite, testInfo, type, extraAnnotations) {
    let firstError;
    for (const hook of this._collectHooksAndModifiers(suite, type, testInfo)) {
      try {
        await testInfo._runAsStep({ title: hook.title, category: "hook", location: hook.location }, async () => {
          const timeSlot = { timeout: this._project.project.timeout, elapsed: 0 };
          const runnable = { type: hook.type, slot: timeSlot, location: hook.location };
          const existingAnnotations = new Set(testInfo.annotations);
          try {
            await this._fixtureRunner.resolveParametersAndRunFunction(hook.fn, testInfo, "all-hooks-only", runnable);
          } finally {
            if (extraAnnotations) {
              const newAnnotations = testInfo.annotations.filter((a) => !existingAnnotations.has(a));
              extraAnnotations.push(...newAnnotations);
            }
            await this._fixtureRunner.teardownScope("test", testInfo, runnable);
          }
        });
      } catch (error) {
        firstError = firstError ?? error;
        if (type === "beforeAll" && error instanceof TestSkipError)
          break;
        if (type === "beforeAll" && !this._skipRemainingTestsInSuite) {
          this._skipRemainingTestsInSuite = suite;
        }
      }
    }
    if (firstError)
      throw firstError;
  }
  async _runAfterAllHooksForSuite(suite, testInfo) {
    if (!this._activeSuites.has(suite))
      return;
    this._activeSuites.delete(suite);
    await this._runAllHooksForSuite(suite, testInfo, "afterAll");
  }
  async _runEachHooksForSuites(suites, type, testInfo, slot) {
    let firstError;
    const hooks = suites.map((suite) => this._collectHooksAndModifiers(suite, type, testInfo)).flat();
    for (const hook of hooks) {
      const runnable = { type: hook.type, location: hook.location, slot };
      if (testInfo._timeoutManager.isTimeExhaustedFor(runnable)) {
        continue;
      }
      try {
        await testInfo._runAsStep({ title: hook.title, category: "hook", location: hook.location }, async () => {
          await this._fixtureRunner.resolveParametersAndRunFunction(hook.fn, testInfo, "test", runnable);
        });
      } catch (error) {
        firstError = firstError ?? error;
        if (error instanceof TestSkipError)
          break;
      }
    }
    if (firstError)
      throw firstError;
  }
};
function buildTestBeginPayload(testInfo) {
  return {
    testId: testInfo.testId,
    startWallTime: testInfo._startWallTime
  };
}
function buildTestEndPayload(testInfo) {
  return {
    testId: testInfo.testId,
    duration: testInfo.duration,
    status: testInfo.status,
    errors: testInfo.errors.map(import_common3.ipc.toTestInfoErrorPayload),
    hasNonRetriableError: testInfo._hasNonRetriableError,
    expectedStatus: testInfo.expectedStatus,
    annotations: testInfo.annotations,
    timeout: testInfo.timeout
  };
}
function getSuites(test) {
  const suites = [];
  for (let suite = test?.parent; suite; suite = suite.parent)
    suites.push(suite);
  suites.reverse();
  return suites;
}
function formatTestTitle(test, projectName) {
  const [, ...titles] = test.titlePath();
  const location = `${relativeFilePath(test.location.file)}:${test.location.line}:${test.location.column}`;
  const projectTitle = projectName ? `[${projectName}] \u203A ` : "";
  return `${projectTitle}${location} \u203A ${titles.join(" \u203A ")}`;
}
function calculateMaxTimeout(t1, t2) {
  return !t1 || !t2 ? 0 : Math.max(t1, t2);
}
var create = (params) => new WorkerMain(params);

// packages/playwright/src/worker/workerProcessEntry.ts
(0, import_common4.startProcessRunner)(create);
