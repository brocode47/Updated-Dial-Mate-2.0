from app.models.llm import llm

def support_agent(intent, message, context=None):
    if context is None:
        context = {"history": [], "customer_memory": {}, "previous_orders": []}
        
    memory = context.get("customer_memory", {})

    if intent == "owner_request":
        return {
            "response":
            "Jee, main Dial Mate AI hoon. Main customers ki madad ke liye bana hoon. "
            "Agar aap management ya owner se baat karna chahte hain to main aap ki request note kar sakta hoon.",
            "action": "escalate"
        }

    # For general questions, generate a personalized response
    system_prompt = f"""You are a helpful Pakistani customer support agent named DialMate.
You must respond in Roman Urdu ONLY. Keep responses short and conversational.
The customer has asked a general question or needs support.
Customer Intelligence:
- Preferred Categories: {memory.get('preferred_categories', 'None')}
- General Preferences: {memory.get('preferences', 'None')}

Acknowledge their preferences if relevant, but answer their message directly."""
    
    response = llm.invoke([("system", system_prompt), ("human", f"Message: {message}")])

    return {
        "response": response.content.strip(),
        "action": "continue"
    }
