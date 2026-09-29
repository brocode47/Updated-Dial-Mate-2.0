import json
import time
from app.config import AI_MODEL, LLM_TIMEOUT_SECONDS, SUPERVISOR_MODE
import concurrent.futures


def _call_routing_llm(messages):
    """Lazy import to avoid circular deps and allow routing_llm to remain optional."""
    from app.models.llm import routing_llm
    return routing_llm.invoke(messages)


def supervisor_agent(message: str, context: dict = None):
    """
    Hybrid supervisor with configurable routing strategy.
    
    SUPERVISOR_MODE (env var):
      - "keyword"  → Deterministic keyword matching (default, <1ms)
      - "llm"      → LLM-powered intent classification (slower, needs Ollama)
      - "hybrid"   → Try LLM first, fall back to keyword on failure
    """
    if context is None:
        context = {"history": [], "customer_memory": {}, "previous_orders": []}

    start_time = time.time()

    if SUPERVISOR_MODE == "llm":
        return _llm_route(message, context, start_time)
    elif SUPERVISOR_MODE == "hybrid":
        result = _llm_route(message, context, start_time)
        if result.get("status") != "FALLBACK":
            return result
        # LLM failed, fall through to keyword
        return result  # already contains fallback decision
    else:
        # Default: fast keyword routing
        decision = keyword_supervisor_agent(message, context)
        elapsed = time.time() - start_time
        decision["model_used"] = None
        decision["used_llm"] = False
        decision["fallback_used"] = False
        decision["response_time_ms"] = int(elapsed * 1000)
        decision["status"] = "SUCCESS"
        decision["error_message"] = None
        print(f"[Keyword Supervisor] Routed to {decision['agent']} in {elapsed*1000:.0f}ms")
        return decision


def _llm_route(message: str, context: dict, start_time: float):
    """Attempt LLM-based routing with timeout protection."""
    history = context.get("history", [])
    customer_memory = context.get("customer_memory", {})

    # Limit history to last 3 messages, truncate long ones
    recent_history = history[-3:] if len(history) > 3 else history
    history_context = ""
    for msg in reversed(recent_history):
        role = msg.get("role", "customer")
        content = msg.get("content", "")[:150]
        history_context += f"{role.capitalize()}: {content}\n"

    # Minimal customer summary for routing only
    customer_intel = ""
    if customer_memory:
        cats = customer_memory.get("preferred_categories", "")
        if cats:
            customer_intel = f"\nCustomer prefers: {cats[:50]}"

    # Compact system prompt — every character costs latency
    system_prompt = f"""Classify intent into JSON. Allowed agents: product_agent, order_agent, delivery_agent, support_agent.
Return ONLY: {{"agent":"...","intent":"...","action":"...","priority":"normal"}}
{customer_intel}"""

    human_prompt = f"{history_context}Message: {message}" if history_context else f"Message: {message}"

    prompt_chars = len(system_prompt) + len(human_prompt)
    print(f"[LLM Supervisor] Context: {prompt_chars} chars | History: {len(recent_history)} msgs | Model: {AI_MODEL} | Timeout: {LLM_TIMEOUT_SECONDS}s")

    error_msg = None
    try:
        messages_payload = [
            ("system", system_prompt),
            ("human", human_prompt)
        ]

        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        try:
            future = executor.submit(_call_routing_llm, messages_payload)
            response = future.result(timeout=LLM_TIMEOUT_SECONDS)
        finally:
            executor.shutdown(wait=False)

        elapsed_time = time.time() - start_time
        print(f"[LLM Supervisor] Response in {elapsed_time:.2f}s")

        content = response.content.strip()
        # Clean markdown fences if model ignores format=json
        if content.startswith("```json"):
            content = content[7:]
        if content.endswith("```"):
            content = content[:-3]
        if content.startswith("```"):
            content = content[3:]

        decision = json.loads(content.strip())

        # Validate schema
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

    # Fallback to keyword routing
    fallback_decision = keyword_supervisor_agent(message, context)
    fallback_decision["model_used"] = None
    fallback_decision["used_llm"] = False
    fallback_decision["fallback_used"] = True
    fallback_decision["response_time_ms"] = int((time.time() - start_time) * 1000)
    fallback_decision["status"] = "FALLBACK"
    fallback_decision["error_message"] = error_msg
    return fallback_decision


def keyword_supervisor_agent(message: str, context: dict = None):
    """Deterministic keyword-based intent classifier. Instant, reliable."""
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

    # Context fallback — check previous customer message
    if history:
        for msg in reversed(history):
            if msg.get("role") == "customer":
                fallback_decision = keyword_supervisor_agent(msg["content"], context={"history": None})
                if fallback_decision["intent"] != "general_question":
                    return fallback_decision
                break

    return {"agent": "support_agent", "intent": "general_question", "action": "llm_response", "priority": "normal"}
