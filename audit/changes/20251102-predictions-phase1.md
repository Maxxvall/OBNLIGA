# 20251102 — Прогнозы, этап 1

## Изменения
- Добавлена новая вкладка `frontend/src/pages/PredictionsPage.tsx` с подвкладками «Активные» и «Мои», подключена в `frontend/src/App.tsx`.
- Реализован клиент `frontend/src/api/predictionsApi.ts` с локальным кешем (TTL 5 минут, ETag).
- На сервере создан модуль `backend/src/routes/predictionRoutes.ts` с выдачей ближайших матчей и историей пользователя.
- Обновлены хелперы сессии `backend/src/utils/session.ts`, регистрация маршрутов в `backend/src/server.ts`.
- Расширены общие типы `shared/types.ts` под новые DTO.
- Обновлена схема БД `prisma/schema.prisma` (шаблоны, заявки, streak, рейтинг, аудит) и сгенерирован клиент.
- Актуализирована документация: `docs/BD.md`, `docs/cache.md`, `audit/FEATURES_CHANGELOG.md`, `audit/code-audit-predictions-20251103.md`.

## Файлы
- backend/src/routes/predictionRoutes.ts
- backend/src/utils/session.ts
- backend/src/server.ts
- frontend/src/api/predictionsApi.ts
- frontend/src/pages/PredictionsPage.tsx
- frontend/src/styles/predictions.css
- frontend/src/App.tsx
- prisma/schema.prisma
- shared/types.ts
- docs/BD.md
- docs/cache.md
- audit/FEATURES_CHANGELOG.md
- audit/code-audit-predictions-20251103.md
