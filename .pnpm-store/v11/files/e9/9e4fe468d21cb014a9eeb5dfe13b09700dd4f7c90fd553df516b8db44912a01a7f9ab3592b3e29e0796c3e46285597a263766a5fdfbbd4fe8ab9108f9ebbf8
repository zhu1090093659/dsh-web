# birpc

[![NPM version](https://img.shields.io/npm/v/birpc?color=a1b858&label=)](https://www.npmjs.com/package/birpc)

Message-based two-way remote procedure call. Useful for WebSockets and Workers communication.

## Features

- Intuitive - call remote functions just like locals, with Promise to get the response
- TypeScript - safe function calls for arguments and returns
- Protocol agonostic - WebSocket, MessageChannel, any protocols with messages communication would work!
- Zero deps, ~0.5KB

## Examples

### Using WebSocket

When using WebSocket, you need to pass your custom serializer and deserializer.

#### Client

```ts
import type { ServerFunctions } from './types'

const ws = new WebSocket('ws://url')

const clientFunctions: ClientFunctions = {
  hey(name: string) {
    return `Hey ${name} from client`
  }
}

const rpc = createBirpc<ServerFunctions>(
  clientFunctions,
  {
    post: data => ws.send(data),
    on: fn => ws.on('message', fn),
    // these are required when using WebSocket
    serialize: v => JSON.stringify(v),
    deserialize: v => JSON.parse(v),
  },
)

await rpc.hi('Client') // Hi Client from server
```

#### Server

```ts
import type { ClientFunctions } from './types'
import { WebSocketServer } from 'ws'

const serverFunctions: ServerFunctions = {
  hi(name: string) {
    return `Hi ${name} from server`
  }
}

const wss = new WebSocketServer()

wss.on('connection', (ws) => {
  const rpc = createBirpc<ClientFunctions>(
    serverFunctions,
    {
      post: data => ws.send(data),
      on: fn => ws.on('message', fn),
      serialize: v => JSON.stringify(v),
      deserialize: v => JSON.parse(v),
    },
  )

  await rpc.hey('Server') // Hey Server from client
})
```

### Circular References

As `JSON.stringify` does not supporting circular references, we recommend using [`structured-clone-es`](https://github.com/antfu/structured-clone-es) as the serializer when you expect to have circular references.

```ts
import { parse, stringify } from 'structured-clone-es'

const rpc = createBirpc<ServerFunctions>(
  functions,
  {
    post: data => ws.send(data),
    on: fn => ws.on('message', fn),
    // use structured-clone-es as serializer
    serialize: v => stringify(v),
    deserialize: v => parse(v),
  },
)
```
### Using MessageChannel

[MessageChannel](https://developer.mozilla.org/en-US/docs/Web/API/MessageChannel) will automatically serialize the message and support circular references out-of-box.

```ts
export const channel = new MessageChannel()
```

#### Bob

``` ts
import type { AliceFunctions } from './types'
import { channel } from './channel'

const Bob: BobFunctions = {
  hey(name: string) {
    return `Hey ${name}, I am Bob`
  }
}

const rpc = createBirpc<AliceFunctions>(
  Bob,
  {
    post: data => channel.port1.postMessage(data),
    on: fn => channel.port1.on('message', fn),
  },
)

await rpc.hi('Bob') // Hi Bob, I am Alice
```

#### Alice

``` ts
import type { BobFunctions } from './types'
import { channel } from './channel'

const Alice: AliceFunctions = {
  hi(name: string) {
    return `Hi ${name}, I am Alice`
  }
}

const rpc = createBirpc<BobFunctions>(
  Alice,
  {
    post: data => channel.port2.postMessage(data),
    on: fn => channel.port2.on('message', fn),
  },
)

await rpc.hey('Alice') // Hey Alice, I am Bob
```

### One-to-multiple Communication

Refer to [./test/group.test.ts](./test/group.test.ts) as an example.

### Using SSE + HTTP POST

birpc can also run over **Server-Sent Events** (server → client) paired with
**HTTP POST** (client → server), so a browser and an HTTP server can call each
other with the exact same DX as the WebSocket example above. Because SSE is only
half of a duplex channel, birpc ships two channel helpers as sub-exports that
absorb the pairing for you:

- `birpc/sse/client` — `createSseClientChannel(baseUrl, options?)` → `{ post, on }`
- `birpc/sse/server` — `createSseSessionManager(options?)` → `{ open, handlePost }`

#### Client

```ts
import type { ServerFunctions } from './types'
import { createBirpc } from 'birpc'
import { createSseClientChannel } from 'birpc/sse/client'

const clientFunctions: ClientFunctions = {
  hey(name: string) {
    return `Hey ${name} from client`
  },
}

const channel = createSseClientChannel('http://localhost:3737')

const rpc = createBirpc<ServerFunctions>(clientFunctions, {
  post: channel.post,
  on: channel.on,
  serialize: v => JSON.stringify(v),
  deserialize: v => JSON.parse(v),
})

await rpc.hi('Client') // Hi Client from server
```

#### Server

```ts
import type { ClientFunctions } from './types'
import { createServer } from 'node:http'
import { createBirpc } from 'birpc'
import { createSseSessionManager } from 'birpc/sse/server'

const serverFunctions: ServerFunctions = {
  hi(name: string) {
    return `Hi ${name} from server`
  },
}

const sessions = createSseSessionManager()

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/sse') {
    const { channel } = sessions.open(req, res)
    const rpc = createBirpc<ClientFunctions>(serverFunctions, {
      post: channel.post,
      on: channel.on,
      serialize: v => JSON.stringify(v),
      deserialize: v => JSON.parse(v),
    })
    await rpc.hey('Server') // Hey Server from client
    return
  }
  if (req.method === 'POST' && req.url === '/rpc')
    await sessions.handlePost(req, res)
}).listen(3737)
```

See [`examples/sse`](./examples/sse) for a complete, runnable demo (Node client +
server and a browser page) plus a writeup of how the transport works.


## Sponsors

<p align="center">
  <a href="https://cdn.jsdelivr.net/gh/antfu/static/sponsors.svg">
    <img src='https://cdn.jsdelivr.net/gh/antfu/static/sponsors.svg' alt="Sponsors"/>
  </a>
</p>

## License

[MIT](./LICENSE) License © 2021 [Anthony Fu](https://github.com/antfu)
