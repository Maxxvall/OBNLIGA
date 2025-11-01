import type { KeyboardEvent, PointerEvent, TouchEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PublicAdBanner } from '@shared/types'
import { adsApi } from '../api/adsApi'
import '../styles/ads.css'

const ADS_CACHE_KEY = 'obnliga_ads_cache_v1'
const ADS_CACHE_TTL = 1000 * 60 * 60 * 24 * 14
const ROTATION_INTERVAL_MS = 7_000
const SWIPE_THRESHOLD = 40
const REFRESH_INTERVAL_MS = 5 * 60 * 1000

const hasWindow = typeof window !== 'undefined'

type AdsCacheEntry = {
  items: PublicAdBanner[]
  version: string | null
  timestamp: number
}

type DisplayAd = PublicAdBanner & {
  imageUrl: string
  safeTarget: string | null
}

const isBannerImage = (value: unknown): value is PublicAdBanner['image'] => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.mimeType === 'string' &&
    typeof candidate.base64 === 'string' &&
    candidate.base64.length > 0 &&
    typeof candidate.width === 'number' &&
    typeof candidate.height === 'number' &&
    typeof candidate.size === 'number'
  )
}

const isPublicAd = (value: unknown): value is PublicAdBanner => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    (typeof candidate.subtitle === 'string' || candidate.subtitle === null || candidate.subtitle === undefined) &&
    (typeof candidate.targetUrl === 'string' || candidate.targetUrl === null || candidate.targetUrl === undefined) &&
    typeof candidate.displayOrder === 'number' &&
    isBannerImage(candidate.image)
  )
}

const sanitizeAds = (items: PublicAdBanner[]): PublicAdBanner[] => {
  const filtered = items.filter(isPublicAd)
  if (filtered.length === 0) {
    return []
  }
  const unique = new Map<string, PublicAdBanner>()
  filtered.forEach(ad => {
    if (unique.has(ad.id)) {
      return
    }
    const subtitle = ad.subtitle?.trim() ?? null
    const targetUrl = ad.targetUrl?.trim() ?? null
    const cleanImage = {
      mimeType: ad.image.mimeType,
      base64: ad.image.base64.replace(/\s+/g, ''),
      width: ad.image.width,
      height: ad.image.height,
      size: ad.image.size,
    }
    unique.set(ad.id, {
      ...ad,
      subtitle: subtitle && subtitle.length > 0 ? subtitle : null,
      targetUrl: targetUrl && targetUrl.length > 0 ? targetUrl : null,
      image: cleanImage,
    })
  })
  const prepared = Array.from(unique.values())
  prepared.sort((left, right) => {
    const orderDiff = left.displayOrder - right.displayOrder
    if (orderDiff !== 0) {
      return orderDiff
    }
    return left.id.localeCompare(right.id)
  })
  return prepared
}

