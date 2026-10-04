import dotenv from 'dotenv';
dotenv.config();

import pkg from '@prisma/client';
const { PrismaClient } = pkg;

let dbUrl = process.env.DATABASE_URL || 'postgresql://dialmate:dialmatepassword@localhost:5432/dialmate';
dbUrl = dbUrl
  .replace('${POSTGRES_USER}', process.env.POSTGRES_USER || 'dialmate')
  .replace('${POSTGRES_PASSWORD}', process.env.POSTGRES_PASSWORD || 'dialmatepassword')
  .replace('${POSTGRES_DB}', process.env.POSTGRES_DB || 'dialmate')
  .replace('@db:', '@localhost:');

const prisma = new PrismaClient({
  datasources: { db: { url: dbUrl } }
});

export async function seedSafeTestOrder() {
  const adminTestPhone = process.env.ADMIN_TEST_NUMBERS?.split(',')?.[0]?.trim() || '+923001234567';

  console.log(`Seeding safe test order for whitelisted number: ${adminTestPhone.slice(0, 4)}****${adminTestPhone.slice(-4)}`);

  // 1. Organization
  let org = await prisma.organization.findFirst();
  if (!org) {
    org = await prisma.organization.create({
      data: { name: 'Sunday Bazaar Retail' }
    });
  }

  // 2. Shop
  const shopDomain = '0qwck2-s1.myshopify.com';
  let shop = await prisma.shop.findUnique({
    where: { domain: shopDomain }
  });

  const shopSettings = {
    deliverySLA: '3 to 5 business days via courier',
    allowOpenParcel: true,
    returnPolicy: '7 days return or exchange policy through customer support',
    aiCalling: {
      enabled: true,
      maxAttempts: 3,
      callingHours: '24/7'
    },
    orderRules: {
      codOnly: true,
      minOrderValue: 100,
      maxOrderValue: 200000
    }
  };

  if (!shop) {
    shop = await prisma.shop.create({
      data: {
        organizationId: org.id,
        domain: shopDomain,
        name: 'Sunday Bazaar',
        isActive: true,
        settings: JSON.stringify(shopSettings)
      }
    });
  } else {
    shop = await prisma.shop.update({
      where: { id: shop.id },
      data: {
        name: 'Sunday Bazaar',
        isActive: true,
        settings: JSON.stringify(shopSettings)
      }
    });
  }

  // Also ensure sundaybazaaar.myshopify.com exists or aliases
  let aliasShop = await prisma.shop.findUnique({ where: { domain: 'sundaybazaaar.myshopify.com' } });
  if (!aliasShop) {
    aliasShop = await prisma.shop.create({
      data: {
        organizationId: org.id,
        domain: 'sundaybazaaar.myshopify.com',
        name: 'Sunday Bazaar',
        isActive: true,
        settings: JSON.stringify(shopSettings)
      }
    });
  }

  // 3. Customer
  let customer = await prisma.customer.findFirst({
    where: { shopId: shop.id, phone: adminTestPhone }
  });

  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        shopId: shop.id,
        firstName: 'Muhammad',
        lastName: 'Tariq',
        phone: adminTestPhone
      }
    });
  }

  // 4. Test Order
  const orderNumber = '1099';
  const orderPayload = {
    id: 9991099,
    name: '#1099',
    order_number: 1099,
    phone: adminTestPhone,
    total_price: '2500',
    subtotal_price: '2250',
    shipping_lines: [{ price: '250', title: 'Standard Courier' }],
    payment_gateway_names: ['Cash on Delivery (COD)'],
    gateway: 'Cash on Delivery (COD)',
    line_items: [
      {
        id: 11099,
        title: 'Leather Bifold Wallet (Brown)',
        name: 'Leather Bifold Wallet (Brown)',
        variant_title: 'Brown',
        quantity: 1,
        price: '2250'
      }
    ],
    shipping_address: {
      name: 'Muhammad Tariq',
      address1: 'House 45, Street 12, Sector F-8/2',
      city: 'Islamabad',
      country: 'Pakistan',
      phone: adminTestPhone
    },
    customer: {
      first_name: 'Muhammad',
      last_name: 'Tariq',
      phone: adminTestPhone
    }
  };

  let order = await prisma.order.findFirst({
    where: { shopId: shop.id, orderNumber }
  });

  if (!order) {
    order = await prisma.order.create({
      data: {
        id: 'ord-live-qa-7890',
        shopId: shop.id,
        customerId: customer.id,
        orderNumber: '1099',
        shopifyOrderGid: 'gid://shopify/Order/9991099',
        totalAmount: 2500,
        status: 'Pending Confirmation',
        callStatus: 'pending',
        payload: JSON.stringify(orderPayload)
      }
    });
  } else {
    order = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'Pending Confirmation',
        callStatus: 'pending',
        totalAmount: 2500,
        payload: JSON.stringify(orderPayload)
      }
    });
  }

  console.log(`✅ Safe test order initialized:`);
  console.log(` - Order ID: ${order.id}`);
  console.log(` - Order#: #${order.orderNumber}`);
  console.log(` - Shop: ${shop.domain} (${shop.name})`);
  console.log(` - Customer: Muhammad Tariq (${adminTestPhone.slice(0, 4)}****${adminTestPhone.slice(-4)})`);
  console.log(` - Total: Rs. ${order.totalAmount} COD`);
  console.log(` - Status: ${order.status}`);

  return { shop, customer, order };
}

if (process.argv[1]?.endsWith('seed_safe_test_order.js')) {
  seedSafeTestOrder()
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
