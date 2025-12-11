import { describe, it, beforeEach, expect, vi } from 'vitest'
import { MatchStatus } from '@prisma/client'
import { maybePrewarmPublicLeagueCaches } from '../services/cachePrewarm'

const mocks = vi.hoisted(() => ({
  matchWindowState: {
    window: {
      phase: 'idle' as 'idle' | 'prewarm' | 'live' | 'post',
      computedAt: new Date().toISOString(),
      windowStart: null,
      windowEnd: null,
      nextMatchAt: null,
      lastMatchAt: null,
      matchesTotal: 0,
      seasonIds: [] as number[],
    },
  },
  cacheSetMock: vi.fn(),
  resolveCacheOptionsMock: vi.fn(async () => ({
    ttlSeconds: 30,
    staleWhileRevalidateSeconds: 15,
    lockTimeoutSeconds: 5,
  })),
  prismaSeasonFindFirst: vi.fn(),
  prismaSeasonFindMany: vi.fn(),
  prismaMatchFindMany: vi.fn(),
  prismaShopFindMany: vi.fn(),
  buildLeagueTableMock: vi.fn(async (season: { id: number }) => ({ tableFor: season.id })),
  fetchLeagueSeasonsMock: vi.fn(async () => [{ id: 1 }, { id: 2 }]),
  refreshLeagueMatchAggregatesMock: vi.fn(async (seasonId: number) => ({ seasonId })),
  refreshLeagueStatsMock: vi.fn(async (seasonId: number) => ({ seasonId })),
  refreshFriendlyAggregatesMock: vi.fn(async () => ({ ok: true })),
  loadRatingLeaderboardMock: vi.fn(async (scope: 'CURRENT' | 'YEARLY') => ({ scope })),
  ratingPublicCacheKeyMock: vi.fn((scope: string, page: number, size: number) => `${scope}:${page}:${size}`),
  serializeShopItemViewMock: vi.fn((item: unknown) => ({ item })),
  fetchMatchHeaderMock: vi.fn(async (id: string) => ({ id })),
  fetchMatchLineupsMock: vi.fn(async (id: string) => ({ id })),
}))

vi.mock('../cache/matchWindowHelper', () => ({
  getMatchWindow: vi.fn(() => Promise.resolve(mocks.matchWindowState.window)),
  resolveCacheOptions: mocks.resolveCacheOptionsMock,
}))

vi.mock('../cache/multilevelCache', () => ({
  defaultCache: {
    set: mocks.cacheSetMock,
    invalidate: vi.fn(),
    getWithMeta: vi.fn(),
  },
}))

vi.mock('../db', () => ({
  default: {
    season: {
      findFirst: mocks.prismaSeasonFindFirst,
      findMany: mocks.prismaSeasonFindMany,
    },
    match: {
      findMany: mocks.prismaMatchFindMany,
    },
    shopItem: {
      findMany: mocks.prismaShopFindMany,
    },
  },
}))

vi.mock('../services/leagueTable', () => ({
  buildLeagueTable: mocks.buildLeagueTableMock,
  fetchLeagueSeasons: mocks.fetchLeagueSeasonsMock,
}))

vi.mock('../services/leagueSchedule', () => ({
  refreshLeagueMatchAggregates: mocks.refreshLeagueMatchAggregatesMock,
  refreshFriendlyAggregates: mocks.refreshFriendlyAggregatesMock,
}))
vi.mock('../services/leagueStats', () => ({
  refreshLeagueStats: mocks.refreshLeagueStatsMock,
}))

vi.mock('../services/ratingAggregation', () => ({
  loadRatingLeaderboard: mocks.loadRatingLeaderboardMock,
  ratingPublicCacheKey: mocks.ratingPublicCacheKeyMock,
  RATING_CACHE_OPTIONS: { ttlSeconds: 120, staleWhileRevalidateSeconds: 600 },
}))
vi.mock('../services/ratingConstants', () => ({
  RATING_DEFAULT_PAGE_SIZE: 10,
  RATING_MAX_PAGE_SIZE: 100,
}))

vi.mock('../services/shop/serializers', () => ({
  serializeShopItemView: mocks.serializeShopItemViewMock,
}))

vi.mock('../services/matchDetailsPublic', () => ({
  fetchMatchHeader: mocks.fetchMatchHeaderMock,
  fetchMatchLineups: mocks.fetchMatchLineupsMock,
}))

const {
  matchWindowState,
  cacheSetMock,
  resolveCacheOptionsMock,
  prismaSeasonFindFirst,
  prismaSeasonFindMany,
  prismaMatchFindMany,
  prismaShopFindMany,
  buildLeagueTableMock,
  fetchLeagueSeasonsMock,
  refreshLeagueMatchAggregatesMock,
  refreshLeagueStatsMock,
  refreshFriendlyAggregatesMock,
  loadRatingLeaderboardMock,
  ratingPublicCacheKeyMock,
  serializeShopItemViewMock,
  fetchMatchHeaderMock,
  fetchMatchLineupsMock,
} = mocks

