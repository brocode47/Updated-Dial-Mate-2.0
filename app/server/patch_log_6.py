with open('src/routes/webhooks.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'Enqueued WhatsApp message:' in line:
        lines[i] = '          console.log(Enqueued WhatsApp message: );\n'

with open('src/routes/webhooks.js', 'w', encoding='utf-8') as f:
    f.writelines(lines)
