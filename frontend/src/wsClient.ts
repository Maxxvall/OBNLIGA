export interface WSMessage {
  type?: string
  topic?: string
  payload?: unknown
  [key: string]: unknown
}

type Handler = (msg: WSMessage) => void

const HEARTBEAT_INTERVAL_MS = 25_000
const HEARTBEAT_STALE_MS = 60_000
const RECONNECT_BASE_DELAY_MS = 1_000
const RECONNECT_MAX_DELAY_MS = 15_000

type WSClientOptions = {
  requireAuth?: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isWsMessage = (value: unknown): value is WSMessage => isRecord(value)

export class WSClient {
  private ws: WebSocket | null = null
  private readonly url: string
  private token?: string
  private readonly requireAuth: boolean
  private readonly handlers: Map<string, Handler[]> = new Map()
  private readonly desiredTopics: Set<string> = new Set()
  private reconnectAttempts = 0
  private reconnectTimer: number | null = null
  private heartbeatTimer: number | null = null
  private lastMessageAt = Date.now()
  private manualClose = false
  private authRejected = false

  constructor(url: string, options?: WSClientOptions) {
    this.url = url
    this.requireAuth = options?.requireAuth ?? true
  }

  connect(token?: string) {
    if (token) {
      this.token = token
      this.authRejected = false
    }
    if (!this.canConnect()) {
      return
    }
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return
    }
    this.manualClose = false
    const sep = this.url.includes('?') ? '&' : '?'
    const authToken = this.token || token
    const u = authToken ? `${this.url}${sep}token=${encodeURIComponent(authToken)}` : this.url
    this.cleanupSocket()
    this.ws = new WebSocket(u)
    this.ws.addEventListener('open', this.handleOpen)
    this.ws.addEventListener('message', this.handleMessage)
    this.ws.addEventListener('close', this.handleClose)
    this.ws.addEventListener('error', this.handleError)
  }

  disconnect() {
    this.manualClose = true
    this.reconnectAttempts = 0
    this.clearReconnect()
    this.stopHeartbeat()
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      this.ws.close()
    }
    this.cleanupSocket()
  }

  subscribe(topic: string) {
    if (!topic) return
    if (this.desiredTopics.has(topic)) return
    this.desiredTopics.add(topic)
    if (!this.canConnect()) {
      return
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ action: 'subscribe', topic })
    } else {
      this.ensureConnection()
    }
  }

  unsubscribe(topic: string) {
    if (!this.desiredTopics.has(topic)) return
    this.desiredTopics.delete(topic)
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ action: 'unsubscribe', topic })
    }
  }

  on(type: string, cb: Handler) {
    const list = this.handlers.get(type) || []
    list.push(cb)
    this.handlers.set(type, list)
    return () => this.off(type, cb)
  }

  off(type: string, cb: Handler) {
    const list = this.handlers.get(type)
    if (!list) return
    const next = list.filter(handler => handler !== cb)
    if (next.length === 0) {
      this.handlers.delete(type)
    } else {
      this.handlers.set(type, next)
    }
  }

  private dispatch(msg: WSMessage) {
    const type = msg.type || 'message'
    const list = this.handlers.get(type) || []
    for (const h of list) {
      try {
        h(msg)
      } catch (err) {
        // глушим обработчик, чтобы один слушатель не ломал остальных
      }
    }
  }

  private send(payload: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    try {
      this.ws.send(JSON.stringify(payload))
    } catch (e) {
      // noop
    }
  }

  private ensureConnection() {
    if (!this.canConnect()) {
      return
    }
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this.connect()
    }
  }

  private handleOpen = () => {
    this.reconnectAttempts = 0
    this.clearReconnect()
    this.lastMessageAt = Date.now()
    this.startHeartbeat()
    for (const topic of this.desiredTopics) {
      this.send({ action: 'subscribe', topic })
    }
  }

  private handleMessage = (event: MessageEvent) => {
    this.lastMessageAt = Date.now()
    try {
      const parsed = JSON.parse(event.data) as unknown
      if (isWsMessage(parsed)) {
        this.dispatch(parsed)
      }
    } catch {
      // ignore malformed payloads
    }
  }

  private handleClose = (event: CloseEvent) => {
    this.cleanupSocket()
    if (this.manualClose) return
    if (event.code === 4001) {
      this.authRejected = true
      return
    }
    this.scheduleReconnect()
  }

  private handleError = () => {
    if (!this.manualClose) {
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) return
    if (!this.canConnect()) return
    const attempt = this.reconnectAttempts + 1
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt - 1),
      RECONNECT_MAX_DELAY_MS
    )
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectAttempts = attempt
      this.connect()
    }, delay)
  }

  private clearReconnect() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = window.setInterval(() => {
      const now = Date.now()
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.stopHeartbeat()
        return
      }
      if (now - this.lastMessageAt > HEARTBEAT_STALE_MS) {
        this.ws.close()
        return
      }
      this.send({ action: 'ping', ts: now })
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private cleanupSocket() {
    if (!this.ws) return
    this.ws.removeEventListener('open', this.handleOpen)
    this.ws.removeEventListener('message', this.handleMessage)
    this.ws.removeEventListener('close', this.handleClose)
    this.ws.removeEventListener('error', this.handleError)
    this.ws = null
    this.stopHeartbeat()
  }

  private canConnect() {
    if (this.authRejected) {
      return false
    }
    if (!this.requireAuth) {
      return true
    }
    return Boolean(this.token)
  }

  setToken(token?: string) {
    const normalized = token || undefined
    const changed = normalized !== this.token
    this.token = normalized
    this.authRejected = false
    if (!normalized) {
      this.disconnect()
      return
    }
    if (changed) {
      this.connect(normalized)
    }
  }

  hasToken() {
    return Boolean(this.token)
  }
}

const token =
  typeof window !== 'undefined' ? localStorage.getItem('session') || undefined : undefined

// Resolve WS URL from Vite env or derive from BACKEND_URL / location
const VITE_WS_URL = import.meta.env.VITE_WS_URL ?? ''
const VITE_BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? ''
let resolvedWsUrl = ''
if (VITE_WS_URL) {
  resolvedWsUrl = VITE_WS_URL
} else if (VITE_BACKEND_URL) {
  resolvedWsUrl = VITE_BACKEND_URL.replace(/^http/, 'ws') + '/realtime'
} else if (typeof location !== 'undefined') {
  resolvedWsUrl = `${location.origin.replace(/^http/, 'ws')}/realtime`
} else {
  resolvedWsUrl = '/realtime'
}

export const wsClient = new WSClient(resolvedWsUrl, { requireAuth: false })
if (token) {
  wsClient.setToken(token)
}
