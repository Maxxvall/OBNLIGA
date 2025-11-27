# Анализ монетизации через подписки Telegram Stars ⭐

## Текущее состояние проекта

### Существующая инфраструктура
- **Shop модуль** — магазин физических товаров с заказами в рублях
- **Баланс пользователя** — `balance` в `AppUser` (не используется активно)
- **Достижения** — система уровней и прогресса
- **Подписки на команды** — уведомления о матчах через Telegram Bot
- **Daily Rewards** — ежедневные награды (очки)

### Текущие ограничения
- Нет системы премиум-функционала
- Нет интеграции с Telegram Payments
- Весь функционал открыт бесплатно

---

## Предложенные уровни подписки

### 🌱 **ROOKIE** (Бесплатный)
Базовый доступ для всех пользователей.

### 🔥 **FAN** (Средний) — ~49-99⭐/месяц
Для активных болельщиков.

### 🏆 **LEGEND** (Премиум) — ~199-299⭐/месяц
Полный доступ ко всем функциям.

---

## Распределение функционала по уровням

### Базовые функции (ROOKIE — бесплатно)
| Функция | Ограничение |
|---------|-------------|
| Просмотр матчей и результатов | ✅ Полный доступ |
| Турнирная таблица | ✅ Полный доступ |
| Профиль и базовая статистика | ✅ Полный доступ |
| Подписка на **1 команду** | ✅ Только одна |
| Прогнозы на матчи | ⚠️ **3 прогноза в неделю** |
| Ежедневные награды | ⚠️ **Базовые** (1-5 очков) |
| Достижения | ⚠️ **Только общие** (5-10 типов) |
| История матчей команд | ⚠️ **Последние 10 матчей** |
| Комментарии к матчам | ⚠️ **3 комментария в день** |

### Расширенные функции (FAN — средний уровень)
| Функция | Ограничение |
|---------|-------------|
| Всё из ROOKIE | ✅ |
| Подписка на **5 команд** | ✅ |
| Прогнозы на матчи | ⚠️ **15 прогнозов в неделю** |
| Ежедневные награды | ✅ **Улучшенные** (×1.5 множитель) |
| Достижения | ✅ **Все общие + FAN-only** |
| История матчей | ✅ **Последние 50 матчей** |
| Комментарии | ✅ **Безлимитно** |
| Уведомления о голах | ✅ |
| Детальная статистика игроков | ✅ |
| **Без рекламы** | ✅ |

### Полный доступ (LEGEND — премиум)
| Функция | Доступ |
|---------|--------|
| Всё из FAN | ✅ |
| Подписка на **все команды** | ✅ Безлимитно |
| Прогнозы | ✅ **Безлимитно** |
| Ежедневные награды | ✅ **Максимальные** (×2 множитель) |
| Все достижения | ✅ Включая эксклюзивные |
| История матчей | ✅ **Полная история** |
| Экспорт статистики | ✅ CSV/PDF |
| API доступ | ✅ Персональный ключ |
| Приоритетная поддержка | ✅ |
| **Эксклюзивный badge** в профиле | 🏆 |
| Ранний доступ к новым функциям | ✅ |

---

## Техническая реализация

### 1. Модель базы данных

```prisma
// Добавить в schema.prisma

enum SubscriptionTier {
  ROOKIE   // Бесплатный
  FAN      // Средний
  LEGEND   // Премиум
}

enum SubscriptionStatus {
  ACTIVE
  EXPIRED
  CANCELLED
}

model UserSubscription {
  id              Int                @id @default(autoincrement()) @map("subscription_id")
  userId          Int                @unique @map("user_id")
  tier            SubscriptionTier   @default(ROOKIE)
  status          SubscriptionStatus @default(ACTIVE)
  starsPaid       Int?               @map("stars_paid")     // Сколько Stars заплачено
  expiresAt       DateTime?          @map("expires_at")     // null = бессрочный (ROOKIE)
  autoRenew       Boolean            @default(true) @map("auto_renew")
  telegramPayId   String?            @map("telegram_pay_id") // ID транзакции Telegram
  createdAt       DateTime           @default(now()) @map("created_at")
  updatedAt       DateTime           @updatedAt @map("updated_at")
  
  user            AppUser            @relation(fields: [userId], references: [id], onDelete: Cascade)
  history         SubscriptionHistory[]

  @@index([expiresAt, status])
  @@map("user_subscription")
}

model SubscriptionHistory {
  id              Int                @id @default(autoincrement()) @map("history_id")
  subscriptionId  Int                @map("subscription_id")
  previousTier    SubscriptionTier   @map("previous_tier")
  newTier         SubscriptionTier   @map("new_tier")
  starsPaid       Int?               @map("stars_paid")
  telegramPayId   String?            @map("telegram_pay_id")
  reason          String?            // upgrade, downgrade, expired, refund
  createdAt       DateTime           @default(now()) @map("created_at")
  
  subscription    UserSubscription   @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
  
  @@index([subscriptionId, createdAt])
  @@map("subscription_history")
}

model SubscriptionPlan {
  id              Int                @id @default(autoincrement()) @map("plan_id")
  tier            SubscriptionTier   @unique
  starsPrice      Int                @map("stars_price")    // Цена в Stars
  durationDays    Int                @map("duration_days")  // 30 для месячной
  name            String             // "FAN", "LEGEND"
  description     String?
  features        Json               // Список фич в JSON
  isActive        Boolean            @default(true) @map("is_active")
  sortOrder       Int                @default(0) @map("sort_order")
  
  @@map("subscription_plan")
}
```

