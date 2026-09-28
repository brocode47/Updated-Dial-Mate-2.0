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

    # Cleanup
    try:
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
