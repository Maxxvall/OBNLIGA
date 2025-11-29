/**
 * Сервис для работы с экспресс-прогнозами
 *
 * Экспресс — комбинированный прогноз из нескольких событий из разных матчей.
 * Очки начисляются только если ВСЕ события угаданы.
 */

import { FastifyBaseLogger } from 'fastify'
import {
  ExpressStatus,
  MatchStatus,
  PredictionEntryStatus,
  PredictionMarketType,
  Prisma,
} from '@prisma/client'
import {
  EXPRESS_MAX_ITEMS,
  EXPRESS_MIN_ITEMS,
  EXPRESS_MULTIPLIERS,
  EXPRESS_WEEKLY_LIMIT,
  EXPRESS_WEEKLY_LIMIT_DAYS,
} from './predictionConstants'

// =================== ТИПЫ ===================

export type CreateExpressItemInput = {
  templateId: bigint
  selection: string
}

export type CreateExpressInput = {
  userId: number
  items: CreateExpressItemInput[]
}

export type ExpressValidationError =
  | 'too_few_items'
  | 'too_many_items'
  | 'duplicate_templates'
  | 'same_match_templates'
  | 'template_not_found'
  | 'match_locked'
  | 'invalid_selection'
  | 'weekly_limit_reached'

export type ExpressValidationResult =
  | { valid: true }
  | { valid: false; error: ExpressValidationError; details?: string }

export type ExpressBetView = {
  id: string
  status: ExpressStatus
  multiplier: number
  basePoints: number
  scoreAwarded: number | null
  createdAt: string
  resolvedAt: string | null
  items: ExpressBetItemView[]
}

export type ExpressBetItemView = {
  id: string
  templateId: string
  matchId: string
  selection: string
  status: PredictionEntryStatus
  basePoints: number
  resolvedAt: string | null
  marketType: PredictionMarketType
  matchDateTime: string
  homeClub: {
    id: number
    name: string
    shortName: string | null
    logoUrl: string | null
  }
  awayClub: {
    id: number
    name: string
    shortName: string | null
    logoUrl: string | null
  }
}

type TemplateWithMatch = Prisma.PredictionTemplateGetPayload<{
  include: {
    match: {
      include: {
        homeClub: true
        awayClub: true
      }
    }
  }
}>

type ExpressBetWithItems = Prisma.ExpressBetGetPayload<{
  include: {
    items: {
      include: {
        template: {
          include: {
            match: {
              include: {
                homeClub: true
                awayClub: true
              }
            }
          }
        }
      }
    }
  }
}>

// =================== УТИЛИТЫ ===================

const toNumber = (value: Prisma.Decimal | number | null | undefined): number | null => {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  try {
    const numeric = value.toNumber()
    return Number.isFinite(numeric) ? numeric : null
  } catch {
    return null
  }
}

/**
 * Получить множитель экспресса по количеству событий
 */
export const getExpressMultiplier = (itemCount: number): number => {
  return EXPRESS_MULTIPLIERS[itemCount] ?? 1
}

/**
 * Проверка что матч заблокирован (уже начался или не SCHEDULED)
 */
const matchIsLocked = (match: { status: MatchStatus; matchDateTime: Date }): boolean => {
  if (match.status !== MatchStatus.SCHEDULED) return true
  return match.matchDateTime.getTime() <= Date.now()
}

/**
 * Извлечь допустимые варианты выбора из options шаблона
 */
const selectionFromOptions = (options: unknown): string[] => {
  if (!options) return []

  const normalized = new Set<string>()

  const consume = (value: unknown) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      normalized.add(value.trim())
      return
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      normalized.add(String(value))
      return
    }
    if (value && typeof value === 'object') {
      const candidate = value as { value?: unknown }
      if (typeof candidate.value === 'string' && candidate.value.trim().length > 0) {
        normalized.add(candidate.value.trim())
      }
    }
  }

  const walk = (input: unknown): void => {
    if (Array.isArray(input)) {
      input.forEach(consume)
      return
    }
    if (input && typeof input === 'object') {
      const record = input as Record<string, unknown>
      if (Array.isArray(record.choices)) record.choices.forEach(consume)
      if (Array.isArray(record.options)) record.options.forEach(consume)
      if (Array.isArray(record.values)) record.values.forEach(consume)
    }
  }

  walk(options)
  return Array.from(normalized)
}

