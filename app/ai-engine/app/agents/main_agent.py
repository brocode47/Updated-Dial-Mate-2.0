import uuid
from app.agents.router import route_message
from app.agents.support_agent import support_agent
from app.agents.delivery_agent import delivery_agent
from app.agents.product_agent import product_agent
from app.agents.order_agent import order_agent

from app.tools.order_tools import get_order
from app.tools.customer_tools import get_customer_order_by_phone

from app.memory.db_memory import save_message, get_customer_id_by_phone, log_ai_interaction
from app.memory.history import get_conversation_history
from app.memory.extractor import extract_and_store_customer_memory_async
from app.memory.context import get_customer_context


def main_agent(message, phone=None, shop_id=None, order_id=None, **kwargs):
    """
    Main DialMate Agent Orchestrator.
    - Backwards-compatible signature:
        main_agent(message)
        main_agent(message, phone, shop_id)
        main_agent(message, phone=..., shop_id=...)
        main_agent(message, order_id=..., phone=..., shop_id=...)
    - Multi-tenant isolated (shop_id + customer_phone)
    - Resilient to temporary DB hiccups
    - Deterministic routing (<1ms)
    - Full metadata response contract
    """
    if "order_id" in kwargs and order_id is None:
        order_id = kwargs["order_id"]
    if "phone" in kwargs and phone is None:
        phone = kwargs["phone"]
    if "shop_id" in kwargs and shop_id is None:
        shop_id = kwargs["shop_id"]

    # If phone was passed as 2nd positional argument, but it's an order_id:
    if phone is not None and shop_id is None and order_id is None:
        str_val = str(phone).strip()
        if str_val.lower().startswith("ord") or str_val.lower().startswith("order"):
            order_id = phone
            phone = None

    history = None
    conversation_id = None
    customer_id = None
    customer_memory = None
    previous_orders = []
    
    if shop_id:
        try:
            history = get_conversation_history(shop_id, phone)
            conversation_id = save_message(shop_id, phone, message, "customer")
            customer_id = get_customer_id_by_phone(shop_id, phone)
            if customer_id:
                customer_memory = get_customer_context(shop_id, customer_id)
        except Exception as e:
            print(f"[DB Warning] DB operation for customer history/context: {e}")
            if not conversation_id:
                conversation_id = str(uuid.uuid4())

    if not order_id and phone:
        try:
            customer_order = get_customer_order_by_phone(phone, shop_id=shop_id)
            if customer_order:
                order_id = customer_order["order_id"]
                previous_orders.append(customer_order)
        except Exception as e:
            print(f"[DB Warning] Order lookup by phone: {e}")

    context = {
        "history": history or [],
        "customer_memory": customer_memory or {},
        "previous_orders": previous_orders,
        "shop_id": shop_id,
        "phone": phone,
        "order_id": order_id
    }

    decision = route_message(message, context)
    
    if shop_id:
        try:
            confidence = decision.get("confidence", 0.95)
            action_with_conf = f"{decision.get('action', '')} (conf: {confidence})"
            log_ai_interaction(
                shop_id=shop_id,
                customer_id=customer_id,
                conversation_id=conversation_id,
                user_message=message,
                detected_agent=decision.get("agent"),
                intent=decision.get("intent"),
                action=action_with_conf,
                model_used=decision.get("model_used"),
                used_llm=decision.get("used_llm", False),
                fallback_used=decision.get("fallback_used", False),
                response_time_ms=decision.get("response_time_ms", 0),
                status=decision.get("status", "SUCCESS"),
                error_message=decision.get("error_message")
            )
        except Exception as e:
            print(f"[DB Warning] log_ai_interaction: {e}")

    agent = decision["agent"]
    intent = decision["intent"]

    if agent == "support_agent":
        result = support_agent(
            intent,
            message,
            context
        )
        response = result["response"]

    elif agent == "order_agent" or intent in ["order_status", "order_cancel", "cancel_order", "late_order_complaint", "confirm_order"]:
        result = order_agent(
            intent,
            order_id=order_id,
            message=message,
            context=context
        )
        response = result["message"]

    elif agent == "delivery_agent":
        result = delivery_agent(order_id)
        response = result["message"]

    elif agent in ["product_agent", "sales_agent"]:
        result = product_agent(message, context, intent=intent)
        response = result["message"]

    else:
        response = (
            "Jee, main aap ki madad ke liye hazir hoon. "
            "Aap apna sawal bata dein."
        )

    if shop_id:
        try:
            save_message(
                shop_id,
                phone,
                response,
                "assistant"
            )
            if customer_id:
                extract_and_store_customer_memory_async(shop_id, customer_id, history, message)
        except Exception as e:
            print(f"[DB Warning] save_message assistant: {e}")

    return {
        "type": "conversation",
        "response": response,
        "agent": agent,
        "intent": intent,
        "confidence": decision.get("confidence", 0.95),
        "conversation_id": conversation_id
    }
