'use strict';

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Product catalog (hardcoded with usage instructions) ────────────────────

const PRODUCTS = {
  avologi: [
    {
      id: 'avologi-enas-serum',
      name: 'ENAS Advanced Youth Restoring Serum',
      brand: 'Avologi',
      description: 'A powerful anti-aging serum powered by ENAS technology to visibly reduce fine lines and restore youthful radiance.',
      howToUse: 'Apply 2–3 drops to clean, dry skin morning and evening. Gently press into face, neck, and décolleté. Allow to absorb fully before applying moisturizer.',
      step: 'serum',
    },
    {
      id: 'avologi-enas-face-cream',
      name: 'ENAS Face Cream',
      brand: 'Avologi',
      description: 'A rich, nourishing face cream that deeply hydrates and firms skin while delivering ENAS anti-aging peptides.',
      howToUse: 'Apply a pea-sized amount to face and neck morning and evening after your serum. Use upward, circular motions until fully absorbed.',
      step: 'moisturizer',
    },
    {
      id: 'avologi-enas-eye-cream',
      name: 'ENAS Eye Cream',
      brand: 'Avologi',
      description: 'Targets crow\'s feet, puffiness, and dark circles with concentrated ENAS peptides and hydrating actives.',
      howToUse: 'Using your ring finger, gently tap a small amount around the orbital bone (avoid the lash line) morning and evening. Never rub or pull the delicate eye area.',
      step: 'eye treatment',
    },
    {
      id: 'avologi-elight-device',
      name: 'eLight LED Device',
      brand: 'Avologi',
      description: 'Professional-grade LED light therapy device that stimulates collagen production and accelerates the absorption of serums.',
      howToUse: 'Cleanse your skin. Apply serum. Turn on the eLight device and slowly glide it over the face in upward motions for 10 minutes, 3–5 times per week. Follow with moisturizer.',
      step: 'device treatment',
    },
    {
      id: 'avologi-enas-mask',
      name: 'ENAS Youth Activating Mask',
      brand: 'Avologi',
      description: 'An intensive treatment mask that delivers a concentrated dose of ENAS peptides and hyaluronic acid for instant plumping.',
      howToUse: 'Apply an even layer to clean skin, avoiding eyes and lips. Leave on for 15–20 minutes. Remove with a damp cloth or rinse off. Use 2–3 times per week before your serum.',
      step: 'mask',
    },
  ],
  hydrasphere: [
    {
      id: 'hydrasphere-advanced-foaming-cleanser',
      name: 'Advanced Foaming Cleanser',
      brand: 'HydraSphere Plus',
      description: 'A gentle foaming cleanser that thoroughly removes impurities, makeup, and excess oil while maintaining the skin\'s natural moisture balance.',
      howToUse: 'Apply a small amount to damp skin and massage in circular motions. Rinse thoroughly with lukewarm water. Use morning and evening as the first step of your routine.',
      step: 'cleanser',
    },
    {
      id: 'hydrasphere-bio-milk-cleanser',
      name: 'Bio Milk Cleanser',
      brand: 'HydraSphere Plus',
      description: 'A nourishing milk cleanser enriched with bio-active ingredients that gently dissolves impurities while softening and conditioning the skin.',
      howToUse: 'Apply to dry or damp skin and massage gently. Rinse with warm water or remove with a soft damp cloth. Use morning and evening as the first step of your skincare routine.',
      step: 'cleanser',
    },
    {
      id: 'hydrasphere-hydra-toning-solution',
      name: 'Hydra Toning Solution',
      brand: 'HydraSphere Plus',
      description: 'Refresh and balance your skin with our revitalizing toner. Our Hydra Toning Solution is formulated to provide a refreshing and invigorating experience for your skin, helping to restore its natural pH balance and prepare it to absorb the benefits of subsequent skincare products.',
      howToUse: 'Use after cleansing. Apply with a cotton ball and smooth over the face, neck, and decollete. Use daily.',
      step: 'toner',
    },
    {
      id: 'hydrasphere-advanced-eye-lifting-serum',
      name: 'Advanced Eye Lifting Serum',
      brand: 'HydraSphere Plus',
      description: 'A targeted lifting serum for the delicate eye area that firms, brightens, and reduces the appearance of fine lines and puffiness.',
      howToUse: 'Apply 1–3 pumps to a cleansed face and eye area. Spread a thin veil over the skin, blending in small circles with a gentle tapping motion until the product disappears into the skin.',
      step: 'eye serum',
    },
    {
      id: 'hydrasphere-advanced-peptides-eye-cream',
      name: 'Advanced Peptides Eye Cream',
      brand: 'HydraSphere Plus',
      description: 'A rich, peptide-powered eye cream that targets dark circles, fine lines, and crow\'s feet while deeply hydrating the delicate under-eye skin.',
      howToUse: 'Using your ring finger, gently tap a small amount around the orbital bone morning and evening. Pat (do not rub) until fully absorbed. Apply after your serum.',
      step: 'eye cream',
    },
    {
      id: 'hydrasphere-cucumber-seaweed-eye-lift',
      name: 'Cucumber & Seaweed Eye Lift',
      brand: 'HydraSphere Plus',
      description: 'A cooling, soothing eye treatment combining cucumber extract and marine seaweed to depuff, brighten, and lift the under-eye area.',
      howToUse: 'Apply a small amount around the eye area using your ring finger with gentle tapping motions. Use morning and evening after serum. Store in the fridge for an extra cooling effect.',
      step: 'eye treatment',
    },
    {
      id: 'hydrasphere-vitamin-c-serum',
      name: 'Vitamin C Serum',
      brand: 'HydraSphere Plus',
      description: 'A brightening vitamin C serum that fades dark spots, evens skin tone, and boosts radiance while providing antioxidant protection.',
      howToUse: 'Apply 2–3 drops to clean, dry skin in the morning. Gently press into face and neck. Allow to absorb before applying moisturizer. Always follow with SPF during the day.',
      step: 'serum',
    },
    {
      id: 'hydrasphere-mineralift-thermal-serum',
      name: 'MineralLift Thermal Serum',
      brand: 'HydraSphere Plus',
      description: 'A warming thermal serum infused with minerals that activates upon contact with skin to deliver deep lifting and firming benefits.',
      howToUse: 'Apply to clean skin and massage gently. The serum will warm slightly upon contact — this is normal and indicates activation. Use morning or evening before moisturizer.',
      step: 'serum',
    },
    {
      id: 'hydrasphere-oxygen-brightening-cream',
      name: 'Oxygen Brightening Cream',
      brand: 'HydraSphere Plus',
      description: 'An oxygen-infused brightening moisturizer that illuminates dull skin, evens tone, and delivers a visible radiance boost with each use.',
      howToUse: 'Apply to face and neck morning and evening after serum. Use gentle upward strokes until fully absorbed. Can be worn alone or under SPF during the day.',
      step: 'moisturizer',
    },
    {
      id: 'hydrasphere-deep-moisturizing-cream',
      name: 'Deep Moisturizing Cream',
      brand: 'HydraSphere Plus',
      description: 'Experience the transformative synergy of botanical wonders and cutting-edge science. Our Deep Moisturizing Cream offers more than just hydration; it\'s a firming elixir for your facial tissue and neck, imbued with the essence of nature\'s most potent moisturizers. Each ingredient is carefully selected for its ability to deeply nourish and firm the skin, providing a rich, luxurious experience that goes beyond mere moisturization.',
      howToUse: 'Apply generously to the face, neck, and delicate under-eye area. For best results, use the HydraSphere+ Active Foaming Cleanser.',
      step: 'moisturizer',
    },
    {
      id: 'hydrasphere-mineral-facial-deep-moisturizer',
      name: 'Mineral Facial Deep Moisturizer',
      brand: 'HydraSphere Plus',
      description: 'A mineral-enriched deep moisturizer that nourishes, protects, and restores vitality to dry and stressed skin.',
      howToUse: 'Apply to clean face and neck, morning and evening. Massage in gentle upward circles until absorbed. Follow after serum for best results.',
      step: 'moisturizer',
    },
    {
      id: 'hydrasphere-mineralift-thermal-cream',
      name: 'MineralLift Thermal Cream',
      brand: 'HydraSphere Plus',
      description: 'Our carefully formulated MineralLift Thermal Cream has been scientifically proven to promote a firmer, more lifted appearance for your skin. The carefully selected ingredients penetrate deeply into the skin, helping to stimulate collagen production and enhance elasticity for tighter and more toned skin. The thermal effect opens up pores, allowing the active ingredients to penetrate deeply and work more effectively.',
      howToUse: 'Apply smooth MineralLift Thermal Cream thoroughly over the face and neck, avoiding the eye area. Gently massage until fully absorbed.',
      step: 'moisturizer',
    },
    {
      id: 'hydrasphere-anti-wrinkle-30g',
      name: 'Anti Wrinkle Correction & Prevention 30g',
      brand: 'HydraSphere Plus',
      description: 'A clinically advanced cream designed to visibly reduce deep lines, fine lines, puffiness, and dark circles. Powered by Hyaluronic Acid, Retinol, Stem Cells, and Peptides — this high-performance formula supports firmer, smoother, and more youthful-looking skin.',
      howToUse: 'Apply directly to deep facial lines and wrinkles in the targeted area. Avoid direct contact with the eyes. In case of excess product, gently remove with a cotton swab.',
      step: 'treatment cream',
    },
    {
      id: 'hydrasphere-anti-wrinkle-15g',
      name: 'Anti Wrinkle Correction & Prevention 15g',
      brand: 'HydraSphere Plus',
      description: 'The travel-size version of the Anti Wrinkle Correction & Prevention cream — same clinically advanced formula with Hyaluronic Acid, Retinol, Stem Cells, and Peptides in a convenient smaller size.',
      howToUse: 'Apply directly to deep facial lines and wrinkles in the targeted area. Avoid direct contact with the eyes. In case of excess product, gently remove with a cotton swab.',
      step: 'treatment cream',
    },
    {
      id: 'hydrasphere-spf50-shield-cream',
      name: 'SPF 50 Shield Cream',
      brand: 'HydraSphere Plus',
      description: 'A broad-spectrum SPF 50 sunscreen that protects against UVA and UVB rays while hydrating and smoothing the skin.',
      howToUse: 'Apply generously to face and neck as the final step of your morning skincare routine. Reapply every 2 hours when exposed to direct sunlight. Do not skip — sun protection is essential every day.',
      step: 'SPF/sunscreen',
    },
    {
      id: 'hydrasphere-advanced-night-repair',
      name: 'Advanced Night Repair',
      brand: 'HydraSphere Plus',
      description: 'An intensive overnight repair cream that works with your skin\'s natural renewal cycle to restore, firm, and deeply nourish while you sleep.',
      howToUse: 'Apply a thin layer to clean dry skin on your face and neck before bedtime. Massage in small upward circles over the face and neck. Allow the cream to fully absorb before heading to bed. Use 1–2 times a week.',
      step: 'night treatment',
    },
    {
      id: 'hydrasphere-facial-peeling-gel',
      name: 'Facial Peeling Gel',
      brand: 'HydraSphere Plus',
      description: 'A revolutionary exfoliating formula that gently eliminates dead skin cells while addressing sunspots, pigmentation, age spots, acne, discoloration, redness, and rosacea. Powered by mandelic acid (a gentle AHA) with Vitamin C, Vitamin E, Vitamin A, Grapefruit Extract, Avocado Oil, and Centella Asiatica.',
      howToUse: 'Apply a thin layer to dry skin. Massage in circular motions until dry. Wash with warm water. Use 1–2 times a week. For optimal results, pair with the HydraSphere+ Deep Moisturizing Cream.',
      step: 'exfoliant',
    },
    {
      id: 'hydrasphere-mineral-facial-peeling-gel',
      name: 'Mineral Facial Peeling Gel',
      brand: 'HydraSphere Plus',
      description: 'A mineral-enriched peeling gel that exfoliates and detoxifies simultaneously, leaving skin polished, purified, and mineral-nourished.',
      howToUse: 'Apply to dry, clean skin. Massage in circular motions until the gel rolls away dead skin cells. Rinse well with lukewarm water. Use 1–2 times per week.',
      step: 'exfoliant',
    },
    {
      id: 'hydrasphere-mineral-salt-scrub',
      name: 'Mineral Salt Scrub',
      brand: 'HydraSphere Plus',
      description: 'A detoxifying mineral salt scrub that buffs away dead skin cells and purifies pores, leaving skin silky smooth and refreshed.',
      howToUse: 'Apply to damp skin and massage in gentle circular motions. Rinse thoroughly. Use 1–2 times per week in place of your regular cleanser. Follow with toner and moisturizer.',
      step: 'exfoliant/scrub',
    },
    {
      id: 'hydrasphere-mineralift-thermal-mask',
      name: 'MineralLift Thermal Mask',
      brand: 'HydraSphere Plus',
      description: 'Our MineralLift Thermal Mask, enhanced with the goodness of mineral water, takes your skincare routine to new heights by providing a multifaceted approach to facial rejuvenation. The gentle warmth generated by the mask activates and stimulates your facial muscles, promoting increased blood circulation and muscle toning.',
      howToUse: 'Thoroughly cleanse your face. Apply a thin layer to wet skin by gently massaging the chin, nose, forehead, and cheeks in a circular motion, avoiding the eye area. You will experience a warming sensation in treated areas, which is normal. Wet again to accelerate the heating process. Leave the mask on for three minutes. Rinse with warm water. Use once to twice a week.',
      step: 'mask',
    },
    {
      id: 'hydrasphere-hydrocharcoal-face-eye-mask',
      name: 'HydroCharcoal Collagen Face & Eye Mask',
      brand: 'HydraSphere Plus',
      description: 'A powerful sheet mask combining activated charcoal, collagen, and hydrogen water to deeply cleanse, plump, and revitalize the face and eye area.',
      howToUse: 'Cleanse face thoroughly. Unfold the mask and apply to face, pressing gently to adhere. Leave on for 15–20 minutes. Remove and gently pat remaining serum into skin. Use 2–3 times per week.',
      step: 'mask',
    },
    {
      id: 'hydrasphere-hydrocharcoal-neck-decollete-mask',
      name: 'HydroCharcoal Collagen Neck and Décolleté Mask',
      brand: 'HydraSphere Plus',
      description: 'A targeted sheet mask for the neck and décolleté that firms, hydrates, and smooths this often-neglected area using charcoal and collagen.',
      howToUse: 'Apply to clean neck and décolleté. Press gently to adhere. Leave on for 15–20 minutes, then remove and pat remaining serum into skin. Use 2–3 times per week.',
      step: 'mask',
    },
    {
      id: 'hydrasphere-hydrocharcoal-tummy-body-mask',
      name: 'HydroCharcoal Tummy & Lower Body Mask',
      brand: 'HydraSphere Plus',
      description: 'A detoxifying charcoal mask designed for the tummy and lower body to tone, hydrate, and smooth skin in areas prone to dryness and uneven texture.',
      howToUse: 'Apply to clean skin on the tummy and lower body. Wrap or press gently to adhere. Leave on for 20–30 minutes. Remove and massage any remaining product into skin.',
      step: 'body mask',
    },
    {
      id: 'hydrasphere-hydrocharcoal-silk-mask',
      name: 'HydroCharcoal Silk Mask',
      brand: 'HydraSphere Plus',
      description: 'A luxurious silk-infused charcoal mask that combines the detoxifying power of activated charcoal with the smoothing properties of silk proteins.',
      howToUse: 'Apply to clean, dry face. Leave on for 15–20 minutes. Remove or rinse off according to package directions. Follow with your regular serum and moisturizer. Use 1–2 times per week.',
      step: 'mask',
    },
    {
      id: 'hydrasphere-organic-shea-butter',
      name: 'Organic Shea Butter',
      brand: 'HydraSphere Plus',
      description: 'Pure, unrefined organic shea butter that provides intense nourishment for face, body, hair, and lips — a multi-use natural skincare staple.',
      howToUse: 'Warm a small amount between your palms and apply to face, body, hair, or lips as needed. Can be used as a daily moisturizer, overnight treatment, or to soothe dry patches.',
      step: 'body/multi-use moisturizer',
    },
    {
      id: 'hydrasphere-hand-body-cream',
      name: 'Hand & Body Cream',
      brand: 'HydraSphere Plus',
      description: 'A rich, fast-absorbing hand and body cream that deeply hydrates and softens skin throughout the day without leaving a greasy residue.',
      howToUse: 'Apply to hands and body as needed throughout the day. Massage in until fully absorbed. Pay extra attention to dry areas like elbows, knees, and heels. Use after bathing for best results.',
      step: 'body moisturizer',
    },
    {
      id: 'hydrasphere-chroma-manicure-set',
      name: 'Chroma Manicure Set',
      brand: 'HydraSphere Plus',
      description: 'A complete at-home manicure set with everything needed to achieve salon-quality nails, including treatment products to strengthen and beautify.',
      howToUse: 'Follow the included step-by-step manicure guide. Begin with the nail prep, apply treatments as directed, and finish with color if included. Use weekly or as desired for well-maintained nails.',
      step: 'nail/manicure',
    },
  ],
};

