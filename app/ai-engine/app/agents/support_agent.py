from app.models.llm import safe_llm_invoke

# Template responses for common support scenarios
OWNER_RESPONSE = (
    "Jee, main Dial Mate AI hoon. Main customers ki madad ke liye bana hoon. "
    "Agar aap management ya owner se baat karna chahte hain to main aap ki request note kar sakta hoon."
)

GENERAL_FALLBACK = "Jee, main aap ki madad ke liye hazir hoon. Aap apna sawal bata dein."


def support_agent(intent, message, context=None):
    if context is None:
        context = {"history": [], "customer_memory": {}, "previous_orders": []}
        
    memory = context.get("customer_memory", {})

    if intent == "owner_request":
        return {
            "response": OWNER_RESPONSE,
            "action": "escalate"
        }

    # For general questions, try LLM with timeout protection + fallback
    system_prompt = f"""You are a helpful Pakistani customer support agent named DialMate.
You must respond in Roman Urdu ONLY. Keep responses short and conversational.
The customer has asked a general question or needs support.
Customer Intelligence:
- Preferred Categories: {memory.get('preferred_categories', 'None')}
- General Preferences: {memory.get('preferences', 'None')}

Acknowledge their preferences if relevant, but answer their message directly."""
    
    result = safe_llm_invoke([("system", system_prompt), ("human", f"Message: {message}")])

    if result is None:
        # LLM unavailable — use template fallback
        return {
            "response": GENERAL_FALLBACK,
            "action": "continue"
        }

    return {
        "response": result,
        "action": "continue"
    }
