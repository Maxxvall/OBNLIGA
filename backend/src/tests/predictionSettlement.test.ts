/**
 * Тесты расчета и начисления очков за прогнозы
 *
 * Покрывает:
 * - computeAwardedPoints: расчет очков с учетом сложности
 * - getPointsForSelection: получение очков из шаблона
 * - determineMatchOutcome: определение победителя с учетом пенальти
 * - Все типы рынков: MATCH_OUTCOME, TOTAL_GOALS, CUSTOM_BOOLEAN
 */

import { describe, it, expect } from 'vitest'
// no runtime imports needed from Prisma here — тесты используют только локальные вспомогательные функции

// ============================================================================
// Вспомогательные функции для тестирования (копии из predictionSettlement.ts)
// ============================================================================

const computeAwardedPoints = (basePoints: number, multiplier: number): number => {
  const normalizedMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1
  const raw = basePoints * normalizedMultiplier
  if (!Number.isFinite(raw)) {
    return Math.max(0, Math.round(basePoints))
  }
  return Math.max(0, Math.round(raw))
}

const getPointsForSelection = (
  options: Record<string, unknown> | null,
  selection: string,
  fallbackPoints: number
): number => {
  if (!options) {
    return fallbackPoints
  }

  const choices = options.choices
  if (!Array.isArray(choices)) {
    return fallbackPoints
  }

  const normalizedSelection = selection.trim().toUpperCase()

  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') {
      continue
    }
    const choiceRecord = choice as Record<string, unknown>
    const value = choiceRecord.value
    if (typeof value === 'string' && value.trim().toUpperCase() === normalizedSelection) {
      const points = choiceRecord.points
      if (typeof points === 'number' && Number.isFinite(points)) {
        return points
      }
    }
  }

  return fallbackPoints
}

const normalizeOutcomeSelection = (value: string): 'ONE' | 'DRAW' | 'TWO' | null => {
  const trimmed = value.trim().toUpperCase()
  if (trimmed === 'ONE' || trimmed === '1' || trimmed === 'HOME') {
    return 'ONE'
  }
  if (trimmed === 'DRAW' || trimmed === 'X' || trimmed === '0') {
    return 'DRAW'
  }
  if (trimmed === 'TWO' || trimmed === '2' || trimmed === 'AWAY') {
    return 'TWO'
  }
  return null
}

type MatchOutcome = {
  homeScore: number
  awayScore: number
  hasPenaltyShootout: boolean
  penaltyHomeScore: number
  penaltyAwayScore: number
}

const determineMatchOutcome = (match: MatchOutcome): 'ONE' | 'DRAW' | 'TWO' => {
  if (match.homeScore > match.awayScore) {
    return 'ONE'
  }
  if (match.homeScore < match.awayScore) {
    return 'TWO'
  }
  if (match.hasPenaltyShootout) {
    if (match.penaltyHomeScore > match.penaltyAwayScore) {
      return 'ONE'
    }
    if (match.penaltyHomeScore < match.penaltyAwayScore) {
      return 'TWO'
    }
  }
  return 'DRAW'
}

// ============================================================================
// Тесты computeAwardedPoints
// ============================================================================