/**
 * Сериализация экспресса для API ответа
 */
export const serializeExpressBet = (express: ExpressBetWithItems): ExpressBetView => ({
  id: express.id.toString(),
  status: express.status,
  multiplier: toNumber(express.multiplier) ?? 1,
  basePoints: express.basePoints,
  scoreAwarded: express.scoreAwarded,
  createdAt: express.createdAt.toISOString(),
  resolvedAt: express.resolvedAt?.toISOString() ?? null,
  items: express.items.map(item => ({
    id: item.id.toString(),
    templateId: item.templateId.toString(),
    matchId: item.template.matchId.toString(),
    selection: item.selection,
    status: item.status,
    basePoints: item.basePoints,
    resolvedAt: item.resolvedAt?.toISOString() ?? null,
    marketType: item.template.marketType,
    matchDateTime: item.template.match.matchDateTime.toISOString(),
    homeClub: {
      id: item.template.match.homeClub.id,
      name: item.template.match.homeClub.name,
      shortName: item.template.match.homeClub.shortName ?? null,
      logoUrl: item.template.match.homeClub.logoUrl ?? null,
    },
    awayClub: {
      id: item.template.match.awayClub.id,
      name: item.template.match.awayClub.name,
      shortName: item.template.match.awayClub.shortName ?? null,
      logoUrl: item.template.match.awayClub.logoUrl ?? null,
    },
  })),
})

// =================== ВАЛИДАЦИЯ ===================

/**
 * Валидация входных данных для создания экспресса
 */
export const validateExpressInput = async (
  input: CreateExpressInput,
  tx: Prisma.TransactionClient
): Promise<{ result: ExpressValidationResult; templates?: TemplateWithMatch[] }> => {
  const { userId, items } = input

  // Проверка количества событий
  if (items.length < EXPRESS_MIN_ITEMS) {
    return { result: { valid: false, error: 'too_few_items', details: `Минимум ${EXPRESS_MIN_ITEMS} события` } }
  }
  if (items.length > EXPRESS_MAX_ITEMS) {
    return { result: { valid: false, error: 'too_many_items', details: `Максимум ${EXPRESS_MAX_ITEMS} события` } }
  }

  // Проверка на дубликаты шаблонов
  const templateIds = items.map(i => i.templateId)
  const uniqueTemplateIds = new Set(templateIds.map(id => id.toString()))
  if (uniqueTemplateIds.size !== templateIds.length) {
    return { result: { valid: false, error: 'duplicate_templates', details: 'Дубликаты шаблонов' } }
  }

  // Проверка недельного лимита
  const limitDate = new Date(Date.now() - EXPRESS_WEEKLY_LIMIT_DAYS * 24 * 60 * 60 * 1000)
  const weeklyCount = await tx.expressBet.count({
    where: {
      userId,
      createdAt: { gte: limitDate },
    },
  })

  if (weeklyCount >= EXPRESS_WEEKLY_LIMIT) {
    return { result: { valid: false, error: 'weekly_limit_reached', details: `Лимит: ${EXPRESS_WEEKLY_LIMIT} за ${EXPRESS_WEEKLY_LIMIT_DAYS} дней` } }
  }

  // Загрузка шаблонов с матчами
  const templates = await tx.predictionTemplate.findMany({
    where: { id: { in: templateIds } },
    include: {
      match: {
        include: {
          homeClub: true,
          awayClub: true,
        },
      },
    },
  })

  // Проверка что все шаблоны найдены
  if (templates.length !== templateIds.length) {
    const foundIds = new Set(templates.map(t => t.id.toString()))
    const missing = templateIds.find(id => !foundIds.has(id.toString()))
    return { result: { valid: false, error: 'template_not_found', details: `Шаблон ${missing} не найден` } }
  }

  // Проверка что все события из разных матчей
  const matchIds = new Set<string>()
  for (const template of templates) {
    const matchIdStr = template.matchId.toString()
    if (matchIds.has(matchIdStr)) {
      return { result: { valid: false, error: 'same_match_templates', details: 'События должны быть из разных матчей' } }
    }
    matchIds.add(matchIdStr)
  }

  // Проверка что все матчи PENDING (не начались)
  for (const template of templates) {
    if (matchIsLocked(template.match)) {
      return {
        result: {
          valid: false,
          error: 'match_locked',
          details: `Матч ${template.match.homeClub.name} vs ${template.match.awayClub.name} уже начался`,
        },
      }
    }
  }

  // Проверка валидности выборов
  const templateMap = new Map(templates.map(t => [t.id.toString(), t]))
  for (const item of items) {
    const template = templateMap.get(item.templateId.toString())
    if (!template) continue

    const allowedSelections = selectionFromOptions(template.options)
    if (allowedSelections.length === 0) {
      return { result: { valid: false, error: 'invalid_selection', details: `Шаблон ${item.templateId} не готов` } }
    }

    if (!allowedSelections.includes(item.selection.trim())) {
      return {
        result: {
          valid: false,
          error: 'invalid_selection',
          details: `Невалидный выбор "${item.selection}" для шаблона ${item.templateId}`,
        },
      }
    }
  }

  return { result: { valid: true }, templates }
}

