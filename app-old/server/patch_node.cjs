const fs = require('fs');
let lines = fs.readFileSync('src/routes/webhooks.js', 'utf8').split('\n');
for(let i=0; i<lines.length; i++) {
  if (lines[i].includes('Enqueued')) {
    lines[i] = '          console.log(`Enqueued WhatsApp message: ${payload.data.messageId}`);';
  }
}
fs.writeFileSync('src/routes/webhooks.js', lines.join('\n'), 'utf8');