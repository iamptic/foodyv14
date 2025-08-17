import os
from typing import Any, Dict, Optional, Set

import asyncpg
from fastapi import FastAPI, HTTPException, Body, Request
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

app = FastAPI(title=APP_NAME, version="1.0")

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
            await conn.execute(ddl)

        # backfill login
        await conn.execute("""
        UPDATE merchants
           SET login = COALESCE(NULLIF(login,''), NULLIF(auth_login,''), NULLIF(phone,''), email)
         WHERE login IS NULL OR login = '';
        """)
        await conn.execute("""
        UPDATE merchants
           SET auth_login = COALESCE(NULLIF(auth_login,''), login)
         WHERE auth_login IS NULL OR auth_login = '';
        """)
        await conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS merchants_login_unique ON merchants(login);")

        # offers
        await conn.execute("""
        CREATE TABLE IF NOT EXISTS offers (
            id SERIAL PRIMARY KEY,
            merchant_id INTEGER,               -- добавлено
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
            created_at TIMESTAMPTZ DEFAULT now()
        );
        """)

        # ensure columns exist and backfill
        cols = await conn.fetch("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name='offers' AND table_schema=current_schema()
        """)
        colset: Set[str] = {r["column_name"] for r in cols}

        if "merchant_id" not in colset:
            await conn.execute("ALTER TABLE offers ADD COLUMN IF NOT EXISTS merchant_id INTEGER;")
            colset.add("merchant_id")

        if "restaurant_id" not in colset:
            await conn.execute("ALTER TABLE offers ADD COLUMN IF NOT EXISTS restaurant_id INTEGER;")
            colset.add("restaurant_id")

        if "created_at" not in colset:
            await conn.execute("ALTER TABLE offers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();")

        # backfill (на всякий случай для уже существующих строк)
        await conn.execute("UPDATE offers SET restaurant_id = COALESCE(restaurant_id, merchant_id) WHERE restaurant_id IS NULL;")
        await conn.execute("UPDATE offers SET merchant_id   = COALESCE(merchant_id, restaurant_id) WHERE merchant_id IS NULL;")

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
            h = int(parts[0])
            m = int(parts[1]) if len(parts) > 1 else 0
            s = int(parts[2]) if len(parts) > 2 else 0
            if h == 24 and m == 0 and s == 0:
                return dtime(23, 59, 59)
            return dtime(h, m, s)
        except Exception:
            return None
    return None

def _parse_expires_at(s: str) -> Optional[datetime]:
    if not s:
        return None
    try:
        if s.endswith("Z"):
            return datetime.fromisoformat(s.replace("Z","+00:00"))
        return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
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

class RegisterRequest(BaseModel):
    name: str
    login: str
    password: str
    city: Optional[str] = None

class LoginRequest(BaseModel):
    login: str
    password: str

# (оставил для совместимости, но расширил)
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

@app.get("/api/v1/merchant/offers")
async def list_offers(restaurant_id: int, request: Request):
    api_key = _get_api_key(request)
    async with _pool.acquire() as conn:
        await _require_auth(conn, restaurant_id, api_key)
        rows = await conn.fetch(
            """
            SELECT id, restaurant_id, title, price_cents, original_price_cents, qty_total, qty_left,
                   expires_at, image_url, category, description
            FROM offers
            WHERE restaurant_id=$1
            ORDER BY created_at DESC
            """,
            restaurant_id
        )
        out = []
        for r in rows:
            d = dict(r)
            if d.get("expires_at"):
                d["expires_at"] = d["expires_at"].astimezone(timezone.utc).isoformat()
            out.append(d)
        return out

# повторное объявление оставлено для совместимости кода ниже
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

@app.post("/api/v1/merchant/offers")
async def create_offer(payload: OfferCreate, request: Request):
    """
    Safe insert for offers: writes both merchant_id and restaurant_id,
    coalesces image_url to non-null string, supports price/price_cents schemas.
    """
    api_key = _get_api_key(request)
    async with _pool.acquire() as conn:
        # authorize by merchant_id or restaurant_id
        rid = int(payload.merchant_id or payload.restaurant_id)
        await _require_auth(conn, rid, api_key)

        # numbers
        price_val = float(payload.price or 0)
        original_val = float(payload.original_price) if payload.original_price is not None else None
        price_cents = int(round(price_val * 100)) if payload.price is not None else None
        orig_cents  = int(round(original_val * 100)) if original_val is not None else None

        qty_total = payload.qty_total or 1
        qty_left = payload.qty_left if payload.qty_left is not None else qty_total

        expires = _parse_expires_at(payload.expires_at)
        if not expires:
            raise HTTPException(status_code=400, detail="invalid expires_at")

        # image url must not be NULL for strict schemas
        image_url = (payload.image_url or "").strip()

        # Attempt 1: wide schema (float + cents)
        try:
            row = await conn.fetchrow(
                """
                INSERT INTO offers (
                    merchant_id,
                    restaurant_id,
                    title,
                    price,
                    price_cents,
                    original_price,
                    original_price_cents,
                    qty_total,
                    qty_left,
                    expires_at,
                    image_url,
                    category,
                    description
                )
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                RETURNING id
                """,
                rid, rid, payload.title,
                price_val if payload.price is not None else None,
                price_cents,
                original_val,
                orig_cents,
                qty_total, qty_left, expires,
                image_url, payload.category, payload.description
            )
        except Exception:
            # Attempt 2: cents-only schema
            try:
                row = await conn.fetchrow(
                    """
                    INSERT INTO offers (
                        merchant_id,
                        restaurant_id,
                        title,
                        price_cents,
                        original_price_cents,
                        qty_total,
                        qty_left,
                        expires_at,
                        image_url,
                        category,
                        description
                    )
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                    RETURNING id
                    """,
                    rid, rid, payload.title,
                    price_cents, orig_cents,
                    qty_total, qty_left, expires,
                    image_url, payload.category, payload.description
                )
            except Exception:
                # Attempt 3: float-only schema
                row = await conn.fetchrow(
                    """
                    INSERT INTO offers (
                        merchant_id,
                        restaurant_id,
                        title,
                        price,
                        original_price,
                        qty_total,
                        qty_left,
                        expires_at,
                        image_url,
                        category,
                        description
                    )
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                    RETURNING id
                    """,
                    rid, rid, payload.title,
                    price_val if payload.price is not None else None,
                    original_val,
                    qty_total, qty_left, expires,
                    image_url, payload.category, payload.description
                )
        return {"id": row["id"]}

@app.get("/")
async def root():
    return {"ok": True, "service": APP_NAME}

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


# =====================
# Public & detail offer endpoints (stable contract)
# =====================

from typing import List, Optional

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

def _parse_dt_maybe(iso: Optional[str]):
    if not iso:
        return None
    try:
        # accept 'YYYY-MM-DD HH:MM' and ISO8601
        if len(iso) == 16 and iso[10] == ' ':
            iso = iso.replace(' ', 'T') + ':00Z'
        dt = datetime.fromisoformat(iso.replace('Z','+00:00'))
        return dt
    except Exception:
        return None

@app.get("/api/v1/public/offers")
async def public_offers(restaurant_id: Optional[int] = None, limit: int = 200):
    async with _pool.acquire() as conn:
        # build query
        base_sql = """
            SELECT id, restaurant_id, title, price_cents, original_price_cents,
                   qty_total, qty_left, expires_at, image_url, category, description
              FROM offers
             WHERE (qty_left IS NULL OR qty_left > 0)
               AND (expires_at IS NULL OR expires_at > now())
        """
        order_limit = f" ORDER BY COALESCE(expires_at, now() + interval '365 days') ASC LIMIT {int(limit)}"
        if restaurant_id:
            rows = await conn.fetch(base_sql + " AND restaurant_id=$1" + order_limit, int(restaurant_id))
        else:
            rows = await conn.fetch(base_sql + order_limit)
        out = []
        for r in rows:
            d = dict(r)
            if d.get("expires_at"):
                d["expires_at"] = d["expires_at"].astimezone(timezone.utc).isoformat()
            out.append(d)
        return out

@app.put("/api/v1/merchant/offers/{offer_id}")
async def update_offer(offer_id: int, payload: OfferUpdate, request: Request, restaurant_id: Optional[int] = None):
    api_key = _get_api_key(request)
    rid = int(restaurant_id or 0)
    async with _pool.acquire() as conn:
        if rid:
            await _require_auth(conn, rid, api_key)
        else:
            # If restaurant_id not provided, try to infer from offer row under provided key
            if not api_key:
                raise HTTPException(status_code=401, detail="restaurant_id or X-Foody-Key required")
            row = await conn.fetchrow("SELECT restaurant_id FROM offers WHERE id=$1", offer_id)
            if not row:
                raise HTTPException(status_code=404, detail="offer not found")
            rid = row["restaurant_id"]
            await _require_auth(conn, rid, api_key)

        # Build dynamic update
        fields = {}
        if payload.title is not None: fields["title"] = payload.title.strip()
        if payload.price is not None:
            fields["price_cents"] = int(round(float(payload.price) * 100))
            fields["price"] = float(payload.price)
        if payload.original_price is not None:
            fields["original_price_cents"] = int(round(float(payload.original_price) * 100))
            fields["original_price"] = float(payload.original_price)
        if payload.qty_total is not None: fields["qty_total"] = int(payload.qty_total)
        if payload.qty_left is not None: fields["qty_left"] = int(payload.qty_left)
        if payload.expires_at is not None:
            dt = _parse_dt_maybe(payload.expires_at)
            if not dt:
                raise HTTPException(status_code=400, detail="invalid expires_at")
            fields["expires_at"] = dt
        if payload.image_url is not None: fields["image_url"] = payload.image_url or None
        if payload.category is not None: fields["category"] = payload.category or None
        if payload.description is not None: fields["description"] = payload.description or None

        if not fields:
            return {"ok": True, "updated": 0}

        sets = ", ".join([f"{k} = ${i+3}" for i, k in enumerate(fields.keys())])
        vals = list(fields.values())
        res = await conn.execute(
            f"UPDATE offers SET {sets} WHERE id = $1 AND restaurant_id = $2",
            offer_id, rid, *vals
        )
        # asyncpg returns like 'UPDATE 1'
        if not res or not res.endswith("1"):
            raise HTTPException(status_code=404, detail="offer not found")
        return {"ok": True}

@app.delete("/api/v1/merchant/offers/{offer_id}")
async def delete_offer(offer_id: int, request: Request, restaurant_id: Optional[int] = None):
    api_key = _get_api_key(request)
    rid = int(restaurant_id or 0)
    async with _pool.acquire() as conn:
        if rid:
            await _require_auth(conn, rid, api_key)
        else:
            # infer rid by offer id
            if not api_key:
                raise HTTPException(status_code=401, detail="restaurant_id or X-Foody-Key required")
            row = await conn.fetchrow("SELECT restaurant_id FROM offers WHERE id=$1", offer_id)
            if not row:
                raise HTTPException(status_code=404, detail="offer not found")
            rid = row["restaurant_id"]
            await _require_auth(conn, rid, api_key)

        res = await conn.execute("DELETE FROM offers WHERE id=$1 AND restaurant_id=$2", offer_id, rid)
        if not res or not res.endswith("1"):
            raise HTTPException(status_code=404, detail="offer not found")
        return {"ok": True}

# --- Compatibility POST routes (if frontend hits them) ---
@app.post("/api/v1/merchant/offers/update")
async def update_offer_post(payload: Dict[str, Any] = Body(...), request: Request = None):
    offer_id = int(payload.get("id") or payload.get("offer_id") or 0)
    if not offer_id:
        raise HTTPException(status_code=400, detail="id required")
    # Pass-through to PUT
    class _PU(BaseModel):
        title: Optional[str] = None
        price: Optional[float] = None
        original_price: Optional[float] = None
        qty_total: Optional[int] = None
        qty_left: Optional[int] = None
        expires_at: Optional[str] = None
        image_url: Optional[str] = None
        category: Optional[str] = None
        description: Optional[str] = None
    up = _PU(**{k: payload.get(k) for k in _PU.model_fields})
    rid = payload.get("restaurant_id")
    return await update_offer(offer_id, up, request, restaurant_id=rid)

@app.post("/api/v1/merchant/offers/delete")
async def delete_offer_post(payload: Dict[str, Any] = Body(...), request: Request = None):
    offer_id = int(payload.get("id") or payload.get("offer_id") or 0)
    if not offer_id:
        raise HTTPException(status_code=400, detail="id required")
    rid = payload.get("restaurant_id")
    return await delete_offer(offer_id, request, restaurant_id=rid)
