import { FastifyInstance, FastifyReply } from 'fastify'
import prisma from '../db'
import jwt from 'jsonwebtoken'
import {
  AchievementMetric,
  CompetitionType,
  DisqualificationReason,
  LineupRole,
  MatchEvent,
  MatchEventType,
  MatchStatus,
  PredictionMarketType,
  Prisma,
  RatingLevel,
  RatingScope,
  RoundType,
  SeriesFormat,
  SeriesStatus,
} from '@prisma/client'
import { handleMatchFinalization, rebuildCareerStatsForClubs } from '../services/matchAggregation'
import { buildLeagueTable } from '../services/leagueTable'
import { refreshFriendlyAggregates, refreshLeagueMatchAggregates } from '../services/leagueSchedule'
import { matchBroadcastCacheKey } from '../services/matchDetailsPublic'
import { createSeasonPlayoffs, runSeasonAutomation } from '../services/seasonAutomation'
import {
  ensurePredictionTemplatesForMatch,
  invalidateUpcomingPredictionCaches,
  MatchTemplateEnsureSummary,
} from '../services/predictionTemplateService'
import {
  formatTotalLine,
  computeTotalLineAlternatives,
  suggestTotalGoalsLineForMatch,
  PredictionMatchContext,
} from '../services/predictionTotalsService'
import {
  PREDICTION_TOTAL_GOALS_BASE_POINTS,
  PREDICTION_TOTAL_MAX_LINE,
  PREDICTION_TOTAL_MIN_LINE,
} from '../services/predictionConstants'
import { serializePrisma } from '../utils/serialization'
import { defaultCache, PUBLIC_LEAGUE_RESULTS_KEY, PUBLIC_LEAGUE_SCHEDULE_KEY } from '../cache'
import { deliverTelegramNewsNow, enqueueTelegramNewsJob } from '../queue/newsWorker'
import { secureEquals } from '../utils/secureEquals'
import { parseBigIntId, parseNumericId, parseOptionalNumericId } from '../utils/parsers'
import {
  recalculateUserRatings,
  ratingPublicCacheKey,
  loadRatingLeaderboard,
} from '../services/ratingAggregation'
import {
  RATING_DEFAULT_PAGE_SIZE,
  RATING_MAX_PAGE_SIZE,
  ratingScopeKey,
} from '../services/ratingConstants'
import {
  composeRatingSettingsPayload,
  computeRatingWindows,
  getRatingSettings,
  RatingSettingsSnapshot,
  saveRatingSettings,
} from '../services/ratingSettings'
import {
  closeActiveSeason,
  fetchSeasonSummaries,
  getActiveSeason,
  SeasonWinnerInput,
  startSeason,
  resetSeasonPointsAchievements,
} from '../services/ratingSeasons'
import { adminAuthHook, getJwtSecret } from '../utils/adminAuth'
import {
  RequestError,
  broadcastMatchStatistics,
  createMatchEvent,
  deleteMatchEvent,
  cleanupExpiredMatchStatistics,
  hasMatchStatisticsExpired,
  MatchStatisticMetric,
  MATCH_STATISTIC_METRICS,
  getMatchStatisticsWithMeta,
  loadMatchLineupWithNumbers,
  matchStatsCacheKey,
  updateMatchEvent,
  applyStatisticDelta,
} from './matchModerationHelpers'
import {
  processPendingAchievementJobs,
  getAchievementJobsStats,
} from '../services/achievementJobProcessor'
import { syncAllSeasonPointsProgress } from '../services/achievementProgress'
import {
  scheduleMatchStartNotifications,
  scheduleMatchEndNotifications,
} from './subscriptionHelpers'

declare module 'fastify' {
  interface FastifyRequest {
    admin?: {
      sub: string
      role: string
    }
  }
}


class TransferError extends Error {
  constructor(code: string) {
    super(code)
    this.name = 'TransferError'
  }
}

type TransferSummary = {
  personId: number
  person: { id: number; firstName: string; lastName: string }
  fromClubId: number | null
  toClubId: number | null
  fromClub: { id: number; name: string; shortName: string } | null
  toClub: { id: number; name: string; shortName: string } | null
  status: 'moved' | 'skipped'
  reason?: 'same_club'
}

type AdminTestLoginBody = {
  userId?: number | string
  username?: string | null
  firstName?: string | null
}

type NewsCreateBody = {
  title?: string
  content?: string
  coverUrl?: string | null
  sendToTelegram?: boolean
}

type NewsUpdateBody = {
  title?: string | null
  content?: string | null
  coverUrl?: string | null
  sendToTelegram?: boolean
}

type NewsParams = {
  newsId: string
}

type PredictionTemplateOverrideBody = {
  marketType?: PredictionMarketType
  mode?: 'auto' | 'manual'
  line?: number | string
  basePoints?: number
  difficultyMultiplier?: number
}

type PredictionTemplateEnsureSummaryView = {
  matchId: string
  createdMarkets: PredictionMarketType[]
  updatedMarkets: PredictionMarketType[]
  skippedManualMarkets: PredictionMarketType[]
  changed: boolean
  totalSuggestion?: TotalGoalsSuggestionView | null
}

type PredictionTemplateOverrideView = {
  mode: 'auto' | 'manual'
  template: ReturnType<typeof serializePredictionTemplateForAdmin> | null
  suggestion: TotalGoalsSuggestionView | null
  summary?: PredictionTemplateEnsureSummaryView
}

type ClubIdParams = { clubId: string }

type PublishTopicHandler = (topic: string, payload: unknown) => Promise<unknown> | unknown

type FastifyInstanceWithPublishTopic = FastifyInstance & {
  publishTopic?: PublishTopicHandler
}

type RawGroupStagePayload = {
  groupCount?: number
  groupSize?: number
  qualifyCount?: number
  groups?: RawGroupPayload[]
}

type RawGroupPayload = {
  groupIndex?: number
  label?: string
  qualifyCount?: number
  slots?: RawGroupSlotPayload[]
}

type RawGroupSlotPayload = {
  position?: number
  clubId?: number
}

const getParam = (params: unknown, key: string): string => {
  if (params && typeof params === 'object' && key in (params as Record<string, unknown>)) {
    const value = (params as Record<string, unknown>)[key]
    if (value === undefined || value === null) {
      throw new Error(`param_${key}_missing`)
    }
    return String(value)
  }
  throw new Error(`param_${key}_missing`)
}

const normalizeShirtNumber = (value: number | null | undefined): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  const normalized = Math.floor(value)
  if (normalized <= 0) {
    return null
  }
  return Math.min(normalized, 999)
}

const assignSeasonShirtNumber = (preferred: number | null, taken: Set<number>): number => {
  if (typeof preferred === 'number' && preferred > 0 && !taken.has(preferred)) {
    taken.add(preferred)
    return preferred
  }
  let candidate = typeof preferred === 'number' && preferred > 0 ? preferred : 1
  if (candidate < 1) candidate = 1
  for (let offset = 0; offset < 999; offset += 1) {
    const value = ((candidate - 1 + offset) % 999) + 1
    if (!taken.has(value)) {
      taken.add(value)
      return value
    }
  }
  let fallback = 1
  while (taken.has(fallback)) {
    fallback += 1
  }
  taken.add(fallback)
  return fallback
}

const shouldSyncSeasonRoster = (season: { endDate: Date }): boolean => {
  const now = new Date()
  return season.endDate >= now
}

const syncClubSeasonRosters = async (
  tx: Prisma.TransactionClient,
  clubId: number
): Promise<number[]> => {
  const clubPlayers = await tx.clubPlayer.findMany({
    where: { clubId },
    orderBy: [{ defaultShirtNumber: 'asc' }, { personId: 'asc' }],
  })

  const desiredNumbers = new Map<number, number | null>()
  for (const player of clubPlayers) {
    desiredNumbers.set(player.personId, normalizeShirtNumber(player.defaultShirtNumber))
  }

  const currentParticipants = await tx.seasonParticipant.findMany({
    where: { clubId },
    include: {
      season: {
        select: {
          id: true,
          endDate: true,
        },
      },
    },
  })

  const clubPlayerIds = new Set(clubPlayers.map(player => player.personId))
  const updatedSeasonIds: number[] = []

  for (const participant of currentParticipants) {
    const season = participant.season
    if (!season || !shouldSyncSeasonRoster(season)) {
      continue
    }

    const rosterEntries = await tx.seasonRoster.findMany({
      where: { seasonId: season.id, clubId },
      orderBy: [{ shirtNumber: 'asc' }],
    })

    const obsoleteEntries = rosterEntries.filter(entry => !clubPlayerIds.has(entry.personId))
    if (obsoleteEntries.length) {
      await tx.seasonRoster.deleteMany({
        where: {
          seasonId: season.id,
          clubId,
          personId: { in: obsoleteEntries.map(entry => entry.personId) },
        },
      })
    }

    const activeEntries = rosterEntries.filter(entry => clubPlayerIds.has(entry.personId))
    const entryByPerson = new Map(activeEntries.map(entry => [entry.personId, entry]))
    const takenNumbers = new Set<number>(activeEntries.map(entry => entry.shirtNumber))

    const updates: Array<{ personId: number; shirtNumber: number }> = []
    const creations: Array<{ personId: number; shirtNumber: number }> = []

    for (const player of clubPlayers) {
      const preferred = desiredNumbers.get(player.personId) ?? null
      const existing = entryByPerson.get(player.personId)
      if (existing) {
        if (
          typeof preferred === 'number' &&
          preferred > 0 &&
          preferred !== existing.shirtNumber &&
          !takenNumbers.has(preferred)
        ) {
          takenNumbers.delete(existing.shirtNumber)
          takenNumbers.add(preferred)
          updates.push({ personId: player.personId, shirtNumber: preferred })
        }
        continue
      }

      const assigned = assignSeasonShirtNumber(preferred, takenNumbers)
      creations.push({ personId: player.personId, shirtNumber: assigned })
    }

    if (updates.length) {
      for (const update of updates) {
        await tx.seasonRoster.update({
          where: {
            seasonId_clubId_personId: {
              seasonId: season.id,
              clubId,
              personId: update.personId,
            },
          },
          data: { shirtNumber: update.shirtNumber },
        })
      }
    }

    if (creations.length) {
      await tx.seasonRoster.createMany({
        data: creations.map(entry => ({
          seasonId: season.id,
          clubId,
          personId: entry.personId,
          shirtNumber: entry.shirtNumber,
          registrationDate: new Date(),
        })),
        skipDuplicates: true,
      })
    }

    if (obsoleteEntries.length || updates.length || creations.length) {
      updatedSeasonIds.push(season.id)
    }
  }

  return Array.from(new Set(updatedSeasonIds))
}

const formatNameToken = (token: string): string => {
  return token
    .split('-')
    .filter(part => part.length > 0)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('-')
}

const normalizePersonName = (value: string): string => {
  return value
    .split(/\s+/)
    .filter(chunk => chunk.length > 0)
    .map(formatNameToken)
    .join(' ')
}

const parseFullNameLine = (line: string): { firstName: string; lastName: string } => {
  const parts = line.trim().split(/\s+/)
  if (parts.length < 2) {
    throw new Error('invalid_full_name')
  }
  const lastNameRaw = parts[0]
  const firstNameRaw = parts.slice(1).join(' ')
  const lastName = normalizePersonName(lastNameRaw)
  const firstName = normalizePersonName(firstNameRaw)
  if (!firstName || !lastName) {
    throw new Error('invalid_full_name')
  }
  return { firstName, lastName }
}

/**
 * Нормализует строку для нечёткого сравнения имён:
 * - Приводит к нижнему регистру
 * - Убирает лишние пробелы
 * - Убирает дефисы и апострофы (О'Коннор -> оконнор)
 * - Транслитерирует ё → е
 */
