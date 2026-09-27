import re

with open('prisma/schema.prisma', 'r', encoding='utf-8') as f:
    content = f.read()

# Add relation to Shop
if 'whatsAppIntegrations' not in content:
    content = re.sub(
        r'(model Shop \{[\s\S]*?webhooks\s+WebhookEvent\[\]\n)',
        r'\1  whatsAppIntegrations WhatsAppIntegration[]\n',
        content
    )

# Add new model at the end
if 'model WhatsAppIntegration' not in content:
    model = """
model WhatsAppIntegration {
  id        String   @id @default(uuid())
  shopId    String
  shop      Shop     @relation(fields: [shopId], references: [id])
  provider  String
  sessionId String
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([provider, sessionId])
  @@index([shopId])
  @@index([isActive])
}
"""
    content += model

with open('prisma/schema.prisma', 'w', encoding='utf-8') as f:
    f.write(content)

print("Schema updated successfully")