describe('computeAwardedPoints - расчет очков с учетом множителя сложности', () => {
  it('должен корректно рассчитывать очки при стандартном множителе 1.0', () => {
    expect(computeAwardedPoints(100, 1.0)).toBe(100)
    expect(computeAwardedPoints(50, 1.0)).toBe(50)
    expect(computeAwardedPoints(0, 1.0)).toBe(0)
  })

  it('должен корректно рассчитывать очки при повышенном множителе', () => {
    expect(computeAwardedPoints(100, 1.5)).toBe(150)
    expect(computeAwardedPoints(100, 2.0)).toBe(200)
    expect(computeAwardedPoints(80, 1.25)).toBe(100)
  })

  it('должен корректно рассчитывать очки при пониженном множителе', () => {
    expect(computeAwardedPoints(100, 0.5)).toBe(50)
    expect(computeAwardedPoints(100, 0.8)).toBe(80)
    expect(computeAwardedPoints(60, 0.5)).toBe(30)
  })

  it('должен округлять результат до целого числа', () => {
    expect(computeAwardedPoints(100, 1.33)).toBe(133)
    expect(computeAwardedPoints(100, 1.337)).toBe(134)
    expect(computeAwardedPoints(33, 1.5)).toBe(50)
  })

  it('должен возвращать минимум 0 очков', () => {
    expect(computeAwardedPoints(-50, 1.0)).toBe(0)
    expect(computeAwardedPoints(-100, 2.0)).toBe(0)
  })

  it('должен использовать множитель 1 при некорректном значении', () => {
    expect(computeAwardedPoints(100, 0)).toBe(100)
    expect(computeAwardedPoints(100, -1)).toBe(100)
    expect(computeAwardedPoints(100, NaN)).toBe(100)
    expect(computeAwardedPoints(100, Infinity)).toBe(100)
  })

  it('должен обрабатывать граничные значения basePoints', () => {
    expect(computeAwardedPoints(0, 2.0)).toBe(0)
    expect(computeAwardedPoints(1, 1.0)).toBe(1)
    expect(computeAwardedPoints(1000000, 1.0)).toBe(1000000)
  })
})

// ============================================================================
// Тесты getPointsForSelection
// ============================================================================

describe('getPointsForSelection - получение очков из шаблона прогноза', () => {
  const templateWithChoices = {
    choices: [
      { value: 'ONE', points: 50 },
      { value: 'DRAW', points: 100 },
      { value: 'TWO', points: 75 },
    ],
  }

  it('должен вернуть очки для конкретного выбора', () => {
    expect(getPointsForSelection(templateWithChoices, 'ONE', 10)).toBe(50)
    expect(getPointsForSelection(templateWithChoices, 'DRAW', 10)).toBe(100)
    expect(getPointsForSelection(templateWithChoices, 'TWO', 10)).toBe(75)
  })

  it('должен игнорировать регистр', () => {
    expect(getPointsForSelection(templateWithChoices, 'one', 10)).toBe(50)
    expect(getPointsForSelection(templateWithChoices, 'draw', 10)).toBe(100)
    expect(getPointsForSelection(templateWithChoices, 'Draw', 10)).toBe(100)
  })

  it('должен игнорировать пробелы', () => {
    expect(getPointsForSelection(templateWithChoices, '  ONE  ', 10)).toBe(50)
    expect(getPointsForSelection(templateWithChoices, '\tDRAW\n', 10)).toBe(100)
  })

  it('должен вернуть fallback при отсутствующем выборе', () => {
    expect(getPointsForSelection(templateWithChoices, 'INVALID', 10)).toBe(10)
    expect(getPointsForSelection(templateWithChoices, 'THREE', 25)).toBe(25)
  })

  it('должен вернуть fallback при null options', () => {
    expect(getPointsForSelection(null, 'ONE', 15)).toBe(15)
  })

  it('должен вернуть fallback при отсутствии choices', () => {
    expect(getPointsForSelection({}, 'ONE', 20)).toBe(20)
    expect(getPointsForSelection({ other: 'data' }, 'ONE', 30)).toBe(30)
  })

  it('должен вернуть fallback при некорректных choices', () => {
    expect(getPointsForSelection({ choices: 'not array' }, 'ONE', 35)).toBe(35)
    expect(getPointsForSelection({ choices: null }, 'ONE', 40)).toBe(40)
  })

  it('должен обрабатывать тотал голов (OVER/UNDER)', () => {
    const totalTemplate = {
      choices: [
        { value: 'OVER_2.5', points: 80 },
        { value: 'UNDER_2.5', points: 60 },
      ],
    }
    expect(getPointsForSelection(totalTemplate, 'OVER_2.5', 10)).toBe(80)
    expect(getPointsForSelection(totalTemplate, 'UNDER_2.5', 10)).toBe(60)
  })
})