describe('maybePrewarmPublicLeagueCaches', () => {
  beforeEach(() => {
    cacheSetMock.mockClear()
    resolveCacheOptionsMock.mockClear()
    buildLeagueTableMock.mockClear()
    fetchLeagueSeasonsMock.mockClear()
    refreshLeagueMatchAggregatesMock.mockClear()
    refreshLeagueStatsMock.mockClear()
    refreshFriendlyAggregatesMock.mockClear()
    loadRatingLeaderboardMock.mockClear()
    ratingPublicCacheKeyMock.mockClear()
    serializeShopItemViewMock.mockClear()
    fetchMatchHeaderMock.mockClear()
    fetchMatchLineupsMock.mockClear()

    prismaSeasonFindFirst.mockReset()
    prismaSeasonFindMany.mockReset()
    prismaMatchFindMany.mockReset()
    prismaShopFindMany.mockReset()

    matchWindowState.window = {
      phase: 'idle',
      computedAt: new Date().toISOString(),
      windowStart: null,
      windowEnd: null,
      nextMatchAt: null,
      lastMatchAt: null,
      matchesTotal: 0,
      seasonIds: [],
    }
  })

  it('выполняет базовый прогрев вне match window', async () => {
    prismaSeasonFindFirst.mockResolvedValue({ id: 1, competition: {}, isActive: true })
    prismaShopFindMany.mockResolvedValue([{ id: 10 }])

    const result = await maybePrewarmPublicLeagueCaches()

    expect(result.modes.base).toBe(true)
    expect(result.modes.aggressive).toBe(false)
    expect(result.reason).toBe('base_only')
    expect(buildLeagueTableMock).toHaveBeenCalledTimes(1)
    expect(fetchLeagueSeasonsMock).toHaveBeenCalledTimes(1)
    expect(loadRatingLeaderboardMock).toHaveBeenCalledTimes(2)
    expect(serializeShopItemViewMock).toHaveBeenCalledTimes(1)
    expect(refreshLeagueMatchAggregatesMock).not.toHaveBeenCalled()
    expect(refreshFriendlyAggregatesMock).not.toHaveBeenCalled()
    expect(fetchMatchHeaderMock).not.toHaveBeenCalled()
  })

  it('добавляет агрессивный прогрев в active window', async () => {
    matchWindowState.window = {
      phase: 'live',
      computedAt: new Date().toISOString(),
      windowStart: null,
      windowEnd: null,
      nextMatchAt: null,
      lastMatchAt: null,
      matchesTotal: 2,
      seasonIds: [1, 2],
    }

    prismaSeasonFindFirst.mockResolvedValue({ id: 1, competition: {}, isActive: true })
    prismaSeasonFindMany.mockResolvedValue([
      { id: 1, competition: {} },
      { id: 2, competition: {} },
    ])
    prismaShopFindMany.mockResolvedValue([{ id: 10 }])
    prismaMatchFindMany.mockResolvedValue([
      { id: BigInt(101), matchDateTime: new Date(), status: MatchStatus.SCHEDULED },
      { id: BigInt(102), matchDateTime: new Date(), status: MatchStatus.SCHEDULED },
    ])

    const result = await maybePrewarmPublicLeagueCaches()

    expect(result.modes.base).toBe(true)
    expect(result.modes.aggressive).toBe(true)
    expect(result.reason).toBe('live')
    expect(refreshLeagueMatchAggregatesMock).toHaveBeenCalledTimes(2)
    expect(refreshLeagueStatsMock).toHaveBeenCalledTimes(2)
    expect(refreshFriendlyAggregatesMock).toHaveBeenCalledTimes(1)
    expect(fetchMatchHeaderMock).toHaveBeenCalledTimes(2)
    expect(fetchMatchLineupsMock).toHaveBeenCalledTimes(2)
  })

  it('работает без активного сезона (базовый режим)', async () => {
    prismaSeasonFindFirst.mockResolvedValue(null)
    prismaShopFindMany.mockResolvedValue([{ id: 10 }])

    const result = await maybePrewarmPublicLeagueCaches()

    expect(result.modes.base).toBe(true)
    expect(result.modes.aggressive).toBe(false)
    expect(buildLeagueTableMock).not.toHaveBeenCalled()
    expect(loadRatingLeaderboardMock).toHaveBeenCalledTimes(2)
    expect(serializeShopItemViewMock).toHaveBeenCalledTimes(1)
  })
})
