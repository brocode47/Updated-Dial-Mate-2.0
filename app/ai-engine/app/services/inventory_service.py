"""
Centralized Inventory Service for DialMate 2.0.
Deterministic live inventory checks directly backed by PostgreSQL.
Zero LLM guessing for stock inquiries (colors, sizes, product availability).
"""

import re
import logging
from typing import Dict, Any, Optional
from app.services.product_service import search_products

logger = logging.getLogger(__name__)

COLOR_MAP = {
    "black": "black",
    "kala": "black",
    "kali": "black",
    "kale": "black",
    "white": "white",
    "safaid": "white",
    "chitta": "white",
    "red": "red",
    "lal": "red",
    "surkh": "red",
    "blue": "blue",
    "neela": "blue",
    "neeli": "blue",
    "green": "green",
    "sabz": "green",
    "hara": "green",
    "hari": "green",
    "yellow": "yellow",
    "peela": "yellow",
    "pink": "pink",
    "gulabi": "pink",
    "grey": "grey",
    "gray": "grey",
    "maroon": "maroon",
    "navy": "navy"
}

SIZE_MAP = {
    "small": "Small",
    "chota": "Small",
    "choti": "Small",
    "medium": "Medium",
    "darmiyana": "Medium",
    "large": "Large",
    "bada": "Large",
    "badi": "Large",
    "xl": "XL",
    "xxl": "XXL",
    "xs": "XS"
}


def extract_color_and_size(text: str):
    """Extract detected color and size from freeform customer text."""
    if not text:
        return None, None

    lower = text.lower()
    words = re.findall(r'\b[a-zA-Z]+\b', lower)

    detected_color = None
    for w in words:
        if w in COLOR_MAP:
            detected_color = COLOR_MAP[w]
            break

    detected_size = None
    for w in words:
        if w in SIZE_MAP:
            detected_size = SIZE_MAP[w]
            break

    return detected_color, detected_size


def get_stock_status(stock_count: int) -> str:
    """Return deterministic stock status enum string."""
    if stock_count > 5:
        return "IN_STOCK"
    elif stock_count > 0:
        return "LOW_STOCK"
    return "OUT_OF_STOCK"


def check_inventory(
    shop_id: str,
    product_name_or_query: Optional[str] = None,
    color: Optional[str] = None,
    size: Optional[str] = None,
    lang: str = "roman_urdu"
) -> Dict[str, Any]:
    """
    Check stock deterministically against database.
    Multi-tenant isolated by shop_id.
    
    Examples:
    stock > 0: "Jee black shirt available hai."
    stock = 0: "Jee filhal black color available nahi hai."
    """
    if not shop_id or not str(shop_id).strip():
        raise ValueError("shop_id is mandatory for inventory check")

    query = product_name_or_query or ""

    # Auto-extract color and size from query if not explicitly passed
    extracted_color, extracted_size = extract_color_and_size(query)
    color = color or extracted_color
    size = size or extracted_size

    # Clean query to search base product name
    cleaned = re.sub(r'[^\w\s]', ' ', query)
    tokens = [w for w in cleaned.split() if w.lower() not in {"available", "hai", "kya", "price", "stock", "milega", "chahiye", "is", "in", "ye", "yeh"}]
    
    # Extract base item name without color
    base_tokens = [w for w in tokens if w.lower() not in COLOR_MAP]
    search_query = " ".join(base_tokens) if base_tokens else " ".join(tokens)

    # Search products for this shop
    products = search_products(
        shop_id=shop_id,
        query=search_query if search_query else None,
        color=color,
        size=size,
        limit=5
    )

    if not products and search_query:
        # Fallback search without color constraint
        products = search_products(
            shop_id=shop_id,
            query=search_query,
            limit=5
        )

    if not products and tokens:
        # Fallback with raw tokens
        products = search_products(
            shop_id=shop_id,
            query=" ".join(tokens),
            limit=5
        )

    if not products:
        if lang == "urdu":
            msg = "معذرت، یہ پروڈکٹ ہمارے اسٹور پر دستیاب نہیں ہے۔"
        elif lang == "english":
            msg = "Sorry, this item is not available in our store catalog."
        else:
            msg = "Jee ye product hamaray store par available nahi hai."

        return {
            "found": False,
            "product_id": None,
            "product_name": product_name_or_query,
            "stock": 0,
            "stock_status": "NOT_FOUND",
            "price": None,
            "currency": "PKR",
            "color": color,
            "size": size,
            "message": msg
        }

    # Match primary product
    primary = products[0]
    stock = primary["stock"]
    price = primary["price"]
    currency = primary.get("currency", "PKR")
    product_name = primary["name"]

    # Check variant stock if color/size specified and variants exist
    variant_matched = False
    if (color or size) and primary.get("variants"):
        for v in primary["variants"]:
            v_title = str(v.get("title", "")).lower()
            if (color and color in v_title) or (size and size.lower() in v_title):
                variant_matched = True
                if "stock" in v:
                    stock = int(v["stock"])
                elif "available" in v:
                    stock = 5 if v["available"] else 0
                break

    stock_status = get_stock_status(stock)

    # Build deterministic message
    if stock > 0:
        if color and search_query:
            item_display = f"{color} {search_query}"
        elif color:
            item_display = f"{color} {product_name}"
        else:
            item_display = product_name

        if lang == "urdu":
            msg = f"جی {item_display} دستیاب ہے (قیمت: {price:,.0f} {currency})۔"
        elif lang == "english":
            msg = f"Yes, {item_display} is available in stock."
        else:
            msg = f"Jee {item_display} available hai."
    else:
        # Out of stock
        if color:
            subject = f"{color} color"
        elif size:
            subject = f"{size} size"
        else:
            subject = product_name

        if lang == "urdu":
            msg = f"معذرت، فی الحال {subject} دستیاب نہیں ہے۔"
        elif lang == "english":
            msg = f"Sorry, {subject} is currently out of stock."
        else:
            msg = f"Jee filhal {subject} available nahi hai."

    return {
        "found": True,
        "product_id": primary["id"],
        "product_name": product_name,
        "stock": stock,
        "stock_status": stock_status,
        "price": price,
        "currency": currency,
        "color": color,
        "size": size,
        "message": msg
    }
