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

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'Newslearn/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
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
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#\d+;/g, ' ').replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function cleanDesc(s) {
  return (s || '')
    .replace(/Get our .{0,150}/gi, '')
    .replace(/Sign up .{0,150}/gi, '')
    .replace(/Subscribe .{0,150}/gi, '')
    .replace(/Click here .{0,100}/gi, '')
    .replace(/Read more .{0,100}/gi, '')
    .replace(/\s+/g, ' ').trim()
    .slice(0, 280);
}

function parseXml(xml, source) {
  const items = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/g)
               || xml.match(/<entry[\s\S]*?<\/entry>/g) || [];

  for (const block of blocks.slice(0, 25)) {
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'))
             || block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? m[1].trim() : '';
    };
    const getAttr = (tag, attr) => {
      const m = block.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i'));
      return m ? m[1] : '';
    };

    const title = stripHtml(get('title'));
    const link  = get('link') || getAttr('link', 'href');
    const raw   = get('description') || get('summary') || get('content') || '';
    const desc  = cleanDesc(stripHtml(raw));
    const date  = get('pubDate') || get('published') || get('updated') || '';

    // Hard filters: must have real title and valid URL
    if (!title || title.length < 15) continue;
    if (!link || !link.startsWith('http')) continue;
    // Skip nav/promo items
    if (/^(get our|sign up|subscribe|live$|live updates|breaking news)/i.test(title)) continue;
    // Skip if title looks like a sentence fragment (no capital first letter after trim)
    if (!/^[A-Z"'«]/.test(title)) continue;

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
  const s = ((t || '') + ' ' + (d || '')).toLowerCase();
  if (/\b(ai|tech|software|apple|google|microsoft|robot|cyber|chip|iphone|android|startup|openai|nvidia|meta)\b/.test(s)) return 'technology';
  if (/\b(space|nasa|climate|planet|science|study|research|biology|physics|chemistry|asteroid|quantum|genome)\b/.test(s)) return 'science';
  if (/\b(health|cancer|virus|hospital|doctor|mental|fitness|obesity|drug|vaccine|disease|treatment|covid|ebola)\b/.test(s)) return 'health';
  if (/\b(market|economy|stock|inflation|bank|trade|invest|gdp|recession|company|revenue|profit|crypto|bitcoin)\b/.test(s)) return 'business';
  return 'world';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate');

  const results = await Promise.allSettled(FEEDS.map(async feed => {
    const xml = await fetchUrl(feed.url);
    return parseXml(xml, feed.source);
  }));

  let articles = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .map(a => ({
      ...a,
      level: estimateLevel(a.title + ' ' + a.desc),
      topic: guessTopic(a.title, a.desc),
    }));

  // Deduplicate by title
  const seen = new Set();
  articles = articles.filter(a => {
    const key = a.title.slice(0, 60).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  articles.sort((a, b) => new Date(b.date) - new Date(a.date));

  res.status(200).json({ ok: true, count: articles.length, articles });
};
