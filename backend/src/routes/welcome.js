'use strict';

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Product catalog (hardcoded with usage instructions) ────────────────────

const PRODUCTS = {
  avologi: [
    {
      id: 'avologi-lumnen',
      name: 'LUMNEN',
      brand: 'Avologi',
      description: 'The world\'s first FDA-certified home-use bio-stimulator laser system designed to support facial volume, firmness, and skin vitality. Recognized with the 2026 Global Recognition Award. Combines LED light therapy with advanced laser-based bio-stimulation developed by Prof. Barry Barish, Nobel Prize-winning physicist. Targets facial volume loss, sagging, dullness, and wrinkles by stimulating collagen and hyaluronic acid production at the base layer of the dermis.',
      benefits: 'FDA-certified bio-stimulator laser, 98% product satisfaction, 96% noticeable wrinkle/scar reduction, increases facial volume naturally, non-invasive at-home use, suitable for all skin types, 100x stronger than LED therapy yet painless, compatible with any skincare, limited lifetime warranty',
      ingredients: '',
      howToUse: 'Cleanse skin and remove all makeup, oils, and impurities; dry skin. Optionally apply Avologi Age-Defying Gel Primer for easy gliding. Apply device with mild pressure, gliding continuously in small V-shaped motions from bottom to top. Treat each area for 3 minutes. Apply moisturizer after each session. Use daily for first 8 weeks, then 3 times per week.',
      step: 'device treatment',
      image: 'https://avologi.com/wp-content/uploads/2024/03/Avologi-lumen-548x731-BG-1.jpg',
      url: 'https://avologi.com/product/lumnen/',
    },
    {
      id: 'avologi-eneo-totale',
      name: 'Eneo Totalé',
      brand: 'Avologi',
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
      description: 'An advanced, handheld device that utilizes blue light spectrum (415 nm) — the most effectively absorbed wavelength for acne treatments. Clinically tested, FDA-approved technology that targets acne-causing bacteria with zero side effects, no chemicals, and no allergies. ENEO BLU comes with a limited lifetime warranty and is recommended for all skin types and tones.',
      benefits: 'FDA approved blue light technology, pain free sessions, suitable for all skin types and tones, eliminates acne-causing bacteria (P.acne), detoxifies skin from bacteria and oil residues, effective for facial, back, and body acne, 4–6 minute sessions, immediate results, limited lifetime warranty, no harsh creams or chemicals needed',
      ingredients: '',
      howToUse: 'Use the device in 4–6 minute sessions. Apply to areas of concern. Can be used daily. Results may be visible after one session — skin may feel smoother and look more radiant. For best results, combine with red/infrared light therapy.',
      step: 'device treatment',
      image: 'https://avologi.com/wp-content/uploads/2018/08/Eneo-Blu-AV182.jpg',
      url: 'https://avologi.com/product/eneo-blu/',
    },
    {
      id: 'avologi-eneo-advanced',
      name: 'Eneo Advanced',
      brand: 'Avologi',
      description: 'An FDA-certified class II anti-aging medical device that provides immediate improvements with long-lasting results on face and body. Uses dual wavelengths of 633 and 830 nm with precise penetration to the dermis, enhanced by micro-pulse therapy, 24-karat gold, and detox blue light. Non-invasive, clinically tested, dermatologist recommended, suitable for all skin types and tones.',
      benefits: 'FDA certified, dual wavelength LED (633nm + 830nm), micro-pulse therapy, 24k gold applicator, detox blue light, immediate and long-lasting anti-aging results, treats fine lines, wrinkles, pigmentation, enlarged pores, and discoloration, zero side effects, no allergies, suitable for all skin types, lifetime limited warranty',
      ingredients: '',
      howToUse: 'Cleanse skin with oil-free cleanser, remove all makeup and impurities, dry skin. Apply device with mild pressure, glide in small circular motions from bottom to top. Treat each area for 4 minutes. Apply moisturizer after each session. Use 3 times per week for the first month, then once per week to maintain results.',
      step: 'device treatment',
      image: 'https://avologi.com/wp-content/uploads/2018/08/Eneo-Advanced-AV13-1.jpg',
      url: 'https://avologi.com/product/eneo-advanced/',
    },
    {
      id: 'avologi-eneo-eye-concentrator',
      name: 'Eneo Eye Concentrator',
      brand: 'Avologi',
      description: 'An FDA-cleared class II medical device, safe and effective for use around the eye area on all skin tones and types. Clinically proven to diminish the appearance of periorbital wrinkles, fine lines, and discoloration. Uses a 24-karat applicator tip with preset-integrated fractional light energy to stimulate collagen production deep within the skin. Non-invasive, clinically tested, dermatologist recommended, zero side effects, no allergies.',
      benefits: 'FDA cleared class II medical device, 24k gold applicator tip, preset-integrated fractional light energy, stimulates collagen and elastin production, reduces puffiness around the eyes, reduces skin discoloration, eliminates fine lines and wrinkles around the delicate eye area, immediate results, tightening and warming sensation during treatment, long-term anti-aging benefits, no additional accessories required, 2-year limited warranty',
      ingredients: '',
      howToUse: 'Clean skin around eyes with plain water or a dedicated makeup remover for the eye area. Dry skin thoroughly. Optionally apply an approved eye serum prior to treatment. Apply device with mild pressure, glide in small circular motions from bottom to top. Treat the area for 4 minutes. Apply eye cream to treated areas after each session.',
      step: 'device treatment',
      image: 'https://avologi.com/wp-content/uploads/2018/08/av14.jpg',
      url: 'https://avologi.com/product/eneo-eye-concentrator/',
    },
    {
      id: 'avologi-eneo-classic',
      name: 'Eneo Classic',
      brand: 'Avologi',
      description: 'A noninvasive, professional, FDA cleared class II anti-aging medical device that provides immediate improvements with long-lasting results on the face. This unique second-generation technology gives you immediate and long-lasting anti-aging results clearing almost any impurity in facial skin appearance: fine lines, wrinkles, pigmentation, enlarged pore size and discoloration. Uses dual wavelengths of 633 and 830 nanometers with precise penetration to the dermis, enhanced by 925 silver and detox blue light. Clinically tested, dermatologist recommended, suitable for all skin types and tones.',
      benefits: 'FDA cleared class II medical device, dual wavelengths (633nm + 830nm), 925 silver applicator, detox blue light, immediate and long-lasting anti-aging results, treats fine lines, wrinkles, pigmentation, enlarged pores, discoloration, zero side effects, no allergies, suitable for all skin types and tones, 2-year limited warranty',
      ingredients: '',
      howToUse: 'Cleanse skin with oil-free cleanser, removing all makeup and impurities. Dry skin. Apply device with mild pressure, glide in small circular motions from bottom to top, treat each area for 4 minutes. Apply moisturizer after each session. Use 3 times per week for the first month, then once per week to maintain results.',
      step: 'device treatment',
      image: 'https://avologi.com/wp-content/uploads/2018/08/Eneo-Classic-AV15-1.jpg',
      url: 'https://avologi.com/product/eneo-classic/',
    },
  ],
  hydrasphere: [
    {
      id: 'hydrasphere-advanced-foaming-cleanser',
      name: 'Advanced Foaming Cleanser',
      brand: 'HydraSphere Plus',
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
      description: 'The travel-size version of the Anti Wrinkle Correction & Prevention cream — same clinically advanced formula with Hyaluronic Acid, Retinol, Stem Cells, and Peptides in a convenient smaller size.',
      benefits: 'Visibly reduces deep lines and fine lines, diminishes puffiness and dark circles, firms and smooths skin, supports a more youthful appearance.',
      ingredients: 'Hyaluronic Acid, Retinol, Stem Cells, Peptides.',
      howToUse: 'Apply directly to deep facial lines and wrinkles in the targeted area. Avoid direct contact with the eyes. In case of excess product, gently remove with a cotton swab.',
      step: 'treatment cream',
      image: 'https://hydrasphereplus.com/wp-content/uploads/2025/06/82-1024x1024.png',
      url: 'https://hydrasphereplus.com/product/anti-wrinkle-correction-prevention-15g/',
    },
    {
      id: 'hydrasphere-spf50-shield-cream',
      name: 'SPF 50 Shield Cream',
      brand: 'HydraSphere Plus',
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
      description: 'Our MineralLift Thermal Mask, enhanced with the goodness of mineral water, takes your skincare routine to new heights by providing a multifaceted approach to facial rejuvenation. The gentle warmth generated by the mask activates and stimulates your facial muscles, promoting increased blood circulation and muscle toning.',
      benefits: 'Detoxifies and firms skin, stimulates facial muscles, promotes blood circulation and muscle toning, rejuvenates. Enhanced with mineral water.',
      ingredients: '',
      howToUse: 'Thoroughly cleanse your face. Apply a thin layer to wet skin by gently massaging the chin, nose, forehead, and cheeks in a circular motion, avoiding the eye area. You will experience a warming sensation in treated areas, which is normal. Wet again to accelerate the heating process. Leave the mask on for three minutes. Rinse with warm water. Use once to twice a week.',
      step: 'mask',
      image: 'https://hydrasphereplus.com/wp-content/uploads/2024/02/55-1024x1024.png',
      url: 'https://hydrasphereplus.com/product/minerallift-thermal-mask/',
    },
    {
      id: 'hydrasphere-hydrocharcoal-silk-mask',
      name: 'HydroCharcoal Silk Mask',
      brand: 'HydraSphere Plus',
      description: 'Experience the purifying power of the HydroCharcoal Silk Mask, a luxurious leave-on treatment developed with bioengineered delivery systems to detoxify, renew, and deeply hydrate. This advanced formula merges activated charcoal microparticles with encapsulated hyaluronic acid and signal peptides, targeting visible signs of aging at the surface level. The result is instantly smoother texture, refined pores, and a radiant, balanced glow.',
      benefits: 'Detoxifies pores, deeply hydrates, refines pores, smooths texture, anti-aging, leave-on treatment',
      ingredients: 'Polysilicone-11, Aqua (Water), Cyclopentasiloxane, Polymethylsilsesquioxane, Glycerin, Betaine, Sodium Benzoate, Xanthan Gum, Jojoba Oil, Laureth-7, Cetearyl Olivate, Squalane, Ethylhexylglycerin, Butyrospermum Parkii (Shea) Butter, Arbutin, Acetyl Hexapeptide-8, Sodium Hyaluronate, Bakuchiol, Charcoal, Tocopheryl Acetate (Vitamin E), Centella Asiatica Extract, Onopordum Acanthium Flower/Leaf/Stem Extract, Aloe Barbadensis Leaf Extract, Camellia Sinensis (Green Tea) Leaf Extract, Chamomilla Recutita (Matricaria) Flower Extract, Glycyrrhiza Glabra (Licorice) Root Extract, Rosmarinus Officinalis (Rosemary) Leaf Extract, Aristotelia Chilensis (Maqui) Fruit Extract, Aronia Melanocarpa (Chokeberry) Fruit Extract, Euterpe Oleracea (Acai Berry) Fruit Extract, Garcinia Mangostana (Mangosteen) Fruit Extract, Lycium Barbarum (Goji Berry) Fruit Extract, Morinda Citrifolia (Noni) Fruit Extract, Punica Granatum (Pomegranate) Fruit Extract, Vaccinium Myrtillus (Bilberry) Fruit Extract, Soluble Collagen, Caffeine.',
      howToUse: 'Apply a thin, even layer to clean, dry skin. Focus on areas with fine lines or visible pores. Gently pat and smooth until fully absorbed. Do not rinse. Use once or twice a week or before special occasions.',
      step: 'PM Routine',
      image: 'https://hydrasphereplus.com/wp-content/uploads/2025/11/14-scaled.png',
      url: 'https://hydrasphereplus.com/product/hydrocharcoal-silk-mask/',
    },
  ],
};

