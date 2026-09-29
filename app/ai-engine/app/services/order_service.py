"""
Centralized Order Service for DialMate 2.0.
Enforces multi-tenant isolation (shop_id required).
Parses Shopify and internal Order.payload JSON for items, tracking, and courier.
Enforces deterministic cancellation rules.
"""

import json
import logging
from typing import Dict, Any, Optional, List
from app.memory import db_memory

logger = logging.getLogger(__name__)


def get_connection():
    return db_memory.get_connection()

NON_CANCELLABLE_STATUSES = {
    "shipped",
    "dispatched",
    "in transit",
    "delivered",
    "out for delivery",
    "completed"
}


def parse_order_payload(payload_data: Any) -> Dict[str, Any]:
    """
    Safely parse raw Order.payload (JSON string or dict).
    Extracts items, quantities, prices, courier, and tracking.
    Handles Shopify webhook formats as well as custom payload schemas.
    """
    if not payload_data:
        return {
            "items": [],
            "courier": None,
            "tracking_number": None,
            "tracking_status": None,
            "customer_name": None,
            "customer_phone": None
        }

    raw = payload_data
    if isinstance(payload_data, str):
        try:
            raw = json.loads(payload_data)
        except Exception as e:
            logger.warning(f"[Order Service] Failed to parse payload JSON: {e}")
            return {
                "items": [],
                "courier": None,
                "tracking_number": None,
                "tracking_status": None,
                "customer_name": None,
                "customer_phone": None
            }

    if not isinstance(raw, dict):
        return {
            "items": [],
            "courier": None,
            "tracking_number": None,
            "tracking_status": None,
            "customer_name": None,
            "customer_phone": None
        }

    items: List[Dict[str, Any]] = []

    # 1. Parse line items (Shopify line_items or custom items)
    raw_items = raw.get("line_items") or raw.get("items") or []
    if isinstance(raw_items, list):
        for item in raw_items:
            if isinstance(item, dict):
                title = item.get("title") or item.get("name") or "Product"
                qty = item.get("quantity") or item.get("qty") or 1
                price = item.get("price") or item.get("amount") or 0.0
                try:
                    price_val = float(price)
                except (ValueError, TypeError):
                    price_val = 0.0
                try:
                    qty_val = int(qty)
                except (ValueError, TypeError):
                    qty_val = 1

                items.append({
                    "name": title,
                    "quantity": qty_val,
                    "price": price_val
                })

    # 2. Extract Courier Name
    courier = raw.get("courier") or raw.get("courierName") or raw.get("shipping_company")
    if not courier and raw.get("shipping_lines"):
        lines = raw.get("shipping_lines")
        if isinstance(lines, list) and len(lines) > 0 and isinstance(lines[0], dict):
            courier = lines[0].get("title")

    # 3. Extract Tracking
    tracking_number = raw.get("tracking") or raw.get("tracking_number") or raw.get("trackingNumber")
    tracking_status = raw.get("tracking_status") or raw.get("trackingStatus")
    if raw.get("fulfillments") and isinstance(raw["fulfillments"], list) and len(raw["fulfillments"]) > 0:
        f = raw["fulfillments"][0]
        if isinstance(f, dict):
            courier = courier or f.get("tracking_company")
            tracking_number = tracking_number or f.get("tracking_number")
            tracking_status = tracking_status or f.get("shipment_status")

    # 4. Customer info
    cust = raw.get("customer") or {}
    cust_name = None
    cust_phone = None
    if isinstance(cust, dict):
        first = cust.get("first_name", "")
        last = cust.get("last_name", "")
        cust_name = f"{first} {last}".strip() or None
        cust_phone = cust.get("phone")
    cust_phone = cust_phone or raw.get("phone")

    return {
        "items": items,
        "courier": courier,
        "tracking_number": tracking_number,
        "tracking_status": tracking_status,
        "customer_name": cust_name,
        "customer_phone": cust_phone
    }


