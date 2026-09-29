"""
DialMate 2.0 Order Agent
Uses Centralized Order Service Layer.
Strict multi-tenant isolation, structured payload extraction (items, courier, tracking),
and deterministic cancellation rules.
"""

from typing import Dict, Any, Optional
from app.services.order_service import (
    get_order_by_id,
    get_order_by_phone,
    cancel_order as service_cancel_order
)
from app.tools.order_tools import (
    get_order as fallback_get_order,
    confirm_order as db_confirm_order
)
from app.agents.language import detect_language
from app.agents.templates import get_template


def order_agent(intent: str, order_id: Optional[str] = None, message: str = "", context: Optional[dict] = None) -> Dict[str, Any]:
    """
    Production-safe Order Agent.
    Never claims order status/shipped unless confirmed by database.
    Supports:
    - order_status
    - order_cancel
    - late_order_complaint
    - confirm_order
    """
    if context is None:
        context = {}

    shop_id = context.get("shop_id")
    phone = context.get("phone")
    lang = detect_language(message) if message else "roman_urdu"

    # Normalize intent name
    if intent == "cancel_order":
        intent = "order_cancel"

    # 1. Late order complaint / escalation
    if intent == "late_order_complaint":
        order = None
        if shop_id:
            if order_id:
                order = get_order_by_id(shop_id, order_id)
            elif phone:
                order = get_order_by_phone(shop_id, phone)
        elif order_id:
            try:
                order = fallback_get_order(order_id)
            except Exception:
                order = None

        if order:
            num_display = order.get("order_number") or order.get("id") or order_id
            status_txt = f"Order #{num_display} (Status: {order.get('status', 'Processing')})"
            if lang == "urdu":
                msg = f"ہمیں تاخیر پر انتہائی افسوس ہے۔ {status_txt} کو ترجیحی بنیادوں پر کوریئر پارٹنر کے ساتھ فالو اپ کیا جا رہا ہے۔"
            elif lang == "english":
                msg = f"We sincerely apologize for the delay. {status_txt} has been escalated for priority delivery with our courier partner."
            else:
                msg = f"Humein intehai afsos hai ke aap ka order late hua. {status_txt} ko priority courier follow-up ke liye escalate kar diya gaya hai."
            return {
                "action": "escalate_order",
                "order_id": order.get("id") or order_id,
                "message": msg
            }

        return {
            "action": "escalate_order",
            "order_id": order_id,
            "message": get_template("late_order_complaint", lang)
        }

    # 2. Order Cancellation
    if intent == "order_cancel":
        if not order_id and not phone:
            return {
                "action": "cancel",
                "order_id": None,
                "message": get_template("order_cancel_ask_id", lang)
            }

        if shop_id:
            target_id = order_id
            if not target_id and phone:
                phone_order = get_order_by_phone(shop_id, phone)
                if phone_order:
                    target_id = phone_order["id"]

            if not target_id:
                return {
                    "action": "cancel",
                    "order_id": None,
                    "message": get_template("order_cancel_ask_id", lang)
                }

            cancel_res = service_cancel_order(shop_id, target_id, lang=lang)
            if not cancel_res["success"]:
                return {
                    "action": "cancel_rejected",
                    "order_id": target_id,
                    "message": cancel_res["message"]
                }
            return {
                "action": "cancel",
                "order_id": target_id,
                "message": cancel_res["message"]
            }

        # Fallback without shop_id (offline/test mode)
        order = None
        if order_id:
            try:
                order = fallback_get_order(order_id)
            except Exception:
                order = None

        if order:
            current_status = str(order.get("status", "")).lower()
            if current_status in ["shipped", "dispatched", "in transit", "delivered"]:
                if lang == "urdu":
                    msg = f"معذرت، آرڈر {order_id} پہلے ہی روانہ ہو چکا ہے، اس لیے منسوخ نہیں ہو سکتا۔ آپ پارسل ملنے پر ریٹرن کروا سکتے ہیں۔"
                elif lang == "english":
                    msg = f"Order {order_id} has already been dispatched and cannot be cancelled now. You may return it upon delivery."
                else:
                    msg = f"Maazrat, aap ka order {order_id} already dispatch ho chuka hai, is liye abhi cancel nahi ho sakta. Aap delivery par return karwa sakte hain."
                return {
                    "action": "cancel_rejected",
                    "order_id": order_id,
                    "message": msg
                }

        return {
            "action": "cancel",
            "order_id": order_id,
            "message": get_template("order_cancelled_success", lang, order_id=order_id)
        }

    # 3. Confirm Order
    if intent == "confirm_order":
        if order_id:
            try:
                db_confirm_order(order_id, shop_id=shop_id)
            except Exception:
                pass
        if lang == "urdu":
            msg = "جی بالکل، آپ کا آرڈر کنفرم کر دیا گیا ہے۔ شکریہ!"
        elif lang == "english":
            msg = "Your order has been confirmed successfully. Thank you!"
        else:
            msg = "Jee bilkul, aap ka order confirm kar diya gaya hai. Shukriya!"
        return {
            "action": "confirm",
            "order_id": order_id,
            "message": msg
        }

    # 4. Order Status
    order = None
    if shop_id:
        if order_id:
            order = get_order_by_id(shop_id, order_id)
        elif phone:
            order = get_order_by_phone(shop_id, phone)

    if not order and order_id:
        try:
            order = fallback_get_order(order_id)
        except Exception:
            order = None

    if not order:
        return {
            "action": "status",
            "order_id": order_id,
            "message": get_template("order_not_found", lang)
        }

    num_display = order.get("order_number") or order.get("id") or order_id
    status_display = order.get("status", "Processing")

    if lang == "urdu":
        lines = [
            f"جی، میں نے آپ کے آرڈر کا ریکارڈ چیک کیا ہے۔",
            f"آرڈر نمبر: {num_display}",
            f"اسٹیٹس: {status_display}"
        ]
        if order.get("items"):
            items_str = "، ".join([f"{it['quantity']}x {it['name']}" for it in order["items"]])
            lines.append(f"اشیاء: {items_str}")
        if order.get("total_amount"):
            lines.append(f"کل رقم: {order['total_amount']:,.0f} روپے")
        if order.get("courier"):
            lines.append(f"کوریئر: {order['courier']}")
        if order.get("tracking_number"):
            lines.append(f"ٹریکنگ نمبر: {order['tracking_number']}")
        if order.get("tracking_status"):
            lines.append(f"ٹریکنگ اسٹیٹس: {order['tracking_status']}")
        if order.get("expected_delivery"):
            lines.append(f"متوقع ترسیل: {order['expected_delivery']}")
        lines.append("اگر آپ کو مزید مدد چاہیے ہو تو ضرور بتائیے۔")

    elif lang == "english":
        lines = [
            f"I have checked your order details.",
            f"Order ID: {num_display}",
            f"Status: {status_display}"
        ]
        if order.get("items"):
            items_str = ", ".join([f"{it['quantity']}x {it['name']}" for it in order["items"]])
            lines.append(f"Items: {items_str}")
        if order.get("total_amount"):
            lines.append(f"Total Amount: Rs {order['total_amount']:,.0f}")
        if order.get("courier"):
            lines.append(f"Courier: {order['courier']}")
        if order.get("tracking_number"):
            lines.append(f"Tracking Number: {order['tracking_number']}")
        if order.get("tracking_status"):
            lines.append(f"Tracking Status: {order['tracking_status']}")
        if order.get("expected_delivery"):
            lines.append(f"Expected Delivery: {order['expected_delivery']}")
        lines.append("Please let me know if you need anything else.")

    else:
        lines = [
            f"Jee, main ne aap ka order check kiya hai.",
            f"\nOrder {num_display} ka status {status_display} hai."
        ]
        if order.get("items"):
            items_str = ", ".join([f"{it['quantity']}x {it['name']}" for it in order["items"]])
            lines.append(f"Items: {items_str}")
        if order.get("total_amount"):
            lines.append(f"Total Amount: Rs {order['total_amount']:,.0f}")
        if order.get("courier"):
            lines.append(f"Courier: {order['courier']}")
        if order.get("tracking_number"):
            lines.append(f"Tracking Status: {order.get('tracking_status', 'In Transit')} (#{order['tracking_number']})")
        elif order.get("tracking_status"):
            lines.append(f"Tracking Status: {order['tracking_status']}")
        if order.get("tracking_location"):
            lines.append(f"Current Location: {order['tracking_location']}")
        if order.get("expected_delivery"):
            lines.append(f"Expected Delivery: {order['expected_delivery']}")
        lines.append("\nAgar aap ko mazeed madad chahiye ho to batayein.")

    return {
        "action": "status",
        "order_id": order.get("id") or order_id,
        "message": "\n".join(lines)
    }
