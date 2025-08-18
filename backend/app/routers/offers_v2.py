# backend/app/routers/offers_v2.py
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone

from ..schemas.offers_v2 import OfferOut, OfferListOut
from ..services.merchant_auth import get_restaurant_id_from_request, require_key

try:
    from ..database import get_db
except Exception:
    from database import get_db  # type: ignore

router = APIRouter(prefix="/api/v1/merchant", tags=["merchant_offers_v2"])

def compute_discount_percent(price: Optional[float], original_price: Optional[float]) -> Optional[int]:
    if price is None or original_price is None or original_price == 0:
        return None
    try:
        return int(round((1 - float(price)/float(original_price)) * 100))
    except Exception:
        return None

def rows_to_offers(rows: List[Dict[str, Any]]) -> List[OfferOut]:
    out: List[OfferOut] = []
    now = datetime.now(timezone.utc)
    for r in rows:
        o = OfferOut(
            id=r["id"],
            restaurant_id=r["restaurant_id"],
            title=r.get("title") or "",
            description=r.get("description") or "",
            price=r.get("price"),
            original_price=r.get("original_price"),
            discount_percent=r.get("discount_percent") if r.get("discount_percent") is not None else compute_discount_percent(r.get("price"), r.get("original_price")),
            qty_total=r.get("qty_total"),
            qty_left=r.get("qty_left"),
            status=r.get("status") or "active",
            expires_at=r.get("expires_at"),
            photo_url=r.get("photo_url"),
            reservations_count=r.get("reservations_count") or 0,
            redemptions_count=r.get("redemptions_count") or 0,
            created_at=r.get("created_at"),
            updated_at=r.get("updated_at"),
        )
        if o.expires_at and o.status not in ("expired","archived"):
            try:
                exp = o.expires_at if isinstance(o.expires_at, datetime) else datetime.fromisoformat(str(o.expires_at))
                if exp.tzinfo is None:
                    from datetime import timezone as _tz
                    exp = exp.replace(tzinfo=_tz.utc)
                if exp < now:
                    o.status = "expired"
            except Exception:
                pass
        out.append(o)
    return out

def map_sort(sort: Optional[str]) -> str:
    if not sort:
        return "expires_at ASC"
    desc = sort.startswith("-")
    field = sort[1:] if desc else sort
    mapping = {
        "expires_at": "expires_at",
        "qty_left": "qty_left",
        "discount_percent": "discount_percent",
        "revenue": "created_at",  # fallback
        "created_at": "created_at"
    }
    col = mapping.get(field, "expires_at")
    order = "DESC" if desc else "ASC"
    return f"{col} {order}"

def build_filters(status: Optional[str], q: Optional[str]) -> str:
    conds = ["o.deleted_at IS NULL"]
    if status:
        statuses = ",".join([f":st_{i}" for i,_ in enumerate(status.split(","))])
        conds.append(f"o.status IN ({statuses})")
    if q:
        conds.append("(o.title ILIKE :q OR o.description ILIKE :q OR CAST(o.id AS TEXT) ILIKE :q)")
    return " AND ".join(conds)

def bind_params(status: Optional[str], q: Optional[str]):
    params = {}
    if status:
        for i, s in enumerate(status.split(",")):
            params[f"st_{i}"] = s.strip()
    if q:
        params["q"] = f"%{q.strip()}%"
    return params

