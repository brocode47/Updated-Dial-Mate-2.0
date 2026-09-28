from app.memory.profile import get_customer_profile

def get_customer_context(shop_id, customer_id):
    if not customer_id:
        return None
        
    profile = get_customer_profile(shop_id, customer_id)
    if not profile:
        return None
        
    # We only return the fields that have meaningful data
    context = {}
    if profile.get("preferredCategories"):
        context["preferred_categories"] = profile["preferredCategories"]
    if profile.get("preferredProducts"):
        context["preferred_products"] = profile["preferredProducts"]
    if profile.get("averageBudget") is not None:
        context["average_budget"] = profile["averageBudget"]
    if profile.get("customerPreferences"):
        context["preferences"] = profile["customerPreferences"]
    if profile.get("lastPurchaseSummary"):
        context["last_purchase"] = profile["lastPurchaseSummary"]
    if profile.get("interactionSummary"):
        context["interaction_summary"] = profile["interactionSummary"]
        
    if not context:
        return None
        
    return context
