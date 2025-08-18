import os
from typing import Any, Dict, Optional, Set, List, Tuple

import asyncpg
from fastapi import FastAPI, HTTPException, Body, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timezone, time as dtime
import hashlib
import secrets as _secrets

APP_NAME = "Foody API"

DATABASE_URL = os.getenv("DATABASE_URL") or "postgresql://postgres:postgres@localhost:5432/postgres"
RUN_MIGRATIONS = os.getenv("RUN_MIGRATIONS", "1") == "1"

CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()] or [
    "https://foodyweb-production.up.railway.app",
    "https://foodybot-production.up.railway.app",
]

RECOVERY_SECRET = os.getenv("RECOVERY_SECRET", "foodyDevRecover123")

app = FastAPI(title=APP_NAME, version="1.1")

# CORS before routes
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
)

_pool: Optional[asyncpg.Pool] = None

async def _connect_pool():
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=10)

async def _close_pool():
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None

async def _safe_exec(conn: asyncpg.Connection, sql: str):
    try:
        await conn.execute(sql)
    except Exception:
        # Ignore if extension/idx not permitted or already exists
        pass

async def _migrate():
    if not RUN_MIGRATIONS:
        return
    async with _pool.acquire() as conn:
        # merchants
        await conn.execute("""
        CREATE TABLE IF NOT EXISTS merchants (
            id SERIAL PRIMARY KEY,
            name TEXT,
            login TEXT UNIQUE,
            auth_login TEXT,
            password_hash TEXT,
            api_key TEXT UNIQUE,
            phone TEXT,
            email TEXT,
            address TEXT,
            city TEXT,
            lat DOUBLE PRECISION,
            lng DOUBLE PRECISION,
            open_time TIME,
            close_time TIME,
            created_at TIMESTAMPTZ DEFAULT now()
        );
        """)
        # add missing columns if table existed
        for ddl in [
            "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS login TEXT;",
            "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS auth_login TEXT;",
            "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS open_time TIME;",
            "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS close_time TIME;",
        ]:
            await _safe_exec(conn, ddl)

        # backfill login
        await _safe_exec(conn, """
        UPDATE merchants
           SET login = COALESCE(NULLIF(login,''), NULLIF(auth_login,''), NULLIF(phone,''), email)
         WHERE login IS NULL OR login = '';
        """)
        await _safe_exec(conn, """
        UPDATE merchants
           SET auth_login = COALESCE(NULLIF(auth_login,''), login)
         WHERE auth_login IS NULL OR auth_login = '';
        """)
        await _safe_exec(conn, "CREATE UNIQUE INDEX IF NOT EXISTS merchants_login_unique ON merchants(login);")

        # offers
        await conn.execute("""
        CREATE TABLE IF NOT EXISTS offers (
            id SERIAL PRIMARY KEY,
            merchant_id INTEGER,
            restaurant_id INTEGER,
            title TEXT NOT NULL,
            price_cents INTEGER NOT NULL DEFAULT 0,
            original_price_cents INTEGER,
            qty_total INTEGER NOT NULL DEFAULT 1,
            qty_left INTEGER NOT NULL DEFAULT 1,
            expires_at TIMESTAMPTZ,
            image_url TEXT,
            category TEXT,
            description TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now(),
            deleted_at TIMESTAMPTZ
        );
        """)

        # ensure columns exist
        for ddl in [
            "ALTER TABLE offers ADD COLUMN IF NOT EXISTS merchant_id INTEGER;",
            "ALTER TABLE offers ADD COLUMN IF NOT EXISTS restaurant_id INTEGER;",
            "ALTER TABLE offers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';",
            "ALTER TABLE offers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();",
            "ALTER TABLE offers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;",
            "ALTER TABLE offers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();",
        ]:
            await _safe_exec(conn, ddl)

        # backfill for id linkage
        await _safe_exec(conn, "UPDATE offers SET restaurant_id = COALESCE(restaurant_id, merchant_id) WHERE restaurant_id IS NULL;")
        await _safe_exec(conn, "UPDATE offers SET merchant_id   = COALESCE(merchant_id, restaurant_id) WHERE merchant_id IS NULL;")

        # indexes / extension
        await _safe_exec(conn, "CREATE EXTENSION IF NOT EXISTS pg_trgm;")
        await _safe_exec(conn, "CREATE INDEX IF NOT EXISTS idx_offers_rest_status_exp ON offers (restaurant_id, status, expires_at);")
        await _safe_exec(conn, "CREATE INDEX IF NOT EXISTS idx_offers_created_at ON offers (created_at);")
        await _safe_exec(conn, "CREATE INDEX IF NOT EXISTS idx_offers_title_trgm ON offers USING GIN (title gin_trgm_ops);")

        # mark expired (heuristic)
        await _safe_exec(conn, """
        UPDATE offers SET status='expired', updated_at=now()
         WHERE expires_at IS NOT NULL AND expires_at < now() AND status NOT IN ('archived','expired');
        """)

