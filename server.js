const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { getLivePrices, calculateProductPrice } = require('./goldService');
const { fetchSallaProducts, fetchSingleSallaProduct, updateSallaProductPrice } = require('./sallaService');
const { startSyncCron } = require('./syncCron');
require('dotenv').config();

const app = express();

// إعدادات CORS للسماح بالطلبات من GitHub Pages وجميع المصادر
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'wazn_gold_secret_key_2026';
const ADMIN_USER = process.env.ADMIN_USER || 'wazn_admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'gold@2026';

// Middleware للتحقق من التوكن الحقيقي للمسارات المحمية
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ success: false, error: 'غير مصرح: يرجى تسجيل الدخول' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ success: false, error: 'انتهت الجلسة، يرجى إعادة تسجيل الدخول' });
        req.user = user;
        next();
    });
};

// إنشاء وتحديث قاعدة البيانات
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

// مسار فحص الحالة
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date() });
});

// 🔑 API تسجيل الدخول الحقيقي
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        const token = jwt.sign({ username, merchant_id: 'DEFAULT_STORE' }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ success: true, token, merchant_id: 'DEFAULT_STORE' });
    }
    return res.status(401).json({ success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
});

// 🟢 مسار جلب أسعار الذهب المباشرة (متاح بدون حماية للواجهة)
app.get('/api/gold-rates', async (req, res) => {
    try {
        const liveData = await getLivePrices();
        const ounceUsd = parseFloat(liveData?.ounceUsd || liveData?.price || liveData?.ounce_usd || 0);
        const ounceSar = ounceUsd * 3.75;

        const g24 = ounceSar / 31.1035;
        const g22 = g24 * (22 / 24);
        const g21 = g24 * (21 / 24);
        const g18 = g24 * (18 / 24);

        res.json({
            success: true,
            rates: {
                ounce_usd: ounceUsd,
                ounce_sar: ounceSar,
                gram_24k: g24,
                gram_22k: g22,
                gram_21k: g21,
                gram_18k: g18
            },
            timestamp: new Date()
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 🟢 مسار استقبال Webhook من سلة
app.post('/webhooks/salla', async (req, res) => {
    try {
        const { event, merchant, data } = req.body;
        if (event === 'app.store.authorize' && data) {
            const merchantId = String(merchant || 'DEFAULT_STORE');
            const accessToken = data.access_token;
            const refreshToken = data.refresh_token;
            const expiresAt = data.expires ? new Date(data.expires * 1000) : new Date(Date.now() + 30*24*60*60*1000);

            await db.query(`
                INSERT INTO store_settings (merchant_id, access_token, refresh_token, subscription_expires_at)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (merchant_id) DO UPDATE 
                SET access_token = EXCLUDED.access_token,
                    refresh_token = EXCLUDED.refresh_token,
                    subscription_expires_at = EXCLUDED.subscription_expires_at;
            `, [merchantId, accessToken, refreshToken, expiresAt]);
        }
        res.status(200).json({ success: true, message: 'Webhook received successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 🔒 جلب معلومات التاجر
app.get('/api/merchant/info', authenticateToken, async (req, res) => {
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

// 🔒 جلب المنتجات
app.get('/api/products', authenticateToken, async (req, res) => {
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

// 🔒 سحب كافة المنتجات من سلة
app.post('/api/products/import', authenticateToken, async (req, res) => {
    const merchant_id = req.body.merchant_id || 'DEFAULT_STORE';
    try {
        const sallaProducts = await fetchSallaProducts();
        
        for (const p of sallaProducts) {
            let currentPrice = parseFloat(p.price?.amount || p.price || 0);
            let productWeight = parseFloat(p.weight?.value || p.weight || 0);

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

// 🔒 استدعاء منتج فردي
app.post('/api/products/fetch-single', authenticateToken, async (req, res) => {
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

// 🔒 تحديث منتج وحفظ السعر
app.put('/api/products/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    let { karat, weight, workmanship_per_gram, extra_fee, profit_margin_percent, discount_percent, is_taxable } = req.body;

    // استثناء عيار 24 تلقائياً من الضريبة
    if (parseInt(karat) === 24) {
        is_taxable = false;
    }

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

// 🔒 تحديث الكل
app.post('/api/products/update-all', authenticateToken, async (req, res) => {
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

// 🔒 حذف منتج
app.delete('/api/products/:id', authenticateToken, async (req, res) => {
    try {
        await db.query('DELETE FROM products WHERE id = $1', [req.params.id]);
        res.json({ success: true, message: 'تم حذف المنتج بنجاح' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