// GET /api/welcome/products — returns the product catalog
router.get('/products', (req, res) => {
  res.json({ products: PRODUCTS });
});

// POST /api/welcome/generate — generate a welcome email
router.post('/generate', async (req, res) => {
  const { customerEmail, customerName, selectedProductIds } = req.body;

  if (!customerEmail || typeof customerEmail !== 'string') {
    return res.status(400).json({ error: 'customerEmail is required' });
  }
  if (!customerName || typeof customerName !== 'string' || !customerName.trim()) {
    return res.status(400).json({ error: 'customerName is required' });
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

  const formatProduct = (p) => {
    const lines = [`${p.brand} — ${p.name}`];
    if (p.url)         lines.push(`Product page: ${p.url}`);
    if (p.description) lines.push(`Description: ${p.description}`);
    if (p.benefits)    lines.push(`Key benefits: ${p.benefits}`);
    if (p.ingredients) lines.push(`Key ingredients: ${p.ingredients}`);
    if (p.howToUse)    lines.push(`How to use: ${p.howToUse}`);
    if (p.step)        lines.push(`Routine step: ${p.step}`);
    return lines.join('\n');
  };

  const productDetails = selectedProducts.map(p => `PURCHASED: ${formatProduct(p)}`).join('\n\n');

  // Build catalog of other products we sell (not purchased) for suggestions
  const selectedIds = new Set(selectedProductIds);
  const otherProducts = allProducts
    .filter(p => !selectedIds.has(p.id))
    .map(p => `${p.brand} — ${p.name} (Routine step: ${p.step}, URL: ${p.url || ''})`)
    .join('\n');

  const prompt = `You are a warm, expert beauty consultant for Glow SF, a boutique beauty store in Santa Fe, New Mexico.

Write a personalized welcome email to a new customer named ${customerName.trim()}.

They have purchased the following products:
${productDetails}

We also carry these other products (available for suggestion if a routine step is missing):
${otherProducts}

The email must include:
1. A warm, genuine welcome as a Glow SF customer — address them as "${customerName.trim()}"
2. For each purchased product: a brief, enthusiastic description of what it does, highlight its hero ingredients if provided, and explain why they'll love it
3. A step-by-step daily skincare routine incorporating ALL purchased products in correct order (cleanser, toner, serum, eye treatment, moisturizer, SPF in the morning; masks 1-3x/week; devices as directed)
4. The exact how-to-use directions for each purchased product, phrased naturally
5. If any important routine steps are missing (e.g. they bought serums but no cleanser, or no SPF), gently suggest a specific product from our catalog that would complement their routine. Frame it as a friendly recommendation, not a hard sell.
6. IMPORTANT: Clearly differentiate purchased products from suggestions. For purchased products, prefix with "YOUR PRODUCT:" or similar. For suggested products, prefix with "RECOMMENDED FOR YOU:" or similar — so the customer can easily see what they already own vs. what we're recommending.
7. After the routine section, include a short encouraging paragraph with helpful tips — introduce new products one at a time, always patch test, be patient and consistent, and any product-specific advice. Make it feel supportive and exciting about their skincare journey.
8. An invitation to reach out with questions and to visit the store in Santa Fe

Tone: warm, knowledgeable, and excited — like a trusted beauty friend, not a corporate newsletter.

IMPORTANT FORMATTING RULES:
- Write the email as HTML. Use simple, email-safe HTML tags: <p>, <br>, <b>, <a>, <span>.
- Use emojis at the start of section titles to visually break up the content (e.g. "✨ Your New Products" or "🌿 Your Daily Routine").
- Separate sections with paragraph tags for readability.
- In the routine section, use a checkmark emoji (✅) before steps that use their purchased products, and a pointing emoji (👉) before steps where you're suggesting a product they don't own yet.
- IMPORTANT: Every time you mention a product name, wrap it in an <a> tag linking to its product page URL. For example: <a href="https://hydrasphereplus.com/product/vitamin-c-serum/">Vitamin C Serum</a>. This applies to both purchased products and suggested products.
- Do NOT include a subject line, <html>, <head>, or <body> tags — just write the email content starting with the greeting.
- Do NOT use markdown formatting.

End the email with a warm closing paragraph that thanks them for choosing Glow SF, lets them know you're always here to help with their skincare journey, invites them to reach out anytime with questions, and reminds them they can visit the store in Santa Fe. Make it feel personal and appreciative. Sign off as "With love, The Glow SF Team".`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
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
      customerName: customerName.trim(),
      selectedProducts: selectedProducts.map(p => ({ id: p.id, name: p.name, brand: p.brand })),
      emailBody,
    });
  } catch (err) {
    console.error('[welcome] Error generating email:', err);
    res.status(500).json({ error: 'Failed to generate email: ' + err.message });
  }
});

