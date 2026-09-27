import re

with open('src/workers/whatsappWorker.js', 'r', encoding='utf-8') as f:
    content = f.read()

target1 = "const { shopDomain, payload } = job.data;"
replacement1 = "const { shopDomain, sessionId, payload } = job.data;"
content = content.replace(target1, replacement1)

target2 = "const chatKey = `${shopDomain}:${jid}`;"
replacement2 = "const chatKey = `${shopDomain}:${sessionId}:${jid}`;"
content = content.replace(target2, replacement2)

with open('src/workers/whatsappWorker.js', 'w', encoding='utf-8') as f:
    f.write(content)
print("Patched whatsappWorker.js successfully.")
