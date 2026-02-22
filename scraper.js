// scraper.js
// ─────────────────────────────────────────────────────────────────────────────
// Modular eyewear distributor scraper.
// Each entry in SCRAPER_CONFIGS defines how to pull products from one site.
//
// HOW TO ADD A NEW BRAND / DISTRIBUTOR:
//  1. Add a new object to SCRAPER_CONFIGS below.
//  2. Set the URL(s) to scrape (can be multiple pages / category pages).
//  3. Set the CSS selectors that match that site's product grid.
//  4. Run `node scraper.js` to test, or hit POST /api/scrape on the server.
// ─────────────────────────────────────────────────────────────────────────────

const { chromium } = require('playwright-extra');
const StealthPlugin  = require('puppeteer-extra-plugin-stealth');
const fs             = require('fs');
const path           = require('path');

chromium.use(StealthPlugin());

const CACHE_FILE = path.join(__dirname, 'products.json');

// ─── SHAPE DETECTOR ──────────────────────────────────────────────────────────
// Best-effort guess at frame shape from the product name / description.
function detectShape(name = '', desc = '') {
    const text = (name + ' ' + desc).toLowerCase();
    if (/round|circle|circular/.test(text))            return 'round';
    if (/aviator|pilot|teardrop/.test(text))           return 'aviator';
    if (/square|rectangular|angular/.test(text))       return 'square';
    return 'rect'; // default
}

// ─── TYPE DETECTOR ───────────────────────────────────────────────────────────
function detectType(name = '', desc = '', category = '') {
    const text = (name + ' ' + desc + ' ' + category).toLowerCase();
    if (/sun|tinted|polarized|uv/.test(text))          return 'Sunglasses';
    return 'Optical';
}

// ─── COLOR NORMALIZER ────────────────────────────────────────────────────────
// Map raw scraped color strings to the color tokens used by your filters.
const COLOR_MAP = {
    'black':    'Black',
    'dark':     'Black',
    'gold':     'Gold',
    'yellow':   'Gold',
    'silver':   'Silver',
    'chrome':   'Silver',
    'gunmetal': 'Silver',
    'grey':     'Silver',
    'gray':     'Silver',
    'tortoise': 'Tortoise',
    'havana':   'Tortoise',
    'brown':    'Tortoise',
    'blue':     'Blue',
    'navy':     'Blue',
};

function normalizeColor(raw = '') {
    const lower = raw.toLowerCase();
    for (const [key, val] of Object.entries(COLOR_MAP)) {
        if (lower.includes(key)) return val;
    }
    return 'Black'; // fallback
}

// ─── PRICE PARSER ────────────────────────────────────────────────────────────
function parsePrice(raw = '') {
    const match = raw.replace(/,/g, '').match(/[\d.]+/);
    return match ? Math.round(parseFloat(match[0])) : 0;
}

// ─── IMAGE COLOR PICKER (for SVG fallback) ───────────────────────────────────
const COLOR_HEX_MAP = {
    Black:    '#2C2C2C',
    Gold:     '#D4AF37',
    Silver:   '#C0C0C0',
    Tortoise: '#5C4033',
    Blue:     '#1E3A8A',
};

// ─────────────────────────────────────────────────────────────────────────────
// SCRAPER CONFIGS
// Each config = one brand / distributor website.
// ─────────────────────────────────────────────────────────────────────────────
const SCRAPER_CONFIGS = [

    // ── ic! berlin ────────────────────────────────────────────────────────────
    // ic! berlin sells direct at icberlin.com.
    // Adjust selectors to match the actual site HTML if they change.
    {
        brand:    'ic! berlin',
        enabled:  true,          // set false to skip this brand
        urls: [
            'https://www.ic-berlin.de/en/eyewear/spectacle-frames/',
            'https://www.ic-berlin.de/en/eyewear/sunglasses/',
        ],
        selectors: {
            productItem:  '.product-item',          // wrapper for each product
            name:         '.product-name',
            price:        '.price',
            color:        '.color-label',           // optional; leave '' to auto-detect
            imageUrl:     'img.product-image',      // img tag; scraper reads src attribute
            productLink:  'a.product-link',         // link to product detail page (for detail scrape)
            description:  '',                       // leave '' to skip detail page
        },
        // Optional: override anything that can't be auto-detected
        overrides: {
            material: 'Stainless Steel',
            weight:   14,
        }
    },

    // ── Orgreen Optics ────────────────────────────────────────────────────────
    {
        brand:   'Orgreen',
        enabled: true,
        urls: [
            'https://www.orgreen.com/collections/optical-frames',
            'https://www.orgreen.com/collections/sunglasses',
        ],
        selectors: {
            productItem:  '.product-card',
            name:         '.product-card__title',
            price:        '.price__regular .price-item',
            color:        '.color-name',
            imageUrl:     '.product-card__image img',
            productLink:  'a.product-card__link',
            description:  '',
        },
        overrides: {
            material: 'Titanium',
            weight:   15,
        }
    },

    // ── Tom Ford Eyewear ─────────────────────────────────────────────────────
    // Tom Ford has a heavily JS-rendered site; Playwright handles that fine.
    {
        brand:   'Tom Ford',
        enabled: true,
        urls: [
            'https://www.tomford.com/eyewear/optical-frames/',
            'https://www.tomford.com/eyewear/sunglasses/',
        ],
        selectors: {
            productItem:  '.product-tile',
            name:         '.product-name',
            price:        '.price-sales',
            color:        '.color-description',
            imageUrl:     '.product-image img',
            productLink:  'a.product-tile-link',
            description:  '',
        },
        overrides: {
            material: 'Acetate',
            weight:   28,
        }
    },

    // ── Talla Eyewear ─────────────────────────────────────────────────────────
    {
        brand:   'Talla',
        enabled: true,
        urls: [
            'https://www.tallaeyewear.com/collections/optical',
            'https://www.tallaeyewear.com/collections/sun',
        ],
        selectors: {
            productItem:  '.product-item',
            name:         '.product-item__title',
            price:        '.price',
            color:        '.product-item__variant',
            imageUrl:     '.product-item__image img',
            productLink:  'a.product-item__link',
            description:  '',
        },
        overrides: {
            material: 'Titanium',
            weight:   18,
        }
    },

    // ── ADD MORE BRANDS BELOW ─────────────────────────────────────────────────
    // {
    //     brand:   'YourBrand',
    //     enabled: true,
    //     urls: ['https://...'],
    //     selectors: { productItem: '', name: '', price: '', color: '', imageUrl: '', productLink: '', description: '' },
    //     overrides: { material: '', weight: 0 }
    // },
];

