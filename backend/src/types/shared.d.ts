declare module '@shared/types' {
  export type DailyRewardDayStatus = 'claimed' | 'claimable' | 'locked' | 'cooldown'

  export interface DailyRewardDayView {
    day: number
    points: number
    animationKey: string
    gradient?: readonly [string, string]
    status: DailyRewardDayStatus
  }

  export interface DailyRewardSummary {
    streak: number
    effectiveStreak: number
    cycleProgress: number
    cycleLength: number
    claimedToday: boolean
    claimAvailable: boolean
    claimableDay: number | null
    nextDay: number
    pendingPoints: number
    totalClaims: number
    totalPointsEarned: number
    lastClaimedAt: string | null
    lastClaimDateKey: string | null
    todayKey: string
    nextResetKey: string
    cooldownEndsAt: string
    /** @deprecated Use cooldownEndsAt and compute on client */
    cooldownSeconds?: number
    timezone: string
    missed: boolean
    message?: string | null
    lastReward?: {
      day: number
      points: number
      animationKey: string
      claimedAt: string
    } | null
    days: DailyRewardDayView[]
  }

  export interface DailyRewardClaimResponse {
    summary: DailyRewardSummary
    awarded: {
      day: number
      points: number
      animationKey: string
    }
  }

  export interface ShopItemImageView {
    mimeType: string | null
    width: number | null
    height: number | null
    size: number | null
    url?: string | null
    base64?: string | null
    fingerprint: string
    updatedAt: string
  }

  export interface ShopItemView {
    id: number
    slug?: string | null
    title: string
    subtitle?: string | null
    description?: string | null
    priceCents: number
    currencyCode: string
    stockQuantity?: number | null
    maxPerOrder: number
    sortOrder: number
    isActive: boolean
    image?: ShopItemImageView | null
    createdAt: string
    updatedAt: string
  }

  export type ShopOrderStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED'

  export interface ShopOrderItemView {
    itemId: number
    title: string
    subtitle?: string | null
    priceCents: number
    quantity: number
    imageUrl?: string | null
  }

  export interface ShopOrderUserView {
    userId?: number | null
    telegramId?: string | null
    username?: string | null
    firstName?: string | null
  }

  export interface ShopOrderView {
    id: string
    orderNumber: string
    status: ShopOrderStatus
    totalCents: number
    currencyCode: string
    customerNote?: string | null
    createdAt: string
    updatedAt: string
    confirmedAt?: string | null
    confirmedBy?: string | null
    items: ShopOrderItemView[]
    user?: ShopOrderUserView | null
  }

  export interface LeaguePlayerClubInfo {
    id: number
    name: string
    logoUrl: string | null
    stats: {
      totalMatches: number
      totalGoals: number
      totalAssists: number
      yellowCards: number
      redCards: number
    }
  }

  export interface LeaguePlayerCardInfo {
    id: number
    firstName: string
    lastName: string
    stats: {
      totalMatches: number
      totalGoals: number
      totalAssists: number
      yellowCards: number
      redCards: number
    }
    currentClub: {
      id: number
      name: string
      shortName: string
      logoUrl: string | null
    } | null
    /** Все клубы игрока с их статистикой */
    clubs: LeaguePlayerClubInfo[]
  }

  export interface UserCardExtraView {
    registrationDate: string
    achievementCount: number
    achievementMaxLevel: number
    leaguePlayer: LeaguePlayerCardInfo | null
  }
}
