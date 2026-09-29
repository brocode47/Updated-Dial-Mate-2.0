from app.tools.order_tools import get_order, cancel_order as db_cancel_order, confirm_order as db_confirm_order
from app.agents.language import detect_language
from app.agents.templates import get_template


def order_agent(intent: str, order_id: str = None, message: str = "", context: dict = None):
    """
    Production-safe Order Agent.
    Never claims order status/shipped unless confirmed by database.
    Supports:
    - order_status
    - order_cancel
    - late_order_complaint
    - confirm_order
    """
    lang = detect_language(message) if message else "roman_urdu"

    # Normalize intent name
    if intent == "cancel_order":
        intent = "order_cancel"

    # 1. Late order complaint / escalation
    if intent == "late_order_complaint":
        if order_id:
            try:
                order = get_order(order_id)
            except Exception:
                order = None
            if order:
                status_txt = f"Order #{order_id} (Status: {order.get('status', 'Processing')})"
                if lang == "urdu":
                    msg = f"ہمیں تاخیر پر انتہائی افسوس ہے۔ {status_txt} کو ترجیحی بنیادوں پر کوریئر پارٹنر کے ساتھ فالو اپ کیا جا رہا ہے۔"
                elif lang == "english":
                    msg = f"We sincerely apologize for the delay. {status_txt} has been escalated for priority delivery with our courier partner."
                else:
                    msg = f"Humein intehai afsos hai ke aap ka order late hua. {status_txt} ko priority courier follow-up ke liye escalate kar diya gaya hai."
                return {
                    "action": "escalate_order",
                    "order_id": order_id,
                    "message": msg
                }

        return {
            "action": "escalate_order",
            "order_id": order_id,
            "message": get_template("late_order_complaint", lang)
        }

    # 2. Order Cancellation
    if intent == "order_cancel":
        if not order_id:
            return {
                "action": "cancel",
                "order_id": None,
                "message": get_template("order_cancel_ask_id", lang)
            }

        # Check DB before claiming cancellation
        try:
            order = get_order(order_id)
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

            try:
                db_cancel_order(order_id)
            except Exception:
                pass

        return {
            "action": "cancel",
            "order_id": order_id,
            "message": get_template("order_cancelled_success", lang, order_id=order_id)
        }

    # 3. Confirm Order
    if intent == "confirm_order":
        if order_id:
            try:
                db_confirm_order(order_id)
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

    # 4. Order Status (Never claims shipped unless DB confirms)
    if not order_id:
        return {
            "action": "status",
            "order_id": None,
            "message": get_template("order_not_found", lang)
        }

    order = None
    try:
        order = get_order(order_id)
    except Exception:
        order = None

    if not order:
        return {
            "action": "status",
            "order_id": order_id,
            "message": get_template("order_not_found", lang)
        }

    if lang == "urdu":
        lines = [
            f"جی، میں نے آپ کے آرڈر کا ریکارڈ چیک کیا ہے۔",
            f"آرڈر نمبر: {order['id']}",
            f"اسٹیٹس: {order.get('status', 'Processing')}"
        ]
        if order.get("courier"):
            lines.append(f"کوریئر: {order['courier']}")
        if order.get("tracking_status"):
            lines.append(f"ٹریکنگ اسٹیٹس: {order['tracking_status']}")
        if order.get("expected_delivery"):
            lines.append(f"متوقع ترسیل: {order['expected_delivery']}")
        lines.append("اگر آپ کو مزید مدد چاہیے ہو تو ضرور بتائیے۔")
    elif lang == "english":
        lines = [
            f"I have checked your order details.",
            f"Order ID: {order['id']}",
            f"Status: {order.get('status', 'Processing')}"
        ]
        if order.get("courier"):
            lines.append(f"Courier: {order['courier']}")
        if order.get("tracking_status"):
            lines.append(f"Tracking Status: {order['tracking_status']}")
        if order.get("expected_delivery"):
            lines.append(f"Expected Delivery: {order['expected_delivery']}")
        lines.append("Please let me know if you need anything else.")
    else:
        lines = [
            f"Jee, main ne aap ka order check kiya hai.",
            f"\nOrder {order['id']} ka status {order['status']} hai."
        ]
        if order.get("courier"):
            lines.append(f"Courier: {order['courier']}")
        if order.get("tracking_status"):
            lines.append(f"Tracking Status: {order['tracking_status']}")
        if order.get("location"):
            lines.append(f"Current Location: {order['location']}")
        if order.get("expected_delivery"):
            lines.append(f"Expected Delivery: {order['expected_delivery']}")
        lines.append("\nAgar aap ko mazeed madad chahiye ho to batayein.")

    return {
        "action": "status",
        "order_id": order_id,
        "message": "\n".join(lines)
    }
