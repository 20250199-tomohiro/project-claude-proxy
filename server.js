const express = require('express');
const cheerio = require('cheerio');
const dns = require('dns').promises;
const net = require('net');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));
app.use('/proxy', express.raw({ type: () => true, limit: '10mb' }));

/* ---------- SSRF 対策: 内部ネットワークへのアクセスを禁止 ---------- */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (l.startsWith('::ffff:')) return isPrivateIp(l.slice(7));
    return l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe8') ||
           l.startsWith('fe9') || l.startsWith('fea') || l.startsWith('feb');
  }
  return true;
}

async function assertPublicHost(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('private address');
    return;
  }
  const addrs = await dns.lookup(hostname, { all: true });
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) {
    throw new Error('private address');
  }
}

/* ---------- URL 書き換え ---------- */
function proxify(value, base) {
  if (!value) return value;
  const v = value.trim();
  if (/^(#|data:|javascript:|mailto:|tel:|blob:|about:)/i.test(v)) return value;
  if (v.startsWith('/proxy?url=')) return value;
  try {
    const abs = new URL(v, base);
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return value;
    return '/proxy?url=' + encodeURIComponent(abs.href);
  } catch {
    return value;
  }
}

function rewriteSrcset(value, base) {
  return value
    .split(',')
    .map(part => {
      const [u, ...rest] = part.trim().split(/\s+/);
      return [proxify(u, base), ...rest].join(' ');
    })
    .join(', ');
}

function rewriteCss(css, base) {
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_, q, u) => `url(${q}${proxify(u, base)}${q})`)
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (_, q, u) => `@import ${q}${proxify(u, base)}${q}`);
}

// ページ内の JS (fetch / XHR / window.open) もプロキシ経由にするためのシム
const SHIM = `
(function(){
  var B = document.currentScript.getAttribute('data-base');
  function P(u){
    try{
      if (typeof u !== 'string') u = String(u);
      if (/^(#|data:|javascript:|blob:|mailto:|tel:)/i.test(u)) return u;
      if (u.indexOf('/proxy?url=') === 0) return u;
      var a = new URL(u, B);
      if (a.protocol !== 'http:' && a.protocol !== 'https:') return u;
      return '/proxy?url=' + encodeURIComponent(a.href);
    }catch(e){ return u; }
  }
  var of = window.fetch;
  if (of) window.fetch = function(input, init){
    if (typeof input === 'string' || input instanceof URL) return of.call(this, P(input), init);
    if (input && input.url) return of.call(this, new Request(P(input.url), input), init);
    return of.call(this, input, init);
  };
  var oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, u){
    arguments[1] = P(u);
    return oo.apply(this, arguments);
  };
  var ow = window.open;
  window.open = function(u){
    if (u) arguments[0] = P(u);
    return ow.apply(this, arguments);
  };
})();
`;

function rewriteHtml(html, base) {
  const $ = cheerio.load(html);

  $('base').remove();
  $('meta[http-equiv]').each((_, el) => {
    const h = ($(el).attr('http-equiv') || '').toLowerCase();
    if (h === 'content-security-policy') $(el).remove();
    if (h === 'refresh') {
      const c = $(el).attr('content') || '';
      $(el).attr('content', c.replace(/(url=)(.+)$/i, (_, p, u) => p + proxify(u, base)));
    }
  });
  $('[integrity]').removeAttr('integrity');
  $('[crossorigin]').removeAttr('crossorigin');

  const attrMap = [
    ['a', 'href'], ['area', 'href'], ['link', 'href'],
    ['script', 'src'], ['img', 'src'], ['iframe', 'src'], ['frame', 'src'],
    ['source', 'src'], ['video', 'src'], ['video', 'poster'], ['audio', 'src'],
    ['embed', 'src'], ['form', 'action'], ['input', 'src'], ['track', 'src'],
  ];
  for (const [tag, attr] of attrMap) {
    $(tag).each((_, el) => {
      const v = $(el).attr(attr);
      if (v) $(el).attr(attr, proxify(v, base));
    });
  }
  $('img[srcset], source[srcset]').each((_, el) => {
    $(el).attr('srcset', rewriteSrcset($(el).attr('srcset'), base));
  });
  $('a[target], form[target]').attr('target', '_self');
  $('style').each((_, el) => {
    $(el).text(rewriteCss($(el).text(), base));
  });
  $('[style]').each((_, el) => {
    $(el).attr('style', rewriteCss($(el).attr('style'), base));
  });

  const shimTag = `<script data-base="${base.replace(/"/g, '&quot;')}">${SHIM}</script>`;
  if ($('head').length) $('head').prepend(shimTag);
  else $.root().prepend(shimTag);

  return $.html();
}

/* ---------- プロキシ本体 ---------- */
const STRIP_RES_HEADERS = new Set([
  'content-security-policy', 'content-security-policy-report-only',
  'x-frame-options', 'content-encoding', 'content-length', 'transfer-encoding',
  'set-cookie', 'strict-transport-security', 'connection', 'keep-alive',
  'cross-origin-opener-policy', 'cross-origin-embedder-policy',
  'cross-origin-resource-policy', 'report-to', 'nel',
]);

app.all('/proxy', async (req, res) => {
  let raw = (req.query.url || '').toString().trim();
  if (!raw) return res.status(400).send('url パラメータがありません');
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;

  let target;
  try {
    target = new URL(raw);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('bad protocol');
    await assertPublicHost(target.hostname);
  } catch {
    return res.status(400).send('このURLにはアクセスできません');
  }

  const headers = {
    'user-agent': req.get('user-agent') || 'Mozilla/5.0',
    accept: req.get('accept') || '*/*',
    'accept-language': req.get('accept-language') || 'ja,en;q=0.8',
  };
  if (req.get('content-type')) headers['content-type'] = req.get('content-type');

  const hasBody = !['GET', 'HEAD'].includes(req.method) && Buffer.isBuffer(req.body) && req.body.length > 0;

  try {
    const upstream = await fetch(target.href, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(25000),
    });

    // リダイレクトもプロキシ経由にする
    if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location')) {
      return res.redirect(upstream.status, proxify(upstream.headers.get('location'), target.href));
    }

    upstream.headers.forEach((value, key) => {
      if (!STRIP_RES_HEADERS.has(key.toLowerCase())) res.setHeader(key, value);
    });
    res.status(upstream.status);

    const type = (upstream.headers.get('content-type') || '').toLowerCase();
    if (type.includes('text/html')) {
      const html = await upstream.text();
      res.setHeader('content-type', 'text/html; charset=utf-8');
      return res.send(rewriteHtml(html, target.href));
    }
    if (type.includes('text/css')) {
      const css = await upstream.text();
      return res.send(rewriteCss(css, target.href));
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (err) {
    res.status(502).send('取得に失敗しました: ' + (err.name === 'TimeoutError' ? 'タイムアウト' : err.message));
  }
});

app.get('/healthz', (_, res) => res.send('ok'));

app.listen(PORT, () => console.log(`proxy listening on ${PORT}`));
