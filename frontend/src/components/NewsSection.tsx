import type { PointerEvent, TouchEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NewsItem } from '@shared/types'
import '../styles/news.css'

const API_BASE = import.meta.env.VITE_BACKEND_URL || ''
const ROTATION_INTERVAL_MS = 7_000
const SWIPE_THRESHOLD = 40
const NEWS_CACHE_KEY = 'obnliga_news_cache'
const NEWS_CACHE_TTL = 1000 * 60 * 30 // 30 минут локального кеша
const NEWS_REFRESH_INTERVAL_MS = 60_000

const buildUrl = (path: string) => (API_BASE ? `${API_BASE}${path}` : path)

const getPreview = (content: string, limit = 220) => {
  const trimmed = content.trim()
  if (trimmed.length <= limit) {
    return trimmed
  }
  const soft = trimmed.slice(0, limit)
  const lastSpace = soft.lastIndexOf(' ')
  return `${soft.slice(0, lastSpace > 80 ? lastSpace : limit)}…`
}

type NewsModalState = {
  item: NewsItem
} | null

const isNewsItem = (value: unknown): value is NewsItem => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.content === 'string' &&
    typeof candidate.createdAt === 'string'
  )
}

const extractNewsItems = (value: unknown): NewsItem[] => {
  if (!value || typeof value !== 'object') return []
  const data = (value as Record<string, unknown>).data
  if (!Array.isArray(data)) return []
  return data.filter(isNewsItem)
}

