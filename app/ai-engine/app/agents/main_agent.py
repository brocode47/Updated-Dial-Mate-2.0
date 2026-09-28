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


def main_agent(message, order_id=None, phone=None, shop_id=None):

    history = None
    conversation_id = None
    customer_id = None
    
    if shop_id:
        history = get_conversation_history(shop_id, phone)
        conversation_id = save_message(shop_id, phone, message, "customer")
        customer_id = get_customer_id_by_phone(shop_id, phone)

    if not order_id and phone:

        customer_order = get_customer_order_by_phone(phone)

        if customer_order:
            order_id = customer_order["order_id"]


    decision = route_message(message, history)
    
    if shop_id:
        log_ai_interaction(
            shop_id=shop_id,
            customer_id=customer_id,
            conversation_id=conversation_id,
            user_message=message,
            detected_agent=decision.get("agent"),
            intent=decision.get("intent"),
            action=decision.get("action"),
            model_used=decision.get("model_used"),
            used_llm=decision.get("used_llm", False),
            fallback_used=decision.get("fallback_used", False),
            response_time_ms=decision.get("response_time_ms", 0),
            status=decision.get("status", "SUCCESS"),
            error_message=decision.get("error_message")
        )

    agent = decision["agent"]
    intent = decision["intent"]


    if agent == "support_agent":

        result = support_agent(
            intent,
            message
        )

        response = result["response"]

    elif intent == "order_status":

        if not order_id:

            response = "Jee, mujhe aap ka order record nahi mil raha."

        else:

            order = get_order(order_id)

            if order:

                response = (
                    f"Jee, main ne aap ka order check kiya hai.\n\n"
                    f"Order {order['id']} ka status {order['status']} hai."
                )

                if order.get("courier"):
                    response += (
                        f"\nCourier: {order['courier']}"
                    )

                if order.get("tracking_status"):
                    response += (
                        f"\nTracking Status: {order['tracking_status']}"
                    )

                if order.get("location"):
                    response += (
                        f"\nCurrent Location: {order['location']}"
                    )

                if order.get("expected_delivery"):
                    response += (
                        f"\nExpected Delivery: {order['expected_delivery']}"
                    )

                response += (
                    "\n\nAgar aap ko mazeed madad chahiye ho to batayein."
                )

            else:

                response = "Jee, mujhe aap ka order record nahi mil raha."


    elif intent in ["cancel_order", "confirm_order"]:

        result = order_agent(
            intent,
            order_id
        )

        response = result["message"]


    elif agent == "delivery_agent":

        result = delivery_agent(order_id)

        response = result["message"]


    elif agent in ["product_agent", "sales_agent"]:

        result = product_agent(message, history)

        response = result["message"]


    else:

        response = (
            "Jee, main aap ki madad ke liye hazir hoon. "
            "Aap apna sawal bata dein."
        )


    if shop_id:

        save_message(
            shop_id,
            phone,
            response,
            "assistant"
        )
        
        if customer_id:
            extract_and_store_customer_memory_async(shop_id, customer_id, history, message)

    return {
        "type": "conversation",
        "response": response
    }
