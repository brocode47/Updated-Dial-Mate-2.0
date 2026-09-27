const fs = require('fs');
let content = fs.readFileSync('src/routes/webhooks.js', 'utf8');

const replacement =         console.log(\Enqueued WhatsApp message: \\);;
content = content.replace('console.log(Enqueued WhatsApp message: );', replacement);

fs.writeFileSync('src/routes/webhooks.js', content, 'utf8');
