# backend/app/schemas/offers_v2.py
from typing import Optional, List, Literal
from pydantic import BaseModel, Field
from datetime import datetime

OfferStatus = Literal["draft","scheduled","active","paused","expired","archived"]

class OfferOut(BaseModel):
    id: int
    restaurant_id: int
    title: str = ""
    description: Optional[str] = ""
    price: Optional[float] = None
    original_price: Optional[float] = None
    discount_percent: Optional[int] = None
    qty_total: Optional[int] = None
    qty_left: Optional[int] = None
    status: OfferStatus = "active"
    expires_at: Optional[datetime] = None
    photo_url: Optional[str] = None
    reservations_count: int = 0
    redemptions_count: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

class OfferListOut(BaseModel):
    items: List[OfferOut]
    page: int = 1
    limit: int = 50
    total: Optional[int] = None

class KPI(BaseModel):
    revenue_today: float = 0.0
    reservations_today: int = 0
    redemptions_today: int = 0
    active_offers: int = 0

class SeriesPoint(BaseModel):
    date: datetime
    reservations: int = 0
    redemptions: int = 0
    revenue: float = 0.0

class MetricsOut(BaseModel):
    kpi: KPI
    series: list[SeriesPoint] = []
