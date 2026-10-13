const express = require('express');
const cheerio = require('cheerio');
const dns = require('dns').promises;
const net = require('net');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');

// トップページは server.js に埋め込み（ファイルの置き場所に依存しない）
const INDEX_HTML = "<!doctype html>\n<html lang=\"ja\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <title>Web Proxy</title>\n  <style>\n    :root { color-scheme: dark; }\n    * { box-sizing: border-box; }\n    body {\n      margin: 0;\n      min-height: 100vh;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      background: radial-gradient(circle at 50% 30%, #1e293b, #0b1020 70%);\n      font-family: system-ui, -apple-system, \"Hiragino Sans\", \"Yu Gothic\", sans-serif;\n      color: #e5e7eb;\n    }\n    main { width: 100%; max-width: 640px; padding: 0 20px; text-align: center; }\n    h1 { font-size: 2.2rem; font-weight: 600; margin: 0 0 28px; letter-spacing: .02em; }\n    form {\n      display: flex;\n      gap: 8px;\n      background: #111827;\n      border: 1px solid #334155;\n      border-radius: 999px;\n      padding: 6px;\n      transition: border-color .15s, box-shadow .15s;\n    }\n    form:focus-within { border-color: #60a5fa; box-shadow: 0 0 0 3px rgba(96,165,250,.25); }\n    input[type=\"text\"] {\n      flex: 1;\n      min-width: 0;\n      background: transparent;\n      border: none;\n      outline: none;\n      color: inherit;\n      font-size: 1rem;\n      padding: 12px 16px;\n    }\n    input::placeholder { color: #64748b; }\n    button {\n      background: #3b82f6;\n      color: #fff;\n      border: none;\n      border-radius: 999px;\n      padding: 0 24px;\n      font-size: 1rem;\n      cursor: pointer;\n    }\n    button:hover { background: #2563eb; }\n    .opt {\n      display: inline-flex;\n      align-items: center;\n      gap: 8px;\n      margin-top: 18px;\n      color: #cbd5e1;\n      font-size: .95rem;\n      cursor: pointer;\n      user-select: none;\n    }\n    .opt input { width: 18px; height: 18px; accent-color: #3b82f6; cursor: pointer; }\n    p { color: #64748b; font-size: .85rem; margin: 10px 0 0; }\n  </style>\n</head>\n<body>\n  <main>\n    <h1>Web Proxy</h1>\n    <form id=\"f\">\n      <input id=\"u\" type=\"text\" placeholder=\"URL を入力（例: example.com）\" autocomplete=\"off\" autofocus>\n      <button type=\"submit\">移動</button>\n    </form>\n    <label class=\"opt\">\n      <input id=\"cloak\" type=\"checkbox\">\n      about:blank で開く（履歴に残さないモード）\n    </label>\n    <p>URL 以外を入力すると DuckDuckGo で検索します</p>\n  </main>\n  <script>\n    function resolveUrl(v) {\n      v = v.trim();\n      if (!v) return '';\n      if (/^https?:\\/\\//i.test(v)) return v;\n      if (/^[^\\s]+\\.[^\\s]{2,}$/.test(v) || /^localhost/.test(v)) return 'https://' + v;\n      return 'https://duckduckgo.com/html/?q=' + encodeURIComponent(v);\n    }\n\n    // about:blank のタブを開き、その中にプロキシを全画面で表示する\n    function openCloaked(url) {\n      var w = window.open('about:blank', '_blank');\n      if (!w) {\n        alert('ポップアップがブロックされました。このサイトのポップアップを許可してからもう一度お試しください。');\n        return false;\n      }\n      var origin = location.origin;\n      var start = url ? origin + '/proxy?url=' + encodeURIComponent(url) : '';\n      var page =\n        '<!doctype html><html><head><meta charset=\"utf-8\">' +\n        '<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">' +\n        '<style>' +\n        'html,body{margin:0;height:100%;background:#0b1020;font-family:system-ui,sans-serif}' +\n        'body{display:flex;flex-direction:column}' +\n        '#bar{display:flex;gap:6px;padding:6px;background:#111827;border-bottom:1px solid #334155}' +\n        '#u{flex:1;min-width:0;background:#0b1020;border:1px solid #334155;border-radius:999px;' +\n        'color:#e5e7eb;font-size:14px;padding:8px 14px;outline:none}' +\n        '#u:focus{border-color:#60a5fa}' +\n        '#bar button{background:#3b82f6;color:#fff;border:none;border-radius:999px;padding:0 16px;font-size:14px;cursor:pointer}' +\n        '#v{flex:1;width:100%;border:0;background:#fff}' +\n        '</style></head><body>' +\n        '<form id=\"bar\"><input id=\"u\" type=\"text\" placeholder=\"URL を入力 / 検索\" autocomplete=\"off\">' +\n        '<button type=\"submit\">移動</button></form>' +\n        '<iframe id=\"v\"></iframe>' +\n        '<script>' +\n        'var O=' + JSON.stringify(origin) + ';' +\n        'var S=' + JSON.stringify(start) + ';' +\n        'function R(v){v=v.trim();if(!v)return\"\";' +\n        'if(/^https?:\\\\/\\\\//i.test(v))return v;' +\n        'if(/^[^\\\\s]+\\\\.[^\\\\s]{2,}$/.test(v)||/^localhost/.test(v))return\"https://\"+v;' +\n        'return\"https://duckduckgo.com/html/?q=\"+encodeURIComponent(v);}' +\n        'var F=document.getElementById(\"v\");' +\n        'F.src=S||(O+\"/\");' +\n        'document.getElementById(\"bar\").addEventListener(\"submit\",function(e){' +\n        'e.preventDefault();var u=R(document.getElementById(\"u\").value);' +\n        'if(u)F.src=O+\"/proxy?url=\"+encodeURIComponent(u);});' +\n        '<\\/script></body></html>';\n      w.document.open();\n      w.document.write(page);\n      w.document.close();\n      return true;\n    }\n\n    var cloakBox = document.getElementById('cloak');\n    try { cloakBox.checked = localStorage.getItem('cloak') === '1'; } catch (e) {}\n    cloakBox.addEventListener('change', function () {\n      try { localStorage.setItem('cloak', cloakBox.checked ? '1' : '0'); } catch (e) {}\n    });\n\n    document.getElementById('f').addEventListener('submit', function (e) {\n      e.preventDefault();\n      var url = resolveUrl(document.getElementById('u').value);\n      if (cloakBox.checked) {\n        openCloaked(url);\n        return;\n      }\n      if (!url) return;\n      location.href = '/proxy?url=' + encodeURIComponent(url);\n    });\n  </script>\n</body>\n</html>\n";

app.get('/', (req, res) => {
  res.type('html').send(INDEX_HTML);
});
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

// ページ上部に重ねて表示するアドレスバー（戻る/進む/再読み込み/URL入力）
const BAR = String.raw`
(function(){
  if (window.top !== window) return;
  var B = document.currentScript.getAttribute('data-base');
  function R(v){
    v = v.trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    if (/^[^\s]+\.[^\s]{2,}$/.test(v) || /^localhost/.test(v)) return 'https://' + v;
    return 'https://duckduckgo.com/html/?q=' + encodeURIComponent(v);
  }
  function go(u){ location.href = '/proxy?url=' + encodeURIComponent(u); }
  function mount(){
    if (document.getElementById('__px_bar')) return;
    var host = document.createElement('div');
    host.id = '__px_bar';
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;right:0;z-index:2147483647;';
    var root = host.attachShadow({mode:'open'});
    root.innerHTML =
      '<style>' +
      '.bar{display:flex;gap:6px;align-items:center;height:42px;padding:5px 8px;box-sizing:border-box;' +
      'background:#111827;border-bottom:1px solid #334155;font-family:system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.35)}' +
      '.bar.off{display:none}' +
      'button{background:#1f2937;color:#e5e7eb;border:1px solid #334155;border-radius:8px;min-width:32px;height:30px;' +
      'font-size:14px;cursor:pointer;padding:0 8px}' +
      'button:hover{background:#374151}' +
      'button.go{background:#3b82f6;border-color:#3b82f6;color:#fff}' +
      'input{flex:1;min-width:0;height:30px;box-sizing:border-box;background:#0b1020;color:#e5e7eb;' +
      'border:1px solid #334155;border-radius:999px;padding:0 14px;font-size:14px;outline:none}' +
      'input:focus{border-color:#60a5fa}' +
      '.tab{display:none;position:fixed;top:0;right:10px;height:22px;min-width:0;padding:0 10px;border-radius:0 0 8px 8px;' +
      'font-size:11px;background:#111827}' +
      '.tab.on{display:block}' +
      '@media print{:host{display:none}}' +
      '</style>' +
      '<form class="bar" id="bar">' +
      '<button type="button" id="back" title="戻る">&#9664;</button>' +
      '<button type="button" id="fwd" title="進む">&#9654;</button>' +
      '<button type="button" id="rel" title="再読み込み">&#8635;</button>' +
      '<button type="button" id="home" title="トップへ">&#8962;</button>' +
      '<input id="u" type="text" autocomplete="off" spellcheck="false" placeholder="URL を入力 / 検索">' +
      '<button type="submit" class="go">移動</button>' +
      '<button type="button" id="hide" title="バーを隠す">&#10005;</button>' +
      '</form>' +
      '<button type="button" class="tab" id="tab" title="バーを表示">&#9660;</button>';

    var bar = root.getElementById('bar'), tab = root.getElementById('tab'), input = root.getElementById('u');
    input.value = B;
    input.addEventListener('focus', function(){ input.select(); });
    root.getElementById('back').onclick = function(){ history.back(); };
    root.getElementById('fwd').onclick = function(){ history.forward(); };
    root.getElementById('rel').onclick = function(){ location.reload(); };
    root.getElementById('home').onclick = function(){ location.href = '/'; };
    bar.addEventListener('submit', function(e){
      e.preventDefault();
      var u = R(input.value);
      if (u) go(u);
    });
    function setHidden(h){
      bar.classList.toggle('off', h);
      tab.classList.toggle('on', h);
      try { sessionStorage.setItem('px_bar_hidden', h ? '1' : '0'); } catch(e) {}
    }
    root.getElementById('hide').onclick = function(){ setHidden(true); };
    tab.onclick = function(){ setHidden(false); };
    var hidden = false;
    try { hidden = sessionStorage.getItem('px_bar_hidden') === '1'; } catch(e) {}
    setHidden(hidden);
    document.documentElement.appendChild(host);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
`;

/* ---------- 文字コード判定（Shift_JIS / EUC-JP などの日本語サイト対策） ---------- */
function declaredCharset(buf, contentType, kind) {
  const h = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType || '');
  if (h) return h[1];
  const head = buf.subarray(0, 4096).toString('latin1');
  if (kind === 'html') {
    const m = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head);
    if (m) return m[1];
  } else if (kind === 'css') {
    const m = /^@charset\s+["']([\w.:-]+)["']/i.exec(head);
    if (m) return m[1];
  }
  return null;
}

