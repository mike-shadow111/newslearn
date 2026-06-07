const https = require('https');
const http = require('http');

function fetchUrl(url, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('too many redirects'));
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Newslearn/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
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

function extractArticle(html, url) {
  // Remove noise
  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // Try known article containers in order of specificity
  const selectors = [
    // Guardian
    /<div[^>]*itemprop="articleBody"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
    // BBC
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    // NY Times
    /<section[^>]*name="articleBody"[^>]*>([\s\S]*?)<\/section>/i,
    // The Verge / Ars Technica
    /<div[^>]*class="[^"]*(?:article-body|post-body|entry-content|article__body|article-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    // Generic
    /<main[^>]*>([\s\S]*?)<\/main>/i,
  ];

  let body = '';
  for (const sel of selectors) {
    const m = html.match(sel);
    if (m && m[1] && m[1].length > 300) { body = m[1]; break; }
  }

  if (!body) return null;

  // Extract paragraphs, headings, blockquotes
  const blocks = [];
  const blockRe = /<(h[1-4]|p|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = blockRe.exec(body)) !== null) {
    const tag = match[1].toLowerCase();
    const text = match[2]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
      .replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#\d+;/g,'')
      .replace(/&[a-z]+;/g,' ').replace(/\s+/g,' ').trim();

    if (!text || text.length < 20) continue;
    // Skip nav/promo/related text
    if (/^(sign up|subscribe|get our|read more|advertisement|related[: ]|more from|follow us|share this|save story|add to|copyright|all rights|terms of use|privacy policy|cookie|topics:|section:|tags:|topics covered)/i.test(text)) continue;
    if (/^(share|save|bookmark|print|listen|watch|video|audio|photo|gallery|slideshow)/i.test(text)) continue;
    // Skip very short "sentences" that are bylines/captions
    if (text.length < 30 && b.tag === 'p') continue;

    blocks.push({ tag, text });
  }

  if (blocks.length < 3) return null;
  return blocks;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');

  const { url } = req.query;
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ ok: false, error: 'invalid url' });
  }

  try {
    const html = await fetchUrl(url);
    const blocks = extractArticle(html, url);
    if (!blocks) return res.status(200).json({ ok: false, error: 'could not extract' });
    res.status(200).json({ ok: true, blocks });
  } catch (e) {
    res.status(200).json({ ok: false, error: e.message });
  }
};
