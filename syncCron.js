const cron = require('node-cron');
const db = require('./db');
const { getLivePrices, calculateProductPrice } = require('./goldService');
const { updateSallaProductPrice } = require('./sallaService');

function startSyncCron() {
  // تشغيل المزامنة كل 5 دقائق
  cron.schedule('*/5 * * * *', async () => {
    console.log('...بدء عملية مزامنة أسعار الذهب والمنتجات من واجهة إدارة التسعير [Cron]');
    try {
      // 1. جلب أسعار الذهب اللحظية (بورصة الذهب)
      const liveRates = await getLivePrices();

      // 2. جلب كافة إعدادات المنتجات المخزنة التي قمت بحفظها من الواجهة
      const { rows: products } = await db.query('SELECT * FROM products');

      for (const product of products) {
        // إذا لم يكن للمنتج وزن محدد في الواجهة يتم تخطيه
        if (!product.weight || parseFloat(product.weight) <= 0) {
          continue;
        }

        // 3. بناء كائن البيانات بنفس تفاصيل الواجهة تماماً
        const productData = {
          karat: product.karat,
          weight: parseFloat(product.weight || 0),
          making_charge: parseFloat(product.making_charge || 0),
          fixed_fee: parseFloat(product.fixed_fee || 0),
          profit_margin: parseFloat(product.profit_margin || 0),
          // الالتزام بشرط الضريبة (عيار 24 غير خاضع، والعيارات الأخرى حسب الخيار المالي للواجهة)
          is_taxable: String(product.karat) === '24' ? false : Boolean(product.is_taxable)
        };

        // 4. تطبيق معادلة التسعير المعتمدة في واجهة الإدارة
        const newPrice = calculateProductPrice(productData, liveRates);

        // 5. تحديث السعر النهائي في متجر سلة
        await updateSallaProductPrice(product.salla_product_id, newPrice);

        // 6. تحديث السعر الحالي في قاعدة البيانات ليتطابق مع الواجهة وسلة
        await db.query(
          'UPDATE products SET current_price = $1, updated_at = NOW() WHERE id = $2',
          [newPrice, product.id]
        );

        console.log(`تحديث المنتج [${product.name}] وفق حسابات الواجهة إلى السعر: ${newPrice} ر.س`);
      }

      console.log('.تمت المزامنة وحساب الأسعار بنجاح [Cron]');
    } catch (err) {
      console.error('خطأ أثناء المزامنة التلقائية:', err.message);
    }
  });
}

module.exports = { startSyncCron };
