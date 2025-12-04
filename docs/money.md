# DeepWiki Q&A with Code Context for Repository: Maxxvall/OBNLIGA
## Q1
хочу добавить систему монетизации через подписки Telegram Stars, ## Предложенные уровни подписки

### 🌱 **ROOKIE** (Бесплатный)
Базовый доступ для всех пользователей.

### 🔥 **FAN** (Средний) — ~49-99⭐/месяц
Для активных болельщиков.

### 🏆 **LEGEND** (Премиум) — ~199-299⭐/месяц
Полный доступ ко всем функциям.


что мне лучше всего в них включить и как это реализовать? составь четкий план внедрения
### Answer
# План внедрения системы монетизации через Telegram Stars

Изучив вашу кодовую базу, вот детальный план распределения функций и внедрения системы подписок:

## 📊 Распределение функций по уровням

### 🌱 **ROOKIE** (Бесплатный)
**Базовые функции:**
- ✅ Просмотр расписания и результатов матчей
- ✅ Прогнозы: **5 прогнозов/неделя** (текущий лимит 10) OBNLIGA:9-9 
- ✅ Экспресс-ставки: **1 экспресс/6 дней, макс. 2 события** (текущий лимит 2 экспресса по 4 события) OBNLIGA:40-45 
- ✅ Ежедневные награды: **стандартные очки** (1-30) OBNLIGA:24-32 
- ✅ Рейтинги: только просмотр текущего сезона
- ✅ Подписки: **2 команды максимум**
- ✅ Достижения: базовые уровни
- ❌ Нет доступа к магазину

### 🔥 **FAN** (49-99⭐/месяц)
**Расширенные возможности:**
- ✅ Прогнозы: **15 прогнозов/неделя** (+150% к базовому)
- ✅ Экспресс-ставки: **3 экспресса/6 дней, макс. 4 события** (+200% экспрессов)
- ✅ Ежедневные награды: **бонус +50%** (например, день 7 даёт 45 очков вместо 30)
- ✅ Рейтинги: доступ к годовому рейтингу OBNLIGA:884-887 
- ✅ Подписки: **10 команд** + приоритетные уведомления за 60 минут OBNLIGA:83-84 
- ✅ Магазин: **скидка 10%** на все товары
- ✅ Значок 🔥 в рейтинге
- ✅ Расширенная статистика прогнозов
- ✅ История всех прогнозов (не только последние 100) OBNLIGA:414-420 

### 🏆 **LEGEND** (199-299⭐/месяц)
**Полный доступ:**
- ✅ Прогнозы: **неограниченно** (без недельного лимита)
- ✅ Экспресс-ставки: **5 экспрессов/6 дней, макс. 6 событий**
- ✅ Ежедневные награды: **бонус +100%** (день 7 = 60 очков)
- ✅ Рейтинги: эксклюзивный доступ к историческим снимкам OBNLIGA:565-577 
- ✅ Подписки: **неограниченное количество команд** + уведомления за 1440 минут (24 часа)
- ✅ Магазин: **скидка 20%** + ранний доступ к новым товарам
- ✅ Значок 🏆 в рейтинге
- ✅ Приоритетная поддержка
- ✅ Эксклюзивные достижения
- ✅ Доступ к детальной аналитике матчей
- ✅ Возможность создавать кастомные прогнозы OBNLIGA:500-517 

## 🛠️ Технический план внедрения

### **Этап 1: Расширение базы данных (1-2 дня)**

Добавить в `prisma/schema.prisma`: OBNLIGA:123-159 

```prisma
enum SubscriptionTier {
  ROOKIE
  FAN
  LEGEND
}

model UserSubscription {
  id                BigInt           @id @default(autoincrement())
  userId            Int              @map("user_id")
  tier              SubscriptionTier @default(ROOKIE)
  starsPaid         Int              @default(0) @map("stars_paid")
  telegramPaymentId String?          @unique @map("telegram_payment_id")
  startDate         DateTime         @default(now()) @map("start_date")
  endDate           DateTime         @map("end_date")
  isActive          Boolean          @default(true) @map("is_active")
  autoRenew         Boolean          @default(false) @map("auto_renew")
  createdAt         DateTime         @default(now()) @map("created_at")
  updatedAt         DateTime         @updatedAt @map("updated_at")
  
  appUser AppUser @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@index([userId, isActive], map: "user_subscription_user_active_idx")
  @@index([endDate], map: "user_subscription_end_date_idx")
  @@map("user_subscription")
}

model SubscriptionHistory {
  id          BigInt           @id @default(autoincrement())
  userId      Int              @map("user_id")
  tier        SubscriptionTier
  action      String           // 'purchased', 'renewed', 'cancelled', 'expired'
  starsPaid   Int?             @map("stars_paid")
  metadata    Json?
  createdAt   DateTime         @default(now()) @map("created_at")
  
  @@index([userId, createdAt], map: "subscription_history_user_date_idx")
  @@map("subscription_history")
}
```

