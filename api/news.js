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

function parseXml(xml, source) {
  const items = [];
  const itemMatches = xml.match(/<item[\s\S]*?<\/item>/g) ||
                      xml.match(/<entry[\s\S]*?<\/entry>/g) || [];

  for (const item of itemMatches.slice(0, 20)) {
    const get = (tag, fallback = '') => {
      const m = item.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'))
             || item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? m[1].trim() : fallback;
    };
    const getAttr = (tag, attr) => {
      const m = item.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i'));
      return m ? m[1] : '';
    };

    const title = stripHtml(get('title'));
    const link  = get('link') || getAttr('link', 'href');
    const desc  = stripHtml(get('description') || get('summary') || get('content')).slice(0, 400);
    const date  = get('pubDate') || get('published') || get('updated') || '';

    if (title && link) items.push({ title, desc, url: link, date, source });
  }
  return items;
}

function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<')
    .replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#\d+;/g,' ')
    .replace(/\s+/g,' ').trim();
}

// ── Language level detection ──────────────────────────────────────────────────
const HARD = new Set(['pursuant','thereof','notwithstanding','aforementioned','escalate',
  'infrastructure','incumbent','sovereignty','diplomatic','coalition','referendum',
  'sanctions','austerity','monetary','fiscal','semiconductor','algorithm','cybersecurity',
  'surveillance','autonomous','pandemic','mortality','epidemiological','pharmaceutical',
  'unprecedented','catastrophic','trajectory','implications','comprehensive','sustainable',
  'deteriorate','substantially','fundamentally','retaliation','provocative','authoritarian',
  'geopolitical','bilateral','multilateral','embargo','tariff','inflation','recession',
  'diversification','speculation','volatility','proliferation','cryptocurrency','litigation',
  'arbitration','constitutional','bureaucratic','parliamentary','legislative','negotiations',
  'administration','deployment','implementation','authorization','infrastructure']);

const MEDIUM = new Set(['government','minister','parliament','policy','regulation','legislation',
  'economy','industry','company','profit','revenue','investment','market','climate',
  'environment','pollution','emission','renewable','protest','activist','demonstration',
  'military','conflict','border','territory','alliance','treaty','summit','research',
  'discovery','experiment','species','evolution','genetic','election','candidate','ballot',
  'democracy','vaccine','treatment','diagnosis','symptom','infection','technology',
  'software','platform','network','digital','innovation','agreement','proposal','deadline',
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
  if (/\b(health|cancer|virus|hospital|doctor|mental|fitness|obesity|drug|vaccine|disease|treatment|covid)\b/.test(s)) return 'health';
  if (/\b(market|economy|stock|inflation|bank|trade|invest|gdp|recession|company|revenue|profit|crypto|bitcoin)\b/.test(s)) return 'business';
  return 'world';
}

// ── Handler ───────────────────────────────────────────────────────────────────
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

  // deduplicate
  const seen = new Set();
  articles = articles.filter(a => {
    const key = a.title.slice(0, 50).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  // sort by date
  articles.sort((a, b) => new Date(b.date) - new Date(a.date));

  res.status(200).json({ ok: true, count: articles.length, articles });
};
