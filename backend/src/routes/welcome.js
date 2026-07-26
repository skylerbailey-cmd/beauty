'use strict';

const express = require('express');

const router = express.Router();
const pgDb = require('../db/postgres');

// ─── Product catalog (hardcoded with usage instructions) ────────────────────

const PRODUCTS = {
  avologi: [
    {
      id: 'avologi-lumnen',
      name: 'LUMNEN',
      brand: 'Avologi',
      retailPrice: 18750,
      description: 'The world\'s first FDA-certified home-use bio-stimulator laser system designed to support facial volume, firmness, and skin vitality. Recognized with the 2026 Global Recognition Award. Combines LED light therapy with advanced laser-based bio-stimulation developed by Prof. Barry Barish, Nobel Prize-winning physicist. Targets facial volume loss, sagging, dullness, and wrinkles by stimulating collagen and hyaluronic acid production at the base layer of the dermis.',
      benefits: 'FDA-certified bio-stimulator laser, 98% product satisfaction, 96% noticeable wrinkle/scar reduction, increases facial volume naturally, non-invasive at-home use, suitable for all skin types, 100x stronger than LED therapy yet painless, compatible with any skincare, limited lifetime warranty',
      ingredients: '',
      howToUse: 'Cleanse skin and remove all makeup, oils, and impurities; dry skin. Apply device with mild pressure, gliding continuously in small V-shaped motions from bottom to top. Treat each area for 3 minutes. Apply moisturizer after each session. Use daily for first 8 weeks, then 3 times per week.',
      step: 'device treatment',
      image: 'https://avologi.com/wp-content/uploads/2024/03/Avologi-lumen-548x731-BG-1.jpg',
      url: 'https://avologi.com/product/lumnen/',
    },
    {
      id: 'avologi-eneo-totale',
      name: 'Eneo Totalé',
      brand: 'Avologi',
      retailPrice: 11950,
      description: 'Introducing the latest innovation in personalized anti-aging skin rejuvenation solutions; ENEO TOTALÉ. TOTALÉ is a dermatology-recommended, clinically tested, FDA-certified 510K medical device. TOTALÉ delivers a tailor-made anti-aging ritual that reveals smoother, more radiant-looking skin. Made with innovative anti-aging technology developed by a Nobel prize-winning scientist. The second-generation skin rejuvenation device is designed to deliver the most luxurious and personalized experience yet.',
      benefits: 'FDA-cleared skin rejuvenation, visible wrinkle reduction, smoother skin, enhances existing skincare routine, safe for home use, one-time investment vs repeated clinic appointments, improvement in tone/firmness/wrinkles, more radiant appearance over time, trusted in professional skincare environments worldwide',
      ingredients: '',
      howToUse: 'Apply serum or face oil to skin. Use 3–5 times per week. Glide the device over areas of concern for 5–10 minutes per area. Use on face, neck, and body. Consistent use produces cumulative improvement.',
      step: 'device treatment',
      image: 'https://avologi.com/wp-content/uploads/2018/07/Eneo-Total-AV19-1.jpg',
      url: 'https://avologi.com/product/eneo-totale/',
    },
    {
      id: 'avologi-eneo-totale-blu',
      name: 'Eneo Totalé Blu',
      brand: 'Avologi',
      retailPrice: 11950,
      description: 'A professional, FDA certified hand-held medical device that utilizes a combined 415 nm wavelength within the blue light spectrum — the most effectively absorbed wavelength for skin imperfections and acne treatments. Features a hypoallergenic, medical-grade metal applicator tip that can be used with any skincare. Clinically tested, safe, zero side effects, dermatologist recommended, suitable for all skin types and tones.',
      benefits: 'FDA certified, blue light phototherapy (415 nm), targets acne and skin imperfections, non-invasive, pain-free 4–6 minute sessions, no chemicals required, hypoallergenic tip, compatible with all skincare, suitable for all skin types, lifetime warranty',
      ingredients: '',
      howToUse: 'Use the device on clean skin for 4–6 minute sessions. Glide the hypoallergenic tip over areas with acne or skin imperfections. Can be used with any skincare product. For enhanced results, follow with red light therapy. Visible improvement may be noticed after the first session.',
      step: 'device treatment',
      image: 'https://avologi.com/wp-content/uploads/2022/12/Eneo-Total-Blu-AV20-3-2.jpg',
      url: 'https://avologi.com/product/eneo-totale-blu/',
    },
    {
      id: 'avologi-eneo-blu',
      name: 'Eneo Blu',
      brand: 'Avologi',
      retailPrice: 7050,
      description: 'An advanced, handheld device that utilizes blue light spectrum (415 nm) — the most effectively absorbed wavelength for acne treatments. Clinically tested, FDA-approved technology that targets acne-causing bacteria with zero side effects, no chemicals, and no allergies. ENEO BLU comes with a limited lifetime warranty and is recommended for all skin types and tones.',
      benefits: 'FDA approved blue light technology, pain free sessions, suitable for all skin types and tones, eliminates acne-causing bacteria (P.acne), detoxifies skin from bacteria and oil residues, effective for facial, back, and body acne, 4–6 minute sessions, immediate results, limited lifetime warranty, no harsh creams or chemicals needed',
      ingredients: '',
      howToUse: 'Use the device in 4–6 minute sessions. Apply to areas of concern. Can be used daily. Results may be visible after one session — skin may feel smoother and look more radiant. For best results, combine with red/infrared light therapy.',
      step: 'device treatment',
      image: 'https://avologi.com/wp-content/uploads/2018/08/Eneo-Blu-AV182.jpg',
      url: 'https://avologi.com/product/eneo-blu/',
    },
  ],
  hydrasphere: [
    {
      id: 'hydrasphere-advanced-foaming-cleanser',
      name: 'Advanced Foaming Cleanser',
      brand: 'HydraSphere Plus',
      retailPrice: 249,
      description: 'Elevate Your Cleansing Ritual with Hydrasphere\'s Advanced Foaming Cleanser – Where Luxury Meets Cleansing Excellence. Our alcohol-free foaming cleanser is more than just a face wash; it\'s a transformative conditioner for your skin. Expertly crafted to prepare your canvas, it paves the way for your skin to absorb the full benefits of subsequent moisturizing. Experience the magic of retexturing and light exfoliation as it gently unveils softer, smoother, and more radiant skin.',
      benefits: 'Alcohol-free, retexturing, light exfoliation, prepares skin for moisturizing, hemp extract-powered, suitable for sensitive skin',
      ingredients: 'Aqua (Water), Sodium Laurylglucosides Hydroxypropylsulfonate, Lauramidopropyl Betaine 30, Disodium Laureth Sulfosuccinate, Sodium Methyl Oleoyl Taurate, Glycerin- Apple, Seppic Proteol APL EF, Hemp Extract, Perfluorodecalin, Azelamidopropyl Dimethyl Amine, Butylene Glyco, Kathon CG, Fragrance.',
      howToUse: 'Massage cleanser into the skin in a gentle circular motion. Rinse with warm water. For best results, use Hydrasphere+ Deep Moisturizing Cream.',
      step: 'AM Routine',
      image: 'https://hydrasphereplus.com/wp-content/uploads/2023/10/1-2.png',
      url: 'https://hydrasphereplus.com/product/advanced-foaming-cleanser/',
    },
    {
      id: 'hydrasphere-hydra-toning-solution',
      name: 'Hydra Toning Solution',
      brand: 'HydraSphere Plus',
      retailPrice: 250,
      description: 'Refresh and balance your skin with our revitalizing toner. Our Hydra Toning Solution is formulated to provide a refreshing and invigorating experience for your skin, helping to restore its natural pH balance and prepare it to absorb the benefits of subsequent skincare products.',
      benefits: 'Balances skin pH, refines and minimizes pores, preps skin to better absorb serums and moisturizers, refreshes and invigorates.',
      ingredients: '',
      howToUse: 'Use after cleansing. Apply with a cotton ball and smooth over the face, neck, and decollete. Use daily.',
      step: 'toner',
      image: 'https://hydrasphereplus.com/wp-content/uploads/2024/02/25-1024x1024.png',
      url: 'https://hydrasphereplus.com/product/hydra-toning-solution/',
    },
    {
      id: 'hydrasphere-vitamin-c-serum',
      name: 'Vitamin C Serum',
      brand: 'HydraSphere Plus',
      retailPrice: 800,
      description: 'Plump up the skin with our Vitamin C Serum. This concentrated serum is packed with powerful anti-aging ingredients, including Vitamin C, to help diminish the appearance of fine lines and wrinkles. It is the perfect addition to your skincare routine as its lightweight texture makes it easy to incorporate into your daily regimen. Its potent formula penetrates deep into the skin, promoting collagen production and improving skin texture. When you use our Vitamin C Serum regularly, you can expect to see a noticeable improvement in the overall appearance of your skin. Its powerful anti-aging benefits make it a must-have for anyone concerned about maintaining a youthful, radiant look!',
      benefits: 'Brightens skin, fades dark spots, evens skin tone, antioxidant protection, promotes collagen production, reduces fine lines, improves skin texture.',
      ingredients: 'Water(Aqua), Ascorbic Acid(Vitamin C), Collagen, Glycerin, Macrocystis Pyrifera(Kelp)Extract (Organic), Propylene Glycol, Algae, Proline, Acetyl Hexapeptide-3, Sodium Hyaluronate, Sodium Ascorbyl Phosphate, Tocopheryl Acetate, Retinyl Palmitate, Aloe Barbadensis(Aloe Vera)Leaf Juice (Organic), Chamomilla Recutita(Chamomile)Flower Extract (Organic), Carbomer, Triethanolamine, Ethylhexylglycerin, Phenoxyethanol',
      howToUse: 'After cleansing your skin, apply several drops over your face and neck, avoiding the eye area. Gently massage in an upward and outward motion until fully absorbed. Use alone or before applying moisturizer.',
      step: 'AM Routine',
      image: 'https://hydrasphereplus.com/wp-content/uploads/2024/02/73.png',
      url: 'https://hydrasphereplus.com/product/vitamin-c-serum/',
    },
    {
      id: 'hydrasphere-mineralift-thermal-serum',
      name: 'MineralLift Thermal Serum',
      brand: 'HydraSphere Plus',
      retailPrice: 1700,
      description: 'Scientific studies have confirmed the efficacy of our MineralLife Thermal Serum in promoting a firmer, more lifted appearance. The carefully selected ingredients penetrate deeply into the skin, helping to stimulate collagen production and enhance elasticity. As a result, your skin feels visibly tighter and more toned, promoting a youthful and rejuvenated look. As our MineralLift Thermal Serum penetrates the skin, it works to revitalize and reinvigorate from within. The carefully selected blend of potent ingredients targets fine lines, wrinkles, and sagging skin, effectively addressing the signs of aging.',
      benefits: 'Firms and lifts skin, stimulates collagen production, enhances elasticity, visibly reduces fine lines, wrinkles, and sagging. Detoxifies and tightens skin.',
      ingredients: 'Water(Aqua), Collagen, Glycerin, Macrocystis Pyrifera (Kelp) Extract (Organic), Propylene Glycol, Algae, Squalane, Acetyl Hexapeptide-3, Hyaluronic Acid, Allantoin, Tocopheryl Acetate, Retinyl Palmitate, Ascorbic Acid (Vitamin C), Aloe Barbadensis (Aloe Vera) Leaf Juice (Organic), Vanillyl Butyl Ether, Chamomilla Recutita (Chamomile) Flower Extract (Organic), Carbomer, Triethanolamine, Ethylhexylglycerin, Phenoxyethanol',
      howToUse: 'After cleansing your skin, apply several drops over your face and neck, avoiding the eye area. Gently massage in an upward and outward motion until fully absorbed. Use alone or before applying moisturizer. Use daily, morning and night. Apply 1-3 pumps to a cleansed face and eye area. Spread a thin veil over the skin, blending in small circles with a gentle tapping motion until the product disappears into the skin.',
      step: 'AM Routine',
      image: 'https://hydrasphereplus.com/wp-content/uploads/2024/02/59.png',
      url: 'https://hydrasphereplus.com/product/minerallift-thermal-serum/',
    },
    {
      id: 'hydrasphere-deep-moisturizing-cream',
      name: 'Deep Moisturizing Cream',
      brand: 'HydraSphere Plus',
      retailPrice: 349,
      description: 'Experience the transformative synergy of botanical wonders and cutting-edge science. Our Deep Moisturizing Cream offers more than just hydration; it\'s a firming elixir for your facial tissue and neck, imbued with the essence of nature\'s most potent moisturizers. Each ingredient is carefully selected for its ability to deeply nourish and firm the skin, providing a rich, luxurious experience that goes beyond mere moisturization.',
      benefits: 'Deep hydration and firming, nourishes facial tissue and neck, strengthens skin barrier, suitable for face, neck, and under-eye area.',
      ingredients: '',
      howToUse: 'Apply generously to the face, neck, and delicate under-eye area. For best results, use the HydraSphere+ Active Foaming Cleanser.',
      step: 'moisturizer',
      image: 'https://hydrasphereplus.com/wp-content/uploads/2023/10/13-1-1024x1024.png',
      url: 'https://hydrasphereplus.com/product/deep-moisturizing-cream/',
    },
    {
      id: 'hydrasphere-mineralift-thermal-cream',
      name: 'MineralLift Thermal Cream',
      brand: 'HydraSphere Plus',
      retailPrice: 1600,
      description: 'Our carefully formulated MineralLife Thermal Cream has been scientifically proven to promote a firmer, more lifted appearance for your skin. The carefully selected ingredients penetrate deeply into the skin, helping to stimulate collagen production and enhance elasticity for tighter and more toned skin, promoting a youthful and rejuvenated look. The end result that you\'ll love! When applied to the skin, the MineralLift Thermal Cream has a luxurious texture that glides on smoothly and is quickly absorbed, leaving no greasy residue.',
      benefits: 'Firms and lifts skin, stimulates collagen production, enhances elasticity, tighter and more toned skin, promotes youthful and rejuvenated appearance.',
      ingredients: 'Water(Aqua), Caprylic/Capric Triglyceride, Glycerin, Simmondsia Chinensis(Jojoba)Seed Oil, Collagen, Stearic Acid, Cetyl Alcohol, Algae, Squalane, Allantoin, Acetyl Hexapeptide-3, Euterpe Oleracea(Acai)Fruit Oil, Ascorbic Acid(Vitamin C), Aloe Barbadensis(Aloe Vera)Leaf Juice(Organic), Chamomilla Recutita(Chamomile)Flower Extract(Organic), Hyaluronic Acid, Sorbitan Stearate, PEG-100 Stearate, Glyceryl Stearate, Tocopheryl Acetate(Vitamin E), Retinyl Palmitate(Vitamin A), Carbomer, Triethanolamine, Ethylhexylglycerin, Phenoxyethanol',
      howToUse: 'Apply Smooth MineralLift Thermal Cream thoroughly over the face and neck, avoiding the eye area. Gently massage until fully absorbed.',
      step: 'PM Routine',
      image: 'https://hydrasphereplus.com/wp-content/uploads/2024/02/51.png',
      url: 'https://hydrasphereplus.com/product/minerallift-thermal-cream/',
    },
    {
      id: 'hydrasphere-anti-wrinkle-30g',
      name: 'Anti Wrinkle Correction & Prevention 30g',
      brand: 'HydraSphere Plus',
      retailPrice: 1895,
      description: 'A clinically advanced cream designed to visibly reduce deep lines, fine lines, puffiness, and dark circles. Powered by Hyaluronic Acid, Retinol, Stem Cells, and Peptides — this high-performance formula supports firmer, smoother, and more youthful-looking skin.',
      benefits: 'Visibly reduces deep lines and fine lines, diminishes puffiness and dark circles, firms and smooths skin, supports a more youthful appearance.',
      ingredients: 'Hyaluronic Acid, Retinol, Stem Cells, Peptides.',
      howToUse: 'Apply directly to deep facial lines and wrinkles in the targeted area. Avoid direct contact with the eyes. In case of excess product, gently remove with a cotton swab.',
      step: 'treatment cream',
      image: 'https://hydrasphereplus.com/wp-content/uploads/2025/06/87-1024x1024.png',
      url: 'https://hydrasphereplus.com/product/anti-wrinkle-correction-prevention-30g/',
    },
    {
      id: 'hydrasphere-anti-wrinkle-15g',
      name: 'Anti Wrinkle Correction & Prevention 15g',
      brand: 'HydraSphere Plus',
      retailPrice: 1395,
      description: 'The travel-size version of the Anti Wrinkle Correction & Prevention cream — same clinically advanced formula with Hyaluronic Acid, Retinol, Stem Cells, and Peptides in a convenient smaller size.',
      benefits: 'Visibly reduces deep lines and fine lines, diminishes puffiness and dark circles, firms and smooths skin, supports a more youthful appearance.',
      ingredients: 'Hyaluronic Acid, Retinol, Stem Cells, Peptides.',
      howToUse: 'Apply directly to deep facial lines and wrinkles in the targeted area. Avoid direct contact with the eyes. In case of excess product, gently remove with a cotton swab.',
      step: 'treatment cream',
      image: 'https://hydrasphereplus.com/wp-content/uploads/2025/06/82-1024x1024.png',
      url: 'https://hydrasphereplus.com/product/anti-wrinkle-correction-prevention-15g/',
    },
    {
      id: 'hydrasphere-oxygen-brightening-cream',
      name: 'Oxygen Brightening Cream',
      brand: 'HydraSphere Plus',
      retailPrice: 800,
      description: 'The ultimate moisturizing and texturizing treatment for your skin. This innovative cream is designed to deeply hydrate and nourish your skin, while also brightening and improving its texture. With the power of oxygen-infused ingredients, it helps promote a radiant and youthful complexion. Say goodbye to dull, dry skin and hello to a revitalized and luminous glow.',
      benefits: 'Deep hydration, brightening, texture improvement, nourishing, promotes radiant and youthful complexion, oxygen-infused.',
      ingredients: 'Hyaluronic Acid.',
      howToUse: 'Apply daily, in the morning and evening on clean skin. Gently smooth the cream from the center outward over your face. Apply an additional pearl-size amount to your neck and sweep the cream upward to your jawline.',
      step: 'moisturizer',
      image: 'https://cdn.shopify.com/s/files/1/0742/9554/1952/files/65.png',
      url: 'https://hydrasphereplus.com/product/oxygen-brightening-cream/',
    },
    {
      id: 'hydrasphere-spf50-shield-cream',
      name: 'SPF 50 Shield Cream',
      brand: 'HydraSphere Plus',
      retailPrice: 849,
      description: 'Protect and perfect your skin with the SPF 50 Shield Cream, a lightweight mineral sunscreen offering advanced broad-spectrum defense against UVA and UVB rays. Formulated with non-nano Zinc Oxide and Titanium Dioxide, it provides powerful daily protection without clogging pores or leaving a white cast.',
      benefits: 'Broad-spectrum UVA/UVB protection (PA++++), non-comedogenic, non-greasy, brightens with Niacinamide, lasting hydration, antioxidant protection, dermatologist-tested',
      ingredients: 'Water, Ethylhexyl Palmitate, Cetyl Ethylhexanoate, Titanium Dioxide, Zinc Oxide (Non-Nano), Tinosorb S (Bis-Ethylhexyloxyphenol Methoxyphenyl Triazine), Butyloctyl Salicylate, Pentaerythrityl Tetraethylhexanoate, Potassium Cetyl Phosphate, Cetearyl Alcohol, Hemisqualane, Silica, Glyceryl Stearate, Sodium PCA, Panthenol, Niacinamide, Ascorbyl Glucoside, Sodium Hyaluronate, Acetylated Hyaluronic Acid, Polypodium Leucotomos Extract, Green Tea Extract, Fullerene, Collagen Peptide, Pro-Xylane, Tri(Cetearyl-4) Phosphate, Aluminum Hydroxide, Stearic Acid, Tocopheryl Acetate, Natural Bisabolol.',
      howToUse: 'Apply generously to clean, dry skin as the final step in your skincare routine. Use at least 15 minutes before sun exposure. Reapply every 2 hours or after swimming, sweating, or towel drying.',
      step: 'AM Routine',
      image: 'https://hydrasphereplus.com/wp-content/uploads/2025/11/77-1.png',
      url: 'https://hydrasphereplus.com/product/spf-50-shield-cream/',
    },
    {
      id: 'hydrasphere-facial-peeling-gel',
      name: 'Facial Peeling Gel',
      brand: 'HydraSphere Plus',
      retailPrice: 349,
      description: 'A revolutionary exfoliating formula that gently eliminates dead skin cells while addressing sunspots, pigmentation, age spots, acne, discoloration, redness, and rosacea. Powered by mandelic acid (a gentle AHA) with Vitamin C, Vitamin E, Vitamin A, Grapefruit Extract, Avocado Oil, and Centella Asiatica.',
      benefits: 'Eliminates dead skin cells, addresses sunspots, pigmentation, age spots, acne, discoloration, redness, and rosacea. Brightens and smooths skin texture.',
      ingredients: 'Mandelic Acid (AHA), Vitamin C, Vitamin E, Vitamin A, Grapefruit Extract, Avocado Oil, Centella Asiatica.',
      howToUse: 'Apply a thin layer to dry skin. Massage in circular motions until dry. Wash with warm water. Use 1–2 times a week. For optimal results, pair with the HydraSphere+ Deep Moisturizing Cream.',
      step: 'exfoliant',
      image: 'https://hydrasphereplus.com/wp-content/uploads/2023/10/21-1024x1024.png',
      url: 'https://hydrasphereplus.com/product/facial-peeling-gel/',
    },
    {
      id: 'hydrasphere-mineralift-thermal-mask',
      name: 'MineralLift Thermal Mask',
      brand: 'HydraSphere Plus',
      retailPrice: 2200,
      description: 'Our MineralLift Thermal Mask, enhanced with the goodness of mineral water, takes your skincare routine to new heights by providing a multifaceted approach to facial rejuvenation. The gentle warmth generated by the mask activates and stimulates your facial muscles, promoting increased blood circulation and muscle toning.',
      benefits: 'Detoxifies and firms skin, stimulates facial muscles, promotes blood circulation and muscle toning, rejuvenates. Enhanced with mineral water.',
      ingredients: '',
      howToUse: 'Thoroughly cleanse your face. Apply a thin layer to wet skin by gently massaging the chin, nose, forehead, and cheeks in a circular motion, avoiding the eye area. You will experience a warming sensation in treated areas, which is normal. Wet again to accelerate the heating process. Leave the mask on for three minutes. Rinse with warm water. Use once a month.',
      frequency: '1/month',
      step: 'mask',
      image: 'https://hydrasphereplus.com/wp-content/uploads/2024/02/55-1024x1024.png',
      url: 'https://hydrasphereplus.com/product/minerallift-thermal-mask/',
    },
    {
      id: 'hydrasphere-hydrocharcoal-silk-mask',
      name: 'HydroCharcoal Silk Mask',
      brand: 'HydraSphere Plus',
      retailPrice: 1790,
      description: 'Experience the purifying power of the HydroCharcoal Silk Mask, a luxurious leave-on treatment developed with bioengineered delivery systems to detoxify, renew, and deeply hydrate. This advanced formula merges activated charcoal microparticles with encapsulated hyaluronic acid and signal peptides, targeting visible signs of aging at the surface level. The result is instantly smoother texture, refined pores, and a radiant, balanced glow.',
      benefits: 'Detoxifies pores, deeply hydrates, refines pores, smooths texture, anti-aging, leave-on treatment',
      ingredients: 'Polysilicone-11, Aqua (Water), Cyclopentasiloxane, Polymethylsilsesquioxane, Glycerin, Betaine, Sodium Benzoate, Xanthan Gum, Jojoba Oil, Laureth-7, Cetearyl Olivate, Squalane, Ethylhexylglycerin, Butyrospermum Parkii (Shea) Butter, Arbutin, Acetyl Hexapeptide-8, Sodium Hyaluronate, Bakuchiol, Charcoal, Tocopheryl Acetate (Vitamin E), Centella Asiatica Extract, Onopordum Acanthium Flower/Leaf/Stem Extract, Aloe Barbadensis Leaf Extract, Camellia Sinensis (Green Tea) Leaf Extract, Chamomilla Recutita (Matricaria) Flower Extract, Glycyrrhiza Glabra (Licorice) Root Extract, Rosmarinus Officinalis (Rosemary) Leaf Extract, Aristotelia Chilensis (Maqui) Fruit Extract, Aronia Melanocarpa (Chokeberry) Fruit Extract, Euterpe Oleracea (Acai Berry) Fruit Extract, Garcinia Mangostana (Mangosteen) Fruit Extract, Lycium Barbarum (Goji Berry) Fruit Extract, Morinda Citrifolia (Noni) Fruit Extract, Punica Granatum (Pomegranate) Fruit Extract, Vaccinium Myrtillus (Bilberry) Fruit Extract, Soluble Collagen, Caffeine.',
      howToUse: 'Apply a thin, even layer to clean, dry skin. Focus on areas with fine lines or visible pores. Gently pat and smooth until fully absorbed. Do not rinse. Use once or twice a week or before special occasions. For best results, apply before using your laser device.',
      frequency: '1-2x/week',
      step: 'weekly-mask',
      image: 'https://hydrasphereplus.com/wp-content/uploads/2025/11/14-scaled.png',
      url: 'https://hydrasphereplus.com/product/hydrocharcoal-silk-mask/',
    },
    {
      id: 'hydrasphere-hydrocharcoal-collagen-neck-mask',
      name: 'HydroCharcoal Collagen Neck & Décolleté Mask',
      brand: 'HydraSphere Plus',
      retailPrice: 5000,
      description: 'A targeted mask formulated specifically for the neck and chest area, combining activated charcoal and soluble collagen with Sodium Hyaluronate, Retinyl Palmitate, and Allantoin. Delivers lifting, firming, and deep hydration to one of the most neglected areas in skincare, visibly reducing neck lines, breast wrinkles, and pigmentation.',
      benefits: 'Addresses neck lines and stretch marks, reduces breast wrinkles and fine lines, minimizes pigmentation and brown spots, provides lifting and firming, protects against sun damage, enhances smoothness and elasticity.',
      ingredients: 'Soluble Collagen, Activated Charcoal, Sodium Hyaluronate, Retinyl Palmitate, Allantoin, Chondrus Crispus (Carrageenan).',
      howToUse: 'Apply to clean, dry skin on neck and chest area. Leave on for 10 minutes or longer as desired. Remove mask and gently pat remaining emulsion into skin. No rinsing required. Use weekly or as needed.',
      step: 'mask',
      image: 'https://hydrasphereplus.com/wp-content/uploads/2024/02/37.png',
      url: 'https://hydrasphereplus.com/product/hydrocharcoal-collagen-neck-and-decollete-mask/',
    },
    {
      id: 'hydrasphere-advanced-night-repair',
      name: 'Advanced Night Repair',
      brand: 'HydraSphere Plus',
      retailPrice: 325,
      description: 'An intensive night cream that targets signs of aging while you sleep. Formulated with Collagen, Hyaluronic Acid, Acetyl Hexapeptide-3, and a blend of nourishing oils including Sweet Almond, Jojoba, and Acai — it delivers deep hydration and repair to diminish fine lines, wrinkles, and visible aging markers for a smoother, firmer, more radiant complexion by morning.',
      benefits: 'Reduces fine lines and wrinkles, deep overnight hydration and repair, promotes smoother and firmer complexion, revitalizes and refreshes skin.',
      ingredients: 'Water, Sweet Almond Oil, Glycerin, Jojoba Seed Oil, Collagen, Stearic Acid, Cetyl Alcohol, Algae, Tocopheryl Acetate (Vitamin E), Ascorbic Acid (Vitamin C), Acetyl Hexapeptide-3, Euterpe Oleracea (Acai) Fruit Oil, Aloe Barbadensis (Aloe Vera) Leaf Juice, Chamomilla Recutita (Chamomile) Flower Extract, Hyaluronic Acid, Ethylhexylglycerin, Phenoxyethanol.',
      howToUse: 'Apply a thin layer to clean, dry facial and neck skin before bedtime. Massage in small upward circles over the face and neck. Allow full absorption before sleep. Use 1–2 times weekly for optimal results.',
      step: 'PM Routine',
      image: 'https://hydrasphereplus.com/wp-content/uploads/2024/02/5-9-600x600.png',
      url: 'https://hydrasphereplus.com/product/advanced-night-repair/',
    },
    {
      id: 'hydrasphere-advanced-eye-lifting-serum',
      name: 'Advanced Eye Lifting Serum',
      brand: 'HydraSphere Plus',
      retailPrice: 649,
      description: 'A lightweight, all-natural serum formulated specifically for the delicate eye area. Combines Collagen, Caviar Extract, and Acetyl Hexapeptide-3 with Hyaluronic Acid and Vitamins A, C, and E to reduce fine lines, minimize puffiness and under-eye bags, diminish dark circles, and improve elasticity around the eyes.',
      benefits: 'Reduces fine lines and wrinkles around eyes, minimizes under-eye bags and puffiness, diminishes dark circles, improves skin elasticity and firmness, hydrates the eye contour.',
      ingredients: 'Collagen, Glycerin, Macrocystis Pyrifera (Kelp) Extract, Sodium Hyaluronate, Acetyl Hexapeptide-3, Retinyl Palmitate (Vitamin A), Ascorbic Acid (Vitamin C), Tocopheryl Acetate (Vitamin E), Aloe Barbadensis (Aloe Vera) Leaf Juice, Caviar Extract, Chamomilla Recutita (Chamomile) Flower Extract, Euterpe Oleracea (Acai) Fruit Oil.',
      howToUse: 'Apply 1–3 pumps daily, morning and night, to cleansed skin around the eye area. Spread a thin veil over the skin, blending in small circles with a gentle tapping motion until the product disappears.',
      step: 'AM Routine',
      image: 'https://hydrasphereplus.com/wp-content/uploads/2023/10/17-600x600.png',
      url: 'https://hydrasphereplus.com/product/advanced-eye-lifting-serum/',
    },
  ],
  avinichi: [
    {
      id: 'avinichi-phyto-thermal-collection',
      name: 'Phyto Thermal Collection',
      brand: 'Avinichi',
      retailPrice: 5000,
      description: 'A luxurious 3-piece collection including the Phyto Remedy Thermal Mask (self-heating, reduces fine lines, wrinkles, and dark spots with a vitamin-rich formula), the Hydrating Antioxidant Serum (feather-light blend of fruit and berry extracts, peptides, and humectants for plump, hydrated skin), and the Mulberr-E Moisture Infusion Cream (vitamin E and fruit extracts for lifting, firming, and redefining the complexion). Includes a jade roller for enhanced product absorption.',
      benefits: 'Self-heating thermal mask, reduces fine lines and wrinkles, brightens dark spots, deep hydration with peptides and hyaluronic acid, lifts and firms with vitamin E and fruit extracts, includes jade roller for lymphatic drainage and absorption',
      ingredients: 'Phyto Remedy Thermal Mask – PEG-8, Zeolite, Kaolin, Methyl Gluceth-20, Retinyl Palmitate, Ascorbic Acid, Tocopheryl Acetate, Organic Arnica Montana Flower Extract, Organic Aloe Barbadensis Leaf Extract, Organic Prunus Amygdalus Dulcis Seed Extract, Organic Coffee Arabica Seed Extract, Organic Citrus Limon Fruit Extract, Organic Angelica Archangelica Root Extract, Ganoderma Lucidum (Mushroom) Extract, Phenoxyethanol, Ethylhexylglycerin, Mica, Titanium Dioxide CI-77891, Iron Oxide CI-77499.',
      howToUse: 'Apply the Phyto Remedy Thermal Mask to cleansed skin. Gently massage onto the face in a circular motion. To intensify heating treatment, massage 2-3 drops of the Hydrating Antioxidant Serum over the mask. Allow the mask to rest for 10-15 minutes, then rinse with warm water. Apply the Mulberr-E Moisture Infusion Cream evenly to the face after. Massage gently into skin.',
      step: 'treatment',
      frequency: '1x/month',
      image: 'https://www.avinichi.com/wp-content/uploads/Phyto-Thermal-Collection-1.png',
      url: 'https://www.avinichi.com/product/phyto-thermal-collection/',
    },
    {
      id: 'avinichi-liquid-lift-overnight-melting-mask',
      name: 'Liquid Lift Overnight Melting Mask',
      brand: 'Avinichi',
      retailPrice: 1800,
      description: 'Transform the look of your skin overnight with the Liquid Lift Overnight Melting Mask. This moisture mask delivers a concentrated cocktail of superfruit extracts, vitamins, and peptides to target the appearance of dullness, dryness, and an uneven skin texture. Wake up to skin that feels deeply restored and rehydrated!',
      benefits: 'Overnight hydration, reduces fine lines, melting formula with superfruit extracts and peptides, lifts and tightens, refines and resurfaces, brightens and hydrates',
      ingredients: 'Aqua, Caprylyl Methicone, PEG-12 Dimethicone/PPG Crosspolymer, Glycerin, Caprylic/Capric Triglyceride, Onopordum Acanthium Flower Leaf/Stem Extract, Acetyl Hexapeptide-8, Sodium Hyaluronate, Squalane, Morus Nigra Fruit Extract, Retinyl Palmitate, Tocopheryl Acetate, Organic Lavandula Angustifolia Flower Extract, Organic Chamomilla Recutita Flower Extract, Organic Aloe Barbadensis Leaf Extract, Vaccinium Myrtillus Fruit Extract, Euterpe Oleracea Fruit Extract, Lycium Barbarum Extract, Aristotelia Chilensis Fruit Extract, Aronia Melanocarpa Fruit Extract, Garcinia Mongostana Fruit Extract, Punica Granatum Fruit Extract.',
      howToUse: 'Apply a thin layer evenly on skin and leave on for ten minutes. Gently massage into skin and watch droplets form on the surface. Let the droplets disappear. Don\'t wash off. Use this overnight mask weekly.',
      step: 'mask',
      image: 'https://www.avinichi.com/wp-content/uploads/Liquid-Lift-Overnight-Melting-Mask-1.png',
      url: 'https://www.avinichi.com/product/liquid-lift-overnight-melting-mask/',
    },
    {
      id: 'avinichi-hydrating-multifruit-c-serum',
      name: 'Hydrating Multifruit C-Serum',
      brand: 'Avinichi',
      retailPrice: 600,
      description: 'A must-have vitamin C serum that leaves your skin looking and feeling brighter and tighter. Infused with two potent forms of vitamin C plus mulberry extract to target the appearance of wrinkles, along with multiple vitamins and antioxidants to promote a complexion that glows from within.',
      benefits: 'Brightens and tightens, two potent forms of vitamin C, mulberry extract targets wrinkles, multiple vitamins and antioxidants, promotes glowing complexion, hydrates and lifts',
      ingredients: 'Cyclopentasiloxane, Cyclotetrasiloxane, Dimethiconol, Isopropyl Palmitate, Glyceryl Dibehenate, Tribehenin, Glyceryl Behenate, Tetrahexyldecyl Ascorbate (Vitamin C), Ascorbyl Palmitate (Vitamin C), Retinyl Palmitate, Tocopheryl Acetate, Organic Simmondsia Chinensis Seed Oil, Organic Persea Gratissima Oil, Organic Olea Europaea Fruit Oil, Organic Cocos Nucifera Oil, Morus Nigra Fruit Extract.',
      howToUse: 'After cleansing, massage onto face & neck using gentle upward motions. Once fully absorbed, follow with your moisturizer. Use at night.',
      step: 'PM Routine',
      image: 'https://www.avinichi.com/wp-content/uploads/Hydrating-Multifruit-C-Serum-1.png',
      url: 'https://www.avinichi.com/product/hydrating-multifruit-c-serum/',
    },
    {
      id: 'avinichi-noni-morning-glow',
      name: 'Noni Morning Glow',
      brand: 'Avinichi',
      retailPrice: 350,
      description: 'A go-to day cream infused with vitamins, antioxidants, and Noni. This daytime moisturizer leaves skin feeling firmer and smoother after each use. Its lightweight, fast-absorbing, non-greasy formula deeply hydrates throughout the day and makes an excellent base for makeup.',
      benefits: 'Lightweight daytime moisturizer, infused with vitamins, antioxidants, and Noni, firms and smooths skin, fast-absorbing and non-greasy, hydrates all day, makes a great makeup base',
      ingredients: 'Aqua, Glycerin, Propylene Glycol, Carthamus Tinctorius Seed Oil, Isopropyl Palmitate, Caprylic/Capric Triglyceride, PEG-100 Stearate, Glyceryl Stearate, Cetearyl Alcohol, Cetearyl Glucoside, Dimethicone, Butyrospermum Parkii, Tocopheryl Acetate, Retinyl Palmitate, Morinda Citrifolia (Noni) Fruit Extract.',
      howToUse: 'After cleansing, massage moisturizer over the entire face and neck. Use daily, in the morning.',
      step: 'moisturizer',
      image: 'https://www.avinichi.com/wp-content/uploads/Noni-Morning-Glow-1.png',
      url: 'https://www.avinichi.com/product/noni-morning-glow/',
    },
    {
      id: 'avinichi-noni-mousse-cleanser',
      name: 'Noni Mousse Cleanser',
      brand: 'Avinichi',
      retailPrice: 250,
      description: 'The perfect start to every skincare routine. Formulated with gentle, coconut-derived cleansing agents and infused with plant extracts and Noni, this lush cleanser removes dirt, makeup, and impurities while giving your skin a fresh and radiant finish.',
      benefits: 'Daily cleanser, removes dirt and makeup, gentle coconut-derived cleansing agents, plant extracts and Noni, fresh and radiant finish, suitable for sensitive skin',
      ingredients: 'Aqua, Sodium Cocoyl Isethionate, Sodium Methyl Cocoyl Taurate, Sodium Lauroyl Methyl Isethionate, Glycol Distearate, PEG-120 Methyl Glucose Dioleate, Cocamidopropyl Betaine, Glycerin, Morinda Citrifolia (Noni) Fruit Extract.',
      howToUse: 'Gently lather a small amount of mousse in hands and then apply to damp face. Rinse thoroughly with water.',
      step: 'cleanser',
      image: 'https://www.avinichi.com/wp-content/uploads/Noni-Mousse-Cleanser-1.png',
      url: 'https://www.avinichi.com/product/noni-mousse-cleanser/',
    },
    {
      id: 'avinichi-noni-pore-purifying-toner',
      name: 'Noni Pore Purifying Toner',
      brand: 'Avinichi',
      retailPrice: 250,
      description: 'An alcohol-free toner packed with plant extracts and Noni. Designed to remove traces of oil, dirt, and impurities, leaving skin perfectly prepped for the next step of your skincare routine.',
      benefits: 'Alcohol-free toner, removes traces of oil and dirt, packed with plant extracts and Noni, preps skin for next skincare step, suitable for daily use',
      ingredients: 'Aqua, Aloe Barbadensis Leaf Juice, Cucumis Sativus Fruit Extract, Chamomilla Recutita Flower/Leaf Extract, Polysorbate-20, Pentylene Glycol, Propanediol, Sodium PCA, Morinda Citrifolia (Noni) Fruit Extract, Allantoin, Citric Acid.',
      howToUse: 'Apply after cleansing with a cotton ball or pad. Can be used morning or night daily.',
      step: 'toner',
      image: 'https://www.avinichi.com/wp-content/uploads/Noni-Pore-Purifying-Toner-1.png',
      url: 'https://www.avinichi.com/product/noni-pore-purifying-toner/',
    },
    {
      id: 'avinichi-eye-rescue-phyto-serum',
      name: 'Eye Rescue Phyto-Serum',
      brand: 'Avinichi',
      retailPrice: 600,
      description: 'Featuring a botanical buffet of flower, leaf, root, and fruit extracts, this antioxidant-rich formula deeply hydrates and restores the skin around your eyes, leaving you with a plumper, fuller, firmer, and more lifted look.',
      benefits: 'Antioxidant-rich botanical formula, deeply hydrates and restores, plumper and fuller appearance around eyes, firmer and more lifted look, Camu Camu Vitamin C, Sodium Hyaluronate',
      ingredients: 'Aqua, Propylene Glycol, Polysorbate 20, Palmitoyl Tripeptide-1, Palmitoyl Tetrapeptide-7, Sodium Hyaluronate, Pueraria Lobata Root Extract, Organic Camelia Sinensis Leaf Extract, Organic Calendula Officinalis Flower Extract, Organic Aloe Barbadensis Leaf Extract, Organic Ginkgo Biloba Leaf Extract, Myrciaria Dubia Fruit Extract, Ascorbic Acid.',
      howToUse: 'After cleansing, apply around the entire eye area. Gently pat serum from the inner corner, under the eye, outer corner, and over the eyelid. Avoid contact with eyes.',
      step: 'eye-serum',
      image: 'https://www.avinichi.com/wp-content/uploads/Eye-Rescue-Phyto-Serum-1.png',
      url: 'https://www.avinichi.com/product/eye-rescue-phyto-serum/',
    },
    {
      id: 'avinichi-noni-polishing-peel',
      name: 'Noni Polishing Peel',
      brand: 'Avinichi',
      retailPrice: 300,
      description: 'A multi-tasker that gently yet thoroughly buffs away dull and dead skin cells while hydrating with Noni and lush botanical oils. Expect brighter, smoother, and softer-looking skin after each use.',
      benefits: 'Gently exfoliates dead skin cells, hydrating formula with Noni and botanical oils, brightens and smooths skin, Vitamin C, Mandelic Acid, Walnut Shell Powder, Bamboo Extract',
      ingredients: 'Aqua, SD Alcohol 40B, Propylene Glycol, Glyceryl Acrylates/Acrylic Acid Copolymer, Cetrimonium Chloride, Glycerin, Juglans Regia Shell Powder, Bambusa Arundinacea Stem Extract Powder, Cocos Nucifera Oil, Ascorbic Acid, Mandelic Acid, Camellia Sinensis Leaf Extract, Morinda Citrifolia (Noni) Fruit Extract.',
      howToUse: 'Apply to dry, clean skin. Gently massage in upward circular motions for 30 seconds. Wash peel off with cool water. Use twice a week.',
      step: 'exfoliant',
      image: 'https://www.avinichi.com/wp-content/uploads/Noni-Polishing-Peel-1.png',
      url: 'https://www.avinichi.com/product/noni-polishing-peel/',
    },
    {
      id: 'avinichi-wrinkle-reversal-solution',
      name: 'Wrinkle Reversal Solution',
      brand: 'Avinichi',
      retailPrice: 1300,
      description: 'Effortlessly diminish the visibility of fine lines and wrinkles. Whether for treating fine lines on your forehead, around your eyes, or around your mouth, this quick-acting formula instantly creates a smooth, taut, and firm appearance.',
      benefits: 'Diminishes fine lines and wrinkles, quick-acting formula, smooth taut and firm appearance, Acetyl Hexapeptide-8 peptide complex, Sodium Hyaluronate, Mulberry extract',
      ingredients: 'Aqua, Sodium Silicate, Magnesium Aluminum Silicate, Sodium Polystyrene Sulfonate, Acetyl Hexapeptide-8, Sodium Hyaluronate, Tocopheryl Acetate, Retinyl Palmitate, Organic Cucumis Sativus Fruit Extract, Organic Persea Gratissima Oil, Morus Nigra Fruit Extract, Squalane.',
      howToUse: 'Twist bottom of syringe and push to dispense formula on finger or directly on fine lines and wrinkles. Pat formula into skin gently. If necessary, remove excess solution with a cotton swab.',
      step: 'wrinkle-treatment',
      image: 'https://www.avinichi.com/wp-content/uploads/Wrinkle-Reversal-Solution-1.png',
      url: 'https://www.avinichi.com/product/wrinkle-reversal-solution/',
    },
    {
      id: 'avinichi-noni-night-repair-cream',
      name: 'Noni Night Repair Cream',
      brand: 'Avinichi',
      retailPrice: 350,
      description: 'Each night while you\'re asleep, your skin cells work hard to heal and regenerate. The Noni Night Repair Cream has been designed to keep your skin cells feeling supported as they go about those vital tasks. Formulated with vitamins, plant butters, and botanical extracts to restore moisture overnight, leaving skin appearing bright, plump, and refreshed upon waking.',
      benefits: 'Hydrating overnight restoration, supports skin cell repair during sleep, plumping effect for fuller-looking complexion, long-lasting hydration throughout the day, leaves skin dewy and bright in the morning',
      ingredients: 'Aqua, Helianthus Annuus (Organic Sunflower) Seed Oil, Butyrospermum Parkii (Shea Butter), Simmondsia Chinensis (Jojoba) Seed Oil, Organic Aloe Barbadensis Leaf Extract, Organic Chamomilla Recutita Flower Extract, Organic Camellia Sinensis (Green Tea) Leaf Extract, Retinyl Palmitate (Vitamin A), Tocopheryl Acetate (Vitamin E), Sodium Hyaluronate, Morinda Citrifolia (Noni) Fruit Extract.',
      howToUse: 'Gently massage cream into the skin until thoroughly absorbed. Use nightly before bedtime.',
      step: 'night cream',
      image: 'https://www.avinichi.com/wp-content/uploads/Noni-Night-Repair-Cream-1.png',
      url: 'https://www.avinichi.com/product/noni-night-repair-cream/',
    },
    {
      id: 'avinichi-dark-circle-eye-perfecting-cream',
      name: 'Dark Circle Eye Perfecting Cream',
      brand: 'Avinichi',
      retailPrice: 600,
      description: 'Specially formulated for the thin and delicate skin around the eyes, the Dark Circle Eye Perfecting Cream has been designed to minimize the visibility of both dark circles and crow\'s feet. This silky formula brightens, reduces puffiness, and smooths the eye area for a more youthful appearance.',
      benefits: 'Minimizes dark circles visibility, reduces crow\'s feet appearance, de-puffs the eye area, brightens under-eye skin, lightweight fast-absorbing formula',
      ingredients: 'Aqua, Hydrogenated Polyisobutene, Cyclopentasiloxane, Cyclohexasiloxane, Stearic Acid, PEG-100 Stearate, Cetearyl Alcohol, Caprylic/Capric Triglyceride, Glycerin, Butylene Glycol, Glyceryl Stearate, Cera Alba, Pichia/Resveratrol Ferment Extract, Tetrahexyldecyl Ascorbate, Caffeine, Retinyl Palmitate, Tocopheryl Acetate, Collagen, Chitosan, Allantoin, Myrciaria Dubia Fruit Extract.',
      howToUse: 'Using your ring finger, pat a small amount of cream under and around the eye area.',
      step: 'eye cream',
      image: 'https://www.avinichi.com/wp-content/uploads/Dark-Circle-Eye-Perfecting-Cream-1.png',
      url: 'https://www.avinichi.com/product/dark-circle-eye-perfecting-cream/',
    },
    {
      id: 'avinichi-noni-clarifying-lather-purifier',
      name: 'Noni Clarifying Lather Purifier',
      brand: 'Avinichi',
      retailPrice: 250,
      description: 'The Noni Clarifying Lather Purifier is enriched with the powerful trifecta of Nettle Leaf, Aloe, and Chamomile Extracts. This cleanser purifies and revitalizes skin while restoring natural balance. Nettle Leaf helps regulate oil production, Aloe soothes and hydrates, and Chamomile provides calming effects for a healthy, luminous complexion.',
      benefits: 'Lightly cleanses from residual oils, dirt, and buildup, balances pH levels to prevent dryness, suitable for oily and sensitive skin types, leaves skin soft and refreshed',
      ingredients: 'Aqua, Glycerin, Dimethicone, Decyl Glucoside, Polysorbate 20, Sodium Cocoyl Glycinate, Sodium Lauroamphoacetate, Xanthan Gum, Oligopeptide-1, Acetyl Hexapeptide-8, Palmitoyl Tripeptide-1, Aloe Barbadensis Extract, Mentha Arvensis Leaf Extract, Morinda Citrifolia (Noni) Fruit Extract.',
      howToUse: 'Wet skin with water. Massage cleanser into skin using gentle, circular motions to create foam. Rinse thoroughly.',
      step: 'cleanser',
      image: 'https://www.avinichi.com/wp-content/uploads/Noni-Clarifying-Lather-Purifier-1.png',
      url: 'https://www.avinichi.com/product/noni-clarifying-lather-purifier/',
    },
    {
      id: 'avinichi-mulberry-hydrating-regimen',
      name: 'Mulberry Hydrating Regimen',
      brand: 'Avinichi',
      retailPrice: 7000,
      description: 'A three-piece skincare collection infused with mulberry extract designed to deeply hydrate, leaving your skin with a velvety smooth appearance. Includes the Liquid Lift Overnight Melting Mask, Super-Dewy Bead Serum, and Mulberry Velvet Silk Crème, plus a derma roller for enhanced absorption.',
      benefits: 'Deep hydration, velvety smooth texture, reduced pore appearance, improved skin tone and radiance, firming and volumizing, lift and tighten.',
      ingredients: 'Liquid Lift Overnight Melting Mask: Aqua, Caprylyl Methicone, PEG-12 Dimethicone/PPG Crosspolymer, Glycerin, Caprylic/Capric Triglyceride, Onopordum Acanthium Flower Leaf/Stem Extract, Acetyl Hexapeptide-8, Sodium Hyaluronate, Squalane, Morus Nigra Fruit Extract, Retinyl Palmitate (Vitamin A), Tocopheryl Acetate (Vitamin E). Super-Dewy Bead Serum: Aqua, Cyclopentasiloxane, Glycerin, Dimethicone, Vitis Vinifera Fruit Cell Extract, Organic Ginkgo Biloba Leaf Extract, Acetyl Hexapeptide-8, Sodium Hyaluronate, Dimethylaminoethanol Tartrate, Morus Nigra Fruit Extract. Mulberry Velvet Silk Crème: Aqua, Polysilicone-11, Cyclopentasiloxane, Vitis Vinifera Fruit Cell Extract, Caffeine, Collagen Amino Acids, Acetyl Hexapeptide-8, Sodium Hyaluronate, Tocopheryl Acetate (Vitamin E), Retinyl Palmitate (Vitamin A), Morus Nigra Fruit Extract.',
      howToUse: 'Once a week — Evening: After cleansing, use the derma roller — gently roll 4-5 times in horizontal, vertical, and diagonal directions across your face. Clean roller after use. Apply a thin layer of the Liquid Lift Overnight Melting Mask; leave for ten minutes. Gently massage until surface droplets form, allowing them to disappear naturally — do not rinse. Next Morning: Apply the Super-Dewy Bead Serum to freshly cleansed skin, followed by the Mulberry Velvet Silk Crème.',
      frequency: '1x/week',
      step: 'set',
      image: 'https://www.avinichi.com/wp-content/uploads/Mulberry-Hydrating-Regimen-1.png',
      url: 'https://www.avinichi.com/product/mulberry-hydrating-regimen/',
    },
  ],
  spacetouch: [
    {
      id: 'spacetouch-cosmo',
      name: 'Cosmo',
      brand: 'SpaceTouch',
      retailPrice: 100000,
      minPrice: 10000,
      description: 'The Cosmo is a portable, full-body LED skin care device with a foldable design featuring 360 LED and infrared points across a 23-inch treatment width. Powered by NASA-derived infrared technology and developed with German plastic surgeons and dermatologists, it delivers six therapeutic light wavelengths — Red, Blue, Green, Yellow, Orange, and Purple — plus an AI-enhanced Flash Mode with infrared coverage (700nm to 0.1mm). An FDA-approved, clinical-grade home device with a manual timer up to 60 minutes and a lifetime manufacturer warranty. Available in Black or White.',
      benefits: 'Full-body LED treatment across a 23-inch, 360-point panel; six therapeutic wavelengths (red, blue, green, yellow, orange, purple); AI-enhanced Flash Mode with deep infrared coverage; targets body pain, wrinkles and fine lines, sun spots and pigmentation, cellulite and scarring, body tightening, and acne; foldable and portable; manual timer up to 60 minutes; FDA approved; clinical-grade for home use; lifetime manufacturer warranty; available in Black or White.',
      ingredients: '',
      howToUse: 'Unfold the panel and position it facing the treatment area at a comfortable distance. Select the light wavelength that matches your concern and set the manual timer (up to 60 minutes per session). Remain still during treatment, repositioning the panel to cover additional areas of the body as needed. Use Flash Mode for AI-enhanced infrared coverage. Fold the device flat for storage after each use.',
      step: 'device treatment',
      image: 'https://spacetouch.com/cdn/shop/files/SpacetouchCosmostomachtightenting.png?v=1710228368',
      url: 'https://spacetouch.com/products/cosmo',
    },
  ],
  lumieres: [
    {
      id: 'lumieres-medlight',
      name: 'MedLight',
      brand: 'Lumières',
      retailPrice: 500000,
      minPrice: 10000,
      description: 'The Lumières MedLight is a multi-spectrum light therapy device built for pain relief and skin care, offering a safe, non-invasive solution with seven pre-set treatment modes plus a fully customizable mode. A touchscreen controller with gentle light transitions makes it approachable for both clinical and at-home use.',
      benefits: 'Reduces inflammation and eases muscle and joint pain; enhances circulation to reduce stiffness; supports post-workout recovery; boosts collagen production and reduces fine lines and wrinkles; improves skin tone and texture; soothes sensitive and irritated skin; seven pre-set modes (Skin Care, Fat Burning, Recovery, Sleep Enhancement, Inflammation Relief, General Health & Wellness) plus a fully Customized Mode; user-friendly touchscreen interface.',
      ingredients: '',
      howToUse: 'Select one of the seven pre-set modes on the touchscreen controller based on your goal for the session (e.g. Skin Care for 20 minutes, Recovery for 30 minutes), or choose Customized Mode to set your own spectra, pulse, and duration. Position the device over the treatment area and remain still for the session length shown on screen. Clean the panel surface after each use per the included manual.',
      step: 'device treatment',
      image: 'https://lumiereslights.com/wp-content/uploads/2024/08/Lumieres-White-Devices-2-1-600x600.png',
      url: 'https://lumiereslights.com/product/lumieres-medlight/',
    },
    {
      id: 'lumieres-max',
      name: 'Smart Medical Device Max',
      brand: 'Lumières',
      retailPrice: 150000,
      minPrice: 5000,
      description: 'The Lumières Smart Medical Device Max (model H1520) is a full-body, FDA-certified red/near-infrared/blue light therapy panel with 304 LEDs across six bands, voice-guided "Voice Mentor" assistance, and floor, wall, or door mounting. Built for deep-tissue pain relief and recovery at full-room scale.',
      benefits: 'Near-infrared (850nm) penetrates deep tissue to support circulation and reduce inflammation; red light (660nm) supports muscle recovery and natural healing; blue light (415nm) offers anti-inflammatory pain relief; Voice Mentor guided sessions; touch key and voice control; 7 preset modes plus custom settings; adjustable beam angles (30°/60°/90°); floor stand, wall mount, and door mount included; FDA-certified; lifetime warranty.',
      ingredients: '',
      howToUse: 'Mount or position the panel (floor stand, wall, or door mount) facing the treatment area. Use the touch key or a Voice Mentor command to start a preset mode, or dial in a custom spectrum, beam angle, and pulse frequency. Remain in range of the panel for the full session — Voice Mentor will guide timing and mode changes. Store upright on its stand between uses.',
      step: 'device treatment',
      image: 'https://lumiereslights.com/wp-content/uploads/2024/08/9-1-scaled.jpg',
      url: 'https://lumiereslights.com/product/lumieres-smart-medical-device-max/',
    },
    {
      id: 'lumieres-medium',
      name: 'Smart Device Medium',
      brand: 'Lumières',
      retailPrice: 100000,
      minPrice: 5000,
      description: 'The Lumières Smart Device Medium (model H760) is a half-body red/near-infrared/blue light therapy panel with 152 LEDs across six bands and Voice Mentor guided sessions, sized for targeted pain relief and tissue healing across larger muscle groups.',
      benefits: 'Near-infrared (850nm) penetrates up to 5mm to reach muscles, joints, and bone; red light (660nm) and blue light offer anti-inflammatory, antibacterial relief of muscle soreness; Voice Mentor guided sessions; touch key and voice control; 7 preset modes plus custom settings; floor stand, wall mount, and door mount included; FDA-certified; 3-year warranty.',
      ingredients: '',
      howToUse: 'Mount or position the panel facing the treatment area using the included floor stand, wall mount, or door mount. Start a preset mode via the touch key or a Voice Mentor command, or set a custom spectrum and beam angle (30°/60°/90°). Remain in range for the guided session length, then fold away or leave mounted for next use.',
      step: 'device treatment',
      image: 'https://lumiereslights.com/wp-content/uploads/2024/08/Lumieres-Smart-Device-Medium-1-600x600.jpg',
      url: 'https://lumiereslights.com/product/lumieres-smart-device-medium/',
    },
    {
      id: 'lumieres-small',
      name: 'Smart Device Small',
      brand: 'Lumières',
      retailPrice: 50000,
      minPrice: 5000,
      description: 'The Lumières Smart Device Small (model H320) is the most compact panel in the line, with 64 LEDs across six bands in a sleek aluminum housing — sized for targeted, localized pain relief and skin care sessions.',
      benefits: 'Red light (660nm) supports collagen production and cellular regeneration; near-infrared (810nm/850nm) penetrates up to 5mm to reach muscles, joints, and bone; blue light (415nm) addresses acne-causing bacteria and skin inflammation; touch key and voice-activated control; 7 preset modes plus 1 custom mode; floor stand, wall mount, and door mount included; FDA-certified; 3-year warranty.',
      ingredients: '',
      howToUse: 'Position the panel facing the treatment area using the included floor stand, wall mount, or door mount. Choose one of the 7 preset modes via the touch key or voice control, or set a custom mode. Remain in range for the session length, then store the device between uses.',
      step: 'device treatment',
      image: 'https://lumiereslights.com/wp-content/uploads/2024/08/Lumieres-6-600x600.png',
      url: 'https://lumiereslights.com/product/lumieres-smart-device-small/',
    },
  ],
};

