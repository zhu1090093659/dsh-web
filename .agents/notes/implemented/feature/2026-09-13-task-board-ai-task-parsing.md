# Agent Note: AI parsing of pasted text into the new-task form

Status: implemented

## Problem

Issue #1540 asked the board to turn pasted text, such as a conversation copied from a messenger, into a task by extracting and classifying its content and prefilling title, description, and execution prompt. The earlier proposal was blocked on one question: which model pays for the parse. The reporter answered it — use the models of the deployment's configured providers, let the user choose, and default to any of them.

## Decision

The new-task form carries a paste box, a model picker, and one action button. The picker is built from the same `executionOptions.models` roster the task's own model pin uses, with the first entry preselected. `POST {TASK_BOARD_API_PREFIX}/parse` sits behind the board's existing loopback and same-origin fence, accepts `{ text, model }`, and answers `{ ok: true, draft }` or a typed failure whose code maps onto a status: `no-model` 503, `parse-failed` and `model-error` 502, `timeout` 504. The client phrases each code in the active language, so no status code reaches the form.

The Host resolves the `llm` service lazily per request and deliberately does not list it in the plugin's `inject` array: a deployment without a model must still mount the whole board, and the route then answers `no-model` instead of the plugin failing to load. One `llm.stream` call runs on the qualified `provider/model` route with a system prompt that demands a single JSON object, a 45 s budget, and an abort wired to the client disconnecting. Extraction strips code fences and reads the first JSON object; an unusable reply falls back to the pasted text for the title and prompt, so nothing the user wrote is lost.

The draft fills title, description, and run prompt only. Nothing reaches the ledger until the user submits the form, so a model cannot create or execute a task on its own.

## Alternatives considered

Guessing the route from the first registered provider was rejected: the reporter asked for a user-visible choice, and a silent guess would spend an arbitrary model's quota.

Injecting `llm` in the plugin's `inject` array was rejected: cordis refuses to load a plugin whose injected service is missing, so one absent model service would take the whole board down.

Declaring `@deepseek-ai/dsh-llm` in the package's own devDependencies was the first choice and is not possible here: this checkout cannot reach the registry that serves the workspace's SDK packages, so the version cannot be added to the lockfile. The type graph is satisfied through the root devDependency instead; the runtime import stays legitimate because the runtime-deps gate treats `@deepseek-ai/*` as host-provided.

Validating the model reply with a schema library was rejected: the draft is three strings and the form is the review step, so a hand-written extraction with fallbacks carries the same guarantee with less surface.

Creating the task directly from the model reply was rejected: a pasted note can carry injected instructions, and the user must see the fields before they become a task.

## Consequences

Every parse spends the deployment's own model quota; the action is explicit, cancellable, and bounded by the timeout. Only three fields come back, so tags, schedules, and execution pins stay manual. The model call itself is not exercised in this repository's environment — there is no model channel here — so the shipped evidence is a fake `llm` service plus the route, transport, and form tests.

## Testing

`tests/host-ai.spec.ts` covers route splitting, reply extraction, the fallbacks, the abort and timeout paths, and the empty paste. `tests/host-routes.spec.ts` covers the fence, every failure status, and the input cap. `tests/host-api.spec.ts` covers the browser-side classification, and `tests/ai-parse.spec.tsx` covers section visibility, the prefill, and the failure copy.