// GET /api/welcome/products — returns the product catalog
router.get('/products', (req, res) => {
  res.json({ products: PRODUCTS });
});

// POST /api/welcome/generate — generate a welcome email
router.post('/generate', async (req, res) => {
  const { customerEmail, selectedProductIds } = req.body;

  if (!customerEmail || typeof customerEmail !== 'string') {
    return res.status(400).json({ error: 'customerEmail is required' });
  }
  if (!Array.isArray(selectedProductIds) || selectedProductIds.length === 0) {
    return res.status(400).json({ error: 'At least one product must be selected' });
  }

  // Resolve selected products
  const allProducts = [...PRODUCTS.avologi, ...PRODUCTS.hydrasphere];
  const selectedProducts = selectedProductIds
    .map(id => allProducts.find(p => p.id === id))
    .filter(Boolean);

  if (selectedProducts.length === 0) {
    return res.status(400).json({ error: 'No valid products matched the selected IDs' });
  }

  const productDetails = selectedProducts
    .map(p => `- ${p.brand}: ${p.name}\n  How to use: ${p.howToUse}`)
    .join('\n\n');

  const prompt = `You are a warm, expert beauty consultant for Glow SF, a boutique beauty store in Santa Fe, New Mexico.

Write a personalized welcome email to a new customer. Their email is: ${customerEmail}

They have purchased the following products:
${productDetails}

The email must include:
1. A warm, genuine welcome as a Glow SF customer
2. A brief description of each product they purchased and why it's great
3. A step-by-step daily skincare routine that incorporates ALL of their products in the correct order (cleanser → toner/mist → serum → eye treatment → moisturizer → device if applicable, mask is 2–3x/week)
4. Any helpful tips or things to know (patch test for new users, introduce products one at a time, etc.)
5. An invitation to reach out with any questions and information about visiting the store in Santa Fe

Tone: warm, knowledgeable, excited — like a trusted beauty friend, not a corporate email. Use the customer's email prefix as their name if you can parse a first name from it, otherwise say "Dear Glow SF Customer".

Format the email clearly with sections and line breaks. Sign off as "The Glow SF Team".`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const emailBody = message.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    res.json({
      success: true,
      customerEmail,
      selectedProducts: selectedProducts.map(p => ({ id: p.id, name: p.name, brand: p.brand })),
      emailBody,
    });
  } catch (err) {
    console.error('[welcome] Error generating email:', err);
    res.status(500).json({ error: 'Failed to generate email: ' + err.message });
  }
});

module.exports = { router, PRODUCTS };
