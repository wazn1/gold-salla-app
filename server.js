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

// تشغيل نظام المزامنة الآلي
startSyncCron();

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
            `, [p.id, p.name, p.sku || '', p.price.amount]);
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

// API 4: تحديث تفاصيل ذهب لمنتج معين (عيار، وزن، مصنعية)
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