Обновить модель `AppUser`: OBNLIGA:123-159 

```prisma
model AppUser {
  // ... существующие поля ...
  currentTier         SubscriptionTier  @default(ROOKIE) @map("current_tier")
  subscriptions       UserSubscription[]
}
```

### **Этап 2: Сервисный слой подписок (2-3 дня)**

Создать `backend/src/services/subscriptionService.ts`:

```typescript
// Функции для проверки лимитов на основе tier
export const getPredictionLimit = (tier: SubscriptionTier): number | null
export const getExpressLimit = (tier: SubscriptionTier): number
export const getExpressMaxItems = (tier: SubscriptionTier): number
export const getDailyRewardMultiplier = (tier: SubscriptionTier): number
export const getClubSubscriptionLimit = (tier: SubscriptionTier): number | null
export const getShopDiscount = (tier: SubscriptionTier): number
export const canAccessHistoricalRatings = (tier: SubscriptionTier): boolean
```

Модифицировать константы: OBNLIGA:9-9 

```typescript
// Вместо константы сделать функцию
export const getPredictionWeeklyLimit = (tier: SubscriptionTier): number | null
```

### **Этап 3: Интеграция Telegram Stars API (3-4 дня)**

Создать `backend/src/services/telegramPaymentService.ts`:

```typescript
// Интеграция с Telegram Payments API
export const createInvoice = async (userId: number, tier: SubscriptionTier)
export const handleSuccessfulPayment = async (paymentData: TelegramPaymentInfo)
export const verifyPayment = async (telegramPaymentId: string)
export const cancelSubscription = async (userId: number)
export const checkSubscriptionStatus = async (userId: number)
```

Использовать Grammy для обработки платежей: OBNLIGA:38-38 

```typescript
bot.on('pre_checkout_query', handlePreCheckout)
bot.on('message:successful_payment', handleSuccessfulPayment)
```

### **Этап 4: Middleware для проверки подписки (1-2 дня)**

Создать `backend/src/utils/subscriptionMiddleware.ts`:

```typescript
export const requireTier = (minTier: SubscriptionTier) => {
  return async (request, reply) => {
    const user = await getUserWithSubscription(request)
    if (user.currentTier < minTier) {
      return reply.status(403).send({ 
        ok: false, 
        error: 'subscription_required',
        requiredTier: minTier,
        currentTier: user.currentTier
      })
    }
  }
}
```

### **Этап 5: Модификация существующих эндпоинтов (3-5 дней)**

**Прогнозы:** OBNLIGA:530-543 

```typescript
// Изменить проверку лимита
const userTier = await getUserTier(user.id)
const weeklyLimit = getPredictionWeeklyLimit(userTier)
if (weeklyLimit !== null && weeklyCount >= weeklyLimit) {
  return reply.status(429).send({ 
    ok: false, 
    error: 'weekly_limit_reached',
    upgradeRequired: true
  })
}
```

**Экспресс-ставки:** OBNLIGA:120-132 

```typescript
// Проверять лимиты на основе tier
const userTier = await getUserTier(user.id)
const expressLimit = getExpressLimit(userTier)
const maxItems = getExpressMaxItems(userTier)
```

**Ежедневные награды:** OBNLIGA:331-331 

```typescript
// Применять множитель
const multiplier = await getDailyRewardMultiplier(userId)
const finalPoints = reward.points * multiplier
await createPointAdjustments(tx, userId, finalPoints, nextDay)
```

**Магазин:** OBNLIGA:1-10 

```typescript
// Применять скидку при создании заказа
const discount = await getShopDiscount(user.id)
const discountedTotal = Math.round(totalCents * (1 - discount))
```

**Подписки:** OBNLIGA:192-211 