def _format_order_record(row: tuple) -> Dict[str, Any]:
    """
    Format SQL Order row into structured response dictionary:
    0: id
    1: orderNumber
    2: status
    3: totalAmount
    4: courierName
    5: trackingNumber
    6: trackingStatus
    7: trackingLocation
    8: expectedDelivery
    9: payload
    """
    order_id = row[0]
    order_number = row[1] or order_id
    status = row[2] or "Pending Confirmation"
    total_amount = float(row[3]) if row[3] is not None else 0.0
    courier_col = row[4]
    tracking_num_col = row[5]
    tracking_stat_col = row[6]
    tracking_loc_col = row[7]
    expected_del_col = row[8]
    payload_raw = row[9]

    parsed = parse_order_payload(payload_raw)

    courier = courier_col or parsed.get("courier")
    tracking_number = tracking_num_col or parsed.get("tracking_number")
    tracking_status = tracking_stat_col or parsed.get("tracking_status") or ("Shipped" if status.lower() == "shipped" else "Processing")

    # Determine cancellability
    status_lower = str(status).strip().lower()
    is_cancellable = status_lower not in NON_CANCELLABLE_STATUSES
    cancellation_reason = None
    if not is_cancellable:
        cancellation_reason = f"Order #{order_number} is already {status_lower} and cannot be cancelled."

    # Build readable summary
    items_summary = ", ".join([f"{it['quantity']}x {it['name']}" for it in parsed["items"]]) or "1x Order Items"
    summary_lines = [
        f"Order #{order_number} (Status: {status})",
        f"Items: {items_summary}",
        f"Total: Rs {total_amount:,.0f}"
    ]
    if courier:
        summary_lines.append(f"Courier: {courier}")
    if tracking_number:
        summary_lines.append(f"Tracking #: {tracking_number}")
    if tracking_status:
        summary_lines.append(f"Tracking Status: {tracking_status}")
    if expected_del_col:
        summary_lines.append(f"Expected Delivery: {expected_del_col}")

    return {
        "id": order_id,
        "order_number": str(order_number),
        "status": status,
        "total_amount": total_amount,
        "currency": "PKR",
        "items": parsed["items"],
        "courier": courier,
        "tracking_number": tracking_number,
        "tracking_status": tracking_status,
        "tracking_location": tracking_loc_col,
        "expected_delivery": expected_del_col,
        "is_cancellable": is_cancellable,
        "cancellation_reason": cancellation_reason,
        "formatted_summary": "\n".join(summary_lines)
    }


def get_order_by_id(shop_id: str, order_id: str) -> Optional[Dict[str, Any]]:
    """
    Lookup order by ID or order number, strictly scoped to shop_id.
    Never allows cross-shop queries.
    """
    if not shop_id or not str(shop_id).strip():
        raise ValueError("shop_id is mandatory for order lookup")
    if not order_id or not str(order_id).strip():
        return None

    clean_id = str(order_id).strip()
    # Strip leading '#' if present e.g. '#1001'
    if clean_id.startswith("#"):
        clean_id = clean_id[1:]

    conn = None
    cur = None
    try:
        conn = get_connection()
        cur = conn.cursor()

        sql = '''
        SELECT 
            id,
            "orderNumber",
            status,
            "totalAmount",
            "courierName",
            "trackingNumber",
            "trackingStatus",
            "trackingLocation",
            "expectedDelivery",
            payload
        FROM "Order"
        WHERE "shopId" = %s AND (id = %s OR "orderNumber" = %s OR "shopifyOrderGid" = %s)
        LIMIT 1
        '''
        cur.execute(sql, (shop_id, clean_id, clean_id, clean_id))
        row = cur.fetchone()

        if not row:
            return None

        return _format_order_record(row)

    except Exception as e:
        logger.error(f"[Order Service] get_order_by_id error for shop {shop_id}, order {order_id}: {e}")
        return None
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


