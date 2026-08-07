const axios = require('axios');

async function getLivePrices() {
  try {
    const response = await axios.get('https://app.goldapi.net/api/price/XAU/USD', {
      headers: {
        'x-api-key': process.env.GOLD_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    const priceUsdOunce = response.data.price;
    const usdToSar = parseFloat(process.env.USD_TO_SAR) || 3.75;
    const priceGram24 = (priceUsdOunce / 31.1034768) * usdToSar;

    return {
      karat24: priceGram24,
      karat22: priceGram24 * (22 / 24),
      karat21: priceGram24 * (21 / 24),
      karat18: priceGram24 * (18 / 24),
      updated_at: new Date()
    };
  } catch (error) {
    console.error('GoldAPI Error:', error.response?.data || error.message);
    throw new Error('فشل جلب أسعار الذهب المباشرة');
  }
}

function calculateProductPrice(product, liveRates) {
  const karatKey = `karat${product.karat}`;
  const baseGramPrice = liveRates[karatKey] || liveRates.karat21;
  
  const metalCost = parseFloat(product.weight || 0) * baseGramPrice;
  const workmanshipCost = parseFloat(product.weight || 0) * parseFloat(product.workmanship_per_gram || 0);
  const extraFee = parseFloat(product.extra_fee || 0);
  
  let subtotal = metalCost + workmanshipCost + extraFee;
  
  if (product.profit_margin_percent > 0) {
    subtotal += subtotal * (parseFloat(product.profit_margin_percent) / 100);
  }

  // الاستثناء التام لعيار 24 من الضريبة
  const isTaxable = Number(product.karat) === 24 ? false : Boolean(product.is_taxable);

  if (isTaxable) {
    subtotal += subtotal * 0.15;
  }

  const calculatedOriginalPrice = Math.round(subtotal * 100) / 100;
  const discountPercent = parseFloat(product.discount_percent || 0);

  let finalPrice = calculatedOriginalPrice;
  if (discountPercent > 0 && discountPercent < 100) {
    finalPrice = calculatedOriginalPrice * (1 - discountPercent / 100);
  }

  return {
    originalPrice: calculatedOriginalPrice,
    finalPrice: Math.round(finalPrice * 100) / 100
  };
}

module.exports = { getLivePrices, calculateProductPrice };
