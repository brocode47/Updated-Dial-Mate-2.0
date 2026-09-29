import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()


from app.memory.db_memory import get_connection


def get_order(order_id, shop_id=None):
    if not order_id:
        return None

    conn = None
    cur = None
    try:
        conn = get_connection()
        cur = conn.cursor()

        if shop_id:
            cur.execute(
                '''
                SELECT 
                    id,
                    status,
                    "totalAmount",
                    "courierName",
                    "trackingNumber",
                    "trackingStatus",
                    "trackingLocation",
                    "expectedDelivery"
                FROM "Order"
                WHERE id=%s AND "shopId"=%s
                ''',
                (order_id, shop_id)
            )
        else:
            cur.execute(
                '''
                SELECT 
                    id,
                    status,
                    "totalAmount",
                    "courierName",
                    "trackingNumber",
                    "trackingStatus",
                    "trackingLocation",
                    "expectedDelivery"
                FROM "Order"
                WHERE id=%s
                ''',
                (order_id,)
            )

        order = cur.fetchone()
        if not order:
            return None

        return {
            "id": order[0],
            "status": order[1],
            "amount": order[2],
            "courier": order[3],
            "tracking_number": order[4],
            "tracking_status": order[5],
            "location": order[6],
            "expected_delivery": order[7]
        }
    except Exception as e:
        print(f"[Order Tools Error] get_order failed: {e}")
        return None
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


def update_order_status(order_id, status, shop_id=None):
    if not order_id:
        return False

    conn = None
    cur = None
    try:
        conn = get_connection()
        cur = conn.cursor()

        if shop_id:
            cur.execute(
                'UPDATE "Order" SET status=%s WHERE id=%s AND "shopId"=%s',
                (status, order_id, shop_id)
            )
        else:
            cur.execute(
                'UPDATE "Order" SET status=%s WHERE id=%s',
                (status, order_id)
            )

        conn.commit()
        return True
    except Exception as e:
        print(f"[Order Tools Error] update_order_status failed: {e}")
        if conn:
            conn.rollback()
        return False
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


def confirm_order(order_id, shop_id=None):
    return update_order_status(
        order_id,
        "Confirmed",
        shop_id=shop_id
    )


def cancel_order(order_id, shop_id=None):
    return update_order_status(
        order_id,
        "Cancelled",
        shop_id=shop_id
    )