// GET /api/welcome/products — returns the product catalog
router.get('/products', (req, res) => {
  res.json({ products: PRODUCTS });
});

// ─── Theme color palettes for email templates ────────────────────────────────

const EMAIL_THEMES = {
  rose: {
    linkColor: '#c97d8a',
    routineAccent: '#c9a96e',   // gold — used for all routine titles/borders
    productsBg: '#fdf2f4',
    productsBorder: '#c97d8a',
    tipsBg: '#fef9ee',
    tipsBorder: '#d4a24e',
    consultBg: '#fdf2f4',
    consultBorder: '#c97d8a',
  },
  earth: {
    linkColor: '#5a8a7d',
    routineAccent: '#a0855b',   // warm brown
    productsBg: '#eef5f3',
    productsBorder: '#5a8a7d',
    tipsBg: '#fef9ee',
    tipsBorder: '#c9a04e',
    consultBg: '#eef5f3',
    consultBorder: '#5a8a7d',
  },
  lavender: {
    linkColor: '#8b7bb5',
    routineAccent: '#b0a0d0',   // soft lilac
    productsBg: '#f3f0fa',
    productsBorder: '#8b7bb5',
    tipsBg: '#fef9ee',
    tipsBorder: '#d4a24e',
    consultBg: '#f3f0fa',
    consultBorder: '#8b7bb5',
  },
  ocean: {
    linkColor: '#3d7a8a',
    routineAccent: '#5a9aaa',   // lighter aqua
    productsBg: '#e8f4f7',
    productsBorder: '#3d7a8a',
    tipsBg: '#fef9ee',
    tipsBorder: '#d4a24e',
    consultBg: '#e8f4f7',
    consultBorder: '#3d7a8a',
  },
  sage: {
    linkColor: '#6b8f71',
    routineAccent: '#8aaa8e',   // lighter sage
    productsBg: '#edf3ee',
    productsBorder: '#6b8f71',
    routineAccent: '#8aaa8e',   // lighter sage
    tipsBg: '#fef9ee',
    tipsBorder: '#c9a04e',
    consultBg: '#edf3ee',
    consultBorder: '#6b8f71',
  },
};

