import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()


def get_connection():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        database=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD")
    )


def get_customer_order_by_phone(phone):

    conn = get_connection()
    cur = conn.cursor()

    cur.execute(
        '''
        SELECT 
            id,
            status,
            "totalAmount"
        FROM "Order"
        WHERE payload LIKE %s
        ORDER BY "createdAt" DESC
        LIMIT 1
        ''',
        (f"%{phone}%",)
    )

    order = cur.fetchone()

    cur.close()
    conn.close()

    if not order:
        return None

    return {
        "order_id": order[0],
        "status": order[1],
        "amount": order[2]
    }


def get_customer_id_by_phone(phone):

    conn = get_connection()
    cur = conn.cursor()

    cur.execute(
        '''
        SELECT "customerId"
        FROM "Order"
        WHERE payload LIKE %s
        LIMIT 1
        ''',
        (f"%{phone}%",)
    )

    customer = cur.fetchone()

    cur.close()
    conn.close()

    if not customer:
        return None

    return customer[0]
