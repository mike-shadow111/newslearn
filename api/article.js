const https = require('https');
const http = require('http');

function fetchUrl(url, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('too many redirects'));
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return fetchUrl(next, redirects + 1).then(resolve).catch(reject);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function decodeEntities(s) {
  return (s || '')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&nbsp;/g,' ')
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
      .replace(/<br\s*\/?>/gi,' ')
      .replace(/<\/p>/gi,' ')
      .replace(/<[^>]+>/g,'')
  ).replace(/\s+/g,' ').trim();
}

// Junk patterns to skip
const JUNK = [
  /^(sign up|subscribe|get our|click here|read more|more from|follow us)/i,
  /^(share this|save story|bookmark|print this|listen to)/i,
  /^(advertisement|sponsored|promoted)/i,
  /^(related:|also read|see also|you may also)/i,
  /^(copyright|all rights reserved|terms of|privacy policy)/i,
  /^(image:|photo:|caption:|credit:|picture:)/i,
  /^(tags:|topics:|section:|filed under:)/i,
  /newsletter|unsubscribe|opt.?out/i,
  /^[^a-zA-Z]/,  // starts with non-letter (likely a caption/label)
];

function isJunkBlock(text, tag) {
  if (!text || text.length < 25) return true;
  // Captions are usually short italic/figcaption
  if (tag === 'figcaption') return true;
  for (const re of JUNK) {
    if (re.test(text)) return true;
  }
  return false;
}

function extractArticle(html) {
  // Strip noise blocks entirely
  html = html
    .replace(/<script[\s\S]*?<\/script>/gi,'')
    .replace(/<style[\s\S]*?<\/style>/gi,'')
    .replace(/<nav[\s\S]*?<\/nav>/gi,'')
    .replace(/<header[\s\S]*?<\/header>/gi,'')
    .replace(/<footer[\s\S]*?<\/footer>/gi,'')
    .replace(/<aside[\s\S]*?<\/aside>/gi,'')
    .replace(/<figure[\s\S]*?<\/figure>/gi,'') // removes image captions
    .replace(/<picture[\s\S]*?<\/picture>/gi,'')
    .replace(/<!--[\s\S]*?-->/g,'');

  // Try known article containers
  const containers = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]*itemprop="articleBody"[^>]*>([\s\S]*?)<\/div>/i,
    /<section[^>]*name="articleBody"[^>]*>([\s\S]*?)<\/section>/i,
    /<div[^>]*class="[^"]*(?:article-body|post-body|entry-content|article__body|article-content|story-body|page-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
  ];

  let body = '';
  for (const re of containers) {
    const m = html.match(re);
    if (m && m[1] && m[1].length > 400) { body = m[1]; break; }
  }
  if (!body) return null;

  // Extract structured blocks
  const blocks = [];
  const re = /<(h[1-4]|p|blockquote|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    const tag  = m[1].toLowerCase();
    const text = stripHtml(m[2]);
    if (isJunkBlock(text, tag)) continue;
    // Skip very long "paragraphs" that are likely concatenated page content
    if (text.length > 2000) continue;
    blocks.push({ tag, text });
  }

  return blocks.length >= 2 ? blocks : null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');

  const { url } = req.query;
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ ok: false, error: 'invalid url' });
  }

  try {
    const html   = await fetchUrl(url);
    const blocks = extractArticle(html);
    if (!blocks) return res.status(200).json({ ok: false, error: 'could not extract' });
    res.status(200).json({ ok: true, blocks });
  } catch(e) {
    res.status(200).json({ ok: false, error: e.message });
  }
};
