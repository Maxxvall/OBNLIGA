import { Prisma, PrismaClient, RatingScope } from '@prisma/client'
import prisma from '../db'
import { getActiveSeasonsMap } from './ratingSeasons'

const SETTINGS_SINGLETON_ID = 1
const DAY_MS = 24 * 60 * 60 * 1000

export const DEFAULT_CURRENT_SCOPE_DAYS = 90
export const DEFAULT_YEARLY_SCOPE_DAYS = 365
export const MIN_CURRENT_SCOPE_DAYS = 7
export const MAX_CURRENT_SCOPE_DAYS = 365
export const MIN_YEARLY_SCOPE_DAYS = 90
export const MAX_YEARLY_SCOPE_DAYS = 1460

export type RatingSettingsSnapshot = {
  currentScopeDays: number
  yearlyScopeDays: number
  updatedAt: Date
}

type RatingSettingsModel = {
  id: number
  currentScopeDays: number
  yearlyScopeDays: number
  createdAt: Date
  updatedAt: Date
}

const normalizeRecord = (record: RatingSettingsModel | null): RatingSettingsSnapshot => {
  if (!record) {
    return {
      currentScopeDays: DEFAULT_CURRENT_SCOPE_DAYS,
      yearlyScopeDays: DEFAULT_YEARLY_SCOPE_DAYS,
      updatedAt: new Date(0),
    }
  }

  const rawCurrent = Math.trunc(record.currentScopeDays)
  const rawYearly = Math.trunc(record.yearlyScopeDays)

  const currentScopeDays = Math.max(
    MIN_CURRENT_SCOPE_DAYS,
    Math.min(MAX_CURRENT_SCOPE_DAYS, rawCurrent)
  )
  const yearlyScopeDays = Math.max(
    Math.max(currentScopeDays, MIN_YEARLY_SCOPE_DAYS),
    Math.min(MAX_YEARLY_SCOPE_DAYS, rawYearly)
  )

  return {
    currentScopeDays,
    yearlyScopeDays,
    updatedAt: record.updatedAt,
  }
}

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient

const ensureSettingsRecord = async (client: PrismaClientOrTx): Promise<RatingSettingsModel> => {
  const delegate = (client as PrismaClient).ratingSettings
  return delegate.upsert({
    where: { id: SETTINGS_SINGLETON_ID },
    update: {},
    create: {
      id: SETTINGS_SINGLETON_ID,
      currentScopeDays: DEFAULT_CURRENT_SCOPE_DAYS,
      yearlyScopeDays: DEFAULT_YEARLY_SCOPE_DAYS,
    },
  })
}

export const getRatingSettings = async (
  client: PrismaClientOrTx = prisma
): Promise<RatingSettingsSnapshot> => {
  const record = await ensureSettingsRecord(client)
  return normalizeRecord(record)
}

export type UpdateRatingSettingsInput = {
  currentScopeDays: number
  yearlyScopeDays: number
}

export const saveRatingSettings = async (
  input: UpdateRatingSettingsInput,
  client: PrismaClientOrTx = prisma
): Promise<RatingSettingsSnapshot> => {
  const normalizedCurrent = Math.max(
    MIN_CURRENT_SCOPE_DAYS,
    Math.min(MAX_CURRENT_SCOPE_DAYS, Math.trunc(input.currentScopeDays))
  )
  const normalizedYearly = Math.max(
    Math.max(normalizedCurrent, MIN_YEARLY_SCOPE_DAYS),
    Math.min(MAX_YEARLY_SCOPE_DAYS, Math.trunc(input.yearlyScopeDays))
  )

  const delegate = (client as PrismaClient).ratingSettings
  const record = await delegate.upsert({
    where: { id: SETTINGS_SINGLETON_ID },
    update: {
      currentScopeDays: normalizedCurrent,
      yearlyScopeDays: normalizedYearly,
    },
    create: {
      id: SETTINGS_SINGLETON_ID,
      currentScopeDays: normalizedCurrent,
      yearlyScopeDays: normalizedYearly,
    },
  })

  return normalizeRecord(record)
}

export const composeRatingSettingsPayload = (snapshot: RatingSettingsSnapshot) => ({
  currentScopeDays: snapshot.currentScopeDays,
  yearlyScopeDays: snapshot.yearlyScopeDays,
  updatedAt: snapshot.updatedAt.toISOString(),
  defaults: {
    currentScopeDays: DEFAULT_CURRENT_SCOPE_DAYS,
    yearlyScopeDays: DEFAULT_YEARLY_SCOPE_DAYS,
  },
})

export const computeRatingWindows = async (
  anchor: Date,
  snapshot: RatingSettingsSnapshot,
  client: PrismaClientOrTx = prisma
) => {
  const reference = anchor.getTime()
  const fallbackCurrentStart = new Date(reference - snapshot.currentScopeDays * DAY_MS)
  const yearlyDurationDays = Math.max(snapshot.currentScopeDays, snapshot.yearlyScopeDays)
  const fallbackYearlyStart = new Date(reference - yearlyDurationDays * DAY_MS)

  const seasons = await getActiveSeasonsMap(client)
  const activeCurrentSeason = seasons.get(RatingScope.CURRENT)
  const activeYearlySeason = seasons.get(RatingScope.YEARLY)

  const resolveSeasonStart = (season: { startsAt: Date } | undefined, fallback: Date) => {
    if (!season?.startsAt) {
      return fallback
    }
    const start = new Date(season.startsAt)
    return start.getTime() <= reference ? start : fallback
  }

  const resolveSeasonEnd = (season: { endsAt: Date | null } | undefined, fallback: Date) => {
    if (!season?.endsAt) {
      return fallback
    }
    const end = new Date(season.endsAt)
    return end.getTime() >= reference ? end : fallback
  }

  const currentWindowStart = resolveSeasonStart(activeCurrentSeason, fallbackCurrentStart)
  const yearlyWindowStart = resolveSeasonStart(activeYearlySeason, fallbackYearlyStart)
  const currentWindowEnd = resolveSeasonEnd(activeCurrentSeason, anchor)
  const yearlyWindowEnd = resolveSeasonEnd(activeYearlySeason, anchor)

  return {
    anchor,
    currentWindowStart,
    currentWindowEnd,
    yearlyWindowStart,
    yearlyWindowEnd,
  }
}
