import psycopg2
import os


def search_products(category=None, max_price=None):

    conn = psycopg2.connect(
        "dbname=dialmate user=dialmate password=dialmatepassword host=127.0.0.1"
    )

    cur = conn.cursor()

    query = """
    SELECT name, description, price
    FROM "Product"
    WHERE 1=1
    """

    params = []

    if category:
        query += ' AND category ILIKE %s'
        params.append(f"%{category}%")

    if max_price:
        query += ' AND price <= %s'
        params.append(max_price)

    query += " LIMIT 5"

    cur.execute(query, params)

    rows = cur.fetchall()

    cur.close()
    conn.close()

    return rows
