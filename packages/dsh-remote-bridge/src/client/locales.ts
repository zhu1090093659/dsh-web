/**
 * `remote-bridge` namespace dictionaries: the protocol v1 pairing panel copy and
 * the header of an interactive card (§35.11).
 *
 * The panel has one job — put the live one-shot code in front of the operator as
 * a QR symbol — so its copy carries what to do with the symbol, how long it
 * lives, what kind of address the phone will dial, why the code is single-use,
 * and that the app is still in testing: the reader is told what they are joining
 * and where to ask about it. No key renders the public origin: the symbol
 * already carries it, and a durable public hostname printed as text would
 * outlive every screenshot it appears in. A LAN literal is not that fact — it
 * answers only inside the network this page is already on — so the LAN line
 * keeps naming it. No key states how the host finds either address, and no key
 * names the wire protocol: both are implementation facts the reader cannot act
 * on.
 *
 * The card's keys say only what the transcript row can act on: whether the page
 * is still waiting for the operator, that it is over, that this desktop renders
 * without answering, and that a page carrying nothing or too much draws a
 * sentence instead of a frame.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'entry.label': '配对 iPhone',
  'title': 'iOS App 配对',
  'subtitle': '用 iOS App（内测）扫描二维码，把 iPhone 连到这台电脑上。配对码只在本机显示。',
  'state.reading': '正在取配对码…',
  'pair.qrLabel': '配对二维码',
  'pair.countdown': '剩余 {s} 秒',
  'pair.expired': '配对码已过期',
  'pair.refresh': '重新取码',
  'pair.usedHint': '配对码一次性有效：iPhone 一开始配对就作废，重新取码也会作废上一张。',
  'origin.public': '二维码已包含公网地址，扫码后 iPhone 自动连上这台电脑',
  'origin.lan': '二维码指向局域网地址 {origin}，iPhone 需与本机在同一网络',
  'origin.missing': '没有找到公网地址：先在 App 里把连接地址填成你的公网中继，再扫码。本页的 {host} 只有本机能连。',
  'community.invite': 'iOS App 还在内测，欢迎来 Discord 交流',
  'forbidden.title': '这个页面不是从本机打开的',
  'forbidden.body': '配对码只能在本机 Web UI 上取。请在本机浏览器打开 http://127.0.0.1:<端口> 后重试。',
  'failed.title': '取配对码失败',
  'failed.body': '宿主返回了 HTTP {status}，请刷新页面后重试。',
  'unreachable.title': '无法连接本机宿主',
  'unreachable.body': '请求没有到达宿主，请确认 dsh web 仍在运行后重试。',
  'action.close': '关闭',
  'action.copy': '复制配对码',
  'action.copied': '已复制',
  'action.copyFailed': '复制失败',
  'action.retry': '重试',
  'card.waiting': '等你操作',
  'card.settled': '已结算',
  'card.answerOnPhone': '在手机上作答',
  'card.interacted': '已收到页面上的操作，但桌面端不作答：在手机上作答',
  'card.frameLabel': '整页卡片',
  'card.empty': '这次调用没有可渲染的页面',
  'card.oversize': '页面超出大小上限，未渲染',
} as const

/** English dictionary, key-for-key with the zh source. */
export const en: Record<RemoteBridgeKey, string> = {
  'entry.label': 'Pair an iPhone',
  'title': 'iOS app pairing',
  'subtitle': 'Scan the QR code with the iOS app (beta) to connect an iPhone to this computer. The code is shown only on this machine.',
  'state.reading': 'Requesting a pairing code…',
  'pair.qrLabel': 'Pairing QR code',
  'pair.countdown': '{s} s left',
  'pair.expired': 'The pairing code expired',
  'pair.refresh': 'New code',
  'pair.usedHint': 'The code is single-use: pairing spends it, and a new code voids the previous one.',
  'origin.public': 'The QR code carries the public address: the iPhone connects to this computer as soon as it scans',
  'origin.lan': 'The QR code points at the LAN address {origin}: the iPhone must be on the same network',
  'origin.missing': 'No public address found: set the connection address in the app to your public relay first, then scan. {host} (this page) is reachable only from this machine.',
  'community.invite': 'The iOS app is in beta. Come talk to us on Discord',
  'forbidden.title': 'This page is not open on this machine',
  'forbidden.body': 'Pairing codes can only be read from the machine itself. Open http://127.0.0.1:<port> in a browser on this machine and retry.',
  'failed.title': 'Could not read a pairing code',
  'failed.body': 'The host answered HTTP {status}. Reload the page and retry.',
  'unreachable.title': 'Cannot reach the local host',
  'unreachable.body': 'The request never reached the host. Check that dsh web is still running and retry.',
  'action.close': 'Close',
  'action.copy': 'Copy pairing code',
  'action.copied': 'Copied',
  'action.copyFailed': 'Copy failed',
  'action.retry': 'Retry',
  'card.waiting': 'Waiting for you',
  'card.settled': 'Settled',
  'card.answerOnPhone': 'Answer on the phone',
  'card.interacted': 'The page sent an action, but this desktop does not answer: answer on the phone',
  'card.frameLabel': 'Page card',
  'card.empty': 'This call carried no page to render',
  'card.oversize': 'The page is over the size limit and was not rendered',
}

/** Every key the `remote-bridge` namespace carries. */
export type RemoteBridgeKey = keyof typeof zh