```typescript
// Проверять лимит команд
const currentCount = await prisma.clubSubscription.count({ where: { userId } })
const limit = getClubSubscriptionLimit(userTier)
if (limit !== null && currentCount >= limit) {
  return reply.status(403).send({ 
    ok: false, 
    error: 'subscription_limit_reached' 
  })
}
```

### **Этап 6: Frontend интеграция (3-4 дня)**

Создать компоненты:
- `SubscriptionCard.tsx` - карточка подписки
- `SubscriptionModal.tsx` - модальное окно выбора
- `SubscriptionBadge.tsx` - значок tier в UI
- `UpgradePrompt.tsx` - призыв к апгрейду при достижении лимита

Добавить в store: OBNLIGA:1-10 

```typescript
interface AppState {
  // ... существующие поля ...
  userTier: SubscriptionTier
  subscriptionLimits: SubscriptionLimits
}
```

### **Этап 7: Роуты подписок (2 дня)**

Создать `backend/src/routes/subscriptionPaymentRoutes.ts`:

```typescript
POST   /api/subscriptions/create-invoice  // Создать инвойс
GET    /api/subscriptions/my              // Текущая подписка
POST   /api/subscriptions/cancel          // Отменить автопродление
GET    /api/subscriptions/history         // История платежей
GET    /api/subscriptions/limits          // Текущие лимиты пользователя
```

### **Этап 8: Cron задачи (1-2 дня)**

Добавить в `backend/src/routes/cronRoutes.ts`: OBNLIGA:97-97 

```typescript
// Проверка истекших подписок каждый час
POST /api/cron/check-expired-subscriptions
// Уведомления о скором истечении (за 3 дня)
POST /api/cron/send-renewal-reminders
```

### **Этап 9: Тестирование и развертывание (3-5 дней)**

1. **Unit тесты** для сервисных функций
2. **Integration тесты** для payment flow
3. **E2E тесты** с Telegram Test Environment
4. **Load тесты** для проверки производительности
5. **Безопасность**: валидация платежей, защита от накрутки

## 📈 Рекомендации по ценообразованию

### Оптимальные цены на основе анализа:
- **FAN**: **69⭐/месяц** (~$0.99 USD)
- **LEGEND**: **249⭐/месяц** (~$3.49 USD)

### Специальные предложения:
- **Первый месяц -30%** для новых подписчиков
- **Годовая подписка -20%** (FAN: 690⭐/год, LEGEND: 2490⭐/год)
- **Реферальная программа**: пригласи друга → +7 дней подписки

## 🎯 Метрики успеха

Добавить аналитику:
1. **Conversion rate**: ROOKIE → FAN → LEGEND
2. **Churn rate**: отток подписчиков
3. **ARPU** (Average Revenue Per User)
4. **Feature usage**: какие функции используют платные пользователи
5. **Upgrade triggers**: что мотивирует апгрейд (лимиты, функции)

## ⚠️ Важные замечания

1. **Постепенное внедрение лимитов**: Текущие пользователи не должны резко потерять функции. Используйте grace period 30 дней.

2. **Прозрачность**: Четко показывайте лимиты и преимущества каждого tier.

3. **Telegram Guidelines**: Следуйте правилам Telegram Stars API и политике платежей.

4. **Реверсивная совместимость**: Все существующие пользователи становятся ROOKIE с сохранением текущих данных.

5. **Мониторинг платежей**: Логируйте все транзакции для разрешения споров.

## 📅 Общая timeline: 20-30 дней

- **Неделя 1**: Этапы 1-2 (БД + сервисы)
- **Неделя 2**: Этапы 3-5 (Telegram API + middleware + модификация эндпоинтов)
- **Неделя 3**: Этапы 6-7 (Frontend + роуты)
- **Неделя 4**: Этапы 8-9 (Cron + тестирование)

## Notes

Ваш проект уже имеет отличную архитектуру с системой кэширования, очередями задач и WebSocket для real-time обновлений. Система подписок органично впишется в существующую структуру. Особое внимание уделите:

- **Кэширование tier пользователя** для минимизации обращений к БД
- **Использование существующей системы достижений** для геймификации подписок
- **Интеграция с системой уведомлений** для информирования об истечении подписки

Telegram Stars API хорошо документирован и интегрируется с Grammy, который вы уже используете в проекте.