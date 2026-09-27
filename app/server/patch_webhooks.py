import re

with open('src/routes/webhooks.js', 'r', encoding='utf-8') as f:
    content = f.read()

target = """      const payload = JSON.parse(rawBody);
      
      if (payload.event === 'message.received' && payload.data) {
        const defaultShopDomain = process.env.DEFAULT_SHOP_DOMAIN || 'test.myshopify.com';
        
        await whatsappQueue.add('wa-message', {
          shopDomain: defaultShopDomain,
          payload: payload.data
        }, {
          jobId: payload.data.messageId
        });
        
        console.log(`Enqueued WhatsApp message: ${payload.data.messageId}`);
      }"""

replacement = """      const payload = JSON.parse(rawBody);
      
      if (payload.event === 'message.received' && payload.data) {
        const sessionId = payload.sessionId;
        if (!sessionId) {
          console.warn('WA-AKG Webhook missing sessionId');
          return res.status(200).send('OK');
        }

        const integration = await prisma.whatsAppIntegration.findUnique({
          where: {
            provider_sessionId: {
              provider: 'WA_AKG',
              sessionId: String(sessionId)
            }
          },
          include: {
            shop: true
          }
        });

        if (!integration || !integration.isActive || !integration.shop || !integration.shop.isActive) {
          console.warn(`WA-AKG Webhook rejected for unknown/inactive sessionId: ${sessionId}`);
          return res.status(200).send('OK');
        }

        const shopDomain = integration.shop.domain;
        
        await whatsappQueue.add('wa-message', {
          shopId: integration.shop.id,
          shopDomain: shopDomain,
          sessionId: String(sessionId),
          payload: payload.data
        }, {
          jobId: payload.data.messageId || undefined
        });
        
        console.log(`Enqueued WhatsApp message: ${payload.data.messageId} for tenant ${shopDomain}`);
      }"""

if target in content:
    content = content.replace(target, replacement)
    with open('src/routes/webhooks.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Patched webhooks.js successfully.")
else:
    print("Could not find target block in webhooks.js")
