"""
Centralized Product Service for DialMate 2.0.
Enforces multi-tenant isolation (shop_id required).
Provides structured, normalized product data without LLM guessing.
"""

import json
import logging
from typing import List, Dict, Any, Optional
from app.memory import db_memory

logger = logging.getLogger(__name__)


def get_connection():
    return db_memory.get_connection()


def _normalize_product_row(row: tuple, has_extended_cols: bool = True) -> Dict[str, Any]:
    """
    Transforms a raw SQL row into the standardized product dictionary contract:
    {
        id,
        name,
        description,
        price,
        currency,
        stock_status,
        stock,
        variants,
        images
    }
    """
    p_id = row[0]
    name = row[1] or ""
    description = row[2] or ""
    price = float(row[3]) if row[3] is not None else 0.0
    stock = int(row[4]) if row[4] is not None else 0

    currency = "PKR"
    variants_raw = None
    images_raw = None

    if has_extended_cols and len(row) >= 8:
        currency = row[5] or "PKR"
        variants_raw = row[6]
        images_raw = row[7]

    # Calculate stock status
    if stock > 5:
        stock_status = "IN_STOCK"
    elif stock > 0:
        stock_status = "LOW_STOCK"
    else:
        stock_status = "OUT_OF_STOCK"

    # Parse variants
    variants = []
    if variants_raw:
        if isinstance(variants_raw, list):
            variants = variants_raw
        elif isinstance(variants_raw, dict):
            variants = [variants_raw]
        elif isinstance(variants_raw, str):
            try:
                parsed = json.loads(variants_raw)
                variants = parsed if isinstance(parsed, list) else [parsed]
            except Exception:
                variants = [{"title": variants_raw, "available": stock > 0}]

    # Parse images
    images = []
    if images_raw:
        if isinstance(images_raw, list):
            images = images_raw
        elif isinstance(images_raw, str):
            try:
                parsed = json.loads(images_raw)
                images = parsed if isinstance(parsed, list) else [parsed]
            except Exception:
                # Comma separated URLs
                images = [img.strip() for img in images_raw.split(",") if img.strip()]

    return {
        "id": p_id,
        "name": name,
        "description": description,
        "price": price,
        "currency": currency,
        "stock_status": stock_status,
        "stock": stock,
        "variants": variants,
        "images": images
    }


def search_products(
    shop_id: str,
    query: Optional[str] = None,
    category: Optional[str] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    color: Optional[str] = None,
    size: Optional[str] = None,
    in_stock_only: bool = False,
    limit: int = 10
) -> List[Dict[str, Any]]:
    """
    Multi-tenant product search scoped strictly to shop_id.
    Never allows cross-shop queries.
    """
    if not shop_id or not str(shop_id).strip():
        raise ValueError("shop_id is mandatory for multi-tenant product search")

    conn = None
    cur = None
    try:
        conn = get_connection()
        cur = conn.cursor()

        # Check if extended columns exist in the database table
        cur.execute(
            """
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'Product' AND column_name IN ('currency', 'variants', 'images')
            """
        )
        existing_cols = {r[0] for r in cur.fetchall()}
        has_extended = all(c in existing_cols for c in ['currency', 'variants', 'images'])

        if has_extended:
            select_cols = 'id, name, description, price, stock, currency, variants, images'
        else:
            select_cols = 'id, name, description, price, stock'

        sql = f'SELECT {select_cols} FROM "Product" WHERE "shopId" = %s'
        params: List[Any] = [shop_id]

        if query and query.strip():
            import re
            cleaned_q = re.sub(r'[^\w\s]', ' ', query).strip()
            tokens = [t for t in cleaned_q.split() if len(t) > 1]
            if tokens:
                for token in tokens:
                    q_clean = f"%{token}%"
                    sql += ' AND (name ILIKE %s OR description ILIKE %s OR category ILIKE %s)'
                    params.extend([q_clean, q_clean, q_clean])
            else:
                q_clean = f"%{query.strip()}%"
                sql += ' AND (name ILIKE %s OR description ILIKE %s OR category ILIKE %s)'
                params.extend([q_clean, q_clean, q_clean])

        if category and category.strip():
            sql += ' AND category ILIKE %s'
            params.append(f"%{category.strip()}%")

        if min_price is not None:
            sql += ' AND price >= %s'
            params.append(float(min_price))

        if max_price is not None:
            sql += ' AND price <= %s'
            params.append(float(max_price))

        if in_stock_only:
            sql += ' AND stock > 0'

        # Filter by color if provided
        if color and color.strip():
            c_clean = f"%{color.strip()}%"
            if has_extended:
                sql += ' AND (name ILIKE %s OR description ILIKE %s OR variants ILIKE %s)'
                params.extend([c_clean, c_clean, c_clean])
            else:
                sql += ' AND (name ILIKE %s OR description ILIKE %s)'
                params.extend([c_clean, c_clean])

        # Filter by size if provided
        if size and size.strip():
            s_clean = f"%{size.strip()}%"
            if has_extended:
                sql += ' AND (name ILIKE %s OR description ILIKE %s OR variants ILIKE %s)'
                params.extend([s_clean, s_clean, s_clean])
            else:
                sql += ' AND (name ILIKE %s OR description ILIKE %s)'
                params.extend([s_clean, s_clean])

        sql += f' ORDER BY stock DESC, "createdAt" DESC LIMIT %s'
        params.append(int(limit))

        cur.execute(sql, params)
        rows = cur.fetchall()

        results = [_normalize_product_row(row, has_extended_cols=has_extended) for row in rows]
        return results

    except Exception as e:
        logger.error(f"[Product Service] search_products error for shop {shop_id}: {e}")
        return []
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


def get_product_by_id(shop_id: str, product_id: str) -> Optional[Dict[str, Any]]:
    """
    Lookup a single product by ID scoped strictly to shop_id.
    """
    if not shop_id or not str(shop_id).strip():
        raise ValueError("shop_id is mandatory for product lookup")
    if not product_id or not str(product_id).strip():
        return None

    conn = None
    cur = None
    try:
        conn = get_connection()
        cur = conn.cursor()

        cur.execute(
            """
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'Product' AND column_name IN ('currency', 'variants', 'images')
            """
        )
        existing_cols = {r[0] for r in cur.fetchall()}
        has_extended = all(c in existing_cols for c in ['currency', 'variants', 'images'])

        if has_extended:
            select_cols = 'id, name, description, price, stock, currency, variants, images'
        else:
            select_cols = 'id, name, description, price, stock'

        sql = f'SELECT {select_cols} FROM "Product" WHERE "shopId" = %s AND id = %s LIMIT 1'
        cur.execute(sql, (shop_id, product_id))
        row = cur.fetchone()

        if not row:
            return None

        return _normalize_product_row(row, has_extended_cols=has_extended)

    except Exception as e:
        logger.error(f"[Product Service] get_product_by_id error for shop {shop_id}, product {product_id}: {e}")
        return None
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()
