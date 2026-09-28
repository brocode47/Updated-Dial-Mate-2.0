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


def get_conversation_history(shop_id, phone=None):

    conn = get_connection()
    cur = conn.cursor()

    customer_id = None
    if phone:
        cur.execute('SELECT id FROM "Customer" WHERE "shopId"=%s AND phone=%s', (shop_id, phone))
        customer_row = cur.fetchone()
        if customer_row:
            customer_id = customer_row[0]

    if customer_id:
        cur.execute(
            '''
            SELECT m.sender, m.text
            FROM "Message" m
            JOIN "Conversation" c
            ON m."conversationId" = c.id
            WHERE c."shopId"=%s AND c."customerId"=%s
            ORDER BY m."createdAt" DESC
            LIMIT 10
            ''',
            (shop_id, customer_id)
        )
    else:
        cur.execute(
            '''
            SELECT m.sender, m.text
            FROM "Message" m
            JOIN "Conversation" c
            ON m."conversationId" = c.id
            WHERE c."shopId"=%s AND c."customerId" IS NULL
            ORDER BY m."createdAt" DESC
            LIMIT 10
            ''',
            (shop_id,)
        )

    rows = cur.fetchall()

    cur.close()
    conn.close()

    history = []

    for row in reversed(rows):
        history.append(
            {
                "role": row[0],
                "content": row[1]
            }
        )

    return history