// ─────────────────────────────────────────────────────────────────────────────
// CORE SCRAPE FUNCTION
// ─────────────────────────────────────────────────────────────────────────────
async function scrapeConfig(browser, config, startId) {
    const products = [];
    let idCounter  = startId;

    for (const url of config.urls) {
        console.log(`  → Scraping ${url}`);
        const page = await browser.newPage();

        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // Wait a moment for JS-heavy pages to render
            await page.waitForTimeout(2000);

            // Scroll to bottom to trigger lazy-loading
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(1000);

            const items = await page.evaluate((sel) => {
                const nodes = document.querySelectorAll(sel.productItem);
                return Array.from(nodes).map(node => {
                    const getText = (s) => {
                        if (!s) return '';
                        const el = node.querySelector(s);
                        return el ? el.textContent.trim() : '';
                    };
                    const getAttr = (s, attr) => {
                        if (!s) return '';
                        const el = node.querySelector(s);
                        return el ? (el.getAttribute(attr) || '') : '';
                    };

                    return {
                        rawName:    getText(sel.name),
                        rawPrice:   getText(sel.price),
                        rawColor:   getText(sel.color),
                        imageUrl:   getAttr(sel.imageUrl, 'src') || getAttr(sel.imageUrl, 'data-src'),
                        productUrl: getAttr(sel.productLink, 'href'),
                    };
                });
            }, config.selectors);

            for (const item of items) {
                if (!item.rawName) continue; // skip empty nodes

                const color      = item.rawColor ? normalizeColor(item.rawColor) : 'Black';
                const type       = detectType(item.rawName, '', url);
                const shape      = detectShape(item.rawName);
                const price      = parsePrice(item.rawPrice);
                const imageColor = COLOR_HEX_MAP[color] || '#2C2C2C';

                // Make sure image URL is absolute
                let imageUrl = item.imageUrl || '';
                if (imageUrl && imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;

                const product = {
                    id:          idCounter++,
                    brand:       config.brand,
                    name:        item.rawName,
                    type,
                    color,
                    price:       price || 0,
                    shape,
                    imageColor,
                    imageUrl,                       // real photo; frontend prefers this
                    material:    config.overrides?.material || 'Unknown',
                    weight:      config.overrides?.weight   || 0,
                    sourceUrl:   item.productUrl || url,
                    scrapedAt:   new Date().toISOString(),
                };

                products.push(product);
            }

            console.log(`     Found ${items.length} items`);
        } catch (err) {
            console.warn(`  ⚠ Failed to scrape ${url}: ${err.message}`);
        } finally {
            await page.close();
        }
    }

    return products;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: runScraper()
// Called by server.js when /api/scrape is hit, or when run standalone.
// ─────────────────────────────────────────────────────────────────────────────
async function runScraper() {
    console.log('🔍 Starting scraper...');

    // Load existing manually-added products so they aren't wiped
    let existing = [];
    if (fs.existsSync(CACHE_FILE)) {
        try {
            const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
            // Keep any product flagged as manual (not scraped)
            existing = raw.filter(p => p.manual === true);
        } catch (_) {}
    }

    const browser = await chromium.launch({ headless: true });
    let allScraped = [];
    let idCounter  = 1000; // scraped products start at id 1000 to avoid collisions

    for (const config of SCRAPER_CONFIGS) {
        if (!config.enabled) {
            console.log(`⏭  Skipping ${config.brand} (disabled)`);
            continue;
        }
        console.log(`\n📦 Scraping ${config.brand}...`);
        const products = await scrapeConfig(browser, config, idCounter);
        allScraped.push(...products);
        idCounter += products.length + 10;
    }

    await browser.close();

    // Merge: manual products + freshly scraped
    const merged = [...existing, ...allScraped];
    fs.writeFileSync(CACHE_FILE, JSON.stringify(merged, null, 2));

    console.log(`\n✅ Scrape complete. ${allScraped.length} products saved to products.json`);
    return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// Load cached products (used by server.js on every /api/products request)
// ─────────────────────────────────────────────────────────────────────────────
function loadCachedProducts() {
    if (!fs.existsSync(CACHE_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch (_) {
        return [];
    }
}

module.exports = { runScraper, loadCachedProducts };

// If run directly: node scraper.js
if (require.main === module) {
    runScraper().catch(console.error);
}
