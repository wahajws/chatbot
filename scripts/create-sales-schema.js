import pool from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Create sales database schema and populate with mock data
 */

const products = [
  { name: 'Laptop Pro 15', category: 'Electronics', price: 1299.99, cost: 800.00 },
  { name: 'Wireless Mouse', category: 'Electronics', price: 29.99, cost: 12.00 },
  { name: 'Mechanical Keyboard', category: 'Electronics', price: 149.99, cost: 75.00 },
  { name: '4K Monitor 27"', category: 'Electronics', price: 399.99, cost: 250.00 },
  { name: 'USB-C Cable', category: 'Accessories', price: 19.99, cost: 5.00 },
  { name: 'Webcam HD', category: 'Electronics', price: 79.99, cost: 35.00 },
  { name: 'Noise Cancelling Headphones', category: 'Audio', price: 299.99, cost: 150.00 },
  { name: 'Bluetooth Speaker', category: 'Audio', price: 89.99, cost: 40.00 },
  { name: 'Tablet 10"', category: 'Electronics', price: 499.99, cost: 300.00 },
  { name: 'Smartphone Case', category: 'Accessories', price: 24.99, cost: 8.00 },
  { name: 'Screen Protector', category: 'Accessories', price: 14.99, cost: 3.00 },
  { name: 'Laptop Stand', category: 'Accessories', price: 49.99, cost: 20.00 },
  { name: 'External SSD 1TB', category: 'Storage', price: 129.99, cost: 70.00 },
  { name: 'USB Hub', category: 'Accessories', price: 34.99, cost: 15.00 },
  { name: 'Gaming Mouse', category: 'Electronics', price: 69.99, cost: 30.00 }
];

const customerNames = [
  'John Smith', 'Sarah Johnson', 'Michael Brown', 'Emily Davis', 'David Wilson',
  'Jessica Martinez', 'Christopher Anderson', 'Amanda Taylor', 'Matthew Thomas', 'Ashley Jackson',
  'Daniel White', 'Melissa Harris', 'James Martin', 'Michelle Thompson', 'Robert Garcia',
  'Laura Martinez', 'William Robinson', 'Stephanie Clark', 'Joseph Rodriguez', 'Nicole Lewis',
  'Charles Lee', 'Kimberly Walker', 'Thomas Hall', 'Angela Allen', 'Mark Young'
];

const cities = [
  'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix',
  'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'San Jose',
  'Austin', 'Jacksonville', 'Fort Worth', 'Columbus', 'Charlotte'
];

