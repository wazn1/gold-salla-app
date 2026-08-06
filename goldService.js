const axios = require('axios');
require('dotenv').config();

const GOLD_API_KEY = process.env.GOLD_API_KEY;
const USD_TO_SAR = parseFloat(process.env.USD_TO_SAR) || 3.75;

async function getLivePrices() {
    try {
        const response = await axios.get('https://www.goldapi.io/api/XAU/USD', {
            headers: {
                'x-api-key': GOLD_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        const ouncePriceUSD = response.data.price;
        const ouncePriceSAR = ouncePriceUSD * USD_TO_SAR;
        const gram24SAR = ouncePriceSAR / 31.1035;

        return {
            gold24: gram24SAR,
            gold22: gram24SAR * (22 / 24),
            gold21: gram24SAR * (21 / 24),
            gold18: gram24SAR * (18 / 24),
            silverGram: 3.50 // سعر افتراضي أو استدعاء XAG/USD
        };
    } catch (error) {
        console.error('خطأ في جلب أسعار الذهب:', error.message);
        throw error;
    }
}

function calculateProductPrice(product, liveRates) {
    let baseGramPrice = 0;
    
    if (product.metal_type === 'silver') {
        baseGramPrice = liveRates.silverGram;
    } else {
        baseGramPrice = liveRates[`gold${product.karat}`] || liveRates.gold21;
    }

    const weight = parseFloat(product.weight) || 0;
    const workmanship = parseFloat(product.workmanship_per_gram) || 0;
    const extraFee = parseFloat(product.extra_fee) || 0;
    const profitMargin = parseFloat(product.profit_margin_percent) || 0;

    // 1. حساب تكلفة المعدن الخام
    const metalCost = weight * baseGramPrice;

    // 2. حساب التكلفة الإجمالية (معدن + مصنعية + رسم إضافي)
    const totalCost = metalCost + (weight * workmanship) + extraFee;

    // 3. إضافة نسبة الزيادة الربحية
    const pricePreTax = totalCost * (1 + (profitMargin / 100));

    // 4. تطبيق ضريبة القيمة المضافة 15% إذا كان المنتج خاضعاً
    const finalPrice = product.is_taxable ? pricePreTax * 1.15 : pricePreTax;

    return Math.round(finalPrice * 100) / 100;
}

module.exports = { getLivePrices, calculateProductPrice };

