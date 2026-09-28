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


def get_conversation_history(shop_id):

    conn = get_connection()
    cur = conn.cursor()

    cur.execute(
        '''
        SELECT m.sender, m.text
        FROM "Message" m
        JOIN "Conversation" c
        ON m."conversationId" = c.id
        WHERE c."shopId"=%s
        ORDER BY m."createdAt" DESC
        LIMIT 5
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
