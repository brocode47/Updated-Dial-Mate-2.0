import json
from app.models.llm import llm

import concurrent.futures

def _call_llm(messages):
    return llm.invoke(messages)

def supervisor_agent(message: str, history: list = None):
    # 1. Prepare history context
    history_context = ""
    if history:
        for msg in reversed(history):
            role = msg.get("role", "customer")
            history_context += f"{role.capitalize()}: {msg['content']}\n"
            
    # 2. Define stronger system prompt
    system_prompt = """You are an intent routing supervisor. Your ONLY job is to classify the customer's intent into a JSON object.
NEVER perform database actions. NEVER write conversational responses.
Allowed agents MUST be EXACTLY one of:
- product_agent (gift, recommendation, buy, pricing)
- order_agent (order status, cancel order)
- delivery_agent (parcel arrival, delivery tracking)
- support_agent (human request, general chat, unknown)

Return ONLY valid JSON. No markdown formatting. No markdown backticks. No explanations.
Example output format:
{
 "agent": "product_agent",
 "intent": "product_recommendation",
 "action": "product_search",
 "priority": "normal"
}"""

    human_prompt = f"History:\n{history_context}\nCurrent Message: {message}"
    
    # 3. Call LLM with 3-second timeout and fallback
    try:
        messages_payload = [
            ("system", system_prompt),
            ("human", human_prompt)
        ]
        
        # Enforce 3-second hard timeout without blocking on exit
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        try:
            future = executor.submit(_call_llm, messages_payload)
            response = future.result(timeout=3.0)
        finally:
            executor.shutdown(wait=False)
        
        content = response.content.strip()
        # Clean up markdown formatting if present
        if content.startswith("```json"):
            content = content[7:]
        if content.endswith("```"):
            content = content[:-3]
        if content.startswith("```"):
            content = content[3:]
            
        decision = json.loads(content.strip())
        
        # 4. JSON Schema Validation
        required_keys = {"agent", "intent", "action", "priority"}
        if not required_keys.issubset(decision.keys()):
            raise ValueError("Missing required JSON keys")
            
        allowed_agents = ["product_agent", "order_agent", "delivery_agent", "support_agent", "sales_agent"]
        agent_name = decision.get("agent")
        
        if agent_name not in allowed_agents:
            raise ValueError(f"Invalid agent: {agent_name}")
            
        if agent_name == "sales_agent":
            decision["agent"] = "product_agent"
            
        return decision
            
    except concurrent.futures.TimeoutError:
        print("[LLM Supervisor] Timeout exceeded (>3s). Falling back to keyword routing.")
    except json.JSONDecodeError:
        print("[LLM Supervisor] Invalid JSON returned. Falling back to keyword routing.")
    except Exception as e:
        print(f"[LLM Supervisor Fallback] Error: {e}")

    # 5. Fallback to robust keyword routing if LLM fails
    return keyword_supervisor_agent(message, history)

def keyword_supervisor_agent(message: str, history: list = None):
    text = message.lower()
    
    if any(word in text for word in ["boss", "owner", "malik", "manager", "management", "baat karwao", "contact", "insan se baat", "real person", "customer care"]):
        return {"agent": "support_agent", "intent": "owner_request", "action": "escalate", "priority": "medium"}
        
    if any(word in text for word in ["order kahan", "order kaha", "mera order", "order status", "status batao", "track", "tracking", "parcel kahan", "parcel kaha", "order check"]):
        return {"agent": "order_agent", "intent": "order_status", "action": "database_lookup", "priority": "normal"}
        
    if any(word in text for word in ["cancel", "order cancel", "cancle"]):
        return {"agent": "order_agent", "intent": "cancel_order", "action": "database_update", "priority": "high"}
        
    if any(word in text for word in ["delivery", "parcel", "kab ayega", "kab milega", "shipping", "courier"]):
        return {"agent": "delivery_agent", "intent": "delivery_status", "action": "database_lookup", "priority": "normal"}
        
    if any(word in text for word in ["gift", "suggest", "recommend", "konsa", "kya loon", "chahiye", "buy", "lena hai", "price", "budget", "available"]):
        return {"agent": "sales_agent", "intent": "product_recommendation", "action": "product_search", "priority": "normal"}

    # Context fallback
    if history:
        for msg in reversed(history):
            if msg.get("role") == "customer":
                fallback_decision = keyword_supervisor_agent(msg["content"], history=None)
                if fallback_decision["intent"] != "general_question":
                    return fallback_decision
                break

    return {"agent": "support_agent", "intent": "general_question", "action": "llm_response", "priority": "normal"}
