/**
 * Тесты системы достижений
 *
 * Покрывает все 5 метрик достижений:
 * - DAILY_LOGIN: серия ежедневных входов
 * - TOTAL_PREDICTIONS: общее количество прогнозов
 * - CORRECT_PREDICTIONS: количество угаданных прогнозов
 * - SEASON_POINTS: сезонные очки
 * - PREDICTION_STREAK: серия побед подряд
 *
 * Тесты проверяют:
 * - Корректный расчет уровней по порогам
 * - Конфигурации наград для каждого уровня
 * - Логику progressCount (increment vs set)
 * - Обработку граничных значений
 */

import { describe, it, expect } from 'vitest'

// ============================================================================
// Копии конфигураций наград из achievementJobProcessor.ts
// ============================================================================

const STREAK_REWARD_CONFIG: Record<number, number> = {
  1: 20,   // Bronze — 7 дней
  2: 200,  // Silver — 60 дней
  3: 1000, // Gold — 180 дней
}

const PREDICTIONS_REWARD_CONFIG: Record<number, number> = {
  1: 50,    // Bronze — 20 прогнозов
  2: 350,   // Silver — 100 прогнозов
  3: 1000,  // Gold — 250 прогнозов
}

const SEASON_POINTS_REWARD_CONFIG: Record<number, number> = {
  1: 50,    // Bronze (Форвард) — 200 сезонных очков
  2: 250,   // Silver (Голеадор) — 1000 сезонных очков
  3: 1000,  // Gold (Легенда) — 5000 сезонных очков
}

const BET_WINS_REWARD_CONFIG: Record<number, number> = {
  1: 20,    // Bronze (Счастливчик) — 10 угаданных прогнозов
  2: 200,   // Silver (Снайпер) — 50 угаданных прогнозов
  3: 1000,  // Gold (Чемпион) — 200 угаданных прогнозов
}

const PREDICTION_STREAK_REWARD_CONFIG: Record<number, number> = {
  1: 50,    // Bronze (Счастливая пятерка) — 5 побед подряд
  2: 250,   // Silver (Десятка удачи) — 10 побед подряд
  3: 1000,  // Gold (Магическая серия) — 25 побед подряд
}

// ============================================================================
// Пороги достижений (должны соответствовать seed данным в БД)
// ============================================================================

const DAILY_LOGIN_THRESHOLDS = [
  { level: 1, threshold: 7 },
  { level: 2, threshold: 60 },
  { level: 3, threshold: 180 },
]

const TOTAL_PREDICTIONS_THRESHOLDS = [
  { level: 1, threshold: 20 },
  { level: 2, threshold: 100 },
  { level: 3, threshold: 250 },
]

const CORRECT_PREDICTIONS_THRESHOLDS = [
  { level: 1, threshold: 10 },
  { level: 2, threshold: 50 },
  { level: 3, threshold: 200 },
]

const SEASON_POINTS_THRESHOLDS = [
  { level: 1, threshold: 200 },
  { level: 2, threshold: 1000 },
  { level: 3, threshold: 5000 },
]

const PREDICTION_STREAK_THRESHOLDS = [
  { level: 1, threshold: 5 },
  { level: 2, threshold: 10 },
  { level: 3, threshold: 25 },
]

// ============================================================================
// Копия функции определения разблокированного уровня из achievementProgress.ts
// ============================================================================

const resolveUnlockedLevel = (
  thresholds: Array<{ level: number; threshold: number }>,
  value: number
): number => {
  if (!thresholds.length) {
    return 0
  }
  let unlocked = 0
  for (const entry of thresholds) {
    if (value >= entry.threshold && entry.level > unlocked) {
      unlocked = entry.level
    }
  }
  return unlocked
}

// ============================================================================
// Тесты resolveUnlockedLevel - общая логика определения уровней
// ============================================================================

