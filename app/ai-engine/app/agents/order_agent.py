def order_agent(intent: str, order_id: str):

    if intent == "order_status":
        if order_id:
            return {
                "action": "status",
                "order_id": order_id,
                "message": f"Jee, aap ke order {order_id} ka status check kar diya gaya hai."
            }

        return {
            "action": "status",
            "order_id": None,
            "message": "Jee, mujhe aap ka order record nahi mil raha."
        }


    if intent == "confirm_order":
        return {
            "action": "confirm",
            "order_id": order_id,
            "message": "Jee bilkul, aap ka order confirm kar diya gaya hai."
        }


    if intent == "cancel_order":
        return {
            "action": "cancel",
            "order_id": order_id,
            "message": "Theek hai, aap ka order cancel kar diya jayega."
        }


    return {
        "action": "unknown",
        "order_id": order_id,
        "message": "Jee, main aap ke order ki maloomat check karta hoon."
    }
