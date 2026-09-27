import re
with open('src/routes/webhooks.js', 'r', encoding='utf-8') as f:
    content = f.read()

new_handler = """  // NEW: WA-AKG Webhook Receiver
  router.post('/wa-akg', async (req, res) => {
    try {
      const rawBody = req.body.toString('utf8');
      const signature = req.get('x-webhook-signature'); // WA-AKG signature
      const secret = process.env.WA_AKG_WEBHOOK_SECRET;
      
      if (secret) {
        if (!signature) {
          console.warn('WA-AKG Webhook missing signature');
          return res.status(401).send('Unauthorized');
        }
        
        const expectedSignature = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
        const sigBuffer = Buffer.from(signature);
        const expectedBuffer = Buffer.from(expectedSignature);

        if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
          console.warn('WA-AKG Webhook signature mismatch');
          return res.status(401).send('Unauthorized');
        }
      }

      const payload = JSON.parse(rawBody);
      
      if (payload.event === 'message.received' && payload.data) {
        const defaultShopDomain = process.env.DEFAULT_SHOP_DOMAIN || 'test.myshopify.com';
        
        await whatsappQueue.add('wa-message', {
          shopDomain: defaultShopDomain,
          payload: payload.data
        }, {
          jobId: payload.data.messageId
        });
        
        console.log(`Enqueued WhatsApp message: ${payload.data.messageId}`);
      }
      
      res.status(200).send('OK');
    } catch (error) {
      console.error('WA-AKG Webhook error:', error);
      res.status(200).send('OK');
    }
  });"""

content = re.sub(r'  // NEW: WA-AKG Webhook Receiver.*?(?=\n\s*return router;)', new_handler, content, flags=re.DOTALL)

with open('src/routes/webhooks.js', 'w', encoding='utf-8') as f:
    f.write(content)
