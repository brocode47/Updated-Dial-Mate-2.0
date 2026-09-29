import json
from concurrent.futures import ThreadPoolExecutor
from app.models.llm import safe_llm_invoke
from app.memory.profile import update_customer_profile

executor = ThreadPoolExecutor(max_workers=2)

def extract_and_store_customer_memory_async(shop_id, customer_id, history, message):
    if not customer_id or not shop_id:
        return
        
    # We run the memory extraction asynchronously so it doesn't slow down the main response
    executor.submit(
        _extract_and_store_sync,
        shop_id,
        customer_id,
        history,
        message
    )

def _extract_and_store_sync(shop_id, customer_id, history, message):
    try:
        recent_history = history[-6:] if history else [] # last 6 messages
        history_text = "\n".join([f"{msg['role']}: {msg['content']}" for msg in recent_history])
        
        prompt = f"""
        You are a customer intelligence AI. Your job is to extract long-term preferences from the conversation.
        Only extract information if it clearly indicates a long-term preference, buying pattern, or budget constraint.
        Do NOT guess. Do NOT store temporary requests.
        
        Recent Conversation:
        {history_text}
        Customer just said: {message}
        
        Return a JSON object ONLY, with the following exact keys (use null if no new info is found):
        - preferredCategories (string, comma-separated categories)
        - preferredProducts (string, comma-separated products)
        - averageBudget (number)
        - customerPreferences (string, general preferences like 'prefers gifts for wife')
        
        Example 1:
        Customer: "I always buy premium perfumes."
        Output: {{"preferredCategories": "perfumes", "preferredProducts": null, "averageBudget": null, "customerPreferences": "prefers premium items"}}
        
        Example 2:
        Customer: "My budget is around 5000"
        Output: {{"preferredCategories": null, "preferredProducts": null, "averageBudget": 5000, "customerPreferences": null}}
        """
        
        # Use safe_llm_invoke with timeout protection (10s max for background extraction)
        content = safe_llm_invoke([("human", prompt)], timeout_seconds=10)
        
        if content is None:
            print("[Memory Extractor] LLM unavailable, skipping memory extraction")
            return
        
        # Clean up JSON if necessary
        if content.startswith('```json'):
            content = content[7:]
        if content.startswith('```'):
            content = content[3:]
        if content.endswith('```'):
            content = content[:-3]
            
        content = content.strip()
        
        data = json.loads(content)
        
        updates = {}
        if data.get("preferredCategories"):
            updates["preferredCategories"] = str(data["preferredCategories"])
        if data.get("preferredProducts"):
            updates["preferredProducts"] = str(data["preferredProducts"])
        if data.get("averageBudget") is not None:
            try:
                updates["averageBudget"] = float(data["averageBudget"])
            except:
                pass
        if data.get("customerPreferences"):
            updates["customerPreferences"] = str(data["customerPreferences"])
            
        if updates:
            update_customer_profile(shop_id, customer_id, updates)
            
    except Exception as e:
        print(f"[Memory Extractor Error] Failed to extract or store memory: {e}")
