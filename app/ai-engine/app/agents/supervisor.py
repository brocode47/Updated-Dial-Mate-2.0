import json
import time
import re
from app.config import AI_MODEL, LLM_TIMEOUT_SECONDS, SUPERVISOR_MODE
import concurrent.futures


# =====================================================================
# INTENT DEFINITIONS & MULTI-KEYWORD GROUPS
# =====================================================================
INTENT_RULES = [
    # ----------------------------------------------------
    # TIER 1: URGENT / ESCALATION / COMPLAINTS (Priority: High)
    # ----------------------------------------------------
    {
        "intent": "human_agent_request",
        "agent": "support_agent",
        "action": "escalate",
        "priority": "high",
        "exact_phrases": [
            "baat karwao", "insan se baat", "real person", "human agent",
            "talk to human", "agent se baat", "agent chahiye", "call me",
            "call karwao", "customer care", "helpdesk", "call back",
            "مینیجر", "مالک", "انسان سے بات", "نمائندے سے بات", "کال کروائیں",
            "insan se bat", "representative se baat"
        ],
        "primary_keywords": [
            "boss", "owner", "malik", "manager", "management", "representative"
        ],
        "compound_groups": [
            (["baat", "bat", "talk", "rabta"], ["insan", "human", "agent", "person", "numainda", "manager", "management"])
        ]
    },
    {
        "intent": "late_order_complaint",
        "agent": "order_agent",
        "action": "escalate_order",
        "priority": "high",
        "exact_phrases": [
            "order late", "parcel late", "late delivery", "order nahi mila",
            "parcel nahi mila", "order nahi aya", "parcel nahi aya",
            "order late hai", "parcel late hai", "kharab mila", "toota hua",
            "damaged item", "order issue", "order problem", "shikayat hai",
            "آرڈر لیٹ", "پارسل لیٹ", "آرڈر نہیں ملا", "آرڈر نہیں آیا", "تاخیر"
        ],
        "primary_keywords": [
            "complaint", "shikayat"
        ],
        "compound_groups": [
            (["order", "parcel"], ["late", "der se", "delay", "kharab", "masla", "problem", "nahi aya", "nahi mila", "not delivered", "stuck"])
        ]
    },
    {
        "intent": "order_cancel",
        "agent": "order_agent",
        "action": "database_update",
        "priority": "high",
        "exact_phrases": [
            "order cancel", "cancel order", "cancel kardo", "cancel karna",
            "cancle order", "parcel cancel", "cancel my order", "want to cancel",
            "cancellation", "order mansookh", "mansookh", "آرڈر کینسل", "منسوخ", "آرڈر منسوخ"
        ],
        "primary_keywords": [
            "cancel", "cancle"
        ],
        "compound_groups": [
            (["order", "parcel"], ["cancel", "cancle", "mansookh", "roko", "band"])
        ]
    },

    # ----------------------------------------------------
    # TIER 2: POLICIES / RETURNS / REFUNDS (Priority: High/Normal)
    # ----------------------------------------------------
    {
        "intent": "refund_request",
        "agent": "support_agent",
        "action": "policy_info",
        "priority": "high",
        "exact_phrases": [
            "paise wapis", "pese wapis", "money back", "paisa wapis",
            "refund chahiye", "refund policy", "refund procedure",
            "refund kaise", "amount return", "reimbursement", "ریفنڈ", "پیسے واپس", "رقم واپس"
        ],
        "primary_keywords": [
            "refund"
        ],
        "compound_groups": [
            (["paise", "pese", "paisa", "amount", "money"], ["wapis", "wapas", "back", "refund"])
        ]
    },
    {
        "intent": "return_exchange",
        "agent": "support_agent",
        "action": "policy_info",
        "priority": "normal",
        "exact_phrases": [
            "wapis karna", "wapas karna", "return policy", "exchange policy",
            "return procedure", "wapis lena", "exchange karna", "badal do",
            "change karna hai", "return kaise", "exchange kaise", "ریٹرن", "ایکسچینج", "تبدیل", "واپس کرنا", "واپسی"
        ],
        "primary_keywords": [
            "return", "exchange", "tabdeel", "badalna"
        ],
        "compound_groups": [
            (["product", "item", "order", "parcel", "cheez"], ["wapis", "wapas", "change", "badal", "return", "exchange"])
        ]
    },

    # ----------------------------------------------------
    # TIER 3: ORDER STATUS (Priority: Normal)
    # ----------------------------------------------------
    {
        "intent": "order_status",
        "agent": "order_agent",
        "action": "database_lookup",
        "priority": "normal",
        "exact_phrases": [
            "order kahan", "order kaha", "mera order", "order status",
            "status batao", "parcel kahan", "parcel kaha", "order check",
            "where is my order", "check my order", "order track", "order details",
            "order update", "parcel status", "kahan pohancha", "kahan pohncha",
            "tracking number", "track my order", "track order", "آرڈر کہاں",
            "میرا آرڈر", "آرڈر کا اسٹیٹس", "ٹریکنگ", "پارسل کہاں"
        ],
        "primary_keywords": [
            "track", "tracking"
        ],
        "compound_groups": [
            (["order", "parcel"], ["status", "check", "kahan", "kaha", "pohancha", "where", "track", "info", "maloom"])
        ]
    },

    # ----------------------------------------------------
    # TIER 4: FAQ (Delivery time, Shipping info, Payment)
    # ----------------------------------------------------
    {
        "intent": "delivery_time",
        "agent": "support_agent",
        "action": "faq_info",
        "priority": "normal",
        "exact_phrases": [
            "kitne din", "kitnay din", "kab tak", "kab ayega", "kab milega",
            "how many days", "delivery time", "delivery kab", "shipping time",
            "when will it arrive", "kitna time", "delivery days", "kitne din mein",
            "کتنے دن", "کب تک آئے گا", "کب ملے گا", "ڈیلیوری کا وقت"
        ],
        "primary_keywords": [],
        "compound_groups": [
            (["delivery", "parcel"], ["din", "days", "time", "kab", "when", "waqt"])
        ]
    },
    {
        "intent": "shipping_info",
        "agent": "support_agent",
        "action": "faq_info",
        "priority": "normal",
        "exact_phrases": [
            "shipping charges", "delivery charges", "shipping cost", "delivery fee",
            "delivery charges kitnay", "delivery ke paise", "courier charges",
            "delivery fee kitni", "shipping kitni", "free delivery",
            "شپنگ چارجز", "ڈیلیوری چارجز", "ڈیلیوری فیس"
        ],
        "primary_keywords": [],
        "compound_groups": [
            (["shipping", "delivery"], ["charges", "cost", "fee", "paise", "pese", "rate"])
        ]
    },
    {
        "intent": "payment_methods",
        "agent": "support_agent",
        "action": "faq_info",
        "priority": "normal",
        "exact_phrases": [
            "payment method", "payment methods", "cash on delivery", "jazzcash",
            "easypaisa", "bank transfer", "online payment", "advance payment",
            "payment kaise", "paise kaise", "payment options", "how to pay",
            "cod available hai", "cod available", "cod hai",
            "کیش آن ڈیلیوری", "ادائیگی", "جاز کیش", "ایزی پیسہ", "بینک ٹرانسفر"
        ],
        "primary_keywords": [
            "cod"
        ],
        "compound_groups": [
            (["payment", "pay", "paise"], ["methods", "kaise", "options", "tarika", "mode", "advance", "online"])
        ]
    },

    # ----------------------------------------------------
    # TIER 5: PRODUCT INQUIRIES (Agent: product_agent)
    # ----------------------------------------------------
    {
        "intent": "price_inquiry",
        "agent": "product_agent",
        "action": "price_lookup",
        "priority": "normal",
        "exact_phrases": [
            "price bata dein", "price batao", "price kya hai", "price kitni hai",
            "kitne ka hai", "kitnay ka hai", "kitne ki hai", "rate kya hai",
            "what is the price", "how much is this", "price please",
            "قیمت", "کتنے کا ہے", "کتنے کی ہے", "کیا ریٹ ہے"
        ],
        "primary_keywords": [
            "price", "qeemat", "cost"
        ],
        "compound_groups": [
            (["price", "rate", "qeemat"], ["kya", "batao", "bata", "kitni", "kitna", "dein", "den", "hai"])
        ]
    },
    {
        "intent": "product_availability",
        "agent": "product_agent",
        "action": "stock_check",
        "priority": "normal",
        "exact_phrases": [
            "available hai", "available hay", "in stock", "stock mein",
            "mil jayega", "mil jaye ga", "is this available", "stock available",
            "stock hai", "available hoga", "دستیاب", "اسٹاک میں ہے", "مل جائے گا"
        ],
        "primary_keywords": [
            "available", "dastiyab"
        ],
        "compound_groups": [
            (["product", "item", "stock"], ["available", "hai", "hay", "mil"])
        ]
    },
    {
        "intent": "size_color_inquiry",
        "agent": "product_agent",
        "action": "variant_check",
        "priority": "normal",
        "exact_phrases": [
            "konsa color", "konsa size", "colors available", "sizes available",
            "konsay colors", "konsay sizes", "size kya hai", "color kya hai",
            "سائز", "رنگ", "کون سا رنگ", "کون سے سائز"
        ],
        "primary_keywords": [
            "size", "sizes", "color", "colors", "colour", "colours", "rang"
        ],
        "compound_groups": [
            (["size", "sizes", "color", "colors", "colour"], ["available", "konsa", "options", "chart", "hain"])
        ]
    },
    {
        "intent": "product_details",
        "agent": "product_agent",
        "action": "product_info",
        "priority": "normal",
        "exact_phrases": [
            "detail batao", "details bata dein", "quality kaisi hai", "specifications kya hain",
            "material kya hai", "product details", "تفصیلات", "معیار", "کوالٹی", "خصوصیات"
        ],
        "primary_keywords": [
            "specifications", "specs", "material"
        ],
        "compound_groups": [
            (["quality", "detail", "details", "material", "stuff", "fabric"], ["kaisi", "kaisa", "batao", "bata", "dein", "features"])
        ]
    },
    {
        "intent": "product_recommendation",
        "agent": "product_agent",
        "action": "product_search",
        "priority": "normal",
        "exact_phrases": [
            "gift chahiye", "gift suggest", "kuch suggest karein", "konsa loon",
            "kya loon", "gift lena hai", "recommendation chahiye", "kuch gift",
            "گفٹ", "تحفہ", "مشورہ", "کون سا لوں", "تحفہ چاہیے", "گفٹ چاہیے"
        ],
        "primary_keywords": [
            "gift", "suggest", "recommend"
        ],
        "compound_groups": [
            (["gift", "present"], ["wife", "husband", "friend", "birthday", "anniversary", "chahiye", "suggest", "recommend", "buy", "lena"])
        ]
    },

    # ----------------------------------------------------
    # TIER 6: SOCIAL (Greetings & Closing)
    # ----------------------------------------------------
    {
        "intent": "greeting",
        "agent": "support_agent",
        "action": "greeting_response",
        "priority": "low",
        "exact_phrases": [
            "hello", "hi", "salam", "assalam", "assalam o alaikum", "aoa",
            "hey", "good morning", "good evening", "good afternoon",
            "السلام علیکم", "سلام", "ہیلو"
        ],
        "primary_keywords": [],
        "compound_groups": []
    },
    {
        "intent": "gratitude_closing",
        "agent": "support_agent",
        "action": "closing_response",
        "priority": "low",
        "exact_phrases": [
            "thank you", "thanks", "shukriya", "jazakallah", "meherbani",
            "allah hafiz", "bye", "take care", "thanks a lot",
            "شکریہ", "جزاک اللہ", "اللہ حافظ"
        ],
        "primary_keywords": [],
        "compound_groups": []
    }
]