// ─── Helpers for templated email generation ───────────────────────────────────

function getLinkStyle(theme) {
  const colors = EMAIL_THEMES[theme] || EMAIL_THEMES.rose;
  return `color:${colors.linkColor};text-decoration:underline`;
}

function productLink(p, theme) {
  const linkStyle = getLinkStyle(theme);
  if (p.url) return `<a href="${p.url}" style="${linkStyle}">${p.name}</a>`;
  return `<b>${p.name}</b>`;
}

// Short descriptions for the "Your New Products" section (1-2 sentences)
function shortDescription(p) {
  // Use first sentence or two of description, capped for brevity
  if (!p.description) return '';
  const sentences = p.description.match(/[^.!]+[.!]+/g) || [p.description];
  return sentences.slice(0, 2).join(' ').trim();
}

// Routine step ordering and categorization
const ROUTINE_STEPS = {
  am: [
    { key: 'cleanser', label: 'Cleanse', matches: ['cleanser', 'AM Routine'] },
    { key: 'toner', label: 'Tone', matches: ['toner'] },
    { key: 'serum', label: 'Serum', matches: ['serum', 'AM Routine'] },
    { key: 'eye', label: 'Eye Treatment', matches: ['eye serum', 'eye cream', 'eye treatment'] },
    { key: 'moisturizer', label: 'Moisturize', matches: ['moisturizer'] },
    { key: 'spf', label: 'Sun Protection', matches: ['AM Routine'] },
  ],
  pm: [
    { key: 'cleanser', label: 'Cleanse', matches: ['cleanser', 'PM Routine'] },
    { key: 'toner', label: 'Tone', matches: ['toner'] },
    { key: 'serum', label: 'Serum', matches: ['serum', 'PM Routine'] },
    { key: 'eye', label: 'Eye Treatment', matches: ['eye serum', 'eye cream', 'eye treatment'] },
    { key: 'moisturizer', label: 'Moisturize', matches: ['moisturizer', 'PM Routine', 'night treatment'] },
  ],
  weekly: [
    { key: 'exfoliant', label: 'Exfoliate (1-2x/week)', matches: ['exfoliant', 'exfoliant/scrub'] },
    { key: 'mask', label: 'Mask (1-3x/week)', matches: ['mask', 'body mask'] },
    { key: 'device', label: 'Device Treatment', matches: ['device treatment'] },
    { key: 'treatment', label: 'Targeted Treatment', matches: ['treatment cream'] },
  ],
};

