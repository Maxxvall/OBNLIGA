import type {
  Club,
  ClubPlayerLink,
  LineupPortalMatch,
  LineupPortalRosterEntry,
  MatchStatisticEntry,
  MatchStatisticMetric,
  PlayoffCreationResult,
  SeasonAutomationResult,
  SeriesFormat,
  Person,
  AdminRatingSettingsSummary,
  AdminRatingSettingsInput,
  AdminRatingLeaderboardResponse,
  AdminRatingSeasonView,
  AdminRatingSeasonsCollection,
} from '../types'
import type {
  AdBanner,
  AdBannerImage,
  NewsItem,
  ShopItemView,
  ShopOrderStatus,
  ShopOrderView,
} from '@shared/types'

const API_BASE = import.meta.env.VITE_ADMIN_API_BASE || 'http://localhost:3000'

const DEFAULT_ERROR_MESSAGE = 'Произошла ошибка. Попробуйте ещё раз.'

const ERROR_DICTIONARY: Record<string, string> = {
  request_failed: 'Не удалось выполнить запрос. Попробуйте ещё раз.',
  unauthorized: 'Необходима авторизация.',
  invalid_token: 'Токен авторизации недействителен. Войдите снова.',
  missing_token: 'Сессия администратора истекла. Авторизуйтесь снова.',
  missing_lineup_token: 'Сеанс капитана истёк. Авторизуйтесь снова.',
  missing_assistant_token: 'Сеанс помощника истёк. Авторизуйтесь снова.',
  forbidden: 'Недостаточно прав для выполнения операции.',
  news_id_invalid: 'Некорректный идентификатор новости.',
  news_not_found: 'Новость не найдена.',
  news_title_required: 'Введите заголовок новости.',
  news_title_too_long: 'Заголовок не должен превышать 100 символов.',
  news_content_required: 'Введите текст новости.',
  news_update_payload_empty: 'Изменений не обнаружено — сохранение не требуется.',
  ad_title_required: 'Введите название рекламы.',
  ad_title_too_long: 'Название рекламы не должно превышать 80 символов.',
  ad_subtitle_too_long: 'Подзаголовок не должен превышать 160 символов.',
  ad_target_url_invalid: 'Введите корректную ссылку (http или https).',
  ad_target_url_too_long: 'Ссылка слишком длинная — максимум 2000 символов.',
  ad_display_order_invalid: 'Порядок показа должен быть числом от 0 до 9999.',
  ad_image_required: 'Добавьте изображение баннера.',
  ad_image_mime_required: 'Не удалось определить тип изображения.',
  ad_image_mime_unsupported: 'Изображение должно быть в формате PNG, JPEG или WebP.',
  ad_image_base64_required: 'Не удалось прочитать содержимое изображения.',
  ad_image_invalid: 'Файл изображения повреждён или имеет неверный формат.',
  ad_image_too_large: 'Изображение слишком большое — максимум 1 МБ.',
  ad_image_dimensions_invalid: 'Размеры изображения некорректны или превышают 4096 пикселей.',
  ad_image_size_invalid: 'Некорректный размер файла изображения.',
  ad_image_size_mismatch: 'Размер файла не совпадает с содержимым изображения.',
  ad_schedule_invalid: 'Некорректные значения дат показа.',
  ad_schedule_range_invalid: 'Дата окончания не может быть раньше даты начала.',
  ad_starts_at_invalid: 'Некорректная дата начала показа.',
  ad_ends_at_invalid: 'Некорректная дата окончания показа.',
  ad_update_payload_empty: 'Изменений не обнаружено — сохранение не требуется.',
  ad_id_invalid: 'Некорректный идентификатор рекламы.',
  ad_not_found: 'Рекламный баннер не найден.',
  login_and_password_required: 'Введите логин и пароль.',
  invalid_credentials: 'Неверный логин или пароль.',
  admin_auth_unavailable: 'Сервис авторизации временно недоступен.',
  auth_failed: 'Не удалось выполнить вход. Попробуйте ещё раз.',
  login_failed: 'Не удалось выполнить вход. Попробуйте ещё раз.',
  lineup_auth_failed: 'Не удалось авторизоваться на портале составов.',
  season_or_competition_required: 'Для статистики укажите сезон или соревнование.',
  achievement_fields_required: 'Заполните поля достижения.',
  automation_fields_required: 'Заполните параметры автоматизации сезона.',
  automation_needs_participants: 'Добавьте минимум две команды для автоматизации сезона.',
  automation_failed: 'Не удалось запустить автоматизацию сезона.',
  club_already_played: 'Клуб уже сыграл матчи — операция невозможна.',
  club_duplicate: 'Клуб с таким названием или коротким именем уже существует.',
  club_and_shirt_required: 'Выберите клуб и укажите номер игрока.',
  club_in_active_season: 'Клуб участвует в активном сезоне. Сначала завершите сезон.',
  club_in_finished_matches: 'Клуб участвовал в завершённых матчах. Операция запрещена.',
  club_invalid: 'Некорректный клуб.',
  club_not_found: 'Клуб не найден.',
  club_not_in_match: 'Клуб не участвует в выбранном матче.',
  club_players_import_failed: 'Не удалось импортировать игроков. Проверьте формат данных.',
  club_players_update_failed: 'Не удалось обновить список игроков клуба.',
  club_field_too_long: 'Название или короткое имя слишком длинное.',
  clubid_required: 'Выберите клуб.',
  competition_delete_failed: 'Не удалось удалить соревнование.',
  competition_invalid: 'Некорректное соревнование.',
  competition_not_found: 'Соревнование не найдено.',
  create_failed: 'Не удалось сохранить запись. Попробуйте ещё раз.',
  delta_invalid: 'Некорректное изменение значения.',
  disqualification_fields_required: 'Заполните данные дисквалификации.',
  duplicate_person: 'Такая персона уже есть в списке.',
  duplicate_shirt_number: 'Этот игровой номер уже занят.',
  event_create_failed: 'Не удалось добавить событие матча.',
  event_delete_failed: 'Не удалось удалить событие матча.',
  event_fields_required: 'Заполните поля события матча.',
  event_not_found: 'Событие матча не найдено.',
  event_update_failed: 'Не удалось обновить событие матча.',
  finished_match_locked: 'Матч завершён — редактирование недоступно.',
  first_and_last_name_required: 'Введите имя и фамилию.',
  friendly_match_fields_required: 'Заполните данные товарищеского матча.',
  friendly_match_not_found: 'Товарищеский матч не найден.',
  friendly_match_same_teams: 'Выберите разные команды для товарищеского матча.',
  broadcast_url_invalid: 'Введите корректную ссылку на трансляцию VK Видео.',
  internal: 'Внутренняя ошибка сервера. Попробуйте позже.',
  invalid_full_name: 'Введите имя и фамилию через пробел.',
  lineup_fields_required: 'Заполните поля заявки.',
  group_stage_required: 'Настройте группы перед автоматизацией сезона.',
  group_stage_missing: 'Настройте группы перед автоматизацией сезона.',
  group_stage_invalid_count: 'Некорректное количество групп.',
  group_stage_invalid_size: 'Размер группы должен быть не меньше двух команд.',
  group_stage_count_mismatch: 'Количество групп не совпадает с заданным значением.',
  group_stage_invalid_index: 'Некорректный индекс группы.',
  group_stage_duplicate_index: 'Индексы групп должны быть уникальны и идти по порядку.',
  group_stage_label_required: 'Укажите название для каждой группы.',
  group_stage_slot_count: 'Заполните все слоты участников в каждой группе.',
  group_stage_invalid_qualify: 'Квалификационный порог должен быть в пределах размера группы.',
  group_stage_invalid_slot_position: 'Некорректная позиция слота в группе.',
  group_stage_duplicate_slot_position: 'Позиции внутри группы не должны повторяться.',
  group_stage_slot_club_required: 'Выберите клуб для каждой позиции в группе.',
  group_stage_duplicate_club: 'Клуб не может участвовать в нескольких группах одновременно.',
  group_stage_index_range: 'Индексы групп должны идти последовательно начиная с 1.',
  group_stage_incomplete: 'Все группы должны быть полностью заполнены.',
  match_club_not_found: 'Клуб не найден среди участников матча.',
  match_fields_required: 'Заполните параметры матча.',
  match_not_found: 'Матч не найден.',
  match_not_available: 'Матч недоступен для модерации.',
  match_lineup_failed: 'Не удалось получить заявку матча.',
  match_events_failed: 'Не удалось получить события матча.',
  match_statistics_failed: 'Не удалось получить статистику матча.',
  match_statistics_update_failed: 'Не удалось обновить статистику матча.',
  match_statistics_expired: 'Статистика матча устарела и была очищена.',
  matches_not_finished: 'Завершите все матчи перед созданием плей-офф.',
  metric_invalid: 'Некорректный показатель статистики.',
  name_and_city_required: 'Укажите название и город.',
  name_and_short_name_required: 'Укажите название и короткое имя.',
  name_type_series_format_required: 'Укажите название, тип и формат серий.',
  no_names_provided: 'Список имён пуст.',
  not_enough_pairs: 'Недостаточно команд для формирования плей-офф.',
  not_enough_participants: 'Недостаточно участников.',
  penalty_shootout_not_available:
    'Серия пенальти доступна только для матчей плей-офф с форматом до двух побед.',
  penalty_requires_draw:
    'Включить серию пенальти можно только при ничейном счёте в основное время.',
  penalty_scores_invalid: 'Счёт серии пенальти должен быть неотрицательным числом.',
  penalty_scores_required: 'Укажите победителя серии пенальти (счёт не может быть равным).',
  participant_exists_or_invalid: 'Участник уже добавлен или указан неверно.',
  person_has_history: 'У игрока есть история матчей — удаление невозможно.',
  person_is_not_player: 'Выбранная персона не является игроком.',
  personid_required: 'Выберите игрока.',
  person_not_found: 'Игрок не найден в базе.',
  transfer_payload_empty: 'Добавьте переходы в список.',
  transfer_invalid_person: 'Выберите корректного игрока.',
  transfer_invalid_club: 'Выберите корректный клуб.',
  transfer_duplicate_person: 'Игрок уже добавлен в список переходов.',
  transfer_person_not_found: 'Игрок не найден в базе.',
  transfer_person_not_player: 'Указанная персона не является игроком.',
  transfer_club_not_found: 'Клуб не найден.',
  transfer_from_club_mismatch: 'Текущий клуб не совпадает с фактическим.',
  transfer_failed: 'Не удалось зафиксировать трансферы. Попробуйте ещё раз.',
  playoffs_already_exists: 'Плей-офф уже создан.',
  playoffs_creation_failed: 'Не удалось создать плей-офф.',
  playoffs_not_supported: 'Этот формат турнира не поддерживает плей-офф.',
  regular_season_not_finished: 'Регулярный сезон ещё не завершён.',
  roster_fields_required: 'Заполните поля состава.',
  rating_settings_invalid: 'Некорректные параметры периода рейтинга.',
  rating_recalculate_failed: 'Не удалось пересчитать рейтинг. Попробуйте ещё раз.',
  season_dates_locked: 'Даты сезона заблокированы — сезон уже начался.',
  season_fields_required: 'Заполните поля сезона.',
  season_not_found: 'Сезон не найден.',
  season_is_active: 'Нельзя удалить активный сезон. Сначала сделайте активным другой сезон.',
  season_delete_failed: 'Не удалось удалить сезон. Попробуйте ещё раз.',
  season_duration_invalid: 'Длительность сезона должна быть положительным числом.',
  season_start_invalid: 'Некорректная дата начала сезона.',
  season_end_invalid: 'Некорректная дата завершения сезона.',
  season_already_active: 'Сезон уже активен. Сначала завершите текущий.',
  series_already_exist: 'Серии уже созданы.',
  series_fields_required: 'Заполните поля серии.',
  series_format_locked: 'Формат серий изменить нельзя.',
  series_has_matches: 'Серия содержит матчи — операция невозможна.',
  stadium_used_in_matches: 'Стадион используется в матчах.',
    shop_title_required: 'Введите название товара.',
    shop_title_too_long: 'Название товара слишком длинное.',
    shop_subtitle_too_long: 'Подзаголовок слишком длинный.',
    shop_description_too_long: 'Описание слишком длинное.',
    shop_currency_invalid: 'Некорректный код валюты.',
    shop_currency_unsupported: 'Эта валюта не поддерживается.',
    shop_price_invalid: 'Некорректная цена.',
    shop_stock_invalid: 'Некорректный остаток на складе.',
    shop_max_per_order_invalid: 'Некорректный лимит на заказ.',
    shop_sort_order_invalid: 'Некорректный порядок сортировки.',
    shop_slug_too_long: 'Слаг товара слишком длинный.',
    shop_image_url_invalid: 'Некорректная ссылка на изображение.',
    shop_image_required: 'Загрузите изображение товара.',
    shop_image_mime_required: 'Не удалось определить тип изображения.',
    shop_image_mime_unsupported: 'Поддерживаются только PNG, JPEG или WebP.',
    shop_image_base64_required: 'Не удалось прочитать изображение.',
    shop_image_invalid: 'Файл изображения повреждён.',
    shop_image_too_large: 'Изображение слишком большое — максимум 2 МБ.',
    shop_image_dimensions_invalid: 'Размеры изображения некорректны.',
    shop_image_size_invalid: 'Некорректный размер файла изображения.',
    shop_image_size_mismatch: 'Размер файла не совпадает с содержимым.',
    shop_slug_taken: 'Слаг уже используется.',
    shop_item_invalid: 'Некорректный товар магазина.',
    shop_item_not_found: 'Товар не найден.',
    shop_item_in_use: 'Товар уже есть в заказах — удаление запрещено.',
    shop_item_create_failed: 'Не удалось создать товар.',
    shop_item_update_failed: 'Не удалось обновить товар.',
    shop_item_delete_failed: 'Не удалось удалить товар.',
    shop_status_invalid: 'Некорректный статус.',
    shop_cursor_invalid: 'Некорректный курсор пагинации.',
    shop_order_invalid: 'Некорректный заказ магазина.',
    shop_order_not_found: 'Заказ не найден.',
    shop_update_empty: 'Нет изменений для сохранения.',
    shop_order_locked: 'Статус заказа уже зафиксирован.',
    shop_order_update_failed: 'Не удалось обновить заказ.',
    shop_note_too_long: 'Комментарий слишком длинный.',
    shop_confirmed_by_too_long: 'Поле «Подтвердил» слишком длинное.',
  too_many_names: 'Слишком много имён в списке.',
  update_failed: 'Не удалось сохранить изменения.',
  userid_required: 'Укажите пользователя.',
  user_not_found: 'Пользователь не найден.',
  status_update_invalid: 'Некорректный статус матча.',
  status_transition_invalid: 'Такой переход статуса невозможен.',
  league_player_already_linked: 'Игрок уже привязан к другому пользователю.',
  already_verified: 'Пользователь уже подтверждён как игрок лиги.',
  verification_pending: 'Заявка уже ожидает подтверждения.',
  leaderboard_unavailable: 'Не удалось получить таблицу рейтинга.',
}

const normalizeErrorKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')

const containsCyrillic = (value: string): boolean => /[а-яё]/i.test(value)

export const translateAdminError = (input?: string): string => {
  if (!input) {
    return DEFAULT_ERROR_MESSAGE
  }
  const raw = input.trim()
  if (!raw) {
    return DEFAULT_ERROR_MESSAGE
  }
  if (containsCyrillic(raw)) {
    return raw
  }
  if (/failed to fetch/i.test(raw)) {
    return 'Нет соединения с сервером. Проверьте интернет.'
  }

  const direct = ERROR_DICTIONARY[raw] || ERROR_DICTIONARY[raw.toLowerCase()]
  if (direct) {
    return direct
  }

  const normalized = normalizeErrorKey(raw)
  if (normalized && ERROR_DICTIONARY[normalized]) {
    return ERROR_DICTIONARY[normalized]
  }

  if (normalized.endsWith('_required')) {
    return 'Заполните обязательные поля.'
  }

  if (normalized.endsWith('_invalid')) {
    return 'Проверьте корректность введённых данных.'
  }

  return `Ошибка: ${raw}`
}

export class AdminApiError extends Error {
  code: string

  constructor(code: string) {
    const message = translateAdminError(code)
    super(message)
    this.code = code
    this.name = 'AdminApiError'
  }
}

