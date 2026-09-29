import time
from app.tools.product_tools import search_products
from app.models.llm import safe_llm_invoke

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
        # ---- FAST PATH: Template response (no LLM needed) ----
        product_list_str = _format_product_list(products)
        personalization = _get_personalization(memory)
        
        # Use budget-aware template if budget is set
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

    # ---- No products found: template response asking for preferences ----
    # Check if we have ANY info to tailor the ask
    if memory.get("preferred_categories") or memory.get("average_budget"):
        category_mention = memory.get("preferred_categories", "general gifts")
        result = NO_PRODUCTS_TEMPLATE.format(category=category_mention)
    else:
        result = ASK_BUDGET_TEMPLATE

    return {
        "message": result
    }