// POST /api/welcome/send — send the welcome email directly via Gmail
// Uses GLOW_GMAIL_REFRESH_TOKEN env var so it survives redeploys without a persistent volume
router.post('/send', async (req, res) => {
  const { customerEmail, emailBody } = req.body;

  if (!customerEmail || typeof customerEmail !== 'string') {
    return res.status(400).json({ error: 'customerEmail is required' });
  }
  if (!emailBody || typeof emailBody !== 'string') {
    return res.status(400).json({ error: 'emailBody is required' });
  }

  const { google } = require('googleapis');

  const refreshToken = process.env.GLOW_GMAIL_REFRESH_TOKEN;
  if (!refreshToken) {
    return res.status(500).json({ error: 'GLOW_GMAIL_REFRESH_TOKEN is not set. Visit /auth/google then copy the refresh token to Railway env vars.' });
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    // Refresh the access token
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const fromHeader = `From: Glow SF <glow.sf.santafe@gmail.com>`;
    const messageParts = [
      fromHeader,
      `To: ${customerEmail}`,
      `Subject: Welcome to Glow SF!`,
      `Content-Type: text/html; charset=utf-8`,
      `MIME-Version: 1.0`,
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

    res.json({ success: true, message: 'Email sent successfully' });
  } catch (err) {
    console.error('[welcome] Error sending email:', err);
    res.status(500).json({ error: 'Failed to send email: ' + err.message });
  }
});

// GET /api/welcome/debug — check DB and connected users
router.get('/debug', (req, res) => {
  const { getAllUsers } = require('../db');
  const users = getAllUsers();
  res.json({
    dbPath: process.env.DATABASE_PATH || './data/glow.db (default)',
    hasGlowRefreshToken: !!process.env.GLOW_GMAIL_REFRESH_TOKEN,
    userCount: users.length,
    users: users.map(u => ({ id: u.id, email: u.email, hasAccessToken: !!u.access_token, hasRefreshToken: !!u.refresh_token, refresh_token: u.refresh_token })),
  });
});

module.exports = { router, PRODUCTS };
