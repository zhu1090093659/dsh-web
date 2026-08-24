# Agent Note: Market Card Copy Fallback Status Accuracy

Status: implemented

## Problem

Issue #1091: in `packages/dsh-market/src/client/MarketCard.tsx`, the `copyCommand()` helper handles plugin installation command copying. When `navigator.clipboard.writeText()` is unavailable or rejects, it falls back to `document.execCommand('copy')`. The fallback ignored the boolean return value and any execution errors, and caller code unconditionally transitioned the button state to "copied" (`done()`), falsely reporting success even when the write failed.

## Decision

Refactor `copyCommand` so that `fallback()` safely executes `document.execCommand('copy')` inside a try-catch block and returns a `boolean`. Both the clipboard rejection handler and the legacy fallback branch only invoke `done()` when `fallback() === true`. Added regression unit tests in `packages/dsh-market/tests/market-card.spec.tsx` verifying that copying failure leaves button status unchanged.

## Impact

Zero visual or functional regression on happy paths; copy feedback accurately reflects successful clipboard write operations under restrictive browser environments or fallback failure scenarios.
