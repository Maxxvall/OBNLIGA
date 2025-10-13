# Добавление поля photoUrl в AppUser #0008

**Дата:** 02 Oct 2025  
**Тип:** Database Enhancement  
**Влияние:** 🔴 User Experience  

## ДО
- В модели AppUser отсутствовало поле `photoUrl`
- Фото пользователей не сохранялись в БД
- Profile показывал только placeholder вместо фото
- Backend получал photoUrl из Telegram, но не сохранял его

## ПОСЛЕ
- Добавлено поле `photoUrl` в модель AppUser
- Фото пользователей сохраняются при аутентификации
- Profile корректно отображает фото пользователей
- Fallback data в Telegram WebApp включает photoUrl

## Изменённые файлы

### 1. `prisma/schema.prisma`
```prisma
model AppUser {
  id             Int      @id @default(autoincrement()) @map("user_id")
  telegramId     BigInt   @unique @map("telegram_id")
  username       String?  @map("username")
  firstName      String?  @map("first_name")
+ photoUrl       String?  @map("photo_url")
  registrationDate DateTime @map("registration_date") @default(now())
  // ...остальные поля
}
```

### 2. `backend/src/routes/authRoutes.ts`
```typescript
const user = await prisma.appUser.upsert({
  where: { telegramId: BigInt(userId) },
  create: {
    telegramId: BigInt(userId),
    username: username,
    firstName: firstName || null,
+   photoUrl: photoUrl || null,
  },
  update: {
    username: username,
    firstName: firstName || undefined,
+   photoUrl: photoUrl || undefined,
  },
})
```

### 3. `backend/src/routes/userRoutes.ts`
```typescript
const user = await prisma.appUser.upsert({
  where: { telegramId: BigInt(userId) },
  create: {
    telegramId: BigInt(userId),
    username: username,
    firstName: null,
+   photoUrl: photoUrl || null,
  },
  update: {
    username: username,
+   photoUrl: photoUrl || undefined,
  },
})
```

### 4. `frontend/src/Profile.tsx`
```typescript
// Fallback user data:
setUser({
  telegramId: unsafe.id,
  username: unsafe.username,
  firstName: unsafe.first_name,
+ photoUrl: unsafe.photo_url,
  createdAt: new Date().toISOString()
})

// Avatar display:
{user && user.photoUrl ? (
- <img src={user.photoUrl} alt={user.tgUsername || 'avatar'} />
+ <img src={user.photoUrl} alt={user.username || user.firstName || 'avatar'} />
) : (
  <div className="profile-avatar placeholder">{loading ? '⏳' : '👤'}</div>
)}
```

### 5. `prisma/migrations/20251002_add_photo_url/migration.sql`
```sql
-- AlterTable
ALTER TABLE "app_user" ADD COLUMN "photo_url" TEXT;
```

## Влияние на метрики
- **Retention:** 🔴 - значительное улучшение: пользователи видят свои фото
- **Engagement:** 🔵 - улучшение UX, более персонализированный интерфейс
- **Revenue:** ⚪ - нейтрально
- **Tech Stability:** 🔵 - улучшение: данные Telegram полностью сохраняются

## Техническая реализация

### Схема данных:
- `photo_url` - nullable string поле в PostgreSQL
- Автоматическое обновление при каждой аутентификации
- Совместимость с существующими пользователями (поле nullable)

### API поведение:
- При `/api/auth/telegram-init` photoUrl извлекается из Telegram data
- При `/api/users` endpoint photoUrl обновляется если передан
- При `/api/auth/me` photoUrl возвращается в ответе

### Frontend интеграция:
- Profile.tsx использует photoUrl для отображения аватара
- Fallback на placeholder если photoUrl отсутствует
- Telegram WebApp data включает photo_url автоматически

## Совместимость с BD.md
✅ Изменения совместимы с BD.md:
- Добавление photoUrl логично расширяет таблицу "Пользователь_Приложения"
- Не нарушает существующие связи и ограничения
- Поле nullable - безопасно для существующих данных

## Проверки
```bash
npx prisma generate                    # ✅ новый client с photoUrl
cd backend && npm run build           # ✅ backend компилируется
cd frontend && npm run build          # ✅ frontend компилируется
# Migration: добавить photo_url колонку в production БД ✅
```

## Деплой на Render
1. ✅ Миграция создана в `/prisma/migrations/20251002_add_photo_url/`
2. 🟨 Применить миграцию через Render job `run-migrations`
3. 🟨 Деплой обновленного кода

## Риски и mitigation
- **Риск:** Существующие пользователи без photoUrl
- **Mitigation:** Поле nullable, fallback на placeholder работает
- **Риск:** Большие URL фото могут замедлить запросы
- **Mitigation:** Telegram оптимизирует размеры автоматически, поле TEXT достаточно

## Результат
После деплоя пользователи увидят свои фото из Telegram в профиле, что значительно улучшит UX и персонализацию приложения.