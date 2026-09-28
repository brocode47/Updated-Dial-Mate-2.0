from app.agents.supervisor import supervisor_agent


def route_message(message, context=None):
    if context is None:
        context = {"history": [], "customer_memory": {}, "previous_orders": []}

    decision = supervisor_agent(message, context)

    return decision
