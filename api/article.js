const https = require('https');
const http  = require('http');

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
      // Treat paywalled responses (403/401/redirected to login) as failures
      if (res.statusCode === 403 || res.statusCode === 401) {
        return reject(new Error('blocked ' + res.statusCode));
      }
      let data = ''; res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function fetchJina(url) {
  return fetchUrl('https://r.jina.ai/' + url, 0, {
    'Accept': 'text/plain',
    'X-Return-Format': 'text',
    'X-Timeout': '10',
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
    .replace(/<[^>]+>/g, ' ')
    .replace(/\b(href|src|class|id|style|data-[a-z-]+)=["'][^"']*["']/gi, ' ')
    .replace(/https?:\/\/[^\s<>"']+/g, ' ')
    .replace(/[a-z-]+=["'][^"']{0,200}["']/gi, ' ')
    .replace(/[?&]?CMP=[^\s]*/g, ' ')
    .replace(/[<>]/g, ' ');
  return decodeEntities(r).replace(/\s+/g, ' ').trim();
}

// Comprehensive junk patterns
const JUNK_RE = [
  /^(sign up|subscribe|get our|click here|read more|more from|follow us|newsletter|join our)/i,
  /^(share|save story|bookmark|print|listen|watch|audio|video|podcast|email this)/i,
  /^(advertisement|sponsored|promoted|partner content|paid post)/i,
  /^(related[: ]|also read|see also|you may also|more on this|read next|trending|popular)/i,
  /^(copyright|©|all rights reserved|terms of|privacy policy|cookie|do not sell)/i,
  /^(image[: ]|photo[: ]|caption[: ]|credit[: ]|picture[: ]|illustration[: ]|photograph)/i,
  /^(tags[: ]|topics[: ]|section[: ]|filed under|keywords|category)/i,
  /^(by |written by |reported by |edited by |updated by )/i,
  /^(comments?[: ]|\d+ comments?|leave a comment|join the discussion|have your say)/i,
  /^(get the|download the|open the|use the).{0,30}app/i,
  /^(follow|find us on|connect with us|check out our).{0,40}(twitter|facebook|instagram|tiktok|youtube|social)/i,
  /newsletter|unsubscribe|opt.?out|manage (your )?preferences|email preferences/i,
  /this (article|story|piece|report) (was|is) (originally )?published/i,
  /\bcomments?\b.*\d+|\bleave a comment\b|\bjoin the discussion\b/i,
  /^\s*[\d•·|–—]+\s*$/,
  // NYT-specific boilerplate
  /^(a version of this article|this article is part of|this is part of)/i,
  /^(correction:|editor's note:|note:|clarification:)/i,
  /to read (the full|this) (story|article)/i,
  /\bpaywall\b|\bsubscription\b.*\bfull access\b/i,
  // Verge / tech site boilerplate
  /^(verge deals|the verge|the verge's|polygon|vox media)/i,
  /\b(verge deals|affiliate commission|affiliate link)\b/i,
  /^(all products|products featured|we may earn)/i,
];

function isJunk(text, tag) {
  if (!text || text.length < 25) return true;
  if (tag === 'figcaption' || tag === 'cite' || tag === 'time') return true;
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
    // Remove junk sections by class/id
    .replace(/<[^>]*(?:class|id)="[^"]*(?:related|promo|newsletter|subscribe|signup|share|social|comment|tag|byline|author-bio|advertisement|ad-unit|sidebar|widget|recommendation|also-read|more-from|trending|popular|sponsored|read-more|story-footer|article-footer|inline-promo|most-popular|editor-picks|you-might|read-next)[^"]*"[^>]*>[\s\S]*?<\/(?:div|section|aside|ul|ol)>/gi,'')
    .replace(/<!--[\s\S]*?-->/g,'');
}

function extractBody(html) {
  const containers = [
    // NYT specific
    /<section[^>]*data-testid="[^"]*article-body[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
    /<div[^>]*class="[^"]*StoryBodyCompanionColumn[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    // Generic
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]*itemprop="articleBody"[^>]*>([\s\S]*?)<\/div>/i,
    /<section[^>]*(?:name|id)="articleBody"[^>]*>([\s\S]*?)<\/section>/i,
    /<div[^>]*class="[^"]*(?:article-body|post-body|entry-content|article__body|article-content|story-body|page-content|article__content|post-content|content-body|body-content|article-text|post-text|prose|c-entry-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
  ];
  for (const re of containers) {
    const m = html.match(re);
    if (m && m[1] && m[1].length > 300) return m[1];
  }
  return null;
}

// Detect if page is a paywall / login wall
function isPaywalled(html) {
  if (!html || html.length < 1000) return true;
  if (/<[a-z]/i.test(html) === false) return false; // plain text, not HTML — ok
  const lower = html.toLowerCase();
  // NYT, WaPo, Verge etc paywall indicators
  if (/subscribe to continue|subscribe to read|subscribe for full access|create a free account to continue|log in to continue|sign in to continue/.test(lower)) return true;
  if (/regwall|paywall|subscribe-wall|piano-id/.test(lower)) return true;
  // Very short extracted content from a big HTML page = probably walled
  return false;
}

function cleanJinaText(raw) {
  return raw.split(/\n+/)
    .map(l => l.trim())
    .filter(l => {
      if (l.length < 30) return false;
      if (isJunk(l, 'p')) return false;
      // Remove markdown-style link lines from Jina output
      if (/^\[.*\]\(https?:/.test(l)) return false;
      // Remove lines that are just a URL
      if (/^https?:\/\/\S+$/.test(l)) return false;
      return true;
    });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const { url } = req.query;
  if (!url || !url.startsWith('http'))
    return res.status(400).json({ ok: false, error: 'invalid url' });

  try {
    let raw = null;
    let useJina = false;

    // Try direct fetch
    try {
      raw = await fetchUrl(url);
    } catch(e) {
      raw = null;
    }

    // Decide if we need Jina: blocked, too short, or paywalled
    if (!raw || raw.length < 500 || isPaywalled(raw)) {
      try {
        const jinaRaw = await fetchJina(url);
        // Prefer Jina if it returned more content
        if (jinaRaw && jinaRaw.length > (raw ? raw.length * 0.5 : 0)) {
          raw = jinaRaw;
          useJina = true;
        }
      } catch(e) { /* keep raw if we have it */ }
    }

    if (!raw) return res.json({ ok: false, error: 'could not fetch' });

    // Process Jina plain-text result
    if (useJina) {
      const lines = cleanJinaText(raw);
      if (lines.length >= 2) {
        return res.json({ ok: true, blocks: lines.map(text => ({ tag: 'p', text })) });
      }
    }

    const html  = cleanHtml(raw);
    const body  = extractBody(html);

    // If no body extracted but direct fetch worked and page seems accessible,
    // try Jina as fallback extraction method
    if (!body) {
      try {
        const jinaRaw = await fetchJina(url);
        const lines = cleanJinaText(jinaRaw);
        if (lines.length >= 2) {
          return res.json({ ok: true, blocks: lines.map(text => ({ tag: 'p', text })) });
        }
      } catch(e) {}
      return res.json({ ok: false, error: 'could not extract' });
    }

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

    // Fallback to sentence splitting if too few blocks
    if (blocks.length < 2) {
      const plain = stripHtml(body).replace(/\s+/g,' ');
      const sentences = plain.match(/[^.!?]+[.!?]+/g) || [];
      let chunk = '';
      for (const s of sentences) {
        chunk += s;
        if (chunk.length > 150) { if (!isJunk(chunk.trim(),'p')) blocks.push({ tag:'p', text:chunk.trim() }); chunk = ''; }
      }
      if (chunk.length > 40 && !isJunk(chunk.trim(),'p')) blocks.push({ tag:'p', text:chunk.trim() });
    }

    if (blocks.length < 2) return res.json({ ok: false, error: 'too few blocks' });

    res.json({ ok: true, blocks });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
};