interface AdminLoginResponse {
  ok: boolean
  token: string
  expiresIn: number
  error?: string
  errorCode?: string
}

export const adminLogin = async (login: string, password: string): Promise<AdminLoginResponse> => {
  const response = await fetch(`${API_BASE}/api/admin/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ login, password }),
  })

  const data = (await response.json().catch(() => ({}))) as Partial<AdminLoginResponse>

  if (!response.ok) {
    const errorCode = (data.error as string) || 'invalid_credentials'
    return {
      ok: false,
      token: '',
      expiresIn: 0,
      error: translateAdminError(errorCode),
      errorCode,
    }
  }

  return {
    ok: true,
    token: data.token ?? '',
    expiresIn: data.expiresIn ?? 0,
  }
}

interface ApiResponseEnvelope<T> {
  ok: boolean
  data?: T
  error?: string
  meta?: { version?: number }
}

const ensureToken = (token?: string): string => {
  if (!token) {
    throw new AdminApiError('missing_token')
  }
  return token
}

interface AdminResponseWithMeta<T> {
  data: T
  meta?: { version?: number }
  version?: number
}

const normalizeHeaders = (input?: HeadersInit): Record<string, string> => {
  if (!input) {
    return {}
  }
  if (input instanceof Headers) {
    return Array.from(input.entries()).reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = value
      return acc
    }, {})
  }
  if (Array.isArray(input)) {
    return input.reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = value
      return acc
    }, {})
  }
  return { ...input }
}

export const adminRequestWithMeta = async <T>(
  token: string | undefined,
  path: string,
  init: RequestInit = {}
): Promise<AdminResponseWithMeta<T>> => {
  const safeToken = ensureToken(token)
  const normalizedHeaders = normalizeHeaders(init.headers)
  const hasExplicitContentType = Object.keys(normalizedHeaders).some(
    header => header.toLowerCase() === 'content-type'
  )

  if (init.body !== undefined && !hasExplicitContentType) {
    normalizedHeaders['Content-Type'] = 'application/json'
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${safeToken}`,
      ...normalizedHeaders,
    },
  })

  const raw = await response.text()
  let payload: ApiResponseEnvelope<T>
  try {
    payload = raw
      ? (JSON.parse(raw) as ApiResponseEnvelope<T>)
      : ({ ok: response.ok } as ApiResponseEnvelope<T>)
  } catch (err) {
    payload = { ok: response.ok }
  }

  if (!response.ok) {
    const errorCode = payload?.error || response.statusText || 'request_failed'
    throw new AdminApiError(errorCode)
  }

  if (!payload?.ok) {
    const errorCode = payload?.error || 'request_failed'
    throw new AdminApiError(errorCode)
  }

  const versionHeader = response.headers.get('X-Resource-Version')
  const version = versionHeader !== null ? Number(versionHeader) : undefined
  const normalizedVersion = Number.isFinite(version) ? version : undefined

  return {
    data: payload.data as T,
    meta: payload.meta,
    version: normalizedVersion,
  }
}

