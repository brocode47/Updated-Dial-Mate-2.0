import json
import time
from app.models.llm import llm
from app.config import AI_MODEL, LLM_TIMEOUT_SECONDS
import concurrent.futures

def _call_llm(messages):
    return llm.invoke(messages)

def supervisor_agent(message: str, context: dict = None):
    if context is None:
        context = {"history": [], "customer_memory": {}, "previous_orders": []}
        
    history = context.get("history", [])
    customer_memory = context.get("customer_memory", {})

    # 1. Prepare history context (Limit to last 3 messages to avoid large prompts)
    recent_history = history[-3:] if len(history) > 3 else history
    history_context = ""
    for msg in reversed(recent_history):
        role = msg.get("role", "customer")
        content = msg.get("content", "")
        # Truncate overly long individual messages
        if len(content) > 150:
            content = content[:147] + "..."
        history_context += f"{role.capitalize()}: {content}\n"
            
    # 1b. Prepare small customer intelligence summary
    customer_intel = ""
    if customer_memory:
        prefs = customer_memory.get("preferences", "")
        cats = customer_memory.get("preferred_categories", "")
        
        # Keep summary extremely short for supervisor
        summary = []
        if cats:
            summary.append(f"Prefers {cats[:50]}")
        if prefs:
            summary.append(f"Notes: {prefs[:50]}")
            
        if summary:
            customer_intel = f"\nCustomer Summary: {', '.join(summary)}"

    # 2. Define stronger system prompt
    system_prompt = f"""You are an intent routing supervisor. Your ONLY job is to classify the customer's intent into a JSON object.
NEVER perform database actions. NEVER write conversational responses.
Allowed agents MUST be EXACTLY one of:
- product_agent (gift, recommendation, buy, pricing)
- order_agent (order status, cancel order)
- delivery_agent (parcel arrival, delivery tracking)
- support_agent (human request, general chat, unknown)

Return ONLY valid JSON. No markdown formatting. No markdown backticks. No explanations.
Example output format:
{{
 "agent": "product_agent",
 "intent": "product_recommendation",
 "action": "product_search",
 "priority": "normal"
}}{customer_intel}"""

    human_prompt = f"History:\n{history_context}\nCurrent Message: {message}"
    
    # Calculate sizes for logging
    prompt_chars = len(system_prompt) + len(human_prompt)
    mem_size = len(customer_intel)
    print(f"[LLM Supervisor]")
    print(f"Context characters: {prompt_chars}")
    print(f"History messages: {len(recent_history)}")
    print(f"Customer memory size: {mem_size}")

    # 3. Call LLM with configured timeout and fallback
    error_msg = None
    try:
        print(f"[LLM Supervisor] Using model: {AI_MODEL}")
        print(f"[LLM Supervisor] Timeout configured: {LLM_TIMEOUT_SECONDS} seconds")
        
        messages_payload = [
            ("system", system_prompt),
            ("human", human_prompt)
        ]
        
        # Enforce hard timeout without blocking on exit
        start_time = time.time()
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        try:
            future = executor.submit(_call_llm, messages_payload)
            response = future.result(timeout=LLM_TIMEOUT_SECONDS)
        finally:
            executor.shutdown(wait=False)
            
        elapsed_time = time.time() - start_time
        print(f"[LLM Supervisor] LLM response received in {elapsed_time:.2f} seconds")
        
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
            
        decision["model_used"] = AI_MODEL
        decision["used_llm"] = True
        decision["fallback_used"] = False
        decision["response_time_ms"] = int(elapsed_time * 1000)
        decision["status"] = "SUCCESS"
        decision["error_message"] = None
            
        return decision
            
    except concurrent.futures.TimeoutError:
        error_msg = f"Timeout exceeded (>{LLM_TIMEOUT_SECONDS}s)"
        print(f"[LLM Supervisor] {error_msg}. Falling back to keyword routing.")
    except json.JSONDecodeError:
        error_msg = "Invalid JSON returned"
        print(f"[LLM Supervisor] {error_msg}. Falling back to keyword routing.")
    except Exception as e:
        error_msg = str(e)
        print(f"[LLM Supervisor Fallback] Error: {e}")

    # 5. Fallback to robust keyword routing if LLM fails
    fallback_decision = keyword_supervisor_agent(message, context)
    fallback_decision["model_used"] = None
    fallback_decision["used_llm"] = False
    fallback_decision["fallback_used"] = True
    fallback_decision["response_time_ms"] = 0
    fallback_decision["status"] = "FALLBACK"
    fallback_decision["error_message"] = error_msg
    return fallback_decision

def keyword_supervisor_agent(message: str, context: dict = None):
    text = message.lower()
    if context is None:
        context = {"history": [], "customer_memory": {}}
    history = context.get("history", [])
    
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
                fallback_decision = keyword_supervisor_agent(msg["content"], context={"history": None})
                if fallback_decision["intent"] != "general_question":
                    return fallback_decision
                break

    return {"agent": "support_agent", "intent": "general_question", "action": "llm_response", "priority": "normal"}
