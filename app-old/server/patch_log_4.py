lines = []
with open('src/routes/webhooks.js', 'r', encoding='utf-8') as f:
    for line in f:
        if 'console.log(Enqueued WhatsApp message: );' in line:
            lines.append('          console.log(Enqueued WhatsApp message: );\n')
        else:
            lines.append(line)

with open('src/routes/webhooks.js', 'w', encoding='utf-8') as f:
    f.writelines(lines)