async function createSalesSchema() {
  const client = await pool.connect();
  
  try {
    console.log('Creating sales database schema...\n');

    // Create customers table
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        phone VARCHAR(20),
        address TEXT,
        city VARCHAR(50),
        state VARCHAR(50),
        zip_code VARCHAR(10),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ Created customers table');

    // Create products table
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        category VARCHAR(50),
        price DECIMAL(10, 2) NOT NULL,
        cost DECIMAL(10, 2),
        stock_quantity INTEGER DEFAULT 0,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ Created products table');

    // Create orders table
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id),
        order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        total_amount DECIMAL(10, 2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        shipping_address TEXT,
        payment_method VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ Created orders table');

    // Create order_items table
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id),
        quantity INTEGER NOT NULL,
        unit_price DECIMAL(10, 2) NOT NULL,
        subtotal DECIMAL(10, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ Created order_items table');

    // Create sales_summary view (optional but useful)
    await client.query(`
      CREATE OR REPLACE VIEW sales_summary AS
      SELECT 
        o.id as order_id,
        o.order_date,
        c.name as customer_name,
        c.city,
        o.total_amount,
        o.status,
        COUNT(oi.id) as item_count
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      GROUP BY o.id, o.order_date, c.name, c.city, o.total_amount, o.status
    `);
    console.log('✓ Created sales_summary view\n');

  } catch (error) {
    console.error('Error creating schema:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function populateMockData() {
  const client = await pool.connect();
  
  try {
    console.log('Populating mock data...\n');

    // Clear existing data
    await client.query('TRUNCATE TABLE order_items, orders, products, customers RESTART IDENTITY CASCADE');
    console.log('✓ Cleared existing data\n');

    // Insert products
    console.log('Inserting products...');
    for (const product of products) {
      const stockQty = Math.floor(Math.random() * 100) + 10;
      await client.query(
        `INSERT INTO products (name, category, price, cost, stock_quantity, description)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          product.name,
          product.category,
          product.price,
          product.cost,
          stockQty,
          `High-quality ${product.name.toLowerCase()} for your needs.`
        ]
      );
    }
    console.log(`✓ Inserted ${products.length} products\n`);

    // Insert customers
    console.log('Inserting customers...');
    const customerIds = [];
    for (let i = 0; i < customerNames.length; i++) {
      const name = customerNames[i];
      const email = `${name.toLowerCase().replace(' ', '.')}@email.com`;
      const phone = `555-${String(Math.floor(Math.random() * 9000) + 1000)}`;
      const city = cities[Math.floor(Math.random() * cities.length)];
      const state = ['NY', 'CA', 'TX', 'FL', 'IL'][Math.floor(Math.random() * 5)];
      const zipCode = String(Math.floor(Math.random() * 90000) + 10000);
      const address = `${Math.floor(Math.random() * 9999) + 1} Main Street`;

      const result = await client.query(
        `INSERT INTO customers (name, email, phone, address, city, state, zip_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [name, email, phone, address, city, state, zipCode]
      );
      customerIds.push(result.rows[0].id);
    }
    console.log(`✓ Inserted ${customerIds.length} customers\n`);

    // Insert orders and order items
    console.log('Inserting orders...');
    const orderStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    const paymentMethods = ['Credit Card', 'Debit Card', 'PayPal', 'Bank Transfer'];
    
    let orderCount = 0;
    const numOrders = 50; // Create 50 orders

    for (let i = 0; i < numOrders; i++) {
      const customerId = customerIds[Math.floor(Math.random() * customerIds.length)];
      const orderDate = new Date();
      orderDate.setDate(orderDate.getDate() - Math.floor(Math.random() * 90)); // Random date in last 90 days
      
      const status = orderStatuses[Math.floor(Math.random() * orderStatuses.length)];
      const paymentMethod = paymentMethods[Math.floor(Math.random() * paymentMethods.length)];

      // Calculate order total first
      const numItems = Math.floor(Math.random() * 5) + 1;
      let orderTotal = 0;
      const orderItems = [];

      for (let j = 0; j < numItems; j++) {
        const productId = Math.floor(Math.random() * products.length) + 1;
        const quantity = Math.floor(Math.random() * 3) + 1;
        
        // Get product price
        const productResult = await client.query(
          'SELECT price FROM products WHERE id = $1',
          [productId]
        );
        const unitPrice = parseFloat(productResult.rows[0].price);
        const subtotal = unitPrice * quantity;
        orderTotal += subtotal;

        orderItems.push({ productId, quantity, unitPrice, subtotal });
      }

      // Create order with total amount
      const orderResult = await client.query(
        `INSERT INTO orders (customer_id, order_date, status, payment_method, total_amount)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [customerId, orderDate, status, paymentMethod, orderTotal]
      );
      const orderId = orderResult.rows[0].id;

      // Insert order items
      for (const item of orderItems) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal)
           VALUES ($1, $2, $3, $4, $5)`,
          [orderId, item.productId, item.quantity, item.unitPrice, item.subtotal]
        );
      }

      orderCount++;
    }
    console.log(`✓ Inserted ${orderCount} orders with items\n`);

    // Display summary
    const stats = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM customers) as total_customers,
        (SELECT COUNT(*) FROM products) as total_products,
        (SELECT COUNT(*) FROM orders) as total_orders,
        (SELECT SUM(total_amount) FROM orders) as total_revenue,
        (SELECT AVG(total_amount) FROM orders) as avg_order_value
    `);

    const statsRow = stats.rows[0];
    console.log('=== Sales Database Summary ===');
    console.log(`Total Customers: ${statsRow.total_customers}`);
    console.log(`Total Products: ${statsRow.total_products}`);
    console.log(`Total Orders: ${statsRow.total_orders}`);
    console.log(`Total Revenue: $${parseFloat(statsRow.total_revenue || 0).toFixed(2)}`);
    console.log(`Average Order Value: $${parseFloat(statsRow.avg_order_value || 0).toFixed(2)}`);
    console.log('\n✓ Mock sales data created successfully!');

  } catch (error) {
    console.error('Error populating data:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await createSalesSchema();
    await populateMockData();
    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();

