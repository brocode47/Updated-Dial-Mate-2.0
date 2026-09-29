from app.memory.db_memory import get_connection


def search_products(category=None, max_price=None, shop_id=None):
    conn = None
    cur = None
    try:
        conn = get_connection()
        cur = conn.cursor()

        query = """
        SELECT name, description, price
        FROM "Product"
        WHERE 1=1
        """
        params = []

        if shop_id:
            query += ' AND "shopId" = %s'
            params.append(shop_id)

        if category:
            query += ' AND category ILIKE %s'
            params.append(f"%{category}%")

        if max_price:
            query += ' AND price <= %s'
            params.append(max_price)

        query += " LIMIT 5"

        cur.execute(query, params)
        rows = cur.fetchall()
        return rows
    except Exception as e:
        print(f"[Product Tools Error] search_products failed: {e}")
        return []
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()