// =================== СОЗДАНИЕ ЭКСПРЕССА ===================

/**
 * Создание экспресс-прогноза
 */
export const createExpressBet = async (
  input: CreateExpressInput,
  tx: Prisma.TransactionClient,
  logger: FastifyBaseLogger
): Promise<ExpressBetWithItems> => {
  const { userId, items } = input

  // Валидация
  const { result, templates } = await validateExpressInput(input, tx)
  if (!result.valid) {
    throw new Error(result.error)
  }

  if (!templates) {
    throw new Error('template_not_found')
  }

  const templateMap = new Map(templates.map(t => [t.id.toString(), t]))

  // Расчёт базовых очков и множителя
  let totalBasePoints = 0
  for (const item of items) {
    const template = templateMap.get(item.templateId.toString())
    if (template) {
      totalBasePoints += template.basePoints
    }
  }

  const multiplier = getExpressMultiplier(items.length)

  // Создание экспресса
  const expressBet = await tx.expressBet.create({
    data: {
      userId,
      status: ExpressStatus.PENDING,
      multiplier,
      basePoints: totalBasePoints,
      items: {
        create: items.map(item => {
          const template = templateMap.get(item.templateId.toString())!
          return {
            templateId: item.templateId,
            selection: item.selection.trim(),
            status: PredictionEntryStatus.PENDING,
            basePoints: template.basePoints,
          }
        }),
      },
    },
    include: {
      items: {
        include: {
          template: {
            include: {
              match: {
                include: {
                  homeClub: true,
                  awayClub: true,
                },
              },
            },
          },
        },
      },
    },
  })

  logger.info(
    {
      expressId: expressBet.id.toString(),
      userId,
      itemCount: items.length,
      multiplier,
      basePoints: totalBasePoints,
    },
    'express bet created'
  )

  return expressBet
}

// =================== РАСЧЁТ ЭКСПРЕССА ===================

export type ExpressSettlementSummary = {
  expressId: bigint
  userId: number
  status: ExpressStatus
  scoreAwarded: number | null
}

/**
 * Расчёт одного экспресса после расчёта матча
 *
 * Вызывается когда все события в экспрессе были расчитаны
 */
