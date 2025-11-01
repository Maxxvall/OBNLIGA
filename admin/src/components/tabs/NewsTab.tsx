import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  adminDelete,
  adminPatch,
  adminPost,
  adminCreateAd,
  adminUpdateAd,
  adminDeleteAd,
  AdminAdCreatePayload,
  AdminAdUpdatePayload,
} from '../../api/adminClient'
import { useAdminStore } from '../../store/adminStore'
import type { AdBanner, AdBannerImage, NewsItem } from '@shared/types'
import { formatDateTime } from '../../utils/date'

const defaultFormState = {
  title: '',
  content: '',
  coverUrl: '',
  sendToTelegram: true,
}

type FeedbackKind = 'success' | 'error'

type FeedbackState = {
  kind: FeedbackKind
  message: string
  meta?: string
} | null

const formatDate = (iso: string) => {
  const formatted = formatDateTime(iso, {
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
  return formatted || iso
}

const getPreview = (content: string, limit = 160) => {
  const trimmed = content.trim()
  if (trimmed.length <= limit) return trimmed
  const slice = trimmed.slice(0, limit)
  const lastSpace = slice.lastIndexOf(' ')
  return `${slice.slice(0, lastSpace > 60 ? lastSpace : limit)}…`
}

export const NewsTab = () => {
  const {
    token,
    data,
    fetchNews,
    prependNews,
    updateNews,
    removeNews,
    fetchAds,
    upsertAd,
    removeAd,
    loading,
    error,
    clearError,
    newsVersion,
  } = useAdminStore(state => ({
    token: state.token,
    data: state.data,
    fetchNews: state.fetchNews,
    prependNews: state.prependNews,
    updateNews: state.updateNews,
    removeNews: state.removeNews,
    fetchAds: state.fetchAds,
    upsertAd: state.upsertAd,
    removeAd: state.removeAd,
    loading: state.loading,
    error: state.error,
    clearError: state.clearError,
    newsVersion: state.newsVersion,
  }))

  const [form, setForm] = useState(defaultFormState)
  const [feedback, setFeedback] = useState<FeedbackState>(null)
  const [submitting, setSubmitting] = useState(false)
  const [editTarget, setEditTarget] = useState<NewsItem | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const isLoading = Boolean(loading.news)
  const isAdsLoading = Boolean(loading.ads)
  const isEditing = Boolean(editTarget)

  const resetForm = () => {
    setForm(defaultFormState)
    setEditTarget(null)
  }

  useEffect(() => {
    if (!token) return
    if (!data.news.length) {
      void fetchNews({ force: true }).catch(() => undefined)
    }
    if (!data.ads.length) {
      void fetchAds({ force: true }).catch(() => undefined)
    }
  }, [token, data.news.length, data.ads.length, fetchNews, fetchAds])

  const latestNews = useMemo(() => data.news.slice(0, 6), [data.news])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form.title.trim()) {
      setFeedback({ kind: 'error', message: 'Введите заголовок новости.' })
      return
    }
    if (!form.content.trim()) {
      setFeedback({ kind: 'error', message: 'Введите текст новости.' })
      return
    }
    if (!token) {
      setFeedback({ kind: 'error', message: 'Нет токена администратора. Войдите заново.' })
      return
    }

    const title = form.title.trim()
    const content = form.content.trim()
    const cover = form.coverUrl.trim()

    if (editTarget) {
      const targetCover = (editTarget.coverUrl ?? '').trim()
      const sameTelegramFlag = Boolean(editTarget.sendToTelegram) === form.sendToTelegram
      if (
        title === editTarget.title &&
        content === editTarget.content &&
        cover === targetCover &&
        sameTelegramFlag
      ) {
        setFeedback({
          kind: 'error',
          message: 'Изменений не обнаружено — сохранение не требуется.',
        })
        return
      }
    }

    setSubmitting(true)
    setFeedback(null)
    try {
      if (editTarget) {
        const payload = {
          title,
          content,
          coverUrl: cover ? cover : null,
          sendToTelegram: form.sendToTelegram,
        }

        const updated = await adminPatch<NewsItem>(
          token,
          `/api/admin/news/${editTarget.id}`,
          payload
        )
        updateNews(updated)
        resetForm()
        setFeedback({
          kind: 'success',
          message: 'Новость обновлена',
          meta: `ID: ${updated.id}`,
        })
      } else {
        const payload = {
          title,
          content,
          coverUrl: cover ? cover : undefined,
          sendToTelegram: form.sendToTelegram,
        }

        const created = await adminPost<NewsItem>(token, '/api/admin/news', payload)
        prependNews(created)
        resetForm()
        setFeedback({
          kind: 'success',
          message: 'Новость опубликована',
          meta: `ID: ${created.id}${created.sendToTelegram ? ' • Telegram задача поставлена' : ''}`,
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось опубликовать новость'
      setFeedback({ kind: 'error', message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleRefresh = () => {
    void fetchNews({ force: true }).catch(() => undefined)
  }

  const handleEdit = (item: NewsItem) => {
    setEditTarget(item)
    setForm({
      title: item.title,
      content: item.content,
      coverUrl: item.coverUrl ?? '',
      sendToTelegram: Boolean(item.sendToTelegram),
    })
    setFeedback(null)
  }

  const handleCancelEdit = () => {
    resetForm()
  }

  const handleDelete = async (item: NewsItem) => {
    if (!token) {
      setFeedback({ kind: 'error', message: 'Нет токена администратора. Войдите заново.' })
      return
    }
    const confirmed =
      typeof window !== 'undefined'
        ? window.confirm('Удалить новость без возможности восстановления?')
        : true
    if (!confirmed) {
      return
    }
    setDeletingId(item.id)
    setFeedback(null)
    try {
      const deleted = await adminDelete<NewsItem>(token, `/api/admin/news/${item.id}`)
      removeNews(deleted.id)
      if (editTarget && editTarget.id === item.id) {
        resetForm()
      }
      setFeedback({
        kind: 'success',
        message: 'Новость удалена',
        meta: `ID: ${deleted.id}`,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось удалить новость'
      setFeedback({ kind: 'error', message })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="tab-sections">
      <header className="tab-header">
        <div>
          <h3>Новости лиги</h3>
          <p>Публикуйте обновления и отправляйте их пользователям в Telegram.</p>
        </div>
        <div className="tab-header-actions">
          <button
            className="button-ghost"
            type="button"
            disabled={isLoading}
            onClick={handleRefresh}
          >
            {isLoading ? 'Обновляем…' : 'Обновить ленту'}
          </button>
          {newsVersion !== undefined ? (
            <span className="news-version" title="Текущая версия кэша новостей">
              ver. {newsVersion}
            </span>
          ) : null}
        </div>
      </header>

      {feedback ? (
        <div className={`inline-feedback ${feedback.kind}`}>
          <div>
            <strong>{feedback.message}</strong>
            {feedback.meta ? <span className="feedback-meta">{feedback.meta}</span> : null}
          </div>
          <button type="button" className="feedback-close" onClick={() => setFeedback(null)}>
            ×
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="inline-feedback error">
          <div>
            <strong>{error}</strong>
          </div>
          <button type="button" className="feedback-close" onClick={() => clearError()}>
            ×
          </button>
        </div>
      ) : null}

      <section className="card news-form">
        <header>
          <h4>{isEditing ? 'Редактирование новости' : 'Новая публикация'}</h4>
          <p>
            {isEditing
              ? 'Обновите поля и сохраните изменения. Публикация обновится во всех клиентах сразу.'
              : 'Заполните поля и нажмите «Опубликовать». Новость появится в приложении мгновенно.'}
          </p>
        </header>
        <form className="stacked" onSubmit={handleSubmit}>
          <label>
            Заголовок
            <input
              name="title"
              maxLength={100}
              required
              placeholder="Например, Итоги 5 тура"
              value={form.title}
              onChange={event => setForm(state => ({ ...state, title: event.target.value }))}
            />
          </label>
          <label>
            Содержимое
            <textarea
              name="content"
              required
              rows={8}
              placeholder="Длинное описание, поддерживаются переводы строк"
              value={form.content}
              onChange={event => setForm(state => ({ ...state, content: event.target.value }))}
            />
          </label>
          <label>
            Изображение (URL)
            <input
              name="coverUrl"
              type="url"
              placeholder="https://liga.ru/images/news.jpg"
              value={form.coverUrl}
              onChange={event => setForm(state => ({ ...state, coverUrl: event.target.value }))}
            />
          </label>
          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={form.sendToTelegram}
              onChange={event =>
                setForm(state => ({ ...state, sendToTelegram: event.target.checked }))
              }
            />
            <span>Отправить в Telegram бота</span>
          </label>
          <div className="form-actions">
            <button className="button-primary" type="submit" disabled={submitting}>
              {submitting
                ? isEditing
                  ? 'Сохраняем…'
                  : 'Публикуем…'
                : isEditing
                  ? 'Сохранить'
                  : 'Опубликовать'}
            </button>
            {isEditing ? (
              <button
                className="button-secondary"
                type="button"
                onClick={handleCancelEdit}
                disabled={submitting}
              >
                Отменить
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="card news-preview">
        <header>
          <h4>Последние новости</h4>
          <p>Список синхронизирован со storefront и обновляется без перезагрузки.</p>
        </header>
        {latestNews.length ? (
          <ul className="news-preview-list">
            {latestNews.map(item => (
              <li
                key={item.id}
                className={`news-preview-item${editTarget && editTarget.id === item.id ? ' editing' : ''}`}
              >
                <div className="news-preview-header">
                  <h5>{item.title}</h5>
                  <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                </div>
                <p className="news-preview-body">{getPreview(item.content)}</p>
                <footer className="news-preview-footer">
                  <span className={`news-chip${item.sendToTelegram ? ' sent' : ''}`}>
                    {item.sendToTelegram ? 'Telegram ✓' : 'Только лента'}
                  </span>
                  <div className="news-preview-actions">
                    {item.coverUrl ? (
                      <a
                        href={item.coverUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="news-link"
                      >
                        Обложка
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => handleEdit(item)}
                      disabled={submitting || deletingId === item.id}
                    >
                      Редактировать
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => handleDelete(item)}
                      disabled={deletingId === item.id || submitting}
                    >
                      {deletingId === item.id ? 'Удаляем…' : 'Удалить'}
                    </button>
                  </div>
                </footer>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-placeholder">Новостей пока нет — опубликуйте первую запись!</div>
        )}
      </section>

      <AdsManager
        token={token}
        ads={data.ads}
        fetchAds={fetchAds}
        upsertAd={upsertAd}
        removeAd={removeAd}
        isLoading={isAdsLoading}
      />
    </div>
  )
}

const MAX_AD_IMAGE_SIZE_BYTES = 1_000_000
const MAX_AD_DISPLAY_ORDER = 9999
const ACCEPTED_AD_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const DEFAULT_AD_TITLE = 'Реклама'

interface AdFormState {
  targetUrl: string
  displayOrder: string
  isActive: boolean
  startsAt: string
  endsAt: string
  imagePreview?: string
  imagePayload: AdBannerImage | null
  imageDirty: boolean
}

interface AdsManagerProps {
  token?: string
  ads: AdBanner[]
  fetchAds: (options?: { force?: boolean }) => Promise<void>
  upsertAd: (item: AdBanner) => void
  removeAd: (id: string) => void
  isLoading: boolean
}

const createInitialAdForm = (): AdFormState => ({
  targetUrl: '',
  displayOrder: '0',
  isActive: true,
  startsAt: '',
  endsAt: '',
  imagePreview: undefined,
  imagePayload: null,
  imageDirty: false,
})

const buildAdPreview = (ad: AdBanner): string =>
  `data:${ad.image.mimeType};base64,${ad.image.base64}`

const formatDateInputValue = (iso?: string | null): string => {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const pad = (value: number) => value.toString().padStart(2, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

const convertLocalInputToIso = (value: string): string | null => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return date.toISOString()
}

const readAdImageFile = async (
  file: File
): Promise<{ preview: string; payload: AdBannerImage }> => {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Не удалось прочитать файл изображения.'))
    reader.onload = () => {
      if (typeof reader.result !== 'string' || !reader.result) {
        reject(new Error('Не удалось прочитать файл изображения.'))
        return
      }
      resolve(reader.result)
    }
    reader.readAsDataURL(file)
  })

  const imageMetrics = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      if (image.naturalWidth === 0 || image.naturalHeight === 0) {
        reject(new Error('Изображение пустое или повреждено.'))
        return
      }
      if (image.naturalWidth > 4096 || image.naturalHeight > 4096) {
        reject(new Error('Изображение должно быть не больше 4096 пикселей по каждой стороне.'))
        return
      }
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => reject(new Error('Не удалось определить размеры изображения.'))
    image.src = dataUrl
  })

  const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl

  return {
    preview: dataUrl,
    payload: {
      mimeType: file.type,
      base64,
      width: imageMetrics.width,
      height: imageMetrics.height,
      size: file.size,
    },
  }
}

const AdsManager = ({ token, ads, fetchAds, upsertAd, removeAd, isLoading }: AdsManagerProps) => {
  const [form, setForm] = useState<AdFormState>(() => createInitialAdForm())
  const [editingAd, setEditingAd] = useState<AdBanner | null>(null)
  const [feedback, setFeedback] = useState<FeedbackState>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const adsCount = ads.length
  const sortedAds = useMemo(() => ads.slice(), [ads])

  const resetForm = useCallback(() => {
    setForm(createInitialAdForm())
    setEditingAd(null)
    setFeedback(null)
  }, [])

  const ensureToken = () => {
    if (!token) {
      setFeedback({ kind: 'error', message: 'Нет токена администратора. Войдите заново.' })
      return null
    }
    return token
  }

  const handleRefresh = useCallback(() => {
    void fetchAds({ force: true }).catch(() => undefined)
  }, [fetchAds])

  const handleEdit = (ad: AdBanner) => {
    setEditingAd(ad)
    setFeedback(null)
    setForm({
      targetUrl: ad.targetUrl ?? '',
      displayOrder: ad.displayOrder.toString(),
      isActive: ad.isActive,
      startsAt: formatDateInputValue(ad.startsAt),
      endsAt: formatDateInputValue(ad.endsAt),
      imagePreview: buildAdPreview(ad),
      imagePayload: null,
      imageDirty: false,
    })
  }

  const handleImageReset = () => {
    if (editingAd) {
      setForm(state => ({
        ...state,
        imagePayload: null,
        imageDirty: false,
        imagePreview: buildAdPreview(editingAd),
      }))
    } else {
      setForm(state => ({
        ...state,
        imagePayload: null,
        imageDirty: false,
        imagePreview: undefined,
      }))
    }
  }

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    event.target.value = ''
    if (!ACCEPTED_AD_IMAGE_TYPES.includes(file.type)) {
      setFeedback({ kind: 'error', message: 'Допустимы только изображения PNG, JPEG или WebP.' })
      return
    }
    if (file.size > MAX_AD_IMAGE_SIZE_BYTES) {
      setFeedback({ kind: 'error', message: 'Файл слишком большой — максимум 1 МБ.' })
      return
    }
    try {
      const { preview, payload } = await readAdImageFile(file)
      setForm(state => ({
        ...state,
        imagePreview: preview,
        imagePayload: payload,
        imageDirty: true,
      }))
      setFeedback(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось обработать изображение.'
      setFeedback({ kind: 'error', message })
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const adminToken = ensureToken()
    if (!adminToken) return

    const displayOrderValue = Number(form.displayOrder)
    if (!Number.isFinite(displayOrderValue)) {
      setFeedback({ kind: 'error', message: 'Порядок показа должен быть числом.' })
      return
    }
    const displayOrder = Math.trunc(displayOrderValue)
    if (displayOrder < 0 || displayOrder > MAX_AD_DISPLAY_ORDER) {
      setFeedback({
        kind: 'error',
        message: 'Порядок показа должен быть в диапазоне от 0 до 9999.',
      })
      return
    }

    const startsAtIso = convertLocalInputToIso(form.startsAt)
    const endsAtIso = convertLocalInputToIso(form.endsAt)
    if (startsAtIso && endsAtIso) {
      if (new Date(endsAtIso).getTime() < new Date(startsAtIso).getTime()) {
        setFeedback({
          kind: 'error',
          message: 'Дата окончания не может быть раньше даты начала.',
        })
        return
      }
    }

    const targetUrl = form.targetUrl.trim()

    if (!editingAd && !form.imagePayload) {
      setFeedback({ kind: 'error', message: 'Загрузите изображение баннера.' })
      return
    }

    const payloadBase: Omit<AdminAdCreatePayload, 'title' | 'image'> = {
      subtitle: null,
      targetUrl: targetUrl ? targetUrl : null,
      displayOrder,
      isActive: form.isActive,
      startsAt: startsAtIso,
      endsAt: endsAtIso,
    }

    setSubmitting(true)
    setFeedback(null)

    try {
      if (editingAd) {
        const updatePayload: AdminAdUpdatePayload = {
          ...payloadBase,
          title: DEFAULT_AD_TITLE,
        }
        if (form.imageDirty && form.imagePayload) {
          updatePayload.image = form.imagePayload
        }
        const updated = await adminUpdateAd(adminToken, editingAd.id, updatePayload)
        upsertAd(updated)
        resetForm()
        setFeedback({
          kind: 'success',
          message: 'Баннер обновлён.',
          meta: `ID: ${updated.id}`,
        })
      } else {
        const createPayload: AdminAdCreatePayload = {
          ...payloadBase,
          title: DEFAULT_AD_TITLE,
          image: form.imagePayload as AdBannerImage,
        }
        const created = await adminCreateAd(adminToken, createPayload)
        upsertAd(created)
        resetForm()
        setFeedback({
          kind: 'success',
          message: 'Баннер создан.',
          meta: `ID: ${created.id}`,
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось сохранить баннер.'
      setFeedback({ kind: 'error', message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (ad: AdBanner) => {
    const adminToken = ensureToken()
    if (!adminToken) return

    const confirmed =
      typeof window !== 'undefined'
        ? window.confirm('Удалить баннер без возможности восстановления?')
        : true
    if (!confirmed) {
      return
    }

    setDeletingId(ad.id)
    setFeedback(null)
    try {
      await adminDeleteAd(adminToken, ad.id)
      removeAd(ad.id)
      if (editingAd && editingAd.id === ad.id) {
        resetForm()
      }
      setFeedback({ kind: 'success', message: 'Баннер удалён.', meta: `ID: ${ad.id}` })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось удалить баннер.'
      setFeedback({ kind: 'error', message })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section className="ads-section">
      <header className="tab-header">
        <div>
          <h3>Рекламные баннеры</h3>
          <p>
            Управляйте каруселью баннеров в приложении. Изображение отображается в течение 7 секунд,
            активные баннеры переключаются по порядку.
          </p>
        </div>
        <div className="tab-header-actions">
          <button
            type="button"
            className="button-ghost"
            disabled={isLoading || submitting}
            onClick={handleRefresh}
          >
            {isLoading ? 'Обновляем…' : 'Обновить список'}
          </button>
          <span className="ads-count" title="Количество активных записей">
            всего: {adsCount}
          </span>
        </div>
      </header>

      {feedback ? (
        <div className={`inline-feedback ${feedback.kind}`}>
          <div>
            <strong>{feedback.message}</strong>
            {feedback.meta ? <span className="feedback-meta">{feedback.meta}</span> : null}
          </div>
          <button type="button" className="feedback-close" onClick={() => setFeedback(null)}>
            ×
          </button>
        </div>
      ) : null}

      <div className="ads-layout">
        <section className="card ads-form">
          <header>
            <h4>{editingAd ? 'Редактирование баннера' : 'Новый баннер'}</h4>
            <p>
              Добавьте изображение (PNG, JPEG или WebP до 1 МБ) и укажите ссылку для перехода. Заголовок
              формируется автоматически, можно настроить расписание показа.
            </p>
          </header>
          <form className="stacked" onSubmit={handleSubmit}>
            <label>
              Ссылка (HTTP/HTTPS)
              <input
                name="ad-target"
                type="url"
                placeholder="https://liga.ru/promo"
                value={form.targetUrl}
                onChange={event =>
                  setForm(state => ({
                    ...state,
                    targetUrl: event.target.value,
                  }))
                }
              />
            </label>
            <div className="ads-form-row">
              <label>
                Порядок показа
                <input
                  name="ad-order"
                  type="number"
                  min={0}
                  max={MAX_AD_DISPLAY_ORDER}
                  value={form.displayOrder}
                  onChange={event =>
                    setForm(state => ({
                      ...state,
                      displayOrder: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={event =>
                    setForm(state => ({
                      ...state,
                      isActive: event.target.checked,
                    }))
                  }
                />
                <span>Активен</span>
              </label>
            </div>
            <div className="ads-form-row">
              <label>
                Начало показа
                <input
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={event =>
                    setForm(state => ({
                      ...state,
                      startsAt: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Окончание показа
                <input
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={event =>
                    setForm(state => ({
                      ...state,
                      endsAt: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <div className="ads-image-field">
              <label className="file-uploader">
                <span>Изображение баннера</span>
                <input
                  type="file"
                  accept={ACCEPTED_AD_IMAGE_TYPES.join(',')}
                  onChange={handleImageChange}
                />
              </label>
              {form.imagePreview ? (
                <div className="ads-image-preview">
                  <img src={form.imagePreview} alt="Предпросмотр баннера" />
                  {form.imageDirty ? (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={handleImageReset}
                    >
                      Отменить замену
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="ads-image-hint">Загрузите изображение размером до 1 МБ.</p>
              )}
            </div>
            <div className="form-actions">
              <button className="button-primary" type="submit" disabled={submitting}>
                {submitting
                  ? editingAd
                    ? 'Сохраняем…'
                    : 'Создаём…'
                  : editingAd
                    ? 'Сохранить изменения'
                    : 'Создать баннер'}
              </button>
              {editingAd ? (
                <button
                  type="button"
                  className="button-secondary"
                  onClick={resetForm}
                  disabled={submitting}
                >
                  Отменить
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="card ads-list">
          <header>
            <h4>Список баннеров</h4>
            <p>Отсюда можно быстро обновить, отключить или удалить существующие баннеры.</p>
          </header>
          {sortedAds.length ? (
            <ul className="ads-list-items">
              {sortedAds.map((ad, index) => (
                <li key={ad.id} className={`ads-item${editingAd && editingAd.id === ad.id ? ' editing' : ''}`}>
                  <div className="ads-item-preview">
                    <img src={buildAdPreview(ad)} alt="Превью баннера" />
                  </div>
                  <div className="ads-item-body">
                    <div className="ads-item-header">
                      <h5>Баннер #{index + 1}</h5>
                      <span className={`ads-status${ad.isActive ? ' active' : ''}`}>
                        {ad.isActive ? 'Активен' : 'Выключен'}
                      </span>
                    </div>
                    <dl className="ads-item-meta">
                      <div>
                        <dt>ID</dt>
                        <dd>{ad.id}</dd>
                      </div>
                      <div>
                        <dt>Порядок</dt>
                        <dd>{ad.displayOrder}</dd>
                      </div>
                      {ad.targetUrl ? (
                        <div>
                          <dt>Ссылка</dt>
                          <dd>
                            <a href={ad.targetUrl} target="_blank" rel="noreferrer">
                              Открыть
                            </a>
                          </dd>
                        </div>
                      ) : null}
                      {ad.startsAt ? (
                        <div>
                          <dt>Начало</dt>
                          <dd>{formatDate(ad.startsAt)}</dd>
                        </div>
                      ) : null}
                      {ad.endsAt ? (
                        <div>
                          <dt>Окончание</dt>
                          <dd>{formatDate(ad.endsAt)}</dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>Обновлён</dt>
                        <dd>{formatDate(ad.updatedAt)}</dd>
                      </div>
                    </dl>
                    <div className="ads-item-actions">
                      <button
                        type="button"
                        onClick={() => handleEdit(ad)}
                        disabled={submitting || deletingId === ad.id}
                      >
                        Редактировать
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => handleDelete(ad)}
                        disabled={deletingId === ad.id || submitting}
                      >
                        {deletingId === ad.id ? 'Удаляем…' : 'Удалить'}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-placeholder">
              Баннеров пока нет — добавьте первый, чтобы реклама появилась в приложении.
            </div>
          )}
        </section>
      </div>
    </section>
  )
}