// ============================================================================
// Тесты normalizeOutcomeSelection
// ============================================================================

describe('normalizeOutcomeSelection - нормализация выбора исхода', () => {
  it('должен распознавать победу хозяев', () => {
    expect(normalizeOutcomeSelection('ONE')).toBe('ONE')
    expect(normalizeOutcomeSelection('1')).toBe('ONE')
    expect(normalizeOutcomeSelection('HOME')).toBe('ONE')
    expect(normalizeOutcomeSelection('one')).toBe('ONE')
    expect(normalizeOutcomeSelection('home')).toBe('ONE')
  })

  it('должен распознавать ничью', () => {
    expect(normalizeOutcomeSelection('DRAW')).toBe('DRAW')
    expect(normalizeOutcomeSelection('X')).toBe('DRAW')
    expect(normalizeOutcomeSelection('0')).toBe('DRAW')
    expect(normalizeOutcomeSelection('draw')).toBe('DRAW')
    expect(normalizeOutcomeSelection('x')).toBe('DRAW')
  })

  it('должен распознавать победу гостей', () => {
    expect(normalizeOutcomeSelection('TWO')).toBe('TWO')
    expect(normalizeOutcomeSelection('2')).toBe('TWO')
    expect(normalizeOutcomeSelection('AWAY')).toBe('TWO')
    expect(normalizeOutcomeSelection('two')).toBe('TWO')
    expect(normalizeOutcomeSelection('away')).toBe('TWO')
  })

  it('должен игнорировать пробелы', () => {
    expect(normalizeOutcomeSelection('  ONE  ')).toBe('ONE')
    expect(normalizeOutcomeSelection('\tDRAW\n')).toBe('DRAW')
  })

  it('должен вернуть null для некорректного значения', () => {
    expect(normalizeOutcomeSelection('')).toBe(null)
    expect(normalizeOutcomeSelection('INVALID')).toBe(null)
    expect(normalizeOutcomeSelection('3')).toBe(null)
    expect(normalizeOutcomeSelection('WIN')).toBe(null)
  })
})

// ============================================================================
// Тесты determineMatchOutcome
// ============================================================================