@router.get("/offers", response_model=OfferListOut)
def list_offers(
    request: Request,
    status: Optional[str] = Query(None),
    q: Optional[str] = None,
    sort: Optional[str] = Query("expires_at"),
    page: int = 1,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    require_key(request)
    rid = get_restaurant_id_from_request(request)
    if not rid:
        raise HTTPException(status_code=400, detail="restaurant_id is required")

    where_sql = build_filters(status, q)
    sort_sql = map_sort(sort)
    offset = max(0, (page - 1) * limit)
    sql = text(f"""
        SELECT o.*,
               CASE WHEN o.original_price IS NOT NULL AND o.original_price > 0
                    THEN ROUND( (1 - o.price / o.original_price) * 100 )
                    ELSE NULL END AS discount_percent
        FROM offers o
        WHERE o.restaurant_id = :rid AND {where_sql}
        ORDER BY {sort_sql}
        LIMIT :limit OFFSET :offset
    """)
    params = {"rid": rid, "limit": limit, "offset": offset}
    params.update(bind_params(status, q))
    rows = [dict(r) for r in db.execute(sql, params)]
    ids = [r["id"] for r in rows] or [0]

    # Batch counts
    res_map, red_map = {}, {}
    try:
        res_map = {r["offer_id"]: r["c"] for r in db.execute(text("SELECT offer_id, COUNT(*) AS c FROM reservations WHERE offer_id = ANY(:ids) AND (status IS NULL OR status NOT IN ('canceled','cancelled')) GROUP BY offer_id"), {"ids": ids})}
    except Exception:
        res_map = {}
    try:
        red_map = {r["offer_id"]: r["c"] for r in db.execute(text("SELECT offer_id, COUNT(*) AS c FROM redemptions WHERE offer_id = ANY(:ids) GROUP BY offer_id"), {"ids": ids})}
    except Exception:
        red_map = {}

    for r in rows:
        r["reservations_count"] = int(res_map.get(r["id"], 0))
        r["redemptions_count"] = int(red_map.get(r["id"], 0))

    return {
        "items": rows_to_offers(rows),
        "page": page,
        "limit": limit,
        "total": None
    }

@router.get("/offers/{offer_id}", response_model=OfferOut)
def get_offer(offer_id: int, request: Request, db: Session = Depends(get_db)):
    require_key(request)
    rid = get_restaurant_id_from_request(request)
    if not rid:
        raise HTTPException(status_code=400, detail="restaurant_id is required")
    row = db.execute(text("""
        SELECT o.*,
               CASE WHEN o.original_price IS NOT NULL AND o.original_price > 0
                    THEN ROUND( (1 - o.price / o.original_price) * 100 )
                    ELSE NULL END AS discount_percent
        FROM offers o
        WHERE o.id = :id AND o.restaurant_id = :rid AND (o.deleted_at IS NULL OR o.status='archived')
        LIMIT 1
    """), {"id": offer_id, "rid": rid}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Offer not found")
    try:
        res = db.execute(text("SELECT COUNT(*) FROM reservations WHERE offer_id=:id AND (status IS NULL OR status NOT IN ('canceled','cancelled'))"), {"id": offer_id}).scalar()
        red = db.execute(text("SELECT COUNT(*) FROM redemptions WHERE offer_id=:id"), {"id": offer_id}).scalar()
    except Exception:
        res, red = 0, 0
    d = dict(row)
    d["reservations_count"], d["redemptions_count"] = int(res or 0), int(red or 0)
    return rows_to_offers([d])[0]

@router.patch("/offers/{offer_id}/pause", response_model=OfferOut)
def pause_offer(offer_id: int, request: Request, db: Session = Depends(get_db)):
    require_key(request)
    rid = get_restaurant_id_from_request(request)
    if not rid:
        raise HTTPException(status_code=400, detail="restaurant_id is required")
    upd = db.execute(text("UPDATE offers SET status='paused', updated_at=NOW() WHERE id=:id AND restaurant_id=:rid AND deleted_at IS NULL RETURNING *"), {"id": offer_id, "rid": rid}).mappings().first()
    if not upd:
        raise HTTPException(status_code=404, detail="Offer not found")
    return rows_to_offers([dict(upd)])[0]

@router.patch("/offers/{offer_id}/resume", response_model=OfferOut)
def resume_offer(offer_id: int, request: Request, db: Session = Depends(get_db)):
    require_key(request)
    rid = get_restaurant_id_from_request(request)
    if not rid:
        raise HTTPException(status_code=400, detail="restaurant_id is required")
    upd = db.execute(text("UPDATE offers SET status='active', updated_at=NOW() WHERE id=:id AND restaurant_id=:rid AND deleted_at IS NULL RETURNING *"), {"id": offer_id, "rid": rid}).mappings().first()
    if not upd:
        raise HTTPException(status_code=404, detail="Offer not found")
    return rows_to_offers([dict(upd)])[0]

@router.post("/offers/{offer_id}/duplicate", response_model=OfferOut)
def duplicate_offer(offer_id: int, request: Request, db: Session = Depends(get_db)):
    require_key(request)
    rid = get_restaurant_id_from_request(request)
    if not rid:
        raise HTTPException(status_code=400, detail="restaurant_id is required")
    src = db.execute(text("SELECT * FROM offers WHERE id=:id AND restaurant_id=:rid AND deleted_at IS NULL"), {"id": offer_id, "rid": rid}).mappings().first()
    if not src:
        raise HTTPException(status_code=404, detail="Offer not found")
    ins = text("""
        INSERT INTO offers (restaurant_id,title,description,price,original_price,qty_total,qty_left,status,expires_at,photo_url,created_at,updated_at)
        VALUES (:rid, :title, :description, :price, :orig, :qty_total, :qty_left, 'draft', :expires_at, :photo_url, NOW(), NOW())
        RETURNING *
    """)
    params = {
        "rid": rid,
        "title": src.get("title"),
        "description": src.get("description"),
        "price": src.get("price"),
        "orig": src.get("original_price"),
        "qty_total": src.get("qty_total"),
        "qty_left": src.get("qty_left"),
        "expires_at": src.get("expires_at"),
        "photo_url": src.get("photo_url")
    }
    new = db.execute(ins, params).mappings().first()
    return rows_to_offers([dict(new)])[0]

@router.delete("/offers/{offer_id}", response_model=dict)
def delete_offer(offer_id: int, request: Request, db: Session = Depends(get_db)):
    require_key(request)
    rid = get_restaurant_id_from_request(request)
    if not rid:
        raise HTTPException(status_code=400, detail="restaurant_id is required")
    upd = db.execute(text("UPDATE offers SET status='archived', deleted_at=NOW(), updated_at=NOW() WHERE id=:id AND restaurant_id=:rid AND deleted_at IS NULL RETURNING id"), {"id": offer_id, "rid": rid}).first()
    if not upd:
        existed = db.execute(text("SELECT 1 FROM offers WHERE id=:id AND restaurant_id=:rid"), {"id": offer_id, "rid": rid}).first()
        if not existed:
            raise HTTPException(status_code=404, detail="Offer not found")
    return {"ok": True, "id": offer_id}
