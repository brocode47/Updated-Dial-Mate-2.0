import re
with open('src/routes/webhooks.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = re.sub(r'console\.log\(Enqueued WhatsApp message: \);', r'console.log(Enqueued WhatsApp message: );', content)

with open('src/routes/webhooks.js', 'w', encoding='utf-8') as f:
    f.write(content)