export const settleExpressBet = async (
  expressId: bigint,
  tx: Prisma.TransactionClient,
  logger: FastifyBaseLogger
): Promise<ExpressSettlementSummary | null> => {
  const express = await tx.expressBet.findUnique({
    where: { id: expressId },
    include: {
      items: {
        include: {
          template: true,
        },
      },
    },
  })

  if (!express) {
    logger.warn({ expressId: expressId.toString() }, 'express bet not found for settlement')
    return null
  }

  if (express.status !== ExpressStatus.PENDING) {
    logger.debug({ expressId: expressId.toString(), status: express.status }, 'express bet already settled')
    return null
  }

  // Проверяем что все события расчитаны
  const pendingItems = express.items.filter(item => item.status === PredictionEntryStatus.PENDING)
  if (pendingItems.length > 0) {
    logger.debug(
      { expressId: expressId.toString(), pendingCount: pendingItems.length },
      'express bet has pending items, skipping settlement'
    )
    return null
  }

  // Определяем итоговый статус экспресса
  const lostItems = express.items.filter(item => item.status === PredictionEntryStatus.LOST)
  const cancelledItems = express.items.filter(item => item.status === PredictionEntryStatus.CANCELLED)
  const voidItems = express.items.filter(item => item.status === PredictionEntryStatus.VOID)
  const wonItems = express.items.filter(item => item.status === PredictionEntryStatus.WON)

  let finalStatus: ExpressStatus
  let scoreAwarded: number | null = null
  const resolvedAt = new Date()

  // Если хоть одно событие проиграно — весь экспресс проигран
  if (lostItems.length > 0) {
    finalStatus = ExpressStatus.LOST
    scoreAwarded = 0
  }
  // Если все события отменены
  else if (cancelledItems.length === express.items.length) {
    finalStatus = ExpressStatus.CANCELLED
    scoreAwarded = null
  }
  // Если хоть одно событие VOID, а остальные WON — можно пересчитать
  else if (voidItems.length > 0 && lostItems.length === 0) {
    // Все не-VOID события выиграли — экспресс выигрывает с пересчётом
    const validItems = wonItems.length
    if (validItems >= EXPRESS_MIN_ITEMS) {
      finalStatus = ExpressStatus.WON
      const newMultiplier = getExpressMultiplier(validItems)
      const wonBasePoints = wonItems.reduce((sum, item) => sum + item.basePoints, 0)
      scoreAwarded = Math.round(wonBasePoints * newMultiplier)
    } else if (validItems > 0) {
      // Недостаточно событий для экспресса — возврат базовых очков
      finalStatus = ExpressStatus.VOID
      scoreAwarded = wonItems.reduce((sum, item) => sum + item.basePoints, 0)
    } else {
      finalStatus = ExpressStatus.VOID
      scoreAwarded = null
    }
  }
  // Все события выиграли
  else if (wonItems.length === express.items.length) {
    finalStatus = ExpressStatus.WON
    const multiplier = toNumber(express.multiplier) ?? 1
    scoreAwarded = Math.round(express.basePoints * multiplier)
  }
  // Неожиданная ситуация
  else {
    logger.warn(
      {
        expressId: expressId.toString(),
        won: wonItems.length,
        lost: lostItems.length,
        void: voidItems.length,
        cancelled: cancelledItems.length,
      },
      'express bet has unexpected item status combination'
    )
    finalStatus = ExpressStatus.CANCELLED
    scoreAwarded = null
  }

  // Обновляем статус экспресса
  await tx.expressBet.update({
    where: { id: expressId },
    data: {
      status: finalStatus,
      scoreAwarded,
      resolvedAt,
    },
  })

  logger.info(
    {
      expressId: expressId.toString(),
      userId: express.userId,
      status: finalStatus,
      scoreAwarded,
      itemsWon: wonItems.length,
      itemsLost: lostItems.length,
    },
    'express bet settled'
  )

  return {
    expressId,
    userId: express.userId,
    status: finalStatus,
    scoreAwarded,
  }
}

/**
 * Обновить статус элементов экспресса после расчёта матча
 *
 * Вызывается из predictionSettlement после расчёта PredictionEntry.
 * Использует контекст матча для вычисления статуса каждого элемента
 * на основе его собственного selection.
 */
export const updateExpressItemsForMatch = async (
  matchId: bigint,
  matchContext: {
    outcome: 'ONE' | 'DRAW' | 'TWO'
    totalGoals: number
    eventTypes: Set<string>
  },
  tx: Prisma.TransactionClient,
  logger: FastifyBaseLogger
): Promise<bigint[]> => {
  // Находим все элементы экспрессов связанные с шаблонами этого матча
  const items = await tx.expressBetItem.findMany({
    where: {
      template: {
        matchId,
      },
      status: PredictionEntryStatus.PENDING,
      express: {
        status: ExpressStatus.PENDING,
      },
    },
    include: {
      template: true,
    },
  })

  if (items.length === 0) {
    return []
  }

  const resolvedAt = new Date()
  const expressIdsToSettle = new Set<bigint>()

  // Обновляем статус каждого элемента индивидуально
  for (const item of items) {
    const status = evaluateExpressItemStatus(item.selection, item.template, matchContext)

    await tx.expressBetItem.update({
      where: { id: item.id },
      data: {
        status,
        resolvedAt,
      },
    })

    expressIdsToSettle.add(item.expressId)
  }

  logger.debug(
    {
      matchId: matchId.toString(),
      updatedCount: items.length,
    },
    'express items updated for match'
  )

  return [...expressIdsToSettle]
}

