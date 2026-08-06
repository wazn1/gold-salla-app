const cron = require('node-cron');
const db = require('./db');
const { getLivePrices, calculateProductPrice } = require('./goldService');
const { updateSallaProductPrice } = require('./sallaService');

function startSyncCron() {
  // تشغيل المزامنة كل 5 دقائق (أو حسب الجدول المحدد لديك)
  cron.schedule('*/5 * * * *', async () => {
    console.log('...بدء عملية مزامنة أسعار الذهب والمنتجات [Cron]');
    try {
      // 1. جلب أسعار الذهب اللحظية
      const liveRates = await getLivePrices();
      
      // 2. جلب كافة المنتجات المخزنة من قاعدة البيانات مع إعداداتها
      const { rows: products } = await db.query('SELECT * FROM products');

      for (const product of products) {
        // تجاهل المنتجات التي لم يتم تحديد وزنها بعد (لتجنب الحساب الصفري)
        if (!product.weight || parseFloat(product.weight) <= 0) {
          continue;
        }

        // 3. إعادة حساب السعر بناءً على إعدادات المنتج المخزنة في قاعدة البيانات
        const newPrice = calculateProductPrice(product, liveRates);

        // 4. تحديث السعر في متجر سلة فوراً
        await updateSallaProductPrice(product.salla_product_id, newPrice);

        // 5. تحديث السعر الحالي في قاعدة البيانات
        await db.query('UPDATE products SET current_price = $1, updated_at = NOW() WHERE id = $2', [newPrice, product.id]);

        console.log(`تحديث المنتج ${product.name} إلى السعر الجديد: ${newPrice} ر.س`);
      }

      console.log('.تمت المزامنة بنجاح [Cron]');
    } catch (err) {
      console.error('خطأ أثناء المزامنة التلقائية:', err.message);
    }
  });
}

module.exports = { startSyncCron };
