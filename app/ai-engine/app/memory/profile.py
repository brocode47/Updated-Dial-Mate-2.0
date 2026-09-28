import uuid
from datetime import datetime
from app.memory.db_memory import get_connection

def get_customer_profile(shop_id, customer_id):
    if not customer_id:
        return None
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            '''
            SELECT "preferredCategories", "preferredProducts", "averageBudget", 
                   "purchaseFrequency", "lastPurchaseSummary", "customerPreferences", "interactionSummary"
            FROM "CustomerProfileMemory"
            WHERE "shopId"=%s AND "customerId"=%s
            ''',
            (shop_id, customer_id)
        )
        row = cur.fetchone()
        cur.close()
        conn.close()
        
        if row:
            return {
                "preferredCategories": row[0],
                "preferredProducts": row[1],
                "averageBudget": row[2],
                "purchaseFrequency": row[3],
                "lastPurchaseSummary": row[4],
                "customerPreferences": row[5],
                "interactionSummary": row[6]
            }
    except Exception as e:
        print(f"[DB Error] Failed to get customer profile: {e}")
    return None

def update_customer_profile(shop_id, customer_id, updates):
    if not customer_id or not updates:
        return
    try:
        conn = get_connection()
        cur = conn.cursor()
        
        # Check if exists
        cur.execute('SELECT id FROM "CustomerProfileMemory" WHERE "shopId"=%s AND "customerId"=%s', (shop_id, customer_id))
        exists = cur.fetchone()
        
        if exists:
            # Build update query
            set_clauses = []
            values = []
            for k, v in updates.items():
                if v is not None: # Don't update null fields blindly
                    set_clauses.append(f'"{k}" = %s')
                    values.append(v)
            
            if not set_clauses:
                return
                
            set_clauses.append('"updatedAt" = %s')
            values.append(datetime.now())
            
            values.extend([shop_id, customer_id])
            query = f'UPDATE "CustomerProfileMemory" SET {", ".join(set_clauses)} WHERE "shopId"=%s AND "customerId"=%s'
            cur.execute(query, tuple(values))
        else:
            # Insert
            fields = ['"id"', '"shopId"', '"customerId"', '"createdAt"', '"updatedAt"']
            values = [str(uuid.uuid4()), shop_id, customer_id, datetime.now(), datetime.now()]
            
            for k, v in updates.items():
                if v is not None:
                    fields.append(f'"{k}"')
                    values.append(v)
                
            placeholders = ["%s"] * len(values)
            query = f'INSERT INTO "CustomerProfileMemory" ({", ".join(fields)}) VALUES ({", ".join(placeholders)})'
            cur.execute(query, tuple(values))
            
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[DB Error] Failed to update customer profile: {e}")
