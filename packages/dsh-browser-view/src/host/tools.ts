/**
 * The eleven agent tools over the browser service.
 *
 * Shape of a result. Every tool but `browser_screenshot` returns structured
 * JSON, rendered as one pretty-printed text block: the model reads fields, not
 * prose, and the GUI can present the same value later. `browser_screenshot`
 * returns a real image part — an `ImageBlock` carrying a durable attachment
 * reference — because a screenshot smuggled in as base64 text is not an image to
 * any model that can see one.
 *
 * The screenshot path therefore needs the host's attachment service: the bytes
 * are committed through it, and the block only carries the reference. The
 * dependency is injected ({@link BrowserToolDeps.saveImage}) rather than read
 * from the context here, so these tools stay testable without a host.
 *
 * Why the descriptions are long: a model that does not know a `ref` expires
 * with its observation will happily click a stale one and report success. The
 * snapshot-first rule is the single most important sentence in this file, so it
 * appears in both tools that depend on it.
 *
 * @module @linxin666/dsh-client-ui-browser-view/host/tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ScreenshotRequest } from '../core/screenshot.ts'
import type { BrowserViewService } from './service.ts'

/** A durable image reference as the attachment service returns it. */
export interface DurableImageRef {
  /** Attachment id, unique within the host's attachment store. */
  attachmentId: string
  /** Media type of the stored image. */
  mediaType: string
  /** Stored byte length. */
  bytes: number
  /** Stored pixel width. */
  width: number
  /** Stored pixel height. */
  height: number
  /** Display name, when the store keeps one. */
  name?: string
}

/** File extension matching one screenshot media type. */
function extensionOf(mediaType: string): 'png' | 'jpg' {
  return mediaType === 'image/png' ? 'png' : 'jpg'
}

/** What the tools need from the host. */
export interface BrowserToolDeps {
  /** The browser service every tool drives. */
  service: BrowserViewService
  /**
   * Commit one screenshot (PNG or JPEG) to the host's durable attachment store.
   *
   * Absent when the composing host mounts no attachment service; the screenshot
   * tool then refuses with an explanation instead of returning text pretending
   * to be an image.
   */
  saveImage?: (input: { data: Uint8Array; mediaType: 'image/png' | 'image/jpeg'; name?: string }) => Promise<DurableImageRef>
}

/** One text block. */
function text(value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** Structured JSON rendered as the model-facing text block. */
function renderJson(value: unknown): ContentBlock[] {
  return text(JSON.stringify(value, null, 2))
}

/** Read the calling agent's session id without depending on the agent type. */
function sessionIdOf(exec: ToolRunContext): string | undefined {
  const agent = exec.agent as { session?: { id?: unknown } } | undefined
  const id = agent?.session?.id
  return typeof id === 'string' ? id : undefined
}

/** Shared tab selector parameter. */
const TAB_ID_PARAM = {
  type: 'string',
  description: 'Tab id from browser_tabs or a previous result. Omit to use the tab this session already uses.',
} as const

/** Shared element-target parameters. */
const TARGET_PARAMS = {
  ref: {
    type: 'integer',
    description: 'Depth-first ref from the most recent browser_snapshot. Valid only for that observation; re-snapshot after the page changes.',
  },
  selector: { type: 'string', description: 'CSS selector, when you already know the element and do not need a snapshot.' },
  x: { type: 'number', description: 'Viewport x in CSS pixels; pair it with y instead of ref or selector.' },
  y: { type: 'number', description: 'Viewport y in CSS pixels; pair it with x instead of ref or selector.' },
} as const

/** The tab reference every result carries. */
const TAB_FIELDS = {
  tabId: { type: 'string', required: true, description: 'Tab the result came from.' },
} as const

/** The action trace line every mutating tool returns. */
const SUMMARY_FIELD = {
  summary: { type: 'string', required: true, description: 'One-line description of what happened, also shown in the panel.' },
} as const

/** One snapshot node, mirroring the wire contract. */
const SNAPSHOT_NODE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'integer', required: true, description: 'Depth-first index; pass it to browser_click.' },
    tag: { type: 'string', required: true },
    id: { type: 'string' },
    classes: { type: 'array', items: { type: 'string' } },
    role: { type: 'string' },
    name: { type: 'string' },
    text: { type: 'string' },
    box: {
      type: 'object',
      additionalProperties: false,
      properties: {
        x: { type: 'number', required: true },
        y: { type: 'number', required: true },
        width: { type: 'number', required: true },
        height: { type: 'number', required: true },
      },
    },
    depth: { type: 'integer', required: true },
  },
} as const

