const https = require('https');
const http = require('http');

const FEEDS = [
  { url: 'https://feeds.bbci.co.uk/news/rss.xml',                        source: 'BBC' },
  { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',             source: 'BBC' },
  { url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',source: 'BBC' },
  { url: 'https://www.theguardian.com/world/rss',                        source: 'Guardian' },
  { url: 'https://www.theguardian.com/technology/rss',                   source: 'Guardian' },
  { url: 'https://www.theverge.com/rss/index.xml',                       source: 'The Verge' },
  { url: 'https://feeds.arstechnica.com/arstechnica/index',              source: 'Ars Technica' },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',    source: 'NY Times' },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml',  source: 'NY Times' },
];

function fetchUrl(url, redirects = 0) {
  if (redirects > 3) return Promise.reject(new Error('too many redirects'));
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 Newslearn/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, redirects + 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function stripHtml(s) {
  return (s || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g, '')
    .replace(/&[a-z]+;/g,' ')
    .replace(/\s+/g,' ').trim();
}

function cleanDesc(raw) {
  let s = stripHtml(raw);
  // Remove newsletter/promo sentences
  s = s.replace(/\b(Get our|Sign up (for|to)|Subscribe (to|for)|Click here|Read more|More from|Follow us)[^.!?]*[.!?]/gi, '');
  // Remove lone URLs
  s = s.replace(/https?:\/\/\S+/g, '');
  // Remove "X Jun", "6 Jun Health" type date/tag fragments at start
  s = s.replace(/^\d{1,2}\s+\w+\s*/,'');
  s = s.replace(/\s+/g,' ').trim();
  return s.slice(0, 300);
}

function extractItems(xml) {
  // Strip <image> blocks first so their <title> doesn't bleed into item parsing
  xml = xml.replace(/<image[\s\S]*?<\/image>/gi, '');
  // Also strip <textInput> blocks
  xml = xml.replace(/<textInput[\s\S]*?<\/textInput>/gi, '');
  return xml.match(/<item[\s\S]*?<\/item>/g)
      || xml.match(/<entry[\s\S]*?<\/entry>/g)
      || [];
}

function parseXml(xml, source) {
  const items = [];
  const blocks = extractItems(xml);

  for (const block of blocks.slice(0, 30)) {
    const get = tag => {
      const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'))
             || block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? m[1].trim() : '';
    };
    const getAttr = (tag, attr) => {
      const m = block.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i'));
      return m ? m[1] : '';
    };

    const title = stripHtml(get('title'));
    const link  = get('link') || getAttr('link', 'href');
    const desc  = cleanDesc(get('description') || get('summary') || get('content'));
    const date  = get('pubDate') || get('published') || get('updated') || '';

    // ── Hard filters ──
    if (!title || title.length < 20) continue;           // too short = not a headline
    if (!link || !link.startsWith('http')) continue;     // no valid URL
    if (/^(get our|sign up|subscribe|live$|breaking news|more from|follow us)/i.test(title)) continue;
    if (!/^[A-Z"'«\d([]/.test(title)) continue;         // must start with capital/quote/number
    if (title.split(' ').length < 4) continue;           // less than 4 words = not a headline
    if (/^https?:\/\//.test(title)) continue;            // title is a URL

    items.push({ title, desc, url: link, date, source });
  }
  return items;
}

const HARD = new Set(['pursuant','thereof','notwithstanding','aforementioned','escalate',
  'infrastructure','incumbent','sovereignty','diplomatic','coalition','referendum',
  'sanctions','austerity','monetary','fiscal','semiconductor','algorithm','cybersecurity',
  'surveillance','autonomous','pandemic','mortality','epidemiological','pharmaceutical',
  'unprecedented','catastrophic','trajectory','implications','comprehensive','sustainable',
  'deteriorate','substantially','fundamentally','retaliation','provocative','authoritarian',
  'geopolitical','bilateral','multilateral','embargo','tariff','inflation','recession',
  'diversification','speculation','volatility','proliferation','cryptocurrency','litigation',
  'arbitration','constitutional','bureaucratic','parliamentary','legislative','negotiations',
  'administration','deployment','implementation','authorization']);

const MEDIUM = new Set(['government','minister','parliament','policy','regulation','legislation',
  'economy','industry','company','profit','revenue','investment','market','climate',
  'environment','pollution','emission','renewable','protest','activist','demonstration',
  'military','conflict','border','territory','alliance','treaty','summit','research',
  'discovery','experiment','species','evolution','genetic','election','candidate','ballot',
  'democracy','vaccine','treatment','diagnosis','symptom','infection','technology',
  'software','platform','network','digital','innovation','agreement','proposal',
  'approval','dispute','negotiate','representative','executive','commission','authority',
  'strategic','establish','controversial','significant','responsibility','international']);

function estimateLevel(text) {
  const words = (text || '').toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
  if (!words.length) return 'b1';
  let hard = 0, med = 0;
  words.forEach(w => { if (HARD.has(w)) hard++; else if (MEDIUM.has(w)) med++; });
  const hr = hard / words.length, mr = med / words.length;
  if (hr > 0.03) return 'b2';
  if (hr > 0.007 || mr > 0.05) return 'b1';
  return 'a2';
}

function guessTopic(t, d) {
  const s = ((t||'')+(d||'')).toLowerCase();
  if (/\b(ai|tech|software|apple|google|microsoft|robot|cyber|chip|iphone|android|startup|openai|nvidia|meta|app\b)\b/.test(s)) return 'technology';
  if (/\b(space|nasa|climate|planet|science|biolog|physics|chemist|asteroid|quantum|genome|species|fossil)\b/.test(s)) return 'science';
  if (/\b(health|cancer|virus|hospital|doctor|mental|fitness|obesity|drug|vaccine|disease|treatment|covid|ebola|outbreak)\b/.test(s)) return 'health';
  if (/\b(market|economy|stock|inflation|bank|trade|invest|gdp|recession|revenue|profit|crypto|bitcoin|tariff)\b/.test(s)) return 'business';
  return 'world';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  const results = await Promise.allSettled(
    FEEDS.map(async feed => {
      try {
        const xml = await fetchUrl(feed.url);
        return parseXml(xml, feed.source);
      } catch { return []; }
    })
  );

  let articles = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .map(a => ({
      ...a,
      level: estimateLevel(a.title + ' ' + a.desc),
      topic: guessTopic(a.title, a.desc),
    }));

  // Deduplicate
  const seen = new Set();
  articles = articles.filter(a => {
    const key = a.title.slice(0, 60).toLowerCase().replace(/[^a-z0-9]/g,'');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  articles.sort((a, b) => new Date(b.date) - new Date(a.date));

  res.status(200).json({ ok: true, count: articles.length, articles });
};