def _hash_password(pw: str) -> str:
    salt = hashlib.sha256(RECOVERY_SECRET.encode()).hexdigest()[:16]
    return hashlib.sha256((salt + pw).encode()).hexdigest()

def _generate_api_key() -> str:
    return _secrets.token_hex(24)

def _to_time_str(val: Any) -> Optional[str]:
    if val is None:
        return None
    if isinstance(val, str):
        return val[:5]
    try:
        return val.strftime("%H:%M")
    except Exception:
        return None

def _parse_time(val: Any) -> Optional[dtime]:
    if not val:
        return None
    if isinstance(val, dtime):
        return val
    if isinstance(val, str):
        s = val.strip()
        if not s:
            return None
        parts = s.split(":")
        try:
            h = int(parts[0]); m = int(parts[1]) if len(parts) > 1 else 0; s2 = int(parts[2]) if len(parts) > 2 else 0
            if h == 24 and m == 0 and s2 == 0:
                return dtime(23, 59, 59)
            return dtime(h, m, s2)
        except Exception:
            return None
    return None

def _parse_expires_at(s: str) -> Optional[datetime]:
    if not s:
        return None
    try:
        if s.endswith("Z"):
            return datetime.fromisoformat(s.replace("Z","+00:00"))
        # accept 'YYYY-MM-DD HH:MM'
        if len(s) == 16 and s[10] == ' ':
            s = s.replace(' ', 'T') + ":00+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None

async def _require_auth(conn: asyncpg.Connection, restaurant_id: int, api_key: str):
    if not api_key:
        raise HTTPException(status_code=401, detail="missing api key")
    row = await conn.fetchrow("SELECT id FROM merchants WHERE id=$1 AND api_key=$2", restaurant_id, api_key)
    if not row:
        raise HTTPException(status_code=401, detail="invalid api key")

def _get_api_key(req: Request) -> str:
    return req.headers.get("X-Foody-Key") or req.headers.get("x-foody-key") or ""

# =====================
# Auth / Profile
# =====================

class RegisterRequest(BaseModel):
    name: str
    login: str
    password: str
    city: Optional[str] = None

class LoginRequest(BaseModel):
    login: str
    password: str

@app.on_event("startup")
async def startup_event():
    await _connect_pool()
    await _migrate()

@app.on_event("shutdown")
async def shutdown_event():
    await _close_pool()

@app.get("/health")
async def health():
    return {"ok": True, "service": APP_NAME}

@app.post("/api/v1/merchant/register_public")
async def register_public(payload: RegisterRequest):
    async with _pool.acquire() as conn:
        login_digits = "".join([c for c in payload.login if c.isdigit()])
        exists = await conn.fetchrow("SELECT id FROM merchants WHERE login=$1", login_digits)
        if exists:
            raise HTTPException(status_code=409, detail="merchant with this login already exists")
        api_key = _generate_api_key()
        password_hash = _hash_password(payload.password)
        row = await conn.fetchrow(
            """
            INSERT INTO merchants (name, login, phone, city, password_hash, api_key, auth_login)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING id
            """,
            payload.name.strip(), login_digits, login_digits, payload.city, password_hash, api_key, login_digits
        )
        return {"restaurant_id": row["id"], "api_key": api_key}