const resolveSafeTargetUrl = (value: string | null | undefined): string | null => {
  if (!value) {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const lower = trimmed.toLowerCase()
  if (lower.startsWith('https://') || lower.startsWith('http://') || lower.startsWith('tg://')) {
    return trimmed
  }
  return null
}

const readAdsCache = (): AdsCacheEntry | null => {
  if (!hasWindow) {
    return null
  }
  try {
    const raw = window.localStorage.getItem(ADS_CACHE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<AdsCacheEntry>
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    if (typeof parsed.timestamp !== 'number') {
      return null
    }
    if (Date.now() - parsed.timestamp > ADS_CACHE_TTL) {
      window.localStorage.removeItem(ADS_CACHE_KEY)
      return null
    }
    if (!Array.isArray(parsed.items)) {
      return null
    }
    const sanitized = sanitizeAds(parsed.items as PublicAdBanner[])
    const version = typeof parsed.version === 'string' ? parsed.version : null
    return { items: sanitized, version, timestamp: parsed.timestamp }
  } catch {
    return null
  }
}

const writeAdsCache = (items: PublicAdBanner[], version: string | null) => {
  if (!hasWindow) {
    return
  }
  try {
    const payload: AdsCacheEntry = {
      items,
      version,
      timestamp: Date.now(),
    }
    window.localStorage.setItem(ADS_CACHE_KEY, JSON.stringify(payload))
  } catch {
    // пропускаем ошибки localStorage
  }
}

export function AdCarousel() {
  const [ads, setAds] = useState<PublicAdBanner[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const versionRef = useRef<string | null>(null)
  const fetchingRef = useRef(false)
  const touchStartX = useRef<number | null>(null)
  const adsRef = useRef<PublicAdBanner[]>([])
  const adsLengthRef = useRef(0)
  const activeIndexRef = useRef(0)
  const rotationRef = useRef<number | null>(null)

  const stopRotation = useCallback(() => {
    if (!hasWindow) {
      return
    }
    if (rotationRef.current !== null) {
      window.clearInterval(rotationRef.current)
      rotationRef.current = null
    }
  }, [])

  const startRotation = useCallback(() => {
    if (!hasWindow) {
      return
    }
    stopRotation()
    if (adsLengthRef.current <= 1) {
      return
    }
    rotationRef.current = window.setInterval(() => {
      setActiveIndex(current => {
        const total = adsLengthRef.current
        if (total <= 1) {
          return 0
        }
        const next = current + 1
        return next >= total ? 0 : next
      })
    }, ROTATION_INTERVAL_MS)
  }, [stopRotation])

  const rotate = useCallback((direction: 1 | -1) => {
    const total = adsLengthRef.current
    if (total === 0) {
      return
    }
    setActiveIndex(current => {
      if (total <= 1) {
        return 0
      }
      const next = direction === 1 ? current + 1 : current - 1
      if (next < 0) {
        return total - 1
      }
      if (next >= total) {
        return 0
      }
      return next
    })
  }, [])

  const handleNext = useCallback(() => {
    stopRotation()
    rotate(1)
    startRotation()
  }, [rotate, startRotation, stopRotation])

  const handlePrev = useCallback(() => {
    stopRotation()
    rotate(-1)
    startRotation()
  }, [rotate, startRotation, stopRotation])

  const handleDotClick = useCallback(
    (index: number) => {
      if (index === activeIndexRef.current) {
        return
      }
      const total = adsLengthRef.current
      if (index < 0 || index >= total) {
        return
      }
      stopRotation()
      setActiveIndex(index)
      startRotation()
    },
    [startRotation, stopRotation]
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        handlePrev()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        handleNext()
      }
    },
    [handleNext, handlePrev]
  )

  const handleGestureStart = (event: TouchEvent | PointerEvent) => {
    const point = 'touches' in event ? event.touches[0] : event
    if (!point) {
      return
    }
    touchStartX.current = point.clientX
    stopRotation()
  }

  const handleGestureEnd = (event: TouchEvent | PointerEvent) => {
    const startX = touchStartX.current
    touchStartX.current = null
    const point = 'changedTouches' in event ? event.changedTouches[0] : event
    if (startX === null || !point) {
      startRotation()
      return
    }
    const delta = point.clientX - startX
    if (delta <= -SWIPE_THRESHOLD) {
      rotate(1)
    } else if (delta >= SWIPE_THRESHOLD) {
      rotate(-1)
    }
    startRotation()
  }

  const loadAds = useCallback(
    async (opts?: { background?: boolean; force?: boolean }) => {
      if (fetchingRef.current && !opts?.force) {
        return
      }
      fetchingRef.current = true
      try {
        if (!opts?.background) {
          setLoading(true)
        }
        const version = opts?.force ? undefined : versionRef.current ?? undefined
        const response = await adsApi.fetchAds(version)
        if (!response.ok) {
          if (!opts?.background && adsRef.current.length === 0) {
            setError('ads_fetch_failed')
          }
          return
        }
        if (response.notModified) {
          if (!opts?.force && adsRef.current.length === 0) {
            versionRef.current = null
            await loadAds({ background: true, force: true })
          }
          setError(null)
          return
        }
        const sanitized = sanitizeAds(response.data)
        versionRef.current = response.version ?? null
        writeAdsCache(sanitized, versionRef.current)
        const previousLength = adsRef.current.length
        adsRef.current = sanitized
        adsLengthRef.current = sanitized.length
        setAds(sanitized)
        if (sanitized.length === 0) {
          setActiveIndex(0)
        } else if (previousLength === 0 || activeIndexRef.current >= sanitized.length) {
          setActiveIndex(0)
        }
        setError(null)
      } catch (err) {
        if (!opts?.background && adsRef.current.length === 0) {
          setError('ads_fetch_failed')
        }
      } finally {
        setLoading(false)
        fetchingRef.current = false
      }
    },
    []
  )

  useEffect(() => {
    const cached = readAdsCache()
    if (cached) {
      versionRef.current = cached.version
      adsRef.current = cached.items
      adsLengthRef.current = cached.items.length
      setAds(cached.items)
      setActiveIndex(0)
      setError(null)
      setLoading(false)
      void loadAds({ background: true })
    } else {
      void loadAds()
    }
  }, [loadAds])

  useEffect(() => {
    activeIndexRef.current = activeIndex
  }, [activeIndex])

  useEffect(() => {
    adsLengthRef.current = ads.length
    stopRotation()
    if (ads.length > 1) {
      startRotation()
    }
    return () => {
      stopRotation()
    }
  }, [ads.length, startRotation, stopRotation])

  useEffect(() => {
    if (!hasWindow) {
      return
    }
    const handleVisibility = () => {
      if (document.hidden) {
        stopRotation()
      } else if (adsLengthRef.current > 1) {
        startRotation()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [startRotation, stopRotation])

  useEffect(() => {
    if (!hasWindow) {
      return
    }
    const intervalId = window.setInterval(() => {
      if (typeof document === 'undefined' || document.hidden) {
        return
      }
      void loadAds({ background: true })
    }, REFRESH_INTERVAL_MS)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [loadAds])

  const displayAds = useMemo<DisplayAd[]>(
    () =>
      ads.map(ad => ({
        ...ad,
        imageUrl: `data:${ad.image.mimeType};base64,${ad.image.base64}`,
        safeTarget: resolveSafeTargetUrl(ad.targetUrl),
      })),
    [ads]
  )

  const activeAd = displayAds[activeIndex] ?? null
  const helperText = useMemo(() => {
    if (displayAds.length === 0) {
      return 'Рекламный блок.'
    }
    if (displayAds.length > 1) {
      return 'Автопрокрутка каждые 7 секунд'
    }
    const single = displayAds[0]
    return single.safeTarget ? 'Тапните для перехода по ссылке' : null
  }, [displayAds])

  if (loading && displayAds.length === 0) {
    return (
      <section className="ads-carousel" aria-busy="true" aria-label="Партнёрские баннеры">
        <p className="ads-meta">Загружаем баннеры…</p>
        <div className="ads-card">
          <div className="ads-skeleton skeleton" />
        </div>
      </section>
    )
  }

  if (error && displayAds.length === 0) {
    return (
      <section className="ads-carousel" aria-live="polite" aria-label="Партнёрские баннеры">
        <p className="ads-meta">Ошибка загрузки</p>
        <div className="ads-placeholder">Не удалось загрузить баннеры. Попробуйте позже.</div>
      </section>
    )
  }

  if (!activeAd) {
    return (
      <section className="ads-carousel" aria-live="polite" aria-label="Партнёрские баннеры">
        <p className="ads-meta">{helperText}</p>
        <div className="ads-card">
          <div className="ads-placeholder">Баннеров пока нет — как только они появятся, мы покажем их здесь.</div>
        </div>
      </section>
    )
  }
  const slideLabel = activeAd.subtitle ? `${activeAd.title}. ${activeAd.subtitle}` : activeAd.title

  return (
    <section className="ads-carousel" aria-roledescription="карусель" aria-label="Партнёрские баннеры">
      {helperText ? <p className="ads-meta">{helperText}</p> : null}

      <article
        className="ads-card"
        role="group"
        aria-roledescription="слайд баннера"
        aria-label={slideLabel}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerDown={handleGestureStart}
        onPointerUp={handleGestureEnd}
        onTouchStart={handleGestureStart}
        onTouchEnd={handleGestureEnd}
      >
        {activeAd.safeTarget ? (
          <a
            className="ads-link"
            href={activeAd.safeTarget}
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              className="ads-image"
              src={activeAd.imageUrl}
              alt={activeAd.title}
              loading="eager"
              decoding="async"
              draggable={false}
            />
            <div className="ads-overlay">
              <div className="ads-text">
                <h3 className="ads-title">{activeAd.title}</h3>
                {activeAd.subtitle ? <p className="ads-subtitle">{activeAd.subtitle}</p> : null}
              </div>
              <span className="ads-cta" aria-hidden="true">
                Перейти
              </span>
            </div>
          </a>
        ) : (
          <div className="ads-link" role="presentation">
            <img
              className="ads-image"
              src={activeAd.imageUrl}
              alt={activeAd.title}
              loading="eager"
              decoding="async"
              draggable={false}
            />
            <div className="ads-overlay">
              <div className="ads-text">
                <h3 className="ads-title">{activeAd.title}</h3>
                {activeAd.subtitle ? <p className="ads-subtitle">{activeAd.subtitle}</p> : null}
              </div>
            </div>
          </div>
        )}
      </article>

      {displayAds.length > 1 ? (
        <div className="ads-dots" role="tablist" aria-label="Список баннеров">
          {displayAds.map((banner, index) => (
            <button
              key={banner.id}
              type="button"
              role="tab"
              aria-selected={index === activeIndex}
              className={`ads-dot${index === activeIndex ? ' active' : ''}`}
              onClick={() => handleDotClick(index)}
            >
              <span className="sr-only">{banner.title}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}