### 2. Интеграция с Telegram Stars

```typescript
// backend/src/services/telegramPayments.ts

import { Bot, InlineKeyboard } from 'grammy'

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!)

interface CreateInvoiceParams {
  userId: number
  tier: 'FAN' | 'LEGEND'
  starsAmount: number
}

export async function createStarsInvoice(params: CreateInvoiceParams): Promise<string> {
  const { userId, tier, starsAmount } = params
  
  // Создаём invoice link для Telegram Stars
  const invoiceLink = await bot.api.createInvoiceLink({
    title: `Подписка ${tier}`,
    description: `Подписка уровня ${tier} на 30 дней`,
    payload: JSON.stringify({ userId, tier, timestamp: Date.now() }),
    provider_token: '', // Пустой для Stars
    currency: 'XTR', // Telegram Stars
    prices: [{ label: `Подписка ${tier}`, amount: starsAmount }],
  })
  
  return invoiceLink
}

// Webhook handler для успешной оплаты
export async function handleSuccessfulPayment(
  telegramId: bigint,
  payload: string,
  telegramPaymentChargeId: string
): Promise<void> {
  const { userId, tier } = JSON.parse(payload)
  
  await prisma.$transaction(async (tx) => {
    // Обновляем подписку
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 30)
    
    const subscription = await tx.userSubscription.upsert({
      where: { userId },
      create: {
        userId,
        tier,
        status: 'ACTIVE',
        expiresAt,
        telegramPayId: telegramPaymentChargeId,
      },
      update: {
        tier,
        status: 'ACTIVE',
        expiresAt,
        telegramPayId: telegramPaymentChargeId,
      },
    })
    
    // Записываем в историю
    await tx.subscriptionHistory.create({
      data: {
        subscriptionId: subscription.id,
        previousTier: subscription.tier,
        newTier: tier,
        telegramPayId: telegramPaymentChargeId,
        reason: 'purchase',
      },
    })
  })
}
```

### 3. Middleware для проверки доступа

```typescript
// backend/src/middleware/tierGuard.ts

import { FastifyRequest, FastifyReply } from 'fastify'

type TierLevel = 'ROOKIE' | 'FAN' | 'LEGEND'

const TIER_HIERARCHY: Record<TierLevel, number> = {
  ROOKIE: 0,
  FAN: 1,
  LEGEND: 2,
}

export function requireTier(minTier: TierLevel) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.userId // из auth middleware
    
    const subscription = await prisma.userSubscription.findUnique({
      where: { userId },
      select: { tier: true, status: true, expiresAt: true },
    })
    
    // Проверяем статус и срок
    const isActive = subscription?.status === 'ACTIVE' &&
      (!subscription.expiresAt || subscription.expiresAt > new Date())
    
    const currentTier: TierLevel = isActive ? subscription!.tier : 'ROOKIE'
    
    if (TIER_HIERARCHY[currentTier] < TIER_HIERARCHY[minTier]) {
      return reply.status(403).send({
        ok: false,
        error: 'subscription_required',
        requiredTier: minTier,
        currentTier,
      })
    }
    
    // Добавляем tier в request для использования в handlers
    request.userTier = currentTier
  }
}

// Использование:
fastify.get('/api/stats/export', 
  { preHandler: requireTier('LEGEND') },
  exportStatsHandler
)
```

### 4. Лимиты на фронтенде

```typescript
// frontend/src/utils/tierLimits.ts

export const TIER_LIMITS = {
  ROOKIE: {
    clubSubscriptions: 1,
    predictionsPerWeek: 3,
    commentsPerDay: 3,
    matchHistoryDays: 30,
    dailyRewardMultiplier: 1,
  },
  FAN: {
    clubSubscriptions: 5,
    predictionsPerWeek: 15,
    commentsPerDay: Infinity,
    matchHistoryDays: 180,
    dailyRewardMultiplier: 1.5,
  },
  LEGEND: {
    clubSubscriptions: Infinity,
    predictionsPerWeek: Infinity,
    commentsPerDay: Infinity,
    matchHistoryDays: Infinity,
    dailyRewardMultiplier: 2,
  },
} as const

export function canSubscribeToClub(
  tier: keyof typeof TIER_LIMITS,
  currentSubscriptions: number
): boolean {
  return currentSubscriptions < TIER_LIMITS[tier].clubSubscriptions
}
```

---

## Нагрузка на инфраструктуру

### База данных (PostgreSQL)

| Операция | Частота | Индекс | Нагрузка |
|----------|---------|--------|----------|
| Проверка tier | Каждый API-запрос | `user_subscription.userId` | ⚠️ **Высокая** |
| Проверка expiresAt | Cron каждый час | `expiresAt, status` | 🟢 Низкая |
| Запись истории | При оплате | `subscription_id` | 🟢 Низкая |