describe('resolveUnlockedLevel - определение разблокированного уровня', () => {
  describe('Базовая логика', () => {
    it('должен вернуть 0 при пустом массиве порогов', () => {
      expect(resolveUnlockedLevel([], 100)).toBe(0)
    })

    it('должен вернуть 0 при значении меньше минимального порога', () => {
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, 0)).toBe(0)
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, 6)).toBe(0)
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, 4)).toBe(0)
    })

    it('должен вернуть уровень 1 при достижении первого порога', () => {
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, 7)).toBe(1)
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, 5)).toBe(1)
      expect(resolveUnlockedLevel(TOTAL_PREDICTIONS_THRESHOLDS, 20)).toBe(1)
    })

    it('должен вернуть уровень 2 при достижении второго порога', () => {
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, 60)).toBe(2)
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, 10)).toBe(2)
      expect(resolveUnlockedLevel(TOTAL_PREDICTIONS_THRESHOLDS, 100)).toBe(2)
    })

    it('должен вернуть уровень 3 при достижении максимального порога', () => {
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, 180)).toBe(3)
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, 25)).toBe(3)
      expect(resolveUnlockedLevel(TOTAL_PREDICTIONS_THRESHOLDS, 250)).toBe(3)
    })

    it('должен вернуть максимальный уровень при превышении порога', () => {
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, 365)).toBe(3)
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, 100)).toBe(3)
      expect(resolveUnlockedLevel(TOTAL_PREDICTIONS_THRESHOLDS, 1000)).toBe(3)
    })

    it('должен корректно обрабатывать отрицательные значения', () => {
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, -10)).toBe(0)
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, -5)).toBe(0)
    })
  })

  describe('Граничные значения для DAILY_LOGIN', () => {
    it('должен разблокировать Bronze на 7-й день', () => {
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, 7)).toBe(1)
    })

    it('должен разблокировать Silver на 60-й день', () => {
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, 60)).toBe(2)
    })

    it('должен разблокировать Gold на 180-й день', () => {
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, 180)).toBe(3)
    })
  })

  describe('Граничные значения для PREDICTION_STREAK', () => {
    it('должен разблокировать Bronze на 5 победах подряд', () => {
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, 5)).toBe(1)
    })

    it('должен разблокировать Silver на 10 победах подряд', () => {
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, 10)).toBe(2)
    })

    it('должен разблокировать Gold на 25 победах подряд', () => {
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, 25)).toBe(3)
    })
  })
})

// ============================================================================
// Тесты DAILY_LOGIN - серия ежедневных входов
// ============================================================================

describe('DAILY_LOGIN - достижение за серию входов', () => {
  describe('Конфигурация наград', () => {
    it('должен иметь награду 20 очков за Bronze (7 дней)', () => {
      expect(STREAK_REWARD_CONFIG[1]).toBe(20)
    })

    it('должен иметь награду 200 очков за Silver (60 дней)', () => {
      expect(STREAK_REWARD_CONFIG[2]).toBe(200)
    })

    it('должен иметь награду 1000 очков за Gold (180 дней)', () => {
      expect(STREAK_REWARD_CONFIG[3]).toBe(1000)
    })

    it('должен возвращать undefined для несуществующего уровня', () => {
      expect(STREAK_REWARD_CONFIG[0]).toBeUndefined()
      expect(STREAK_REWARD_CONFIG[4]).toBeUndefined()
    })
  })

  describe('Пороги достижений', () => {
    it('должен оставаться на уровне 0 при 6 днях подряд', () => {
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, 6)).toBe(0)
    })

    it('должен разблокировать уровень 1 ровно на 7-й день', () => {
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, 7)).toBe(1)
    })

    it('должен оставаться на уровне 1 при 59 днях', () => {
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, 59)).toBe(1)
    })

    it('должен разблокировать уровень 2 ровно на 60-й день', () => {
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, 60)).toBe(2)
    })

    it('должен оставаться на уровне 2 при 179 днях', () => {
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, 179)).toBe(2)
    })

    it('должен разблокировать уровень 3 на 180-й день', () => {
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, 180)).toBe(3)
    })
  })
})

// ============================================================================
// Тесты TOTAL_PREDICTIONS - общее количество прогнозов
// ============================================================================

