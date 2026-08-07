const cron = require('node-cron');
const db = require('./db');
const { getLivePrices, calculateProductPrice } = require('./goldService');
const { updateSallaProductPrice } = require('./sallaService');

function startSyncCron() {
  // التشغيل كل 10 ثوانٍ
  cron.schedule('*/10 * * * * *', async () => {
    try {
      // جلب أسعار الذهب الحية
      const liveRates = await getLivePrices();
      if (!liveRates) return;

      // جلب جميع المنتجات التي تحتوي على وزن
      const { rows: products } = await db.query('SELECT * FROM products WHERE weight > 0');

      for (const product of products) {
        try {
          // حساب السعر الجديد
          const { originalPrice, finalPrice } = calculateProductPrice(product, liveRates);

          // إرسال السعر والخصم إلى سلة
          await updateSallaProductPrice(
            product.salla_product_id, 
            originalPrice, 
            product.discount_percent, 
            product.weight
          );

          // تحديث السعر في قاعدة البيانات
          await db.query(
            'UPDATE products SET current_price = $1, original_price = $2, updated_at = NOW() WHERE id = $3',
            [finalPrice, originalPrice, product.id]
          );
        } catch (singleErr) {
          // تجاوز خطأ منتج واحد لضمان استمرار الدورة للمنتجات الأخرى
          console.error(`Error updating product ID ${product.id}:`, singleErr.message);
        }
      }
    } catch (err) {
      console.error('Error in automatic sync cron:', err.message);
    }
  });

  console.log('Automatic price sync cron started (running every 10 seconds).');
}

module.exports = { startSyncCron };