// MineralLift Thermal products — excluded from AM/PM, shown only in Monthly
const THERMAL_SET_IDS = new Set([
  'hydrasphere-mineralift-thermal-serum',
  'hydrasphere-mineralift-thermal-cream',
  'hydrasphere-mineralift-thermal-mask',
]);

function isThermalProduct(p) {
  return THERMAL_SET_IDS.has(p.id);
}

// Match a product to a routine step key
function matchStep(product, stepDef) {
  const pStep = (product.step || '').toLowerCase();
  return stepDef.matches.some(m => pStep.includes(m.toLowerCase()));
}

// Special matching for AM-specific products (cleanser, serum, SPF)
function isAmProduct(p) {
  const step = (p.step || '').toLowerCase();
  return step.includes('am routine') || p.id.includes('spf') || p.id.includes('shield');
}

function isPmProduct(p) {
  const step = (p.step || '').toLowerCase();
  return step.includes('pm routine') || step.includes('night');
}

function isCleanser(p) {
  const step = (p.step || '').toLowerCase();
  return step.includes('cleanser') || (step.includes('am routine') && p.name.toLowerCase().includes('cleanser'));
}

function isToner(p) {
  return (p.step || '').toLowerCase().includes('toner');
}

function isSerum(p) {
  const step = (p.step || '').toLowerCase();
  const name = p.name.toLowerCase();
  return step.includes('serum') || (step.includes('am routine') && (name.includes('serum') || name.includes('vitamin c')));
}

