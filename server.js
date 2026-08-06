const express = require('express');
const cors = require('cors');
const db = require('./db');
const { getLivePrices, calculateProductPrice } = require('./goldService');
const { fetchSallaProducts, updateSallaProductPrice } = require('./sallaService');
const { startSyncCron } = require('./syncCron');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// إنشاء الجداول في قاعدة البيانات عند التشغيل
const initDb = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS store_settings (
          id SERIAL PRIMARY KEY,
          merchant_id VARCHAR(255) UNIQUE NOT NULL,
          access_token TEXT NOT NULL,
          refresh_token TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          salla_product_id VARCHAR(255) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          sku VARCHAR(100),
          metal_type VARCHAR(20) DEFAULT 'gold',
          karat INT NOT NULL DEFAULT 21,
          weight DECIMAL(10,3) NOT NULL DEFAULT 0.000,
          workmanship_per_gram DECIMAL(10,2) DEFAULT 0.00,
          extra_fee DECIMAL(10,2) DEFAULT 0.00,
          profit_margin_percent DECIMAL(5,2) DEFAULT 0.00,
          is_taxable BOOLEAN DEFAULT TRUE,
          current_price DECIMAL(10,2) DEFAULT 0.00,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Database tables verified/created successfully.");
  } catch (err) {
    console.error("Database initialization error:", err);
  }
};

// تشغيل إنشائي للجداول وتفعيل المجدول الزمني
initDb();
startSyncCron();

// رابط فحص حالة السيرفر
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date() });
});

// API 1: جلب أسعار الذهب الفورية للوحة التحكم
app.get('/api/live-prices', async (req, res) => {
    try {
        const rates = await getLivePrices();
        res.json({ success: true, rates });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API 2: سحب المنتجات من سلة وتخزينها في التطبيق
app.post('/api/products/import', async (req, res) => {
    try {
        const sallaProducts = await fetchSallaProducts();
        for (const p of sallaProducts) {
            await db.query(`
                INSERT INTO products (salla_product_id, name, sku, current_price)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (salla_product_id) DO UPDATE 
                SET name = EXCLUDED.name, current_price = EXCLUDED.current_price
            `, [p.id, p.name, p.sku || '', p.price ? p.price.amount : 0]);
        }
        res.json({ success: true, message: `تم سحب ${sallaProducts.length} منتج بنجاح` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API 3: جلب جميع المنتجات المخزنة مع تفاصيل التسعير
app.get('/api/products', async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM products ORDER BY id DESC');
        res.json({ success: true, products: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API 4: تحديث تفاصيل الذهب لمنتج معين (عيار، وزن، مصنعية)
app.put('/api/products/:id', async (req, res) => {
    const { id } = req.params;
    const { metal_type, karat, weight, workmanship_per_gram, extra_fee, profit_margin_percent, is_taxable } = req.body;

    try {
        const { rows } = await db.query(`
            UPDATE products SET 
                metal_type = $1, karat = $2, weight = $3, 
                workmanship_per_gram = $4, extra_fee = $5, 
                profit_margin_percent = $6, is_taxable = $7, updated_at = NOW()
            WHERE id = $8 RETURNING *
        `, [metal_type, karat, weight, workmanship_per_gram, extra_fee, profit_margin_percent, is_taxable, id]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: "المنتج غير موجود" });
        }

        const updatedProduct = rows[0];
        
        // إعادة حساب السعر وتحديث سلة فوراً
        const liveRates = await getLivePrices();
        const newPrice = calculateProductPrice(updatedProduct, liveRates);
        
        await updateSallaProductPrice(updatedProduct.salla_product_id, newPrice);
        await db.query('UPDATE products SET current_price = $1 WHERE id = $2', [newPrice, id]);

        res.json({ success: true, product: { ...updatedProduct, current_price: newPrice } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