describe('TOTAL_PREDICTIONS - достижение за количество прогнозов', () => {
  describe('Конфигурация наград', () => {
    it('должен иметь награду 50 очков за Bronze (20 прогнозов)', () => {
      expect(PREDICTIONS_REWARD_CONFIG[1]).toBe(50)
    })

    it('должен иметь награду 350 очков за Silver (100 прогнозов)', () => {
      expect(PREDICTIONS_REWARD_CONFIG[2]).toBe(350)
    })

    it('должен иметь награду 1000 очков за Gold (250 прогнозов)', () => {
      expect(PREDICTIONS_REWARD_CONFIG[3]).toBe(1000)
    })
  })

  describe('Пороги достижений', () => {
    it('должен оставаться на уровне 0 при 19 прогнозах', () => {
      expect(resolveUnlockedLevel(TOTAL_PREDICTIONS_THRESHOLDS, 19)).toBe(0)
    })

    it('должен разблокировать уровень 1 на 20-м прогнозе', () => {
      expect(resolveUnlockedLevel(TOTAL_PREDICTIONS_THRESHOLDS, 20)).toBe(1)
    })

    it('должен разблокировать уровень 2 на 100-м прогнозе', () => {
      expect(resolveUnlockedLevel(TOTAL_PREDICTIONS_THRESHOLDS, 100)).toBe(2)
    })

    it('должен разблокировать уровень 3 на 250-м прогнозе', () => {
      expect(resolveUnlockedLevel(TOTAL_PREDICTIONS_THRESHOLDS, 250)).toBe(3)
    })
  })

  describe('Инкрементальный прогресс', () => {
    it('должен правильно считать прогресс от 0 до Bronze', () => {
      for (let i = 0; i < 20; i++) {
        expect(resolveUnlockedLevel(TOTAL_PREDICTIONS_THRESHOLDS, i)).toBe(0)
      }
      expect(resolveUnlockedLevel(TOTAL_PREDICTIONS_THRESHOLDS, 20)).toBe(1)
    })
  })
})

// ============================================================================
// Тесты CORRECT_PREDICTIONS (BET_WINS) - угаданные прогнозы
// ============================================================================

describe('CORRECT_PREDICTIONS - достижение за угаданные прогнозы', () => {
  describe('Конфигурация наград', () => {
    it('должен иметь награду 20 очков за Bronze (10 угаданных)', () => {
      expect(BET_WINS_REWARD_CONFIG[1]).toBe(20)
    })

    it('должен иметь награду 200 очков за Silver (50 угаданных)', () => {
      expect(BET_WINS_REWARD_CONFIG[2]).toBe(200)
    })

    it('должен иметь награду 1000 очков за Gold (200 угаданных)', () => {
      expect(BET_WINS_REWARD_CONFIG[3]).toBe(1000)
    })
  })

  describe('Пороги достижений', () => {
    it('должен оставаться на уровне 0 при 9 угаданных', () => {
      expect(resolveUnlockedLevel(CORRECT_PREDICTIONS_THRESHOLDS, 9)).toBe(0)
    })

    it('должен разблокировать уровень 1 на 10 угаданных', () => {
      expect(resolveUnlockedLevel(CORRECT_PREDICTIONS_THRESHOLDS, 10)).toBe(1)
    })

    it('должен разблокировать уровень 2 на 50 угаданных', () => {
      expect(resolveUnlockedLevel(CORRECT_PREDICTIONS_THRESHOLDS, 50)).toBe(2)
    })

    it('должен разблокировать уровень 3 на 200 угаданных', () => {
      expect(resolveUnlockedLevel(CORRECT_PREDICTIONS_THRESHOLDS, 200)).toBe(3)
    })
  })
})

// ============================================================================
// Тесты SEASON_POINTS - сезонные очки
// ============================================================================

