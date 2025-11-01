# 0044-admin-ads-management

Дата: 11 октября 2025 г.
Ответственный: GitHub Copilot

## Что было
- В админской вкладке «Новости» отсутствовало управление рекламными баннерами.
- На бэкенде не было CRUD для баннеров и механизма их кэширования.
- Карусель рекламы на публичной стороне не могла получать новые данные с ETag/304.

## Что стало
### 1. Backend: новое API и кэш
- `backend/src/routes/adsRoutes.ts`
  - Публичный эндпоинт `/api/ads` использует `defaultCache` (TTL 600 c) и отдаёт баннеры с `ETag`/`X-Resource-Version`.
- `backend/src/routes/adminRoutes.ts`
  - Добавлены CRUD-эндпоинты `/api/admin/news/ads` c валидацией изображения, расписания и URL.
  - Любое изменение баннера инвалидирует ключ `ads:all` и публикует события `ads.full`/`ads.remove` в топик `home`.
- `shared/types.ts`
  - Общая типизация `AdBanner`/`AdBannerImage` используется на всех слоях.

### 2. Admin Store и UI
- `admin/src/store/adminStore.ts`
  - Добавлен срез `ads: AdBanner[]`, действия `fetchAds`, `upsertAd`, `removeAd` и обработка websocket-патчей `ads.full`/`ads.remove`.
- `admin/src/api/adminClient.ts`
  - Новые методы `adminFetchAds`, `adminCreateAd`, `adminUpdateAd`, `adminDeleteAd` и словарь ошибок для валидации баннеров.
- `admin/src/components/tabs/NewsTab.tsx`
  - Реализован менеджер баннеров: форма создания/редактирования с предпросмотром, валидацией и расписанием; список с быстрым редактированием и удалением.
- `admin/src/app.css`
  - Добавлены стили для блока рекламы (предпросмотр, метаданные, кнопки, счётчик).

### 3. Документация и политика кэша
- `docs/state.md`
  - Описан новый срез стора и realtime-патчи `ads.full`/`ads.remove`.
- `docs/cache.md`
  - Зафиксирован ключ `ads:all` и фактический TTL (600 c) для рекламных баннеров.

## Тестирование
- `npm run lint --workspace=admin` — успешно (предупреждение о версии TypeScript).
- `npm run lint --workspace=backend` — падает из-за исторических предупреждений `no-explicit-any`, не связанных с текущими изменениями (см. `adminRoutes.ts` и `matchDetailsPublic.ts`).

## Следующие шаги
1. Интегрировать карусель баннеров в публичном фронтенде с локальным ETag/TTL (две недели) и плавной анимацией.
2. Добавить управление порядком показа через drag-and-drop или стрелки.
3. Настроить e2e-сценарий (Playwright) для регресса CRUD баннеров и проверки websocket-патчей.