function isEye(p) {
  const step = (p.step || '').toLowerCase();
  return step.includes('eye');
}

function isMoisturizer(p) {
  const step = (p.step || '').toLowerCase();
  const name = p.name.toLowerCase();
  return step.includes('moisturizer') || (name.includes('cream') && !name.includes('spf') && !name.includes('shield') && !name.includes('wrinkle') && !name.includes('peeling'));
}

function isSpf(p) {
  const name = p.name.toLowerCase();
  return name.includes('spf') || name.includes('shield') || name.includes('sunscreen');
}

function isExfoliant(p) {
  const step = (p.step || '').toLowerCase();
  return step.includes('exfoliant') || step.includes('scrub');
}

function isMask(p) {
  const step = (p.step || '').toLowerCase();
  return step.includes('mask');
}

function isDevice(p) {
  const step = (p.step || '').toLowerCase();
  return step.includes('device');
}

function isTreatment(p) {
  const step = (p.step || '').toLowerCase();
  return step.includes('treatment') && !step.includes('device');
}

// Find a suggestion from unselected products for a missing step
function findSuggestion(matchFn, selectedIds, allProducts) {
  return allProducts.find(p => !selectedIds.has(p.id) && matchFn(p)) || null;
}

// Build a routine step HTML line
// Why-you-need-it reasons for each routine step when suggesting
const STEP_REASONS = {
  Cleanse: 'Cleansing is the foundation of every routine — it removes dirt, oil, and impurities so your other products can actually absorb and do their job.',
  Tone: 'A toner rebalances your skin\'s pH after cleansing and preps it to absorb your serums and moisturizers more effectively.',
  Serum: 'Serums deliver concentrated active ingredients deep into your skin — they\'re where the real transformation happens.',
  'Eye Treatment': 'The skin around your eyes is the thinnest and most delicate on your face. A dedicated eye treatment targets fine lines, puffiness, and dark circles that regular moisturizers can\'t address.',
  Moisturize: 'Moisturizer locks in hydration and creates a protective barrier to keep your skin plump, smooth, and healthy all day.',
  'Sun Protection': 'SPF is the single most important anti-aging step. Without it, UV damage undoes the benefits of every other product in your routine.',
};

function routineStepHtml(label, product, suggestion, opts = {}) {
  const theme = opts.theme || 'rose';
  if (product) {
    return `<p style="margin-bottom:8px">✅ <b>${label}:</b> ${productLink(product, theme)} — ${product.howToUse || ''}</p>`;
  }
  if (suggestion && !opts.skipSuggestions) {
    // If this suggestion was already detailed in the AM routine, keep it short
    if (opts.alreadySuggested) {
      return `<p style="margin-bottom:8px">👉 <b>${label}:</b> Use your ${productLink(suggestion, theme)} here too.</p>`;
    }
    return `<p style="margin-bottom:8px">👉 <b>${label}:</b> We recommend ${productLink(suggestion, theme)} — reply for a special new-customer discount with free shipping!</p>`;
  }
  return '';
}

// ─── Tips bank — selected based on what the customer purchased ────────────────

