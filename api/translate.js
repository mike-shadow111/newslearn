const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=86400'); // cache translations 24h

  const { q } = req.query;
  if (!q || q.length > 200) return res.status(400).json({ ok: false });

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return res.json({ ok: false, error: 'no key' });

  try {
    const body = JSON.stringify({
      model: 'llama3-8b-8192',
      messages: [{
        role: 'user',
        content: `Translate this English word or phrase to Russian. Reply with ONLY the Russian translation, nothing else, no explanations, no punctuation at the end.\n\nEnglish: ${q}`
      }],
      max_tokens: 60,
      temperature: 0
    });

    const translation = await new Promise((resolve, reject) => {
      const r = https.request({
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`,
          'Content-Length': Buffer.byteLength(body)
        }
      }, resp => {
        let d = '';
        resp.on('data', c => d += c);
        resp.on('end', () => {
          try {
            const parsed = JSON.parse(d);
            resolve(parsed.choices?.[0]?.message?.content?.trim() || '');
          } catch { reject(new Error('parse error')); }
        });
      });
      r.on('error', reject);
      r.setTimeout(8000, () => { r.destroy(); reject(new Error('timeout')); });
      r.write(body); r.end();
    });

    if (!translation) throw new Error('empty response');
    res.json({ ok: true, translation, source: 'groq' });
  } catch(e) {
    // Fallback to MyMemory
    try {
      const fbRes = await new Promise((resolve, reject) => {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=en|ru`;
        https.get(url, r => {
          let d = ''; r.on('data', c => d += c);
          r.on('end', () => resolve(d));
        }).on('error', reject).setTimeout(5000, function(){ this.destroy(); reject(new Error('timeout')); });
      });
      const fbData = JSON.parse(fbRes);
      const tr = fbData.responseData?.translatedText;
      const trClean = (tr||'').toLowerCase().trim();
      if (!trClean || trClean === q.toLowerCase()) throw new Error('no translation');
      const trFinal = trClean.charAt(0).toUpperCase() + trClean.slice(1);
      res.json({ ok: true, translation: trFinal, source: 'mymemory' });
    } catch(e2) {
      res.json({ ok: false, error: e2.message });
    }
  }
};
