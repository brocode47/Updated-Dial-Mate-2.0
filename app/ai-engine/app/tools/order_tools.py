import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()


def get_connection():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        database=os.getenv("DB_NAME", "dialmate"),
        user=os.getenv("DB_USER", "dialmate"),
        password=os.getenv("DB_PASSWORD", "")
    )


def get_order(order_id):

    conn = get_connection()
    cur = conn.cursor()

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

    cur.close()
    conn.close()

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


def update_order_status(order_id, status):

    conn = get_connection()
    cur = conn.cursor()

    cur.execute(
        'UPDATE "Order" SET status=%s WHERE id=%s',
        (status, order_id)
    )

    conn.commit()

    cur.close()
    conn.close()

    return True


def confirm_order(order_id):
    return update_order_status(
        order_id,
        "Confirmed"
    )


def cancel_order(order_id):
    return update_order_status(
        order_id,
        "Cancelled"
    )