// Enthusiastic "why you'll love it" lines for each product
const LOVE_LINES = {
  // Avologi devices
  'avologi-lumnen': 'You\'re going to be amazed by this one! The LUMNEN is the world\'s first FDA-certified home-use bio-stimulator laser — it actually stimulates your skin\'s own collagen and hyaluronic acid production for real, visible volume and firmness. This is next-level skincare!',
  'avologi-eneo-totale': 'This is like having a professional skin rejuvenation clinic in your hands! The Eneo Totalé uses Nobel Prize-winning technology to smooth, firm, and reveal genuinely radiant skin — and the results just keep getting better with every session.',
  'avologi-eneo-totale-blu': 'Say goodbye to breakouts! This FDA-certified blue light device targets acne and skin imperfections in just 4-6 minutes per session — no chemicals, no side effects, just clearer skin. Your skin is going to thank you!',
  'avologi-eneo-blu': 'This little powerhouse is your secret weapon against acne — FDA-approved blue light technology that eliminates acne-causing bacteria in minutes. It works on your face, back, and body, and you can see results from the very first session!',

  // HydraSphere products
  'hydrasphere-advanced-foaming-cleanser': 'This isn\'t just a cleanser — it\'s the perfect start to your routine! The hemp-extract formula gently retextures and exfoliates while prepping your skin to absorb everything that comes next. Your skin will feel so soft and fresh!',
  'hydrasphere-hydra-toning-solution': 'Your skin is going to drink this up! This toner rebalances your pH and gets your skin perfectly prepped to soak in all the goodness from your serums and moisturizers. It\'s the step that makes every other step work better.',
  'hydrasphere-vitamin-c-serum': 'Get ready to glow! This Vitamin C powerhouse brightens, fades dark spots, and fights fine lines while boosting your skin\'s collagen production. It\'s like sunshine in a bottle for your complexion!',
  'hydrasphere-mineralift-thermal-serum': 'You\'re going to feel this one working! This serum penetrates deep to stimulate collagen and tighten your skin from within. Firmer, lifted, more youthful-looking skin — yes please!',
  'hydrasphere-deep-moisturizing-cream': 'This is so much more than a moisturizer — it\'s a firming elixir! The botanical-rich formula deeply nourishes and firms your skin with a luxurious feel that goes way beyond basic hydration. Your skin will look plump and gorgeous!',
  'hydrasphere-mineralift-thermal-cream': 'You\'re going to love how this feels! It glides on like silk, absorbs instantly with zero greasiness, and works to firm and lift your skin with every use. Collagen-boosting luxury at its finest!',
  'hydrasphere-anti-wrinkle-30g': 'This is targeted power right where you need it! Packed with Hyaluronic Acid, Retinol, Stem Cells, and Peptides, it visibly smooths deep lines and firms your skin. It\'s like an eraser for wrinkles!',
  'hydrasphere-anti-wrinkle-15g': 'All the wrinkle-fighting power of our Anti Wrinkle cream in a perfect travel size! Retinol, Stem Cells, and Peptides work together to smooth and firm — so your skin looks amazing wherever you go.',
  'hydrasphere-oxygen-brightening-cream': 'This cream is pure luxury for your skin! Oxygen-infused ingredients deeply hydrate and brighten while improving your texture — you\'ll notice a radiant, youthful glow that just gets better with every use.',
  'hydrasphere-spf50-shield-cream': 'This is your daily armor! Lightweight, non-greasy mineral SPF 50 that protects against UVA and UVB rays while brightening with Niacinamide — no white cast, just beautiful protected skin. Your future self will thank you!',
  'hydrasphere-facial-peeling-gel': 'Get ready for baby-soft skin! This gentle mandelic acid peel sweeps away dead skin cells, fades dark spots, and smooths texture — revealing the fresh, glowing skin hiding underneath. You\'ll be obsessed!',
  'hydrasphere-mineralift-thermal-mask': 'This is your monthly spa moment at home! The self-warming formula stimulates your facial muscles and boosts circulation while detoxifying and firming. You\'ll feel the tingle and see the glow — so good!',
  'hydrasphere-hydrocharcoal-silk-mask': 'Treat yourself to this luxurious leave-on mask! Activated charcoal and hyaluronic acid work together to purify pores, smooth texture, and give you an instant radiant glow. Perfect before a special occasion or anytime you want to look your absolute best!',

  // Avinichi products
  'avinichi-mulberry-hydrating-regimen': 'This is your complete hydration ritual! The mulberry-infused trio works together beautifully — the overnight mask repairs while you sleep, the serum plumps and firms in the morning, and the silk crème locks it all in with a velvety finish. Your skin is going to feel incredible!',
};

const TIPS_BANK = [
  {
    match: (products) => products.some(p => p.name.toLowerCase().includes('anti wrinkle') || p.ingredients.toLowerCase().includes('retinol')),
    tip: 'Since you have a retinol-based product, start by using it every other evening and gradually increase to nightly. Always follow with SPF in the morning — retinol can make skin more sun-sensitive.',
  },
  {
    match: (products) => products.some(p => p.name.toLowerCase().includes('vitamin c')),
    tip: 'Your Vitamin C Serum works best in the morning — it pairs beautifully with SPF for extra antioxidant protection. Store it in a cool, dark place to keep it potent.',
  },
  {
    match: (products) => products.some(p => isExfoliant(p)),
    tip: 'With your exfoliating product, start with once a week and work up to twice a week as your skin adjusts. Avoid using it on the same night as retinol products.',
  },
  {
    match: (products) => products.some(p => isDevice(p)),
    tip: 'For your device, consistency is key! Follow the recommended schedule and always start with clean skin. Wipe down your device after each use to keep it in top shape.',
  },
  {
    match: (products) => products.some(p => isSpf(p)),
    tip: 'Remember to reapply your SPF every 2 hours when you\'re spending time outdoors — even on cloudy days!',
  },
  {
    match: (products) => products.some(p => isMask(p)),
    tip: 'Masks are a wonderful weekly treat for your skin. Use them after cleansing on a night when you can relax and let the ingredients really work their magic.',
  },
  {
    match: (products) => products.length >= 3,
    tip: 'Since you\'re building out a full routine, introduce one new product at a time over a week or two. This way you can see how your skin responds to each one individually.',
  },
  {
    match: () => true, // Always include
    tip: 'Always patch test a new product on a small area first, and give your routine at least 4-6 weeks to see full results. Beautiful skin is a journey, not an overnight destination!',
  },
];

