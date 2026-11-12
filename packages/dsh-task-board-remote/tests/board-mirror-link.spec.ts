/**
 * The one fact the phone's task/team join stands on: a mirror card's team payload
 * crosses the bridge unchanged.
 *
 * `RemoteKit` (the iOS remote) keys a board card to its hub issue. Before this
 * suite the only identifier that reached the phone was the first prompt line
 * `buildMirrorDraft` writes; the provider's own payload
 * (`integrations['task-board-team']`, holding `issueId`, `issueNumber`,
 * `leaseExpiresAt`, `agentId` and `hubStatus`) was already in the ledger but no
 * one had shown it survives the trip. This suite drives the REAL board — its
 * ledger file, its Host service — and the REAL `board.snapshot` handler, so the
 * assertion is about the bytes a paired phone receives rather than about a double
 * of them.
 *
 * @module dsh-task-board-remote/tests/board-mirror-link
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HostTaskLedger } from '../../dsh-task-board/src/host-ledger.ts'
import { TaskBoardHostService } from '../../dsh-task-board/src/host-service.ts'
import { PowerInhibitor } from '../../dsh-task-board/src/power-inhibitor.ts'
import { fixtureWorkspaces } from '../../dsh-task-board/tests/workspace-fixture.ts'
import type { BoardCall, BoardFace, BoardMethodResult } from '../src/core/seam.ts'
import { createBoardMethods } from '../src/core/methods.ts'
import { METHOD_BOARD_SNAPSHOT } from '../src/protocol.ts'

const NOW = 1_793_321_200_000

/** The card a claimed hub issue becomes, with the provider's own payload on it. */
const payload = {
  issueId: 'issue_01j7b5w8m4f9q2e3r6t1y8u4ib',
  issueNumber: 11,
  attemptId: 'attempt_01j7',
  leaseExpiresAt: 1_793_321_214_072,
  agentId: 'agent_01M6541Q9GHKET58MJY8G443SD',
  agentMemberId: 'b770f5a6-4553-4899-8760-daceda716d43',
  preset: 'liangshen',
  hubStatus: 'in_review',
}

const mirrorCard = {
  id: 'card-mirror-11',
  title: '#11 Confirm the hello capability name',
  description: 'Confirm the hello capability name',
  prompt: 'Team issue issue_01j7b5w8m4f9q2e3r6t1y8u4ib (issue #11) claimed for agent qa-bot.\n\nBody',
  status: 'running',
  createdAt: NOW - 60_000,
  updatedAt: NOW - 1_000,
  executions: [{ id: 'exec-1', startedAt: NOW - 30_000 }],
  integrations: { 'task-board-team': payload },
}

const localCard = {
  id: 'card-local',
  title: 'Write the release note',
  description: '',
  prompt: 'Write the release note',
  status: 'todo',
  createdAt: NOW - 5_000,
  updatedAt: NOW - 5_000,
  executions: [],
}

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-board-mirror-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** The real board over a ledger file that already holds the two cards. */
function boardOver(cards: readonly Record<string, unknown>[]): { face: BoardFace; dispose: () => void } {
  const root = tempRoot()
  writeFileSync(join(root, 'ledger-v2.json'), JSON.stringify({
    schemaVersion: 6,
    revision: 3,
    tasks: cards,
    scheduler: {},
  }), 'utf8')
  const ledger = new HostTaskLedger(root, () => NOW)
  // The runner is the one collaborator a read-only suite never reaches, so it is
  // the narrowest stand-in; the ledger and the service under test are the real ones.
  const gateway = { invoke: async () => ({}) } as unknown as ConstructorParameters<typeof TaskBoardHostService>[0]
  const service = new TaskBoardHostService(gateway, {
    ledger,
    power: new PowerInhibitor({ platform: 'linux' }),
    now: () => NOW,
    workspaceRegistry: fixtureWorkspaces([]),
  })
  return {
    face: service as unknown as BoardFace,
    dispose: () => { ledger.dispose?.() },
  }
}

/** The answer one `board.snapshot` call carries, or undefined when it refused. */
function snapshotOf(board: BoardFace): Record<string, unknown> {
  const methods = createBoardMethods({ board: () => board })
  const call = { connectionId: 'connection-1' } as unknown as BoardCall
  const answer = methods[METHOD_BOARD_SNAPSHOT]?.({}, call) as BoardMethodResult
  expect(answer.ok).toBe(true)
  return (answer as { r: Record<string, unknown> }).r
}

describe('a mirror card reaches the phone with its provider payload', () => {
  it('user receives the mirror card with its team payload unchanged inside board.snapshot', () => {
    // Given a ledger holding the mirror card the team provider created
    const { face, dispose } = boardOver([mirrorCard, localCard])
    try {
      // When the phone reads the board
      const body = snapshotOf(face)
      const tasks = body.tasks as Array<Record<string, unknown>>
      const mirror = tasks.find(task => task.id === 'card-mirror-11')

      // Then the card carries the provider's payload as the ledger stored it
      expect(mirror?.integrations).toEqual({ 'task-board-team': payload })
      const team = (mirror!.integrations as Record<string, Record<string, unknown>>)['task-board-team']
      expect(team).toMatchObject({
        issueId: payload.issueId,
        issueNumber: payload.issueNumber,
        leaseExpiresAt: payload.leaseExpiresAt,
        agentId: payload.agentId,
        hubStatus: payload.hubStatus,
      })
      // The first prompt line still travels, and is still the whole of what a
      // client written before the payload could read.
      expect(String(mirror?.prompt)).toContain(`Team issue ${payload.issueId} (issue #11)`)
    } finally {
      dispose()
    }
  })

  it('user receives a card that has no payload and nothing is invented for it', () => {
    // Given a board whose only card is local
    const { face, dispose } = boardOver([localCard])
    try {
      // When the phone reads the board
      const body = snapshotOf(face)
      const tasks = body.tasks as Array<Record<string, unknown>>
      // Then nothing was invented for it: the bytes carry no container at all,
      // rather than an empty one a reader would have to tell apart from a payload
      expect(tasks).toHaveLength(1)
      const wire = JSON.parse(JSON.stringify(tasks[0])) as Record<string, unknown>
      expect(wire).not.toHaveProperty('integrations')
    } finally {
      dispose()
    }
  })
})
