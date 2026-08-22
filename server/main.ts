// The md-boss backend, run by the locally installed bun. One WebSocket, JSON-RPC on it:
// `{id, method, params}` in, `{id, result}` or `{id, error}` out, and `{event, data}` pushed
// for watches. Started by the shell with --port, --token and --parent; it ends itself when
// the parent is gone, so a killed shell does not leave it behind.

import { Session } from './session'
import { methods } from './rpc'

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const port = Number(flag('port') ?? 0)
const token = flag('token') ?? ''
const parent = Number(flag('parent') ?? 0)
if (!port || !token) {
  console.error('usage: bun server/main.ts --port N --token T [--parent PID]')
  process.exit(2)
}

interface Call {
  id: number
  method: string
  params?: unknown[]
}

const server = Bun.serve<{ session: Session }>({
  hostname: '127.0.0.1',
  port,
  fetch(req, server) {
    const url = new URL(req.url)
    if (url.pathname !== '/rpc' || url.searchParams.get('token') !== token) {
      return new Response('forbidden', { status: 403 })
    }
    if (server.upgrade(req, { data: { session: new Session() } })) return undefined
    return new Response('expected a websocket', { status: 400 })
  },
  websocket: {
    open(ws) {
      ws.data.session.attach(ws)
    },
    close(ws) {
      ws.data.session.dispose()
    },
    async message(ws, raw) {
      let call: Call
      try {
        call = JSON.parse(String(raw)) as Call
      } catch {
        return
      }
      const fn = methods[call.method]
      if (!fn) {
        ws.send(JSON.stringify({ id: call.id, error: `unknown method: ${call.method}` }))
        return
      }
      try {
        const result = await fn(ws.data.session, ...(call.params ?? []))
        ws.send(JSON.stringify({ id: call.id, result: result === undefined ? null : result }))
      } catch (e) {
        ws.send(JSON.stringify({ id: call.id, error: e instanceof Error ? e.message : String(e) }))
      }
    },
  },
})

if (parent) {
  setInterval(() => {
    try {
      process.kill(parent, 0)
    } catch {
      process.exit(0)
    }
  }, 2000)
}

console.log(`md-boss server: ws://127.0.0.1:${server.port}/rpc`)
