import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()


from app.memory.db_memory import get_connection


def get_customer_history(customer_id):

    conn = get_connection()
    cur = conn.cursor()

    cur.execute(
        '''
        SELECT m.sender, m.text
        FROM "Message" m
        JOIN "Conversation" c
        ON m."conversationId" = c.id
        WHERE c."customerId" = %s
        ORDER BY m."createdAt" DESC
        LIMIT 10
        ''',
        (customer_id,)
    )

    messages = cur.fetchall()

    cur.close()
    conn.close()

    return [
        {
            "sender": row[0],
            "message": row[1]
        }
        for row in messages
    ]
