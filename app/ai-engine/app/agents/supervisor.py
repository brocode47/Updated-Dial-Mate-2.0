def supervisor_agent(message: str):

    text = message.lower()


    # Owner / human request
    if any(word in text for word in [
        "boss",
        "owner",
        "malik",
        "manager",
        "management",
        "baat karwao",
        "contact",
        "insan se baat",
        "real person",
        "customer care"
    ]):
        return {
            "agent": "support_agent",
            "intent": "owner_request",
            "action": "escalate",
            "priority": "medium"
        }


    # Order status
    if any(word in text for word in [
        "order kahan",
        "order kaha",
        "mera order",
        "order status",
        "status batao",
        "track",
        "tracking",
        "parcel kahan",
        "parcel kaha",
        "order check"
    ]):
        return {
            "agent": "order_agent",
            "intent": "order_status",
            "action": "database_lookup",
            "priority": "normal"
        }


    # Cancel order
    if any(word in text for word in [
        "cancel",
        "order cancel",
        "cancle"
    ]):
        return {
            "agent": "order_agent",
            "intent": "cancel_order",
            "action": "database_update",
            "priority": "high"
        }


    # Delivery status
    if any(word in text for word in [
        "delivery",
        "parcel",
        "kab ayega",
        "kab milega",
        "shipping",
        "courier"
    ]):
        return {
            "agent": "delivery_agent",
            "intent": "delivery_status",
            "action": "database_lookup",
            "priority": "normal"
        }


    # Product recommendation / sales
    if any(word in text for word in [
        "gift",
        "suggest",
        "recommend",
        "konsa",
        "kya loon",
        "chahiye",
        "buy",
        "lena hai",
        "price",
        "budget",
        "available"
    ]):
        return {
            "agent": "sales_agent",
            "intent": "product_recommendation",
            "action": "product_search",
            "priority": "normal"
        }


    # General conversation
    return {
        "agent": "support_agent",
        "intent": "general_question",
        "action": "llm_response",
        "priority": "normal"
    }