export const NewsSection = () => {
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [modalState, setModalState] = useState<NewsModalState>(null)
  const touchStartX = useRef<number | null>(null)
  const etagRef = useRef<string | null>(null)
  const newsRef = useRef<NewsItem[]>([])
  const canSendConditionalHeader = useMemo(() => {
    if (typeof window === 'undefined') return false
    if (!API_BASE) return true
    try {
      const target = new URL(API_BASE, window.location.href)
      return target.origin === window.location.origin
    } catch {
      return false
    }
  }, [])

  const next = useCallback(() => {
    setActiveIndex(current => {
      if (news.length === 0) return 0
      return (current + 1) % news.length
    })
  }, [news.length])

  const prev = useCallback(() => {
    setActiveIndex(current => {
      if (news.length === 0) return 0
      const nextIndex = current - 1
      return nextIndex >= 0 ? nextIndex : Math.max(news.length - 1, 0)
    })
  }, [news.length])

  const readCache = useCallback(() => {
    if (typeof window === 'undefined') return null
    try {
      const raw = window.localStorage.getItem(NEWS_CACHE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object') return null
      const entry = parsed as {
        items?: unknown
        etag?: string | null
        timestamp?: unknown
      }
      if (typeof entry.timestamp !== 'number') return null
      if (!Array.isArray(entry.items)) return null
      const items = entry.items.filter(isNewsItem)
      if (Date.now() - entry.timestamp > NEWS_CACHE_TTL) {
        window.localStorage.removeItem(NEWS_CACHE_KEY)
        return null
      }
      return { items, etag: entry.etag ?? null, timestamp: entry.timestamp }
    } catch {
      return null
    }
  }, [])

  const writeCache = useCallback((items: NewsItem[], etag?: string | null) => {
    if (typeof window === 'undefined') return
    try {
      const payload = JSON.stringify({ items, etag: etag ?? null, timestamp: Date.now() })
      window.localStorage.setItem(NEWS_CACHE_KEY, payload)
    } catch {
      // ignore storage issues (private mode и т.п.)
    }
  }, [])

  const fetchNews = useCallback(
    async (opts?: { background?: boolean; force?: boolean }) => {
      try {
        if (!opts?.background) setLoading(true)
        const headers: HeadersInit | undefined =
          !opts?.force && etagRef.current && canSendConditionalHeader
            ? { 'If-None-Match': etagRef.current }
            : undefined
        const response = await fetch(buildUrl('/api/news'), headers ? { headers } : undefined)
        if (response.status === 304) {
          if (!opts?.force && newsRef.current.length === 0) {
            etagRef.current = null
            await fetchNews({ background: true, force: true })
          }
          setError(null)
          setLoading(false)
          return
        }
        if (!response.ok) {
          throw new Error(`news_fetch_failed_${response.status}`)
        }
        const payload = (await response.json()) as unknown
        const items = extractNewsItems(payload)
        const etag = response.headers.get('ETag')
        etagRef.current = etag
        writeCache(items, etag)
        setNews(items)
        newsRef.current = items
        setError(null)
        setActiveIndex(0)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'news_fetch_failed'
        setError(message)
      } finally {
        setLoading(false)
      }
    },
    [writeCache, canSendConditionalHeader]
  )

  useEffect(() => {
    const cached = readCache()
    if (cached?.items?.length) {
      etagRef.current = cached.etag ?? null
      setNews(cached.items)
      newsRef.current = cached.items
      setActiveIndex(0)
      setLoading(false)
      setError(null)
      void fetchNews({ background: true })
    } else {
      newsRef.current = []
      void fetchNews()
    }
  }, [fetchNews, readCache])

  useEffect(() => {
    if (news.length <= 1) return
    const timer = setInterval(() => {
      next()
    }, ROTATION_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [news.length, next])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        return
      }
      void fetchNews({ background: true })
    }

    const intervalId = window.setInterval(tick, NEWS_REFRESH_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [fetchNews])

  const activeItem = useMemo(() => news[activeIndex] ?? null, [news, activeIndex])

  const handleTouchStart = (event: TouchEvent | PointerEvent) => {
    const point = 'touches' in event ? event.touches[0] : event
    touchStartX.current = point.clientX
  }

  const handleTouchEnd = (event: TouchEvent | PointerEvent) => {
    if (touchStartX.current === null) return
    const point = 'changedTouches' in event ? event.changedTouches[0] : event
    const delta = point.clientX - touchStartX.current
    if (delta >= SWIPE_THRESHOLD) {
      prev()
    } else if (delta <= -SWIPE_THRESHOLD) {
      next()
    }
    touchStartX.current = null
  }

  const openModal = (item: NewsItem) => setModalState({ item })
  const closeModal = () => setModalState(null)

  if (loading) {
    return (
      <section className="news-column" aria-busy="true">
        <header className="news-header">
          <h2>Новости</h2>
          <span className="news-meta">Загружаем…</span>
        </header>
        <div className="news-placeholder">Подтягиваем свежие материалы</div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="news-column" aria-live="polite">
        <header className="news-header">
          <h2>Новости</h2>
        </header>
        <div className="news-placeholder error">Не удалось загрузить новости ({error}).</div>
      </section>
    )
  }

  if (!activeItem) {
    return (
      <section className="news-column">
        <header className="news-header">
          <h2>Новости</h2>
        </header>
        <div className="news-placeholder">Пока новостей нет. Возвращайтесь позже!</div>
      </section>
    )
  }

  return (
    <section className="news-column">
      <header className="news-header">
        <h2>Новости</h2>
      </header>

      <article
        className="news-card"
        role="group"
        aria-roledescription="слайд новости"
        aria-label={activeItem.title}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onPointerDown={handleTouchStart}
        onPointerUp={handleTouchEnd}
      >
        <div className="news-card-body">
          <time className="news-date" dateTime={activeItem.createdAt}>
            {new Date(activeItem.createdAt).toLocaleDateString('ru-RU', {
              day: '2-digit',
              month: 'long',
            })}
          </time>
          <h3>{activeItem.title}</h3>
          <p>{getPreview(activeItem.content)}</p>
        </div>
        <footer className="news-card-footer">
          <button className="news-more" type="button" onClick={() => openModal(activeItem)}>
            Читать полностью
          </button>
          <div className="news-dots" role="tablist" aria-label="Список новостей">
            {news.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={index === activeIndex}
                className={`news-dot${index === activeIndex ? ' active' : ''}`}
                onClick={() => setActiveIndex(index)}
              >
                <span className="sr-only">{item.title}</span>
              </button>
            ))}
          </div>
        </footer>
      </article>

      {modalState
        ? createPortal(
          <>
            <div className="news-modal-backdrop" role="presentation" onClick={closeModal} />
            <div
              className="news-modal"
              role="dialog"
              aria-modal="true"
              aria-label={modalState.item.title}
            >
              <div className="news-modal-content">
                <header>
                  <time className="news-date" dateTime={modalState.item.createdAt}>
                    {new Date(modalState.item.createdAt).toLocaleString('ru-RU', {
                      day: '2-digit',
                      month: 'long',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                  <h3>{modalState.item.title}</h3>
                </header>
                {modalState.item.coverUrl ? (
                  <div className="news-cover">
                    <img src={modalState.item.coverUrl} alt="Обложка новости" loading="lazy" />
                  </div>
                ) : null}
                <div className="news-content">
                  {modalState.item.content.split('\n').map((paragraph, idx) => (
                    <p key={idx}>{paragraph}</p>
                  ))}
                </div>
                <button className="news-close" type="button" onClick={closeModal}>
                    Закрыть
                </button>
              </div>
            </div>
          </>,
          document.body
        )
        : null}
    </section>
  )
}
