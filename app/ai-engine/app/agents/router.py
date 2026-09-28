from app.agents.supervisor import supervisor_agent


def route_message(message, history=None):

    decision = supervisor_agent(message, history)

    return decision