**Оптимизация:**
```sql
-- Покрывающий индекс для быстрой проверки
CREATE INDEX user_sub_tier_check_idx 
ON user_subscription (user_id) 
INCLUDE (tier, status, expires_at);
```

**Оценка роста:**
- +2 таблицы (~1-2 KB на пользователя)
- +1-2 запроса на каждый API-вызов

### Redis (кэширование)

```typescript
// Кэшируем tier пользователя
const TIER_CACHE_TTL = 300 // 5 минут

async function getUserTier(userId: number): Promise<TierLevel> {
  const cacheKey = `user:${userId}:tier`
  
  const cached = await redis.get(cacheKey)
  if (cached) return cached as TierLevel
  
  const subscription = await prisma.userSubscription.findUnique({
    where: { userId },
    select: { tier: true, status: true, expiresAt: true },
  })
  
  const tier = (subscription?.status === 'ACTIVE' && 
    (!subscription.expiresAt || subscription.expiresAt > new Date()))
    ? subscription.tier
    : 'ROOKIE'
  
  await redis.setex(cacheKey, TIER_CACHE_TTL, tier)
  return tier
}
```

**Дополнительная память Redis:**
- ~50 байт на пользователя
- При 10K пользователей: ~500 KB

### Сервер (CPU/Memory)

| Компонент | Изменение | Влияние |
|-----------|-----------|---------|
| Middleware проверки | +1 Redis GET | 🟢 Минимальное |
| Webhook обработка | ~100ms на оплату | 🟢 Редко |
| Cron expired check | 1 раз/час | 🟢 Минимальное |

**Общая оценка:** Нагрузка увеличится на **5-10%** при правильном кэшировании.

---

## Сложности реализации

### 1. Интеграция Telegram Payments ⚠️ **Средняя**
- Нужен `pre_checkout_query` handler
- Webhook для `successful_payment`
- Обработка refunds
- Тестирование в sandbox

### 2. Миграция существующих пользователей 🟢 **Низкая**
- Все получают ROOKIE по умолчанию
- Не ломает существующий функционал

### 3. Frontend ограничения ⚠️ **Средняя**
- Нужны UX для "апгрейд" промптов
- Graceful degradation при лимитах
- Страница управления подпиской

### 4. Синхронизация состояния ⚠️ **Средняя**
- Webhook может прийти с задержкой
- Нужна polling стратегия для проверки

### 5. Обработка истекших подписок 🟢 **Низкая**
- Cron job раз в час
- Downgrade до ROOKIE

---

## Дополнительные идеи для монетизации

### Разовые покупки (не подписка)
| Товар | Цена | Описание |
|-------|------|----------|
| Кастомный badge | 50⭐ | Уникальная иконка в профиле |
| Смена никнейма | 30⭐ | Один раз |
| Boost прогноза | 10⭐ | ×2 очки за один прогноз |
| Эксклюзивная тема | 100⭐ | Кастомизация интерфейса |

### Функции для добавления в LEGEND
- **Fantasy League** — собери свою команду
- **Аналитика прогнозов** — графики успешности
- **Турнирные таблицы прогнозистов** — отдельный рейтинг
- **Push-уведомления** — напоминания о матчах
- **Интеграция с календарём** — экспорт расписания

---

## Рекомендуемый план внедрения

### Фаза 1: Инфраструктура (1-2 недели)
1. ✅ Модели БД + миграция
2. ✅ Telegram Payments webhook
3. ✅ Middleware проверки tier
4. ✅ Redis кэширование tier

### Фаза 2: Ограничения (1 неделя)
1. ⬜ Лимит прогнозов
2. ⬜ Лимит подписок на команды
3. ⬜ Лимит комментариев

### Фаза 3: UI (1-2 недели)
1. ⬜ Страница подписок
2. ⬜ Кнопки "Upgrade" в интерфейсе
3. ⬜ Badge в профиле
4. ⬜ Страница управления подпиской

### Фаза 4: Аналитика (постоянно)
1. ⬜ Метрики конверсии
2. ⬜ A/B тесты цен
3. ⬜ Отслеживание churn

---

## Ценообразование (рекомендация)

| Уровень | Stars/месяц | ~USD | ~RUB |
|---------|-------------|------|------|
| ROOKIE | 0 | $0 | 0₽ |
| FAN | 75⭐ | ~$1.50 | ~150₽ |
| LEGEND | 200⭐ | ~$4.00 | ~400₽ |

> 💡 **Совет:** Начните с низких цен для набора базы подписчиков, затем постепенно повышайте.

---

## Заключение

Внедрение системы подписок через Telegram Stars — **выполнимая задача** с умеренной сложностью. Основные преимущества:

✅ Нативная интеграция с Telegram  
✅ Низкий порог входа для пользователей  
✅ Минимальная дополнительная нагрузка на сервер  
✅ Понятная модель монетизации  

Главные риски:
- Пользователи могут уйти при жёстких ограничениях
- Необходим баланс между free и paid функционалом
- Требуется постоянный мониторинг метрик
