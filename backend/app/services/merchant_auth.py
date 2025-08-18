# backend/app/services/merchant_auth.py
from fastapi import Request, HTTPException
from typing import Optional

def get_restaurant_id_from_request(request: Request) -> Optional[int]:
    rid = request.query_params.get("restaurant_id")
    if rid:
        try:
            return int(rid)
        except ValueError:
            raise HTTPException(status_code=400, detail="restaurant_id must be int")
    return None

def require_key(request: Request) -> str:
    key = request.headers.get("X-Foody-Key") or request.headers.get("x-foody-key")
    if not key:
        raise HTTPException(status_code=401, detail="X-Foody-Key is required")
    return key
