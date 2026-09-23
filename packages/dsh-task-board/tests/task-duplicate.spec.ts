// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewTaskModal } from '../src/client/board/NewTaskModal.tsx'
import type { BoardController } from '../src/core/controller.ts'
import type { TaskRecord } from '../src/core/tasks.ts'
import { zh, en } from '../src/client/locales.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => { root.unmount() })
  }
  document.body.replaceChildren()
})

describe('task-board duplicate and edit copy feature (Issue #1413)', () => {
  const sampleTask: TaskRecord = {
    id: 'task-test-123',
    title: '每周 AI 资讯周报',
    description: '自动收集并整理 AI 资讯',
    prompt: '请抓取过去一周的热门 AI 项目并总结',
    status: 'todo',
    createdAt: 1000,
    updatedAt: 1000,
    workspaceId: 'ws-main',
    mode: 'preset-code',
    permission: 'workspace-write',
    model: 'deepseek-chat',
    schedule: {
      enabled: true,
      cron: '0 9 * * 1',
      nextRunAt: undefined,
      lastTriggeredAt: undefined,
    },
    executions: [
      {
        id: 'exec-1',
        sessionId: 'session-old-1',
        startedAt: 1050,
        endedAt: 1100,
        result: 'succeeded',
        error: undefined,
      },
    ],
  }

  it('has locale keys in both zh and en dictionaries', () => {
    expect(zh['detail.duplicate']).toBe('复制为新任务')
    expect(zh['detail.duplicateAndEdit']).toBe('修改并新建副本')
    expect(zh['new.duplicateTitle']).toBe('新建任务（副本）')
    expect(zh['new.archiveOriginal']).toBe('创建后归档原任务')

    expect(en['detail.duplicate']).toBe('Duplicate Task')
    expect(en['detail.duplicateAndEdit']).toBe('Edit as New Copy')
    expect(en['new.duplicateTitle']).toBe('New Task (Copy)')
    expect(en['new.archiveOriginal']).toBe('Archive original task upon creation')
  })

  it('pre-fills all form fields from initialTask template and shows archive checkbox', async () => {
    const mockController = {
      subscribe: vi.fn(() => () => {}),
      getSnapshot: vi.fn(() => ({
        tasks: [sampleTask],
        executionOptions: {
          workspaces: [{ workspaceId: 'ws-main', name: 'Main Workspace' }],
          presets: [{ id: 'preset-code', name: 'Code Agent' }],
          models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
        },
        pendingTaskIds: [],
        transportError: undefined,
      })),
      createTaskConfirmed: vi.fn().mockResolvedValue({
        ...sampleTask,
        id: 'task-new-456',
      }),
      archiveTask: vi.fn().mockResolvedValue(true),
    } as unknown as BoardController

    const onClose = vi.fn()
    const onDuplicateSuccess = vi.fn().mockResolvedValue(undefined)

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    roots.push(root)

    await act(async () => {
      root.render(
        createElement(NewTaskModal, {
          controller: mockController,
          onClose,
          initialTask: sampleTask,
          onDuplicateSuccess,
        }),
      )
    })

    // Title and Prompt should match the initialTask
    const titleInput = host.querySelector('input[placeholder="一句话描述要做什么"]') as HTMLInputElement
    expect(titleInput).not.toBeNull()
    expect(titleInput.value).toBe('每周 AI 资讯周报')

    const promptTextarea = host.querySelector('textarea[placeholder="发给 agent 的完整指令（留空则使用标题）"]') as HTMLTextAreaElement
    expect(promptTextarea).not.toBeNull()
    expect(promptTextarea.value).toBe('请抓取过去一周的热门 AI 项目并总结')

    // Archive checkbox should be present and checked by default
    const labels = Array.from(host.querySelectorAll('label'))
    const archiveLabel = labels.find(l => l.textContent?.includes(zh['new.archiveOriginal']))
    expect(archiveLabel).toBeDefined()
    const archiveCheckbox = archiveLabel?.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(archiveCheckbox).not.toBeNull()
    expect(archiveCheckbox.checked).toBe(true)

    // Click submit button
    const submitBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent === zh['new.submit'])
    expect(submitBtn).toBeDefined()

    await act(async () => {
      submitBtn?.click()
    })

    expect(mockController.createTaskConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '每周 AI 资讯周报',
        schedule: { enabled: true, cron: '0 9 * * 1' },
        workspaceId: 'ws-main',
        mode: 'preset-code',
        permission: 'workspace-write',
        model: 'deepseek-chat',
      }),
    )
    expect(onDuplicateSuccess).toHaveBeenCalledWith('task-test-123')
    expect(onClose).toHaveBeenCalled()
  })
})
