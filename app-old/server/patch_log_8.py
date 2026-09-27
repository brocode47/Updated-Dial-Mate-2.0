with open('src/routes/webhooks.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('console.log(Enqueued WhatsApp message: );', 'console.log(Enqueued WhatsApp message: );')

with open('src/routes/webhooks.js', 'w', encoding='utf-8') as f:
    f.write(content)