def get_order_by_phone(shop_id: str, phone: str) -> Optional[Dict[str, Any]]:
    """
    Lookup customer's most recent order by phone number, strictly scoped to shop_id.
    Never allows cross-shop queries.
    """
    if not shop_id or not str(shop_id).strip():
        raise ValueError("shop_id is mandatory for order lookup")
    if not phone or not str(phone).strip():
        return None

    clean_phone = str(phone).strip()
    conn = None
    cur = None
    try:
        conn = get_connection()
        cur = conn.cursor()

        # Query 1: Join Customer and Order for this shop
        sql = '''
        SELECT 
            o.id,
            o."orderNumber",
            o.status,
            o."totalAmount",
            o."courierName",
            o."trackingNumber",
            o."trackingStatus",
            o."trackingLocation",
            o."expectedDelivery",
            o.payload
        FROM "Order" o
        LEFT JOIN "Customer" c ON o."customerId" = c.id
        WHERE o."shopId" = %s AND (c.phone = %s OR o.payload LIKE %s)
        ORDER BY o."createdAt" DESC
        LIMIT 1
        '''
        cur.execute(sql, (shop_id, clean_phone, f"%{clean_phone}%"))
        row = cur.fetchone()

        if not row:
            return None

        return _format_order_record(row)

    except Exception as e:
        logger.error(f"[Order Service] get_order_by_phone error for shop {shop_id}, phone {phone}: {e}")
        return None
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


def cancel_order(shop_id: str, order_id: str, lang: str = "roman_urdu") -> Dict[str, Any]:
    """
    Deterministic order cancellation with strict state validation.
    Cancellation is rejected if the order has already shipped or been delivered.
    Multi-tenant isolated by shop_id.
    """
    if not shop_id or not str(shop_id).strip():
        raise ValueError("shop_id is mandatory for order cancellation")
    if not order_id or not str(order_id).strip():
        return {
            "success": False,
            "reason": "missing_order_id",
            "message": "Order ID provide karna zaroori hai."
        }

    order = get_order_by_id(shop_id, order_id)
    if not order:
        return {
            "success": False,
            "reason": "not_found",
            "message": f"Order #{order_id} hamaray record mein nahi mila."
        }

    if not order["is_cancellable"]:
        if lang == "urdu":
            msg = f"معذرت، آرڈر #{order_id} پہلے ہی روانہ ہو چکا ہے، اس لیے منسوخ نہیں ہو سکتا۔ آپ پارسل ملنے پر ریٹرن کروا سکتے ہیں۔"
        elif lang == "english":
            msg = f"Order #{order_id} has already been dispatched and cannot be cancelled now. You may return it upon delivery."
        else:
            msg = f"Maazrat, aap ka order #{order_id} already dispatch ho chuka hai, is liye abhi cancel nahi ho sakta. Aap delivery par return karwa sakte hain."

        return {
            "success": False,
            "reason": "already_dispatched",
            "order": order,
            "message": msg
        }

    # Order is cancellable: update database
    conn = None
    cur = None
    try:
        conn = get_connection()
        cur = conn.cursor()

        cur.execute(
            'UPDATE "Order" SET status = %s, "updatedAt" = NOW() WHERE "shopId" = %s AND id = %s',
            ("Cancelled", shop_id, order["id"])
        )
        conn.commit()

        if lang == "urdu":
            msg = f"جی بالکل، آپ کا آرڈر #{order_id} کامیابی سے منسوخ کر دیا گیا ہے۔"
        elif lang == "english":
            msg = f"Your order #{order_id} has been cancelled successfully."
        else:
            msg = f"Jee, aap ka order #{order_id} cancel kar diya gaya hai."

        return {
            "success": True,
            "reason": None,
            "order_id": order_id,
            "message": msg
        }
    except Exception as e:
        logger.error(f"[Order Service] Failed to cancel order {order_id} for shop {shop_id}: {e}")
        if conn:
            conn.rollback()
        return {
            "success": False,
            "reason": "db_error",
            "message": "Technical issue ki wajah se order cancel nahi ho saka. Barah-e-karam thori der baad koshish karein."
        }
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()
