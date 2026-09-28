import os
os.environ.setdefault("DB_HOST", "localhost")
os.environ.setdefault("DB_NAME", "dialmate")
os.environ.setdefault("DB_USER", "postgres")
os.environ.setdefault("DB_PASSWORD", "postgres")

import sys
sys.path.append('.')
from app.memory.db_memory import get_connection
conn = get_connection()
cur = conn.cursor()
cur.execute('''
CREATE TABLE IF NOT EXISTS "AIInteractionLog" (
    id TEXT PRIMARY KEY,
    "shopId" TEXT,
    "customerId" TEXT,
    "conversationId" TEXT,
    "userMessage" TEXT,
    "detectedAgent" TEXT,
    intent TEXT,
    action TEXT,
    "modelUsed" TEXT,
    "usedLLM" BOOLEAN DEFAULT FALSE,
    "fallbackUsed" BOOLEAN DEFAULT FALSE,
    "responseTimeMs" INTEGER,
    status TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AIInteractionLog_shopId_idx" ON "AIInteractionLog"("shopId");
CREATE INDEX IF NOT EXISTS "AIInteractionLog_customerId_idx" ON "AIInteractionLog"("customerId");
CREATE INDEX IF NOT EXISTS "AIInteractionLog_conversationId_idx" ON "AIInteractionLog"("conversationId");
''')
conn.commit()
print('Table created!')
