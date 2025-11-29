# Express Bets (Экспресс-прогнозы) — Фаза 1

**Дата:** 2025-11-29

## Что реализовано

### Концепция

Экспресс — комбинированный прогноз из 2-4 событий из **разных матчей**. Очки начисляются только если **ВСЕ** события угаданы. При выигрыше очки умножаются на коэффициент:

| Кол-во событий | Множитель |
|----------------|-----------|
| 2 | ×1.2 |
| 3 | ×1.5 |
| 4 | ×2.5 |

### Ограничения

- **Максимум 2 экспресса** за 6 дней (как и лимит обычных прогнозов)
- События должны быть из **разных матчей**
- Только **PENDING** матчи (нельзя добавить уже начавшийся матч)

---

## Изменения в БД

### Новые таблицы

1. **express_bet** — экспресс-прогноз
   - `express_bet_id` — ID
   - `user_id` — владелец
   - `status` — PENDING/WON/LOST/CANCELLED/VOID
   - `multiplier` — коэффициент (зависит от кол-ва событий)
   - `base_points` — сумма базовых очков всех событий
   - `score_awarded` — начисленные очки (после расчёта)
   - `created_at`, `resolved_at`

2. **express_bet_item** — элемент экспресса
   - `express_bet_item_id` — ID
   - `express_id` — FK на express_bet
   - `template_id` — FK на prediction_template
   - `selection` — выбор пользователя
   - `status` — статус элемента
   - `base_points` — базовые очки шаблона
   - `resolved_at`

### Новый Enum

```prisma
enum ExpressStatus {
  PENDING     // Ожидает расчёта
  WON         // Все события угаданы
  LOST        // Хотя бы одно не угадано
  CANCELLED   // Отменён (матч отменён)
  VOID        // Аннулирован
}
```

### Миграция

`prisma/migrations/20251129074419_express_bets/`

---

## Backend API

### Новые endpoints

| Метод | URL | Описание |
|-------|-----|----------|
| POST | `/api/predictions/express` | Создание экспресса |
| GET | `/api/predictions/express/my` | Список своих экспрессов |
| GET | `/api/predictions/express/week-count` | Счётчик за неделю |
| GET | `/api/predictions/express/config` | Конфигурация (множители, лимиты) |
| GET | `/api/predictions/express/:id` | Конкретный экспресс |

### Пример создания экспресса

```json
POST /api/predictions/express
{
  "items": [
    { "templateId": "123", "selection": "ONE" },
    { "templateId": "456", "selection": "OVER_2.5" },
    { "templateId": "789", "selection": "NO" }
  ]
}
```

### Логика расчёта

При финализации матча:
1. Расчитываются обычные PredictionEntry
2. Находятся ExpressBetItem связанные с этим матчем
3. Для каждого элемента вычисляется статус на основе его selection
4. Если все элементы экспресса расчитаны — рассчитывается сам экспресс:
   - Если все WON → ExpressBet = WON, начисляются очки × множитель
   - Если хоть один LOST → ExpressBet = LOST, очков 0
   - При VOID элементах — пересчёт с меньшим множителем

---

## Файлы

### Новые файлы

- `backend/src/services/expressService.ts` — бизнес-логика
- `backend/src/routes/expressRoutes.ts` — API endpoints

### Изменённые файлы

- `prisma/schema.prisma` — добавлены модели ExpressBet, ExpressBetItem, enum ExpressStatus
- `backend/src/server.ts` — регистрация expressRoutes
- `backend/src/services/predictionConstants.ts` — константы экспрессов
- `backend/src/services/predictionSettlement.ts` — интеграция расчёта экспрессов
- `shared/types.ts` — типы для фронтенда

---

## Подготовка к Фазе 2 (Frontend)

Добавлены типы в `shared/types.ts`:

- `ExpressStatus`
- `ExpressBetItemView`
- `ExpressBetView`
- `ExpressConfig`
- `ExpressWeekCount`
- `CreateExpressItemInput`

---

## Проверки

✅ TypeScript backend — без ошибок  
✅ ESLint backend — без ошибок  
✅ Build backend — успешен  
✅ TypeScript frontend — без ошибок  
✅ ESLint frontend — без ошибок  
✅ Build frontend — успешен  
✅ TypeScript admin — без ошибок  
✅ ESLint admin — без ошибок  
✅ Build admin — успешен  

---

## Следующие шаги (Фаза 2)

1. Интерфейс создания экспресса (выбор событий, корзина)
2. Список экспрессов в "Мои прогнозы"
3. Анимации выигрыша/проигрыша
4. Инвалидация кэша при создании/расчёте
