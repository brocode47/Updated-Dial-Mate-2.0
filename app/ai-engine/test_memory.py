import os
import uuid
import sys

# Set default env vars for testing if not present
os.environ.setdefault("DB_HOST", "localhost")
os.environ.setdefault("DB_NAME", "dialmate")
os.environ.setdefault("DB_USER", "postgres")
os.environ.setdefault("DB_PASSWORD", "postgres")

# Need to make sure psycopg2 can connect. If not, we handle the error gracefully.
try:
    from app.memory.db_memory import save_message, get_connection
    from app.memory.history import get_conversation_history
    from app.agents.main_agent import main_agent
except ImportError as e:
    print(f"Import error: {e}")
    sys.exit(1)

def run_tests():
    try:
        conn = get_connection()
    except Exception as e:
        print(f"Failed to connect to database: {e}")
        print("Please ensure your local PostgreSQL is running and credentials match.")
        return

    cur = conn.cursor()
    shop_id = str(uuid.uuid4())
    customer_a_id = str(uuid.uuid4())
    customer_b_id = str(uuid.uuid4())
    phone_a = "1234567890"
    phone_b = "0987654321"

    try:
        # Create Org, Shop, and Customers to satisfy foreign keys
        org_id = str(uuid.uuid4())
        cur.execute('INSERT INTO "Organization" (id, name, "updatedAt") VALUES (%s, %s, NOW())', (org_id, "Test Org"))
        cur.execute('INSERT INTO "Shop" (id, "organizationId", domain, "updatedAt") VALUES (%s, %s, %s, NOW())', (shop_id, org_id, f"test-{shop_id}.myshopify.com"))
        cur.execute('INSERT INTO "Customer" (id, "shopId", phone, "updatedAt") VALUES (%s, %s, %s, NOW())', (customer_a_id, shop_id, phone_a))
        cur.execute('INSERT INTO "Customer" (id, "shopId", phone, "updatedAt") VALUES (%s, %s, %s, NOW())', (customer_b_id, shop_id, phone_b))
        conn.commit()
    except Exception as e:
        print(f"Error setting up test data: {e}")
        conn.rollback()
        return

    print("--- Test A: Independent Memory ---")
    conv_a1 = save_message(shop_id, phone_a, "Hello from A", "customer")
    conv_b1 = save_message(shop_id, phone_b, "Hello from B", "customer")
    print(f"Customer A Conv ID: {conv_a1}")
    print(f"Customer B Conv ID: {conv_b1}")
    if conv_a1 != conv_b1:
        print("PASS: Customers have separate conversations.")
    else:
        print("FAIL: Customers share the same conversation.")

    print("\n--- Test B: History Retrieval ---")
    hist_a = get_conversation_history(shop_id, phone_a)
    hist_b = get_conversation_history(shop_id, phone_b)
    print(f"History A: {hist_a}")
    print(f"History B: {hist_b}")
    
    a_ok = any(m['content'] == "Hello from A" for m in hist_a) and not any(m['content'] == "Hello from B" for m in hist_a)
    b_ok = any(m['content'] == "Hello from B" for m in hist_b) and not any(m['content'] == "Hello from A" for m in hist_b)
    
    if a_ok and b_ok:
        print("PASS: History is isolated.")
    else:
        print("FAIL: History is mixed or missing.")

    print("\n--- Test C: Existing Product Flow ---")
    resp_c = main_agent("Mujhe wife ke liye gift chahiye", phone=phone_a, shop_id=shop_id)
    print(f"Response: {resp_c}")
    if resp_c and "response" in resp_c:
        print("PASS: Product flow executes.")
    else:
        print("FAIL: Product flow failed.")

    print("\n--- Test D: Existing Order Status Flow ---")
    resp_d = main_agent("Mera order kahan hai", phone=phone_a, shop_id=shop_id)
    print(f"Response: {resp_d}")
    if resp_d and "response" in resp_d:
        print("PASS: Order flow executes.")
    else:
        print("FAIL: Order flow failed.")

    print("\n--- Test E: Multi-turn Context ---")
    resp_e1 = main_agent("Mujhe gift chahiye", phone=phone_a, shop_id=shop_id)
    print(f"User: Mujhe gift chahiye")
    print(f"AI: {resp_e1['response'][:50]}...")
    
    resp_e2 = main_agent("Birthday", phone=phone_a, shop_id=shop_id)
    print(f"User: Birthday")
    print(f"AI: {resp_e2['response'][:50]}...")
    
    if "budget" in resp_e2["response"] or "options available" in resp_e2["response"]:
        print("PASS: Context injection works.")
    else:
        print("FAIL: Context injection failed.")

    print("\n--- Test F: Support Escalation ---")
    resp_f = main_agent("Tumhara boss kon hai", phone=phone_a, shop_id=shop_id)
    print(f"Response: {resp_f}")
    if resp_f and "management ya owner" in resp_f["response"]:
        print("PASS: Support escalation executes.")
    else:
        print("FAIL: Support escalation failed.")

    print("\n--- Test G: Customer Intelligence Profile Memory ---")
    # Manually insert memory for Customer A
    try:
        from app.memory.profile import update_customer_profile
        update_customer_profile(shop_id, customer_a_id, {
            "preferredCategories": "perfumes",
            "averageBudget": 5000,
            "customerPreferences": "Prefers elegant premium gifts"
        })
        resp_g1 = main_agent("gift suggest karein", phone=phone_a, shop_id=shop_id)
        print(f"Personalized Response for Customer A: {resp_g1['response'][:100]}...")
        if "perfume" in resp_g1['response'].lower() or "5000" in resp_g1['response'].lower():
            print("PASS: Customer with memory received personalized response.")
        else:
            print("FAIL: Customer A did not receive expected personalization.")
            
        # Test Customer B (no memory)
        resp_g2 = main_agent("gift suggest karein", phone=phone_b, shop_id=shop_id)
        print(f"Generic Response for Customer B: {resp_g2['response'][:100]}...")
        if "perfume" not in resp_g2['response'].lower() and "5000" not in resp_g2['response'].lower():
            print("PASS: Customer without memory received generic response.")
        else:
            print("FAIL: Customer B received someone else's memory!")
    except Exception as e:
        print(f"FAIL: Test G Error - {e}")

    # Cleanup
    try:
        cur.execute('DELETE FROM "CustomerProfileMemory" WHERE "customerId" IN (%s, %s)', (customer_a_id, customer_b_id))
        cur.execute('DELETE FROM "Message" WHERE "conversationId" IN (%s, %s)', (conv_a1, conv_b1))
        cur.execute('DELETE FROM "Conversation" WHERE id IN (%s, %s)', (conv_a1, conv_b1))
        cur.execute('DELETE FROM "Customer" WHERE id IN (%s, %s)', (customer_a_id, customer_b_id))
        cur.execute('DELETE FROM "Shop" WHERE id = %s', (shop_id,))
        cur.execute('DELETE FROM "Organization" WHERE id = %s', (org_id,))
        conn.commit()
    except Exception as e:
        print(f"Cleanup error: {e}")
        conn.rollback()

    cur.close()
    conn.close()

if __name__ == "__main__":
    run_tests()