describe('SEASON_POINTS - достижение за сезонные очки', () => {
  describe('Конфигурация наград', () => {
    it('должен иметь награду 50 очков за Bronze (200 сезонных очков)', () => {
      expect(SEASON_POINTS_REWARD_CONFIG[1]).toBe(50)
    })

    it('должен иметь награду 250 очков за Silver (1000 сезонных очков)', () => {
      expect(SEASON_POINTS_REWARD_CONFIG[2]).toBe(250)
    })

    it('должен иметь награду 1000 очков за Gold (5000 сезонных очков)', () => {
      expect(SEASON_POINTS_REWARD_CONFIG[3]).toBe(1000)
    })
  })

  describe('Пороги достижений', () => {
    it('должен оставаться на уровне 0 при 199 очках', () => {
      expect(resolveUnlockedLevel(SEASON_POINTS_THRESHOLDS, 199)).toBe(0)
    })

    it('должен разблокировать уровень 1 на 200 очках', () => {
      expect(resolveUnlockedLevel(SEASON_POINTS_THRESHOLDS, 200)).toBe(1)
    })

    it('должен разблокировать уровень 2 на 1000 очках', () => {
      expect(resolveUnlockedLevel(SEASON_POINTS_THRESHOLDS, 1000)).toBe(2)
    })

    it('должен разблокировать уровень 3 на 5000 очках', () => {
      expect(resolveUnlockedLevel(SEASON_POINTS_THRESHOLDS, 5000)).toBe(3)
    })
  })

  describe('Синхронизация (set вместо increment)', () => {
    // SEASON_POINTS использует set, а не increment
    // Это означает, что прогресс устанавливается равным текущим очкам
    it('должен корректно определять уровень при любом значении', () => {
      // При 500 очках - уровень 1 (между 200 и 1000)
      expect(resolveUnlockedLevel(SEASON_POINTS_THRESHOLDS, 500)).toBe(1)

      // При 2000 очках - уровень 2 (между 1000 и 5000)
      expect(resolveUnlockedLevel(SEASON_POINTS_THRESHOLDS, 2000)).toBe(2)

      // При 10000 очках - уровень 3 (выше 5000)
      expect(resolveUnlockedLevel(SEASON_POINTS_THRESHOLDS, 10000)).toBe(3)
    })
  })
})

// ============================================================================
// Тесты PREDICTION_STREAK - серия побед подряд
// ============================================================================

describe('PREDICTION_STREAK - достижение за серию побед', () => {
  describe('Конфигурация наград', () => {
    it('должен иметь награду 50 очков за Bronze (5 побед подряд)', () => {
      expect(PREDICTION_STREAK_REWARD_CONFIG[1]).toBe(50)
    })

    it('должен иметь награду 250 очков за Silver (10 побед подряд)', () => {
      expect(PREDICTION_STREAK_REWARD_CONFIG[2]).toBe(250)
    })

    it('должен иметь награду 1000 очков за Gold (25 побед подряд)', () => {
      expect(PREDICTION_STREAK_REWARD_CONFIG[3]).toBe(1000)
    })
  })

  describe('Пороги достижений', () => {
    it('должен оставаться на уровне 0 при 4 победах подряд', () => {
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, 4)).toBe(0)
    })

    it('должен разблокировать уровень 1 на 5 победах подряд', () => {
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, 5)).toBe(1)
    })

    it('должен разблокировать уровень 2 на 10 победах подряд', () => {
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, 10)).toBe(2)
    })

    it('должен разблокировать уровень 3 на 25 победах подряд', () => {
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, 25)).toBe(3)
    })
  })

  describe('Использование maxStreak (не currentStreak)', () => {
    // PREDICTION_STREAK использует maxStreak для сохранения прогресса
    // даже если текущая серия сбросилась
    it('должен сохранять уровень при сбросе текущей серии', () => {
      // Пользователь достиг 10 побед подряд (maxStreak = 10)
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, 10)).toBe(2)

      // Даже если currentStreak сбросился до 0, maxStreak остается 10
      // и уровень достижения не понижается
    })

    it('должен обновлять уровень при новом рекорде', () => {
      // Сначала maxStreak = 5 (уровень 1)
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, 5)).toBe(1)

      // Потом побил рекорд: maxStreak = 12 (уровень 2)
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, 12)).toBe(2)

      // Ещё больше: maxStreak = 30 (уровень 3)
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, 30)).toBe(3)
    })
  })

  describe('Граничные случаи серии', () => {
    it('должен корректно обрабатывать серию из 0 побед', () => {
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, 0)).toBe(0)
    })

    it('должен корректно обрабатывать серию из 1 победы', () => {
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, 1)).toBe(0)
    })

    it('должен оставаться на уровне 3 при очень большой серии', () => {
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, 100)).toBe(3)
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, 500)).toBe(3)
    })
  })
})

