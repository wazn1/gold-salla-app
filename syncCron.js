const cron = require('node-cron');
const db = require('./db');
const { getLivePrices, calculateProductPrice } = require('./goldService');
const { updateSallaProductPrice } = require('./sallaService');

function startSyncCron() {
    // تشغيل التحديث كل 5 دقائق
    cron.schedule('*/5 * * * *', async () => {
        console.log('[Cron] بدء عملية مزامنة أسعار الذهب والمنتجات...');
        try {
            const liveRates = await getLivePrices();
            const { rows: products } = await db.query('SELECT * FROM products');

            for (const product of products) {
                const newPrice = calculateProductPrice(product, liveRates);
                
                // تحديث المتجر وقاعدة البيانات إذا تغير السعر فقط
                if (Math.abs(newPrice - parseFloat(product.current_price)) > 0.01) {
                    console.log(`تحديث المنتج ${product.name} إلى السعر الجديد: ${newPrice} ر.س`);
                    
                    await updateSallaProductPrice(product.salla_product_id, newPrice);
                    await db.query(
                        'UPDATE products SET current_price = $1, updated_at = NOW() WHERE id = $2',
                        [newPrice, product.id]
                    );
                }
            }
            console.log('[Cron] تمت المزامنة بنجاح.');
        } catch (error) {
            console.error('[Cron Error] خطأ في تنفيذ المزامنة:', error.message);
        }
    });
}

module.exports = { startSyncCron };