// POST /api/welcome/generate — build a templated welcome email (no AI)
// Build the personalized welcome email HTML for a set of products.
// Shared by the /generate route and the POS welcome-email endpoint.
// Throws an Error (with a user-friendly message) on invalid input.
function generateWelcomeEmailBody({ customerEmail, customerName, selectedProductIds: rawProductIds, includeSuggestions, userId }) {
  // Expand the thermal set into its individual product IDs
  const selectedProductIds = (rawProductIds || []).flatMap(id =>
    id === 'hydrasphere-mineralift-thermal-set'
      ? ['hydrasphere-mineralift-thermal-mask', 'hydrasphere-mineralift-thermal-serum', 'hydrasphere-mineralift-thermal-cream']
      : [id]
  );

  if (!customerEmail || typeof customerEmail !== 'string') {
    throw new Error('customerEmail is required');
  }
  if (!customerName || typeof customerName !== 'string' || !customerName.trim()) {
    throw new Error('customerName is required');
  }
  if (!Array.isArray(selectedProductIds) || selectedProductIds.length === 0) {
    throw new Error('At least one product must be selected');
  }

  // Get company name and theme from session user
  let companyName = 'our store';
  let userTheme = 'rose';
  if (userId) {
    const { getUser } = require('../db');
    const user = getUser(userId);
    if (user?.company_name) companyName = user.company_name;
    if (user?.theme) userTheme = user.theme;
  }
  const tc = EMAIL_THEMES[userTheme] || EMAIL_THEMES.rose;

  // Filter products by user's selected brands
  const userBrands = userId ? JSON.parse(require('../db').getUser(userId)?.brands || '["avologi","avinichi","hydrasphere","spacetouch","lumieres"]') : ['avologi', 'avinichi', 'hydrasphere', 'spacetouch', 'lumieres'];
  const allProducts = Object.entries(PRODUCTS)
    .filter(([key]) => userBrands.includes(key))
    .flatMap(([, products]) => products);
  const selectedIds = new Set(selectedProductIds);
  const selectedProducts = selectedProductIds
    .map(id => allProducts.find(p => p.id === id))
    .filter(Boolean);

  if (selectedProducts.length === 0) {
    throw new Error('No valid products matched the selected IDs');
  }

  const name = customerName.trim();

  // ── 1. Welcome paragraph (randomly selected) ──────────────────────────
  const WELCOMES = [
    `<p style="margin-bottom:16px">Hi ${name}! 👋</p>
<p style="margin-bottom:24px">Welcome to the ${companyName} family! We're so excited you've chosen us as part of your beauty journey. We handpick every product in our store because we genuinely believe in what they can do for your skin — and we can't wait for you to experience the results.</p>`,

    `<p style="margin-bottom:16px">Hey ${name}! 💖</p>
<p style="margin-bottom:24px">We are thrilled to have you as part of the ${companyName} community! Every product we carry has been carefully selected because we've seen the incredible results firsthand — and now it's your turn. Get ready to fall in love with your skin all over again.</p>`,

    `<p style="margin-bottom:16px">Hi ${name}! ✨</p>
<p style="margin-bottom:24px">Welcome aboard — you just made an amazing choice for your skin! At ${companyName}, we're passionate about helping you look and feel your absolute best. We personally stand behind every product in our collection, and we're so excited to be part of your glow-up journey.</p>`,

    `<p style="margin-bottom:16px">Hello ${name}! 🌸</p>
<p style="margin-bottom:24px">A warm welcome from all of us at ${companyName}! We believe great skin starts with great products — and you've just picked some of our favorites. We're here to make sure you get the most out of every single one, so let's dive in!</p>`,

    `<p style="margin-bottom:16px">Hi there, ${name}! 🌿</p>
<p style="margin-bottom:24px">Welcome to ${companyName} — we're so glad you found us! We started this store because we believe everyone deserves access to truly exceptional skincare. Your new products are going to do wonderful things for your skin, and we're here every step of the way.</p>`,
  ];
  const welcomeHtml = WELCOMES[Math.floor(Math.random() * WELCOMES.length)];

  // ── 2. Your New Products ──────────────────────────────────────────────
  const productsHtml = selectedProducts.map(p =>
    `<p style="margin-bottom:12px">✨ ${productLink(p, userTheme)} — ${LOVE_LINES[p.id] || shortDescription(p)}</p>`
  ).join('\n');

  const newProductsSection = `<div style="margin-top:24px;padding:20px;background:${tc.productsBg};border-left:4px solid ${tc.productsBorder};border-radius:8px"><p style="margin-bottom:12px;font-size:20px"><b>🛍️ Your New Products</b></p>\n${productsHtml}</div>`;

  // ── 2b. Synergy paragraph (only if 4+ products) ───────────────────────
  let synergyHtml = '';
  if (selectedProducts.length > 3) {
    const hasCleanser = selectedProducts.some(isCleanser);
    const hasSerum = selectedProducts.some(isSerum);
    const hasMoist = selectedProducts.some(isMoisturizer);
    const hasSpfProd = selectedProducts.some(isSpf);
    const hasDevice = selectedProducts.some(isDevice);
    const hasExfol = selectedProducts.some(isExfoliant);
    const hasMaskProd = selectedProducts.some(isMask);
    const hasTreat = selectedProducts.some(isTreatment);

    const synergies = [];

    if (hasCleanser && hasSerum) {
      synergies.push('Your cleanser creates the perfect clean canvas for your serums to penetrate deeper and work more effectively.');
    }
    if (hasSerum && hasMoist) {
      synergies.push('Layering your serum under your moisturizer locks in those powerful active ingredients while your moisturizer seals in hydration.');
    }
    if (hasSerum && hasSpfProd) {
      synergies.push('Your antioxidant serum and SPF are the ultimate daytime duo — the serum fights free radical damage while the SPF shields you from UV rays.');
    }
    if (hasDevice && hasSerum) {
      synergies.push('Using your device after applying serum supercharges absorption — the light therapy helps drive those active ingredients deeper into the skin for maximum results.');
    }
    if (hasExfol && hasMoist) {
      synergies.push('Your exfoliant clears away dead skin cells so your moisturizer can absorb fully and hydrate more effectively.');
    }
    if (hasMaskProd && hasSerum) {
      synergies.push('Weekly masks paired with your daily serums give your skin both consistent daily nourishment and an intensive weekly boost.');
    }
    if (hasTreat && hasSpfProd) {
      synergies.push('Your targeted treatment works on specific concerns while your SPF protects those treated areas from sun damage that could undo your progress.');
    }

    // Fallback if no specific synergies matched
    if (synergies.length === 0) {
      synergies.push('Each product in your collection addresses a different aspect of skin health, and together they create a comprehensive routine that covers all your bases.');
    }

    const productNames = selectedProducts.map(p => p.name).join(', ');
    synergyHtml = `<p style="margin-top:16px;margin-bottom:0;font-family:system-ui,sans-serif;font-size:.93rem;line-height:1.6;color:#2c2022">You've put together a really powerful combination! ${synergies.slice(0, 3).join(' ')} With ${productNames} working together in your routine, each product amplifies the benefits of the others — your skin is going to love this lineup.</p>`;
  }

  // ── 3. Skincare Routine ───────────────────────────────────────────────
  // Find purchased products for each step, or suggest alternatives
  const findPurchased = (matchFn) => selectedProducts.find(matchFn) || null;
  const findSug = (matchFn) => findSuggestion(matchFn, selectedIds, allProducts);

  // AM Routine (exclude thermal products — they go in Monthly only)
  const amCleanser = findPurchased(isCleanser) || null;
  const amToner = findPurchased(isToner) || null;
  const amSerum = findPurchased(p => isSerum(p) && !isPmProduct(p) && !isThermalProduct(p)) || findPurchased(p => isSerum(p) && !isThermalProduct(p)) || null;
  const amEye = findPurchased(isEye) || null;
  const amMoisturizer = findPurchased(p => isMoisturizer(p) && !isPmProduct(p) && !isThermalProduct(p)) || findPurchased(p => isMoisturizer(p) && !isThermalProduct(p)) || null;
  const amSpf = findPurchased(isSpf) || null;

  // Track which suggestions we make in AM so PM can reference them briefly
  const sugCleanser = !amCleanser ? findSug(isCleanser) : null;
  const sugToner = !amToner ? findSug(isToner) : null;
  const sugSerum = !amSerum ? findSug(isSerum) : null;
  const sugEye = !amEye ? findSug(isEye) : null;
  const sugMoisturizer = !amMoisturizer ? findSug(isMoisturizer) : null;
  const sugSpf = !amSpf ? findSug(isSpf) : null;

  const skipSuggestions = includeSuggestions === false || (includeSuggestions === undefined && selectedProducts.length <= 3);
  const themeOpts = { theme: userTheme, skipSuggestions };

  // Routine sub-sections use a colored top-border header strip (not full callout)
  let amHtml = `<div style="margin-top:16px;border-top:3px solid ${tc.routineAccent};padding-top:12px">
<p style="margin-bottom:10px;font-size:17px;color:${tc.routineAccent}"><b>☀️ Morning Routine</b></p>\n`;
  amHtml += routineStepHtml('Cleanse', amCleanser, sugCleanser, themeOpts);
  amHtml += routineStepHtml('Tone', amToner, sugToner, themeOpts);
  amHtml += routineStepHtml('Serum', amSerum, sugSerum, themeOpts);
  amHtml += routineStepHtml('Eye Treatment', amEye, sugEye, themeOpts);
  amHtml += routineStepHtml('Moisturize', amMoisturizer, sugMoisturizer, themeOpts);
  // Show alternate moisturizers the customer also purchased
  const extraAmMoisturizers = selectedProducts.filter(p => isMoisturizer(p) && !isThermalProduct(p) && p !== amMoisturizer);
  if (amMoisturizer && extraAmMoisturizers.length > 0) {
    const altNames = extraAmMoisturizers.map(p => productLink(p, userTheme)).join(' or ');
    amHtml += `<p style="margin-bottom:8px;margin-left:24px;font-style:italic">You can also use ${altNames} instead, or mix a small amount of each for extra nourishment.</p>`;
  }
  amHtml += routineStepHtml('Sun Protection', amSpf, sugSpf, themeOpts);

  // For small orders, add a single summary of missing steps instead of individual upsells
  if (skipSuggestions) {
    const missingAm = [];
    if (!amCleanser) missingAm.push('cleansing');
    if (!amToner) missingAm.push('toning');
    if (!amSerum) missingAm.push('a serum');
    if (!amEye) missingAm.push('an eye treatment');
    if (!amMoisturizer) missingAm.push('moisturizing');
    if (!amSpf) missingAm.push('sun protection');
    if (missingAm.length > 0) {
      amHtml += `<p style="margin-bottom:8px;margin-top:12px;font-style:italic">A complete morning routine also includes ${missingAm.join(', ')} — reply to this email if you\'d like personalized product suggestions! As a new customer, you\'re eligible for a special discount with free shipping.</p>`;
    }
  }

  amHtml += '</div>';

  // PM Routine (exclude thermal products — they go in Monthly only)
  const pmSerum = findPurchased(p => isSerum(p) && isPmProduct(p) && !isThermalProduct(p)) || findPurchased(p => isSerum(p) && p !== amSerum && !isThermalProduct(p)) || amSerum;
  const pmMoisturizer = findPurchased(p => isMoisturizer(p) && isPmProduct(p) && !isThermalProduct(p)) || findPurchased(p => isMoisturizer(p) && p !== amMoisturizer && !isThermalProduct(p)) || amMoisturizer;

  let pmHtml = `<div style="margin-top:16px;border-top:3px solid ${tc.routineAccent};padding-top:12px">
<p style="margin-bottom:10px;font-size:17px;color:${tc.routineAccent}"><b>🌙 Evening Routine</b></p>\n`;
  pmHtml += routineStepHtml('Cleanse', amCleanser, sugCleanser, { alreadySuggested: !!sugCleanser, theme: userTheme, skipSuggestions });
  pmHtml += routineStepHtml('Tone', amToner, sugToner, { alreadySuggested: !!sugToner, theme: userTheme, skipSuggestions });
  pmHtml += routineStepHtml('Serum', pmSerum, pmSerum ? null : sugSerum, { alreadySuggested: !!sugSerum, theme: userTheme, skipSuggestions });
  pmHtml += routineStepHtml('Eye Treatment', amEye, sugEye, { alreadySuggested: !!sugEye, theme: userTheme, skipSuggestions });
  pmHtml += routineStepHtml('Moisturize', pmMoisturizer, pmMoisturizer ? null : sugMoisturizer, { alreadySuggested: !!sugMoisturizer, theme: userTheme, skipSuggestions });
  // Show alternate moisturizers the customer also purchased
  const extraPmMoisturizers = selectedProducts.filter(p => isMoisturizer(p) && !isThermalProduct(p) && p !== pmMoisturizer && p !== amMoisturizer);
  if (pmMoisturizer && extraPmMoisturizers.length > 0) {
    const altNames = extraPmMoisturizers.map(p => productLink(p, userTheme)).join(' or ');
    pmHtml += `<p style="margin-bottom:8px;margin-left:24px;font-style:italic">You can also use ${altNames} instead, or mix a small amount of each for extra nourishment.</p>`;
  }

  // For small orders, add a single summary of missing PM steps
  if (skipSuggestions) {
    const missingPm = [];
    if (!amCleanser) missingPm.push('cleansing');
    if (!amToner) missingPm.push('toning');
    if (!pmSerum) missingPm.push('a serum');
    if (!amEye) missingPm.push('an eye treatment');
    if (!pmMoisturizer) missingPm.push('moisturizing');
    if (missingPm.length > 0) {
      pmHtml += `<p style="margin-bottom:8px;margin-top:12px;font-style:italic">A complete evening routine also includes ${missingPm.join(', ')} — reply to this email if you\'d like personalized product suggestions! As a new customer, you\'re eligible for a special discount with free shipping.</p>`;
    }
  }

  // Split into weekly (exfoliants/devices/weekly masks) and monthly (monthly masks/treatments)
  const treatments = selectedProducts.filter(isTreatment);
  const isSet = (p) => (p.step || '').toLowerCase() === 'set';
  const sets = selectedProducts.filter(isSet);
  const isWeeklyMask = (p) => isMask(p) && (p.step || '').toLowerCase().includes('weekly');
  const isMonthlyMask = (p) => isMask(p) && !(p.step || '').toLowerCase().includes('weekly');
  const weeklyExfoliants = selectedProducts.filter(p => isExfoliant(p) || isDevice(p) || isWeeklyMask(p));
  const monthlyMasks = selectedProducts.filter(p => isMonthlyMask(p));
  let weeklyHtml = '';

  // ── Treatments (exfoliants, devices, and sets) ────────────────────────
  if (weeklyExfoliants.length > 0 || sets.length > 0) {
    weeklyHtml += `<p style="margin-bottom:10px;font-size:17px;color:${tc.routineAccent}"><b>📅 Treatments</b></p>\n`;
    weeklyExfoliants.forEach(p => {
      const freq = p.frequency || (isExfoliant(p) ? '1-2x/week' : 'as directed');
      weeklyHtml += `<p style="margin-bottom:8px">✅ <b>${p.name}</b> (${freq}) — ${p.howToUse || ''}</p>`;
    });
    sets.forEach(p => {
      const freq = p.frequency ? ` (${p.frequency})` : '';
      weeklyHtml += `<p style="margin-bottom:8px">✅ <b>${p.name}</b>${freq} — ${p.howToUse || ''}</p>`;
    });
  }

  // Suggest exfoliant if none purchased (skip for small orders)
  if (!skipSuggestions && !weeklyExfoliants.some(isExfoliant)) {
    const sugExfoliant = findSug(isExfoliant);
    if (sugExfoliant) {
      if (!weeklyHtml) weeklyHtml += `<p style="margin-bottom:10px;font-size:17px;color:${tc.routineAccent}"><b>📅 Treatments</b></p>\n`;
      weeklyHtml += `<p style="margin-bottom:8px">👉 <b>Exfoliate:</b> We recommend ${productLink(sugExfoliant, userTheme)} — reply for a special new-customer discount with free shipping!</p>`;
    }
  }

  // ── Monthly Treatments (masks and targeted treatments) ─────────────────
  const hasMonthlyItems = monthlyMasks.length > 0 || treatments.length > 0;
  if (hasMonthlyItems) {
    weeklyHtml += `<p style="margin-bottom:10px;margin-top:14px;font-size:17px;color:${tc.routineAccent}"><b>📅 Monthly Treatments</b></p>\n`;

    monthlyMasks.forEach(p => {
      const freq = p.frequency || '1/month';
      const hasThermalSerum = p.id === 'hydrasphere-mineralift-thermal-mask' && selectedProducts.some(s => s.id === 'hydrasphere-mineralift-thermal-serum');

      if (hasThermalSerum) {
        // Step 1: mask application
        weeklyHtml += `<p style="margin-bottom:8px">✅ <b>${p.name}</b> (${freq}) — Thoroughly cleanse your face. Apply a thin layer to wet skin by gently massaging the chin, nose, forehead, and cheeks in a circular motion, avoiding the eye area.</p>`;
        // Step 2: serum into mask
        const serum = selectedProducts.find(s => s.id === 'hydrasphere-mineralift-thermal-serum');
        weeklyHtml += `<p style="margin-bottom:8px">✅ <b>Serum: ${serum.name}</b> — After applying the mask, apply several pumps over your face and neck, avoiding the eye area. Gently massage in an upward and outward motion into the mask until fully absorbed. You will experience a warming sensation in treated areas, which is normal. Leave this on for 10 minutes. Remove the mask and cleanse your skin.</p>`;
        // Step 3: cream (if purchased)
        const thermalCream = selectedProducts.find(s => s.id === 'hydrasphere-mineralift-thermal-cream');
        if (thermalCream) {
          weeklyHtml += `<p style="margin-bottom:8px">✅ <b>Moisturize: ${thermalCream.name}</b> — ${thermalCream.howToUse || ''}</p>`;
        }
      } else {
        weeklyHtml += `<p style="margin-bottom:8px">✅ <b>${p.name}</b> (${freq}) — ${p.howToUse || ''}</p>`;
      }
    });

    treatments.forEach(t => {
      const freq = t.frequency || 'as directed';
      weeklyHtml += `<p style="margin-bottom:8px">✅ <b>${productLink(t, userTheme)}</b> (${freq}, at night) — ${t.howToUse || ''}</p>`;
    });
  }

  // Suggest mask if none purchased (skip for small orders)
  if (!skipSuggestions && !monthlyMasks.length) {
    const sugMask = findSug(isMask);
    if (sugMask) {
      if (!weeklyHtml) weeklyHtml += `<p style="margin-bottom:10px;font-size:17px;color:${tc.routineAccent}"><b>📅 Monthly Treatments</b></p>\n`;
      weeklyHtml += `<p style="margin-bottom:8px">👉 <b>Mask:</b> We recommend ${productLink(sugMask, userTheme)} — reply for a special new-customer discount with free shipping!</p>`;
    }
  }

  // Close the PM div
  pmHtml += '</div>';

  // Wrap weekly in its own top-border section
  if (weeklyHtml) {
    weeklyHtml = `<div style="margin-top:16px;border-top:3px solid ${tc.routineAccent};padding-top:12px">${weeklyHtml}</div>`;
  }

  const routineSection = `<p style="margin-top:24px;margin-bottom:12px;font-size:20px"><b>🌿 Your Personalized Skincare Routine</b></p>\n${amHtml}\n${pmHtml}\n${weeklyHtml}`;

  // ── 4. Tips (customized based on products) ────────────────────────────
  const relevantTips = TIPS_BANK
    .filter(t => t.match(selectedProducts))
    .slice(0, 3) // Max 3 tips to keep it concise
    .map(t => t.tip);

  const tipsHtml = `<div style="margin-top:24px;padding:20px;background:${tc.tipsBg};border-left:4px solid ${tc.tipsBorder};border-radius:8px"><p style="margin-bottom:12px;font-size:20px"><b>💡 Tips for Your Routine</b></p>\n` +
    relevantTips.map(t => `<p style="margin-bottom:8px">• ${t}</p>`).join('\n') + '</div>';

  // ── 4b. Consultation invite (only if fewer than 3 products) ────────────
  const consultationHtml = selectedProducts.length < 5
    ? `<p style="margin-top:24px;margin-bottom:16px;padding:16px;background:${tc.consultBg};border-left:4px solid ${tc.consultBorder};border-radius:8px">💆 <b>Want a personalized skincare plan?</b> Since you're just getting started with your collection, we'd love to invite you in for a complimentary one-on-one consultation with one of our skincare specialists. We'll build a customized routine tailored to your skin type, goals, and lifestyle. Just reply to this email to book your visit — we'd love to see you!</p>`
    : '';

  // ── 5. Sign-off (randomly selected) ────────────────────────────────────
  const SIGNOFFS = [
    `<p style="margin-top:24px;margin-bottom:16px">Thank you so much for choosing ${companyName}, ${name}. We're truly honored to be part of your skincare journey. If you ever have questions about your products, your routine, or just want personalized advice — don't hesitate to reply to this email. We're always here for you!</p>
<p style="margin-bottom:16px">We'd also love to see you in person at our store in Santa Fe. Come say hi anytime — we're always happy to help you find your next favorite product. 💕</p>
<p style="margin-bottom:8px">With love,<br><b>The ${companyName} Team</b></p>`,

    `<p style="margin-top:24px;margin-bottom:16px">${name}, we're so grateful you chose ${companyName}. Your skin is in great hands! If you ever need help with your routine, have questions about a product, or just want to chat about skincare — we're only an email away.</p>
<p style="margin-bottom:16px">And if you're ever in Santa Fe, come visit us! We'd love to meet you in person and help you discover even more products you'll love. 🌟</p>
<p style="margin-bottom:8px">Cheers to your glow,<br><b>The ${companyName} Team</b></p>`,

    `<p style="margin-top:24px;margin-bottom:16px">We can't wait to hear how you love your new products, ${name}! Remember, beautiful skin is a journey — and we're right here with you every step of the way. Reply anytime with questions or just to share your results!</p>
<p style="margin-bottom:16px">Don't forget, our doors in Santa Fe are always open. Stop by for a personalized consultation or just to say hello — we love connecting with our customers in person. 💖</p>
<p style="margin-bottom:8px">Here's to your best skin ever,<br><b>The ${companyName} Team</b></p>`,

    `<p style="margin-top:24px;margin-bottom:16px">Thank you for trusting us with your skincare, ${name} — it means the world to us! We're always here if you need advice, want to tweak your routine, or are curious about a new product. Just hit reply and we'll get back to you personally.</p>
<p style="margin-bottom:16px">If you're ever passing through Santa Fe, our store is your home away from home. We'd love to pamper you in person! ✨</p>
<p style="margin-bottom:8px">Warmly,<br><b>The ${companyName} Team</b></p>`,

    `<p style="margin-top:24px;margin-bottom:16px">${name}, starting a new skincare routine is exciting — and we're honored to be part of yours! If anything comes up along the way, whether it's a question, a concern, or you just want to share your glow-up progress — please reach out. We genuinely care.</p>
<p style="margin-bottom:16px">And whenever you're in the Santa Fe area, come see us! There's nothing we love more than helping our customers find their perfect routine in person. 🌸</p>
<p style="margin-bottom:8px">With love and good vibes,<br><b>The ${companyName} Team</b></p>`,
  ];
  const signOffHtml = SIGNOFFS[Math.floor(Math.random() * SIGNOFFS.length)];

  // ── Assemble ──────────────────────────────────────────────────────────
  const emailBody = [welcomeHtml, synergyHtml, routineSection, tipsHtml, consultationHtml, signOffHtml].filter(Boolean).join('\n\n');

  return {
    customerEmail,
    customerName: name,
    selectedProducts,
    emailBody,
  };
}