export const adminRequest = async <T>(
  token: string | undefined,
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  const { data } = await adminRequestWithMeta<T>(token, path, init)
  return data
}

export const adminGet = async <T>(token: string | undefined, path: string): Promise<T> =>
  adminRequest<T>(token, path, { method: 'GET' })

export const adminPost = async <T>(
  token: string | undefined,
  path: string,
  body?: unknown
): Promise<T> =>
  adminRequest<T>(token, path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

export const adminPut = async <T>(
  token: string | undefined,
  path: string,
  body?: unknown
): Promise<T> =>
  adminRequest<T>(token, path, {
    method: 'PUT',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

export const adminPatch = async <T>(
  token: string | undefined,
  path: string,
  body?: unknown
): Promise<T> =>
  adminRequest<T>(token, path, {
    method: 'PATCH',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

export const adminFetchRatingSettings = async (
  token: string | undefined
): Promise<AdminRatingSettingsSummary> => adminGet(token, '/api/admin/ratings/settings')

export const adminUpdateRatingSettings = async (
  token: string | undefined,
  input: AdminRatingSettingsInput
) =>
  adminRequestWithMeta<AdminRatingSettingsSummary>(token, '/api/admin/ratings/settings', {
    method: 'PUT',
    body: JSON.stringify(input),
  })

export const adminRecalculateRatings = async (
  token: string | undefined,
  body?: { userIds?: number[] }
) =>
  adminRequestWithMeta<AdminRatingSettingsSummary>(token, '/api/admin/ratings/recalculate', {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  })

export const adminFetchRatingLeaderboard = async (
  token: string | undefined,
  params: { scope?: string; page?: number; pageSize?: number }
): Promise<AdminRatingLeaderboardResponse> => {
  const search = new URLSearchParams()
  if (params.scope) search.set('scope', params.scope)
  if (params.page) search.set('page', String(params.page))
  if (params.pageSize) search.set('pageSize', String(params.pageSize))
  const query = search.toString()
  const path = `/api/admin/ratings/leaderboard${query ? `?${query}` : ''}`
  return adminGet(token, path)
}

export const adminFetchRatingSeasons = async (
  token: string | undefined
): Promise<AdminRatingSeasonsCollection> => adminGet(token, '/api/admin/ratings/seasons')

export const adminStartRatingSeason = async (
  token: string | undefined,
  scope: 'current' | 'yearly',
  payload: { startsAt?: string; durationDays: number }
) =>
  adminPost(token, `/api/admin/ratings/seasons/${scope}/start`, payload) as Promise<
    AdminRatingSeasonView
  >

export const adminCloseRatingSeason = async (
  token: string | undefined,
  scope: 'current' | 'yearly',
  payload?: { endedAt?: string }
) =>
  adminPost(token, `/api/admin/ratings/seasons/${scope}/close`, payload ?? {}) as Promise<
    AdminRatingSeasonView
  >

export const adminDelete = async <T>(token: string | undefined, path: string): Promise<T> =>
  adminRequest<T>(token, path, { method: 'DELETE' })

export interface AdminAdCreatePayload {
  title: string
  subtitle?: string | null
  targetUrl?: string | null
  displayOrder?: number
  isActive?: boolean
  startsAt?: string | null
  endsAt?: string | null
  image: AdBannerImage
}

export type AdminAdUpdatePayload = Partial<Omit<AdminAdCreatePayload, 'image'>> & {
  image?: AdBannerImage
}

export const adminFetchAds = async (
  token: string | undefined
): Promise<AdBanner[]> => adminGet<AdBanner[]>(token, '/api/admin/news/ads')

export const adminCreateAd = async (
  token: string | undefined,
  payload: AdminAdCreatePayload
): Promise<AdBanner> => adminPost<AdBanner>(token, '/api/admin/news/ads', payload)

export const adminUpdateAd = async (
  token: string | undefined,
  adId: string,
  payload: AdminAdUpdatePayload
): Promise<AdBanner> => adminPatch<AdBanner>(token, `/api/admin/news/ads/${adId}`, payload)

export const adminDeleteAd = async (
  token: string | undefined,
  adId: string
): Promise<AdBanner> => adminDelete<AdBanner>(token, `/api/admin/news/ads/${adId}`)

export interface AdminShopImagePayload {
  mimeType: string
  base64: string
  width: number
  height: number
  size: number
}

export interface AdminShopItemPayload {
  title: string
  subtitle?: string | null
  description?: string | null
  priceCents: number
  currencyCode: string
  stockQuantity?: number | null
  maxPerOrder?: number
  sortOrder?: number
  isActive?: boolean
  slug?: string | null
  image?: AdminShopImagePayload | null
  imageUrl?: string | null
}

export type AdminShopItemUpdatePayload = Partial<AdminShopItemPayload>

export interface AdminShopOrderListParams {
  status?: ShopOrderStatus | 'ALL'
  search?: string
  limit?: number
  cursor?: string | null
}

export interface AdminShopOrderListResult {
  orders: ShopOrderView[]
  nextCursor: string | null
}

export interface AdminShopOrderUpdatePayload {
  status?: ShopOrderStatus
  customerNote?: string | null
  confirmedBy?: string | null
}

export const adminFetchShopItems = async (
  token: string | undefined,
  options?: { includeInactive?: boolean }
): Promise<ShopItemView[]> => {
  const params = new URLSearchParams()
  if (options?.includeInactive) {
    params.set('includeInactive', 'true')
  }
  const query = params.size ? `?${params.toString()}` : ''
  return adminGet<ShopItemView[]>(token, `/api/admin/shop/items${query}`)
}

export const adminCreateShopItem = async (
  token: string | undefined,
  payload: AdminShopItemPayload
): Promise<ShopItemView> => adminPost<ShopItemView>(token, '/api/admin/shop/items', payload)

export const adminUpdateShopItem = async (
  token: string | undefined,
  itemId: number,
  payload: AdminShopItemUpdatePayload
): Promise<ShopItemView> => adminPut<ShopItemView>(token, `/api/admin/shop/items/${itemId}`, payload)

export const adminSetShopItemStatus = async (
  token: string | undefined,
  itemId: number,
  isActive: boolean
): Promise<ShopItemView> =>
  adminPatch<ShopItemView>(token, `/api/admin/shop/items/${itemId}/status`, { isActive })

export const adminDeleteShopItem = async (
  token: string | undefined,
  itemId: number
): Promise<void> => adminDelete<void>(token, `/api/admin/shop/items/${itemId}`)

export const adminFetchShopOrders = async (
  token: string | undefined,
  params?: AdminShopOrderListParams
): Promise<AdminShopOrderListResult> => {
  const searchParams = new URLSearchParams()
  if (params?.status && params.status !== 'ALL') {
    searchParams.set('status', params.status)
  }
  if (params?.search) {
    const trimmed = params.search.trim()
    if (trimmed) {
      searchParams.set('search', trimmed)
    }
  }
  if (params?.limit && Number.isFinite(params.limit)) {
    const normalized = Math.min(50, Math.max(1, Math.trunc(params.limit)))
    searchParams.set('limit', normalized.toString())
  }
  if (params?.cursor) {
    searchParams.set('cursor', params.cursor)
  }
  const query = searchParams.size ? `?${searchParams.toString()}` : ''
  const { data, meta } = await adminRequestWithMeta<ShopOrderView[]>(
    token,
    `/api/admin/shop/orders${query}`
  )
  let nextCursor: string | null = null
  if (meta && typeof (meta as { nextCursor?: string | null }).nextCursor !== 'undefined') {
    const rawCursor = (meta as { nextCursor?: string | null }).nextCursor
    nextCursor = rawCursor ?? null
  }
  return {
    orders: data,
    nextCursor,
  }
}

export const adminFetchShopOrder = async (
  token: string | undefined,
  orderId: string
): Promise<ShopOrderView> => adminGet<ShopOrderView>(token, `/api/admin/shop/orders/${orderId}`)

export const adminUpdateShopOrder = async (
  token: string | undefined,
  orderId: string,
  payload: AdminShopOrderUpdatePayload
): Promise<ShopOrderView> =>
  adminPatch<ShopOrderView>(token, `/api/admin/shop/orders/${orderId}`, payload)

export interface UpdateClubPlayersPayload {
  players: Array<{ personId: number; defaultShirtNumber?: number | null }>
}

export interface SeasonAutomationPayload {
  competitionId: number
  seasonName: string
  startDate: string
  matchDayOfWeek: number
  matchTime?: string
  city?: string
  clubIds: number[]
  seriesFormat: SeriesFormat
  groupStage?: SeasonGroupStagePayload
  /** Количество кругов в группе (1 или 2) */
  groupRounds?: number
  /** До скольких побед в серии плей-офф (1, 3, 5, 7) */
  playoffBestOf?: number
}

export interface SeasonGroupStagePayload {
  groupCount: number
  groupSize: number
  qualifyCount: number
  groups: SeasonGroupAutomationPayload[]
}

export interface SeasonGroupAutomationPayload {
  groupIndex: number
  label: string
  qualifyCount: number
  slots: SeasonGroupSlotAutomationPayload[]
}

export interface SeasonGroupSlotAutomationPayload {
  position: number
  clubId: number
}

export interface ImportDecision {
  line: string
  useExistingPersonId: number | null // null = создать нового
}

export interface ImportClubPlayersPayload {
  lines: string[]
  decisions?: ImportDecision[]
}

export interface PlayoffCreationPayload {
  bestOfLength?: number
}

export interface PlayerTransferInput {
  personId: number
  toClubId: number
  fromClubId?: number | null
}

export interface PlayerTransferSummary {
  personId: number
  person: Person
  fromClubId: number | null
  toClubId: number | null
  fromClub?: Club | null
  toClub?: Club | null
  status: 'moved' | 'skipped'
  reason?: 'same_club'
}

export interface PlayerTransfersResult {
  results: PlayerTransferSummary[]
  movedCount: number
  skippedCount: number
  affectedClubIds: number[]
  news?: NewsItem | null
}

export const fetchClubPlayers = async (
  token: string | undefined,
  clubId: number
): Promise<ClubPlayerLink[]> =>
  adminGet<ClubPlayerLink[]>(token, `/api/admin/clubs/${clubId}/players`)

export const fetchMatchStatistics = async (
  token: string | undefined,
  matchId: string
): Promise<{ entries: MatchStatisticEntry[]; version?: number }> => {
  const { data, version } = await adminRequestWithMeta<MatchStatisticEntry[]>(
    token,
    `/api/admin/matches/${matchId}/statistics`,
    { method: 'GET' }
  )
  return {
    entries: data,
    version,
  }
}

export const adjustMatchStatistic = async (
  token: string | undefined,
  matchId: string,
  payload: { clubId: number; metric: MatchStatisticMetric; delta: number }
): Promise<{ entries: MatchStatisticEntry[]; version?: number }> => {
  const { data, version } = await adminRequestWithMeta<MatchStatisticEntry[]>(
    token,
    `/api/admin/matches/${matchId}/statistics/adjust`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  )
  return {
    entries: data,
    version,
  }
}

export const updateClubPlayers = async (
  token: string | undefined,
  clubId: number,
  payload: UpdateClubPlayersPayload
) => adminPut<ClubPlayerLink[]>(token, `/api/admin/clubs/${clubId}/players`, payload)

export const importClubPlayers = async (
  token: string | undefined,
  clubId: number,
  payload: ImportClubPlayersPayload
) => adminPost<ClubPlayerLink[]>(token, `/api/admin/clubs/${clubId}/players/import`, payload)

// Типы для проверки похожих игроков
export interface SimilarPersonMatch {
  person: {
    id: number
    firstName: string
    lastName: string
  }
  clubs: Array<{
    id: number
    name: string
    shortName: string | null
  }>
  matchType: 'exact' | 'normalized' | 'fuzzy'
}

export interface CheckSimilarEntry {
  input: { firstName: string; lastName: string }
  similar: SimilarPersonMatch[]
  exactMatch: SimilarPersonMatch | null
  alreadyInClub: boolean
}

export interface CheckSimilarPlayersResult {
  entries: CheckSimilarEntry[]
  hasSimilar: boolean
}

export const checkSimilarPlayers = async (
  token: string | undefined,
  clubId: number,
  payload: ImportClubPlayersPayload
) => adminPost<CheckSimilarPlayersResult>(token, `/api/admin/clubs/${clubId}/players/check-similar`, payload)

export const applyPlayerTransfers = async(
  token: string | undefined,
  payload: { transfers: PlayerTransferInput[] }
) => adminPost<PlayerTransfersResult>(token, '/api/admin/player-transfers', payload)

export const createSeasonAutomation = async (
  token: string | undefined,
  payload: SeasonAutomationPayload
) => adminPost<SeasonAutomationResult>(token, '/api/admin/seasons/auto', payload)

export const createSeasonPlayoffs = async (
  token: string | undefined,
  seasonId: number,
  payload?: PlayoffCreationPayload
) =>
  adminPost<PlayoffCreationResult>(token, `/api/admin/seasons/${seasonId}/playoffs`, payload ?? {})

interface LineupLoginResponse {
  ok: boolean
  token?: string
  error?: string
  errorCode?: string
}

export const lineupLogin = async (
  login: string,
  password: string
): Promise<LineupLoginResponse> => {
  const response = await fetch(`${API_BASE}/api/lineup-portal/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ login, password }),
  })

  const payload = (await response.json().catch(() => ({}))) as LineupLoginResponse

  if (!response.ok) {
    const errorCode = payload.error || 'login_failed'
    return {
      ok: false,
      error: translateAdminError(errorCode),
      errorCode,
    }
  }

  const errorCode = payload.error

  return {
    ok: Boolean(payload.token),
    token: payload.token,
    error: errorCode ? translateAdminError(errorCode) : undefined,
    errorCode,
  }
}

const ensureLineupToken = (token?: string): string => {
  if (!token) {
    throw new AdminApiError('missing_lineup_token')
  }
  return token
}

const lineupRequest = async <T>(
  token: string | undefined,
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  const authToken = ensureLineupToken(token)
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
      ...(init.headers || {}),
    },
  })

  const payload = (await response.json().catch(() => ({}))) as ApiResponseEnvelope<T>

  if (response.status === 401) {
    throw new AdminApiError('unauthorized')
  }

  if (!response.ok) {
    const errorCode = payload?.error || response.statusText || 'request_failed'
    throw new AdminApiError(errorCode)
  }

  if (!payload?.ok) {
    const errorCode = payload?.error || 'request_failed'
    throw new AdminApiError(errorCode)
  }

  return (payload.data ?? undefined) as T
}

export const lineupFetchMatches = async (token: string | undefined) =>
  lineupRequest<LineupPortalMatch[]>(token, '/api/lineup-portal/matches', { method: 'GET' })

export const lineupFetchRoster = async (
  token: string | undefined,
  matchId: string,
  clubId: number
) =>
  lineupRequest<LineupPortalRosterEntry[]>(
    token,
    `/api/lineup-portal/matches/${matchId}/roster?clubId=${clubId}`,
    { method: 'GET' }
  )

export const lineupUpdateRoster = async (
  token: string | undefined,
  matchId: string,
  payload: {
    clubId: number
    personIds: number[]
    numbers?: Array<{ personId: number; shirtNumber: number }>
  }
) =>
  lineupRequest<unknown>(token, `/api/lineup-portal/matches/${matchId}/roster`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
