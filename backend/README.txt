# Foody Backend — Offers V2 (asyncpg)

- Полная замена `main.py` с Offers V2:
  - миграции (status, deleted_at, updated_at, индексы),
  - эндпоинты: list/detail/pause/resume/duplicate/soft-delete,
  - совместимость старых POST `/offers/update` и `/offers/delete`,
  - публичные офферы.

## Railway
Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