// POST /api/welcome/generate — build the personalized welcome email preview
router.post('/generate', (req, res) => {
  try {
    const result = generateWelcomeEmailBody({ ...req.body, userId: req.session?.userId });
    res.json({
      success: true,
      customerEmail: result.customerEmail,
      customerName: result.customerName,
      selectedProducts: result.selectedProducts.map(p => ({ id: p.id, name: p.name, brand: p.brand })),
      emailBody: result.emailBody,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/welcome/send — send the welcome email via the logged-in user's Gmail
router.post('/send', async (req, res) => {
  const { customerEmail, customerName, products, emailBody } = req.body;

  if (!customerEmail || typeof customerEmail !== 'string') {
    return res.status(400).json({ error: 'customerEmail is required' });
  }
  if (!emailBody || typeof emailBody !== 'string') {
    return res.status(400).json({ error: 'emailBody is required' });
  }

  // Check session auth
  const userId = req.session?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Not logged in. Please sign in first.' });
  }

  const { getUser, updateUserTokens } = require('../db');
  const user = getUser(userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found. Please sign in again.' });
  }
  if (!user.refresh_token) {
    // Restore this company's own token from Postgres if SQLite lost it
    try {
      const rt = await pgDb.getGmailToken(userId);
      if (rt) { updateUserTokens(userId, null, rt); user.refresh_token = rt; }
    } catch (_) {}
  } else {
    // Back-fill an already-connected token so it survives future redeploys
    try {
      const rt = await pgDb.getGmailToken(userId);
      if (!rt) await pgDb.saveGmailToken(userId, user.refresh_token, user.email);
    } catch (_) {}
  }
  if (!user.refresh_token) {
    return res.status(403).json({ error: 'Gmail is not connected for this company. Please connect this company\'s Gmail first.', needsGmailConnect: true });
  }

  try {
    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: user.refresh_token });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const fromName = user.company_name || user.email;
    const subject = user.company_name
      ? `Welcome to ${user.company_name}!`
      : 'Welcome!';

    const messageParts = [
      `From: "${fromName}" <${user.email}>`,
      `To: ${customerEmail}`,
      `Subject: ${subject}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      '',
      emailBody,
    ];
    const rawMessage = messageParts.join('\r\n');
    const encodedMessage = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage },
    });

    // Log the exact email that was sent (for the Sent Emails tab)
    await pgDb.logSentEmail({
      user_id: userId, to_email: customerEmail, to_name: customerName || '',
      subject, body: emailBody, kind: 'welcome',
    });

    // Save to history (Postgres)
    await pgDb.saveWelcomeEmail({
      customer_name: customerName || '',
      customer_email: customerEmail,
      products: products || [],
      user_id: userId,
    });

    // Save to CRM (Postgres)
    const customer = await pgDb.findOrCreateCustomer(customerName || '', customerEmail, userId);
    if (products && products.length > 0) {
      const allProds = [...PRODUCTS.avologi, ...(PRODUCTS.avinichi || []), ...PRODUCTS.hydrasphere, ...(PRODUCTS.spacetouch || []), ...(PRODUCTS.lumieres || [])];
      const productRecords = products
        .map(name => allProds.find(p => p.name === name))
        .filter(Boolean)
        .map(p => ({ id: p.id, name: p.name }));
      if (productRecords.length > 0) {
        await pgDb.addCustomerProducts(customer.id, productRecords);
      }
    }

    res.json({ success: true, message: 'Email sent successfully' });
  } catch (err) {
    console.error('[welcome] Error sending email:', err.message);
    res.status(500).json({ error: 'Failed to send email: ' + err.message });
  }
});

// GET /api/welcome/history — list all sent welcome emails
router.get('/history', async (req, res) => {
  const userId = req.session?.userId;
  const emails = await pgDb.getWelcomeEmails(userId);
  res.json({
    emails: emails.map(e => ({
      id: e.id,
      customerName: e.customer_name,
      customerEmail: e.customer_email,
      products: typeof e.products === 'string' ? JSON.parse(e.products || '[]') : (e.products || []),
      sentAt: e.sent_at,
    })),
  });
});

// GET /api/welcome/sent — list all emails sent to customers (metadata only)
router.get('/sent', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const emails = await pgDb.getSentEmails(userId);
  res.json({ emails });
});

// GET /api/welcome/sent/:id — the exact email that was sent (with body)
router.get('/sent/:id', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const email = await pgDb.getSentEmail(parseInt(req.params.id), userId);
  if (!email) return res.status(404).json({ error: 'Email not found' });
  res.json({ email });
});

// GET /api/welcome/campaigns — list past campaigns
router.get('/campaigns', async (req, res) => {
  const userId = req.session?.userId;
  const campaigns = await pgDb.getCampaigns(userId);
  res.json({
    campaigns: campaigns.map(c => ({
      id: c.id,
      subject: c.subject,
      body: c.body,
      recipientCount: c.recipient_count,
      sentAt: c.sent_at,
    })),
  });
});

// POST /api/welcome/campaign — send a marketing campaign to all customers
router.post('/campaign', async (req, res) => {
  const { subject, body } = req.body;

  if (!subject || typeof subject !== 'string' || !subject.trim()) {
    return res.status(400).json({ error: 'Subject is required' });
  }
  if (!body || typeof body !== 'string' || !body.trim()) {
    return res.status(400).json({ error: 'Email body is required' });
  }

  const userId = req.session?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Not logged in. Please sign in first.' });
  }

  const { getUser, updateUserTokens } = require('../db');
  const user = getUser(userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found. Please sign in again.' });
  }
  if (!user.refresh_token) {
    try {
      const rt = await pgDb.getGmailToken(userId);
      if (rt) { updateUserTokens(userId, null, rt); user.refresh_token = rt; }
    } catch (_) {}
  }
  if (!user.refresh_token) {
    return res.status(403).json({ error: 'Gmail is not connected for this company. Please connect this company\'s Gmail first.', needsGmailConnect: true });
  }

  // Support targeted email list or fall back to all customers
  const { emails: targetEmails } = req.body;
  const customerEmails = (Array.isArray(targetEmails) && targetEmails.length > 0)
    ? targetEmails.filter(e => typeof e === 'string' && e.includes('@'))
    : await pgDb.getUniqueCustomerEmails(userId);
  if (customerEmails.length === 0) {
    return res.status(400).json({ error: 'No customer emails found. Send some welcome emails first to build your contact list.' });
  }

  try {
    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: user.refresh_token });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const fromName = user.company_name || user.email;

    let sentCount = 0;
    const errors = [];

    for (const email of customerEmails) {
      try {
        const messageParts = [
          `From: "${fromName}" <${user.email}>`,
          `To: ${email}`,
          `Subject: ${subject.trim()}`,
          'Content-Type: text/html; charset=utf-8',
          'MIME-Version: 1.0',
          '',
          body,
        ];
        const rawMessage = messageParts.join('\r\n');
        const encodedMessage = Buffer.from(rawMessage)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: encodedMessage },
        });
        sentCount++;
      } catch (err) {
        console.error(`[campaign] Failed to send to ${email}:`, err.message);
        errors.push({ email, error: err.message });
      }
    }

    // Save campaign record
    await pgDb.saveCampaign({
      subject: subject.trim(),
      body,
      recipient_count: sentCount,
      user_id: userId,
    });

    res.json({
      success: true,
      sentCount,
      totalRecipients: customerEmails.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('[campaign] Error:', err.message);
    res.status(500).json({ error: 'Failed to send campaign: ' + err.message });
  }
});

// ─── CRM: Customer endpoints ──────────────────────────────────────────────────

// GET /api/welcome/customers — list all customers with their products
router.get('/customers', async (req, res) => {
  const userId = req.session?.userId;
  const { product, products } = req.query;

  let customers;
  if (products) {
    const productIds = products.split(',').map(s => s.trim()).filter(Boolean);
    customers = productIds.length > 0 ? await pgDb.getCustomersByProducts(productIds, userId) : await pgDb.getCustomers(userId);
  } else if (product) {
    customers = await pgDb.getCustomersByProduct(product, userId);
  } else {
    customers = await pgDb.getCustomers(userId);
  }
  res.json({ customers });
});

// Ensure a customer belongs to the current company (data isolation).
function ownsCustomer(customer, userId) {
  return customer && (!customer.user_id || !userId || customer.user_id === userId);
}

// GET /api/welcome/customers/:id — get single customer
router.get('/customers/:id', async (req, res) => {
  const customer = await pgDb.getCustomer(parseInt(req.params.id));
  if (!customer || !ownsCustomer(customer, req.session?.userId)) return res.status(404).json({ error: 'Customer not found' });
  res.json({ customer });
});

// PATCH /api/welcome/customers/:id/notes — update customer notes (legacy)
router.patch('/customers/:id/notes', async (req, res) => {
  const { notes } = req.body;
  if (typeof notes !== 'string') return res.status(400).json({ error: 'notes is required' });
  const customer = await pgDb.getCustomer(parseInt(req.params.id));
  if (!customer || !ownsCustomer(customer, req.session?.userId)) return res.status(404).json({ error: 'Customer not found' });
  await pgDb.updateCustomerNotes(parseInt(req.params.id), notes);
  res.json({ success: true });
});

// PATCH /api/welcome/customers/:id — update any customer fields
router.patch('/customers/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const customer = await pgDb.getCustomer(id);
  if (!customer || !ownsCustomer(customer, req.session?.userId)) return res.status(404).json({ error: 'Customer not found' });

  const { name, email, phone, address, notes } = req.body;
  await pgDb.updateCustomer(id, { name, email, phone, address, notes });
  res.json({ success: true, customer: await pgDb.getCustomer(id) });
});

// POST /api/welcome/customers/from-email — create or update customer from inbox email
router.post('/customers/from-email', async (req, res) => {
  const userId = req.session?.userId;
  const { email, name, phone, address } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  const customer = await pgDb.findOrCreateCustomer(name || '', email, userId);
  const updates = {};
  if (phone) updates.phone = phone;
  if (address) updates.address = address;
  if (name && name !== customer.name) updates.name = name;
  if (Object.keys(updates).length > 0) {
    await pgDb.updateCustomer(customer.id, updates);
  }
  res.json({ success: true, customerId: customer.id });
});

// GET /api/welcome/products/list — list all product IDs/names for filtering
router.get('/products/list', (req, res) => {
  const allProducts = [...PRODUCTS.avologi, ...(PRODUCTS.avinichi || []), ...PRODUCTS.hydrasphere, ...(PRODUCTS.spacetouch || []), ...(PRODUCTS.lumieres || [])];
  res.json({
    products: allProducts.map(p => ({ id: p.id, name: p.name, brand: p.brand })),
  });
});

// POST /api/welcome/customers/import — import a single customer from CSV
router.post('/customers/import', async (req, res) => {
  const userId = req.session?.userId;
  const { email, name, phone, address, notes } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  const customer = await pgDb.findOrCreateCustomer(name || '', email, userId);

  const updates = {};
  if (name) updates.name = name;
  if (phone) updates.phone = phone;
  if (address) updates.address = address;
  if (notes) updates.notes = notes;
  if (Object.keys(updates).length > 0) {
    await pgDb.updateCustomer(customer.id, updates);
  }

  res.json({ success: true, id: customer.id });
});

// GET /api/welcome/debug — check DB and connected users
router.get('/debug', (req, res) => {
  const { getAllUsers } = require('../db');
  const fs = require('fs');
  const path = require('path');
  const users = getAllUsers();

  // Check filesystem to verify volume mount
  const dbFile = path.resolve(process.env.DATABASE_PATH || './data/glow.db');
  const dbDir = path.dirname(dbFile);
  let fsInfo = {};
  try {
    const stats = fs.statSync(dbFile);
    fsInfo = {
      dbFileExists: true,
      dbFileSize: stats.size,
      dbFilePath: dbFile,
      dbDir: dbDir,
      dbDirContents: fs.readdirSync(dbDir),
      cwd: process.cwd(),
    };
  } catch (e) {
    fsInfo = { dbFileExists: false, error: e.message, dbFilePath: dbFile, cwd: process.cwd() };
  }

  // Check if /app/data is a mount point (different device from /app)
  try {
    const appStat = fs.statSync('/app');
    const dataStat = fs.statSync('/app/data');
    fsInfo.isMountPoint = appStat.dev !== dataStat.dev;
  } catch (e) {
    fsInfo.isMountPoint = 'unknown: ' + e.message;
  }

  res.json({
    dbPath: process.env.DATABASE_PATH || './data/glow.db (default)',
    hasGlowRefreshToken: !!process.env.GLOW_GMAIL_REFRESH_TOKEN,
    userCount: users.length,
    users: users.map(u => ({ id: u.id, email: u.email, hasAccessToken: !!u.access_token, hasRefreshToken: !!u.refresh_token })),
    fs: fsInfo,
  });
});

module.exports = { router, PRODUCTS, generateWelcomeEmailBody };
