from app.agents.router import route_message
from app.agents.support_agent import support_agent
from app.agents.delivery_agent import delivery_agent
from app.agents.product_agent import product_agent
from app.agents.order_agent import order_agent

from app.tools.order_tools import get_order
from app.tools.customer_tools import get_customer_order_by_phone

from app.memory.db_memory import save_message


def main_agent(message, order_id=None, phone=None, shop_id=None):

    if shop_id:
        save_message(shop_id, phone, message, "customer")


    if not order_id and phone:

        customer_order = get_customer_order_by_phone(phone)

        if customer_order:
            order_id = customer_order["order_id"]


    decision = route_message(message)

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

        result = product_agent(message)

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


    return {
        "type": "conversation",
        "response": response
    }