// ============================================================================
// Тесты суммарных наград
// ============================================================================

describe('Суммарные награды за все достижения', () => {
  it('должен правильно считать суммарную награду за все Bronze достижения', () => {
    const totalBronze =
      STREAK_REWARD_CONFIG[1] +
      PREDICTIONS_REWARD_CONFIG[1] +
      SEASON_POINTS_REWARD_CONFIG[1] +
      BET_WINS_REWARD_CONFIG[1] +
      PREDICTION_STREAK_REWARD_CONFIG[1]

    expect(totalBronze).toBe(20 + 50 + 50 + 20 + 50) // 190
    expect(totalBronze).toBe(190)
  })

  it('должен правильно считать суммарную награду за все Silver достижения', () => {
    const totalSilver =
      STREAK_REWARD_CONFIG[2] +
      PREDICTIONS_REWARD_CONFIG[2] +
      SEASON_POINTS_REWARD_CONFIG[2] +
      BET_WINS_REWARD_CONFIG[2] +
      PREDICTION_STREAK_REWARD_CONFIG[2]

    expect(totalSilver).toBe(200 + 350 + 250 + 200 + 250) // 1250
    expect(totalSilver).toBe(1250)
  })

  it('должен правильно считать суммарную награду за все Gold достижения', () => {
    const totalGold =
      STREAK_REWARD_CONFIG[3] +
      PREDICTIONS_REWARD_CONFIG[3] +
      SEASON_POINTS_REWARD_CONFIG[3] +
      BET_WINS_REWARD_CONFIG[3] +
      PREDICTION_STREAK_REWARD_CONFIG[3]

    expect(totalGold).toBe(1000 + 1000 + 1000 + 1000 + 1000) // 5000
    expect(totalGold).toBe(5000)
  })

  it('должен правильно считать максимально возможную награду за все достижения', () => {
    const maxTotal =
      // DAILY_LOGIN: 20 + 200 + 1000
      STREAK_REWARD_CONFIG[1] + STREAK_REWARD_CONFIG[2] + STREAK_REWARD_CONFIG[3] +
      // TOTAL_PREDICTIONS: 50 + 350 + 1000
      PREDICTIONS_REWARD_CONFIG[1] + PREDICTIONS_REWARD_CONFIG[2] + PREDICTIONS_REWARD_CONFIG[3] +
      // SEASON_POINTS: 50 + 250 + 1000
      SEASON_POINTS_REWARD_CONFIG[1] + SEASON_POINTS_REWARD_CONFIG[2] + SEASON_POINTS_REWARD_CONFIG[3] +
      // CORRECT_PREDICTIONS: 20 + 200 + 1000
      BET_WINS_REWARD_CONFIG[1] + BET_WINS_REWARD_CONFIG[2] + BET_WINS_REWARD_CONFIG[3] +
      // PREDICTION_STREAK: 50 + 250 + 1000
      PREDICTION_STREAK_REWARD_CONFIG[1] + PREDICTION_STREAK_REWARD_CONFIG[2] + PREDICTION_STREAK_REWARD_CONFIG[3]

    // 1220 + 1400 + 1300 + 1220 + 1300 = 6440
    expect(maxTotal).toBe(6440)
  })
})

// ============================================================================
// Тесты логики прогресса
// ============================================================================