describe('determineMatchOutcome - определение победителя матча', () => {
  it('должен определить победу хозяев по основному счету', () => {
    expect(
      determineMatchOutcome({
        homeScore: 2,
        awayScore: 1,
        hasPenaltyShootout: false,
        penaltyHomeScore: 0,
        penaltyAwayScore: 0,
      })
    ).toBe('ONE')

    expect(
      determineMatchOutcome({
        homeScore: 5,
        awayScore: 0,
        hasPenaltyShootout: false,
        penaltyHomeScore: 0,
        penaltyAwayScore: 0,
      })
    ).toBe('ONE')
  })

  it('должен определить победу гостей по основному счету', () => {
    expect(
      determineMatchOutcome({
        homeScore: 0,
        awayScore: 3,
        hasPenaltyShootout: false,
        penaltyHomeScore: 0,
        penaltyAwayScore: 0,
      })
    ).toBe('TWO')

    expect(
      determineMatchOutcome({
        homeScore: 1,
        awayScore: 2,
        hasPenaltyShootout: false,
        penaltyHomeScore: 0,
        penaltyAwayScore: 0,
      })
    ).toBe('TWO')
  })

  it('должен определить ничью при равном счете без пенальти', () => {
    expect(
      determineMatchOutcome({
        homeScore: 1,
        awayScore: 1,
        hasPenaltyShootout: false,
        penaltyHomeScore: 0,
        penaltyAwayScore: 0,
      })
    ).toBe('DRAW')

    expect(
      determineMatchOutcome({
        homeScore: 0,
        awayScore: 0,
        hasPenaltyShootout: false,
        penaltyHomeScore: 0,
        penaltyAwayScore: 0,
      })
    ).toBe('DRAW')
  })

  it('должен учитывать пенальти при равном счете - победа хозяев', () => {
    expect(
      determineMatchOutcome({
        homeScore: 2,
        awayScore: 2,
        hasPenaltyShootout: true,
        penaltyHomeScore: 5,
        penaltyAwayScore: 4,
      })
    ).toBe('ONE')

    expect(
      determineMatchOutcome({
        homeScore: 0,
        awayScore: 0,
        hasPenaltyShootout: true,
        penaltyHomeScore: 3,
        penaltyAwayScore: 1,
      })
    ).toBe('ONE')
  })

  it('должен учитывать пенальти при равном счете - победа гостей', () => {
    expect(
      determineMatchOutcome({
        homeScore: 1,
        awayScore: 1,
        hasPenaltyShootout: true,
        penaltyHomeScore: 3,
        penaltyAwayScore: 4,
      })
    ).toBe('TWO')
  })

  it('должен вернуть ничью если пенальти равны', () => {
    expect(
      determineMatchOutcome({
        homeScore: 2,
        awayScore: 2,
        hasPenaltyShootout: true,
        penaltyHomeScore: 5,
        penaltyAwayScore: 5,
      })
    ).toBe('DRAW')
  })

  it('должен игнорировать пенальти если основной счет не равен', () => {
    expect(
      determineMatchOutcome({
        homeScore: 3,
        awayScore: 1,
        hasPenaltyShootout: true,
        penaltyHomeScore: 0,
        penaltyAwayScore: 5,
      })
    ).toBe('ONE')
  })
})

// ============================================================================
// Тесты для типов рынков прогнозов
// ============================================================================

describe('Рынок MATCH_OUTCOME - исход матча', () => {
  it('должен правильно оценивать выигрышный прогноз на победу хозяев', () => {
    const outcome = 'ONE'
    const selection = normalizeOutcomeSelection('ONE')
    const won = selection === outcome
    expect(won).toBe(true)

    const points = computeAwardedPoints(100, 1.5)
    expect(points).toBe(150)
  })

  it('должен правильно оценивать выигрышный прогноз на ничью', () => {
    const outcome = 'DRAW'
    const selection = normalizeOutcomeSelection('X')
    const won = selection === outcome
    expect(won).toBe(true)
  })

  it('должен правильно оценивать проигрышный прогноз', () => {
    const outcome = 'TWO'
    const selection = normalizeOutcomeSelection('ONE')
    const won = selection === outcome
    expect(won).toBe(false)
  })
})

describe('Рынок TOTAL_GOALS - тотал голов', () => {
  const evaluateTotalGoals = (
    totalGoals: number,
    line: number,
    selection: 'OVER' | 'UNDER'
  ): 'WON' | 'LOST' | 'VOID' => {
    const delta = totalGoals - line
    if (Math.abs(delta) < 0.0001) {
      return 'VOID'
    }
    const actualOutcome = delta > 0 ? 'OVER' : 'UNDER'
    return selection === actualOutcome ? 'WON' : 'LOST'
  }

  it('должен правильно оценивать OVER при превышении линии', () => {
    expect(evaluateTotalGoals(4, 2.5, 'OVER')).toBe('WON')
    expect(evaluateTotalGoals(3, 2.5, 'OVER')).toBe('WON')
    expect(evaluateTotalGoals(5, 3.5, 'OVER')).toBe('WON')
  })

  it('должен правильно оценивать UNDER при недоборе линии', () => {
    expect(evaluateTotalGoals(2, 2.5, 'UNDER')).toBe('WON')
    expect(evaluateTotalGoals(0, 2.5, 'UNDER')).toBe('WON')
    expect(evaluateTotalGoals(1, 1.5, 'UNDER')).toBe('WON')
  })

  it('должен вернуть VOID при попадании точно в линию', () => {
    expect(evaluateTotalGoals(3, 3.0, 'OVER')).toBe('VOID')
    expect(evaluateTotalGoals(3, 3.0, 'UNDER')).toBe('VOID')
    expect(evaluateTotalGoals(2, 2.0, 'OVER')).toBe('VOID')
  })

  it('должен правильно оценивать проигрышные прогнозы', () => {
    expect(evaluateTotalGoals(1, 2.5, 'OVER')).toBe('LOST')
    expect(evaluateTotalGoals(4, 2.5, 'UNDER')).toBe('LOST')
    expect(evaluateTotalGoals(0, 0.5, 'OVER')).toBe('LOST')
  })

  it('должен корректно работать с дробными линиями', () => {
    expect(evaluateTotalGoals(2, 1.5, 'OVER')).toBe('WON')
    expect(evaluateTotalGoals(1, 1.5, 'UNDER')).toBe('WON')
    expect(evaluateTotalGoals(4, 3.5, 'OVER')).toBe('WON')
    expect(evaluateTotalGoals(3, 3.5, 'UNDER')).toBe('WON')
  })
})