function decodeBody(buf, contentType, kind) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buf);
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);

  const label = declaredCharset(buf, contentType, kind);
  if (label) {
    try {
      return new TextDecoder(label).decode(buf);
    } catch { /* 未知のラベル → 下の自動判定へ */ }
  }
  // 宣言が無い場合: UTF-8として厳密に読めなければ Shift_JIS とみなす
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    try { return new TextDecoder('shift_jis').decode(buf); } catch { /* fallthrough */ }
  }
  return new TextDecoder('utf-8').decode(buf);
}

function rewriteHtml(html, base) {
  const $ = cheerio.load(html);

  $('base').remove();
  // 出力は常にUTF-8にするので、元の文字コード宣言は取り除く
  $('meta[charset]').remove();
  $('meta[http-equiv]').filter((_, el) => ($(el).attr('http-equiv') || '').toLowerCase() === 'content-type').remove();
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

  const baseAttr = base.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const shimTag = `<script data-base="${baseAttr}">${SHIM}</script>`;
  const barTag = `<script data-base="${baseAttr}">${BAR}</script>`;
  const injected = '<meta charset="utf-8">' + shimTag + barTag;
  if ($('head').length) $('head').prepend(injected);
  else $.root().prepend(injected);

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
      const html = decodeBody(Buffer.from(await upstream.arrayBuffer()), type, 'html');
      res.setHeader('content-type', 'text/html; charset=utf-8');
      return res.send(rewriteHtml(html, target.href));
    }
    if (type.includes('text/css')) {
      const css = decodeBody(Buffer.from(await upstream.arrayBuffer()), type, 'css');
      res.setHeader('content-type', 'text/css; charset=utf-8');
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
