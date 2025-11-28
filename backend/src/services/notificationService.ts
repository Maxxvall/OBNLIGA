/**
 * Сервис отправки уведомлений через Telegram Bot API.
 * Отвечает за форматирование и отправку push-уведомлений о матчах.
 */

import { Bot, InlineKeyboard } from 'grammy'

const token = process.env.TELEGRAM_BOT_TOKEN
const webAppUrl = process.env.WEBAPP_URL || 'http://localhost:5173'

// Создаём отдельный инстанс бота для отправки уведомлений (без polling)
let notificationBot: Bot | null = null

if (token) {
  notificationBot = new Bot(token)
}

// =================== ТИПЫ ===================

export type NotificationMessageType =
  | 'MATCH_REMINDER'
  | 'MATCH_STARTED'
  | 'MATCH_FINISHED'
  | 'GOAL_SCORED'

export interface MatchNotificationDetails {
  id: string | bigint
  homeClubName: string
  homeClubShortName: string
  awayClubName: string
  awayClubShortName: string
  homeScore?: number
  awayScore?: number
  matchDateTime: Date | string
  broadcastUrl?: string | null
  stadiumName?: string | null
  competitionName?: string | null
  seasonName?: string | null
}

export interface GoalDetails {
  scorerName: string
  minute: number
  isHome: boolean
  newHomeScore: number
  newAwayScore: number
}

// =================== ШАБЛОНЫ СООБЩЕНИЙ ===================

const formatTime = (date: Date): string => {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

// Закомментировано: функция не используется, но может пригодиться для будущих уведомлений
// const formatDate = (date: Date): string => {
//   const day = String(date.getDate()).padStart(2, '0')
//   const month = String(date.getMonth() + 1).padStart(2, '0')
//   return `${day}.${month}`
// }

const getMinutesLabel = (minutes: number): string => {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const remainder = minutes % 60
    if (remainder === 0) {
      if (hours === 1) return '1 час'
      if (hours >= 2 && hours <= 4) return `${hours} часа`
      return `${hours} часов`
    }
    return `${hours} ч. ${remainder} мин.`
  }
  if (minutes === 1) return '1 минуту'
  if (minutes >= 2 && minutes <= 4) return `${minutes} минуты`
  return `${minutes} минут`
}

const buildMatchReminderMessage = (
  match: MatchNotificationDetails,
  minutesBefore: number
): string => {
  const matchDate = new Date(match.matchDateTime)
  const timeLabel = getMinutesLabel(minutesBefore)

  const lines = [
    '⚽ <b>Напоминание о матче!</b>',
    '',
    `🏟 <b>${match.homeClubName}</b> vs <b>${match.awayClubName}</b>`,
  ]

  if (match.competitionName) {
    lines.push(`🏆 ${match.competitionName}`)
  }

  if (match.stadiumName) {
    lines.push(`📍 ${match.stadiumName}`)
  }

  lines.push('')
  lines.push(`⏰ Начало через <b>${timeLabel}</b> (в ${formatTime(matchDate)})`)
  lines.push('')
  lines.push('Не пропусти! Открой приложение и следи за трансляцией 📱')

  return lines.join('\n')
}

const buildMatchStartedMessage = (match: MatchNotificationDetails): string => {
  const lines = [
    '🔴 <b>МАТЧ НАЧАЛСЯ!</b>',
    '',
    `⚽ <b>${match.homeClubName}</b> vs <b>${match.awayClubName}</b>`,
  ]

  if (match.competitionName) {
    lines.push(`🏆 ${match.competitionName}`)
  }

  lines.push('')
  lines.push('🎬 Заходи смотреть трансляцию прямо сейчас!')
  lines.push('')

  if (match.broadcastUrl) {
    lines.push(`📺 Трансляция: ${match.broadcastUrl}`)
  }

  return lines.join('\n')
}

