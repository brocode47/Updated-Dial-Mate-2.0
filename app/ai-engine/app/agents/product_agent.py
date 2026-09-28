from app.tools.product_tools import search_products
from app.models.llm import llm

def product_agent(message, context=None):
    if context is None:
        context = {"history": [], "customer_memory": {}, "previous_orders": []}
        
    history = context.get("history", [])
    memory = context.get("customer_memory", {})

    text = message.lower()
    if history:
        for msg in reversed(history):
            if msg.get("role") == "customer":
                text += " " + msg["content"].lower()
                break

    products = []
    
    # We still use keyword logic but enhance it using memory
    search_category = "gift"
    if memory.get("preferred_categories"):
        search_category = memory["preferred_categories"].split(",")[0].strip()

    max_price = memory.get("average_budget") or 10000

    if "gift" in text or "wife" in text or "biwi" in text or "suggest" in text or "recommend" in text:
        products = search_products(
            category=search_category,
            max_price=max_price
        )

    if products:
        product_list_str = "\n".join([f"- {p[0]} - Rs {p[2]}" for p in products])
        
        system_prompt = f"""You are a helpful Pakistani customer support agent named DialMate.
You must respond in Roman Urdu ONLY. Keep responses short and conversational.
The customer has asked for product recommendations.
Here are the products found in the database:
{product_list_str}

Customer Intelligence:
- Preferred Categories: {memory.get('preferred_categories', 'None')}
- Preferred Products: {memory.get('preferred_products', 'None')}
- Average Budget: {memory.get('average_budget', 'None')}
- General Preferences: {memory.get('preferences', 'None')}

Draft a short response recommending these products. Mention their preferences (e.g. "Jee, aap ko pehle {memory.get('preferred_categories', 'gifts')} pasand aaye thay, is budget mein ye options suitable hain:").
Format as a direct response to the user. Do not include markdown blocks."""
        
        human_prompt = f"Message: {message}"
        
        response = llm.invoke([("system", system_prompt), ("human", human_prompt)])
        result = response.content.strip()

        return {
            "message": result
        }

    # If no products matched or search wasn't triggered
    system_prompt = f"""You are a helpful Pakistani customer support agent named DialMate.
You must respond in Roman Urdu ONLY. Keep responses short and conversational.
The customer wants a recommendation but we need their budget or category preference.
Customer Intelligence:
- Preferred Categories: {memory.get('preferred_categories', 'None')}
- Average Budget: {memory.get('average_budget', 'None')}

Politely ask for their budget or preferences to suggest a suitable gift."""
    
    response = llm.invoke([("system", system_prompt), ("human", f"Message: {message}")])
    return {
        "message": response.content.strip()
    }