@app.post("/api/v1/merchant/login")
async def login(payload: LoginRequest):
    async with _pool.acquire() as conn:
        login_digits = "".join([c for c in payload.login if c.isdigit()])
        row = await conn.fetchrow("SELECT id, password_hash, api_key FROM merchants WHERE login=$1", login_digits)
        if not row or row["password_hash"] != _hash_password(payload.password):
            raise HTTPException(status_code=401, detail="invalid login or password")
        return {"restaurant_id": row["id"], "api_key": row["api_key"]}

@app.get("/api/v1/merchant/profile")
async def get_profile(restaurant_id: int, request: Request):
    api_key = _get_api_key(request)
    async with _pool.acquire() as conn:
        await _require_auth(conn, restaurant_id, api_key)
        row = await conn.fetchrow(
            "SELECT id, name, login, phone, email, address, city, lat, lng, open_time, close_time FROM merchants WHERE id=$1",
            restaurant_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="not found")
        d = dict(row)
        d["open_time"] = _to_time_str(d.get("open_time"))
        d["close_time"] = _to_time_str(d.get("close_time"))
        d["work_from"] = d["open_time"]
        d["work_to"] = d["close_time"]
        return d

@app.put("/api/v1/merchant/profile")
async def update_profile(payload: Dict[str, Any] = Body(...), request: Request = None):
    restaurant_id = int(payload.get("restaurant_id") or 0)
    if not restaurant_id:
        raise HTTPException(status_code=400, detail="restaurant_id required")

    api_key = _get_api_key(request) if request else ""

    async with _pool.acquire() as conn:
        await _require_auth(conn, restaurant_id, api_key)

        name    = (payload.get("name") or "").strip() or None
        phone   = (payload.get("phone") or "").strip() or None
        address = (payload.get("address") or "").strip() or None
        city    = (payload.get("city") or "").strip() or None
        lat     = payload.get("lat", None)
        lng     = payload.get("lng", None)

        open_time_raw  = payload.get("open_time")  or payload.get("work_from") or None
        close_time_raw = payload.get("close_time") or payload.get("work_to")   or None
        open_time  = _parse_time(open_time_raw)
        close_time = _parse_time(close_time_raw)

        await conn.execute(
            """
            UPDATE merchants SET
                name       = COALESCE($2, name),
                phone      = COALESCE($3, phone),
                address    = COALESCE($4, address),
                city       = COALESCE($5, city),
                lat        = COALESCE($6, lat),
                lng        = COALESCE($7, lng),
                open_time  = COALESCE($8, open_time),
                close_time = COALESCE($9, close_time)
            WHERE id = $1
            """,
            restaurant_id, name, phone, address, city, lat, lng, open_time, close_time
        )
        return {"ok": True}

# =====================
# Offers V2 (list/detail/actions) — asyncpg
# =====================

def _price_from_row(row: Dict[str, Any]) -> Tuple[Optional[float], Optional[float]]:
    pc = row.get("price_cents")
    oc = row.get("original_price_cents")
    p  = (float(pc) / 100.0) if pc is not None else None
    o  = (float(oc) / 100.0) if oc is not None else None
    return p, o

def _discount_percent(price: Optional[float], original: Optional[float]) -> Optional[int]:
    if price is None or original is None or original <= 0:
        return None
    return int(round((1 - price / original) * 100.0))

