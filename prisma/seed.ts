import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create stores
  const store1 = await prisma.store.upsert({
    where: { id: 'store-1' },
    update: {},
    create: {
      id: 'store-1',
      name: 'SmartRetail Downtown',
      address: '123 Main Street, Downtown',
      phone: '+1-555-0101',
    },
  });

  const store2 = await prisma.store.upsert({
    where: { id: 'store-2' },
    update: {},
    create: {
      id: 'store-2',
      name: 'SmartRetail Uptown',
      address: '456 Park Avenue, Uptown',
      phone: '+1-555-0102',
    },
  });

  const hashedPassword = await bcrypt.hash('password123', 10);

  // Create admin (no store affiliation)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@smartretail.com' },
    update: {},
    create: {
      email: 'admin@smartretail.com',
      password: hashedPassword,
      name: 'System Admin',
      role: 'ADMIN',
    },
  });

  // Create store owners
  const owner1 = await prisma.user.upsert({
    where: { email: 'owner1@smartretail.com' },
    update: {},
    create: {
      email: 'owner1@smartretail.com',
      password: hashedPassword,
      name: 'Alice Johnson',
      role: 'OWNER',
      storeId: store1.id,
    },
  });

  const owner2 = await prisma.user.upsert({
    where: { email: 'owner2@smartretail.com' },
    update: {},
    create: {
      email: 'owner2@smartretail.com',
      password: hashedPassword,
      name: 'Bob Williams',
      role: 'OWNER',
      storeId: store2.id,
    },
  });

  // Create cashiers
  const cashier1 = await prisma.user.upsert({
    where: { email: 'cashier1@smartretail.com' },
    update: {},
    create: {
      email: 'cashier1@smartretail.com',
      password: hashedPassword,
      name: 'Carol Smith',
      role: 'CASHIER',
      storeId: store1.id,
    },
  });

  const cashier2 = await prisma.user.upsert({
    where: { email: 'cashier2@smartretail.com' },
    update: {},
    create: {
      email: 'cashier2@smartretail.com',
      password: hashedPassword,
      name: 'David Lee',
      role: 'CASHIER',
      storeId: store1.id,
    },
  });

  // Create products for store 1
  const products = [
    { sku: 'BEV-001', name: 'Cola 330ml', category: 'Beverages', price: 1.99, costPrice: 0.80, stock: 200, storeId: store1.id },
    { sku: 'BEV-002', name: 'Water 500ml', category: 'Beverages', price: 0.99, costPrice: 0.30, stock: 300, storeId: store1.id },
    { sku: 'BEV-003', name: 'Orange Juice 1L', category: 'Beverages', price: 3.49, costPrice: 1.50, stock: 80, storeId: store1.id },
    { sku: 'SNK-001', name: 'Chips Regular', category: 'Snacks', price: 2.49, costPrice: 1.00, stock: 150, storeId: store1.id },
    { sku: 'SNK-002', name: 'Chocolate Bar', category: 'Snacks', price: 1.49, costPrice: 0.60, stock: 200, storeId: store1.id },
    { sku: 'SNK-003', name: 'Granola Bar', category: 'Snacks', price: 1.99, costPrice: 0.90, stock: 8, lowStockAlert: 15, storeId: store1.id },
    { sku: 'DRY-001', name: 'White Rice 1kg', category: 'Dry Goods', price: 4.99, costPrice: 2.50, stock: 50, storeId: store1.id },
    { sku: 'DRY-002', name: 'Pasta 500g', category: 'Dry Goods', price: 2.29, costPrice: 0.90, stock: 6, lowStockAlert: 10, storeId: store1.id },
    { sku: 'DRY-003', name: 'Cooking Oil 1L', category: 'Dry Goods', price: 6.99, costPrice: 3.50, stock: 35, storeId: store1.id },
    { sku: 'DAI-001', name: 'Whole Milk 1L', category: 'Dairy', price: 1.89, costPrice: 0.90, stock: 60, storeId: store1.id },
    { sku: 'DAI-002', name: 'Cheddar Cheese 200g', category: 'Dairy', price: 4.49, costPrice: 2.20, stock: 40, storeId: store1.id },
    { sku: 'DAI-003', name: 'Butter 250g', category: 'Dairy', price: 3.29, costPrice: 1.60, stock: 5, lowStockAlert: 10, storeId: store1.id },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: {},
      create: {
        ...product,
        lowStockAlert: product.lowStockAlert ?? 10,
      },
    });
  }

  // Create sample sales
  const productRecords = await prisma.product.findMany({ where: { storeId: store1.id } });

  const now = new Date();
  for (let i = 0; i < 20; i++) {
    const daysAgo = Math.floor(Math.random() * 30);
    const saleDate = new Date(now);
    saleDate.setDate(saleDate.getDate() - daysAgo);

    const numItems = Math.floor(Math.random() * 3) + 1;
    const selectedProducts = productRecords.sort(() => 0.5 - Math.random()).slice(0, numItems);

    let subtotal = 0;
    const items = selectedProducts.map((p) => {
      const qty = Math.floor(Math.random() * 3) + 1;
      const total = p.price * qty;
      subtotal += total;
      return { productId: p.id, quantity: qty, price: p.price, total };
    });

    const tax = subtotal * 0.08;
    const total = subtotal + tax;

    await prisma.sale.create({
      data: {
        receiptNumber: `RCP-${Date.now()}-${i}`,
        subtotal,
        tax,
        discount: 0,
        total,
        status: 'COMPLETED',
        paymentMethod: ['CASH', 'CARD', 'DIGITAL_WALLET'][Math.floor(Math.random() * 3)],
        cashierId: [cashier1.id, cashier2.id][Math.floor(Math.random() * 2)],
        storeId: store1.id,
        createdAt: saleDate,
        items: { create: items },
      },
    });
  }

  console.log('✅ Seed complete!');
  console.log('\n📋 Demo Credentials:');
  console.log('  Admin:   admin@smartretail.com   / password123');
  console.log('  Owner:   owner1@smartretail.com  / password123');
  console.log('  Cashier: cashier1@smartretail.com / password123');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
