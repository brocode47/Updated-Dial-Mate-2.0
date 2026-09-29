import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()


from app.memory.db_memory import get_connection


def get_customer_order_by_phone(phone, shop_id=None):
    if not phone:
        return None

    try:
        conn = get_connection()
        cur = conn.cursor()

        if shop_id:
            cur.execute(
                '''
                SELECT 
                    id,
                    status,
                    "totalAmount"
                FROM "Order"
                WHERE "shopId" = %s AND payload LIKE %s
                ORDER BY "createdAt" DESC
                LIMIT 1
                ''',
                (shop_id, f"%{phone}%")
            )
        else:
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
    except Exception as e:
        print(f"[Customer Tools] Error fetching order: {e}")
        return None


def get_customer_id_by_phone(phone, shop_id=None):
    if not phone:
        return None

    try:
        conn = get_connection()
        cur = conn.cursor()

        if shop_id:
            cur.execute(
                '''
                SELECT id
                FROM "Customer"
                WHERE "shopId" = %s AND phone = %s
                LIMIT 1
                ''',
                (shop_id, phone)
            )
        else:
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
    except Exception as e:
        print(f"[Customer Tools] Error fetching customer id: {e}")
        return None