def _matches_word(word: str, text: str) -> bool:
    """Matches keyword using word boundaries for Latin or direct match for non-Latin."""
    if not word or not text:
        return False
    # If word is in Urdu/Arabic script or has non-alphanumeric chars
    if re.search(r'[\u0600-\u06FF]', word):
        return word in text
    pattern = r'\b' + re.escape(word) + r'\b'
    return bool(re.search(pattern, text, re.IGNORECASE))


def supervisor_agent(message: str, context: dict = None):
    """
    Supervisor with configurable routing strategy.
    Default: Deterministic keyword-based scoring (<1ms, zero LLM).
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
        return result
    else:
        decision = keyword_supervisor_agent(message, context)
        elapsed = time.time() - start_time
        decision["model_used"] = None
        decision["used_llm"] = False
        decision["fallback_used"] = False
        decision["response_time_ms"] = int(elapsed * 1000)
        decision["status"] = "SUCCESS"
        decision["error_message"] = None
        print(f"[Keyword Supervisor] Routed to {decision['agent']} ({decision['intent']}, conf: {decision['confidence']:.2f}) in {elapsed*1000:.1f}ms")
        return decision


def keyword_supervisor_agent(message: str, context: dict = None):
    """
    Intelligent deterministic keyword supervisor.
    - Evaluates priority tiers
    - Computes confidence scores
    - Resolves collisions
    - Returns required schema:
        {agent, intent, action, confidence, priority, matched_keywords}
    """
    text = (message or "").lower().strip()
    if context is None:
        context = {"history": [], "customer_memory": {}}
    history = context.get("history", [])

    best_match = None
    best_rank = 0.0

    # 1. Scan all intent rules
    for rule in INTENT_RULES:
        score = 0.0
        matched = []

        # A) Exact phrase check
        for phrase in rule["exact_phrases"]:
            if phrase in text:
                score = 0.98 if text == phrase else 0.95
                matched.append(phrase)
                break

        # B) Compound groups check with strict word boundaries
        if not matched and rule["compound_groups"]:
            for group in rule["compound_groups"]:
                if all(any(_matches_word(k, text) for k in kw_list) for kw_list in group):
                    group_matches = [k for kw_list in group for k in kw_list if _matches_word(k, text)]
                    score = 0.92
                    matched.extend(group_matches)
                    break

        # C) Primary keywords check with word boundaries
        if not matched and rule["primary_keywords"]:
            for kw in rule["primary_keywords"]:
                if _matches_word(kw, text):
                    score = 0.85
                    matched.append(kw)
                    break

        if score > 0.0:
            priority_weight = {"high": 3, "normal": 2, "low": 1}.get(rule["priority"], 1)
            total_rank = score + (priority_weight * 0.1)

            if total_rank > best_rank:
                best_rank = total_rank
                best_match = {
                    "agent": rule["agent"],
                    "intent": rule["intent"],
                    "action": rule["action"],
                    "confidence": round(score, 2),
                    "priority": rule["priority"],
                    "matched_keywords": matched
                }

    # 2. If strong match found (>= 0.70), return it immediately
    if best_match and best_match["confidence"] >= 0.70:
        return best_match

    # 3. Context fallback — inspect recent customer message in multi-turn conversation
    if history:
        for msg in reversed(history):
            if msg.get("role") == "customer":
                content = (msg.get("content") or "").strip().lower()
                if content == text:
                    continue
                fallback_decision = keyword_supervisor_agent(content, context={"history": None})
                if fallback_decision["intent"] != "unknown_query" and fallback_decision["confidence"] >= 0.70:
                    return {
                        "agent": fallback_decision["agent"],
                        "intent": fallback_decision["intent"],
                        "action": fallback_decision["action"],
                        "confidence": 0.75,
                        "priority": fallback_decision["priority"],
                        "matched_keywords": ["context_history"]
                    }
                break

    # 4. Unknown query fallback (< 0.70 confidence)
    return {
        "agent": "support_agent",
        "intent": "unknown_query",
        "action": "fallback_response",
        "confidence": 0.40,
        "priority": "low",
        "matched_keywords": []
    }


def _llm_route(message: str, context: dict, start_time: float):
    """Attempt LLM-based routing with timeout protection (only if explicitly enabled)."""
    history = context.get("history", [])
    recent_history = history[-3:] if len(history) > 3 else history
    history_context = ""
    for msg in reversed(recent_history):
        role = msg.get("role", "customer")
        content = msg.get("content", "")[:150]
        history_context += f"{role.capitalize()}: {content}\n"

    system_prompt = """Classify intent into JSON. Allowed agents: product_agent, order_agent, support_agent.
Return ONLY: {"agent":"...","intent":"...","action":"...","confidence":0.9,"priority":"normal","matched_keywords":[]}"""

    human_prompt = f"{history_context}Message: {message}" if history_context else f"Message: {message}"

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
        content = response.content.strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.endswith("```"):
            content = content[:-3]
        if content.startswith("```"):
            content = content[3:]

        decision = json.loads(content.strip())
        decision["model_used"] = AI_MODEL
        decision["used_llm"] = True
        decision["fallback_used"] = False
        decision["response_time_ms"] = int(elapsed_time * 1000)
        decision["status"] = "SUCCESS"
        decision["error_message"] = None
        decision.setdefault("confidence", 0.85)
        decision.setdefault("matched_keywords", [])
        return decision

    except Exception as e:
        error_msg = str(e)

    # Fallback to keyword routing
    fallback_decision = keyword_supervisor_agent(message, context)
    fallback_decision["model_used"] = None
    fallback_decision["used_llm"] = False
    fallback_decision["fallback_used"] = True
    fallback_decision["response_time_ms"] = int((time.time() - start_time) * 1000)
    fallback_decision["status"] = "FALLBACK"
    fallback_decision["error_message"] = error_msg
    return fallback_decision
