"""
DialMate 2.0 Product Agent
Uses Centralized Commerce Service Layer (ProductService, InventoryService).
Strict multi-tenant isolation, deterministic inventory answers, zero LLM guessing.
"""

from typing import Dict, Any, Optional
from app.services.product_service import search_products
from app.services.inventory_service import check_inventory
from app.agents.language import detect_language
from app.agents.templates import get_template

# Template responses for recommendation formatting
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


def _format_product_list(products) -> str:
    """Format product items into a clean, readable bulleted list."""
    lines = []
    for p in products:
        if isinstance(p, dict):
            name = p.get("name", "")
            price = p.get("price", 0)
        elif isinstance(p, (list, tuple)):
            name = p[0]
            price = p[2] if len(p) > 2 else 0
        else:
            continue
        lines.append(f"• {name} — Rs {price:,.0f}" if isinstance(price, (int, float)) else f"• {name} — Rs {price}")
    return "\n".join(lines)


def _get_personalization(memory: Dict[str, Any]) -> str:
    """Build a short personalization snippet from customer memory."""
    cats = memory.get("preferred_categories", "")
    if cats:
        return f", aap ko pehle {cats} pasand aaye thay"
    return ""


def product_agent(message: str, context: Optional[Dict[str, Any]] = None, intent: Optional[str] = None) -> Dict[str, Any]:
    """
    Production-hardened Product Agent.
    - Uses InventoryService for live deterministic stock checks.
    - Uses ProductService for multi-tenant catalog lookups.
    - Backward compatible fallback if shop_id is not provided.
    """
    if context is None:
        context = {"history": [], "customer_memory": {}, "previous_orders": []}

    shop_id = context.get("shop_id")
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

    # 1. Product Availability / Stock Inquiry
    if intent == "product_availability":
        if shop_id:
            try:
                inv_check = check_inventory(shop_id, product_name_or_query=message, lang=lang)
                if inv_check["found"]:
                    return {"message": inv_check["message"]}
            except Exception:
                pass
        return {"message": get_template("product_availability", lang)}

    # 2. Size & Color Inquiry
    if intent == "size_color_inquiry":
        if shop_id:
            try:
                inv_check = check_inventory(shop_id, product_name_or_query=message, lang=lang)
                if inv_check["found"]:
                    return {"message": inv_check["message"]}
            except Exception:
                pass
        return {"message": get_template("size_color_inquiry", lang)}

    # 3. Price Inquiry
    if intent == "price_inquiry":
        if shop_id:
            try:
                matched_products = search_products(shop_id, query=message, limit=1)
                if matched_products:
                    p = matched_products[0]
                    curr = p.get("currency", "PKR")
                    price_val = p.get("price", 0)
                    if lang == "urdu":
                        msg = f"جی، {p['name']} کی قیمت {price_val:,.0f} {curr} ہے۔"
                    elif lang == "english":
                        msg = f"The price of {p['name']} is Rs {price_val:,.0f}."
                    else:
                        msg = f"Jee, {p['name']} ki price Rs {price_val:,.0f} hai."
                    return {"message": msg}
            except Exception:
                pass
        return {"message": get_template("price_inquiry", lang)}

    # 4. Product Details / Specifications
    if intent == "product_details":
        if shop_id:
            try:
                matched_products = search_products(shop_id, query=message, limit=1)
                if matched_products:
                    p = matched_products[0]
                    desc = p.get("description") or "Premium quality"
                    price_val = p.get("price", 0)
                    if lang == "urdu":
                        msg = f"جی، {p['name']} کی تفصیل: {desc}۔ قیمت {price_val:,.0f} روپے۔"
                    elif lang == "english":
                        msg = f"Details for {p['name']}: {desc}. Price: Rs {price_val:,.0f}."
                    else:
                        msg = f"Jee, {p['name']} ki details: {desc}. Price Rs {price_val:,.0f} hai."
                    return {"message": msg}
            except Exception:
                pass
        return {"message": get_template("product_details", lang)}

    # 5. Product Recommendation (Fast path with memory + DB lookup)
    if history:
        for msg_item in reversed(history):
            if msg_item.get("role") == "customer":
                text += " " + msg_item["content"].lower()
                break

    products = []
    search_category = "gift"
    if memory.get("preferred_categories"):
        search_category = memory["preferred_categories"].split(",")[0].strip()

    max_price = memory.get("average_budget") or 10000

    if any(w in text for w in ["gift", "wife", "biwi", "husband", "suggest", "recommend", "birthday", "anniversary", "chahiye"]):
        if shop_id:
            try:
                products = search_products(
                    shop_id=shop_id,
                    category=search_category,
                    max_price=max_price,
                    in_stock_only=True,
                    limit=5
                )
                if not products:
                    # Fallback to general products in this shop
                    products = search_products(
                        shop_id=shop_id,
                        in_stock_only=True,
                        limit=5
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

        return {"message": result}

    # No products found or asking for preferences
    if memory.get("preferred_categories") or memory.get("average_budget"):
        category_mention = memory.get("preferred_categories", "general gifts")
        result = NO_PRODUCTS_TEMPLATE.format(category=category_mention)
    else:
        result = get_template("product_recommendation_ask", lang)

    return {"message": result}