const buildMatchFinishedMessage = (match: MatchNotificationDetails): string => {
  const homeScore = match.homeScore ?? 0
  const awayScore = match.awayScore ?? 0

  const lines = [
    '🏁 <b>МАТЧ ЗАВЕРШЁН!</b>',
    '',
    `⚽ <b>${match.homeClubName}</b> ${homeScore} : ${awayScore} <b>${match.awayClubName}</b>`,
  ]

  if (match.competitionName) {
    lines.push(`🏆 ${match.competitionName}`)
  }

  lines.push('')

  // Определяем результат
  if (homeScore > awayScore) {
    lines.push(`🎉 Победа ${match.homeClubShortName}!`)
  } else if (awayScore > homeScore) {
    lines.push(`🎉 Победа ${match.awayClubShortName}!`)
  } else {
    lines.push('🤝 Ничья!')
  }

  lines.push('')
  lines.push('Открой приложение для полной статистики 📊')

  return lines.join('\n')
}

const buildGoalScoredMessage = (
  match: MatchNotificationDetails,
  goal: GoalDetails
): string => {
  const scoringTeam = goal.isHome ? match.homeClubName : match.awayClubName

  const lines = [
    '⚽ <b>ГОЛ!</b>',
    '',
    `🎯 <b>${goal.scorerName}</b> (${goal.minute}')`,
    `👕 ${scoringTeam}`,
    '',
    `📊 Счёт: <b>${match.homeClubShortName}</b> ${goal.newHomeScore} : ${goal.newAwayScore} <b>${match.awayClubShortName}</b>`,
  ]

  return lines.join('\n')
}

// =================== ОТПРАВКА УВЕДОМЛЕНИЙ ===================

export interface SendNotificationResult {
  success: boolean
  errorMessage?: string
  errorCode?: number
}

/**
 * Отправляет уведомление в Telegram.
 * Возвращает результат отправки с информацией об ошибке при неудаче.
 */
export async function sendTelegramNotification(
  telegramId: bigint | string,
  message: string,
  matchId: string | bigint
): Promise<SendNotificationResult> {
  if (!notificationBot) {
    return {
      success: false,
      errorMessage: 'Bot not configured',
      errorCode: 500,
    }
  }

  const keyboard = new InlineKeyboard().webApp(
    '📱 Открыть матч',
    `${webAppUrl}?startapp=match_${matchId}`
  )

  try {
    await notificationBot.api.sendMessage(telegramId.toString(), message, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    })
    return { success: true }
  } catch (err: unknown) {
    // Обработка ошибок Telegram API
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    let errorCode = 500

    // Проверяем типичные ошибки Telegram
    if (errorMessage.includes('bot was blocked')) {
      errorCode = 403 // Пользователь заблокировал бота
    } else if (errorMessage.includes('chat not found')) {
      errorCode = 400 // Чат не найден
    } else if (errorMessage.includes('Too Many Requests')) {
      errorCode = 429 // Rate limit
    }

    console.error('Telegram notification error:', { telegramId, errorMessage, errorCode })

    return {
      success: false,
      errorMessage,
      errorCode,
    }
  }
}

/**
 * Отправляет напоминание о матче.
 */
export async function sendMatchReminder(
  telegramId: bigint | string,
  match: MatchNotificationDetails,
  minutesBefore: number
): Promise<SendNotificationResult> {
  const message = buildMatchReminderMessage(match, minutesBefore)
  return sendTelegramNotification(telegramId, message, match.id)
}

/**
 * Отправляет уведомление о начале матча.
 */
export async function sendMatchStartedNotification(
  telegramId: bigint | string,
  match: MatchNotificationDetails
): Promise<SendNotificationResult> {
  const message = buildMatchStartedMessage(match)
  return sendTelegramNotification(telegramId, message, match.id)
}

/**
 * Отправляет уведомление о завершении матча.
 */
export async function sendMatchFinishedNotification(
  telegramId: bigint | string,
  match: MatchNotificationDetails
): Promise<SendNotificationResult> {
  const message = buildMatchFinishedMessage(match)
  return sendTelegramNotification(telegramId, message, match.id)
}

/**
 * Отправляет уведомление о забитом голе.
 */
export async function sendGoalNotification(
  telegramId: bigint | string,
  match: MatchNotificationDetails,
  goal: GoalDetails
): Promise<SendNotificationResult> {
  const message = buildGoalScoredMessage(match, goal)
  return sendTelegramNotification(telegramId, message, match.id)
}

/**
 * Проверяет, настроен ли бот для отправки уведомлений.
 */
export function isNotificationBotConfigured(): boolean {
  return notificationBot !== null
}
