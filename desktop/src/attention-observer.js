'use strict';

/**
 * Renderer-side attention observer (issue #1498).
 *
 * The Electron shell loads the ordinary Web GUI, so without a DSH-side plugin
 * the only thing the shell can watch is the DOM. This script is injected into
 * the GUI's main world after every document load and reports three signals over
 * the preload bridge:
 *
 *   approval     a run is waiting for the user (approval, question, plan review)
 *   completed    a conversation turn ended
 *   interrupted  a turn ended in an error, or with interrupted tool calls
 *
 * It reads only deliberately-attributed hooks, never CSS-modules hashes:
 *
 *   :is([data-approval-key], [data-question-key], [data-plan-review-key])
 *       the composer takeovers rendered while a run waits for the user
 *       (client/ui-approval ApprovalPanel.tsx, ui-user-questions)
 *   [data-chat-flow-kind="turn-tail"]
 *       the node the chat layout publishes for EVERY ended turn whatever the
 *       reason (ui-chat chat-snapshot-builder: "Every ended Turn publishes its
 *       turn-tail Node on turn/end whatever the reason"), so an increase in the
 *       count is exactly one settled turn
 *   [data-chat-flow-kind="turn-error"]
 *       the node published when turn/end carried reason.kind === 'error'
 *   [data-state="stopped"]
 *       ui-tool tool rows whose call was interrupted
 *
 * Signs only increase: sessions keep their history in the flow, the counts are
 * cumulative, and a decrease (switching conversations, a reload) means nothing.
 * The main process re-validates every signal and drops it while the window is
 * focused, so false positives from background re-renders cannot flash anything.
 *
 * The file is plain browser script: the Electron main process injects its
 * source into the page, while desktop/tests requires it for the decision tests,
 * so the pure parts stay free of DOM access and the whole body sits in one IIFE
 * (the page's global scope must not collect lexical declarations).
 */
(function (global, moduleRef) {
  /** Composer takeovers that mean "this run cannot continue without you". */
  var PENDING_SELECTOR = ':is([data-approval-key], [data-question-key], [data-plan-review-key])';
  /** The turn-tail node: exactly one per ended turn. */
  var SETTLED_SELECTOR = '[data-chat-flow-kind="turn-tail"]';
  /** The turn-error node: an ended turn whose reason was an error. */
  var ERROR_SELECTOR = '[data-chat-flow-kind="turn-error"]';
  /** Tool rows whose call was interrupted. */
  var STOPPED_SELECTOR = '[data-state="stopped"]';
  /**
   * How long to let a DOM burst settle before believing it: one settlement
   * rewrites several nodes, and a virtualized list can unmount and remount rows
   * in the same tick.
   */
  var SETTLE_MS = 1500;

  /**
   * Compare two attention snapshots and return the signals that just happened.
   * The first call only primes the state: a page that loads with history on
   * screen must not claim that a turn just ended.
   */
  function decideAttention(previous, next) {
    if (previous === undefined) return [];
    var signals = [];
    if (next.pending > previous.pending) signals.push('approval');
    if (next.settled > previous.settled) {
      var disrupted = next.errors > previous.errors || next.stopped > previous.stopped;
      signals.push(disrupted ? 'interrupted' : 'completed');
    }
    return signals;
  }

  /** Read the four counts off a Document (or any Element-shaped root). */
  function readAttentionState(root) {
    return {
      pending: root.querySelectorAll(PENDING_SELECTOR).length,
      settled: root.querySelectorAll(SETTLED_SELECTOR).length,
      errors: root.querySelectorAll(ERROR_SELECTOR).length,
      stopped: root.querySelectorAll(STOPPED_SELECTOR).length,
    };
  }

  /** Report one signal through the preload bridge; a missing bridge is not fatal. */
  function report(win, kind) {
    try {
      var bridge = win.desktop;
      if (bridge !== undefined && bridge !== null && typeof bridge.notify === 'function') bridge.notify(kind);
    } catch (error) {
      // The bridge belongs to the shell; the page may replace or drop it.
    }
  }

  /**
   * Install the observer on a window-like object.
   * @returns {() => void} disposer (used by tests; the page keeps it forever).
   */
  function installAttentionObserver(win) {
    var doc = win.document;
    if (doc === undefined || doc === null) return function () {};
    var previous = readAttentionState(doc);
    var timer = null;
    var disposed = false;

    function flush() {
      timer = null;
      if (disposed) return;
      var next = readAttentionState(doc);
      var signals = decideAttention(previous, next);
      previous = next;
      for (var index = 0; index < signals.length; index += 1) report(win, signals[index]);
    }

    var observer = new win.MutationObserver(function () {
      if (timer !== null) return;
      timer = win.setTimeout(flush, SETTLE_MS);
    });
    observer.observe(doc.documentElement !== undefined && doc.documentElement !== null ? doc.documentElement : doc, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    return function () {
      disposed = true;
      if (timer !== null) win.clearTimeout(timer);
      observer.disconnect();
    };
  }

  var api = {
    PENDING_SELECTOR: PENDING_SELECTOR,
    SETTLED_SELECTOR: SETTLED_SELECTOR,
    ERROR_SELECTOR: ERROR_SELECTOR,
    STOPPED_SELECTOR: STOPPED_SELECTOR,
    SETTLE_MS: SETTLE_MS,
    decideAttention: decideAttention,
    readAttentionState: readAttentionState,
    installAttentionObserver: installAttentionObserver,
  };

  if (moduleRef !== undefined && moduleRef.exports !== undefined) moduleRef.exports = api;
  if (global.window !== undefined && global.window !== null && global.window.__dshAttentionObserver === undefined) {
    global.window.__dshAttentionObserver = installAttentionObserver(global.window);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, typeof module !== 'undefined' ? module : undefined);