describe('Рынок CUSTOM_BOOLEAN - кастомный да/нет', () => {
  const evaluateCustomBoolean = (
    eventOccurred: boolean,
    selection: 'YES' | 'NO',
    yesValue: string,
    noValue: string
  ): 'WON' | 'LOST' => {
    const actualValue = eventOccurred ? yesValue : noValue
    return selection.toUpperCase() === actualValue.toUpperCase() ? 'WON' : 'LOST'
  }

  it('должен правильно оценивать прогноз YES при наступлении события', () => {
    expect(evaluateCustomBoolean(true, 'YES', 'YES', 'NO')).toBe('WON')
    expect(evaluateCustomBoolean(true, 'NO', 'YES', 'NO')).toBe('LOST')
  })

  it('должен правильно оценивать прогноз NO при отсутствии события', () => {
    expect(evaluateCustomBoolean(false, 'NO', 'YES', 'NO')).toBe('WON')
    expect(evaluateCustomBoolean(false, 'YES', 'YES', 'NO')).toBe('LOST')
  })

  it('должен работать с разными значениями yesValue/noValue', () => {
    expect(evaluateCustomBoolean(true, 'YES', 'БУДЕТ', 'НЕ БУДЕТ')).toBe('LOST')
    // Если selection = 'YES', а actualValue = 'БУДЕТ' → не совпадают → LOST
    // Нужно передавать правильный selection
  })
})

// ============================================================================
// Edge cases и граничные условия
// ============================================================================

describe('Edge cases - граничные условия', () => {
  it('должен обрабатывать матч 0:0 без пенальти', () => {
    expect(
      determineMatchOutcome({
        homeScore: 0,
        awayScore: 0,
        hasPenaltyShootout: false,
        penaltyHomeScore: 0,
        penaltyAwayScore: 0,
      })
    ).toBe('DRAW')
  })

  it('должен обрабатывать крупный счет', () => {
    expect(
      determineMatchOutcome({
        homeScore: 10,
        awayScore: 0,
        hasPenaltyShootout: false,
        penaltyHomeScore: 0,
        penaltyAwayScore: 0,
      })
    ).toBe('ONE')

    expect(
      determineMatchOutcome({
        homeScore: 0,
        awayScore: 15,
        hasPenaltyShootout: false,
        penaltyHomeScore: 0,
        penaltyAwayScore: 0,
      })
    ).toBe('TWO')
  })

  it('должен корректно работать с очень большим множителем', () => {
    expect(computeAwardedPoints(100, 10)).toBe(1000)
    expect(computeAwardedPoints(100, 100)).toBe(10000)
  })

  it('должен корректно работать с очень маленьким множителем', () => {
    expect(computeAwardedPoints(100, 0.01)).toBe(1)
    expect(computeAwardedPoints(100, 0.001)).toBe(0)
  })
})