const normalizeForFuzzyMatch = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[-'`'']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Вычисляет расстояние Левенштейна между двумя строками
 */
const levenshteinDistance = (a: string, b: string): number => {
  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

/**
 * Проверяет похожесть двух имён
 * Возвращает true если:
 * - Нормализованные строки совпадают
 * - Или расстояние Левенштейна <= 2 для коротких имён или <= 3 для длинных
 */
const isSimilarName = (name1: string, name2: string): boolean => {
  const n1 = normalizeForFuzzyMatch(name1)
  const n2 = normalizeForFuzzyMatch(name2)

  if (n1 === n2) return true

  const maxLen = Math.max(n1.length, n2.length)
  const threshold = maxLen <= 5 ? 1 : maxLen <= 10 ? 2 : 3

  return levenshteinDistance(n1, n2) <= threshold
}

/**
 * Ищет похожие персоны по ФИО
 */
interface SimilarPersonMatch {
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

const sendSerialized = <T>(reply: FastifyReply, data: T) =>
  reply.send({ ok: true, data: serializePrisma(data) })

const SEASON_STATS_CACHE_TTL_SECONDS = Number(process.env.ADMIN_CACHE_TTL_SEASON_STATS ?? '60')
const CAREER_STATS_CACHE_TTL_SECONDS = Number(process.env.ADMIN_CACHE_TTL_CAREER_STATS ?? '180')
const NEWS_CACHE_KEY = 'news:all'
const ADS_CACHE_KEY = 'ads:all'

const MAX_AD_TITLE_LENGTH = 80
const MAX_AD_SUBTITLE_LENGTH = 160
const MAX_AD_TARGET_URL_LENGTH = 2000
const MAX_AD_DISPLAY_ORDER = 9999
const MAX_AD_IMAGE_SIZE_BYTES = 1_000_000
const MAX_AD_IMAGE_DIMENSION = 4096
const ALLOWED_AD_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

interface AdBannerRow {
  id: bigint
  title: string
  subtitle: string | null
  targetUrl: string | null
  imageData: Buffer
  imageMime: string
  imageWidth: number
  imageHeight: number
  imageSize: number
  displayOrder: number
  isActive: boolean
  startsAt: Date | null
  endsAt: Date | null
  createdAt: Date
  updatedAt: Date
}

interface ParsedAdImage {
  buffer: Buffer
  mimeType: string
  width: number
  height: number
  size: number
}

const normalizeAdBannerRow = (row: AdBannerRow) => {
  const base64 = Buffer.isBuffer(row.imageData) ? row.imageData.toString('base64') : ''
  return {
    id: row.id.toString(),
    title: row.title,
    subtitle: row.subtitle,
    targetUrl: row.targetUrl,
    image: {
      mimeType: row.imageMime,
      base64,
      width: row.imageWidth,
      height: row.imageHeight,
      size: row.imageSize,
    },
    displayOrder: row.displayOrder,
    isActive: row.isActive,
    startsAt: row.startsAt ? row.startsAt.toISOString() : null,
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

const parseOptionalDateTime = (value: unknown, field: string): Date | null => {
  if (value === undefined || value === null || value === '') {
    return null
  }
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field}_invalid`)
  }
  return date
}

const normalizeAdTargetUrl = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return null
  }
  const raw = String(value).trim()
  if (!raw) {
    return null
  }
  if (raw.length > MAX_AD_TARGET_URL_LENGTH) {
    throw new Error('ad_target_url_too_long')
  }
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('ad_target_url_invalid')
    }
  } catch (err) {
    throw new Error('ad_target_url_invalid')
  }
  return raw
}

const VK_BROADCAST_HOSTS = new Set([
  'vk.com',
  'www.vk.com',
  'm.vk.com',
  'vkvideo.ru',
  'www.vkvideo.ru',
])

const VK_VIDEO_ID_PATTERN = /video-?\d+_\d+/i

const normalizeBroadcastUrl = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch (_err) {
    return null
  }

  if (parsed.protocol !== 'https:') {
    return null
  }

  const hostname = parsed.hostname.toLowerCase()
  if (!VK_BROADCAST_HOSTS.has(hostname)) {
    return null
  }

  const decodedHref = decodeURIComponent(parsed.href)
  if (!VK_VIDEO_ID_PATTERN.test(decodedHref)) {
    return null
  }

  if (decodedHref.length > 2048) {
    return null
  }

  return parsed.toString()
}

type TotalGoalsLineAlternativeView = {
  line: number
  formattedLine: string
  delta: number
}

type TotalGoalsSuggestionView = {
  line: number
  fallback: boolean
  sampleSize: number
  averageGoals: number
  standardDeviation: number
  confidence: number
  generatedAt: string
  alternatives: TotalGoalsLineAlternativeView[]
  samples: Array<{
    matchId: string
    matchDateTime: string
    homeTeamId: number
    awayTeamId: number
    totalGoals: number
    weight: number
    isFriendly: boolean
  }>
}

const PREDICTION_TEMPLATE_SELECT = {
  id: true,
  matchId: true,
  marketType: true,
  options: true,
  basePoints: true,
  difficultyMultiplier: true,
  isManual: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
} satisfies Prisma.PredictionTemplateSelect

type PredictionTemplateRecord = Prisma.PredictionTemplateGetPayload<{
  select: typeof PREDICTION_TEMPLATE_SELECT
}>

const decimalToNumber = (value: Prisma.Decimal | number): number => {
  if (typeof value === 'number') {
    return value
  }
  return value.toNumber()
}

const buildManualTotalGoalsOptions = (line: number): Prisma.JsonObject => {
  const formattedLine = formatTotalLine(line)
  const numericLine = Number(formattedLine)
  const alternatives = computeTotalLineAlternatives(numericLine)

  return {
    line: numericLine,
    formattedLine,
    manual: true,
    updatedAt: new Date().toISOString(),
    choices: [
      { value: `OVER_${formattedLine}`, label: 'Больше' },
      { value: `UNDER_${formattedLine}`, label: 'Меньше' },
    ],
    alternatives: alternatives.map(variant => ({
      line: variant.line,
      formattedLine: variant.formattedLine,
      delta: variant.delta,
    })),
  }
}

const serializePredictionTemplateForAdmin = (
  template: PredictionTemplateRecord
): {
  id: string
  matchId: string
  marketType: PredictionMarketType
  options: Prisma.JsonValue
  basePoints: number
  difficultyMultiplier: number
  isManual: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
} => ({
  id: template.id.toString(),
  matchId: template.matchId.toString(),
  marketType: template.marketType,
  options: template.options,
  basePoints: template.basePoints,
  difficultyMultiplier: decimalToNumber(template.difficultyMultiplier),
  isManual: template.isManual,
  createdBy: template.createdBy ?? null,
  createdAt: template.createdAt.toISOString(),
  updatedAt: template.updatedAt.toISOString(),
})

const serializeTotalGoalsSuggestion = (
  suggestion: Awaited<ReturnType<typeof suggestTotalGoalsLineForMatch>>
): TotalGoalsSuggestionView | null => {
  if (!suggestion) {
    return null
  }

  return {
    line: suggestion.line,
    fallback: suggestion.fallback,
    sampleSize: suggestion.sampleSize,
    averageGoals: Number(suggestion.averageGoals.toFixed(3)),
    standardDeviation: Number(suggestion.standardDeviation.toFixed(3)),
    confidence: Number(suggestion.confidence.toFixed(3)),
    generatedAt: suggestion.generatedAt.toISOString(),
    alternatives: suggestion.alternatives.map(variant => ({
      line: variant.line,
      formattedLine: variant.formattedLine,
      delta: Number(variant.delta.toFixed(1)),
    })),
    samples: suggestion.samples.map(sample => ({
      matchId: sample.matchId.toString(),
      matchDateTime: sample.matchDateTime.toISOString(),
      homeTeamId: sample.homeTeamId,
      awayTeamId: sample.awayTeamId,
      totalGoals: sample.totalGoals,
      weight: sample.weight,
      isFriendly: sample.isFriendly,
    })),
  }
}

const ADMIN_PREDICTION_MATCH_SELECT = {
  id: true,
  seasonId: true,
  matchDateTime: true,
  status: true,
  homeTeamId: true,
  awayTeamId: true,
  isFriendly: true,
  homeClub: {
    select: {
      id: true,
      name: true,
      shortName: true,
      logoUrl: true,
    },
  },
  awayClub: {
    select: {
      id: true,
      name: true,
      shortName: true,
      logoUrl: true,
    },
  },
  predictionTemplates: {
    orderBy: { marketType: 'asc' },
    select: PREDICTION_TEMPLATE_SELECT,
  },
} satisfies Prisma.MatchSelect

type AdminPredictionMatchRecord = Prisma.MatchGetPayload<{
  select: typeof ADMIN_PREDICTION_MATCH_SELECT
}>

type AdminPredictionClubView = {
  id: number
  name: string
  shortName: string
  logoUrl: string | null
}

type AdminPredictionMatchView = {
  matchId: string
  seasonId: number | null
  matchDateTime: string
  status: MatchStatus
  homeClub: AdminPredictionClubView
  awayClub: AdminPredictionClubView
  templates: ReturnType<typeof serializePredictionTemplateForAdmin>[]
  suggestion: TotalGoalsSuggestionView | null
}

const serializePredictionClub = (club: {
  id: number
  name: string
  shortName: string
  logoUrl: string | null
}): AdminPredictionClubView => ({
  id: club.id,
  name: club.name,
  shortName: club.shortName,
  logoUrl: club.logoUrl ?? null,
})

const serializePredictionMatchForAdmin = (
  match: AdminPredictionMatchRecord,
  suggestion: TotalGoalsSuggestionView | null
): AdminPredictionMatchView => ({
  matchId: match.id.toString(),
  seasonId: match.seasonId ?? null,
  matchDateTime: match.matchDateTime ? match.matchDateTime.toISOString() : new Date().toISOString(),
  status: match.status,
  homeClub: serializePredictionClub(match.homeClub),
  awayClub: serializePredictionClub(match.awayClub),
  templates: match.predictionTemplates.map(serializePredictionTemplateForAdmin),
  suggestion,
})

const serializePredictionTemplateEnsureSummary = (
  summary?: MatchTemplateEnsureSummary | null
): PredictionTemplateEnsureSummaryView | undefined => {
  if (!summary) {
    return undefined
  }

  return {
    matchId: summary.matchId.toString(),
    createdMarkets: summary.createdMarkets.slice(),
    updatedMarkets: summary.updatedMarkets.slice(),
    skippedManualMarkets: summary.skippedManualMarkets.slice(),
    changed: summary.changed,
    totalSuggestion:
      summary.totalSuggestion !== undefined && summary.totalSuggestion !== null
        ? serializeTotalGoalsSuggestion(summary.totalSuggestion) ?? undefined
        : undefined,
  }
}

const isPublishTopicInstance = (
  instance: FastifyInstance
): instance is FastifyInstanceWithPublishTopic => {
  return typeof (instance as { publishTopic?: PublishTopicHandler }).publishTopic === 'function'
}

const publishAdminTopic = async (
  instance: FastifyInstance,
  topic: string,
  payload: unknown
): Promise<void> => {
  if (isPublishTopicInstance(instance)) {
    await instance.publishTopic(topic, payload)
  }
}

const decodeAdImagePayload = (value: unknown, required: boolean): ParsedAdImage | null => {
  if (value === undefined || value === null) {
    if (required) {
      throw new Error('ad_image_required')
    }
    return null
  }

  if (typeof value !== 'object' || value === null) {
    throw new Error('ad_image_invalid')
  }

  const payload = value as Record<string, unknown>
  const mimeTypeRaw = typeof payload.mimeType === 'string' ? payload.mimeType.trim() : ''
  if (!mimeTypeRaw) {
    throw new Error('ad_image_mime_required')
  }
  const normalizedMime = mimeTypeRaw.toLowerCase()
  if (!ALLOWED_AD_IMAGE_MIME_TYPES.has(normalizedMime)) {
    throw new Error('ad_image_mime_unsupported')
  }

  let base64 = typeof payload.base64 === 'string' ? payload.base64.trim() : ''
  if (!base64) {
    throw new Error('ad_image_base64_required')
  }
  const commaIndex = base64.indexOf(',')
  if (base64.startsWith('data:') && commaIndex !== -1) {
    base64 = base64.slice(commaIndex + 1)
  }

  let buffer: Buffer
  try {
    buffer = Buffer.from(base64, 'base64')
  } catch (err) {
    throw new Error('ad_image_invalid')
  }

  if (!buffer || buffer.length === 0) {
    throw new Error('ad_image_invalid')
  }

  if (buffer.length > MAX_AD_IMAGE_SIZE_BYTES) {
    throw new Error('ad_image_too_large')
  }

  const widthValue = Number(payload.width)
  const heightValue = Number(payload.height)
  if (!Number.isFinite(widthValue) || !Number.isFinite(heightValue)) {
    throw new Error('ad_image_dimensions_invalid')
  }
  const width = Math.trunc(widthValue)
  const height = Math.trunc(heightValue)
  if (
    width <= 0 ||
    height <= 0 ||
    width > MAX_AD_IMAGE_DIMENSION ||
    height > MAX_AD_IMAGE_DIMENSION
  ) {
    throw new Error('ad_image_dimensions_invalid')
  }

  const sizeValue = Number(payload.size)
  if (!Number.isFinite(sizeValue) || sizeValue <= 0) {
    throw new Error('ad_image_size_invalid')
  }
  const declaredSize = Math.trunc(sizeValue)
  if (Math.abs(declaredSize - buffer.length) > 32) {
    throw new Error('ad_image_size_mismatch')
  }

  return {
    buffer,
    mimeType: normalizedMime,
    width,
    height,
    size: buffer.length,
  }
}

const loadAdBannerById = async (id: bigint): Promise<AdBannerRow | null> => {
  const rows = await prisma.$queryRaw<AdBannerRow[]>`
    SELECT
      ad_banner_id          AS id,
      title,
      subtitle,
      target_url            AS "targetUrl",
      image_data            AS "imageData",
      image_mime            AS "imageMime",
      image_width           AS "imageWidth",
      image_height          AS "imageHeight",
      image_size            AS "imageSize",
      display_order         AS "displayOrder",
      is_active             AS "isActive",
      starts_at             AS "startsAt",
      ends_at               AS "endsAt",
      created_at            AS "createdAt",
      updated_at            AS "updatedAt"
    FROM ad_banner
    WHERE ad_banner_id = ${id}
    LIMIT 1
  `
  return rows.length ? rows[0] : null
}

const listAllAdBanners = async (): Promise<ReturnType<typeof normalizeAdBannerRow>[]> => {
  const rows = await prisma.$queryRaw<AdBannerRow[]>`
    SELECT
      ad_banner_id          AS id,
      title,
      subtitle,
      target_url            AS "targetUrl",
      image_data            AS "imageData",
      image_mime            AS "imageMime",
      image_width           AS "imageWidth",
      image_height          AS "imageHeight",
      image_size            AS "imageSize",
      display_order         AS "displayOrder",
      is_active             AS "isActive",
      starts_at             AS "startsAt",
      ends_at               AS "endsAt",
      created_at            AS "createdAt",
      updated_at            AS "updatedAt"
    FROM ad_banner
    ORDER BY display_order ASC, updated_at DESC, ad_banner_id DESC
  `
  return rows.map(normalizeAdBannerRow)
}

const seasonStatsCacheKey = (seasonId: number, suffix: string) => `season:${seasonId}:${suffix}`
const competitionStatsCacheKey = (competitionId: number, suffix: string) =>
  `competition:${competitionId}:${suffix}`
const PUBLIC_LEAGUE_SEASONS_KEY = 'public:league:seasons'
const PUBLIC_LEAGUE_TABLE_KEY = 'public:league:table:v2'
const PUBLIC_LEAGUE_TABLE_TTL_SECONDS = 300
const leagueStatsCacheKey = (suffix: string) => `league:${suffix}`

const matchStatisticMetrics: MatchStatisticMetric[] = MATCH_STATISTIC_METRICS

async function loadSeasonClubStats(seasonId: number) {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: {
      competition: true,
      participants: { include: { club: true } },
      groups: {
        include: {
          slots: {
            include: {
              club: {
                select: { id: true, name: true, shortName: true, logoUrl: true },
              },
            },
          },
        },
        orderBy: { groupIndex: 'asc' },
      },
    },
  })

  if (!season) {
    throw new RequestError(404, 'season_not_found')
  }

  const rawStats = await prisma.clubSeasonStats.findMany({
    where: { seasonId },
    include: { club: true },
  })

  const finishedMatches = await prisma.match.findMany({
    where: {
      seasonId,
      status: MatchStatus.FINISHED,
      isFriendly: false,
      OR: [{ roundId: null }, { round: { roundType: RoundType.REGULAR } }],
    },
    select: {
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
    },
  })

  const statsByClub = new Map<number, (typeof rawStats)[number]>()
  for (const stat of rawStats) {
    statsByClub.set(stat.clubId, stat)
  }

  type ComputedClubStats = {
    points: number
    wins: number
    losses: number
    goalsFor: number
    goalsAgainst: number
  }

  const computedStats = new Map<number, ComputedClubStats>()
  const ensureComputed = (clubId: number): ComputedClubStats => {
    let entry = computedStats.get(clubId)
    if (!entry) {
      entry = { points: 0, wins: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 }
      computedStats.set(clubId, entry)
    }
    return entry
  }

  for (const match of finishedMatches) {
    const home = ensureComputed(match.homeTeamId)
    const away = ensureComputed(match.awayTeamId)

    home.goalsFor += match.homeScore
    home.goalsAgainst += match.awayScore
    away.goalsFor += match.awayScore
    away.goalsAgainst += match.homeScore

    if (match.homeScore > match.awayScore) {
      home.points += 3
      home.wins += 1
      away.losses += 1
    } else if (match.homeScore < match.awayScore) {
      away.points += 3
      away.wins += 1
      home.losses += 1
    } else {
      home.points += 1
      away.points += 1
    }
  }

  const seasonGroups = (season.groups ?? []).map(group => ({
    id: group.id,
    seasonId: season.id,
    groupIndex: group.groupIndex,
    label: group.label,
    qualifyCount: group.qualifyCount,
    slots: [...group.slots]
      .sort((left, right) => left.position - right.position)
      .map(slot => ({
        id: slot.id,
        groupId: slot.groupId,
        position: slot.position,
        clubId: slot.clubId,
        club: slot.club
          ? {
              id: slot.club.id,
              name: slot.club.name,
              shortName: slot.club.shortName,
              logoUrl: slot.club.logoUrl,
            }
          : null,
      })),
  }))

  const groupMembership = new Map<number, { groupIndex: number; label: string }>()
  for (const group of seasonGroups) {
    for (const slot of group.slots) {
      if (slot.clubId) {
        groupMembership.set(slot.clubId, { groupIndex: group.groupIndex, label: group.label })
      }
    }
  }

  const seasonPayload = {
    id: season.id,
    competitionId: season.competitionId,
    name: season.name,
    startDate: season.startDate,
    endDate: season.endDate,
    competition: season.competition,
    groups: seasonGroups,
  }

  const rows = season.participants.map(participant => {
    const computed = computedStats.get(participant.clubId)
    const stat = statsByClub.get(participant.clubId)
    const membership = groupMembership.get(participant.clubId)
    return {
      seasonId: season.id,
      clubId: participant.clubId,
      points: computed?.points ?? stat?.points ?? 0,
      wins: computed?.wins ?? stat?.wins ?? 0,
      losses: computed?.losses ?? stat?.losses ?? 0,
      goalsFor: computed?.goalsFor ?? stat?.goalsFor ?? 0,
      goalsAgainst: computed?.goalsAgainst ?? stat?.goalsAgainst ?? 0,
      club: participant.club,
      season: seasonPayload,
      groupIndex: membership?.groupIndex ?? null,
      groupLabel: membership?.label ?? null,
    }
  })

  for (const stat of rawStats) {
    if (rows.some(row => row.clubId === stat.clubId)) continue
    const computed = computedStats.get(stat.clubId)
    const membership = groupMembership.get(stat.clubId)
    rows.push({
      seasonId: season.id,
      clubId: stat.clubId,
      points: computed?.points ?? stat.points,
      wins: computed?.wins ?? stat.wins,
      losses: computed?.losses ?? stat.losses,
      goalsFor: computed?.goalsFor ?? stat.goalsFor,
      goalsAgainst: computed?.goalsAgainst ?? stat.goalsAgainst,
      club: stat.club,
      season: seasonPayload,
      groupIndex: membership?.groupIndex ?? null,
      groupLabel: membership?.label ?? null,
    })
  }

  type HeadToHeadEntry = { points: number; goalsFor: number; goalsAgainst: number }
  const headToHead = new Map<number, Map<number, HeadToHeadEntry>>()
  const ensureHeadToHead = (clubId: number, opponentId: number): HeadToHeadEntry => {
    let opponents = headToHead.get(clubId)
    if (!opponents) {
      opponents = new Map<number, HeadToHeadEntry>()
      headToHead.set(clubId, opponents)
    }
    let record = opponents.get(opponentId)
    if (!record) {
      record = { points: 0, goalsFor: 0, goalsAgainst: 0 }
      opponents.set(opponentId, record)
    }
    return record
  }

  for (const match of finishedMatches) {
    const home = ensureHeadToHead(match.homeTeamId, match.awayTeamId)
    const away = ensureHeadToHead(match.awayTeamId, match.homeTeamId)

    home.goalsFor += match.homeScore
    home.goalsAgainst += match.awayScore
    away.goalsFor += match.awayScore
    away.goalsAgainst += match.homeScore

    if (match.homeScore > match.awayScore) {
      home.points += 3
    } else if (match.homeScore < match.awayScore) {
      away.points += 3
    } else {
      home.points += 1
      away.points += 1
    }
  }

  const getHeadToHead = (clubId: number, opponentId: number): HeadToHeadEntry => {
    return headToHead.get(clubId)?.get(opponentId) ?? { points: 0, goalsFor: 0, goalsAgainst: 0 }
  }

  rows.sort((left, right) => {
    if (right.points !== left.points) return right.points - left.points

    const leftDiff = left.goalsFor - left.goalsAgainst
    const rightDiff = right.goalsFor - right.goalsAgainst
    if (rightDiff !== leftDiff) return rightDiff - leftDiff

    const leftVsRight = getHeadToHead(left.clubId, right.clubId)
    const rightVsLeft = getHeadToHead(right.clubId, left.clubId)

    if (rightVsLeft.points !== leftVsRight.points) return rightVsLeft.points - leftVsRight.points

    const leftHeadDiff = leftVsRight.goalsFor - leftVsRight.goalsAgainst
    const rightHeadDiff = rightVsLeft.goalsFor - rightVsLeft.goalsAgainst
    if (rightHeadDiff !== leftHeadDiff) return rightHeadDiff - leftHeadDiff

    if (rightVsLeft.goalsFor !== leftVsRight.goalsFor)
      return rightVsLeft.goalsFor - leftVsRight.goalsFor

    return right.goalsFor - left.goalsFor
  })

  return serializePrisma(rows)
}

async function getSeasonClubStats(seasonId: number) {
  return defaultCache.getWithMeta(
    seasonStatsCacheKey(seasonId, 'club-stats'),
    () => loadSeasonClubStats(seasonId),
    SEASON_STATS_CACHE_TTL_SECONDS
  )
}

async function loadClubCareerTotals(competitionId?: number) {
  const seasons = await prisma.season.findMany({
    where: competitionId ? { competitionId } : undefined,
    select: { id: true },
  })

  if (!seasons.length) {
    return []
  }

  const seasonIds = seasons.map(season => season.id)

  const participants = await prisma.seasonParticipant.findMany({
    where: { seasonId: { in: seasonIds } },
    select: { seasonId: true, clubId: true },
  })

  const clubIdSet = new Set<number>()
  for (const participant of participants) {
    clubIdSet.add(participant.clubId)
  }

  const matches = await prisma.match.findMany({
    where: {
      seasonId: { in: seasonIds },
      status: MatchStatus.FINISHED,
      isFriendly: false,
    },
    select: {
      seasonId: true,
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
    },
  })

  for (const match of matches) {
    clubIdSet.add(match.homeTeamId)
    clubIdSet.add(match.awayTeamId)
  }

  const yellowCardGroups = await prisma.matchEvent.groupBy({
    by: ['teamId'],
    where: {
      match: {
        seasonId: { in: seasonIds },
        status: MatchStatus.FINISHED,
        isFriendly: false,
      },
      eventType: MatchEventType.YELLOW_CARD,
    },
    _count: { _all: true },
  })

  const redCardGroups = await prisma.matchEvent.groupBy({
    by: ['teamId'],
    where: {
      match: {
        seasonId: { in: seasonIds },
        status: MatchStatus.FINISHED,
        isFriendly: false,
      },
      eventType: MatchEventType.RED_CARD,
    },
    _count: { _all: true },
  })

  for (const entry of yellowCardGroups) {
    if (entry.teamId != null) {
      clubIdSet.add(entry.teamId)
    }
  }

  for (const entry of redCardGroups) {
    if (entry.teamId != null) {
      clubIdSet.add(entry.teamId)
    }
  }

  const clubIds = Array.from(clubIdSet)
  if (!clubIds.length) {
    return []
  }

  const clubs = await prisma.club.findMany({
    where: { id: { in: clubIds } },
    select: { id: true, name: true, shortName: true, logoUrl: true },
  })

  type TotalsEntry = {
    clubId: number
    club?: (typeof clubs)[number]
    seasonIds: Set<number>
    goalsFor: number
    goalsAgainst: number
    yellowCards: number
    redCards: number
    cleanSheets: number
    matchesPlayed: number
  }

  const clubInfo = new Map(clubs.map(club => [club.id, club]))
  const totals = new Map<number, TotalsEntry>()

  const ensureClub = (clubId: number): TotalsEntry | undefined => {
    const club = clubInfo.get(clubId)
    if (!club) return undefined
    let entry = totals.get(clubId)
    if (!entry) {
      entry = {
        clubId,
        club,
        seasonIds: new Set<number>(),
        goalsFor: 0,
        goalsAgainst: 0,
        yellowCards: 0,
        redCards: 0,
        cleanSheets: 0,
        matchesPlayed: 0,
      }
      totals.set(clubId, entry)
    }
    return entry
  }

  for (const participant of participants) {
    const entry = ensureClub(participant.clubId)
    entry?.seasonIds.add(participant.seasonId)
  }

  for (const match of matches) {
    const home = ensureClub(match.homeTeamId)
    const away = ensureClub(match.awayTeamId)

    if (home) {
      home.matchesPlayed += 1
      home.goalsFor += match.homeScore
      home.goalsAgainst += match.awayScore
      if (match.awayScore === 0) {
        home.cleanSheets += 1
      }
    }

    if (away) {
      away.matchesPlayed += 1
      away.goalsFor += match.awayScore
      away.goalsAgainst += match.homeScore
      if (match.homeScore === 0) {
        away.cleanSheets += 1
      }
    }
  }

  for (const entry of yellowCardGroups) {
    if (entry.teamId == null) continue
    const totalsEntry = ensureClub(entry.teamId)
    if (totalsEntry) {
      totalsEntry.yellowCards += entry._count._all
    }
  }

  for (const entry of redCardGroups) {
    if (entry.teamId == null) continue
    const totalsEntry = ensureClub(entry.teamId)
    if (totalsEntry) {
      totalsEntry.redCards += entry._count._all
    }
  }

  const rows = Array.from(totals.values()).map(entry => ({
    clubId: entry.clubId,
    club: entry.club!,
    tournaments: entry.seasonIds.size,
    goalsFor: entry.goalsFor,
    goalsAgainst: entry.goalsAgainst,
    yellowCards: entry.yellowCards,
    redCards: entry.redCards,
    cleanSheets: entry.cleanSheets,
    matchesPlayed: entry.matchesPlayed,
  }))

  rows.sort((left, right) => {
    if (right.tournaments !== left.tournaments) return right.tournaments - left.tournaments
    const leftDiff = left.goalsFor - left.goalsAgainst
    const rightDiff = right.goalsFor - right.goalsAgainst
    if (rightDiff !== leftDiff) return rightDiff - leftDiff
    if (right.goalsFor !== left.goalsFor) return right.goalsFor - left.goalsFor
    return left.club.name.localeCompare(right.club.name, 'ru')
  })

  return serializePrisma(rows)
}

async function getClubCareerTotals(competitionId?: number) {
  const cacheKey = competitionId
    ? competitionStatsCacheKey(competitionId, 'club-career')
    : 'league:club-career'
  return defaultCache.getWithMeta(
    cacheKey,
    () => loadClubCareerTotals(competitionId),
    CAREER_STATS_CACHE_TTL_SECONDS
  )
}

async function loadSeasonPlayerStats(seasonId: number) {
  const stats = await prisma.playerSeasonStats.findMany({
    where: { seasonId },
    include: { person: true, club: true },
    orderBy: [{ goals: 'desc' }, { matchesPlayed: 'asc' }, { assists: 'desc' }],
  })
  return serializePrisma(stats)
}

async function getSeasonPlayerStats(seasonId: number) {
  return defaultCache.getWithMeta(
    seasonStatsCacheKey(seasonId, 'player-stats'),
    () => loadSeasonPlayerStats(seasonId),
    SEASON_STATS_CACHE_TTL_SECONDS
  )
}

async function loadPlayerCareerStats(params: { competitionId?: number; clubId?: number }) {
  const { competitionId, clubId } = params

  let clubFilter: number[] | undefined

  if (competitionId) {
    const seasons = await prisma.season.findMany({
      where: { competitionId },
      select: { id: true },
    })

    if (!seasons.length) {
      return []
    }

    const participants = await prisma.seasonParticipant.findMany({
      where: { seasonId: { in: seasons.map(entry => entry.id) } },
      select: { clubId: true },
    })

    clubFilter = Array.from(new Set(participants.map(entry => entry.clubId)))
    if (!clubFilter.length) {
      return []
    }
  }

  const stats = await prisma.playerClubCareerStats.findMany({
    where: {
      ...(clubId ? { clubId } : {}),
      ...(clubFilter && clubFilter.length ? { clubId: { in: clubFilter } } : {}),
    },
    include: { person: true, club: true },
    orderBy: [{ totalGoals: 'desc' }, { totalAssists: 'desc' }],
  })

  return serializePrisma(stats)
}

async function getPlayerCareerStats(params: { competitionId?: number; clubId?: number }) {
  const cacheKey = params.clubId
    ? `club:${params.clubId}:player-career`
    : params.competitionId
      ? competitionStatsCacheKey(params.competitionId, 'player-career')
      : 'league:player-career'

  return defaultCache.getWithMeta(
    cacheKey,
    () => loadPlayerCareerStats(params),
    CAREER_STATS_CACHE_TTL_SECONDS
  )
}


type RatingsAggregationContext = Awaited<ReturnType<typeof recalculateUserRatings>>

const ADMIN_RATING_USER_INVALIDATION_LIMIT = 500
const ADMIN_RATING_CACHE_PAGE_SIZES = Array.from(
  new Set([RATING_DEFAULT_PAGE_SIZE, 10, 20, 25, 50, 100])
)

const invalidateRatingsCaches = async (context?: RatingsAggregationContext) => {
  const baseInvalidations = [] as Array<Promise<unknown>>

  for (const size of ADMIN_RATING_CACHE_PAGE_SIZES) {
    baseInvalidations.push(
      defaultCache.invalidate(ratingPublicCacheKey(RatingScope.CURRENT, 1, size)).catch(() => undefined)
    )
    baseInvalidations.push(
      defaultCache.invalidate(ratingPublicCacheKey(RatingScope.YEARLY, 1, size)).catch(() => undefined)
    )
  }

  if (context) {
    const targetedUsers = context.entries.slice(0, ADMIN_RATING_USER_INVALIDATION_LIMIT)
    for (const entry of targetedUsers) {
      baseInvalidations.push(
        defaultCache.invalidate(`user:rating:${entry.userId}`).catch(() => undefined)
      )
    }
  }

  await Promise.all(baseInvalidations)
}

const buildRatingsAdminResponse = async (
  settings: RatingSettingsSnapshot,
  context?: RatingsAggregationContext
) => {
  const [aggregate, mythicPlayers] = await Promise.all([
    prisma.userRating.aggregate({
      _count: { userId: true },
      _max: { lastRecalculatedAt: true },
    }),
    prisma.userRating.count({ where: { currentLevel: RatingLevel.MYTHIC } }),
  ])

  const anchor = context?.capturedAt ?? aggregate._max.lastRecalculatedAt ?? new Date()
  const windows = await computeRatingWindows(anchor, settings)
  const ratedUsers = aggregate._count.userId ?? 0

  return {
    settings: composeRatingSettingsPayload(settings),
    windows: {
      anchor: anchor.toISOString(),
      currentWindowStart: windows.currentWindowStart.toISOString(),
      currentWindowEnd: windows.currentWindowEnd.toISOString(),
      yearlyWindowStart: windows.yearlyWindowStart.toISOString(),
      yearlyWindowEnd: windows.yearlyWindowEnd.toISOString(),
    },
    totals: {
      ratedUsers,
      mythicPlayers,
    },
    lastRecalculatedAt: anchor.toISOString(),
  }
}

const normalizeRatingScope = (raw?: string): RatingScope => {
  if (!raw) {
    return RatingScope.CURRENT
  }
  const normalized = raw.trim().toUpperCase()
  return normalized === RatingScope.YEARLY ? RatingScope.YEARLY : RatingScope.CURRENT
}

const parsePositiveInteger = (value: unknown, fallback: number): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  const normalized = Math.trunc(numeric)
  return normalized > 0 ? normalized : fallback
}

type SeasonSummaryRecord = Awaited<ReturnType<typeof fetchSeasonSummaries>>[number]

const toRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>
  }
  return {}
}

const coerceNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback
  }
  if (typeof value === 'bigint') {
    return Number(value)
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

const coerceNullableString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null

const coerceIsoString = (value: unknown): string | null => {
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === 'string') {
    const timestamp = Date.parse(value)
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp).toISOString()
    }
  }
  return null
}

const pickValue = (record: Record<string, unknown>, keys: string[]): unknown => {
  for (const key of keys) {
    if (key in record) {
      const candidate = record[key]
      if (candidate !== undefined && candidate !== null) {
        return candidate
      }
    }
  }
  return undefined
}

const serializeSeasonWinnerRecord = (winner: unknown) => {
  const record = toRecord(winner)
  return {
    userId: coerceNumber(pickValue(record, ['userId', 'user_id'])),
    rank: coerceNumber(pickValue(record, ['rank'])),
    scopePoints: coerceNumber(pickValue(record, ['scopePoints', 'scope_points'])),
    totalPoints: coerceNumber(pickValue(record, ['totalPoints', 'total_points'])),
    predictionCount: coerceNumber(pickValue(record, ['predictionCount', 'prediction_count'])),
    predictionWins: coerceNumber(pickValue(record, ['predictionWins', 'prediction_wins'])),
    displayName: coerceNullableString(pickValue(record, ['displayName', 'display_name'])),
    username: coerceNullableString(pickValue(record, ['username'])),
    photoUrl: coerceNullableString(pickValue(record, ['photoUrl', 'photo_url'])),
    createdAt: coerceIsoString(pickValue(record, ['createdAt', 'created_at'])),
  }
}

const serializeSeasonRecord = (season: unknown) => {
  const record = toRecord(season)
  const idValue = pickValue(record, ['id', 'rating_season_id'])
  const scopeRaw = pickValue(record, ['scope'])
  const scope =
    typeof scopeRaw === 'string' && (Object.values(RatingScope) as string[]).includes(scopeRaw)
      ? (scopeRaw as RatingScope)
      : RatingScope.CURRENT

  const startsAt = coerceIsoString(pickValue(record, ['startsAt', 'starts_at']))
  const endsAt = coerceIsoString(pickValue(record, ['endsAt', 'ends_at']))
  const closedAt = coerceIsoString(pickValue(record, ['closedAt', 'closed_at']))

  const winnersValue = pickValue(record, ['winners'])
  const winners = Array.isArray(winnersValue)
    ? winnersValue.map(serializeSeasonWinnerRecord)
    : []

  return {
    id: idValue != null ? String(idValue) : null,
    scope: ratingScopeKey(scope),
    startsAt,
    endsAt,
    closedAt,
    durationDays: coerceNumber(pickValue(record, ['durationDays', 'duration_days'])),
    isActive: closedAt === null,
    winners,
  }
}

export default async function (server: FastifyInstance) {
  server.post('/api/admin/login', async (request, reply) => {
    const { login, password } = (request.body || {}) as { login?: string; password?: string }

    if (!login || !password) {
      return reply.status(400).send({ ok: false, error: 'login_and_password_required' })
    }

    const expectedLogin = process.env.LOGIN_ADMIN
    const expectedPassword = process.env.PASSWORD_ADMIN

    if (!expectedLogin || !expectedPassword) {
      server.log.error('LOGIN_ADMIN or PASSWORD_ADMIN env variables are not configured')
      return reply.status(503).send({ ok: false, error: 'admin_auth_unavailable' })
    }

    const loginMatches = secureEquals(login, expectedLogin)
    const passwordMatches = secureEquals(password, expectedPassword)

    if (!loginMatches || !passwordMatches) {
      server.log.warn({ login }, 'admin login failed')
      return reply.status(401).send({ ok: false, error: 'invalid_credentials' })
    }

    const token = jwt.sign({ sub: 'admin', role: 'admin' }, getJwtSecret(), {
      expiresIn: '2h',
      issuer: 'obnliga-backend',
      audience: 'admin-dashboard',
    })

    return reply.send({ ok: true, token, expiresIn: 7200 })
  })

  server.post('/api/admin/test-login', async (request, reply) => {
    const headerSecret = (request.headers['x-admin-secret'] || '') as string
    const adminSecret = process.env.ADMIN_SECRET
    if (!adminSecret || headerSecret !== adminSecret) {
      return reply.status(403).send({ error: 'forbidden' })
    }

    const body = request.body as AdminTestLoginBody | undefined
    const userIdValue = body?.userId

    const userIdNumber =
      typeof userIdValue === 'string'
        ? Number(userIdValue)
        : typeof userIdValue === 'number'
          ? userIdValue
          : undefined

    if (userIdNumber === undefined || !Number.isFinite(userIdNumber) || userIdNumber <= 0) {
      return reply.status(400).send({ error: 'userId required' })
    }

    const userIdInt = Math.trunc(userIdNumber)
    const normalizedUsername =
      typeof body?.username === 'string' && body.username.trim().length > 0
        ? body.username
        : null
    const normalizedFirstName =
      typeof body?.firstName === 'string' && body.firstName.trim().length > 0
        ? body.firstName
        : null

    try {
      const user = await prisma.appUser.upsert({
        where: { id: userIdInt },
        create: {
          id: userIdInt,
          telegramId: BigInt(userIdInt),
          username: normalizedUsername,
          firstName: normalizedFirstName,
        },
        update: {
          username: normalizedUsername,
          firstName: normalizedFirstName,
        },
      })

      const token = jwt.sign({ sub: String(user.id), role: 'admin-tester' }, getJwtSecret(), {
        expiresIn: '7d',
      })
      return reply.send({ ok: true, user, token })
    } catch (err) {
      server.log.error({ err }, 'admin test-login failed')
      return reply.status(500).send({ error: 'internal' })
    }
  })

  server.register(
    async (admin: FastifyInstance) => {
      admin.addHook('onRequest', adminAuthHook)

      // Admin profile info
      admin.get('/me', async (request, reply) => {
        return reply.send({ ok: true, admin: request.admin })
      })

      // Ratings management
      admin.get('/ratings/settings', async (_request, reply) => {
        const settings = await getRatingSettings()
        const payload = await buildRatingsAdminResponse(settings)
        return reply.send({ ok: true, data: payload })
      })

      admin.put('/ratings/settings', async (request, reply) => {
        const body = (request.body ?? {}) as {
          currentScopeDays?: unknown
          yearlyScopeDays?: unknown
          recalculate?: unknown
        }

        const currentScopeDays = Number(body.currentScopeDays)
        const yearlyScopeDays = Number(body.yearlyScopeDays)
        if (!Number.isFinite(currentScopeDays) || !Number.isFinite(yearlyScopeDays)) {
          return reply.status(400).send({ ok: false, error: 'rating_settings_invalid' })
        }

        const saved = await saveRatingSettings({
          currentScopeDays: Math.trunc(currentScopeDays),
          yearlyScopeDays: Math.trunc(yearlyScopeDays),
        })

        let context: RatingsAggregationContext | undefined
        const shouldRecalculate = Boolean(body.recalculate)
        if (shouldRecalculate) {
          try {
            context = await recalculateUserRatings()
          } catch (err) {
            request.server.log.error({ err }, 'admin ratings: recalculation failed after settings update')
            return reply.status(500).send({ ok: false, error: 'rating_recalculate_failed' })
          }
        }

        await invalidateRatingsCaches(context)

        const payload = await buildRatingsAdminResponse(saved, context)
        return reply.send({
          ok: true,
          data: payload,
          meta: {
            recalculated: shouldRecalculate,
            affectedUsers: context?.entries.length,
          },
        })
      })

      admin.post('/ratings/recalculate', async (request, reply) => {
        const body = (request.body ?? {}) as { userIds?: unknown }
        let userIds: number[] | undefined
        if (Array.isArray(body.userIds)) {
          userIds = body.userIds
            .map(value => Number(value))
            .filter(value => Number.isFinite(value) && value > 0)
            .map(value => Math.trunc(value))
          if (userIds.length === 0) {
            userIds = undefined
          }
        }

        let context: RatingsAggregationContext
        try {
          context = await recalculateUserRatings({ userIds })
        } catch (err) {
          request.server.log.error({ err, userIds }, 'admin ratings: manual recalculation failed')
          return reply.status(500).send({ ok: false, error: 'rating_recalculate_failed' })
        }

        // Синхронизируем прогресс достижения SEASON_POINTS после пересчёта
        if (!userIds) {
          try {
            const syncedCount = await syncAllSeasonPointsProgress()
            request.server.log.info(
              { syncedCount },
              'admin ratings: synced SEASON_POINTS achievements after recalculation'
            )
          } catch (err) {
            request.server.log.error(
              { err },
              'admin ratings: failed to sync SEASON_POINTS achievements'
            )
            // Не прерываем операцию — рейтинги уже пересчитаны
          }
        }

        await invalidateRatingsCaches(context)

        const settings = await getRatingSettings()
        const payload = await buildRatingsAdminResponse(settings, context)
        return reply.send({
          ok: true,
          data: payload,
          meta: {
            partial: Boolean(userIds),
            affectedUsers: context.entries.length,
          },
        })
      })

      admin.get('/ratings/leaderboard', async (request, reply) => {
        const query = request.query as { scope?: string; page?: string; pageSize?: string } | undefined
        const scope = normalizeRatingScope(query?.scope)
        const rawPage = query?.page
        const rawPageSize = query?.pageSize
        const page = parsePositiveInteger(rawPage, 1)
        const requestedPageSize = rawPageSize
          ? parsePositiveInteger(rawPageSize, RATING_DEFAULT_PAGE_SIZE)
          : RATING_DEFAULT_PAGE_SIZE
        const pageSize = Math.min(RATING_MAX_PAGE_SIZE, requestedPageSize)

        const leaderboard = await loadRatingLeaderboard(scope, {
          page,
          pageSize,
          ensureFresh: page === 1,
        })
        const settings = await getRatingSettings()
  const windows = await computeRatingWindows(leaderboard.capturedAt, settings)

        return reply.send({
          ok: true,
          data: {
            scope: ratingScopeKey(leaderboard.scope),
            total: leaderboard.total,
            page: leaderboard.page,
            pageSize: leaderboard.pageSize,
            capturedAt: leaderboard.capturedAt.toISOString(),
            currentWindowStart: windows.currentWindowStart.toISOString(),
            currentWindowEnd: windows.currentWindowEnd.toISOString(),
            yearlyWindowStart: windows.yearlyWindowStart.toISOString(),
            yearlyWindowEnd: windows.yearlyWindowEnd.toISOString(),
            entries: leaderboard.entries.map(entry => ({
              userId: entry.userId,
              position: entry.position,
              displayName: entry.displayName,
              username: entry.username,
              photoUrl: entry.photoUrl,
              totalPoints: entry.totalPoints,
              seasonalPoints: entry.seasonalPoints,
              yearlyPoints: entry.yearlyPoints,
              currentLevel: entry.currentLevel,
              mythicRank: entry.mythicRank,
              currentStreak: entry.currentStreak,
              maxStreak: entry.maxStreak,
              lastPredictionAt: entry.lastPredictionAt,
              lastResolvedAt: entry.lastResolvedAt,
              predictionCount: entry.predictionCount,
              predictionWins: entry.predictionWins,
              predictionAccuracy: entry.predictionAccuracy,
            })),
          },
        })
      })

      admin.get('/ratings/seasons', async (request, reply) => {
        let seasons: SeasonSummaryRecord[] = []
        try {
          seasons = await fetchSeasonSummaries(undefined, { limit: 24 })
        } catch (err) {
          request.server.log.error({ err }, 'admin ratings: failed to load seasons')
        }

        const grouped: Record<RatingScope, { active: ReturnType<typeof serializeSeasonRecord> | null; history: ReturnType<typeof serializeSeasonRecord>[] }> = {
          [RatingScope.CURRENT]: { active: null, history: [] },
          [RatingScope.YEARLY]: { active: null, history: [] },
        }

        for (const season of seasons) {
          const serialized = serializeSeasonRecord(season)
          const scopeKey = season.scope ?? RatingScope.CURRENT
          const bucket = grouped[scopeKey]
          if (!bucket) {
            continue
          }
          if (season.closedAt == null && !bucket.active) {
            bucket.active = serialized
          } else {
            bucket.history.push(serialized)
          }
        }

        return reply.send({ ok: true, data: grouped })
      })

      admin.post('/ratings/seasons/:scope/start', async (request, reply) => {
        const params = request.params as { scope?: string }
        const scope = normalizeRatingScope(params?.scope)
        const body = (request.body ?? {}) as { startsAt?: string | number | Date; durationDays?: unknown }

        const durationValue = Number(body.durationDays)
        if (!Number.isFinite(durationValue) || durationValue <= 0) {
          return reply.status(400).send({ ok: false, error: 'season_duration_invalid' })
        }

        let startsAt: Date
        if (body.startsAt) {
          const candidate = new Date(body.startsAt)
          if (Number.isNaN(candidate.getTime())) {
            return reply.status(400).send({ ok: false, error: 'season_start_invalid' })
          }
          startsAt = candidate
        } else {
          startsAt = new Date()
        }

        const existing = await getActiveSeason(scope)
        if (existing) {
          return reply.status(409).send({ ok: false, error: 'season_already_active' })
        }

        const season = await startSeason(scope, Math.trunc(durationValue), startsAt)
        const payload = serializeSeasonRecord({ ...season, winners: [] })
        return reply.send({ ok: true, data: payload })
      })

      admin.post('/ratings/seasons/:scope/close', async (request, reply) => {
        const params = request.params as { scope?: string }
        const scope = normalizeRatingScope(params?.scope)
        const body = (request.body ?? {}) as { endedAt?: string | number | Date }

        let endedAt: Date
        if (body.endedAt) {
          const candidate = new Date(body.endedAt)
          if (Number.isNaN(candidate.getTime())) {
            return reply.status(400).send({ ok: false, error: 'season_end_invalid' })
          }
          endedAt = candidate
        } else {
          endedAt = new Date()
        }

        const activeSeason = await getActiveSeason(scope)
        if (!activeSeason) {
          return reply.status(404).send({ ok: false, error: 'season_not_found' })
        }

        if (endedAt.getTime() < new Date(activeSeason.startsAt).getTime()) {
          endedAt = new Date(activeSeason.startsAt)
        }

        let leaderboard
        try {
          leaderboard = await loadRatingLeaderboard(scope, { page: 1, pageSize: 3, ensureFresh: true })
        } catch (err) {
          request.server.log.error({ err }, 'admin ratings: failed to load leaderboard for season close')
          return reply.status(500).send({ ok: false, error: 'leaderboard_unavailable' })
        }

        const winners: SeasonWinnerInput[] = []
        const limit = Math.min(3, leaderboard.entries.length)
        for (let index = 0; index < limit; index += 1) {
          const entry = leaderboard.entries[index]
          winners.push({
            userId: entry.userId,
            rank: index + 1,
            scopePoints:
              scope === RatingScope.YEARLY ? entry.yearlyPoints : entry.seasonalPoints,
            totalPoints: entry.totalPoints,
            predictionCount: entry.predictionCount,
            predictionWins: entry.predictionWins,
            displayName: entry.displayName,
            username: entry.username,
            photoUrl: entry.photoUrl,
          })
        }

        const closedSeason = await closeActiveSeason(scope, endedAt, winners)
        if (!closedSeason) {
          return reply.status(404).send({ ok: false, error: 'season_not_found' })
        }

        // При закрытии CURRENT сезона сбрасываем прогресс достижения SEASON_POINTS
        // (достижение за накопление сезонных очков сбрасывается каждый сезон)
        if (scope === RatingScope.CURRENT) {
          try {
            const resetCount = await resetSeasonPointsAchievements()
            request.server.log.info(
              { resetCount },
              'admin ratings: reset SEASON_POINTS achievements on season close'
            )
          } catch (err) {
            request.server.log.error(
              { err },
              'admin ratings: failed to reset SEASON_POINTS achievements'
            )
            // Не прерываем операцию — сезон уже закрыт
          }
        }

        const payload = serializeSeasonRecord(closedSeason)
        return reply.send({ ok: true, data: payload })
      })

      // News management
      admin.post<{ Body: NewsCreateBody }>('/news', async (request, reply) => {
        const body = request.body ?? {}

        const title = body.title?.trim() ?? ''
        const content = body.content?.trim() ?? ''
        const coverUrlRaw = body.coverUrl ?? null
        const normalizedCoverUrl = coverUrlRaw ? String(coverUrlRaw).trim() : ''
        const coverUrl = normalizedCoverUrl.length > 0 ? normalizedCoverUrl : null
        const sendToTelegram = Boolean(body.sendToTelegram)

        if (!title) {
          return reply.status(400).send({ ok: false, error: 'news_title_required' })
        }
        if (title.length > 100) {
          return reply.status(400).send({ ok: false, error: 'news_title_too_long' })
        }
        if (!content) {
          return reply.status(400).send({ ok: false, error: 'news_content_required' })
        }

        const news = await prisma.news.create({
          data: {
            title,
            content,
            coverUrl,
            sendToTelegram,
          },
        })

        await defaultCache.invalidate(NEWS_CACHE_KEY)

        if (sendToTelegram) {
          try {
            const enqueueResult = await enqueueTelegramNewsJob({
              newsId: news.id.toString(),
              title: news.title,
              content: news.content,
              coverUrl: news.coverUrl ?? undefined,
            })

            if (!enqueueResult?.queued) {
              const directResult = await deliverTelegramNewsNow(
                {
                  newsId: news.id.toString(),
                  title: news.title,
                  content: news.content,
                  coverUrl: news.coverUrl ?? undefined,
                },
                admin.log
              )

              if (!directResult.delivered) {
                const details = {
                  newsId: news.id.toString(),
                  reason: directResult.reason,
                  sentCount: directResult.sentCount,
                  failedCount: directResult.failedCount,
                }
                const message =
                  directResult.reason === 'no_recipients'
                    ? 'telegram delivery skipped — no recipients'
                    : 'telegram delivery skipped — direct fallback unavailable'
                admin.log.warn(details, message)
              } else {
                admin.log.info(
                  {
                    newsId: news.id.toString(),
                    sentCount: directResult.sentCount,
                    failedCount: directResult.failedCount,
                  },
                  'telegram direct delivery completed'
                )
              }
            }
          } catch (err) {
            admin.log.error({ err, newsId: news.id.toString() }, 'failed to deliver telegram news')
          }
        }

        try {
          const payload = serializePrisma(news)
          if (typeof admin.publishTopic === 'function') {
            await admin.publishTopic('home', {
              type: 'news.full',
              payload,
            })
          }
        } catch (err) {
          admin.log.warn({ err }, 'failed to publish news websocket update')
        }

        reply.status(201)
        return sendSerialized(reply, news)
      })

      admin.patch<{ Params: NewsParams; Body: NewsUpdateBody }>(
        '/news/:newsId',
        async (request, reply) => {
          let newsId: bigint
          try {
            newsId = parseBigIntId(request.params.newsId, 'newsId')
          } catch (err) {
            return reply.status(400).send({ ok: false, error: 'news_id_invalid' })
          }

          const body = request.body ?? {}

          const existing = await prisma.news.findUnique({ where: { id: newsId } })
          if (!existing) {
            return reply.status(404).send({ ok: false, error: 'news_not_found' })
          }

          const updates: Record<string, unknown> = {}

          if (Object.prototype.hasOwnProperty.call(body, 'title')) {
            const raw = body.title?.trim() ?? ''
            if (!raw) {
              return reply.status(400).send({ ok: false, error: 'news_title_required' })
            }
            if (raw.length > 100) {
              return reply.status(400).send({ ok: false, error: 'news_title_too_long' })
            }
            if (raw !== existing.title) {
              updates.title = raw
            }
          }

          if (Object.prototype.hasOwnProperty.call(body, 'content')) {
            const raw = body.content?.trim() ?? ''
            if (!raw) {
              return reply.status(400).send({ ok: false, error: 'news_content_required' })
            }
            if (raw !== existing.content) {
              updates.content = raw
            }
          }

          if (Object.prototype.hasOwnProperty.call(body, 'coverUrl')) {
            const rawValue = body.coverUrl ?? null
            const normalized = rawValue === null ? null : String(rawValue).trim()
            const coverUrl = normalized && normalized.length > 0 ? normalized : null
            if (coverUrl !== (existing.coverUrl ?? null)) {
              updates.coverUrl = coverUrl
            }
          }

          if (Object.prototype.hasOwnProperty.call(body, 'sendToTelegram')) {
            const next = Boolean(body.sendToTelegram)
            if (next !== existing.sendToTelegram) {
              updates.sendToTelegram = next
            }
          }

          if (Object.keys(updates).length === 0) {
            return reply.status(400).send({ ok: false, error: 'news_update_payload_empty' })
          }

          const news = await prisma.news.update({
            where: { id: newsId },
            data: updates,
          })

          await defaultCache.invalidate(NEWS_CACHE_KEY)

          try {
            const payload = serializePrisma(news)
            if (typeof admin.publishTopic === 'function') {
              await admin.publishTopic('home', {
                type: 'news.full',
                payload,
              })
            }
          } catch (err) {
            admin.log.warn({ err }, 'failed to publish news update websocket event')
          }

          return sendSerialized(reply, news)
        }
      )

      admin.delete<{ Params: NewsParams }>('/news/:newsId', async (request, reply) => {
        let newsId: bigint
        try {
          newsId = parseBigIntId(request.params.newsId, 'newsId')
        } catch (err) {
          return reply.status(400).send({ ok: false, error: 'news_id_invalid' })
        }

        const existing = await prisma.news.findUnique({ where: { id: newsId } })
        if (!existing) {
          return reply.status(404).send({ ok: false, error: 'news_not_found' })
        }

        const deleted = await prisma.news.delete({ where: { id: newsId } })

        await defaultCache.invalidate(NEWS_CACHE_KEY)

        try {
          if (typeof admin.publishTopic === 'function') {
            await admin.publishTopic('home', {
              type: 'news.remove',
              payload: { id: deleted.id.toString() },
            })
          }
        } catch (err) {
          admin.log.warn({ err }, 'failed to publish news remove websocket event')
        }

        return sendSerialized(reply, deleted)
      })

      // Advertisement management
      admin.get('/news/ads', async (_request, reply) => {
        const ads = await listAllAdBanners()
        return reply.send({ ok: true, data: ads })
      })

      admin.post('/news/ads', async (request, reply) => {
        const body = (request.body ?? {}) as Record<string, unknown>

        const titleRaw = typeof body.title === 'string' ? body.title.trim() : ''
        if (!titleRaw) {
          return reply.status(400).send({ ok: false, error: 'ad_title_required' })
        }
        if (titleRaw.length > MAX_AD_TITLE_LENGTH) {
          return reply.status(400).send({ ok: false, error: 'ad_title_too_long' })
        }

        const subtitleRaw =
          typeof body.subtitle === 'string' ? body.subtitle.trim() : body.subtitle === null ? null : undefined
        if (typeof subtitleRaw === 'string' && subtitleRaw.length > MAX_AD_SUBTITLE_LENGTH) {
          return reply.status(400).send({ ok: false, error: 'ad_subtitle_too_long' })
        }

        const targetUrlRaw = body.targetUrl
        let targetUrl: string | null
        try {
          targetUrl = normalizeAdTargetUrl(targetUrlRaw)
        } catch (err) {
          const code = err instanceof Error ? err.message : 'ad_target_url_invalid'
          return reply.status(400).send({ ok: false, error: code })
        }

        const displayOrderValue =
          Object.prototype.hasOwnProperty.call(body, 'displayOrder') && body.displayOrder !== undefined
            ? Number(body.displayOrder)
            : 0
        if (!Number.isFinite(displayOrderValue)) {
          return reply.status(400).send({ ok: false, error: 'ad_display_order_invalid' })
        }
        const displayOrder = Math.trunc(displayOrderValue)
        if (displayOrder < 0 || displayOrder > MAX_AD_DISPLAY_ORDER) {
          return reply.status(400).send({ ok: false, error: 'ad_display_order_invalid' })
        }

        const isActive = Object.prototype.hasOwnProperty.call(body, 'isActive')
          ? Boolean(body.isActive)
          : true

        let startsAt: Date | null = null
        let endsAt: Date | null = null
        try {
          startsAt = parseOptionalDateTime(body.startsAt, 'ad_starts_at')
          endsAt = parseOptionalDateTime(body.endsAt, 'ad_ends_at')
        } catch (err) {
          const code = err instanceof Error ? err.message : 'ad_schedule_invalid'
          return reply.status(400).send({ ok: false, error: code })
        }

        if (startsAt && endsAt && endsAt.getTime() < startsAt.getTime()) {
          return reply.status(400).send({ ok: false, error: 'ad_schedule_range_invalid' })
        }

        let image: ParsedAdImage
        try {
          const parsed = decodeAdImagePayload(body.image, true)
          if (!parsed) {
            return reply.status(400).send({ ok: false, error: 'ad_image_required' })
          }
          image = parsed
        } catch (err) {
          const code = err instanceof Error ? err.message : 'ad_image_invalid'
          return reply.status(400).send({ ok: false, error: code })
        }

        try {
          const [created] = await prisma.$queryRaw<AdBannerRow[]>`
            INSERT INTO ad_banner (
              title,
              subtitle,
              target_url,
              image_data,
              image_mime,
              image_width,
              image_height,
              image_size,
              display_order,
              is_active,
              starts_at,
              ends_at,
              updated_at
            ) VALUES (
              ${titleRaw},
              ${subtitleRaw ?? null},
              ${targetUrl},
              ${image.buffer},
              ${image.mimeType},
              ${image.width},
              ${image.height},
              ${image.size},
              ${displayOrder},
              ${isActive},
              ${startsAt},
              ${endsAt},
              ${new Date()}
            )
            RETURNING
              ad_banner_id          AS id,
              title,
              subtitle,
              target_url            AS "targetUrl",
              image_data            AS "imageData",
              image_mime            AS "imageMime",
              image_width           AS "imageWidth",
              image_height          AS "imageHeight",
              image_size            AS "imageSize",
              display_order         AS "displayOrder",
              is_active             AS "isActive",
              starts_at             AS "startsAt",
              ends_at               AS "endsAt",
              created_at            AS "createdAt",
              updated_at            AS "updatedAt"
          `

          const normalized = normalizeAdBannerRow(created)

          await defaultCache.invalidate(ADS_CACHE_KEY)

          try {
            if (typeof admin.publishTopic === 'function') {
              await admin.publishTopic('home', {
                type: 'ads.full',
                payload: normalized,
              })
            }
          } catch (err) {
            admin.log.warn({ err }, 'failed to publish ad create websocket event')
          }

          reply.status(201)
          return reply.send({ ok: true, data: normalized })
        } catch (err) {
          request.server.log.error({ err }, 'ad banner create failed')
          return reply.status(500).send({ ok: false, error: 'request_failed' })
        }
      })

      admin.patch('/news/ads/:adId', async (request, reply) => {
        let adId: bigint
        try {
          adId = parseBigIntId((request.params as { adId?: string }).adId, 'adId')
        } catch (err) {
          return reply.status(400).send({ ok: false, error: 'ad_id_invalid' })
        }

        const existing = await loadAdBannerById(adId)
        if (!existing) {
          return reply.status(404).send({ ok: false, error: 'ad_not_found' })
        }

        const body = (request.body ?? {}) as Record<string, unknown>
        let hasChanges = false

        const titleProvided = Object.prototype.hasOwnProperty.call(body, 'title')
        let nextTitle = existing.title
        if (titleProvided) {
          const titleRaw = typeof body.title === 'string' ? body.title.trim() : ''
          if (!titleRaw) {
            return reply.status(400).send({ ok: false, error: 'ad_title_required' })
          }
          if (titleRaw.length > MAX_AD_TITLE_LENGTH) {
            return reply.status(400).send({ ok: false, error: 'ad_title_too_long' })
          }
          if (titleRaw !== existing.title) {
            nextTitle = titleRaw
            hasChanges = true
          }
        }

        const subtitleProvided = Object.prototype.hasOwnProperty.call(body, 'subtitle')
        let nextSubtitle: string | null = existing.subtitle
        if (subtitleProvided) {
          const subtitleRaw =
            typeof body.subtitle === 'string'
              ? body.subtitle.trim()
              : body.subtitle === null
                ? null
                : undefined
          if (typeof subtitleRaw === 'string' && subtitleRaw.length > MAX_AD_SUBTITLE_LENGTH) {
            return reply.status(400).send({ ok: false, error: 'ad_subtitle_too_long' })
          }
          const normalizedSubtitle = subtitleRaw ?? null
          if (normalizedSubtitle !== (existing.subtitle ?? null)) {
            nextSubtitle = normalizedSubtitle
            hasChanges = true
          }
        }

        const targetUrlProvided = Object.prototype.hasOwnProperty.call(body, 'targetUrl')
        let nextTargetUrl: string | null = existing.targetUrl ?? null
        if (targetUrlProvided) {
          let targetUrl: string | null
          try {
            targetUrl = normalizeAdTargetUrl(body.targetUrl)
          } catch (err) {
            const code = err instanceof Error ? err.message : 'ad_target_url_invalid'
            return reply.status(400).send({ ok: false, error: code })
          }
          if (targetUrl !== (existing.targetUrl ?? null)) {
            nextTargetUrl = targetUrl
            hasChanges = true
          }
        }

        const displayOrderProvided = Object.prototype.hasOwnProperty.call(body, 'displayOrder')
        let nextDisplayOrder = existing.displayOrder
        if (displayOrderProvided) {
          const displayOrderValue = Number(body.displayOrder)
          if (!Number.isFinite(displayOrderValue)) {
            return reply.status(400).send({ ok: false, error: 'ad_display_order_invalid' })
          }
          const displayOrder = Math.trunc(displayOrderValue)
          if (displayOrder < 0 || displayOrder > MAX_AD_DISPLAY_ORDER) {
            return reply.status(400).send({ ok: false, error: 'ad_display_order_invalid' })
          }
          if (displayOrder !== existing.displayOrder) {
            nextDisplayOrder = displayOrder
            hasChanges = true
          }
        }

        const isActiveProvided = Object.prototype.hasOwnProperty.call(body, 'isActive')
        let nextIsActive = existing.isActive
        if (isActiveProvided) {
          const isActive = Boolean(body.isActive)
          if (isActive !== existing.isActive) {
            nextIsActive = isActive
            hasChanges = true
          }
        }

        const scheduleProvided =
          Object.prototype.hasOwnProperty.call(body, 'startsAt') ||
          Object.prototype.hasOwnProperty.call(body, 'endsAt')
        let nextStartsAt: Date | null = existing.startsAt
        let nextEndsAt: Date | null = existing.endsAt
        if (scheduleProvided) {
          try {
            if (Object.prototype.hasOwnProperty.call(body, 'startsAt')) {
              nextStartsAt = parseOptionalDateTime(body.startsAt, 'ad_starts_at')
            }
            if (Object.prototype.hasOwnProperty.call(body, 'endsAt')) {
              nextEndsAt = parseOptionalDateTime(body.endsAt, 'ad_ends_at')
            }
          } catch (err) {
            const code = err instanceof Error ? err.message : 'ad_schedule_invalid'
            return reply.status(400).send({ ok: false, error: code })
          }
          if (nextStartsAt && nextEndsAt && nextEndsAt.getTime() < nextStartsAt.getTime()) {
            return reply.status(400).send({ ok: false, error: 'ad_schedule_range_invalid' })
          }
          if (
            (nextStartsAt ? nextStartsAt.getTime() : null) !==
            (existing.startsAt ? existing.startsAt.getTime() : null)
          ) {
            hasChanges = true
          }
          if (
            (nextEndsAt ? nextEndsAt.getTime() : null) !==
            (existing.endsAt ? existing.endsAt.getTime() : null)
          ) {
            hasChanges = true
          }
        }

        const existingImage = {
          buffer: existing.imageData,
          mimeType: existing.imageMime,
          width: existing.imageWidth,
          height: existing.imageHeight,
          size: existing.imageSize,
        }
        let nextImage = existingImage
        if (Object.prototype.hasOwnProperty.call(body, 'image')) {
          let image: ParsedAdImage
          try {
            const parsed = decodeAdImagePayload(body.image, true)
            if (!parsed) {
              return reply.status(400).send({ ok: false, error: 'ad_image_required' })
            }
            image = parsed
          } catch (err) {
            const code = err instanceof Error ? err.message : 'ad_image_invalid'
            return reply.status(400).send({ ok: false, error: code })
          }
          nextImage = image
          hasChanges = true
        }

        if (!hasChanges) {
          return reply.status(400).send({ ok: false, error: 'ad_update_payload_empty' })
        }

        try {
          const [updated] = await prisma.$queryRaw<AdBannerRow[]>`
            UPDATE ad_banner
            SET
              title = ${nextTitle},
              subtitle = ${nextSubtitle},
              target_url = ${nextTargetUrl},
              image_data = ${nextImage.buffer},
              image_mime = ${nextImage.mimeType},
              image_width = ${nextImage.width},
              image_height = ${nextImage.height},
              image_size = ${nextImage.size},
              display_order = ${nextDisplayOrder},
              is_active = ${nextIsActive},
              starts_at = ${nextStartsAt},
              ends_at = ${nextEndsAt},
              updated_at = NOW()
            WHERE ad_banner_id = ${adId}
            RETURNING
              ad_banner_id          AS id,
              title,
              subtitle,
              target_url            AS "targetUrl",
              image_data            AS "imageData",
              image_mime            AS "imageMime",
              image_width           AS "imageWidth",
              image_height          AS "imageHeight",
              image_size            AS "imageSize",
              display_order         AS "displayOrder",
              is_active             AS "isActive",
              starts_at             AS "startsAt",
              ends_at               AS "endsAt",
              created_at            AS "createdAt",
              updated_at            AS "updatedAt"
          `

          const normalized = normalizeAdBannerRow(updated)

          await defaultCache.invalidate(ADS_CACHE_KEY)

          try {
            if (typeof admin.publishTopic === 'function') {
              await admin.publishTopic('home', {
                type: 'ads.full',
                payload: normalized,
              })
            }
          } catch (err) {
            admin.log.warn({ err }, 'failed to publish ad update websocket event')
          }

          return reply.send({ ok: true, data: normalized })
        } catch (err) {
          request.server.log.error({ err, adId: adId.toString() }, 'ad banner update failed')
          return reply.status(500).send({ ok: false, error: 'request_failed' })
        }
      })

      admin.delete('/news/ads/:adId', async (request, reply) => {
        let adId: bigint
        try {
          adId = parseBigIntId((request.params as { adId?: string }).adId, 'adId')
        } catch (err) {
          return reply.status(400).send({ ok: false, error: 'ad_id_invalid' })
        }

        try {
          const rows = await prisma.$queryRaw<AdBannerRow[]>`
            DELETE FROM ad_banner
            WHERE ad_banner_id = ${adId}
            RETURNING
              ad_banner_id          AS id,
              title,
              subtitle,
              target_url            AS "targetUrl",
              image_data            AS "imageData",
              image_mime            AS "imageMime",
              image_width           AS "imageWidth",
              image_height          AS "imageHeight",
              image_size            AS "imageSize",
              display_order         AS "displayOrder",
              is_active             AS "isActive",
              starts_at             AS "startsAt",
              ends_at               AS "endsAt",
              created_at            AS "createdAt",
              updated_at            AS "updatedAt"
          `

          if (!rows.length) {
            return reply.status(404).send({ ok: false, error: 'ad_not_found' })
          }

          const normalized = normalizeAdBannerRow(rows[0])

          await defaultCache.invalidate(ADS_CACHE_KEY)

          try {
            if (typeof admin.publishTopic === 'function') {
              await admin.publishTopic('home', {
                type: 'ads.remove',
                payload: { id: normalized.id },
              })
            }
          } catch (err) {
            admin.log.warn({ err }, 'failed to publish ad remove websocket event')
          }

          return reply.send({ ok: true, data: normalized })
        } catch (err) {
          request.server.log.error({ err, adId: adId.toString() }, 'ad banner delete failed')
          return reply.status(500).send({ ok: false, error: 'request_failed' })
        }
      })

      // Clubs CRUD
      admin.get('/clubs', async (_request, reply) => {
        const clubs = await prisma.club.findMany({ orderBy: { name: 'asc' } })
        return reply.send({ ok: true, data: clubs })
      })

      admin.post('/clubs', async (request, reply) => {
        const body = request.body as { name?: string; shortName?: string; logoUrl?: string }
        const name = body?.name?.trim()
        const shortName = body?.shortName?.trim()
        const logoUrl = body?.logoUrl?.trim()

        if (!name || !shortName) {
          return reply.status(400).send({ ok: false, error: 'name_and_short_name_required' })
        }

        try {
          const club = await prisma.club.create({
            data: {
              name,
              shortName,
              logoUrl: logoUrl || null,
            },
          })
          return reply.send({ ok: true, data: club })
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError) {
            if (err.code === 'P2002') {
              return reply.status(409).send({ ok: false, error: 'club_duplicate' })
            }
            if (err.code === 'P2000') {
              return reply.status(400).send({ ok: false, error: 'club_field_too_long' })
            }
          }
          request.server.log.error({ err }, 'club create failed')
          return reply.status(500).send({ ok: false, error: 'create_failed' })
        }
      })

      admin.put<{ Params: ClubIdParams; Body: { name?: string; shortName?: string; logoUrl?: string } }>(
        '/clubs/:clubId',
        async (request, reply) => {
          const clubId = parseNumericId(request.params.clubId, 'clubId')
          const body = request.body ?? {}
        try {
          const club = await prisma.club.update({
            where: { id: clubId },
            data: {
              name: body.name?.trim(),
              shortName: body.shortName?.trim(),
              logoUrl: body.logoUrl?.trim(),
            },
          })
          return reply.send({ ok: true, data: club })
        } catch (err) {
          request.server.log.error({ err }, 'club update failed')
          return reply.status(500).send({ ok: false, error: 'update_failed' })
        }
      })

      admin.delete<{ Params: ClubIdParams }>('/clubs/:clubId', async (request, reply) => {
        const clubId = parseNumericId(request.params.clubId, 'clubId')
        const hasParticipants = await prisma.seasonParticipant.findFirst({ where: { clubId } })
        const hasFinishedMatches = await prisma.match.count({
          where: {
            status: MatchStatus.FINISHED,
            isFriendly: false,
            OR: [{ homeTeamId: clubId }, { awayTeamId: clubId }],
          },
        })
        if (hasParticipants) {
          return reply.status(409).send({ ok: false, error: 'club_in_active_season' })
        }
        if (hasFinishedMatches > 0) {
          return reply.status(409).send({ ok: false, error: 'club_in_finished_matches' })
        }
        await prisma.club.delete({ where: { id: clubId } })
        return reply.send({ ok: true })
      })

      admin.get<{ Params: ClubIdParams }>('/clubs/:clubId/players', async (request, reply) => {
        const clubId = parseNumericId(request.params.clubId, 'clubId')
        const players = await prisma.clubPlayer.findMany({
          where: { clubId },
          orderBy: [{ defaultShirtNumber: 'asc' }, { personId: 'asc' }],
          include: { person: true },
        })
        return reply.send({ ok: true, data: players })
      })

      admin.put<{
        Params: ClubIdParams
        Body: { players?: Array<{ personId?: number; defaultShirtNumber?: number | null }> }
      }>('/clubs/:clubId/players', async (request, reply) => {
        const clubId = parseNumericId(request.params.clubId, 'clubId')
        const body = request.body ?? {}

        const entries = Array.isArray(body?.players) ? body.players : []

        const normalized: Array<{ personId: number; defaultShirtNumber: number | null }> = []
        const seenPersons = new Set<number>()

        for (const entry of entries) {
          if (!entry?.personId || entry.personId <= 0) {
            return reply.status(400).send({ ok: false, error: 'personId_required' })
          }
          if (seenPersons.has(entry.personId)) {
            return reply.status(409).send({ ok: false, error: 'duplicate_person' })
          }
          seenPersons.add(entry.personId)

          const shirtNumber =
            entry.defaultShirtNumber && entry.defaultShirtNumber > 0
              ? Math.floor(entry.defaultShirtNumber)
              : null
          normalized.push({ personId: entry.personId, defaultShirtNumber: shirtNumber })
        }

        try {
          await prisma.$transaction(async tx => {
            if (!normalized.length) {
              await tx.clubPlayer.deleteMany({ where: { clubId } })
              await syncClubSeasonRosters(tx, clubId)
              return
            }

            const personIds = normalized.map(item => item.personId)

            await tx.clubPlayer.deleteMany({
              where: { clubId, personId: { notIn: personIds } },
            })

            for (const item of normalized) {
              await tx.clubPlayer.upsert({
                where: { clubId_personId: { clubId, personId: item.personId } },
                create: {
                  clubId,
                  personId: item.personId,
                  defaultShirtNumber: item.defaultShirtNumber,
                },
                update: {
                  defaultShirtNumber: item.defaultShirtNumber,
                },
              })
              await tx.playerClubCareerStats.upsert({
                where: { personId_clubId: { personId: item.personId, clubId } },
                create: {
                  personId: item.personId,
                  clubId,
                  totalGoals: 0,
                  totalMatches: 0,
                  totalAssists: 0,
                  yellowCards: 0,
                  redCards: 0,
                },
                update: {},
              })
            }

            await syncClubSeasonRosters(tx, clubId)
          }, { timeout: 20000, maxWait: 2000 })
        } catch (err) {
          const prismaErr = err as Prisma.PrismaClientKnownRequestError
          if (prismaErr?.code === 'P2002') {
            return reply.status(409).send({ ok: false, error: 'duplicate_shirt_number' })
          }
          request.server.log.error({ err }, 'club players update failed')
          return reply.status(500).send({ ok: false, error: 'club_players_update_failed' })
        }

        const players = await prisma.clubPlayer.findMany({
          where: { clubId },
          orderBy: [{ defaultShirtNumber: 'asc' }, { personId: 'asc' }],
          include: { person: true },
        })

        return reply.send({ ok: true, data: players })
      })

      admin.post<{
        Params: ClubIdParams
        Body: {
          lines?: unknown
          text?: unknown
          decisions?: Array<{ line: string; useExistingPersonId: number | null }>
        }
      }>('/clubs/:clubId/players/import', async (request, reply) => {
        const clubId = parseNumericId(request.params.clubId, 'clubId')
        const body = request.body ?? {}

        const rawLines: string[] = []
        if (Array.isArray(body?.lines)) {
          for (const item of body.lines) {
            if (typeof item === 'string') rawLines.push(item)
          }
        }
        if (typeof body?.text === 'string') {
          rawLines.push(
            ...body.text
              .split(/\r?\n/)
              .map(line => line.trim())
              .filter(line => line.length > 0)
          )
        }

        // Парсим decisions - решения пользователя по похожим
        const decisionsMap = new Map<string, number | null>()
        if (Array.isArray(body?.decisions)) {
          for (const decision of body.decisions) {
            if (typeof decision?.line === 'string' && decision.line.trim()) {
              try {
                // Нормализуем ключ решения
                const parsed = parseFullNameLine(decision.line)
                const key = `${parsed.lastName.toLowerCase()}|${parsed.firstName.toLowerCase()}`
                decisionsMap.set(
                  key,
                  typeof decision.useExistingPersonId === 'number'
                    ? decision.useExistingPersonId
                    : null
                )
              } catch {
                // Игнорируем некорректные строки в decisions
                request.server.log.warn({ line: decision.line }, 'Skipping invalid decision line')
              }
            }
          }
        }

        const normalizedLines = rawLines.map(line => line.trim()).filter(line => line.length > 0)
        if (!normalizedLines.length) {
          return reply.status(400).send({ ok: false, error: 'no_names_provided' })
        }
        if (normalizedLines.length > 200) {
          return reply.status(400).send({ ok: false, error: 'too_many_names' })
        }

        const parsedNames: Array<{ firstName: string; lastName: string }> = []
        try {
          for (const line of normalizedLines) {
            parsedNames.push(parseFullNameLine(line))
          }
        } catch (err) {
          return reply.status(400).send({ ok: false, error: 'invalid_full_name' })
        }

        const club = await prisma.club.findUnique({ where: { id: clubId } })
        if (!club) {
          return reply.status(404).send({ ok: false, error: 'club_not_found' })
        }

        try {
          await prisma.$transaction(async tx => {
            const nameKey = (firstName: string, lastName: string) =>
              `${lastName.toLowerCase()}|${firstName.toLowerCase()}`

            const uniqueEntries: Array<{ key: string; firstName: string; lastName: string }> = []
            const seenNames = new Set<string>()
            for (const entry of parsedNames) {
              const key = nameKey(entry.firstName, entry.lastName)
              if (seenNames.has(key)) continue
              seenNames.add(key)
              uniqueEntries.push({ key, firstName: entry.firstName, lastName: entry.lastName })
            }

            const existingPlayers = await tx.clubPlayer.findMany({
              where: { clubId },
              select: { defaultShirtNumber: true, personId: true },
            })

            const takenNumbers = new Set<number>()
            const clubPersonIds = new Set<number>()
            for (const player of existingPlayers) {
              if (player.defaultShirtNumber && player.defaultShirtNumber > 0) {
                takenNumbers.add(player.defaultShirtNumber)
              }
              clubPersonIds.add(player.personId)
            }

            const personsByKey = new Map<string, { id: number }>()
            if (uniqueEntries.length) {
              const existingPersons = await tx.person.findMany({
                where: {
                  OR: uniqueEntries.map(entry => ({
                    firstName: entry.firstName,
                    lastName: entry.lastName,
                  })),
                },
              })
              for (const person of existingPersons) {
                personsByKey.set(nameKey(person.firstName, person.lastName), person)
              }
            }

            const allocateNumber = () => {
              let candidate = 1
              while (takenNumbers.has(candidate)) {
                candidate += 1
              }
              takenNumbers.add(candidate)
              return candidate
            }

            for (const entry of uniqueEntries) {
              // Проверяем, есть ли решение пользователя для этой записи
              const decision = decisionsMap.get(entry.key)

              let person: { id: number } | undefined

              if (decision !== undefined && decision !== null) {
                // Пользователь выбрал использовать существующего игрока
                const existingPerson = await tx.person.findUnique({ where: { id: decision } })
                if (existingPerson) {
                  person = existingPerson
                }
              }

              if (!person) {
                // Ищем точное совпадение по имени
                person = personsByKey.get(entry.key)
              }

              if (!person) {
                // Создаём нового игрока
                person = await tx.person.create({
                  data: {
                    firstName: entry.firstName,
                    lastName: entry.lastName,
                    isPlayer: true,
                  },
                })
                personsByKey.set(entry.key, person)
              }

              if (clubPersonIds.has(person.id)) {
                continue
              }

              await tx.clubPlayer.create({
                data: {
                  clubId,
                  personId: person.id,
                  defaultShirtNumber: allocateNumber(),
                },
              })
              await tx.playerClubCareerStats.upsert({
                where: { personId_clubId: { personId: person.id, clubId } },
                create: {
                  personId: person.id,
                  clubId,
                  totalGoals: 0,
                  totalMatches: 0,
                  totalAssists: 0,
                  yellowCards: 0,
                  redCards: 0,
                },
                update: {},
              })
              clubPersonIds.add(person.id)
            }

            await syncClubSeasonRosters(tx, clubId)
          })
        } catch (err) {
          request.server.log.error({ err }, 'club players import failed')
          return reply.status(500).send({ ok: false, error: 'club_players_import_failed' })
        }

        const players = await prisma.clubPlayer.findMany({
          where: { clubId },
          orderBy: [{ defaultShirtNumber: 'asc' }, { personId: 'asc' }],
          include: { person: true },
        })

        return sendSerialized(reply, players)
      })

      // Check for similar players before import (для предупреждения о возможных дубликатах)
      admin.post<{ Params: { clubId: string } }>(
        '/clubs/:clubId/players/check-similar',
        async (request, reply) => {
          const clubIdParam = request.params.clubId
          const clubId = parseNumericId(clubIdParam, 'clubId')

          const body = request.body as { lines?: string[]; text?: string }
          const rawLines: string[] = []
          if (Array.isArray(body?.lines)) {
            for (const item of body.lines) {
              if (typeof item === 'string') rawLines.push(item)
            }
          }
          if (typeof body?.text === 'string') {
            rawLines.push(
              ...body.text
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(line => line.length > 0)
            )
          }

          const normalizedLines = rawLines.map(line => line.trim()).filter(line => line.length > 0)
          if (!normalizedLines.length) {
            return reply.send({ ok: true, data: { entries: [], hasSimilar: false } })
          }

          const parsedNames: Array<{ firstName: string; lastName: string }> = []
          try {
            for (const line of normalizedLines) {
              parsedNames.push(parseFullNameLine(line))
            }
          } catch (err) {
            return reply.status(400).send({ ok: false, error: 'invalid_full_name' })
          }

          // Получаем всех игроков с их клубами для поиска похожих
          const allPersons = await prisma.person.findMany({
            where: { isPlayer: true },
            include: {
              clubAffiliations: {
                include: {
                  club: {
                    select: {
                      id: true,
                      name: true,
                      shortName: true,
                    },
                  },
                },
              },
            },
          })

          // Получаем текущий состав клуба для исключения уже добавленных
          const clubPlayers = await prisma.clubPlayer.findMany({
            where: { clubId },
            select: { personId: true },
          })
          const clubPersonIds = new Set(clubPlayers.map(p => p.personId))

          const entries: Array<{
            input: { firstName: string; lastName: string }
            similar: SimilarPersonMatch[]
            exactMatch: SimilarPersonMatch | null
            alreadyInClub: boolean
          }> = []

          for (const input of parsedNames) {
            const inputNormalized = normalizeForFuzzyMatch(`${input.lastName} ${input.firstName}`)

            let exactMatch: SimilarPersonMatch | null = null
            const similar: SimilarPersonMatch[] = []

            for (const person of allPersons) {
              // Проверяем точное совпадение (после нормализации normalizePersonName)
              if (
                person.firstName.toLowerCase() === input.firstName.toLowerCase() &&
                person.lastName.toLowerCase() === input.lastName.toLowerCase()
              ) {
                exactMatch = {
                  person: {
                    id: person.id,
                    firstName: person.firstName,
                    lastName: person.lastName,
                  },
                  clubs: person.clubAffiliations.map(a => ({
                    id: a.club.id,
                    name: a.club.name,
                    shortName: a.club.shortName,
                  })),
                  matchType: 'exact',
                }
                continue
              }

              // Проверяем нечёткое совпадение
              const personNormalized = normalizeForFuzzyMatch(
                `${person.lastName} ${person.firstName}`
              )

              // Проверка normalized match (одинаковые после полной нормализации)
              if (personNormalized === inputNormalized) {
                similar.push({
                  person: {
                    id: person.id,
                    firstName: person.firstName,
                    lastName: person.lastName,
                  },
                  clubs: person.clubAffiliations.map(a => ({
                    id: a.club.id,
                    name: a.club.name,
                    shortName: a.club.shortName,
                  })),
                  matchType: 'normalized',
                })
                continue
              }

              // Fuzzy match по фамилии и имени отдельно
              const lastNameSimilar = isSimilarName(person.lastName, input.lastName)
              const firstNameSimilar = isSimilarName(person.firstName, input.firstName)

              if (lastNameSimilar && firstNameSimilar) {
                similar.push({
                  person: {
                    id: person.id,
                    firstName: person.firstName,
                    lastName: person.lastName,
                  },
                  clubs: person.clubAffiliations.map(a => ({
                    id: a.club.id,
                    name: a.club.name,
                    shortName: a.club.shortName,
                  })),
                  matchType: 'fuzzy',
                })
              }
            }

            // Проверяем, уже ли игрок в клубе
            const alreadyInClub = exactMatch ? clubPersonIds.has(exactMatch.person.id) : false

            entries.push({
              input,
              exactMatch,
              similar: similar.slice(0, 5), // Ограничиваем до 5 похожих
              alreadyInClub,
            })
          }

          const hasSimilar = entries.some(e => e.similar.length > 0 && !e.exactMatch)

          return reply.send({
            ok: true,
            data: {
              entries,
              hasSimilar,
            },
          })
        }
      )

      // Persons CRUD
      admin.get('/persons', async (request, reply) => {
        const { isPlayer } = request.query as { isPlayer?: string }
        const personsRaw = await prisma.person.findMany({
          where: typeof isPlayer === 'string' ? { isPlayer: isPlayer === 'true' } : undefined,
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
          include: {
            clubAffiliations: {
              orderBy: { createdAt: 'asc' },
              include: {
                club: {
                  select: {
                    id: true,
                    name: true,
                    shortName: true,
                    logoUrl: true,
                  },
                },
              },
            },
          },
        })

        const persons = personsRaw.map(person => {
          const { clubAffiliations, ...rest } = person
          const primary = clubAffiliations[0]
          const clubs = clubAffiliations.map(aff => ({
            id: aff.club.id,
            name: aff.club.name,
            shortName: aff.club.shortName,
            logoUrl: aff.club.logoUrl ?? null,
          }))

          return {
            ...rest,
            currentClubId: primary?.clubId ?? null,
            currentClub: primary
              ? {
                  id: primary.club.id,
                  name: primary.club.name,
                  shortName: primary.club.shortName,
                  logoUrl: primary.club.logoUrl ?? null,
                }
              : null,
            clubs,
          }
        })

        return reply.send({ ok: true, data: persons })
      })

      admin.post('/persons', async (request, reply) => {
        const body = request.body as { firstName?: string; lastName?: string; isPlayer?: boolean }
        if (!body?.firstName || !body?.lastName) {
          return reply.status(400).send({ ok: false, error: 'first_and_last_name_required' })
        }
        const person = await prisma.person.create({
          data: {
            firstName: body.firstName.trim(),
            lastName: body.lastName.trim(),
            isPlayer: body.isPlayer ?? true,
          },
        })
        return reply.send({ ok: true, data: person })
      })

      admin.put('/persons/:personId', async (request, reply) => {
        const personId = parseNumericId(getParam(request.params, 'personId'), 'personId')
        const body = request.body as { firstName?: string; lastName?: string; isPlayer?: boolean }
        try {
          const person = await prisma.person.update({
            where: { id: personId },
            data: {
              firstName: body.firstName?.trim(),
              lastName: body.lastName?.trim(),
              isPlayer: body.isPlayer,
            },
          })
          return reply.send({ ok: true, data: person })
        } catch (err) {
          request.server.log.error({ err }, 'person update failed')
          return reply.status(500).send({ ok: false, error: 'update_failed' })
        }
      })

      admin.delete('/persons/:personId', async (request, reply) => {
        const personId = parseNumericId(getParam(request.params, 'personId'), 'personId')
        const roster = await prisma.seasonRoster.findFirst({ where: { personId } })
        const lineup = await prisma.matchLineup.findFirst({ where: { personId } })
        if (roster || lineup) {
          return reply.status(409).send({ ok: false, error: 'person_has_history' })
        }
        await prisma.person.delete({ where: { id: personId } })
        return reply.send({ ok: true })
      })

      admin.post('/player-transfers', async (request, reply) => {
        const body = request.body as {
          transfers?: Array<{ personId?: number; toClubId?: number; fromClubId?: number | null }>
        }

        const entries = Array.isArray(body?.transfers) ? body.transfers : []
        if (!entries.length) {
          return reply.status(400).send({ ok: false, error: 'transfer_payload_empty' })
        }

        const normalized: Array<{ personId: number; toClubId: number; fromClubId: number | null }> =
          []
        const seenPersons = new Set<number>()

        try {
          for (const entry of entries) {
            const rawPersonId = entry?.personId
            const rawToClubId = entry?.toClubId
            const rawFromClubId = entry?.fromClubId

            let personId: number
            let toClubId: number
            try {
              personId = parseNumericId(rawPersonId as number, 'personId')
            } catch (err) {
              throw new TransferError('transfer_invalid_person')
            }

            try {
              toClubId = parseNumericId(rawToClubId as number, 'clubId')
            } catch (err) {
              throw new TransferError('transfer_invalid_club')
            }

            const fromClubId = parseOptionalNumericId(rawFromClubId, 'clubId')

            if (seenPersons.has(personId)) {
              throw new TransferError('transfer_duplicate_person')
            }
            seenPersons.add(personId)

            normalized.push({ personId, toClubId, fromClubId })
          }
        } catch (err) {
          if (err instanceof TransferError) {
            return reply.status(400).send({ ok: false, error: err.message })
          }
          throw err
        }

        const applied: TransferSummary[] = []
        const skipped: TransferSummary[] = []
        const affectedClubIds = new Set<number>()

        try {
          await prisma.$transaction(async tx => {
            for (const transfer of normalized) {
              const person = await tx.person.findUnique({
                where: { id: transfer.personId },
                include: {
                  clubAffiliations: {
                    include: {
                      club: {
                        select: {
                          id: true,
                          name: true,
                          shortName: true,
                        },
                      },
                    },
                    orderBy: { createdAt: 'asc' },
                  },
                },
              })

              if (!person) {
                throw new TransferError('transfer_person_not_found')
              }
              if (!person.isPlayer) {
                throw new TransferError('transfer_person_not_player')
              }

              const targetClub = await tx.club.findUnique({
                where: { id: transfer.toClubId },
                select: { id: true, name: true, shortName: true },
              })

              if (!targetClub) {
                throw new TransferError('transfer_club_not_found')
              }

              const affiliations = person.clubAffiliations || []
              let fromClubId = transfer.fromClubId
              let fromClub =
                fromClubId !== null
                  ? (affiliations.find(aff => aff.clubId === fromClubId)?.club ?? null)
                  : null

              if (fromClubId !== null && !fromClub) {
                throw new TransferError('transfer_from_club_mismatch')
              }

              if (fromClubId === null && affiliations.length > 0) {
                fromClubId = affiliations[0].clubId
                fromClub = affiliations[0].club
              }

              if (fromClubId === targetClub.id) {
                skipped.push({
                  personId: person.id,
                  person: { id: person.id, firstName: person.firstName, lastName: person.lastName },
                  fromClubId,
                  toClubId: targetClub.id,
                  fromClub: fromClub
                    ? { id: fromClub.id, name: fromClub.name, shortName: fromClub.shortName }
                    : null,
                  toClub: {
                    id: targetClub.id,
                    name: targetClub.name,
                    shortName: targetClub.shortName,
                  },
                  status: 'skipped',
                  reason: 'same_club',
                })
                continue
              }

              if (fromClubId !== null) {
                await tx.clubPlayer.deleteMany({
                  where: { clubId: fromClubId, personId: person.id },
                })
                affectedClubIds.add(fromClubId)
              }

              await tx.clubPlayer.upsert({
                where: { clubId_personId: { clubId: targetClub.id, personId: person.id } },
                create: {
                  clubId: targetClub.id,
                  personId: person.id,
                  defaultShirtNumber: null,
                },
                update: {
                  defaultShirtNumber: null,
                },
              })

              await tx.playerClubCareerStats.upsert({
                where: { personId_clubId: { personId: person.id, clubId: targetClub.id } },
                create: {
                  personId: person.id,
                  clubId: targetClub.id,
                  totalGoals: 0,
                  totalMatches: 0,
                  totalAssists: 0,
                  yellowCards: 0,
                  redCards: 0,
                },
                update: {},
              })

              affectedClubIds.add(targetClub.id)

              applied.push({
                personId: person.id,
                person: { id: person.id, firstName: person.firstName, lastName: person.lastName },
                fromClubId,
                toClubId: targetClub.id,
                fromClub: fromClub
                  ? { id: fromClub.id, name: fromClub.name, shortName: fromClub.shortName }
                  : null,
                toClub: {
                  id: targetClub.id,
                  name: targetClub.name,
                  shortName: targetClub.shortName,
                },
                status: 'moved',
              })
            }

            for (const clubId of affectedClubIds) {
              await syncClubSeasonRosters(tx, clubId)
            }
          })
        } catch (err) {
          if (err instanceof TransferError) {
            return reply.status(400).send({ ok: false, error: err.message })
          }
          request.server.log.error({ err }, 'player transfers failed')
          return reply.status(500).send({ ok: false, error: 'transfer_failed' })
        }

        let newsPayload: unknown = null
        if (applied.length) {
          try {
            const dateLabel = new Date().toLocaleDateString('ru-RU')
            const lines = applied
              .map(entry => {
                const fromLabel = entry.fromClub ? entry.fromClub.shortName : 'свободного статуса'
                const toLabel = entry.toClub ? entry.toClub.shortName : 'без клуба'
                return `• ${entry.person.lastName} ${entry.person.firstName}: ${fromLabel} → ${toLabel}`
              })
              .join('\n')

            const first = applied[0]
            const targetLabel = first.toClub ? first.toClub.shortName : 'новый клуб'
            const title =
              applied.length === 1
                ? `Трансфер: ${first.person.lastName} ${first.person.firstName} → ${targetLabel}`
                : `Трансферы (${dateLabel})`
            const content = `Завершены трансферные изменения:\n\n${lines}`

            const news = await prisma.news.create({
              data: {
                title,
                content,
                coverUrl: null,
                sendToTelegram: false,
              },
            })

            await defaultCache.invalidate(NEWS_CACHE_KEY)

            try {
              const payload = serializePrisma(news)
              await publishAdminTopic(admin, 'home', {
                type: 'news.full',
                payload,
              })
              newsPayload = payload
            } catch (publishErr) {
              admin.log.warn(
                { err: publishErr },
                'failed to publish transfer news websocket update'
              )
              newsPayload = serializePrisma(news)
            }
          } catch (newsErr) {
            admin.log.error({ err: newsErr }, 'failed to create transfer news')
          }
        }

        return reply.send({
          ok: true,
          data: {
            results: [...applied, ...skipped],
            movedCount: applied.length,
            skippedCount: skipped.length,
            affectedClubIds: Array.from(affectedClubIds),
            news: newsPayload,
          },
        })
      })

      // Stadiums
      admin.get('/stadiums', async (_request, reply) => {
        const stadiums = await prisma.stadium.findMany({ orderBy: { name: 'asc' } })
        return reply.send({ ok: true, data: stadiums })
      })

      admin.post('/stadiums', async (request, reply) => {
        const body = request.body as { name?: string; city?: string }
        if (!body?.name || !body?.city) {
          return reply.status(400).send({ ok: false, error: 'name_and_city_required' })
        }
        const stadium = await prisma.stadium.create({
          data: { name: body.name.trim(), city: body.city.trim() },
        })
        return reply.send({ ok: true, data: stadium })
      })

      admin.put('/stadiums/:stadiumId', async (request, reply) => {
        const stadiumId = parseNumericId(getParam(request.params, 'stadiumId'), 'stadiumId')
        const body = request.body as { name?: string; city?: string }
        try {
          const stadium = await prisma.stadium.update({
            where: { id: stadiumId },
            data: { name: body.name?.trim(), city: body.city?.trim() },
          })
          return reply.send({ ok: true, data: stadium })
        } catch (err) {
          request.server.log.error({ err }, 'stadium update failed')
          return reply.status(500).send({ ok: false, error: 'update_failed' })
        }
      })

      admin.delete('/stadiums/:stadiumId', async (request, reply) => {
        const stadiumId = parseNumericId(getParam(request.params, 'stadiumId'), 'stadiumId')
        const hasMatches = await prisma.match.findFirst({ where: { stadiumId } })
        if (hasMatches) {
          return reply.status(409).send({ ok: false, error: 'stadium_used_in_matches' })
        }
        await prisma.stadium.delete({ where: { id: stadiumId } })
        return reply.send({ ok: true })
      })

      // Competitions
      admin.get('/competitions', async (_request, reply) => {
        const competitions = await prisma.competition.findMany({ orderBy: { name: 'asc' } })
        return reply.send({ ok: true, data: competitions })
      })

      admin.post('/competitions', async (request, reply) => {
        const body = request.body as {
          name?: string
          type?: CompetitionType
          seriesFormat?: SeriesFormat
        }
        if (!body?.name || !body?.type || !body?.seriesFormat) {
          return reply.status(400).send({ ok: false, error: 'name_type_series_format_required' })
        }
        const competition = await prisma.competition.create({
          data: {
            name: body.name.trim(),
            type: body.type,
            seriesFormat: body.seriesFormat,
          },
        })
        return reply.send({ ok: true, data: competition })
      })

      admin.put('/competitions/:competitionId', async (request, reply) => {
        const competitionId = parseNumericId(getParam(request.params, 'competitionId'), 'competitionId')
        const body = request.body as {
          name?: string
          type?: CompetitionType
          seriesFormat?: SeriesFormat
        }
        const hasActiveSeason = await prisma.season.findFirst({ where: { competitionId } })
        if (hasActiveSeason && body.seriesFormat && hasActiveSeason) {
          return reply.status(409).send({ ok: false, error: 'series_format_locked' })
        }
        const competition = await prisma.competition.update({
          where: { id: competitionId },
          data: {
            name: body.name?.trim(),
            type: body.type,
            seriesFormat: body.seriesFormat,
          },
        })
        return reply.send({ ok: true, data: competition })
      })

      admin.delete('/competitions/:competitionId', async (request, reply) => {
        const competitionId = parseNumericId(getParam(request.params, 'competitionId'), 'competitionId')
        try {
          let seasonIds: number[] = []
          await prisma.$transaction(async tx => {
            const seasons = await tx.season.findMany({
              where: { competitionId },
              select: { id: true },
            })
            seasonIds = seasons.map(season => season.id)

            let clubIds: number[] = []
            if (seasonIds.length) {
              const participants = await tx.seasonParticipant.findMany({
                where: { seasonId: { in: seasonIds } },
                select: { clubId: true },
              })
              clubIds = Array.from(new Set(participants.map(entry => entry.clubId)))
            }

            await tx.season.deleteMany({ where: { competitionId } })
            await tx.competition.delete({ where: { id: competitionId } })

            if (clubIds.length) {
              await rebuildCareerStatsForClubs(clubIds, tx)
            }
          }, { timeout: 20000 })
          const cacheKeys = new Set<string>([
            `competition:${competitionId}:club-stats`,
            `competition:${competitionId}:player-stats`,
            `competition:${competitionId}:player-career`,
            ...seasonIds.flatMap(seasonId => [
              `season:${seasonId}:club-stats`,
              `season:${seasonId}:player-stats`,
              `season:${seasonId}:player-career`,
            ]),
          ])
          await Promise.all(
            Array.from(cacheKeys).map(key => defaultCache.invalidate(key).catch(() => undefined))
          )
          return reply.send({ ok: true })
        } catch (err) {
          request.server.log.error({ err, competitionId }, 'competition delete failed')
          return reply.status(500).send({ ok: false, error: 'competition_delete_failed' })
        }
      })

      // Seasons & configuration
      admin.get('/seasons', async (_request, reply) => {
        const seasons = await prisma.season.findMany({
          orderBy: [{ startDate: 'desc' }],
          include: {
            competition: true,
            participants: { include: { club: true } },
            rosters: {
              include: {
                person: true,
                club: true,
              },
              orderBy: [{ clubId: 'asc' }, { shirtNumber: 'asc' }],
            },
            groups: {
              include: {
                slots: {
                  include: {
                    club: {
                      select: { id: true, name: true, shortName: true, logoUrl: true },
                    },
                  },
                },
              },
              orderBy: { groupIndex: 'asc' },
            },
          },
        })
        return reply.send({ ok: true, data: seasons })
      })

      admin.post('/seasons', async (request, reply) => {
        const body = request.body as {
          competitionId?: number
          name?: string
          startDate?: string
          endDate?: string
          city?: string | null
        }
        if (!body?.competitionId || !body?.name || !body?.startDate || !body?.endDate) {
          return reply.status(400).send({ ok: false, error: 'season_fields_required' })
        }
        const competition = await prisma.competition.findUnique({
          where: { id: body.competitionId },
        })
        if (!competition) {
          return reply.status(404).send({ ok: false, error: 'competition_not_found' })
        }
        const cityValueRaw = typeof body.city === 'string' ? body.city.trim() : ''
        const normalizedCity = cityValueRaw ? cityValueRaw : null
        const season = await prisma.season.create({
          data: {
            competitionId: body.competitionId,
            name: body.name.trim(),
            startDate: new Date(body.startDate),
            endDate: new Date(body.endDate),
            city: normalizedCity,
            seriesFormat: competition.seriesFormat,
          },
        })
        return reply.send({ ok: true, data: season })
      })

      admin.post('/seasons/auto', async (request, reply) => {
        const body = request.body as {
          competitionId?: number
          seasonName?: string
          startDate?: string
          matchDayOfWeek?: number
          matchTime?: string
          clubIds?: number[]
          seriesFormat?: string
          city?: string | null
          groupRounds?: number // 1 или 2 круга для групповой стадии
          playoffBestOf?: number // количество матчей в серии плей-офф (1, 3, 5, 7)
          groupStage?: {
            groupCount?: number
            groupSize?: number
            qualifyCount?: number
            groups?: Array<{
              groupIndex?: number
              label?: string
              qualifyCount?: number
              slots?: Array<{
                position?: number
                clubId?: number
              }>
            }>
          }
        }

        if (
          !body?.competitionId ||
          !body?.seasonName ||
          !body?.startDate ||
          typeof body.matchDayOfWeek !== 'number'
        ) {
          return reply.status(400).send({ ok: false, error: 'automation_fields_required' })
        }

        let clubIds = Array.isArray(body.clubIds)
          ? body.clubIds.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0)
          : []

        const competition = await prisma.competition.findUnique({
          where: { id: body.competitionId },
        })
        if (!competition) {
          return reply.status(404).send({ ok: false, error: 'competition_not_found' })
        }

        const allowedFormats = new Set(Object.values(SeriesFormat))
        const requestedFormat = typeof body.seriesFormat === 'string' ? body.seriesFormat : null
        const seriesFormat =
          requestedFormat && allowedFormats.has(requestedFormat as SeriesFormat)
            ? (requestedFormat as SeriesFormat)
            : competition.seriesFormat

        let groupStageConfig:
          | {
              groupCount: number
              groupSize: number
              qualifyCount: number
              groups: Array<{
                groupIndex: number
                label: string
                qualifyCount: number
                slots: Array<{ position: number; clubId: number }>
              }>
            }
          | undefined

        if (seriesFormat === SeriesFormat.GROUP_SINGLE_ROUND_PLAYOFF) {
          const rawGroupStage = body.groupStage as RawGroupStagePayload | undefined
          if (!rawGroupStage || typeof rawGroupStage !== 'object') {
            return reply.status(400).send({ ok: false, error: 'group_stage_required' })
          }

          const rawGroups = Array.isArray(rawGroupStage.groups)
            ? (rawGroupStage.groups as RawGroupPayload[])
            : []
          const parsedGroups = rawGroups.map((group, index) => {
            const slotsRaw = Array.isArray(group?.slots)
              ? (group.slots as RawGroupSlotPayload[])
              : []
            const slots = slotsRaw.map((slot, slotIndex: number) => ({
              position: Number(slot?.position ?? slotIndex + 1),
              clubId: Number(slot?.clubId ?? 0),
            }))
            return {
              groupIndex: Number(group?.groupIndex ?? index + 1),
              label: typeof group?.label === 'string' ? group.label : `Группа ${index + 1}`,
              qualifyCount: Number(group?.qualifyCount ?? rawGroupStage?.qualifyCount ?? 0),
              slots,
            }
          })

          const groupCount = Number(rawGroupStage.groupCount ?? parsedGroups.length)
          const groupSize = Number(rawGroupStage.groupSize ?? parsedGroups[0]?.slots.length ?? 0)

          // Валидация допустимых конфигураций кубка
          // Допустимые комбинации: 2x4, 2x5, 3x3, 3x4, 4x3
          const validCupConfigs = [
            { groups: 2, size: 4 }, // 8 команд
            { groups: 2, size: 5 }, // 10 команд
            { groups: 3, size: 3 }, // 9 команд
            { groups: 3, size: 4 }, // 12 команд
            { groups: 4, size: 3 }, // 12 команд (эталонная система)
          ]
          const isCupForCompetition = competition.type === CompetitionType.CUP
          if (isCupForCompetition) {
            const isValidConfig = validCupConfigs.some(
              cfg => cfg.groups === groupCount && cfg.size === groupSize
            )
            if (!isValidConfig) {
              return reply.status(400).send({
                ok: false,
                error: 'invalid_cup_config',
                message: `Недопустимая конфигурация кубка: ${groupCount}x${groupSize}. Допустимые: 2x4, 2x5, 3x3, 3x4, 4x3`,
              })
            }
          }

          groupStageConfig = {
            groupCount,
            groupSize,
            qualifyCount: Number(rawGroupStage.qualifyCount ?? parsedGroups[0]?.qualifyCount ?? 0),
            groups: parsedGroups,
          }

          clubIds = []
          for (const group of parsedGroups) {
            for (const slot of group.slots) {
              if (Number.isFinite(slot.clubId) && slot.clubId > 0) {
                clubIds.push(slot.clubId)
              }
            }
          }
        }

        if (clubIds.length < 2) {
          return reply.status(400).send({ ok: false, error: 'automation_needs_participants' })
        }

        const matchDay = Number(body.matchDayOfWeek)
        const normalizedMatchDay = ((matchDay % 7) + 7) % 7

        // Валидация и нормализация groupRounds и playoffBestOf
        const groupRounds = typeof body.groupRounds === 'number' && [1, 2].includes(body.groupRounds)
          ? body.groupRounds
          : 1
        const playoffBestOf = typeof body.playoffBestOf === 'number' && [1, 3, 5, 7].includes(body.playoffBestOf)
          ? body.playoffBestOf
          : 1

        try {
          const result = await runSeasonAutomation(prisma, request.log, {
            competition,
            clubIds,
            seasonName: body.seasonName,
            startDateISO: body.startDate,
            matchDayOfWeek: normalizedMatchDay,
            matchTime: body.matchTime,
            city: typeof body.city === 'string' ? body.city.trim() : undefined,
            seriesFormat,
            groupStage: groupStageConfig,
            groupRounds,
            playoffBestOf,
          })

          // Инвалидируем кэш лиги после создания сезона
          await Promise.all([
            defaultCache.invalidate(PUBLIC_LEAGUE_SEASONS_KEY).catch(() => undefined),
            defaultCache.invalidate(PUBLIC_LEAGUE_TABLE_KEY).catch(() => undefined),
            defaultCache.invalidate(`${PUBLIC_LEAGUE_TABLE_KEY}:${result.seasonId}`).catch(() => undefined),
            defaultCache.invalidate(PUBLIC_LEAGUE_SCHEDULE_KEY).catch(() => undefined),
            defaultCache.invalidate(`${PUBLIC_LEAGUE_SCHEDULE_KEY}:${result.seasonId}`).catch(() => undefined),
            defaultCache.invalidate(PUBLIC_LEAGUE_RESULTS_KEY).catch(() => undefined),
            defaultCache.invalidate(`${PUBLIC_LEAGUE_RESULTS_KEY}:${result.seasonId}`).catch(() => undefined),
          ])

          return reply.send({ ok: true, data: result })
        } catch (err) {
          const error = err as Error & { code?: string }
          request.server.log.error({ err }, 'season automation failed')
          if (typeof error.message === 'string' && error.message.startsWith('group_stage_')) {
            return reply.status(400).send({ ok: false, error: error.message })
          }
          if ((error.message as string) === 'not_enough_participants') {
            return reply.status(400).send({ ok: false, error: 'automation_needs_participants' })
          }
          return reply.status(500).send({ ok: false, error: 'automation_failed' })
        }
      })

      admin.post('/seasons/:seasonId/playoffs', async (request, reply) => {
        const seasonId = parseNumericId(getParam(request.params, 'seasonId'), 'seasonId')
        const body = request.body as { bestOfLength?: number }
        const bestOfLength = typeof body?.bestOfLength === 'number' ? body.bestOfLength : undefined

        try {
          const result = await createSeasonPlayoffs(prisma, request.log, { seasonId, bestOfLength })
          return reply.send({ ok: true, data: result })
        } catch (err) {
          const error = err as Error
          switch (error.message) {
            case 'season_not_found':
              return reply.status(404).send({ ok: false, error: 'season_not_found' })
            case 'playoffs_not_supported':
              return reply.status(409).send({ ok: false, error: 'playoffs_not_supported' })
            case 'series_already_exist':
              return reply.status(409).send({ ok: false, error: 'playoffs_already_exists' })
            case 'matches_not_finished':
              return reply.status(409).send({ ok: false, error: 'regular_season_not_finished' })
            case 'not_enough_participants':
            case 'not_enough_pairs':
              return reply.status(409).send({ ok: false, error: 'not_enough_participants' })
            default:
              request.server.log.error({ err, seasonId }, 'playoffs creation failed')
              return reply.status(500).send({ ok: false, error: 'playoffs_creation_failed' })
          }
        }
      })

      admin.put('/seasons/:seasonId', async (request, reply) => {
        const seasonId = parseNumericId(getParam(request.params, 'seasonId'), 'seasonId')
        const body = request.body as {
          name?: string
          startDate?: string
          endDate?: string
          city?: string | null
        }
        const matchesPlayed = await prisma.match.findFirst({
          where: { seasonId, status: MatchStatus.FINISHED, isFriendly: false },
        })
        if (matchesPlayed && (body.startDate || body.endDate)) {
          return reply.status(409).send({ ok: false, error: 'season_dates_locked' })
        }
        const cityValue =
          body.city === undefined
            ? undefined
            : body.city === null
              ? null
              : typeof body.city === 'string'
                ? body.city.trim() || null
                : undefined
        const season = await prisma.season.update({
          where: { id: seasonId },
          data: {
            name: body.name?.trim(),
            startDate: body.startDate ? new Date(body.startDate) : undefined,
            endDate: body.endDate ? new Date(body.endDate) : undefined,
            city: cityValue,
          },
        })
        return reply.send({ ok: true, data: season })
      })

      admin.delete('/seasons/:seasonId', async (request, reply) => {
        const seasonId = parseNumericId(getParam(request.params, 'seasonId'), 'seasonId')
        let competitionId: number | null = null

        try {
          await prisma.$transaction(
            async tx => {
              const season = await tx.season.findUnique({
                where: { id: seasonId },
                include: {
                  participants: { select: { clubId: true } },
                },
              })

              if (!season) {
                throw new RequestError(404, 'season_not_found')
              }

              if (season.isActive) {
                throw new RequestError(409, 'season_is_active')
              }

              competitionId = season.competitionId
              const clubIds = Array.from(new Set(season.participants.map(entry => entry.clubId)))

              await tx.season.delete({ where: { id: seasonId } })

              if (clubIds.length) {
                await rebuildCareerStatsForClubs(clubIds, tx)
              }
            },
            { timeout: 20000 }
          )

          const cacheKeys = new Set<string>([
            `season:${seasonId}:club-stats`,
            `season:${seasonId}:player-stats`,
            `season:${seasonId}:player-career`,
            leagueStatsCacheKey('club-career'),
            leagueStatsCacheKey('player-career'),
          ])

          if (competitionId) {
            cacheKeys.add(`competition:${competitionId}:club-stats`)
            cacheKeys.add(`competition:${competitionId}:player-stats`)
            cacheKeys.add(`competition:${competitionId}:player-career`)
          }

          await Promise.all(
            Array.from(cacheKeys).map(key => defaultCache.invalidate(key).catch(() => undefined))
          )

          await defaultCache.invalidate(PUBLIC_LEAGUE_SEASONS_KEY)
          await defaultCache.invalidate(PUBLIC_LEAGUE_TABLE_KEY)
          await defaultCache.invalidate(`${PUBLIC_LEAGUE_TABLE_KEY}:${seasonId}`)
          await defaultCache.invalidate(PUBLIC_LEAGUE_SCHEDULE_KEY)
          await defaultCache.invalidate(`${PUBLIC_LEAGUE_SCHEDULE_KEY}:${seasonId}`)
          await defaultCache.invalidate(PUBLIC_LEAGUE_RESULTS_KEY)
          await defaultCache.invalidate(`${PUBLIC_LEAGUE_RESULTS_KEY}:${seasonId}`)

          return reply.send({ ok: true })
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          request.server.log.error({ err, seasonId }, 'season delete failed')
          return reply.status(500).send({ ok: false, error: 'season_delete_failed' })
        }
      })

      admin.post('/seasons/:seasonId/participants', async (request, reply) => {
        const seasonId = parseNumericId(getParam(request.params, 'seasonId'), 'seasonId')
        const body = request.body as { clubId?: number }
        if (!body?.clubId) {
          return reply.status(400).send({ ok: false, error: 'clubId_required' })
        }
        try {
          const participant = await prisma.seasonParticipant.create({
            data: { seasonId, clubId: body.clubId },
          })
          
          // Инвалидируем кэш таблицы при добавлении участника
          await Promise.all([
            defaultCache.invalidate(PUBLIC_LEAGUE_TABLE_KEY).catch(() => undefined),
            defaultCache.invalidate(`${PUBLIC_LEAGUE_TABLE_KEY}:${seasonId}`).catch(() => undefined),
          ])
          
          return reply.send({ ok: true, data: participant })
        } catch (err) {
          request.server.log.error({ err }, 'season participant create failed')
          return reply.status(409).send({ ok: false, error: 'participant_exists_or_invalid' })
        }
      })

      admin.delete('/seasons/:seasonId/participants/:clubId', async (request, reply) => {
        const seasonId = parseNumericId(getParam(request.params, 'seasonId'), 'seasonId')
        const clubId = parseNumericId(getParam(request.params, 'clubId'), 'clubId')
        const matchPlayed = await prisma.match.findFirst({
          where: { seasonId, OR: [{ homeTeamId: clubId }, { awayTeamId: clubId }] },
        })
        if (matchPlayed) {
          return reply.status(409).send({ ok: false, error: 'club_already_played' })
        }
        await prisma.seasonParticipant.delete({ where: { seasonId_clubId: { seasonId, clubId } } })
        
        // Инвалидируем кэш таблицы при удалении участника
        await Promise.all([
          defaultCache.invalidate(PUBLIC_LEAGUE_TABLE_KEY).catch(() => undefined),
          defaultCache.invalidate(`${PUBLIC_LEAGUE_TABLE_KEY}:${seasonId}`).catch(() => undefined),
        ])
        
        return reply.send({ ok: true })
      })

      admin.post('/seasons/:seasonId/roster', async (request, reply) => {
        const seasonId = parseNumericId(getParam(request.params, 'seasonId'), 'seasonId')
        const body = request.body as {
          clubId?: number
          personId?: number
          shirtNumber?: number
          registrationDate?: string
        }
        if (!body?.clubId || !body?.personId || !body?.shirtNumber) {
          return reply.status(400).send({ ok: false, error: 'roster_fields_required' })
        }
        const person = await prisma.person.findUnique({ where: { id: body.personId } })
        if (!person?.isPlayer) {
          return reply.status(409).send({ ok: false, error: 'person_is_not_player' })
        }
        const entry = await prisma.seasonRoster.create({
          data: {
            seasonId,
            clubId: body.clubId,
            personId: body.personId,
            shirtNumber: body.shirtNumber,
            registrationDate: body.registrationDate ? new Date(body.registrationDate) : new Date(),
          },
        })
        return reply.send({ ok: true, data: entry })
      })

      admin.put('/seasons/:seasonId/roster/:personId', async (request, reply) => {
        const seasonId = parseNumericId(getParam(request.params, 'seasonId'), 'seasonId')
        const personId = parseNumericId(getParam(request.params, 'personId'), 'personId')
        const body = request.body as { clubId?: number; shirtNumber?: number }
        if (!body?.clubId || !body?.shirtNumber) {
          return reply.status(400).send({ ok: false, error: 'club_and_shirt_required' })
        }
        const entry = await prisma.seasonRoster.update({
          where: { seasonId_clubId_personId: { seasonId, clubId: body.clubId, personId } },
          data: { shirtNumber: body.shirtNumber },
        })
        return reply.send({ ok: true, data: entry })
      })

      admin.delete('/seasons/:seasonId/roster/:personId', async (request, reply) => {
        const { clubId: clubQuery } = request.query as { clubId?: string }
        if (!clubQuery) {
          return reply.status(400).send({ ok: false, error: 'clubId_required' })
        }
        const seasonId = parseNumericId(getParam(request.params, 'seasonId'), 'seasonId')
        const personId = parseNumericId(getParam(request.params, 'personId'), 'personId')
        const clubId = parseNumericId(clubQuery, 'clubId')
        await prisma.seasonRoster.delete({
          where: { seasonId_clubId_personId: { seasonId, clubId, personId } },
        })
        return reply.send({ ok: true })
      })

      // Match series management
      admin.get('/series', async (request, reply) => {
        const { seasonId } = request.query as { seasonId?: string }
        const where = seasonId ? { seasonId: Number(seasonId) } : undefined
        const series = await prisma.matchSeries.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }],
          include: { season: true },
        })
        return sendSerialized(reply, series)
      })

      admin.post('/series', async (request, reply) => {
        const body = request.body as {
          seasonId?: number
          stageName?: string
          homeClubId?: number
          awayClubId?: number
        }
        if (!body?.seasonId || !body?.stageName || !body?.homeClubId || !body?.awayClubId) {
          return reply.status(400).send({ ok: false, error: 'series_fields_required' })
        }
        const series = await prisma.matchSeries.create({
          data: {
            seasonId: body.seasonId,
            stageName: body.stageName.trim(),
            homeClubId: body.homeClubId,
            awayClubId: body.awayClubId,
            seriesStatus: SeriesStatus.IN_PROGRESS,
          },
        })
        return sendSerialized(reply, series)
      })

      admin.put('/series/:seriesId', async (request, reply) => {
        const seriesId = parseBigIntId(getParam(request.params, 'seriesId'), 'seriesId')
        const body = request.body as { seriesStatus?: SeriesStatus; winnerClubId?: number }
        const series = await prisma.matchSeries.update({
          where: { id: seriesId },
          data: {
            seriesStatus: body.seriesStatus,
            winnerClubId: body.winnerClubId,
          },
        })
        return sendSerialized(reply, series)
      })

      admin.delete('/series/:seriesId', async (request, reply) => {
        const seriesId = parseBigIntId(getParam(request.params, 'seriesId'), 'seriesId')
        const hasMatches = await prisma.match.findFirst({ where: { seriesId } })
        if (hasMatches) {
          return reply.status(409).send({ ok: false, error: 'series_has_matches' })
        }
        await prisma.matchSeries.delete({ where: { id: seriesId } })
        return reply.send({ ok: true })
      })

      // Matches
      admin.get('/matches', async (request, reply) => {
        const { seasonId, competitionId } = request.query as {
          seasonId?: string
          competitionId?: string
        }

        const where: Prisma.MatchWhereInput = { isFriendly: false }
        if (seasonId) {
          where.seasonId = Number(seasonId)
        }
        if (competitionId) {
          where.season = { competitionId: Number(competitionId) }
        }

        const matches = await prisma.match.findMany({
          where,
          orderBy: [{ matchDateTime: 'desc' }],
          include: {
            season: { select: { name: true, competitionId: true } },
            series: true,
            stadium: true,
            round: true,
          },
        })
        return sendSerialized(reply, matches)
      })

      admin.patch<{ Params: { matchId: string }; Body: PredictionTemplateOverrideBody }>(
        '/matches/:matchId/prediction-template',
        async (request, reply) => {
          const matchId = parseBigIntId(request.params.matchId, 'matchId')
          const body = request.body ?? {}
          const marketType = body.marketType ?? PredictionMarketType.TOTAL_GOALS

          if (marketType !== PredictionMarketType.TOTAL_GOALS) {
            return reply.status(400).send({ ok: false, error: 'unsupported_market_type' })
          }

          const mode = body.mode
          if (mode !== 'auto' && mode !== 'manual') {
            return reply.status(400).send({ ok: false, error: 'mode_required' })
          }

          const match = await prisma.match.findUnique({
            where: { id: matchId },
            select: { id: true, status: true },
          })

          if (!match) {
            return reply.status(404).send({ ok: false, error: 'match_not_found' })
          }

          if (match.status !== MatchStatus.SCHEDULED) {
            return reply.status(409).send({ ok: false, error: 'match_locked_for_predictions' })
          }

          let template = await prisma.predictionTemplate.findFirst({
            where: { matchId, marketType },
            select: PREDICTION_TEMPLATE_SELECT,
          })

          if (!template) {
            await ensurePredictionTemplatesForMatch(matchId, prisma)
            template = await prisma.predictionTemplate.findFirst({
              where: { matchId, marketType },
              select: PREDICTION_TEMPLATE_SELECT,
            })
          }

          if (!template) {
            return reply
              .status(500)
              .send({ ok: false, error: 'prediction_template_unavailable' })
          }

          const publishTopic =
            typeof admin.publishTopic === 'function' ? admin.publishTopic.bind(admin) : undefined
          const matchIdString = matchId.toString()

          if (mode === 'auto') {
            await prisma.predictionTemplate.update({
              where: { id: template.id },
              data: { isManual: false, createdBy: null },
            })

            const summary = await ensurePredictionTemplatesForMatch(matchId, prisma)
            const summaryView = serializePredictionTemplateEnsureSummary(summary)

            const refreshed = await prisma.predictionTemplate.findUnique({
              where: { id: template.id },
              select: PREDICTION_TEMPLATE_SELECT,
            })

            const suggestion = await suggestTotalGoalsLineForMatch(matchId, prisma)
            const suggestionView = serializeTotalGoalsSuggestion(suggestion)
            const refreshedSource = refreshed ?? template
            const view = serializePredictionTemplateForAdmin(refreshedSource)
            const overrideData: PredictionTemplateOverrideView = {
              mode: 'auto',
              template: view,
              summary: summaryView,
              suggestion: suggestionView,
            }

            if (publishTopic) {
              await publishTopic('admin.predictions', {
                type: 'prediction.template.override',
                payload: {
                  matchId: matchIdString,
                  override: overrideData,
                },
              })
            }

            return reply.send({
              ok: true,
              data: overrideData,
            })
          }

          const rawLineInput = body.line
          const normalizedLineInput =
            rawLineInput === undefined
              ? Number.NaN
              : typeof rawLineInput === 'string'
                ? Number(rawLineInput.replace(',', '.'))
                : Number(rawLineInput)

          if (!Number.isFinite(normalizedLineInput)) {
            return reply.status(400).send({ ok: false, error: 'line_required' })
          }

          const clampedLine = Number(formatTotalLine(normalizedLineInput))
          if (
            Number.isNaN(clampedLine) ||
            clampedLine < PREDICTION_TOTAL_MIN_LINE ||
            clampedLine > PREDICTION_TOTAL_MAX_LINE
          ) {
            return reply.status(400).send({ ok: false, error: 'line_out_of_range' })
          }

          const basePointsCandidate =
            body.basePoints !== undefined
              ? Number(body.basePoints)
              : template.basePoints ?? PREDICTION_TOTAL_GOALS_BASE_POINTS

          if (!Number.isFinite(basePointsCandidate) || basePointsCandidate < 0) {
            return reply.status(400).send({ ok: false, error: 'base_points_invalid' })
          }

          const basePoints = Math.trunc(basePointsCandidate)
          if (basePoints < 0 || basePoints > 1000) {
            return reply.status(400).send({ ok: false, error: 'base_points_out_of_range' })
          }

          const difficultyCandidate =
            body.difficultyMultiplier !== undefined
              ? Number(body.difficultyMultiplier)
              : decimalToNumber(template.difficultyMultiplier)

          if (!Number.isFinite(difficultyCandidate) || difficultyCandidate <= 0) {
            return reply.status(400).send({ ok: false, error: 'difficulty_invalid' })
          }

          const difficultyMultiplier = Number(difficultyCandidate)
          if (difficultyMultiplier <= 0 || difficultyMultiplier > 10) {
            return reply.status(400).send({ ok: false, error: 'difficulty_out_of_range' })
          }

          const manualOptions = buildManualTotalGoalsOptions(clampedLine)

          const updated = await prisma.predictionTemplate.update({
            where: { id: template.id },
            data: {
              options: manualOptions,
              basePoints,
              difficultyMultiplier,
              isManual: true,
              createdBy: request.admin?.sub ?? 'admin',
            },
            select: PREDICTION_TEMPLATE_SELECT,
          })

          await invalidateUpcomingPredictionCaches()

          const suggestion = await suggestTotalGoalsLineForMatch(matchId, prisma)
          const suggestionView = serializeTotalGoalsSuggestion(suggestion)
          const view = serializePredictionTemplateForAdmin(updated)
          const overrideData: PredictionTemplateOverrideView = {
            mode: 'manual',
            template: view,
            suggestion: suggestionView,
          }

          if (publishTopic) {
            await publishTopic('admin.predictions', {
              type: 'prediction.template.override',
              payload: {
                matchId: matchIdString,
                override: overrideData,
              },
            })
          }

          return reply.send({
            ok: true,
            data: overrideData,
          })
        }
      )


      admin.patch<{ Params: { seasonId: string } }>('/seasons/:seasonId/activate', async (request, reply) => {
        const rawSeasonId = request.params?.seasonId
        const seasonId = Number(rawSeasonId)
        if (!Number.isFinite(seasonId) || seasonId <= 0) {
          return reply.status(400).send({ ok: false, error: 'season_invalid' })
        }

        const season = await prisma.season.findUnique({
          where: { id: seasonId },
          include: { competition: true },
        })

        if (!season) {
          return reply.status(404).send({ ok: false, error: 'season_not_found' })
        }

        let previousActiveSeasonId: number | null = null
        await prisma.$transaction(async tx => {
          const previousActive = await tx.season.findFirst({
            where: { isActive: true },
            select: { id: true },
          })
          previousActiveSeasonId = previousActive?.id ?? null
          await tx.season.updateMany({ where: { isActive: true }, data: { isActive: false } })
          await tx.season.update({ where: { id: seasonId }, data: { isActive: true } })
        })

        const activatedSeason = { ...season, isActive: true }
        const table = await buildLeagueTable(activatedSeason)

        await defaultCache.invalidate(PUBLIC_LEAGUE_SEASONS_KEY)
        await defaultCache.invalidate(PUBLIC_LEAGUE_TABLE_KEY)
        await defaultCache.invalidate(`${PUBLIC_LEAGUE_TABLE_KEY}:${seasonId}`)
        await defaultCache.invalidate(PUBLIC_LEAGUE_SCHEDULE_KEY)
        await defaultCache.invalidate(`${PUBLIC_LEAGUE_SCHEDULE_KEY}:${seasonId}`)
        await defaultCache.invalidate(PUBLIC_LEAGUE_RESULTS_KEY)
        await defaultCache.invalidate(`${PUBLIC_LEAGUE_RESULTS_KEY}:${seasonId}`)
        if (previousActiveSeasonId && previousActiveSeasonId !== seasonId) {
          await defaultCache.invalidate(`${PUBLIC_LEAGUE_TABLE_KEY}:${previousActiveSeasonId}`)
          await defaultCache.invalidate(
            `${PUBLIC_LEAGUE_SCHEDULE_KEY}:${previousActiveSeasonId}`
          )
          await defaultCache.invalidate(
            `${PUBLIC_LEAGUE_RESULTS_KEY}:${previousActiveSeasonId}`
          )
        }
        await defaultCache.set(PUBLIC_LEAGUE_TABLE_KEY, table, PUBLIC_LEAGUE_TABLE_TTL_SECONDS)
        await defaultCache.set(
          `${PUBLIC_LEAGUE_TABLE_KEY}:${seasonId}`,
          table,
          PUBLIC_LEAGUE_TABLE_TTL_SECONDS
        )

        const publishTopic =
          typeof admin.publishTopic === 'function' ? admin.publishTopic.bind(admin) : undefined

        await refreshLeagueMatchAggregates(seasonId, { publishTopic })

        if (typeof admin.publishTopic === 'function') {
          try {
            await admin.publishTopic(PUBLIC_LEAGUE_TABLE_KEY, {
              type: 'league.table',
              seasonId: table.season.id,
              payload: table,
            })
          } catch (err) {
            admin.log.warn({ err }, 'failed to broadcast league table update')
          }
        }

        return sendSerialized(reply, {
          seasonId: table.season.id,
          season: activatedSeason,
          table,
        })
      })
      admin.post('/matches', async (request, reply) => {
        const body = request.body as {
          seasonId?: number
          seriesId?: bigint
          seriesMatchNumber?: number
          matchDateTime?: string
          homeTeamId?: number
          awayTeamId?: number
          stadiumId?: number
          refereeId?: number
          roundId?: number | null
        }
        if (!body?.seasonId || !body?.matchDateTime || !body?.homeTeamId || !body?.awayTeamId) {
          return reply.status(400).send({ ok: false, error: 'match_fields_required' })
        }
        const match = await prisma.match.create({
          data: {
            seasonId: body.seasonId,
            seriesId: body.seriesId ?? null,
            seriesMatchNumber: body.seriesMatchNumber ?? null,
            matchDateTime: new Date(body.matchDateTime),
            homeTeamId: body.homeTeamId,
            awayTeamId: body.awayTeamId,
            stadiumId: body.stadiumId ?? null,
            refereeId: body.refereeId ?? null,
            roundId: body.roundId ?? null,
            status: MatchStatus.SCHEDULED,
          },
        })

        const publishTopic =
          typeof admin.publishTopic === 'function' ? admin.publishTopic.bind(admin) : undefined

        if (match.seasonId != null) {
          try {
            await refreshLeagueMatchAggregates(match.seasonId, { publishTopic })
          } catch (err) {
            admin.log.warn(
              { err, seasonId: match.seasonId },
              'failed to refresh league aggregates after match create'
            )
          }
        }

        try {
          await ensurePredictionTemplatesForMatch(match.id, prisma)
        } catch (err) {
          admin.log.warn(
            { err, matchId: match.id.toString() },
            'failed to ensure prediction templates after match create'
          )
        }

        return sendSerialized(reply, match)
      })

      admin.get('/friendly-matches', async (_request, reply) => {
        const friendlyMatches = await prisma.match.findMany({
          where: { isFriendly: true },
          orderBy: [{ matchDateTime: 'desc' }],
          include: {
            homeClub: {
              select: { id: true, name: true, shortName: true, logoUrl: true },
            },
            awayClub: {
              select: { id: true, name: true, shortName: true, logoUrl: true },
            },
            stadium: true,
            referee: true,
            season: { select: { id: true, name: true } },
          },
        })
        return sendSerialized(reply, friendlyMatches)
      })

      admin.post('/friendly-matches', async (request, reply) => {
        const body = request.body as {
          matchDateTime?: string
          homeClubId?: number
          awayClubId?: number
          seasonId?: number | null
          stadiumId?: number
          refereeId?: number
          eventName?: string
        }

        const matchDate = body?.matchDateTime ? new Date(body.matchDateTime) : null
        if (!matchDate || Number.isNaN(matchDate.getTime())) {
          return reply.status(400).send({ ok: false, error: 'friendly_match_fields_required' })
        }

        if (typeof body?.homeClubId !== 'number' || typeof body?.awayClubId !== 'number') {
          return reply.status(400).send({ ok: false, error: 'friendly_match_fields_required' })
        }

        const homeClubId = parseNumericId(body.homeClubId, 'homeClubId')
        const awayClubId = parseNumericId(body.awayClubId, 'awayClubId')

        if (homeClubId === awayClubId) {
          return reply.status(400).send({ ok: false, error: 'friendly_match_same_teams' })
        }

        const seasonId =
          typeof body?.seasonId === 'number' ? parseNumericId(body.seasonId, 'seasonId') : null
        const stadiumId = body?.stadiumId ? parseNumericId(body.stadiumId, 'stadiumId') : null
        const refereeId = body?.refereeId ? parseNumericId(body.refereeId, 'refereeId') : null
        const eventName = body?.eventName?.trim()

        const friendlyMatch = await prisma.match.create({
          data: {
            seasonId,
            matchDateTime: matchDate,
            homeTeamId: homeClubId,
            awayTeamId: awayClubId,
            stadiumId,
            refereeId,
            status: MatchStatus.SCHEDULED,
            eventName: eventName && eventName.length ? eventName : null,
            isFriendly: true,
          },
          include: {
            homeClub: {
              select: { id: true, name: true, shortName: true, logoUrl: true },
            },
            awayClub: {
              select: { id: true, name: true, shortName: true, logoUrl: true },
            },
            stadium: true,
            referee: true,
            season: { select: { id: true, name: true } },
          },
        })

        const publishTopic =
          typeof admin.publishTopic === 'function' ? admin.publishTopic.bind(admin) : undefined

        try {
          await refreshFriendlyAggregates({ publishTopic })
        } catch (err) {
          admin.log.warn({ err }, 'failed to refresh friendlies after create')
        }

        try {
          await ensurePredictionTemplatesForMatch(friendlyMatch.id, prisma)
        } catch (err) {
          admin.log.warn(
            { err, matchId: friendlyMatch.id.toString() },
            'failed to ensure prediction templates after friendly match create'
          )
        }

        return sendSerialized(reply, friendlyMatch)
      })

      admin.delete('/friendly-matches/:matchId', async (request, reply) => {
        const matchId = parseBigIntId(getParam(request.params, 'matchId'), 'matchId')
        const existing = await prisma.match.findUnique({
          where: { id: matchId },
          select: { id: true, isFriendly: true },
        })
        if (!existing || !existing.isFriendly) {
          return reply.status(404).send({ ok: false, error: 'friendly_match_not_found' })
        }
        await prisma.match.delete({ where: { id: matchId } })

        const publishTopic =
          typeof admin.publishTopic === 'function' ? admin.publishTopic.bind(admin) : undefined

        try {
          await refreshFriendlyAggregates({ publishTopic })
        } catch (err) {
          admin.log.warn({ err, matchId: matchId.toString() }, 'failed to refresh friendlies after delete')
        }

        return reply.send({ ok: true })
      })

      admin.put('/matches/:matchId', async (request, reply) => {
        const matchId = parseBigIntId(getParam(request.params, 'matchId'), 'matchId')
        const body = request.body as Partial<{
          matchDateTime: string
          homeScore: number
          awayScore: number
          status: MatchStatus
          stadiumId: number | null
          refereeId: number | null
          roundId: number | null
          isArchived: boolean
          hasPenaltyShootout: boolean
          penaltyHomeScore: number
          penaltyAwayScore: number
          broadcastUrl: string | null
        }>

        const existing = await prisma.match.findUnique({
          where: { id: matchId },
          include: {
            season: {
              include: {
                competition: true,
              },
            },
          },
        })
        if (!existing) {
          return reply.status(404).send({ ok: false, error: 'match_not_found' })
        }

        const nextStatus = body.status ?? existing.status
        const scoreUpdateRequested = body.homeScore !== undefined || body.awayScore !== undefined
        const existingFinished = existing.status === MatchStatus.FINISHED
        const finishingNow = nextStatus === MatchStatus.FINISHED && !existingFinished
        const scoreUpdateAllowed = nextStatus === MatchStatus.LIVE || finishingNow

        if (scoreUpdateRequested && !scoreUpdateAllowed) {
          return reply
            .status(409)
            .send({
              ok: false,
              error: 'Изменение счёта доступно только при статусе «Идёт» до финального сохранения',
            })
        }

        const data: Prisma.MatchUncheckedUpdateInput = {
          matchDateTime: body.matchDateTime ? new Date(body.matchDateTime) : undefined,
          status: body.status ?? undefined,
          stadiumId: body.stadiumId ?? undefined,
          refereeId: body.refereeId ?? undefined,
          roundId: body.roundId ?? undefined,
          isArchived: typeof body.isArchived === 'boolean' ? body.isArchived : undefined,
        }

        let broadcastUrlUpdate: string | null | undefined
        if (body.broadcastUrl !== undefined) {
          const candidate =
            typeof body.broadcastUrl === 'string' ? body.broadcastUrl : ''
          const normalized = normalizeBroadcastUrl(candidate)
          if (normalized === null) {
            return reply.status(400).send({ ok: false, error: 'broadcast_url_invalid' })
          }
          broadcastUrlUpdate = normalized === '' ? null : normalized
          data.broadcastUrl = broadcastUrlUpdate
        }

        const normalizeScore = (value: number | undefined, fallback: number | null): number => {
          if (value === undefined) {
            return Math.max(0, fallback ?? 0)
          }
          return Math.max(0, Math.trunc(value))
        }

        const shouldApplyScore = scoreUpdateRequested && scoreUpdateAllowed
        const appliedHomeScore = shouldApplyScore
          ? normalizeScore(body.homeScore, existing.homeScore)
          : existing.homeScore
        const appliedAwayScore = shouldApplyScore
          ? normalizeScore(body.awayScore, existing.awayScore)
          : existing.awayScore

        if (shouldApplyScore) {
          data.homeScore = appliedHomeScore
          data.awayScore = appliedAwayScore
        }

        const parsePenaltyScore = (value: unknown, fallback: number): number => {
          if (value === undefined || value === null || value === '') {
            return Math.max(0, fallback)
          }
          const numeric = typeof value === 'number' ? value : Number(value)
          if (!Number.isFinite(numeric) || numeric < 0) {
            throw new Error('penalty_scores_invalid')
          }
          return Math.max(0, Math.trunc(numeric))
        }

        const competition = existing.season?.competition
        // Пенальти доступны для:
        // 1. LEAGUE с форматом BEST_OF_N или DOUBLE_ROUND_PLAYOFF (серия матчей)
        // 2. CUP с форматом GROUP_SINGLE_ROUND_PLAYOFF (плей-офф кубка)
        const isLeagueSeries =
          competition?.type === CompetitionType.LEAGUE &&
          (competition.seriesFormat === SeriesFormat.BEST_OF_N ||
            competition.seriesFormat === SeriesFormat.DOUBLE_ROUND_PLAYOFF)
        const isCupPlayoff =
          competition?.type === CompetitionType.CUP &&
          competition.seriesFormat === SeriesFormat.GROUP_SINGLE_ROUND_PLAYOFF
        const canHavePenaltyShootout = isLeagueSeries || isCupPlayoff

        const penaltyToggleRequested = body.hasPenaltyShootout !== undefined
        const penaltyScoreProvided =
          body.penaltyHomeScore !== undefined || body.penaltyAwayScore !== undefined
        const targetHasPenaltyShootout = penaltyToggleRequested
          ? Boolean(body.hasPenaltyShootout)
          : existing.hasPenaltyShootout

        let penaltyHomeScore = existing.penaltyHomeScore
        let penaltyAwayScore = existing.penaltyAwayScore

        if (targetHasPenaltyShootout) {
          if (!existing.seriesId || !canHavePenaltyShootout) {
            return reply.status(409).send({ ok: false, error: 'penalty_shootout_not_available' })
          }

          if (appliedHomeScore !== appliedAwayScore) {
            return reply.status(409).send({ ok: false, error: 'penalty_requires_draw' })
          }

          try {
            penaltyHomeScore = parsePenaltyScore(body.penaltyHomeScore, penaltyHomeScore)
            penaltyAwayScore = parsePenaltyScore(body.penaltyAwayScore, penaltyAwayScore)
          } catch (err) {
            return reply.status(400).send({ ok: false, error: 'penalty_scores_invalid' })
          }

          if (penaltyHomeScore === penaltyAwayScore) {
            return reply.status(409).send({ ok: false, error: 'penalty_scores_required' })
          }
        } else if (penaltyToggleRequested || existing.hasPenaltyShootout || penaltyScoreProvided) {
          penaltyHomeScore = 0
          penaltyAwayScore = 0
        }

        data.hasPenaltyShootout = targetHasPenaltyShootout
        data.penaltyHomeScore = targetHasPenaltyShootout ? penaltyHomeScore : 0
        data.penaltyAwayScore = targetHasPenaltyShootout ? penaltyAwayScore : 0

        const updated = await prisma.match.update({
          where: { id: matchId },
          data,
        })

        if (
          broadcastUrlUpdate !== undefined &&
          (existing.broadcastUrl ?? null) !== (broadcastUrlUpdate ?? null)
        ) {
          await defaultCache.invalidate(matchBroadcastCacheKey(matchId)).catch(() => undefined)
        }

        const publishTopic =
          typeof request.server.publishTopic === 'function'
            ? request.server.publishTopic.bind(request.server)
            : undefined

        // Инвалидируем кэш расписания и результатов при смене статуса матча
        // чтобы клиенты получили актуальные данные вместо 304 Not Modified
        const statusChanged = body.status !== undefined && body.status !== existing.status
        if (statusChanged && existing.seasonId != null) {
          await Promise.all([
            defaultCache.invalidate(PUBLIC_LEAGUE_SCHEDULE_KEY).catch(() => undefined),
            defaultCache.invalidate(`${PUBLIC_LEAGUE_SCHEDULE_KEY}:${existing.seasonId}`).catch(() => undefined),
            defaultCache.invalidate(PUBLIC_LEAGUE_RESULTS_KEY).catch(() => undefined),
            defaultCache.invalidate(`${PUBLIC_LEAGUE_RESULTS_KEY}:${existing.seasonId}`).catch(() => undefined),
          ])
        }

        if (
          existing.seasonId != null &&
          (nextStatus !== MatchStatus.FINISHED || existing.status === MatchStatus.FINISHED)
        ) {
          try {
            await refreshLeagueMatchAggregates(existing.seasonId, { publishTopic })
          } catch (err) {
            request.server.log.warn(
              { err, matchId: matchId.toString(), seasonId: existing.seasonId },
              'failed to refresh league aggregates after match update'
            )
          }
        }

        if (existing.isFriendly) {
          try {
            await refreshFriendlyAggregates({ publishTopic })
          } catch (err) {
            request.server.log.warn(
              { err, matchId: matchId.toString() },
              'failed to refresh friendlies after match update'
            )
          }
        }

        if (body.status === MatchStatus.FINISHED && existing.status !== MatchStatus.FINISHED) {
          console.log('[SETTLEMENT DEBUG] Admin triggering handleMatchFinalization for matchId:', matchId.toString())
          try {
            await handleMatchFinalization(matchId, request.server.log, { publishTopic })
          } catch (err) {
            request.server.log.error(
              { err, matchId: matchId.toString() },
              'failed to finalize match after status update'
            )
            // Матч уже обновлён в БД, не возвращаем ошибку пользователю
          }

          // Планируем уведомления о завершении матча для подписчиков
          try {
            const scheduledCount = await scheduleMatchEndNotifications(matchId)
            if (scheduledCount > 0) {
              request.server.log.info(
                { matchId: matchId.toString(), scheduledCount },
                'scheduled match end notifications'
              )
            }
          } catch (err) {
            request.server.log.warn(
              { err, matchId: matchId.toString() },
              'failed to schedule match end notifications'
            )
          }
        }

        // Планируем уведомления о начале матча при переходе в LIVE
        if (body.status === MatchStatus.LIVE && existing.status !== MatchStatus.LIVE) {
          try {
            const scheduledCount = await scheduleMatchStartNotifications(matchId)
            if (scheduledCount > 0) {
              request.server.log.info(
                { matchId: matchId.toString(), scheduledCount },
                'scheduled match start notifications'
              )
            }
          } catch (err) {
            request.server.log.warn(
              { err, matchId: matchId.toString() },
              'failed to schedule match start notifications'
            )
          }
        }

        if (nextStatus === MatchStatus.SCHEDULED) {
          try {
            await ensurePredictionTemplatesForMatch(matchId, prisma)
          } catch (err) {
            request.server.log.warn(
              { err, matchId: matchId.toString() },
              'failed to ensure prediction templates after match update'
            )
          }
        }

        return sendSerialized(reply, updated)
      })

      admin.delete('/matches/:matchId', async (request, reply) => {
        const matchId = parseBigIntId(getParam(request.params, 'matchId'), 'matchId')
        const match = await prisma.match.findUnique({ where: { id: matchId } })
        if (!match) return reply.status(404).send({ ok: false, error: 'match_not_found' })
        if (match.status === MatchStatus.FINISHED) {
          return reply.status(409).send({ ok: false, error: 'finished_match_locked' })
        }
        await prisma.match.delete({ where: { id: matchId } })

        const publishTopic =
          typeof request.server.publishTopic === 'function'
            ? request.server.publishTopic.bind(request.server)
            : undefined

        if (match.seasonId != null) {
          try {
            await refreshLeagueMatchAggregates(match.seasonId, { publishTopic })
          } catch (err) {
            request.server.log.warn(
              { err, matchId: matchId.toString(), seasonId: match.seasonId },
              'failed to refresh league aggregates after match delete'
            )
          }
        }

        if (match.isFriendly) {
          try {
            await refreshFriendlyAggregates({ publishTopic })
          } catch (err) {
            request.server.log.warn(
              { err, matchId: matchId.toString() },
              'failed to refresh friendlies after match delete'
            )
          }
        }

        return reply.send({ ok: true })
      })

      // Re-settle predictions for a finished match
      admin.post('/matches/:matchId/resettle', async (request, reply) => {
        const matchId = parseBigIntId(getParam(request.params, 'matchId'), 'matchId')
        const match = await prisma.match.findUnique({
          where: { id: matchId },
          select: { id: true, status: true, seasonId: true }
        })
        
        if (!match) {
          return reply.status(404).send({ ok: false, error: 'match_not_found' })
        }
        
        if (match.status !== MatchStatus.FINISHED) {
          return reply.status(409).send({ ok: false, error: 'match_not_finished' })
        }

        const publishTopic =
          typeof request.server.publishTopic === 'function'
            ? request.server.publishTopic.bind(request.server)
            : undefined

        try {
          await handleMatchFinalization(matchId, request.server.log, { publishTopic })
          request.server.log.info(
            { matchId: matchId.toString() },
            'admin: re-settlement completed'
          )
          return reply.send({ ok: true, message: 'Settlement re-run successfully' })
        } catch (err) {
          request.server.log.error(
            { err, matchId: matchId.toString() },
            'admin: re-settlement failed'
          )
          return reply.status(500).send({ ok: false, error: 'settlement_failed' })
        }
      })

      // Lineups
      admin.get('/matches/:matchId/lineup', async (request, reply) => {
        const matchId = parseBigIntId(getParam(request.params, 'matchId'), 'matchId')
        try {
          const enriched = await loadMatchLineupWithNumbers(matchId)
          return sendSerialized(reply, enriched)
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          request.log.error({ err, matchId: matchId.toString() }, 'match lineup fetch failed')
          return reply.status(500).send({ ok: false, error: 'match_lineup_failed' })
        }
      })

      admin.put('/matches/:matchId/lineup', async (request, reply) => {
        const matchId = parseBigIntId(getParam(request.params, 'matchId'), 'matchId')
        const body = request.body as {
          personId?: number
          clubId?: number
          role?: LineupRole
          position?: string
        }
        if (!body?.personId || !body?.clubId || !body?.role) {
          return reply.status(400).send({ ok: false, error: 'lineup_fields_required' })
        }
        const entry = await prisma.matchLineup.upsert({
          where: { matchId_personId: { matchId, personId: body.personId } },
          create: {
            matchId,
            personId: body.personId,
            clubId: body.clubId,
            role: body.role,
            position: body.position ?? null,
          },
          update: {
            clubId: body.clubId,
            role: body.role,
            position: body.position ?? null,
          },
        })
        return sendSerialized(reply, entry)
      })

      admin.delete('/matches/:matchId/lineup/:personId', async (request, reply) => {
        const matchId = parseBigIntId(getParam(request.params, 'matchId'), 'matchId')
        const personId = parseNumericId(getParam(request.params, 'personId'), 'personId')
        await prisma.matchLineup.delete({ where: { matchId_personId: { matchId, personId } } })
        return reply.send({ ok: true })
      })

      admin.get('/matches/:matchId/statistics', async (request, reply) => {
        const matchId = parseBigIntId(getParam(request.params, 'matchId'), 'matchId')
        try {
          const { value, version } = await getMatchStatisticsWithMeta(matchId)
          const serialized = serializePrisma(value)
          reply.header('X-Resource-Version', String(version))
          return reply.send({ ok: true, data: serialized, meta: { version } })
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          request.server.log.error(
            { err, matchId: matchId.toString() },
            'match statistics fetch failed'
          )
          return reply.status(500).send({ ok: false, error: 'match_statistics_failed' })
        }
      })

      admin.post('/matches/:matchId/statistics/adjust', async (request, reply) => {
        const matchId = parseBigIntId(getParam(request.params, 'matchId'), 'matchId')
        const body = request.body as {
          clubId?: number
          metric?: string
          delta?: number
        }

        const clubId = body?.clubId !== undefined ? parseNumericId(body.clubId, 'clubId') : null
        if (!clubId) {
          return reply.status(400).send({ ok: false, error: 'clubId_required' })
        }

        const metric = body?.metric as MatchStatisticMetric | undefined
        if (!metric || !matchStatisticMetrics.includes(metric)) {
          return reply.status(400).send({ ok: false, error: 'metric_invalid' })
        }

        const rawDelta = body?.delta
        if (
          typeof rawDelta !== 'number' ||
          Number.isNaN(rawDelta) ||
          !Number.isFinite(rawDelta) ||
          rawDelta === 0
        ) {
          return reply.status(400).send({ ok: false, error: 'delta_invalid' })
        }
        const delta = Math.max(-20, Math.min(20, Math.trunc(rawDelta)))

        const now = new Date()
        await cleanupExpiredMatchStatistics(now).catch(() => undefined)

        const match = await prisma.match.findUnique({
          where: { id: matchId },
          select: {
            id: true,
            homeTeamId: true,
            awayTeamId: true,
            status: true,
            matchDateTime: true,
          },
        })

        if (!match) {
          return reply.status(404).send({ ok: false, error: 'match_not_found' })
        }

        if (hasMatchStatisticsExpired(match.matchDateTime, now)) {
          await prisma.matchStatistic.deleteMany({ where: { matchId } }).catch(() => undefined)
          await defaultCache.invalidate(matchStatsCacheKey(matchId)).catch(() => undefined)
          return reply
            .status(409)
            .send({ ok: false, error: 'Статистика матча устарела и была удалена' })
        }

        if (clubId !== match.homeTeamId && clubId !== match.awayTeamId) {
          return reply.status(400).send({ ok: false, error: 'club_not_in_match' })
        }

        let adjusted = false
        try {
          adjusted = await prisma.$transaction(tx =>
            applyStatisticDelta(tx, matchId, clubId, metric, delta)
          )
        } catch (err) {
          request.server.log.error(
            { err, matchId: matchId.toString(), clubId, metric, delta },
            'match statistic adjust failed'
          )
          return reply.status(500).send({ ok: false, error: 'match_statistics_update_failed' })
        }

        if (adjusted) {
          try {
            const { serialized, version } = await broadcastMatchStatistics(request.server, matchId)
            reply.header('X-Resource-Version', String(version))
            return reply.send({ ok: true, data: serialized, meta: { version } })
          } catch (err) {
            if (err instanceof RequestError) {
              return reply.status(err.statusCode).send({ ok: false, error: err.message })
            }
            request.server.log.error(
              { err, matchId: matchId.toString() },
              'match statistics reload failed'
            )
            return reply.status(500).send({ ok: false, error: 'match_statistics_failed' })
          }
        }

        try {
          const { value, version } = await getMatchStatisticsWithMeta(matchId)
          const serialized = serializePrisma(value)
          reply.header('X-Resource-Version', String(version))
          return reply.send({ ok: true, data: serialized, meta: { version } })
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          request.server.log.error(
            { err, matchId: matchId.toString() },
            'match statistics reload failed'
          )
          return reply.status(500).send({ ok: false, error: 'match_statistics_failed' })
        }
      })

      // Events
      admin.get('/matches/:matchId/events', async (request, reply) => {
        const matchId = parseBigIntId(getParam(request.params, 'matchId'), 'matchId')
        const match = await prisma.match.findUnique({
          where: { id: matchId },
          select: { seasonId: true },
        })
        if (!match) {
          return reply.status(404).send({ ok: false, error: 'match_not_found' })
        }

        const events = await prisma.matchEvent.findMany({
          where: { matchId },
          orderBy: [{ minute: 'asc' }, { id: 'asc' }],
          include: {
            player: true,
            relatedPerson: true,
            team: true,
          },
        })

        if (events.length === 0) {
          return sendSerialized(reply, events)
        }

        const personIds = new Set<number>()
        for (const event of events) {
          personIds.add(event.playerId)
          if (event.relatedPlayerId) {
            personIds.add(event.relatedPlayerId)
          }
        }

        const rosterNumbers =
          match.seasonId != null && personIds.size
            ? await prisma.seasonRoster.findMany({
                where: {
                  seasonId: match.seasonId,
                  personId: { in: Array.from(personIds) },
                },
                select: { personId: true, shirtNumber: true },
              })
            : []

        const shirtMap = new Map<number, number>()
        rosterNumbers.forEach(entry => {
          shirtMap.set(entry.personId, entry.shirtNumber)
        })

        const enriched = events.map(event => {
          const playerShirt = shirtMap.get(event.playerId) ?? null
          const relatedShirt = event.relatedPlayerId
            ? (shirtMap.get(event.relatedPlayerId) ?? null)
            : null
          return {
            ...event,
            player: {
              ...event.player,
              shirtNumber: playerShirt,
            },
            relatedPerson: event.relatedPerson
              ? {
                  ...event.relatedPerson,
                  shirtNumber: relatedShirt,
                }
              : event.relatedPerson,
          }
        })

        return sendSerialized(reply, enriched)
      })

      admin.post('/matches/:matchId/events', async (request, reply) => {
        const matchId = parseBigIntId(getParam(request.params, 'matchId'), 'matchId')
        const body = request.body as {
          playerId?: number
          teamId?: number
          minute?: number
          eventType?: MatchEventType
          relatedPlayerId?: number | null
        }
        if (!body?.playerId || !body?.teamId || !body?.minute || !body?.eventType) {
          return reply.status(400).send({ ok: false, error: 'event_fields_required' })
        }

        let created: { event: MatchEvent; statAdjusted: boolean }
        try {
          created = await createMatchEvent(matchId, {
            playerId: body.playerId,
            teamId: body.teamId,
            minute: body.minute,
            eventType: body.eventType,
            relatedPlayerId: body.relatedPlayerId ?? null,
          })
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          request.server.log.error(
            { err, matchId: matchId.toString() },
            'match event create failed'
          )
          return reply.status(500).send({ ok: false, error: 'event_create_failed' })
        }

        if (created.statAdjusted) {
          await broadcastMatchStatistics(request.server, matchId).catch(err => {
            request.server.log.error(
              { err, matchId: matchId.toString() },
              'match statistics broadcast failed'
            )
          })
        }

        const match = await prisma.match.findUnique({ where: { id: matchId } })
        if (match?.status === MatchStatus.FINISHED) {
          const publishTopic =
            typeof request.server.publishTopic === 'function'
              ? request.server.publishTopic.bind(request.server)
              : undefined
          await handleMatchFinalization(matchId, request.server.log, { publishTopic })
        }

        return sendSerialized(reply, created.event)
      })

      admin.put('/matches/:matchId/events/:eventId', async (request, reply) => {
        const matchId = parseBigIntId(getParam(request.params, 'matchId'), 'matchId')
        const eventId = parseBigIntId(getParam(request.params, 'eventId'), 'eventId')
        const body = request.body as Partial<{
          minute: number
          eventType: MatchEventType
          teamId: number
          playerId: number
          relatedPlayerId: number | null
        }>

        let updated: { event: MatchEvent; statAdjusted: boolean }
        try {
          updated = await updateMatchEvent(matchId, eventId, {
            minute: body.minute,
            eventType: body.eventType,
            teamId: body.teamId,
            playerId: body.playerId,
            relatedPlayerId: body.relatedPlayerId,
          })
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          request.server.log.error(
            { err, matchId: matchId.toString(), eventId: eventId.toString() },
            'match event update failed'
          )
          return reply.status(500).send({ ok: false, error: 'event_update_failed' })
        }

        if (updated.statAdjusted) {
          await broadcastMatchStatistics(request.server, matchId).catch(err => {
            request.server.log.error(
              { err, matchId: matchId.toString() },
              'match statistics broadcast failed'
            )
          })
        }

        const match = await prisma.match.findUnique({ where: { id: matchId } })
        if (match?.status === MatchStatus.FINISHED) {
          const publishTopic =
            typeof request.server.publishTopic === 'function'
              ? request.server.publishTopic.bind(request.server)
              : undefined
          await handleMatchFinalization(matchId, request.server.log, { publishTopic })
        }

        return sendSerialized(reply, updated.event)
      })

      admin.delete('/matches/:matchId/events/:eventId', async (request, reply) => {
        const matchId = parseBigIntId(getParam(request.params, 'matchId'), 'matchId')
        const eventId = parseBigIntId(getParam(request.params, 'eventId'), 'eventId')
        let result: { statAdjusted: boolean; deleted: true }
        try {
          result = await deleteMatchEvent(matchId, eventId)
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          request.server.log.error(
            { err, matchId: matchId.toString(), eventId: eventId.toString() },
            'match event delete failed'
          )
          return reply.status(500).send({ ok: false, error: 'event_delete_failed' })
        }

        if (result.statAdjusted) {
          await broadcastMatchStatistics(request.server, matchId).catch(err => {
            request.server.log.error(
              { err, matchId: matchId.toString() },
              'match statistics broadcast failed'
            )
          })
        }

        const match = await prisma.match.findUnique({ where: { id: matchId } })
        if (match?.status === MatchStatus.FINISHED) {
          const publishTopic =
            typeof request.server.publishTopic === 'function'
              ? request.server.publishTopic.bind(request.server)
              : undefined
          await handleMatchFinalization(matchId, request.server.log, { publishTopic })
        }

        return reply.send({ ok: true })
      })

      // Stats read-only
      admin.get('/stats/club-season', async (request, reply) => {
        const { seasonId, competitionId } = request.query as {
          seasonId?: string
          competitionId?: string
        }

        let resolvedSeasonId: number | undefined
        if (seasonId) {
          const numeric = Number(seasonId)
          if (Number.isFinite(numeric) && numeric > 0) {
            resolvedSeasonId = numeric
          }
        } else if (competitionId) {
          const numeric = Number(competitionId)
          if (Number.isFinite(numeric) && numeric > 0) {
            const latestSeason = await prisma.season.findFirst({
              where: { competitionId: numeric },
              orderBy: { startDate: 'desc' },
            })
            resolvedSeasonId = latestSeason?.id
          }
        }

        if (!resolvedSeasonId) {
          return reply.status(400).send({ ok: false, error: 'season_or_competition_required' })
        }

        try {
          const { value, version } = await getSeasonClubStats(resolvedSeasonId)
          reply.header('X-Resource-Version', String(version))
          return reply.send({ ok: true, data: value, meta: { version } })
        } catch (err) {
          if (err instanceof RequestError) {
            return reply.status(err.statusCode).send({ ok: false, error: err.message })
          }
          throw err
        }
      })

      admin.get('/stats/club-career', async (request, reply) => {
        const { competitionId } = request.query as { competitionId?: string }

        let resolvedCompetitionId: number | undefined
        if (competitionId) {
          const numeric = Number(competitionId)
          if (!Number.isFinite(numeric) || numeric <= 0) {
            return reply.status(400).send({ ok: false, error: 'competition_invalid' })
          }
          resolvedCompetitionId = numeric
        }

        const { value, version } = await getClubCareerTotals(resolvedCompetitionId)
        reply.header('X-Resource-Version', String(version))
        return reply.send({ ok: true, data: value, meta: { version } })
      })

      admin.get('/stats/player-season', async (request, reply) => {
        const { seasonId, competitionId } = request.query as {
          seasonId?: string
          competitionId?: string
        }

        let resolvedSeasonId: number | undefined
        if (seasonId) {
          const numeric = Number(seasonId)
          if (Number.isFinite(numeric) && numeric > 0) {
            resolvedSeasonId = numeric
          }
        } else if (competitionId) {
          const numeric = Number(competitionId)
          if (Number.isFinite(numeric) && numeric > 0) {
            const latestSeason = await prisma.season.findFirst({
              where: { competitionId: numeric },
              orderBy: { startDate: 'desc' },
            })
            resolvedSeasonId = latestSeason?.id
          }
        }

        if (!resolvedSeasonId) {
          return reply.status(400).send({ ok: false, error: 'season_or_competition_required' })
        }

        const { value, version } = await getSeasonPlayerStats(resolvedSeasonId)
        reply.header('X-Resource-Version', String(version))
        return reply.send({ ok: true, data: value, meta: { version } })
      })

      admin.get('/stats/player-career', async (request, reply) => {
        const { clubId, competitionId } = request.query as {
          clubId?: string
          competitionId?: string
        }

        let resolvedClubId: number | undefined
        if (clubId) {
          const numeric = Number(clubId)
          if (!Number.isFinite(numeric) || numeric <= 0) {
            return reply.status(400).send({ ok: false, error: 'club_invalid' })
          }
          resolvedClubId = numeric
        }

        let resolvedCompetitionId: number | undefined
        if (competitionId) {
          const numeric = Number(competitionId)
          if (!Number.isFinite(numeric) || numeric <= 0) {
            return reply.status(400).send({ ok: false, error: 'competition_invalid' })
          }
          resolvedCompetitionId = numeric
        }

        const { value, version } = await getPlayerCareerStats({
          competitionId: resolvedCompetitionId,
          clubId: resolvedClubId,
        })
        reply.header('X-Resource-Version', String(version))
        return reply.send({ ok: true, data: value, meta: { version } })
      })

      // Users & predictions
      admin.get('/users', async (_request, reply) => {
        const users = await prisma.appUser.findMany({
          orderBy: { createdAt: 'desc' },
          include: {
            leaguePlayer: true,
          },
        })
        return sendSerialized(reply, users)
      })

      admin.put('/users/:userId', async (request, reply) => {
        const userId = parseNumericId(getParam(request.params, 'userId'), 'userId')
        const body = request.body as {
          firstName?: string
          currentStreak?: number
          totalPredictions?: number
        }
        const user = await prisma.appUser.update({
          where: { id: userId },
          data: {
            firstName: body.firstName ?? undefined,
            currentStreak: body.currentStreak ?? undefined,
            totalPredictions: body.totalPredictions ?? undefined,
          },
          include: {
            leaguePlayer: true,
          },
        })
        await defaultCache.invalidate(`user:${user.telegramId.toString()}`)
        return sendSerialized(reply, user)
      })

      admin.post('/users/:userId/league-player', async (request, reply) => {
        const userId = parseNumericId(getParam(request.params, 'userId'), 'userId')
        const body = request.body as { personId?: number }

        if (!body?.personId) {
          return reply.status(400).send({ ok: false, error: 'personid_required' })
        }

        const person = await prisma.person.findUnique({ where: { id: body.personId } })
        if (!person) {
          return reply.status(404).send({ ok: false, error: 'person_not_found' })
        }
        if (!person.isPlayer) {
          return reply.status(400).send({ ok: false, error: 'person_is_not_player' })
        }

        const user = await prisma.appUser.findUnique({ where: { id: userId } })
        if (!user) {
          return reply.status(404).send({ ok: false, error: 'user_not_found' })
        }

        const existingLink = await prisma.appUser.findFirst({
          where: {
            leaguePlayerId: body.personId,
            NOT: { id: userId },
          },
        })

        if (existingLink) {
          return reply.status(409).send({ ok: false, error: 'league_player_already_linked' })
        }

        const updated = await prisma.appUser.update({
          where: { id: userId },
          data: {
            leaguePlayerId: body.personId,
            leaguePlayerStatus: 'VERIFIED',
            leaguePlayerVerifiedAt: new Date(),
            leaguePlayerRequestedAt: user.leaguePlayerRequestedAt ?? new Date(),
          },
          include: {
            leaguePlayer: true,
          },
        })

        await defaultCache.invalidate(`user:${updated.telegramId.toString()}`)

        return sendSerialized(reply, updated)
      })

      admin.get('/predictions/matches', async (request, reply) => {
        const { seasonId: rawSeasonId, limit: rawLimit } = request.query as {
          seasonId?: string
          limit?: string
        }

        let seasonId: number | undefined
        if (rawSeasonId !== undefined) {
          const parsed = Number(rawSeasonId)
          if (!Number.isFinite(parsed)) {
            return reply.status(400).send({ ok: false, error: 'season_invalid' })
          }
          seasonId = Math.trunc(parsed)
        }

        const defaultLimit = 100
        let take = defaultLimit
        if (rawLimit !== undefined) {
          const parsed = Number(rawLimit)
          if (!Number.isFinite(parsed) || parsed <= 0) {
            return reply.status(400).send({ ok: false, error: 'limit_invalid' })
          }
          take = Math.min(defaultLimit, Math.trunc(parsed))
        }

        const now = new Date()
        const sixDaysMs = 6 * 24 * 60 * 60 * 1000
        const until = new Date(now.getTime() + sixDaysMs)

        const matches = await prisma.match.findMany({
          where: {
            status: MatchStatus.SCHEDULED,
            seasonId: seasonId ?? undefined,
            matchDateTime: {
              gte: now,
              lte: until,
            },
          },
          orderBy: [{ matchDateTime: 'asc' }],
          take,
          select: ADMIN_PREDICTION_MATCH_SELECT,
        })

        if (!matches.length) {
          return reply.send({ ok: true, data: [] })
        }

        const summaries = new Map<string, MatchTemplateEnsureSummary>()
        const changedMatchIds = new Set<bigint>()

        for (const match of matches) {
          try {
            const summary = await ensurePredictionTemplatesForMatch(match.id, prisma)
            if (summary) {
              summaries.set(match.id.toString(), summary)
              if (summary.changed) {
                changedMatchIds.add(match.id)
              }
            }
          } catch (err) {
            request.server.log.warn(
              { err, matchId: match.id.toString() },
              'failed to ensure prediction templates for admin listing'
            )
          }
        }

        let normalizedMatches = matches
        if (changedMatchIds.size) {
          const refreshed = await prisma.match.findMany({
            where: { id: { in: Array.from(changedMatchIds) } },
            select: ADMIN_PREDICTION_MATCH_SELECT,
          })
          const refreshedById = new Map(refreshed.map(row => [row.id.toString(), row]))
          normalizedMatches = matches.map(match => refreshedById.get(match.id.toString()) ?? match)
        }

        const views = await Promise.all(
          normalizedMatches.map(async match => {
            const summary = summaries.get(match.id.toString())
            if (summary?.totalSuggestion) {
              const suggestion = serializeTotalGoalsSuggestion(summary.totalSuggestion)
              return serializePredictionMatchForAdmin(match, suggestion)
            }

            const matchContext: PredictionMatchContext = {
              id: match.id,
              matchDateTime: match.matchDateTime ?? new Date(),
              homeTeamId: match.homeTeamId,
              awayTeamId: match.awayTeamId,
              status: match.status,
              isFriendly: match.isFriendly,
            }
            const suggestionRaw = await suggestTotalGoalsLineForMatch(matchContext)
            const suggestion = serializeTotalGoalsSuggestion(suggestionRaw)
            return serializePredictionMatchForAdmin(match, suggestion)
          })
        )

        return reply.send({ ok: true, data: views })
      })

      admin.get('/predictions', async (request, reply) => {
        const { matchId, userId } = request.query as { matchId?: string; userId?: string }
        const predictions = await prisma.prediction.findMany({
          where: {
            matchId: matchId ? BigInt(matchId) : undefined,
            userId: userId ? Number(userId) : undefined,
          },
          include: { user: true },
        })
        return sendSerialized(reply, predictions)
      })

      admin.put('/predictions/:predictionId', async (request, reply) => {
        const predictionId = parseBigIntId(getParam(request.params, 'predictionId'), 'predictionId')
        const body = request.body as { isCorrect?: boolean; pointsAwarded?: number }
        const prediction = await prisma.prediction.update({
          where: { id: predictionId },
          data: {
            isCorrect: body.isCorrect ?? undefined,
            pointsAwarded: body.pointsAwarded ?? undefined,
          },
        })
        return sendSerialized(reply, prediction)
      })

      // Achievements
      admin.get('/achievements/types', async (_request, reply) => {
        const types = await prisma.achievementType.findMany({ orderBy: { name: 'asc' } })
        return reply.send({ ok: true, data: types })
      })

      admin.post('/achievements/types', async (request, reply) => {
        const body = request.body as {
          name?: string
          description?: string
          requiredValue?: number
          metric?: AchievementMetric
        }
        if (!body?.name || !body?.requiredValue || !body?.metric) {
          return reply.status(400).send({ ok: false, error: 'achievement_fields_required' })
        }
        const type = await prisma.achievementType.create({
          data: {
            name: body.name.trim(),
            description: body.description?.trim() ?? null,
            requiredValue: body.requiredValue,
            metric: body.metric,
          },
        })
        return reply.send({ ok: true, data: type })
      })

      admin.put('/achievements/types/:achievementTypeId', async (request, reply) => {
        const achievementTypeId = parseNumericId(
          getParam(request.params, 'achievementTypeId'),
          'achievementTypeId'
        )
        const body = request.body as {
          name?: string
          description?: string
          requiredValue?: number
          metric?: AchievementMetric
        }
        const type = await prisma.achievementType.update({
          where: { id: achievementTypeId },
          data: {
            name: body.name?.trim(),
            description: body.description?.trim(),
            requiredValue: body.requiredValue ?? undefined,
            metric: body.metric ?? undefined,
          },
        })
        await recomputeAchievementsForType(achievementTypeId)
        return reply.send({ ok: true, data: type })
      })

      admin.delete('/achievements/types/:achievementTypeId', async (request, reply) => {
        const achievementTypeId = parseNumericId(
          getParam(request.params, 'achievementTypeId'),
          'achievementTypeId'
        )
        await prisma.userAchievement.deleteMany({ where: { achievementTypeId } })
        await prisma.achievementType.delete({ where: { id: achievementTypeId } })
        return reply.send({ ok: true })
      })

      admin.get('/achievements/users', async (_request, reply) => {
        const achievements = await prisma.userAchievement.findMany({
          include: {
            user: true,
            achievementType: true,
          },
          orderBy: { achievedDate: 'desc' },
        })
        return reply.send({ ok: true, data: achievements })
      })

      admin.delete('/achievements/users/:userId/:achievementTypeId', async (request, reply) => {
        const userId = parseNumericId(getParam(request.params, 'userId'), 'userId')
        const achievementTypeId = parseNumericId(
          getParam(request.params, 'achievementTypeId'),
          'achievementTypeId'
        )
        await prisma.userAchievement.delete({
          where: { userId_achievementTypeId: { userId, achievementTypeId } },
        })
        return reply.send({ ok: true })
      })

      // Disqualifications
      admin.get('/disqualifications', async (_request, reply) => {
        const disqualifications = await prisma.disqualification.findMany({
          include: { person: true, club: true },
          orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        })

        const enriched = disqualifications.map(entry => ({
          ...entry,
          matchesRemaining: Math.max(0, entry.banDurationMatches - entry.matchesMissed),
        }))

        return sendSerialized(reply, enriched)
      })

      admin.post('/disqualifications', async (request, reply) => {
        const body = request.body as {
          personId?: number
          clubId?: number | null
          reason?: DisqualificationReason
          sanctionDate?: string
          banDurationMatches?: number
        }
        if (!body?.personId || !body?.reason || !body?.banDurationMatches) {
          return reply.status(400).send({ ok: false, error: 'disqualification_fields_required' })
        }
        const disqualification = await prisma.disqualification.create({
          data: {
            personId: body.personId,
            clubId: body.clubId ?? null,
            reason: body.reason,
            sanctionDate: body.sanctionDate ? new Date(body.sanctionDate) : new Date(),
            banDurationMatches: body.banDurationMatches,
            matchesMissed: 0,
            isActive: true,
          },
        })
        return reply.send({ ok: true, data: disqualification })
      })

      admin.put('/disqualifications/:disqualificationId', async (request, reply) => {
        const disqualificationId = parseBigIntId(
          getParam(request.params, 'disqualificationId'),
          'disqualificationId'
        )
        const body = request.body as Partial<{
          matchesMissed: number
          isActive: boolean
          banDurationMatches: number
        }>
        const disqualification = await prisma.disqualification.update({
          where: { id: disqualificationId },
          data: {
            matchesMissed: body.matchesMissed ?? undefined,
            isActive: body.isActive ?? undefined,
            banDurationMatches: body.banDurationMatches ?? undefined,
          },
        })
        return reply.send({ ok: true, data: disqualification })
      })

      admin.delete('/disqualifications/:disqualificationId', async (request, reply) => {
        const disqualificationId = parseBigIntId(
          getParam(request.params, 'disqualificationId'),
          'disqualificationId'
        )
        await prisma.disqualification.delete({ where: { id: disqualificationId } })
        return reply.send({ ok: true })
      })

      // ============================================================
      // Season Archive (архивирование сезонов)
      // ============================================================

      admin.get<{ Params: { seasonId: string } }>(
        '/seasons/:seasonId/archive/validate',
        async (request, reply) => {
          const seasonId = parseNumericId(request.params.seasonId, 'seasonId')

          const { getSeasonArchiveValidationDetails } = await import('../services/seasonArchive')
          const result = await getSeasonArchiveValidationDetails(seasonId)

          if (!result) {
            return reply.status(404).send({ ok: false, error: 'season_not_found' })
          }

          return reply.send({ ok: true, data: result })
        }
      )

      admin.post<{ Params: { seasonId: string } }>(
        '/seasons/:seasonId/archive',
        async (request, reply) => {
          const seasonId = parseNumericId(request.params.seasonId, 'seasonId')
          const adminIdentifier = request.admin?.sub ?? 'unknown'

          const { archiveSeason, getSeasonArchive } = await import('../services/seasonArchive')
          const result = await archiveSeason(seasonId, adminIdentifier)

          if (!result.success) {
            const statusMap: Record<string, number> = {
              season_not_found: 404,
              season_already_archived: 400,
              season_has_unfinished_matches: 400,
              season_has_unfinished_series: 400,
              season_is_active: 400,
              archive_build_failed: 500,
            }
            const status = result.error ? statusMap[result.error] ?? 400 : 400
            return reply.status(status).send({
              ok: false,
              error: result.error,
              details: result.details,
            })
          }

          // Загружаем полный архив для ответа
          const archive = await getSeasonArchive(seasonId)

          return reply.send({
            ok: true,
            data: {
              seasonId: result.seasonId,
              archiveId: result.archiveId,
              archivedAt: result.archivedAt,
              summary: archive?.summary ?? null,
            },
          })
        }
      )

      // ============================================================
      // Achievement Jobs Processing (для ручного запуска обработки)
      // ============================================================

      admin.post('/achievement-jobs/process', async (request, reply) => {
        const body = request.body as { limit?: number } | undefined
        const limit = Math.min(100, Math.max(1, body?.limit ?? 20))

        try {
          const processed = await processPendingAchievementJobs(limit)
          const stats = await getAchievementJobsStats()

          return reply.send({
            ok: true,
            data: {
              processed,
              stats,
            },
          })
        } catch (err) {
          request.log.error({ err }, 'achievement jobs processing failed')
          return reply.status(500).send({ ok: false, error: 'internal' })
        }
      })

      admin.get('/achievement-jobs/stats', async (request, reply) => {
        try {
          const stats = await getAchievementJobsStats()
          return reply.send({ ok: true, data: stats })
        } catch (err) {
          request.log.error({ err }, 'achievement jobs stats failed')
          return reply.status(500).send({ ok: false, error: 'internal' })
        }
      })
    },
    { prefix: '/api/admin' }
  )
}

async function recomputeAchievementsForType(achievementTypeId: number) {
  const type = await prisma.achievementType.findUnique({ where: { id: achievementTypeId } })
  if (!type) return
  const users = await prisma.appUser.findMany({
    include: { predictions: true, achievements: true },
  })
  for (const user of users) {
    let achieved = false
    if (type.metric === AchievementMetric.TOTAL_PREDICTIONS) {
      achieved = user.predictions.length >= type.requiredValue
    } else if (type.metric === AchievementMetric.CORRECT_PREDICTIONS) {
      const correct = user.predictions.filter(p => p.isCorrect).length
      achieved = correct >= type.requiredValue
    }
    if (achieved) {
      const existing = user.achievements.find(ua => ua.achievementTypeId === type.id)
      if (!existing) {
        await prisma.userAchievement.create({
          data: {
            userId: user.id,
            achievementTypeId: type.id,
            achievedDate: new Date(),
          },
        })
      }
    }
  }
}
