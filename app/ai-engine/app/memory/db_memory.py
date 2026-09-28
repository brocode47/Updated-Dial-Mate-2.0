import psycopg2
import os
import uuid
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()


def get_connection():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        database=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD")
    )


def get_or_create_conversation(shop_id, phone=None):

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
            SELECT id
            FROM "Conversation"
            WHERE "shopId"=%s AND "customerId"=%s
            AND status='ACTIVE'
            ORDER BY "createdAt" DESC
            LIMIT 1
            ''',
            (shop_id, customer_id)
        )
    else:
        cur.execute(
            '''
            SELECT id
            FROM "Conversation"
            WHERE "shopId"=%s AND "customerId" IS NULL
            AND status='ACTIVE'
            ORDER BY "createdAt" DESC
            LIMIT 1
            ''',
            (shop_id,)
        )

    conversation = cur.fetchone()

    if conversation:
        conversation_id = conversation[0]

    else:
        conversation_id = str(uuid.uuid4())
        now = datetime.now()

        cur.execute(
            '''
            INSERT INTO "Conversation"
            (id, "shopId", "customerId", "createdAt", "updatedAt")
            VALUES (%s,%s,%s,%s,%s)
            ''',
            (
                conversation_id,
                shop_id,
                customer_id,
                now,
                now
            )
        )

    conn.commit()

    cur.close()
    conn.close()

    return conversation_id


def save_message(shop_id, phone, message, sender="customer"):

    conversation_id = get_or_create_conversation(shop_id, phone)

    conn = get_connection()
    cur = conn.cursor()

    cur.execute(
        '''
        INSERT INTO "Message"
        (id, "conversationId", sender, text, "createdAt")
        VALUES (%s,%s,%s,%s,%s)
        ''',
        (
            str(uuid.uuid4()),
            conversation_id,
            sender,
            message,
            datetime.now()
        )
    )

    conn.commit()

    cur.close()
    conn.close()

    return conversation_id

def get_customer_id_by_phone(shop_id, phone):
    if not phone:
        return None
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute('SELECT id FROM "Customer" WHERE "shopId"=%s AND phone=%s', (shop_id, phone))
        customer_row = cur.fetchone()
        cur.close()
        conn.close()
        if customer_row:
            return customer_row[0]
    except Exception as e:
        print(f"[DB Error] Failed to get customer id: {e}")
    return None

def log_ai_interaction(
    shop_id,
    customer_id,
    conversation_id,
    user_message,
    detected_agent,
    intent,
    action,
    model_used,
    used_llm,
    fallback_used,
    response_time_ms,
    status,
    error_message
):
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            '''
            INSERT INTO "AIInteractionLog"
            (id, "shopId", "customerId", "conversationId", "userMessage", "detectedAgent", intent, action, "modelUsed", "usedLLM", "fallbackUsed", "responseTimeMs", status, "errorMessage", "createdAt")
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ''',
            (
                str(uuid.uuid4()),
                shop_id,
                customer_id,
                conversation_id,
                user_message,
                detected_agent,
                intent,
                action,
                model_used,
                used_llm,
                fallback_used,
                response_time_ms,
                status,
                error_message,
                datetime.now()
            )
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[Logging Error] Failed to log AI interaction: {e}")