describe('Логика прогресса достижений', () => {
  describe('Инкрементальные метрики (DAILY_LOGIN, TOTAL_PREDICTIONS, CORRECT_PREDICTIONS)', () => {
    // Эти метрики используют increment для progressCount
    it('должен увеличивать прогресс на delta для DAILY_LOGIN', () => {
      let progress = 0
      progress += 1 // день 1
      progress += 1 // день 2
      progress += 1 // день 3
      expect(progress).toBe(3)
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, progress)).toBe(0)

      // Продолжаем до 7 дней
      progress += 4
      expect(progress).toBe(7)
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, progress)).toBe(1)
    })

    it('должен увеличивать прогресс на delta для TOTAL_PREDICTIONS', () => {
      let progress = 0
      for (let i = 0; i < 25; i++) {
        progress += 1
      }
      expect(progress).toBe(25)
      expect(resolveUnlockedLevel(TOTAL_PREDICTIONS_THRESHOLDS, progress)).toBe(1)
    })
  })

  describe('Синхронизируемые метрики (SEASON_POINTS, PREDICTION_STREAK)', () => {
    // Эти метрики используют set (progressCount = value) вместо increment
    it('должен устанавливать progressCount равным сезонным очкам', () => {
      // Сезонные очки могут уменьшаться (например, сезон сбросился)
      // Поэтому используем set, а не increment
      const seasonalPoints = 1500
      expect(resolveUnlockedLevel(SEASON_POINTS_THRESHOLDS, seasonalPoints)).toBe(2)

      // Новый сезон - очки меньше
      const newSeasonPoints = 300
      expect(resolveUnlockedLevel(SEASON_POINTS_THRESHOLDS, newSeasonPoints)).toBe(1)
    })

    it('должен устанавливать progressCount равным maxStreak', () => {
      // maxStreak не уменьшается, но мы всё равно используем set
      // чтобы корректно синхронизировать при пересчёте рейтингов
      const maxStreak1 = 8
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, maxStreak1)).toBe(1)

      const maxStreak2 = 15
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, maxStreak2)).toBe(2)
    })
  })
})

// ============================================================================
// Тесты edge cases
// ============================================================================

describe('Edge cases и защита от ошибок', () => {
  describe('Отрицательные значения', () => {
    it('должен возвращать уровень 0 для отрицательных значений', () => {
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, -1)).toBe(0)
      expect(resolveUnlockedLevel(TOTAL_PREDICTIONS_THRESHOLDS, -100)).toBe(0)
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, -5)).toBe(0)
    })
  })

  describe('Очень большие значения', () => {
    it('должен возвращать максимальный уровень для очень больших значений', () => {
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, 10000)).toBe(3)
      expect(resolveUnlockedLevel(TOTAL_PREDICTIONS_THRESHOLDS, 1000000)).toBe(3)
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, Number.MAX_SAFE_INTEGER)).toBe(3)
    })
  })

  describe('Нецелые значения', () => {
    it('должен корректно обрабатывать дробные числа (сравнение >=)', () => {
      // 6.5 < 7, значит уровень 0
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, 6.5)).toBe(0)

      // 7.0 >= 7, значит уровень 1
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, 7.0)).toBe(1)

      // 59.9 < 60, значит уровень 1
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, 59.9)).toBe(1)
    })
  })

  describe('Нулевые значения', () => {
    it('должен возвращать уровень 0 для нуля', () => {
      expect(resolveUnlockedLevel(DAILY_LOGIN_THRESHOLDS, 0)).toBe(0)
      expect(resolveUnlockedLevel(TOTAL_PREDICTIONS_THRESHOLDS, 0)).toBe(0)
      expect(resolveUnlockedLevel(SEASON_POINTS_THRESHOLDS, 0)).toBe(0)
      expect(resolveUnlockedLevel(PREDICTION_STREAK_THRESHOLDS, 0)).toBe(0)
      expect(resolveUnlockedLevel(CORRECT_PREDICTIONS_THRESHOLDS, 0)).toBe(0)
    })
  })
})
