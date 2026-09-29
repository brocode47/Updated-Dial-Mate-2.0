import time
from app.tools.product_tools import search_products
from app.agents.language import detect_language
from app.agents.templates import get_template

# Template responses — zero LLM latency for structured product data
PRODUCT_LIST_TEMPLATE = """Jee, aap ke liye ye options available hain{personalization}:

{product_list}

Agar kisi product ke baare mein detail chahiye to batayein."""

PRODUCT_LIST_TEMPLATE_BUDGET = """Jee{personalization}, aap ke budget mein ye options hain:

{product_list}

Batayein konsa pasand aaya?"""

NO_PRODUCTS_TEMPLATE = """Jee, is waqt {category} category mein koi product available nahi hai. Aap apni budget ya preference batayein, main aur options check karta hoon."""

ASK_BUDGET_TEMPLATE = """Jee bilkul, main aap ki help karta hoon. Aap bata dein:
- Gift kis ke liye hai?
- Aap ka budget kya hai?

Taake main behtar suggestion de sakoon."""


def _format_product_list(products):
    """Format product rows into a readable list."""
    lines = []
    for p in products:
        name = p[0]
        price = p[2]
        lines.append(f"• {name} — Rs {price:,.0f}" if isinstance(price, (int, float)) else f"• {name} — Rs {price}")
    return "\n".join(lines)


def _get_personalization(memory):
    """Build a short personalization snippet from customer memory."""
    cats = memory.get("preferred_categories", "")
    if cats:
        return f", aap ko pehle {cats} pasand aaye thay"
    return ""


def product_agent(message, context=None, intent=None):
    if context is None:
        context = {"history": [], "customer_memory": {}, "previous_orders": []}
        
    history = context.get("history", [])
    memory = context.get("customer_memory", {})

    lang = detect_language(message)
    text = message.lower()

    # Determine intent if not explicitly passed
    if not intent:
        intent = context.get("intent")
    if not intent:
        from app.agents.supervisor import keyword_supervisor_agent
        intent = keyword_supervisor_agent(message, context).get("intent", "product_recommendation")

    # 1. Product Availability
    if intent == "product_availability":
        return {
            "message": get_template("product_availability", lang)
        }

    # 2. Price Inquiry
    if intent == "price_inquiry":
        return {
            "message": get_template("price_inquiry", lang)
        }

    # 3. Product Details / Specifications
    if intent == "product_details":
        return {
            "message": get_template("product_details", lang)
        }

    # 4. Size & Color Inquiry
    if intent == "size_color_inquiry":
        return {
            "message": get_template("size_color_inquiry", lang)
        }

    # 5. Product Recommendation (Fast path with memory + DB lookup)
    if history:
        for msg in reversed(history):
            if msg.get("role") == "customer":
                text += " " + msg["content"].lower()
                break

    products = []
    search_category = "gift"
    if memory.get("preferred_categories"):
        search_category = memory["preferred_categories"].split(",")[0].strip()

    max_price = memory.get("average_budget") or 10000

    if any(w in text for w in ["gift", "wife", "biwi", "husband", "suggest", "recommend", "birthday", "anniversary", "chahiye"]):
        try:
            products = search_products(
                category=search_category,
                max_price=max_price
            )
        except Exception:
            products = []

    if products:
        product_list_str = _format_product_list(products)
        personalization = _get_personalization(memory)
        
        if memory.get("average_budget"):
            result = PRODUCT_LIST_TEMPLATE_BUDGET.format(
                personalization=personalization,
                product_list=product_list_str
            )
        else:
            result = PRODUCT_LIST_TEMPLATE.format(
                personalization=personalization,
                product_list=product_list_str
            )

        return {
            "message": result
        }

    # No products found or asking for preferences
    if memory.get("preferred_categories") or memory.get("average_budget"):
        category_mention = memory.get("preferred_categories", "general gifts")
        result = NO_PRODUCTS_TEMPLATE.format(category=category_mention)
    else:
        result = get_template("product_recommendation_ask", lang)

    return {
        "message": result
    }
