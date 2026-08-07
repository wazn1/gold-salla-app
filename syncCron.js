const db = require('./db');
const { getLivePrices, calculateProductPrice } = require('./goldService');
const { updateSallaProductPrice } = require('./sallaService');

function startSyncCron() {
  // تشغيل المزامنة التلقائية كل 10 ثوانٍ (10000 ميلي ثانية)
  setInterval(async () => {
    try {
      // 1. جلب أسعار الذهب الفورية (البورصة)
      const liveRates = await getLivePrices();

      // 2. جلب المنتجات وإعداداتها التي قمت بحفظها من الواجهة
      const { rows: products } = await db.query('SELECT * FROM products');

      for (const product of products) {
        // إذا لم يكن للمنتج وزن مدخل يتم تخطيه
        if (!product.weight || parseFloat(product.weight) <= 0) {
          continue;
        }

        // 3. التأكد التام من استثناء عيار 24 من ضريبة الـ 15% دائماً
        const isTaxable = Number(product.karat) === 24 ? false : Boolean(product.is_taxable);

        // 4. بناء الكائن بنفس أسماء حقول واجهة إدارة التسعير بدقة
        const productData = {
          karat: Number(product.karat),
          weight: parseFloat(product.weight || 0),
          workmanship_per_gram: parseFloat(product.workmanship_per_gram || 0),
          extra_fee: parseFloat(product.extra_fee || 0),
          profit_margin_percent: parseFloat(product.profit_margin_percent || 0),
          is_taxable: isTaxable
        };

        // 5. حساب السعر وفق نفس المعادلة التي تظهر في الواجهة
        const newPrice = calculateProductPrice(productData, liveRates);

        // إذا اختلف السعر عن السعر الحالي في قاعدة البيانات، قم بالتحديث في سلة
        if (parseFloat(product.current_price) !== parseFloat(newPrice)) {
          await updateSallaProductPrice(product.salla_product_id, newPrice);
          await db.query('UPDATE products SET current_price = $1, updated_at = NOW() WHERE id = $2', [newPrice, product.id]);
          console.log(`[كل 10 ثوانٍ] تحديث ${product.name} إلى: ${newPrice} ر.س`);
        }
      }
    } catch (err) {
      console.error('خطأ أثناء مزامنة الـ 10 ثوانٍ:', err.message);
    }
  }, 10000); // 10000 ms = 10 ثوانٍ
}

module.exports = { startSyncCron };
