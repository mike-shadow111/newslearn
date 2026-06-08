const https = require('https');
const http = require('http');

function fetchUrl(url, redirects = 0, extraHeaders = {}) {
  if (redirects > 5) return Promise.reject(new Error('too many redirects'));
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        ...extraHeaders,
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return fetchUrl(next, redirects + 1).then(resolve).catch(reject);
      }
      let data = ''; res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('timeout')); });
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
  let r = (s || '')
    // Remove complete tags
    .replace(/<[^>]+>/g, ' ')
    // Remove any leftover tag fragments like href="..." or broken attributes
    .replace(/\b(href|src|class|id|style|data-[a-z-]+)=["'][^"']*["']/gi, ' ')
    // Remove bare URLs that leaked through
    .replace(/https?:\/\/[^\s<>"']+/g, ' ')
    // Remove HTML attribute fragments
    .replace(/[a-z-]+=["'][^"']{0,200}["']/gi, ' ')
    // Remove CMP and tracking params
    .replace(/[?&]?CMP=[^\s]*/g, ' ')
    // Remove leftover > or < chars
    .replace(/[<>]/g, ' ');
  return decodeEntities(r).replace(/\s+/g, ' ').trim();
}

const JUNK_RE = [
  /^(sign up|subscribe|get our|click here|read more|more from|follow us|newsletter)/i,
  /^(share|save story|bookmark|print|listen|watch|audio|video|podcast)/i,
  /^(advertisement|sponsored|promoted|partner content)/i,
  /^(related[: ]|also read|see also|you may also|more on this|read next)/i,
  /^(copyright|©|all rights reserved|terms of|privacy policy|cookie)/i,
  /^(image[: ]|photo[: ]|caption[: ]|credit[: ]|picture[: ]|illustration[: ]|photograph)/i,
  /^(tags[: ]|topics[: ]|section[: ]|filed under|keywords)/i,
  /^(by |written by |reported by |edited by )/i,
  /newsletter|unsubscribe|opt.?out|manage (your )?preferences/i,
  /this (article|story) (was|is) (originally )?published/i,
  /\bcomments?\b.*\d+|\bleave a comment\b|\bjoin the discussion\b/i,
  /^\s*[\d•·|–—]+\s*$/,
];

function isJunk(text, tag) {
  if (!text || text.length < 30) return true;
  if (tag === 'figcaption' || tag === 'cite' || tag === 'time') return true;
  // Short p-tags that look like bylines (e.g. "By John Smith")
  if (tag === 'p' && text.length < 80 && /^[A-Z][a-z]+ [A-Z][a-z]+/.test(text) && text.split(' ').length <= 4) return true;
  for (const re of JUNK_RE) if (re.test(text)) return true;
  return false;
}

function cleanHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi,'')
    .replace(/<style[\s\S]*?<\/style>/gi,'')
    .replace(/<nav[\s\S]*?<\/nav>/gi,'')
    .replace(/<header[\s\S]*?<\/header>/gi,'')
    .replace(/<footer[\s\S]*?<\/footer>/gi,'')
    .replace(/<aside[\s\S]*?<\/aside>/gi,'')
    .replace(/<figure[\s\S]*?<\/figure>/gi,'')
    .replace(/<figcaption[\s\S]*?<\/figcaption>/gi,'')
    .replace(/<picture[\s\S]*?<\/picture>/gi,'')
    .replace(/<img[^>]*>/gi,'')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi,'')
    .replace(/<form[\s\S]*?<\/form>/gi,'')
    .replace(/<button[\s\S]*?<\/button>/gi,'')
    .replace(/<input[^>]*>/gi,'')
    .replace(/<svg[\s\S]*?<\/svg>/gi,'')
    // Remove divs with junk class names
    .replace(/<div[^>]*class="[^"]*(?:related|promo|newsletter|subscribe|signup|share|social|comment|tag|byline|author-bio|advertisement|ad-unit|sidebar|widget|recommendation|also-read|more-from)[^"]*"[^>]*>[\s\S]*?<\/div>/gi,'')
    .replace(/<!--[\s\S]*?-->/g,'');
}

function extractBody(html) {
  const containers = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]*itemprop="articleBody"[^>]*>([\s\S]*?)<\/div>/i,
    /<section[^>]*(?:name|id)="articleBody"[^>]*>([\s\S]*?)<\/section>/i,
    /<div[^>]*class="[^"]*(?:article-body|post-body|entry-content|article__body|article-content|story-body|page-content|article__content|post-content|content-body)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
  ];
  for (const re of containers) {
    const m = html.match(re);
    if (m && m[1] && m[1].length > 500) return m[1];
  }
  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const { url } = req.query;
  if (!url || !url.startsWith('http'))
    return res.status(400).json({ ok: false, error: 'invalid url' });

  try {
    // Try direct fetch first, fall back to Jina.ai reader if blocked
    let raw = await fetchUrl(url).catch(() => null);
    let useJina = false;

    // If blocked (too short or no HTML structure) use Jina
    if (!raw || raw.length < 500 || !/<[a-z]/i.test(raw)) {
      raw = await fetchUrl('https://r.jina.ai/' + url, 0, {
        'Accept': 'text/plain',
        'X-Return-Format': 'text',
      });
      useJina = true;
    }

    // If Jina returned plain text, convert to blocks directly
    if (useJina && raw && raw.length > 200) {
      const lines = raw.split(/\n+/).map(l => l.trim())
        .filter(l => l.length > 40 && !isJunk(l, 'p'));
      if (lines.length >= 2) {
        const blocks = lines.map(text => ({ tag: 'p', text }));
        return res.json({ ok: true, blocks });
      }
    }

    const html  = cleanHtml(raw || '');
    const body  = extractBody(html);
    if (!body) return res.json({ ok: false, error: 'could not extract' });

    const blocks = [];
    const re = /<(h[1-4]|p|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi;
    let m;
    while ((m = re.exec(body)) !== null) {
      const tag  = m[1].toLowerCase();
      const text = stripHtml(m[2]);
      if (isJunk(text, tag)) continue;
      if (text.length > 2000) continue;
      blocks.push({ tag, text });
    }

    // Fallback: split plain text if too few <p> tags found
    if (blocks.length < 2) {
      const plain = stripHtml(body).replace(/\s+/g,' ');
      const sentences = plain.match(/[^.!?]+[.!?]+/g) || [];
      const chunks = [];
      let chunk = '';
      for (const s of sentences) {
        chunk += s;
        if (chunk.length > 150) { chunks.push(chunk.trim()); chunk = ''; }
      }
      if (chunk.length > 40) chunks.push(chunk.trim());
      chunks.filter(s => !isJunk(s,'p')).forEach(s => blocks.push({ tag:'p', text:s }));
    }
    if (blocks.length < 2) return res.json({ ok: false, error: 'too few blocks' });

        res.json({ ok: true, blocks });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
};