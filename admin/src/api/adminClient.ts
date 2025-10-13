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
} from '../types'
import type { NewsItem } from '@shared/types'

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
  club_and_shirt_required: 'Выберите клуб и укажите номер игрока.',
  club_in_active_season: 'Клуб участвует в активном сезоне. Сначала завершите сезон.',
  club_in_finished_matches: 'Клуб участвовал в завершённых матчах. Операция запрещена.',
  club_invalid: 'Некорректный клуб.',
  club_not_found: 'Клуб не найден.',
  club_not_in_match: 'Клуб не участвует в выбранном матче.',
  club_players_import_failed: 'Не удалось импортировать игроков. Проверьте формат данных.',
  club_players_update_failed: 'Не удалось обновить список игроков клуба.',
  clubid_required: 'Выберите клуб.',
  competition_delete_failed: 'Не удалось удалить соревнование.',
  competition_invalid: 'Некорректное соревнование.',
  competition_not_found: 'Соревнование не найдено.',
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
  season_dates_locked: 'Даты сезона заблокированы — сезон уже начался.',
  season_fields_required: 'Заполните поля сезона.',
  season_not_found: 'Сезон не найден.',
  series_already_exist: 'Серии уже созданы.',
  series_fields_required: 'Заполните поля серии.',
  series_format_locked: 'Формат серий изменить нельзя.',
  series_has_matches: 'Серия содержит матчи — операция невозможна.',
  stadium_used_in_matches: 'Стадион используется в матчах.',
  too_many_names: 'Слишком много имён в списке.',
  update_failed: 'Не удалось сохранить изменения.',
  userid_required: 'Укажите пользователя.',
  status_update_invalid: 'Некорректный статус матча.',
  status_transition_invalid: 'Такой переход статуса невозможен.',
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

export const adminDelete = async <T>(token: string | undefined, path: string): Promise<T> =>
  adminRequest<T>(token, path, { method: 'DELETE' })

export interface UpdateClubPlayersPayload {
  players: Array<{ personId: number; defaultShirtNumber?: number | null }>
}

export interface SeasonAutomationPayload {
  competitionId: number
  seasonName: string
  startDate: string
  matchDayOfWeek: number
  matchTime?: string
  clubIds: number[]
  seriesFormat: SeriesFormat
  groupStage?: SeasonGroupStagePayload
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

export interface ImportClubPlayersPayload {
  lines: string[]
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

export const applyPlayerTransfers = async (
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
