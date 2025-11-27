# Google Meet Add-ons SDK

Вы упомянули "отзывОбзор SDK дополнений Meet для Интернета". Google действительно рекомендует использовать официальный [Google Meet Add-ons SDK](https://developers.google.com/meet/add-ons) вместо браузерных расширений.

## Разница между расширением и Add-on

### Браузерное расширение (текущий подход)
- ✅ Работает сразу, без дополнительной настройки
- ✅ Не требует серверной инфраструктуры
- ❌ Может нарушать работу страницы
- ❌ Google не рекомендует этот подход
- ❌ Селекторы могут ломаться при обновлениях Google Meet

### Google Meet Add-ons SDK (рекомендуемый подход)
- ✅ Официальный API от Google
- ✅ Стабильный, не ломается при обновлениях
- ✅ Интеграция через Google Workspace
- ❌ Требует серверной инфраструктуры
- ❌ Требует OAuth настройки
- ❌ Более сложная настройка

## Рекомендация

Для быстрого прототипа можно использовать текущее браузерное расширение. Но для production лучше перейти на Google Meet Add-ons SDK.

## Документация

- [Google Meet Add-ons Overview](https://developers.google.com/meet/add-ons/overview)
- [Quick Start Guide](https://developers.google.com/meet/add-ons/quickstart)
- [API Reference](https://developers.google.com/meet/add-ons/reference/rest)

## Текущее решение

Пока мы продолжаем улучшать браузерное расширение. Если вы хотите перейти на Add-ons SDK, это потребует:
1. Настройки Google Cloud Project
2. OAuth 2.0 конфигурации
3. Серверной части для обработки запросов
4. Переписывания логики интеграции







