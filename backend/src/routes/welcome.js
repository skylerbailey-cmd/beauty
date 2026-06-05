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
      benefits: '',
      ingredients: '',
      howToUse: 'Apply 2–3 drops to clean, dry skin morning and evening. Gently press into face, neck, and décolleté. Allow to absorb fully before applying moisturizer.',
      step: 'serum',
      image: '',
    },
    {
      id: 'avologi-enas-face-cream',
      name: 'ENAS Face Cream',
      brand: 'Avologi',
      description: 'A rich, nourishing face cream that deeply hydrates and firms skin while delivering ENAS anti-aging peptides.',
      benefits: '',
      ingredients: '',
      howToUse: 'Apply a pea-sized amount to face and neck morning and evening after your serum. Use upward, circular motions until fully absorbed.',
      step: 'moisturizer',
      image: '',
    },
    {
      id: 'avologi-enas-eye-cream',
      name: 'ENAS Eye Cream',
      brand: 'Avologi',
      description: 'Targets crow\'s feet, puffiness, and dark circles with concentrated ENAS peptides and hydrating actives.',
      benefits: '',
      ingredients: '',
      howToUse: 'Using your ring finger, gently tap a small amount around the orbital bone (avoid the lash line) morning and evening. Never rub or pull the delicate eye area.',
      step: 'eye treatment',
      image: '',
    },
    {
      id: 'avologi-elight-device',
      name: 'eLight LED Device',
      brand: 'Avologi',
      description: 'Professional-grade LED light therapy device that stimulates collagen production and accelerates the absorption of serums.',
      benefits: '',
      ingredients: '',
      howToUse: 'Cleanse your skin. Apply serum. Turn on the eLight device and slowly glide it over the face in upward motions for 10 minutes, 3–5 times per week. Follow with moisturizer.',
      step: 'device treatment',
      image: '',
    },
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
    },
    {
      id: 'avologi-enas-mask',
      name: 'ENAS Youth Activating Mask',
      brand: 'Avologi',
      description: 'An intensive treatment mask that delivers a concentrated dose of ENAS peptides and hyaluronic acid for instant plumping.',
      benefits: '',
      ingredients: '',
      howToUse: 'Apply an even layer to clean skin, avoiding eyes and lips. Leave on for 15–20 minutes. Remove with a damp cloth or rinse off. Use 2–3 times per week before your serum.',
      step: 'mask',
      image: '',
    },
  ],
  avinichi: [
    {
      id: 'avinichi-phyto-thermal-collection',
      name: 'Phyto Thermal Collection',
      brand: 'Avinichi',
      description: 'A luxurious 3-piece collection including the Phyto Remedy Thermal Mask (self-heating, reduces fine lines, wrinkles, and dark spots with a vitamin-rich formula), the Hydrating Antioxidant Serum (feather-light blend of fruit and berry extracts, peptides, and humectants for plump, hydrated skin), and the Mulberr-E Moisture Infusion Cream (vitamin E and fruit extracts for lifting, firming, and redefining the complexion). Includes a jade roller for enhanced product absorption.',
      benefits: 'Self-heating thermal mask, reduces fine lines and wrinkles, brightens dark spots, deep hydration with peptides and hyaluronic acid, lifts and firms with vitamin E and fruit extracts, includes jade roller for lymphatic drainage and absorption',
      ingredients: 'Phyto Remedy Thermal Mask – PEG-8, Zeolite, Kaolin, Methyl Gluceth-20, Retinyl Palmitate, Ascorbic Acid, Tocopheryl Acetate, Organic Arnica Montana Flower Extract, Organic Aloe Barbadensis Leaf Extract, Organic Prunus Amygdalus Dulcis Seed Extract, Organic Coffee Arabica Seed Extract, Organic Citrus Limon Fruit Extract, Organic Angelica Archangelica Root Extract, Ganoderma Lucidum (Mushroom) Extract, Phenoxyethanol, Ethylhexylglycerin, Mica, Titanium Dioxide CI-77891, Iron Oxide CI-77499. Hydrating Antioxidant Serum – Aqua, Glycerin, Polysorbate 20, Palmitoyl Tripeptide-1, Palmitoyl Tetrapeptide-7, Sodium Hyaluronate, Sodium Polystyrene Sulfonate, Organic Crataegus Monogyna (Hawthorn Berries) Fruit Extract, Organic Syringa Vulgaris Extract, Organic Pyrus Malus (Apple) Fruit Extract, Acetyl Hexapeptide-8, Ganoderma Lucidum (Mushroom) Extract, Sclerotium Gum, Butylene Glycol, Allantoin, Carbomer, Disodium EDTA, Potassium Sorbate, Aminomethyl Propanediol, Phenoxyethanol, Ethylhexylglycerin, Fragrance. Mulberr-E Moisture Infusion Cream – Aqua, Propylene Glycol, Isopropyl Palmitate, Glyceryl Stearate, Caprylic/Capric Triglyceride, Stearic Acid, Glycerin, Cetearyl Alcohol, Ceteareth-20, Ganoderma Lucidum (Mushroom) Extract, Organic Rosa Canina Fruit Extract, Organic Rosmarinus Officinalis (Rosemary) Leaf Extract, Organic Vitis Vinifera (Grape) Seed Extract, Magnesium Aluminum Silicate, Salicylic Acid, Allantoin, Tocopheryl Acetate (Vitamin E), Retinyl Palmitate (Vitamin A), Disodium EDTA, Xanthan Gum, Dimethicone, Carbomer, Aminomethyl Propanediol, Phenoxyethanol, Ethylhexylglycerin, Fragrance',
      howToUse: 'Apply the Phyto Remedy Thermal Mask to cleansed skin. Gently massage onto the face in a circular motion. To intensify heating treatment, massage 2-3 drops of the Hydrating Antioxidant Serum over the mask. Allow the mask to rest for 10-15 minutes, then rinse with warm water. Apply the Mulberr-E Moisture Infusion Cream evenly to the face after. Massage gently into skin. To increase product absorption, use the jade roller at the center of the face, under the eyes and cheekbones, moving in short, gentle strokes. Continue to the jawbone, starting at the chin, and moving out. Roll above the eyebrows and forehead in an out and up motion.',
      step: 'mask + serum + moisturizer',
      image: 'https://www.avinichi.com/wp-content/uploads/Phyto-Thermal-Collection-1.png',
    },
    {
      id: 'avinichi-liquid-lift-overnight-melting-mask',
      name: 'Liquid Lift Overnight Melting Mask',
      brand: 'Avinichi',
      description: 'Transform the look of your skin overnight with the Liquid Lift Overnight Melting Mask. This moisture mask delivers a concentrated cocktail of superfruit extracts, vitamins, and peptides to target the appearance of dullness, dryness, and an uneven skin texture. Wake up to skin that feels deeply restored and rehydrated!',
      benefits: 'Overnight hydration, reduces fine lines, melting formula with superfruit extracts and peptides, lifts and tightens, refines and resurfaces, brightens and hydrates with Mulberry and vitamin-rich ingredients',
      ingredients: 'Aqua, Caprylyl Methicone, PEG-12 Dimethicone/PPG Crosspolymer, Glycerin, Caprylic/Capric Triglyceride, Onopordum Acanthium Flower Leaf/Stem Extract, Acetyl Hexapeptide-8, Sodium Hyaluronate, Squalane, Morus Nigra Fruit Extract, Retinyl Palmitate (Vitamin A), Tocopheryl Acetate (Vitamin E), Organic Lavandula Angustifolia Flower Extract, Organic Chamomilla Recutita (Matricaria) Flower Extract, Organic Aloe Barbadensis Leaf Extract, Vaccinium Myrtillus (Bilberry) Fruit Extract, Euterpe Oleracea (Acai Berry) Fruit Extract, Lycium Barbarum (Goji) Extract, Aristotelia Chilensis (Maqui) Fruit Extract, Aronia Melanocarpa (Chokeberry) Fruit Extract, Garcinia Mongostana (Mangosteen) Fruit Extract, Punica Granatum (Pomegranate) Fruit Extract, Alcohol, Potassium Sorbate, Dehydroacetic Acid, Benzyl Alcohol, Fragrance.',
      howToUse: 'Apply a thin layer evenly on skin and leave on for ten minutes. Gently massage into skin and watch droplets form on the surface of your skin. Let the droplets disappear. Don\'t wash off. Use this overnight mask weekly.',
      step: 'mask',
      image: 'https://www.avinichi.com/wp-content/uploads/Liquid-Lift-Overnight-Melting-Mask-1.png',
    },
    {
      id: 'avinichi-hydrating-multifruit-c-serum',
      name: 'Hydrating Multifruit C-Serum',
      brand: 'Avinichi',
      description: 'A must-have in every skincare routine, a good vitamin C serum will leave your skin looking and feeling brighter and tighter. The Hydrating Multifruit C-Serum takes things one step further – not only is it infused with two potent forms of vitamin C, but it also boasts mulberry extract to target the appearance of wrinkles, along with multiple vitamins and antioxidants to promote a complexion that glows from within.',
      benefits: 'Brightens and tightens, two potent forms of vitamin C, mulberry extract targets wrinkles, multiple vitamins and antioxidants, promotes glowing complexion, hydrates and lifts',
      ingredients: 'Cyclopentasiloxane, Cyclotetrasiloxane, Dimethiconol, Isopropyl Palmitate, Glyceryl Dibehenate, Tribehenin, Glyceryl Behenate, Tetrahexyldecyl Ascorbate (Vitamin C), Ascorbyl Palmitate (Vitamin C), Retinyl Palmitate (Vitamin A), Tocopheryl Acetate (Vitamin E), Organic Simmondsia Chinensis (Jojoba) Seed Oil, Organic Persea Gratissima Oil, Organic Olea Europaea (Olive) Fruit Oil, Organic Cocos Nucifera (Coconut) Oil, Phenoxyethanol, Ethylhexylglycerin, Fragrance, Morus Nigra Fruit Extract.',
      howToUse: 'After cleansing, massage onto face & neck using gentle upward motions. Once fully absorbed, follow with your moisturizer.',
      step: 'serum',
      image: 'https://www.avinichi.com/wp-content/uploads/Hydrating-Multifruit-C-Serum-1.png',
    },
    {
      id: 'avinichi-noni-morning-glow',
      name: 'Noni Morning Glow',
      brand: 'Avinichi',
      description: 'Everyone needs a go-to day cream, and the Noni Morning Glow will soon be yours. Infused with vitamins, antioxidants, and Noni, this daytime moisturizer will leave your skin feeling firmer and smoother after each use. Its lightweight, fast-absorbing, non-greasy formula deeply hydrates throughout the day and makes an excellent base for makeup.',
      benefits: 'Lightweight daytime moisturizer, infused with vitamins, antioxidants, and Noni, firms and smooths skin, fast-absorbing and non-greasy, hydrates all day, prevents excess oil buildup, makes a great makeup base',
      ingredients: 'Aqua, Glycerin, Propylene Glycol, Carthamus Tinctorius (Safflower) Seed Oil, Isopropyl Palmitate, Caprylic/Capric Triglyceride, PEG-100 Stearate, Glyceryl Stearate, Cetearyl Alcohol, Cetearyl Glucoside, Dimethicone, Butyrospermum Parkii (Shea Butter), Tocopheryl Acetate (Vitamin E), Retinyl Palmitate (Vitamin A), Organic Chamomilla Recutita Flower Extract, Organic Camelia Sinensis Leaf Extract, Organic Aloe Barbadensis Leaf Extract, Acrylates/C10-30 Alkyl Acrylates Crosspolymer, Carbomer, Disodium EDTA, Sodium Hydroxide, Ethylhexylglycerin, Phenoxyethanol, Morinda Citrifolia (Noni) Fruit Extract, Fragrance.',
      howToUse: 'After cleansing, massage moisturizer over the entire face and neck. Use daily, in the morning.',
      step: 'moisturizer',
      image: 'https://www.avinichi.com/wp-content/uploads/Noni-Morning-Glow-1.png',
      url: 'https://www.avinichi.com/product/noni-morning-glow/',
    },
    {
      id: 'avinichi-noni-mousse-cleanser',
      name: 'Noni Mousse Cleanser',
      brand: 'Avinichi',
      description: 'The perfect start to every skincare routine, the Noni Mousse Cleanser can be used daily to remove dirt, makeup, and other impurities from the skin. Formulated with gentle, coconut-derived cleansing agents and infused with plant extracts and Noni, this lush cleanser will give your skin a fresh and radiant finish.',
      benefits: 'Daily cleanser, removes dirt and makeup, gentle coconut-derived cleansing agents, plant extracts and Noni, fresh and radiant finish, suitable for sensitive skin',
      ingredients: 'Aqua, Sodium Cocoyl Isethionate, Sodium Methyl Cocoyl Taurate, Sodium Lauroyl Methyl Isethionate, Glycol Distearate, PEG-120 Methyl Glucose Dioleate, Cocamidopropyl Betaine, Glycerin, Stearic Acid, Polyacrylate-1 Crosspolymer, Organic Aloe Barbadensis Leaf Extract, Organic Lavandula Angustifolia Extract, Organic Chamomilla Recutita Flower Extract, Organic Calendula Officinalis Flower Extract, Propanediol*Zemea*, Sodium PCA, Organic Argania Spinosa Kernel (Argan) Oil, Moringa Oleifera Seed Oil, Citric Acid, Tetrasodium EDTA, Phenoxyethanol, Ethylhexylglycerin, Morinda Citrifolia (Noni) Fruit Extract, Fragrance.',
      howToUse: 'Gently lather a small amount of mousse in hands and then apply to damp face. Rinse thoroughly with water.',
      step: 'cleanser',
      image: 'https://www.avinichi.com/wp-content/uploads/Noni-Mousse-Cleanser-1.png',
    },
    {
      id: 'avinichi-noni-pore-purifying-toner',
      name: 'Noni Pore Purifying Toner',
      brand: 'Avinichi',
      description: 'Elevate your cleansing regime with the exquisite Noni Pore Purifying Toner. Designed to remove traces of oil, dirt, and other impurities, this alcohol-free toner, which is packed with plant extracts and Noni, will finish off what your cleanser started, leaving your skin perfectly prepped for the next step of your skincare routine.',
      benefits: 'Alcohol-free toner, removes traces of oil and dirt, packed with plant extracts and Noni, preps skin for next skincare step, suitable for daily use morning or night, refines and resurfaces skin',
      ingredients: 'Aqua/Water/Eau, Aloe Barbadensis (Aloe Vera) Leaf Juice, Cucumis Sativus (Cucumber) Fruit Extract, Chamomilla Recutita Flower/Leaf (ORGANIC Chamomile) Extract, Polysorbate-20, Pentylene Glycol, Propanediol, Sodium PCA, Fragrance (Parfum), Phenoxyethanol, Allantoin, Ethylhexylglycerin, Morinda Citrifolia (Noni) Fruit Extract, Citric Acid.',
      howToUse: 'Apply after cleansing with a cotton ball or pad. Can be used morning or night daily.',
      step: 'toner',
      image: 'https://www.avinichi.com/wp-content/uploads/Noni-Pore-Purifying-Toner-1.png',
    },
    {
      id: 'avinichi-eye-rescue-phyto-serum',
      name: 'Eye Rescue Phyto-Serum',
      brand: 'Avinichi',
      description: 'Featuring a botanical buffet of flower, leaf, root, and fruit extracts, the Eye Rescue Phyto-Serum is designed to leave the skin feeling deeply hydrated and restored. In addition to giving the skin around your eyes a plumper and fuller appearance, this antioxidant-rich formula will also leave you with a firmer and more lifted look.',
      benefits: 'Antioxidant-rich botanical formula, deeply hydrates and restores, plumper and fuller appearance around eyes, firmer and more lifted look, peptide complex (Palmitoyl Tripeptide-1 and Palmitoyl Tetrapeptide-7), Camu Camu Vitamin C, Sodium Hyaluronate',
      ingredients: 'Aqua, Propylene Glycol, Polysorbate 20, Palmitoyl Tripeptide-1, Palmitoyl Tetrapeptide-7, Sodium Hyaluronate, Sodium Polystyrene Sulfonate, Pueraria Lobata Root Extract, Organic Camelia Sinensis Leaf Extract, Organic Calendula Officinalis Flower Extract, Organic Aloe Barbadensis Leaf Extract, Organic Ginkgo Biloba Leaf Extract, Sodium PCA, Hydrolyzed Wheat Protein, Myrciaria Dubia Fruit Extract, Ascorbic Acid, Sclerotium Gum, Glycerin, Butylene Glycol, Allantoin, Carbomer, Potassium Sorbate, Disodium EDTA, Aminomethyl Propanediol, Phenoxyethanol, Ethylhexylglycerin.',
      howToUse: 'After cleansing, apply around the entire eye area. Gently pat serum from the inner corner, under the eye, outer corner, and over the eyelid. Avoid contact with eyes.',
      step: 'eye-serum',
      image: 'https://www.avinichi.com/wp-content/uploads/Eye-Rescue-Phyto-Serum-1.png',
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
    },
    {
      id: 'hydrasphere-bio-milk-cleanser',
      name: 'Bio Milk Cleanser',
      brand: 'HydraSphere Plus',
      description: 'A nourishing milk cleanser enriched with bio-active ingredients that gently dissolves impurities while softening and conditioning the skin.',
      benefits: '',
      ingredients: '',
      howToUse: 'Apply to dry or damp skin and massage gently. Rinse with warm water or remove with a soft damp cloth. Use morning and evening as the first step of your skincare routine.',
      step: 'cleanser',
      image: '',
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
      image: '',
    },
    {
      id: 'hydrasphere-advanced-eye-lifting-serum',
      name: 'Advanced Eye Lifting Serum',
      brand: 'HydraSphere Plus',
      description: 'A targeted lifting serum for the delicate eye area that firms, brightens, and reduces the appearance of fine lines and puffiness.',
      benefits: '',
      ingredients: '',
      howToUse: 'Apply 1–3 pumps to a cleansed face and eye area. Spread a thin veil over the skin, blending in small circles with a gentle tapping motion until the product disappears into the skin.',
      step: 'eye serum',
      image: '',
    },
    {
      id: 'hydrasphere-advanced-peptides-eye-cream',
      name: 'Advanced Peptides Eye Cream',
      brand: 'HydraSphere Plus',
      description: 'A rich, peptide-powered eye cream that targets dark circles, fine lines, and crow\'s feet while deeply hydrating the delicate under-eye skin.',
      benefits: '',
      ingredients: '',
      howToUse: 'Using your ring finger, gently tap a small amount around the orbital bone morning and evening. Pat (do not rub) until fully absorbed. Apply after your serum.',
      step: 'eye cream',
      image: '',
    },
    {
      id: 'hydrasphere-cucumber-seaweed-eye-lift',
      name: 'Cucumber & Seaweed Eye Lift',
      brand: 'HydraSphere Plus',
      description: 'A cooling, soothing eye treatment combining cucumber extract and marine seaweed to depuff, brighten, and lift the under-eye area.',
      benefits: '',
      ingredients: '',
      howToUse: 'Apply a small amount around the eye area using your ring finger with gentle tapping motions. Use morning and evening after serum. Store in the fridge for an extra cooling effect.',
      step: 'eye treatment',
      image: '',
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
    },
    {
      id: 'hydrasphere-oxygen-brightening-cream',
      name: 'Oxygen Brightening Cream',
      brand: 'HydraSphere Plus',
      description: 'An oxygen-infused brightening moisturizer that illuminates dull skin, evens tone, and delivers a visible radiance boost with each use.',
      benefits: '',
      ingredients: '',
      howToUse: 'Apply to face and neck morning and evening after serum. Use gentle upward strokes until fully absorbed. Can be worn alone or under SPF during the day.',
      step: 'moisturizer',
      image: '',
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
      image: '',
    },
    {
      id: 'hydrasphere-mineral-facial-deep-moisturizer',
      name: 'Mineral Facial Deep Moisturizer',
      brand: 'HydraSphere Plus',
      description: 'A mineral-enriched deep moisturizer that nourishes, protects, and restores vitality to dry and stressed skin.',
      benefits: '',
      ingredients: '',
      howToUse: 'Apply to clean face and neck, morning and evening. Massage in gentle upward circles until absorbed. Follow after serum for best results.',
      step: 'moisturizer',
      image: '',
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
      image: '',
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
      image: '',
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
    },
    {
      id: 'hydrasphere-advanced-night-repair',
      name: 'Advanced Night Repair',
      brand: 'HydraSphere Plus',
      description: 'An intensive overnight repair cream that works with your skin\'s natural renewal cycle to restore, firm, and deeply nourish while you sleep.',
      benefits: '',
      ingredients: '',
      howToUse: 'Apply a thin layer to clean dry skin on your face and neck before bedtime. Massage in small upward circles over the face and neck. Allow the cream to fully absorb before heading to bed. Use 1–2 times a week.',
      step: 'night treatment',
      image: '',
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
      image: '',
    },
    {
      id: 'hydrasphere-mineral-facial-peeling-gel',
      name: 'Mineral Facial Peeling Gel',
      brand: 'HydraSphere Plus',
      description: 'A mineral-enriched peeling gel that exfoliates and detoxifies simultaneously, leaving skin polished, purified, and mineral-nourished.',
      benefits: '',
      ingredients: '',
      howToUse: 'Apply to dry, clean skin. Massage in circular motions until the gel rolls away dead skin cells. Rinse well with lukewarm water. Use 1–2 times per week.',
      step: 'exfoliant',
      image: '',
    },
    {
      id: 'hydrasphere-mineral-salt-scrub',
      name: 'Mineral Salt Scrub',
      brand: 'HydraSphere Plus',
      description: 'A detoxifying mineral salt scrub that buffs away dead skin cells and purifies pores, leaving skin silky smooth and refreshed.',
      benefits: '',
      ingredients: '',
      howToUse: 'Apply to damp skin and massage in gentle circular motions. Rinse thoroughly. Use 1–2 times per week in place of your regular cleanser. Follow with toner and moisturizer.',
      step: 'exfoliant/scrub',
      image: '',
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
      image: '',
    },
    {
      id: 'hydrasphere-hydrocharcoal-face-eye-mask',
      name: 'HydroCharcoal Collagen Face & Eye Mask',
      brand: 'HydraSphere Plus',
      description: 'A powerful sheet mask combining activated charcoal, collagen, and hydrogen water to deeply cleanse, plump, and revitalize the face and eye area.',
      benefits: '',
      ingredients: '',
      howToUse: 'Cleanse face thoroughly. Unfold the mask and apply to face, pressing gently to adhere. Leave on for 15–20 minutes. Remove and gently pat remaining serum into skin. Use 2–3 times per week.',
      step: 'mask',
      image: '',
    },
    {
      id: 'hydrasphere-hydrocharcoal-neck-decollete-mask',
      name: 'HydroCharcoal Collagen Neck and Décolleté Mask',
      brand: 'HydraSphere Plus',
      description: 'A targeted sheet mask for the neck and décolleté that firms, hydrates, and smooths this often-neglected area using charcoal and collagen.',
      benefits: '',
      ingredients: '',
      howToUse: 'Apply to clean neck and décolleté. Press gently to adhere. Leave on for 15–20 minutes, then remove and pat remaining serum into skin. Use 2–3 times per week.',
      step: 'mask',
      image: '',
    },
    {
      id: 'hydrasphere-hydrocharcoal-tummy-body-mask',
      name: 'HydroCharcoal Tummy & Lower Body Mask',
      brand: 'HydraSphere Plus',
      description: 'A detoxifying charcoal mask designed for the tummy and lower body to tone, hydrate, and smooth skin in areas prone to dryness and uneven texture.',
      benefits: '',
      ingredients: '',
      howToUse: 'Apply to clean skin on the tummy and lower body. Wrap or press gently to adhere. Leave on for 20–30 minutes. Remove and massage any remaining product into skin.',
      step: 'body mask',
      image: '',
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
    },
    {
      id: 'hydrasphere-organic-shea-butter',
      name: 'Organic Shea Butter',
      brand: 'HydraSphere Plus',
      description: 'Pure, unrefined organic shea butter that provides intense nourishment for face, body, hair, and lips — a multi-use natural skincare staple.',
      benefits: '',
      ingredients: 'Pure unrefined organic shea butter.',
      howToUse: 'Warm a small amount between your palms and apply to face, body, hair, or lips as needed. Can be used as a daily moisturizer, overnight treatment, or to soothe dry patches.',
      step: 'body/multi-use moisturizer',
      image: '',
    },
    {
      id: 'hydrasphere-hand-body-cream',
      name: 'Hand & Body Cream',
      brand: 'HydraSphere Plus',
      description: 'A rich, fast-absorbing hand and body cream that deeply hydrates and softens skin throughout the day without leaving a greasy residue.',
      benefits: '',
      ingredients: '',
      howToUse: 'Apply to hands and body as needed throughout the day. Massage in until fully absorbed. Pay extra attention to dry areas like elbows, knees, and heels. Use after bathing for best results.',
      step: 'body moisturizer',
      image: '',
    },
    {
      id: 'hydrasphere-chroma-manicure-set',
      name: 'Chroma Manicure Set',
      brand: 'HydraSphere Plus',
      description: 'A complete at-home manicure set with everything needed to achieve salon-quality nails, including treatment products to strengthen and beautify.',
      benefits: '',
      ingredients: '',
      howToUse: 'Follow the included step-by-step manicure guide. Begin with the nail prep, apply treatments as directed, and finish with color if included. Use weekly or as desired for well-maintained nails.',
      step: 'nail/manicure',
      image: '',
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

  const productDetails = selectedProducts.map(p => {
    const lines = [`PRODUCT: ${p.brand} — ${p.name}`];
    if (p.description) lines.push(`Description: ${p.description}`);
    if (p.benefits)    lines.push(`Key benefits: ${p.benefits}`);
    if (p.ingredients) lines.push(`Key ingredients: ${p.ingredients}`);
    if (p.howToUse)    lines.push(`How to use: ${p.howToUse}`);
    if (p.step)        lines.push(`Routine step: ${p.step}`);
    return lines.join('\n');
  }).join('\n\n');

  const prompt = `You are a warm, expert beauty consultant for Glow SF, a boutique beauty store in Santa Fe, New Mexico.

Write a personalized welcome email to a new customer. Their email is: ${customerEmail}

They have purchased the following products:
${productDetails}

The email must include:
1. A warm, genuine welcome as a Glow SF customer
2. For each product: a brief, enthusiastic description of what it does, highlight its hero ingredients if provided, and explain why they'll love it
3. A step-by-step daily skincare routine incorporating ALL products in correct order (cleanser → toner → serum → eye treatment → moisturizer → SPF in the morning; masks 1–3x/week; devices as directed)
4. The exact how-to-use directions for each product, phrased naturally
5. Helpful tips: introduce new products one at a time, always patch test, and any product-specific advice
6. An invitation to reach out with questions and to visit the store in Santa Fe

Tone: warm, knowledgeable, and excited — like a trusted beauty friend, not a corporate newsletter. Use the customer's first name if you can parse it from their email, otherwise "Dear Glow SF Customer".

Format with clear sections and line breaks. Sign off as "The Glow SF Team".`;

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