/**
 * Вычисляет статус элемента экспресса на основе его selection и контекста матча
 */
const evaluateExpressItemStatus = (
  selection: string,
  template: { marketType: PredictionMarketType; options: Prisma.JsonValue },
  context: {
    outcome: 'ONE' | 'DRAW' | 'TWO'
    totalGoals: number
    eventTypes: Set<string>
  }
): PredictionEntryStatus => {
  const trimmedSelection = selection.trim().toUpperCase()

  switch (template.marketType) {
    case PredictionMarketType.MATCH_OUTCOME: {
      const normalizedSelection = normalizeOutcomeSelection(trimmedSelection)
      if (!normalizedSelection) return PredictionEntryStatus.CANCELLED
      return normalizedSelection === context.outcome
        ? PredictionEntryStatus.WON
        : PredictionEntryStatus.LOST
    }

    case PredictionMarketType.TOTAL_GOALS: {
      const options = ensureRecord(template.options)
      let line: number | null = null

      if (typeof options?.line === 'number' && Number.isFinite(options.line)) {
        line = options.line
      } else if (typeof options?.formattedLine === 'string') {
        const parsed = Number(options.formattedLine.replace(',', '.'))
        if (Number.isFinite(parsed)) line = parsed
      }

      // Попробуем извлечь линию из selection
      const selectionMatch = trimmedSelection.replace(/\s+/g, '_').match(/^(OVER|UNDER)(?:_([0-9]+(?:\.[0-9]+)?))?$/)
      if (!line && selectionMatch?.[2]) {
        const parsed = Number(selectionMatch[2])
        if (Number.isFinite(parsed)) line = parsed
      }

      if (!line || !selectionMatch) return PredictionEntryStatus.CANCELLED

      const selectionKind = selectionMatch[1]
      const delta = context.totalGoals - line

      // Push (ничья по линии)
      if (Math.abs(delta) < 0.0001) return PredictionEntryStatus.VOID

      const actualResult = delta > 0 ? 'OVER' : 'UNDER'
      return selectionKind === actualResult
        ? PredictionEntryStatus.WON
        : PredictionEntryStatus.LOST
    }

    case PredictionMarketType.CUSTOM_BOOLEAN: {
      const options = ensureRecord(template.options)
      if (!options) return PredictionEntryStatus.CANCELLED

      const yesValue = typeof options.yesValue === 'string' ? options.yesValue.toUpperCase() : undefined
      const noValue = typeof options.noValue === 'string' ? options.noValue.toUpperCase() : undefined
      if (!yesValue || !noValue) return PredictionEntryStatus.CANCELLED

      const relatedEventsRaw = Array.isArray(options.relatedEvents) ? options.relatedEvents : []
      const relatedEvents = relatedEventsRaw
        .map(item => (typeof item === 'string' ? item : String(item)))
        .map(value => value.toUpperCase())

      const eventOccurred = relatedEvents.some(eventKey => context.eventTypes.has(eventKey))
      const actualValue = eventOccurred ? yesValue : noValue

      return trimmedSelection === actualValue
        ? PredictionEntryStatus.WON
        : PredictionEntryStatus.LOST
    }

    default:
      return PredictionEntryStatus.CANCELLED
  }
}

/**
 * Нормализация выбора исхода
 */
const normalizeOutcomeSelection = (value: string): 'ONE' | 'DRAW' | 'TWO' | null => {
  const trimmed = value.trim().toUpperCase()
  if (trimmed === 'ONE' || trimmed === '1' || trimmed === 'HOME') return 'ONE'
  if (trimmed === 'DRAW' || trimmed === 'X' || trimmed === '0') return 'DRAW'
  if (trimmed === 'TWO' || trimmed === '2' || trimmed === 'AWAY') return 'TWO'
  return null
}

/**
 * Обеспечивает что value является Record
 */
const ensureRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}
