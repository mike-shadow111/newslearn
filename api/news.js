const https = require('https');
const http = require('http');

const FEEDS = [
  { url: 'https://feeds.bbci.co.uk/news/rss.xml',                        source: 'BBC' },
  { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',             source: 'BBC' },
  { url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',source: 'BBC' },
  { url: 'https://feeds.bbci.co.uk/news/health/rss.xml',                 source: 'BBC' },
  { url: 'https://www.theguardian.com/world/rss',                        source: 'Guardian' },
  { url: 'https://www.theguardian.com/technology/rss',                   source: 'Guardian' },
  { url: 'https://www.theguardian.com/science/rss',                      source: 'Guardian' },
  { url: 'https://www.theverge.com/rss/index.xml',                       source: 'The Verge' },
  { url: 'https://feeds.arstechnica.com/arstechnica/index',              source: 'Ars Technica' },
  { url: 'https://feeds.npr.org/1001/rss.xml',                           source: 'NPR' },
  { url: 'https://feeds.npr.org/1019/rss.xml',                           source: 'NPR' },
  { url: 'https://theconversation.com/us/technology/articles.atom',      source: 'The Conversation' },
  { url: 'https://theconversation.com/us/science/articles.atom',         source: 'The Conversation' },
  { url: 'https://theconversation.com/us/health/articles.atom',          source: 'The Conversation' },
];

// Priority 0 = shown last. Priority 2 = boosted (educational/lifestyle).
// Priority 1 = default.
const LOW_PRIORITY  = /\b(war|terror|attack|murder|kill|shoot|bomb|conflict|militar|weapon|sanction|hostage|isis|hamas|missile|nuclear|troops|shooting|explosion|casualt|death toll|killed|wounded|massacre|genocide|riot|coup|invasion|siege|airstrike|drone strike|protest crackdown|arrest|detained|prison|lawsuit|indicted|charged with|verdict|sentenced|election fraud|impeach|scandal|corrupt|bribe|crisis|catastroph|devastat|disaster|earthquake|hurricane|flood|wildfire|pandemic|outbreak|epidemic|overdose|suicide|homicide|abuse|assault|rape|trafficking)\b/i;
const HIGH_PRIORITY = /\b(discover|research|study finds|scientists|invention|how to|explain|history|space|animal|planet|ocean|forest|museum|book|language|culture|recipe|travel|art|music|learn|education|school|university|brain|psychology|habit|productivity|design|architecture|food|health tip|exercise|nature|wildlife|innovation|future|explore|curious|fascinating|surprising|ancient|record|milestone|breakthrough)\b/i;

function fetchUrl(url, redirects = 0) {
  if (redirects > 3) return Promise.reject(new Error('too many redirects'));
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 Newslearn/1.0' }
    }, res => {
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

function decodeEntities(s) {
  return (s || '')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/&#x2019;|&#8217;/g,"'").replace(/&#x2018;|&#8216;/g,"'")
    .replace(/&#x201C;|&#8220;/g,'"').replace(/&#x201D;|&#8221;/g,'"')
    .replace(/&#x2013;|&#8211;/g,'–').replace(/&#x2014;|&#8212;/g,'—')
    .replace(/&#x2026;|&#8230;/g,'…').replace(/&#xA0;|&#160;/g,' ')
    .replace(/&#[xX][0-9a-fA-F]+;/g,'').replace(/&#\d+;/g,'')
    .replace(/&[a-zA-Z]+;/g,' ');
}

function stripHtml(s) {
  return decodeEntities(
    (s || '')
      .replace(/<style[\s\S]*?<\/style>/gi,'')
      .replace(/<script[\s\S]*?<\/script>/gi,'')
      .replace(/<br\s*\/?>/gi,' ').replace(/<\/p>/gi,' ').replace(/<\/li>/gi,' ')
      .replace(/<[^>]+>/g,'')
  ).replace(/\s+/g,' ').trim();
}

function cleanDesc(raw) {
  let s = stripHtml(raw);
  s = s.replace(/(Sign up|Subscribe|Get our|Click here|Read more|More from|Follow us|Newsletter)[^.!?\n]{0,200}[.!?]?/gi,'');
  s = s.replace(/https?:\/\/\S+/g,'');
  s = s.replace(/^\d{1,2}\s+\w+\s*/,'');
  return s.replace(/\s+/g,' ').trim().slice(0, 280);
}

function extractItems(xml) {
  xml = xml.replace(/<image[\s\S]*?<\/image>/gi,'');
  xml = xml.replace(/<textInput[\s\S]*?<\/textInput>/gi,'');
  return xml.match(/<item[\s\S]*?<\/item>/g)
      || xml.match(/<entry[\s\S]*?<\/entry>/g) || [];
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

    if (!title || title.length < 20) continue;
    if (!link || !link.startsWith('http')) continue;
    if (/^(get our|sign up|subscribe|live$|breaking news|more from|follow us)/i.test(title)) continue;
    if (!/^[A-Z"'«\d([]/.test(title)) continue;
    if (title.split(' ').length < 4) continue;
    if (/^https?:\/\//.test(title)) continue;

    items.push({ title, desc, url: link, date, source });
  }
  return items;
}

const HARD = new Set(['pursuant','notwithstanding','aforementioned','sovereignty','diplomatic',
  'coalition','referendum','sanctions','austerity','monetary','fiscal','semiconductor',
  'algorithm','cybersecurity','surveillance','autonomous','pandemic','mortality',
  'epidemiological','pharmaceutical','unprecedented','catastrophic','trajectory',
  'implications','comprehensive','sustainable','deteriorate','substantially',
  'retaliation','provocative','authoritarian','geopolitical','bilateral','multilateral',
  'embargo','tariff','inflation','recession','diversification','speculation','volatility',
  'proliferation','cryptocurrency','litigation','arbitration','constitutional',
  'bureaucratic','parliamentary','legislative','negotiations','implementation']);

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
  if (/\b(ai|tech|software|apple|google|microsoft|robot|cyber|chip|iphone|android|startup|openai|nvidia|meta|app)\b/.test(s)) return 'technology';
  if (/\b(space|nasa|climate|planet|science|biolog|physics|chemist|asteroid|quantum|genome|species|fossil|discover)\b/.test(s)) return 'science';
  if (/\b(health|cancer|virus|hospital|doctor|mental|fitness|obesity|drug|vaccine|disease|treatment|covid|outbreak|diet|exercise)\b/.test(s)) return 'health';
  if (/\b(market|economy|stock|inflation|bank|trade|invest|gdp|recession|revenue|profit|crypto|bitcoin|tariff|startup)\b/.test(s)) return 'business';
  if (/\b(sport|football|soccer|tennis|basketball|olympic|athlete|match|tournament|league|championship|fifa|nba|nfl)\b/.test(s)) return 'sport';
  if (/\b(film|movie|music|art|culture|fashion|design|book|novel|theater|exhibition|award|oscar|grammy|celebrity)\b/.test(s)) return 'culture';
  return 'world';
}

function titleKey(title) {
  const stop = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','by','as','is','are','was','were','has','have','had','his','her','its','their','he','she','it','they','that','this','says','said','over','after','from','into','about','be','will','who','what','how','when','up','out','new','why','first','last','could','would','more','most','just']);
  return title.toLowerCase().replace(/[^a-z0-9\s]/g,'').split(/\s+/)
    .filter(w => w.length > 2 && !stop.has(w)).slice(0,7).sort().join('|');
}

function wordOverlap(a, b) {
  const ka = new Set(a.split('|')), kb = new Set(b.split('|'));
  let c = 0; ka.forEach(w => { if (kb.has(w)) c++; });
  return c / Math.min(ka.size, kb.size);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  const results = await Promise.allSettled(
    FEEDS.map(async feed => {
      try { return parseXml(await fetchUrl(feed.url), feed.source); }
      catch { return []; }
    })
  );

  let articles = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .map(a => {
      const text = a.title + ' ' + a.desc;
      let priority = 1;
      if (HIGH_PRIORITY.test(text)) priority = 2;
      if (LOW_PRIORITY.test(text))  priority = 0;
      return {
        ...a,
        level: estimateLevel(text),
        topic: guessTopic(a.title, a.desc),
        priority,
        _key: titleKey(a.title),
      };
    });

  // Sort: priority desc, then date desc
  articles.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return new Date(b.date) - new Date(a.date);
  });

  // Deduplicate — stricter: lower overlap threshold + ignore priority for dedup
  const kept = [];
  for (const a of articles) {
    const isDup = kept.some(k => {
      if (k._key === a._key) return true;
      if (wordOverlap(k._key, a._key) > 0.55) return true;
      // Same source + very similar title
      if (k.source === a.source && wordOverlap(k._key, a._key) > 0.4) return true;
      return false;
    });
    if (!isDup) kept.push(a);
  }

  const clean = kept.map(({ _key, ...rest }) => rest);
  res.status(200).json({ ok: true, count: clean.length, articles: clean });
};
