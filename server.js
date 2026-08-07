const express = require('express');
const cors = require('cors');
const db = require('./db');
const { getLivePrices, calculateProductPrice } = require('./goldService');
const { fetchSallaProducts, fetchSingleSallaProduct, updateSallaProductPrice } = require('./sallaService');
const { startSyncCron } = require('./syncCron');
require('dotenv').config();

const app = express();

// السماح باتصالات CORS من GitHub Pages ومن كافة المصادر
app.use(cors());
app.use(express.json());

// إنشاء وتحديث الجداول والقيود في قاعدة البيانات
const initDb = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS store_settings (
          id SERIAL PRIMARY KEY,
          merchant_id VARCHAR(255) UNIQUE NOT NULL,
          access_token TEXT NOT NULL,
          refresh_token TEXT NOT NULL,
          subscription_expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days'),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          merchant_id VARCHAR(255) DEFAULT 'DEFAULT_STORE',
          salla_product_id VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          sku VARCHAR(100),
          metal_type VARCHAR(20) DEFAULT 'gold',
          karat INT NOT NULL DEFAULT 21,
          weight DECIMAL(10,3) NOT NULL DEFAULT 0.000,
          workmanship_per_gram DECIMAL(10,2) DEFAULT 0.00,
          extra_fee DECIMAL(10,2) DEFAULT 0.00,
          profit_margin_percent DECIMAL(5,2) DEFAULT 0.00,
          discount_percent DECIMAL(5,2) DEFAULT 0.00,
          is_taxable BOOLEAN DEFAULT TRUE,
          current_price DECIMAL(10,2) DEFAULT 0.00,
          original_price DECIMAL(10,2) DEFAULT 0.00,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days');
      ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5,2) DEFAULT 0.00;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS original_price DECIMAL(10,2) DEFAULT 0.00;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS merchant_id VARCHAR(255) DEFAULT 'DEFAULT_STORE';
      ALTER TABLE products ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

      -- إضافة قيد الفرادة بأمان لضمان عمل عمليات ON CONFLICT
      DO $$ 
      BEGIN 
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'unique_merchant_product'
        ) THEN
          ALTER TABLE products ADD CONSTRAINT unique_merchant_product UNIQUE (merchant_id, salla_product_id);
        END IF;
      END $$;
    `);
    console.log("Database schema verified and updated successfully.");
  } catch (err) {
    console.error("Database initialization error:", err);
  }
};

initDb();
startSyncCron();

// مسار فحص حالة السيرفر
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date() });
});

// 🟢 مسار جلب أسعار الذهب المباشرة والعيارات للواجهة
app.get('/api/gold-rates', async (req, res) => {
    try {
        const rates = await getLivePrices();
        if (!rates) {
            return res.status(503).json({ success: false, error: 'تعذر جلب أسعار الذهب حالياً' });
        }
        res.json({ success: true, rates, timestamp: new Date() });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// جلب معلومات اشتراك التاجر
app.get('/api/merchant/info', async (req, res) => {
    const merchant_id = req.query.merchant_id || 'DEFAULT_STORE';
    try {
        const { rows } = await db.query('SELECT merchant_id, subscription_expires_at FROM store_settings WHERE merchant_id = $1', [merchant_id]);
        if (rows.length > 0) {
            res.json({ success: true, merchant: rows[0] });
        } else {
            res.json({ success: true, merchant: { merchant_id, subscription_expires_at: new Date(Date.now() + 30*24*60*60*1000) } });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// جلب قائمة المنتجات
app.get('/api/products', async (req, res) => {
    const merchant_id = req.query.merchant_id || 'DEFAULT_STORE';
    try {
        const { rows } = await db.query('SELECT * FROM products WHERE merchant_id = $1 ORDER BY id DESC', [merchant_id]);
        
        const lastImportRes = await db.query('SELECT MAX(created_at) as last_import FROM products WHERE merchant_id = $1', [merchant_id]);
        const lastUpdateRes = await db.query('SELECT MAX(updated_at) as last_update FROM products WHERE merchant_id = $1', [merchant_id]);
        
        res.json({ 
            success: true, 
            products: rows,
            last_import: lastImportRes.rows[0]?.last_import || null,
            last_update: lastUpdateRes.rows[0]?.last_update || null
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// سحب جميع المنتجات من سلة
app.post('/api/products/import', async (req, res) => {
    const merchant_id = req.body.merchant_id || 'DEFAULT_STORE';
    try {
        const sallaProducts = await fetchSallaProducts();
        
        for (const p of sallaProducts) {
            let currentPrice = 0;
            if (p.price && typeof p.price === 'object' && p.price.amount !== undefined) {
                currentPrice = parseFloat(p.price.amount);
            } else if (typeof p.price === 'number' || typeof p.price === 'string') {
                currentPrice = parseFloat(p.price);
            }

            let productWeight = 0;
            if (p.weight && typeof p.weight === 'object' && p.weight.value !== undefined) {
                productWeight = parseFloat(p.weight.value);
            } else if (typeof p.weight === 'number' || typeof p.weight === 'string') {
                productWeight = parseFloat(p.weight);
            }

            await db.query(`
                INSERT INTO products (merchant_id, salla_product_id, name, sku, weight, current_price, original_price)
                VALUES ($1, $2, $3, $4, $5, $6, $6)
                ON CONFLICT (merchant_id, salla_product_id) DO UPDATE 
                SET name = EXCLUDED.name,
                    weight = CASE WHEN products.weight = 0 THEN EXCLUDED.weight ELSE products.weight END,
                    current_price = EXCLUDED.current_price,
                    updated_at = NOW()
            `, [merchant_id, String(p.id), p.name || 'منتج بدون اسم', p.sku || '', productWeight, currentPrice]);
        }

        res.json({ success: true, message: `تم سحب ${sallaProducts.length} منتج بنجاح` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// استدعاء منتج واحد برقم ה-ID أو الاسم
app.post('/api/products/fetch-single', async (req, res) => {
    const { query, merchant_id } = req.body;
    try {
        const product = await fetchSingleSallaProduct(query);
        if (!product) return res.status(404).json({ success: false, error: 'لم يتم العثور على المنتج في سلة' });

        let currentPrice = parseFloat(product.price?.amount || product.price || 0);
        let weight = parseFloat(product.weight?.value || product.weight || 0);

        await db.query(`
            INSERT INTO products (merchant_id, salla_product_id, name, sku, weight, current_price, original_price)
            VALUES ($1, $2, $3, $4, $5, $6, $6)
            ON CONFLICT (merchant_id, salla_product_id) DO UPDATE 
            SET name = EXCLUDED.name, current_price = EXCLUDED.current_price, updated_at = NOW()
        `, [merchant_id || 'DEFAULT_STORE', String(product.id), product.name, product.sku || '', weight, currentPrice]);

        res.json({ success: true, message: `تم استدعاء المنتج "${product.name}" بنجاح` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// تحديث إعدادات وسعر منتج معين
app.put('/api/products/:id', async (req, res) => {
    const { id } = req.params;
    const { karat, weight, workmanship_per_gram, extra_fee, profit_margin_percent, discount_percent, is_taxable } = req.body;

    try {
        const { rows } = await db.query(`
            UPDATE products SET 
                karat = $1, weight = $2, 
                workmanship_per_gram = $3, extra_fee = $4, 
                profit_margin_percent = $5, discount_percent = $6, 
                is_taxable = $7, updated_at = NOW()
            WHERE id = $8 RETURNING *
        `, [karat, weight, workmanship_per_gram, extra_fee, profit_margin_percent, discount_percent, is_taxable, id]);

        if (rows.length === 0) return res.status(404).json({ success: false, error: "المنتج غير موجود" });

        const product = rows[0];
        const liveRates = await getLivePrices();
        const { originalPrice, finalPrice } = calculateProductPrice(product, liveRates);

        await updateSallaProductPrice(product.salla_product_id, originalPrice, product.discount_percent, product.weight);
        
        await db.query('UPDATE products SET current_price = $1, original_price = $2, updated_at = NOW() WHERE id = $3', [finalPrice, originalPrice, id]);

        res.json({ success: true, product: { ...product, current_price: finalPrice, original_price: originalPrice } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// تحديث جميع المنتجات يدوياً
app.post('/api/products/update-all', async (req, res) => {
    const merchant_id = req.body.merchant_id || 'DEFAULT_STORE';
    try {
        const liveRates = await getLivePrices();
        const { rows: products } = await db.query('SELECT * FROM products WHERE merchant_id = $1', [merchant_id]);

        for (const p of products) {
            if (!p.weight || parseFloat(p.weight) <= 0) continue;
            const { originalPrice, finalPrice } = calculateProductPrice(p, liveRates);
            await updateSallaProductPrice(p.salla_product_id, originalPrice, p.discount_percent, p.weight);
            await db.query('UPDATE products SET current_price = $1, original_price = $2, updated_at = NOW() WHERE id = $3', [finalPrice, originalPrice, p.id]);
        }

        res.json({ success: true, message: 'تم تحديث أسعار وخصومات جميع المنتجات في سلة بنجاح' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// حذف منتج من النظام
app.delete('/api/products/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM products WHERE id = $1', [req.params.id]);
        res.json({ success: true, message: 'تم حذف المنتج بنجاح' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