def _serialize_offer(row: asyncpg.Record) -> Dict[str, Any]:
    r = dict(row)
    price, original = _price_from_row(r)
    out = {
        "id": r["id"],
        "restaurant_id": r["restaurant_id"],
        "title": r.get("title") or "",
        "price": price,
        "original_price": original,
        "discount_percent": _discount_percent(price, original),
        "qty_total": r.get("qty_total"),
        "qty_left": r.get("qty_left"),
        "status": r.get("status") or "active",
        "expires_at": None,
        "image_url": r.get("image_url"),
        "photo_url": r.get("image_url"),  # alias for frontend
        "category": r.get("category"),
        "description": r.get("description"),
        "created_at": None,
        "updated_at": None,
    }
    if r.get("expires_at"):
        out["expires_at"] = r["expires_at"].astimezone(timezone.utc).isoformat()
        # derive expired if needed
        try:
            if r["expires_at"] < datetime.now(timezone.utc) and out["status"] not in ("expired","archived"):
                out["status"] = "expired"
        except Exception:
            pass
    if r.get("created_at"):
        out["created_at"] = r["created_at"].astimezone(timezone.utc).isoformat()
    if r.get("updated_at"):
        out["updated_at"] = r["updated_at"].astimezone(timezone.utc).isoformat()
    return out

class OfferCreate(BaseModel):
    merchant_id: Optional[int] = None
    restaurant_id: int
    title: str
    price: float
    original_price: Optional[float] = None
    qty_total: int = 1
    qty_left: Optional[int] = None
    expires_at: str
    image_url: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None

class OfferUpdate(BaseModel):
    title: Optional[str] = None
    price: Optional[float] = None
    original_price: Optional[float] = None
    qty_total: Optional[int] = None
    qty_left: Optional[int] = None
    expires_at: Optional[str] = None
    image_url: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None  # allow status update

