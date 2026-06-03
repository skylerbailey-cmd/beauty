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
      id: 'hydrasphere-deep-hydration-serum',
      name: 'HydraSphere+ Deep Hydration Serum',
      brand: 'HydraSphere Plus',
      description: 'Hydrogen-infused serum that penetrates deep into the skin to deliver intense hydration and neutralize free radicals.',
      howToUse: 'After cleansing, apply 3–4 drops to face and neck. Gently press into skin with fingertips. Use morning and evening before moisturizer for best results.',
      step: 'serum',
    },
    {
      id: 'hydrasphere-ultra-moisture-cream',
      name: 'HydraSphere+ Ultra Moisture Cream',
      brand: 'HydraSphere Plus',
      description: 'A lightweight yet deeply nourishing moisturizer that locks in hydration for up to 72 hours using hydrogen water technology.',
      howToUse: 'Apply to face, neck, and décolleté morning and evening after serum. Use gentle upward strokes. Can be layered for extra moisture during dry months.',
      step: 'moisturizer',
    },
    {
      id: 'hydrasphere-brightening-eye',
      name: 'HydraSphere+ Brightening Eye Treatment',
      brand: 'HydraSphere Plus',
      description: 'Targets dark circles and fine lines under the eyes with brightening peptides and hydrogen-enriched water molecules.',
      howToUse: 'Dab a tiny amount with your ring finger gently around the eye area, morning and evening. Pat (do not rub) until absorbed. Apply before your moisturizer.',
      step: 'eye treatment',
    },
    {
      id: 'hydrasphere-hydrogen-mist',
      name: 'HydraSphere+ Hydrogen Water Mist',
      brand: 'HydraSphere Plus',
      description: 'A refreshing facial mist packed with molecular hydrogen to instantly hydrate, soothe, and set makeup throughout the day.',
      howToUse: 'Hold bottle 8–10 inches from face and mist evenly. Use as a toner after cleansing, to set makeup, or anytime throughout the day for a hydration boost. Can be used over makeup.',
      step: 'toner/mist',
    },
    {
      id: 'hydrasphere-cleansing-gel',
      name: 'HydraSphere+ Gentle Cleansing Gel',
      brand: 'HydraSphere Plus',
      description: 'A sulfate-free cleansing gel infused with hydrogen water that removes impurities without stripping the skin\'s natural moisture barrier.',
      howToUse: 'Apply a small amount to wet face, massaging in circular motions for 60 seconds. Rinse thoroughly with lukewarm water. Use morning and evening as the first step of your routine.',
      step: 'cleanser',
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
