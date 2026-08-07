const db = require('./db');
const { getLivePrices, calculateProductPrice } = require('./goldService');
const { updateSallaProductPrice } = require('./sallaService');

function startSyncCron() {
  setInterval(async () => {
    try {
      // 1. جلب أسعار الذهب المباشرة
      const liveRates = await getLivePrices();

      // 2. جلب جميع المتاجر ذات الاشتراك النشط فقط
      const { rows: stores } = await db.query(`
        SELECT merchant_id FROM store_settings 
        WHERE subscription_expires_at > NOW() OR subscription_expires_at IS NULL
      `);

      for (const store of stores) {
        const { rows: products } = await db.query(
          'SELECT * FROM products WHERE merchant_id = $1',
          [store.merchant_id]
        );

        for (const product of products) {
          if (!product.weight || parseFloat(product.weight) <= 0) continue;

          const { originalPrice, finalPrice } = calculateProductPrice(product, liveRates);

          if (parseFloat(product.current_price) !== parseFloat(finalPrice)) {
            await updateSallaProductPrice(
              product.salla_product_id,
              originalPrice,
              product.discount_percent,
              product.weight,
              store.merchant_id
            );

            await db.query(`
              UPDATE products 
              SET current_price = $1, original_price = $2, updated_at = NOW() 
              WHERE id = $3
            `, [finalPrice, originalPrice, product.id]);

            console.log(`[مزامنة آليّة] ${product.name} (متجر: ${store.merchant_id}) -> ${finalPrice} ر.س`);
          }
        }
      }
    } catch (err) {
      console.error('خطأ أثناء مزامنة المتاجر:', err.message);
    }
  }, 10000); // مزامنة كل 10 ثوانٍ
}

module.exports = { startSyncCron };