@app.get("/api/v1/merchant/offers")
async def list_offers(
    restaurant_id: int,
    request: Request,
    status: Optional[str] = Query(None, description="draft,scheduled,active,paused,expired (archived is hidden by default)"),
    q: Optional[str] = Query(None, description="search by title/description/id"),
    sort: Optional[str] = Query("expires_at", description="expires_at,-expires_at,qty_left,-qty_left,discount_percent,-discount_percent,created_at,-created_at"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
):
    api_key = _get_api_key(request)
    async with _pool.acquire() as conn:
        await _require_auth(conn, restaurant_id, api_key)

        # Build WHERE
        conds = ["restaurant_id=$1", "(deleted_at IS NULL OR status='archived')"]
        params: List[Any] = [restaurant_id]
        if status:
            sts = [s.strip() for s in status.split(",") if s.strip()]
            # default — скрываем archived, если явно не попросили
            if "archived" not in sts:
                conds.append("status IN (" + ",".join(f"${len(params)+i+1}" for i in range(len(sts))) + ")")
                params.extend(sts)
            else:
                conds.append("status IN (" + ",".join(f"${len(params)+i+1}" for i in range(len(sts))) + ")")
                params.extend(sts)
        else:
            conds.append("status <> 'archived'")

        if q:
            params.append(f"%{q}%")
            params.append(f"%{q}%")
            params.append(f"%{q}%")
            conds.append("(title ILIKE $" + str(len(params)-2) + " OR description ILIKE $" + str(len(params)-1) + " OR CAST(id AS TEXT) ILIKE $" + str(len(params)) + ")")

        where_sql = " AND ".join(conds)

        # Sorting
        desc = sort.startswith("-") if sort else False
        field = sort[1:] if desc else (sort or "expires_at")
        mapping = {
            "expires_at": "COALESCE(expires_at, now() + interval '365 days')",
            "qty_left": "qty_left",
            "created_at": "created_at",
            # discount_percent — сортируем по (1 - price/original) при наличии, иначе 0
            "discount_percent": "CASE WHEN original_price_cents IS NOT NULL AND original_price_cents>0 THEN (1.0 - (price_cents::float / original_price_cents::float)) ELSE 0 END"
        }
        order_col = mapping.get(field, mapping["expires_at"])
        order_sql = f"{order_col} {'DESC' if desc else 'ASC'}"

        offset = (page - 1) * limit

        sql = f"""
            SELECT id, restaurant_id, title, price_cents, original_price_cents, qty_total, qty_left,
                   expires_at, image_url, category, description, status, created_at, updated_at
              FROM offers
             WHERE {where_sql}
             ORDER BY {order_sql}
             LIMIT ${len(params)+1} OFFSET ${len(params)+2}
        """
        params.extend([limit, offset])
        rows = await conn.fetch(sql, *params)
        out = [_serialize_offer(r) for r in rows]
        return {{"items": out, "page": page, "limit": limit, "total": None}}

@app.get("/api/v1/merchant/offers/{offer_id}")
async def get_offer(offer_id: int, restaurant_id: int, request: Request):
    api_key = _get_api_key(request)
    async with _pool.acquire() as conn:
        await _require_auth(conn, restaurant_id, api_key)
        row = await conn.fetchrow(
            """
            SELECT id, restaurant_id, title, price_cents, original_price_cents, qty_total, qty_left,
                   expires_at, image_url, category, description, status, created_at, updated_at
              FROM offers
             WHERE id=$1 AND restaurant_id=$2 AND (deleted_at IS NULL OR status='archived')
             LIMIT 1
            """, offer_id, restaurant_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="offer not found")
        return _serialize_offer(row)

@app.post("/api/v1/merchant/offers")
async def create_offer(payload: OfferCreate, request: Request):
    """
    Insert offer (cents-based), mirrors old schema, fills qty_left if missing.
    """
    api_key = _get_api_key(request)
    async with _pool.acquire() as conn:
        rid = int(payload.merchant_id or payload.restaurant_id or 0)
        if not rid:
            raise HTTPException(status_code=400, detail="restaurant_id required")
        await _require_auth(conn, rid, api_key)

        price_cents = int(round(float(payload.price or 0) * 100))
        orig_cents  = int(round(float(payload.original_price) * 100)) if payload.original_price is not None else None
        qty_total = int(payload.qty_total or 1)
        qty_left  = int(payload.qty_left if payload.qty_left is not None else qty_total)
        expires   = _parse_expires_at(payload.expires_at)
        if not expires:
            raise HTTPException(status_code=400, detail="invalid expires_at")
        image_url = (payload.image_url or "").strip() or None

        row = await conn.fetchrow(
            """
            INSERT INTO offers (
                merchant_id, restaurant_id, title, price_cents, original_price_cents,
                qty_total, qty_left, expires_at, image_url, category, description,
                status, created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active', now(), now())
            RETURNING id
            """ ,
            rid, rid, payload.title, price_cents, orig_cents, qty_total, qty_left, expires,
            image_url, payload.category, payload.description
        )
        return {"id": row["id"]}

@app.put("/api/v1/merchant/offers/{offer_id}")
async def update_offer(offer_id: int, payload: OfferUpdate, request: Request, restaurant_id: Optional[int] = None):
    api_key = _get_api_key(request)
    rid = int(restaurant_id or 0)
    async with _pool.acquire() as conn:
        if rid:
            await _require_auth(conn, rid, api_key)
        else:
            if not api_key:
                raise HTTPException(status_code=401, detail="restaurant_id or X-Foody-Key required")
            row = await conn.fetchrow("SELECT restaurant_id FROM offers WHERE id=$1", offer_id)
            if not row:
                raise HTTPException(status_code=404, detail="offer not found")
            rid = row["restaurant_id"]
            await _require_auth(conn, rid, api_key)

        fields = []
        values: List[Any] = []
        if payload.title is not None:            fields.append("title=$" + str(len(values)+3)); values.append(payload.title.strip())
        if payload.price is not None:            fields.append("price_cents=$" + str(len(values)+3)); values.append(int(round(float(payload.price)*100)))
        if payload.original_price is not None:   fields.append("original_price_cents=$" + str(len(values)+3)); values.append(int(round(float(payload.original_price)*100)))
        if payload.qty_total is not None:        fields.append("qty_total=$" + str(len(values)+3)); values.append(int(payload.qty_total))
        if payload.qty_left is not None:         fields.append("qty_left=$" + str(len(values)+3)); values.append(int(payload.qty_left))
        if payload.expires_at is not None:
            dt = _parse_expires_at(payload.expires_at)
            if not dt: raise HTTPException(status_code=400, detail="invalid expires_at")
            fields.append("expires_at=$" + str(len(values)+3)); values.append(dt)
        if payload.image_url is not None:        fields.append("image_url=$" + str(len(values)+3)); values.append(payload.image_url or None)
        if payload.category is not None:         fields.append("category=$" + str(len(values)+3)); values.append(payload.category or None)
        if payload.description is not None:      fields.append("description=$" + str(len(values)+3)); values.append(payload.description or None)
        if payload.status is not None:           fields.append("status=$" + str(len(values)+3)); values.append(payload.status)

        if not fields:
            return {"ok": True, "updated": 0}

        fields.append("updated_at=now()")
        sql = f"UPDATE offers SET {', '.join(fields)} WHERE id=$1 AND restaurant_id=$2 AND deleted_at IS NULL"
        res = await conn.execute(sql, offer_id, rid, *values)
        if not res or not res.endswith("1"):
            raise HTTPException(status_code=404, detail="offer not found")
        return {"ok": True}

@app.patch("/api/v1/merchant/offers/{offer_id}/pause")
async def pause_offer(offer_id: int, restaurant_id: int, request: Request):
    api_key = _get_api_key(request)
    async with _pool.acquire() as conn:
        await _require_auth(conn, restaurant_id, api_key)
        res = await conn.execute("UPDATE offers SET status='paused', updated_at=now() WHERE id=$1 AND restaurant_id=$2 AND deleted_at IS NULL", offer_id, restaurant_id)
        if not res or not res.endswith("1"):
            raise HTTPException(status_code=404, detail="offer not found")
        row = await conn.fetchrow("SELECT * FROM offers WHERE id=$1", offer_id)
        return _serialize_offer(row)

@app.patch("/api/v1/merchant/offers/{offer_id}/resume")
async def resume_offer(offer_id: int, restaurant_id: int, request: Request):
    api_key = _get_api_key(request)
    async with _pool.acquire() as conn:
        await _require_auth(conn, restaurant_id, api_key)
        res = await conn.execute("UPDATE offers SET status='active', updated_at=now() WHERE id=$1 AND restaurant_id=$2 AND deleted_at IS NULL", offer_id, restaurant_id)
        if not res or not res.endswith("1"):
            raise HTTPException(status_code=404, detail="offer not found")
        row = await conn.fetchrow("SELECT * FROM offers WHERE id=$1", offer_id)
        return _serialize_offer(row)

@app.post("/api/v1/merchant/offers/{offer_id}/duplicate")
async def duplicate_offer(offer_id: int, restaurant_id: int, request: Request):
    api_key = _get_api_key(request)
    async with _pool.acquire() as conn:
        await _require_auth(conn, restaurant_id, api_key)
        src = await conn.fetchrow("SELECT * FROM offers WHERE id=$1 AND restaurant_id=$2 AND deleted_at IS NULL", offer_id, restaurant_id)
        if not src:
            raise HTTPException(status_code=404, detail="offer not found")
        # Duplicate as draft; qty_left = qty_total; keep expires_at
        ins = await conn.fetchrow(
            """
            INSERT INTO offers (merchant_id, restaurant_id, title, price_cents, original_price_cents,
                                qty_total, qty_left, expires_at, image_url, category, description,
                                status, created_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft', now(), now())
            RETURNING id
            """ ,
            src["merchant_id"], restaurant_id, src["title"], src["price_cents"], src["original_price_cents"],
            src["qty_total"], src["qty_total"], src["expires_at"], src["image_url"], src["category"], src["description"]
        )
        return {"id": ins["id"]}

@app.delete("/api/v1/merchant/offers/{offer_id}")
async def delete_offer(offer_id: int, restaurant_id: int, request: Request):
    api_key = _get_api_key(request)
    async with _pool.acquire() as conn:
        await _require_auth(conn, restaurant_id, api_key)
        # soft-delete (archive)
        res = await conn.execute("UPDATE offers SET status='archived', deleted_at=now(), updated_at=now() WHERE id=$1 AND restaurant_id=$2 AND deleted_at IS NULL", offer_id, restaurant_id)
        if not res or not res.endswith("1"):
            # idempotent: if already archived for this rid — ok
            existed = await conn.fetchrow("SELECT 1 FROM offers WHERE id=$1 AND restaurant_id=$2", offer_id, restaurant_id)
            if not existed:
                raise HTTPException(status_code=404, detail="offer not found")
        return {"ok": True, "id": offer_id}

# ---- Compatibility POST routes (старые вызовы) ----
@app.post("/api/v1/merchant/offers/update")
async def update_offer_post(payload: Dict[str, Any] = Body(...), request: Request = None):
    offer_id = int(payload.get("id") or payload.get("offer_id") or 0)
    if not offer_id:
        raise HTTPException(status_code=400, detail="id required")
    up = OfferUpdate(
        title=payload.get("title"),
        price=payload.get("price"),
        original_price=payload.get("original_price"),
        qty_total=payload.get("qty_total"),
        qty_left=payload.get("qty_left"),
        expires_at=payload.get("expires_at"),
        image_url=payload.get("image_url") or payload.get("photo_url"),
        category=payload.get("category"),
        description=payload.get("description"),
    )
    rid = payload.get("restaurant_id")
    return await update_offer(offer_id, up, request, restaurant_id=rid)

@app.post("/api/v1/merchant/offers/delete")
async def delete_offer_post(payload: Dict[str, Any] = Body(...), request: Request = None):
    offer_id = int(payload.get("id") or payload.get("offer_id") or 0)
    rid = int(payload.get("restaurant_id") or 0)
    if not offer_id:
        raise HTTPException(status_code=400, detail="id required")
    if not rid:
        raise HTTPException(status_code=400, detail="restaurant_id required")
    return await delete_offer(offer_id, rid, request)

# =====================
# Public offers (unchanged)
# =====================
@app.get("/api/v1/public/offers")
async def public_offers(restaurant_id: Optional[int] = None, limit: int = 200):
    async with _pool.acquire() as conn:
        base_sql = """
            SELECT id, restaurant_id, title, price_cents, original_price_cents,
                   qty_total, qty_left, expires_at, image_url, category, description, status
              FROM offers
             WHERE (qty_left IS NULL OR qty_left > 0)
               AND (expires_at IS NULL OR expires_at > now())
               AND (deleted_at IS NULL)
               AND status='active'
        """
        order_limit = f" ORDER BY COALESCE(expires_at, now() + interval '365 days') ASC LIMIT {int(limit)}"
        if restaurant_id:
            rows = await conn.fetch(base_sql + " AND restaurant_id=$1" + order_limit, int(restaurant_id))
        else:
            rows = await conn.fetch(base_sql + order_limit)
        out = []
        for r in rows:
            d = _serialize_offer(r)
            out.append(d)
        return out

# =====================
# Password change
# =====================
@app.put("/api/v1/merchant/password")
async def change_password(payload: dict = Body(...), request: Request = None):
    restaurant_id = int(payload.get("restaurant_id") or 0)
    old_password = (payload.get("old_password") or "").strip()
    new_password = (payload.get("new_password") or "").strip()
    if not restaurant_id or not old_password or not new_password:
        raise HTTPException(status_code=400, detail="restaurant_id, old_password, new_password required")
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="new password too short")

    api_key = request.headers.get("X-Foody-Key") if request else ""
    if not api_key:
        api_key = request.headers.get("x-foody-key") if request else ""
    async with _pool.acquire() as conn:
        await _require_auth(conn, restaurant_id, api_key)
        row = await conn.fetchrow("SELECT password_hash FROM merchants WHERE id=$1", restaurant_id)
        if not row or row["password_hash"] != _hash_password(old_password):
            raise HTTPException(status_code=401, detail="invalid current password")
        await conn.execute("UPDATE merchants SET password_hash=$2 WHERE id=$1", restaurant_id, _hash_password(new_password))
        return {"ok": True}

@app.get("/")
async def root():
    return {"ok": True, "service": APP_NAME, "version": "1.1"}