/** Directory listing entry shape shared by `browser_tabs`. */
const TAB_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    url: { type: 'string', required: true },
    title: { type: 'string', required: true },
    loading: { type: 'boolean', required: true },
    sessionId: { type: 'string' },
    origin: { type: 'string', description: 'created when DSH opened the target; adopted when it already existed in the real browser.' },
  },
} as const

/**
 * Build every browser tool against one service.
 * @param deps - the service plus the optional attachment sink.
 * @returns the tool definitions, in registration order.
 */
export function createBrowserTools(deps: BrowserToolDeps): ToolDefinition[] {
  const { service } = deps

  const navigate = defineTool({
    name: 'browser_navigate',
    description: 'Navigate the selected browser tab to a URL and report the resulting page (url, title). '
      + 'This is a real Chromium either launched by the host or attached over CDP, so the page renders, runs scripts, and makes network requests exactly as it would for a user. '
      + 'Use it to inspect a local page or site, to verify rendered markup, or to set up a page before a snapshot, click, or screenshot. '
      + 'After navigating, call browser_snapshot before clicking anything: refs from before the navigation no longer exist. '
      + 'Without new_tab the call reuses this session\'s current tab, so the console and network buffers start over with the new document. '
      + 'Set new_tab to true to keep the current page and open the URL in an additional tab (browser_tabs then lists both). '
      + '中文触发词：打开网页、浏览器里看一下、访问这个地址、渲染页面、新标签页。',
    parameters: {
      url: { type: 'string', required: true, description: 'Absolute URL, including data: and about: URLs.' },
      new_tab: {
        type: 'boolean',
        description: 'When true, open the URL in a new tab and leave the current page untouched; the new tab becomes the active one. Defaults to false.',
      },
      tab_id: TAB_ID_PARAM,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...TAB_FIELDS,
          url: { type: 'string', required: true },
          title: { type: 'string', required: true },
          loading: { type: 'boolean', required: true },
          ...SUMMARY_FIELD,
        },
      },
      render: (_args, value) => renderJson(value),
    },
    execute: async (args, exec) => {
      const { outcome, tab } = await service.navigate(sessionIdOf(exec), args.url, args.tab_id, {
        newTab: args.new_tab === true,
      })
      return {
        tabId: outcome.tabId,
        url: tab.url,
        title: tab.title,
        loading: tab.loading,
        summary: outcome.summary,
      }
    },
  })

  const click = defineTool({
    name: 'browser_click',
    description: 'Click an element in the browser tab, using a ref from the most recent browser_snapshot, a CSS selector, or viewport x/y. '
      + 'A ref only identifies the node that existed when that snapshot ran: if the page has navigated or re-rendered since, call browser_snapshot again first, '
      + 'because a stale ref either matches nothing (the tool says so) or matches a different element (the click lands somewhere you did not intend). '
      + 'The click is dispatched as a real mouse event at the element centre, so focus, hover, and trusted-event handlers behave normally. '
      + '中文触发词：点击、按下按钮、点这个链接。',
    parameters: {
      ...TARGET_PARAMS,
      tab_id: TAB_ID_PARAM,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ...TAB_FIELDS, ...SUMMARY_FIELD },
      },
      render: (_args, value) => renderJson(value),
    },
    execute: async (args, exec) => {
      const outcome = await service.click(sessionIdOf(exec), {
        ref: args.ref,
        selector: args.selector,
        x: args.x,
        y: args.y,
      }, args.tab_id)
      return { tabId: outcome.tabId, summary: outcome.summary }
    },
  })

  const type = defineTool({
    name: 'browser_type',
    description: 'Insert text into the page. Without a target the text goes to whatever is focused; with a ref or selector the tool clicks that element first and then types. '
      + 'This inserts text the way an input method does, so it does not fire per-key handlers by itself: use browser_press afterwards when the page needs Enter, Tab, or a keystroke to commit. '
      + 'Like browser_click, a ref is only valid for the snapshot it came from. '
      + '中文触发词：输入、填写输入框、在搜索框里打字。',
    parameters: {
      text: { type: 'string', required: true, description: 'Text to insert.' },
      ...TARGET_PARAMS,
      tab_id: TAB_ID_PARAM,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...TAB_FIELDS,
          ...SUMMARY_FIELD,
          characters: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    execute: async (args, exec) => {
      const outcome = await service.type(sessionIdOf(exec), args.text, {
        ref: args.ref,
        selector: args.selector,
        x: args.x,
        y: args.y,
      }, args.tab_id)
      return { tabId: outcome.tabId, summary: outcome.summary, characters: [...args.text].length }
    },
  })

  const press = defineTool({
    name: 'browser_press',
    description: 'Press one key in the focused element: Enter, Tab, Escape, Backspace, Delete, Space, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, or a single character. '
      + 'Use it to submit a form after browser_type, to dismiss a dialog, or to move through a list. '
      + '中文触发词：按回车、按键、提交表单。',
    parameters: {
      key: { type: 'string', required: true, description: 'Key name from the list above, or one character.' },
      tab_id: TAB_ID_PARAM,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ...TAB_FIELDS, ...SUMMARY_FIELD },
      },
      render: (_args, value) => renderJson(value),
    },
    execute: async (args, exec) => {
      const outcome = await service.press(sessionIdOf(exec), args.key, args.tab_id)
      return { tabId: outcome.tabId, summary: outcome.summary }
    },
  })

  const scroll = defineTool({
    name: 'browser_scroll',
    description: 'Scroll the page by a pixel delta at a viewport point. Positive delta_y scrolls down, negative scrolls up; delta_x scrolls sideways. '
      + 'Use it before a screenshot that must show content below the fold, or to trigger lazy loading before a snapshot. '
      + '中文触发词：滚动、往下翻、滚动条。',
    parameters: {
      delta_y: { type: 'number', description: 'Vertical scroll distance in CSS pixels; positive is down.' },
      delta_x: { type: 'number', description: 'Horizontal scroll distance in CSS pixels; positive is right.' },
      x: { type: 'number', description: 'Viewport x where the wheel event lands. Defaults to the middle of the viewport.' },
      y: { type: 'number', description: 'Viewport y where the wheel event lands. Defaults to the middle of the viewport.' },
      tab_id: TAB_ID_PARAM,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ...TAB_FIELDS, ...SUMMARY_FIELD },
      },
      render: (_args, value) => renderJson(value),
    },
    execute: async (args, exec) => {
      const outcome = await service.scroll(sessionIdOf(exec), {
        deltaX: args.delta_x,
        deltaY: args.delta_y,
        x: args.x,
        y: args.y,
      }, args.tab_id)
      return { tabId: outcome.tabId, summary: outcome.summary }
    },
  })

  const snapshot = defineTool({
    name: 'browser_snapshot',
    description: 'Return a numbered, depth-first view of the page DOM: tag, id, classes, role, accessible name, visible text, and box for each node, with '
      + 'indentation given by depth. The ref numbers from this call are exactly what browser_click accepts. '
      + 'The walk is capped; when the result says truncated, work from the part you have (or scroll and snapshot again) rather than assuming the page is small. '
      + 'Always snapshot before clicking: it is what gives you a valid ref, and it is how you see what an action changed. '
      + '中文触发词：看看页面结构、DOM、有哪些元素、快照。',
    parameters: {
      tab_id: TAB_ID_PARAM,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...TAB_FIELDS,
          url: { type: 'string', required: true },
          title: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
          nodes: { type: 'array', required: true, items: SNAPSHOT_NODE_SCHEMA },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    execute: async (args, exec) => {
      const result = await service.snapshot(sessionIdOf(exec), args.tab_id)
      return {
        tabId: result.tabId,
        url: result.url,
        title: result.title,
        truncated: result.truncated,
        nodes: result.nodes,
      }
    },
  })

  const screenshot = defineTool({
    name: 'browser_screenshot',
    description: 'Capture the current tab as an image and return the image itself, not a description of it. '
      + 'Use it when the user should see the page, when layout or styling matters more than the DOM, or to check that something rendered correctly. '
      + 'The default is a lossless PNG of the whole visible viewport; scroll first if the region you need is off-screen. '
      + 'The full viewport is coarse to read: one visual token cell on the model side covers roughly 42x42 px of the image. '
      + 'To read detail, call browser_snapshot first, take the box of the node you care about, and capture just that region with clip (rendered at 2x unless scale says otherwise). '
      + '中文触发词：截图、看一下现在的页面、画面、放大看细节。',
    parameters: {
      clip: {
        type: 'object',
        additionalProperties: false,
        description: 'Region to capture, in CSS pixels inside the fixed viewport: the same coordinate space as a browser_snapshot box and '
          + 'the x/y of browser_click. Omit to capture the whole visible viewport.',
        properties: {
          x: { type: 'number', required: true, description: 'Left edge in CSS pixels.' },
          y: { type: 'number', required: true, description: 'Top edge in CSS pixels.' },
          width: { type: 'number', required: true, description: 'Region width in CSS pixels.' },
          height: { type: 'number', required: true, description: 'Region height in CSS pixels.' },
        },
      },
      scale: {
        type: 'integer',
        enum: [1, 2, 3],
        description: 'Render multiplier. Defaults to 2 when clip is given and 1 otherwise.',
      },
      format: {
        type: 'string',
        enum: ['png', 'jpeg'],
        description: "Encoded image format; 'png' is lossless and the default.",
      },
      tab_id: TAB_ID_PARAM,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...TAB_FIELDS,
          url: { type: 'string', required: true },
          title: { type: 'string', required: true },
          image: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => {
        const envelope = `<path>browser-view:screenshot/${value.tabId}.${extensionOf(value.image.mediaType)}</path>
<type>image</type>
<content>
${value.image.mediaType} screenshot, ${value.image.width}x${value.image.height} px, ${value.image.bytes} bytes
url: ${value.url}
title: ${value.title}
</content>`
        // The attachment service owns the bytes; the block only carries the
        // durable reference, which is precisely what an ImageBlock is. The cast
        // exists because the reference id is branded in the SDK's own module,
        // which this package does not depend on.
        const block = { type: 'image', attachment: value.image } as unknown as ContentBlock
        return [...text(envelope), block]
      },
    },
    execute: async (args, exec) => {
      const saveImage = deps.saveImage
      if (saveImage === undefined) {
        throw new Error('browser_screenshot needs the host attachment service to store the image; this host mounts none')
      }
      // Only the keys the caller actually gave: an absent format or scale lets
      // the service apply its own default, which is where "clip implies 2x" lives.
      const request: ScreenshotRequest = {}
      if (args.format !== undefined) request.format = args.format
      if (args.clip !== undefined) request.clip = args.clip
      if (args.scale !== undefined) request.scale = args.scale

      const shot = await service.screenshot(sessionIdOf(exec), args.tab_id, request)
      const ref = await saveImage({
        data: Buffer.from(shot.data, 'base64'),
        mediaType: shot.mediaType,
        name: `browser-view-${shot.tabId}.${extensionOf(shot.mediaType)}`,
      })
      return {
        tabId: shot.tabId,
        url: shot.url,
        title: shot.title,
        image: {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          ...ref.name === undefined ? {} : { name: ref.name },
        },
      }
    },
  })

  const consoleTool = defineTool({
    name: 'browser_console',
    description: 'Return the console entries the tab has captured (log, info, warn, error, debug), newest last. '
      + 'Use it to confirm a script ran, to read a value a page printed, or to find the error behind a page that looks wrong. '
      + 'The buffer is bounded, so a very chatty page only keeps the most recent entries. '
      + '中文触发词：控制台、console 报错、看看日志。',
    parameters: {
      limit: { type: 'integer', description: 'Maximum trailing entries to return (default 100).' },
      tab_id: TAB_ID_PARAM,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...TAB_FIELDS,
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                level: { type: 'string', required: true },
                text: { type: 'string', required: true },
                at: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    execute: async (args, exec) => {
      const result = await service.console(sessionIdOf(exec), args.limit ?? 100, args.tab_id)
      return { tabId: result.tabId, entries: result.entries }
    },
  })

  const networkTool = defineTool({
    name: 'browser_network',
    description: 'Return the network requests the tab has observed (url, method, status, mime type, failure text), newest last. '
      + 'Use it to check that a page called the endpoint you expected, to see why a resource failed, or to confirm a redirect. '
      + 'Status 0 means the request never received a response; read the failure field in that case. '
      + '中文触发词：网络请求、接口流量、请求记录。',
    parameters: {
      limit: { type: 'integer', description: 'Maximum trailing entries to return (default 100).' },
      tab_id: TAB_ID_PARAM,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...TAB_FIELDS,
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                url: { type: 'string', required: true },
                method: { type: 'string', required: true },
                status: { type: 'integer', required: true },
                mimeType: { type: 'string' },
                failure: { type: 'string' },
                at: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    execute: async (args, exec) => {
      const result = await service.network(sessionIdOf(exec), args.limit ?? 100, args.tab_id)
      return { tabId: result.tabId, entries: result.entries }
    },
  })

  const tabs = defineTool({
    name: 'browser_tabs',
    description: 'List the browser tabs this plugin currently has open, with their ids, urls, titles, and loading state. '
      + 'Call it when you need a tab id, when you are unsure whether a browser is running at all, or after the user closed a tab in the panel. '
      + 'In isolated mode it never starts a browser; in real-browser mode it connects to the configured CDP endpoint and discovers existing page tabs. '
      + '中文触发词：有多少标签页、当前浏览器状态、打开着哪些页面。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tabs: { type: 'array', required: true, items: TAB_VIEW_SCHEMA },
          activeTabId: {
            required: true,
            oneOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Tab the panel is watching, or null when no tab is open.',
          },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    execute: async () => {
      const result = await service.listTabs()
      return { tabs: result.tabs, activeTabId: result.activeTabId }
    },
  })

  const close = defineTool({
    name: 'browser_close',
    description: 'Close browser tabs within the ownership rules of the selected mode. '
      + 'Call it when the work in the browser is finished: a tab left open is a page still running on the host and a chip still sitting in the panel, and the next thing anyone sees is somebody else\'s leftover. '
      + 'Without tab_id it closes only tabs this session opened. In isolated mode an explicit tab_id must also belong to this session; in real-browser mode an explicit tab_id may close any listed page, including an adopted one. '
      + 'A session that owns no tab and omits tab_id closes nothing and still succeeds, so cleanup is safe to make unconditionally. '
      + '中文触发词：关掉网页、关闭标签页、收尾清理。',
    parameters: {
      tab_id: {
        type: 'string',
        description: 'Tab id from browser_tabs or a previous result. Omit to close every tab this session opened.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          closed: {
            type: 'array',
            required: true,
            items: { type: 'string' },
            description: 'Ids of the tabs this call actually closed, in close order.',
          },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    execute: async (args, exec) => {
      const closed = await service.closeOwnTabs(sessionIdOf(exec), args.tab_id)
      return { closed }
    },
  })

  return [navigate, click, type, press, scroll, snapshot, screenshot, consoleTool, networkTool, tabs, close]
}

/** Names of every tool this plugin registers, in registration order. */
export const BROWSER_TOOL_NAMES = [
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_press',
  'browser_scroll',
  'browser_snapshot',
  'browser_screenshot',
  'browser_console',
  'browser_network',
  'browser_tabs',
  'browser_close',
] as const
