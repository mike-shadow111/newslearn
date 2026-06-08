const https = require('https');
const http = require('http');

function fetchUrl(url, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('too many redirects'));
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
  return decodeEntities(
    (s || '').replace(/<[^>]+>/g,' ')
  ).replace(/\s+/g,' ').trim();
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
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');

  const { url } = req.query;
  if (!url || !url.startsWith('http'))
    return res.status(400).json({ ok: false, error: 'invalid url' });

  try {
    const raw   = await fetchUrl(url);
    const html  = cleanHtml(raw);
    const body  = extractBody(html);
    if (!body) return res.json({ ok: false, error: 'could not extract' });

    const blocks = [];
    const re = /<(h[1-4]|p|blockquote)[^>]*>([\s\S]*?)<\/>/gi;
    let m;
    while ((m = re.exec(body)) !== null) {
      const tag  = m[1].toLowerCase();
      const text = stripHtml(m[2]);
      if (isJunk(text, tag)) continue;
      if (text.length > 2000) continue;
      blocks.push({ tag, text });
    }

    if (blocks.length < 2) return res.json({ ok: false, error: 'too few blocks' });

    // Clean with Groq if key available
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
      try {
        const rawText = blocks.map(b => b.text).join('\n\n');
        const groqRes = await new Promise((resolve, reject) => {
          const body2 = JSON.stringify({
            model: 'llama3-8b-8192',
            messages: [{
              role: 'user',
              content: `Clean this article text: remove any subscription prompts, author bios, image captions, ads, or navigation text. Keep all real article content intact. Return only the cleaned paragraphs, one per line, no extra commentary.\n\n${rawText.slice(0, 6000)}`
            }],
            max_tokens: 2000,
            temperature: 0
          });
          const req2 = https.request({
            hostname: 'api.groq.com',
            path: '/openai/v1/chat/completions',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${groqKey}`,
              'Content-Length': Buffer.byteLength(body2)
            }
          }, r => {
            let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(d));
          });
          req2.on('error', reject);
          req2.setTimeout(15000, () => { req2.destroy(); reject(new Error('groq timeout')); });
          req2.write(body2); req2.end();
        });
        const parsed = JSON.parse(groqRes);
        const cleaned = parsed.choices?.[0]?.message?.content;
        if (cleaned && cleaned.length > 100) {
          const cleanedBlocks = cleaned.split('\n\n')
            .map(t => t.trim()).filter(t => t.length > 30)
            .map(t => ({ tag: 'p', text: t }));
          if (cleanedBlocks.length >= 2) {
            return res.json({ ok: true, blocks: cleanedBlocks, cleaned: true });
          }
        }
      } catch(groqErr) {
        // Groq failed — fall through to unclean blocks
      }
    }

    res.json({ ok: true, blocks });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
};
