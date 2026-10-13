const express = require('express');
const cheerio = require('cheerio');
const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');
const { pipeline, Readable } = require('stream');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.set('trust proxy', 1);

// トップページは server.js に埋め込み（ファイルの置き場所に依存しない）
const INDEX_HTML = "<!doctype html>\n<html lang=\"ja\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <title>Web Proxy</title>\n  <style>\n    :root { color-scheme: dark; }\n    * { box-sizing: border-box; }\n    body {\n      margin: 0;\n      min-height: 100vh;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      background: radial-gradient(circle at 50% 30%, #1e293b, #0b1020 70%);\n      font-family: system-ui, -apple-system, \"Hiragino Sans\", \"Yu Gothic\", sans-serif;\n      color: #e5e7eb;\n    }\n    main { width: 100%; max-width: 640px; padding: 0 20px; text-align: center; }\n    h1 { font-size: 2.2rem; font-weight: 600; margin: 0 0 28px; letter-spacing: .02em; }\n    form {\n      display: flex;\n      gap: 8px;\n      background: #111827;\n      border: 1px solid #334155;\n      border-radius: 999px;\n      padding: 6px;\n      transition: border-color .15s, box-shadow .15s;\n    }\n    form:focus-within { border-color: #60a5fa; box-shadow: 0 0 0 3px rgba(96,165,250,.25); }\n    input[type=\"text\"] {\n      flex: 1;\n      min-width: 0;\n      background: transparent;\n      border: none;\n      outline: none;\n      color: inherit;\n      font-size: 1rem;\n      padding: 12px 16px;\n    }\n    input::placeholder { color: #64748b; }\n    button {\n      background: #3b82f6;\n      color: #fff;\n      border: none;\n      border-radius: 999px;\n      padding: 0 24px;\n      font-size: 1rem;\n      cursor: pointer;\n    }\n    button:hover { background: #2563eb; }\n    .opt {\n      display: inline-flex;\n      align-items: center;\n      gap: 8px;\n      margin-top: 18px;\n      color: #cbd5e1;\n      font-size: .95rem;\n      cursor: pointer;\n      user-select: none;\n    }\n    .opt input { width: 18px; height: 18px; accent-color: #3b82f6; cursor: pointer; }\n    p { color: #64748b; font-size: .85rem; margin: 10px 0 0; }\n  </style>\n</head>\n<body>\n  <main>\n    <h1>Web Proxy</h1>\n    <form id=\"f\">\n      <input id=\"u\" type=\"text\" placeholder=\"URL を入力（例: example.com）\" autocomplete=\"off\" autofocus>\n      <button type=\"submit\">移動</button>\n    </form>\n    <label class=\"opt\">\n      <input id=\"cloak\" type=\"checkbox\">\n      about:blank で開く（履歴に残さないモード）\n    </label>\n    <p>URL 以外を入力すると DuckDuckGo で検索します</p>\n  </main>\n  <script>\n    function resolveUrl(v) {\n      v = v.trim();\n      if (!v) return '';\n      if (/^https?:\\/\\//i.test(v)) return v;\n      if (/^[^\\s]+\\.[^\\s]{2,}$/.test(v) || /^localhost/.test(v)) return 'https://' + v;\n      return 'https://duckduckgo.com/html/?q=' + encodeURIComponent(v);\n    }\n\n    // about:blank のタブを開き、その中にプロキシを全画面で表示する\n    function openCloaked(url) {\n      var w = window.open('about:blank', '_blank');\n      if (!w) {\n        alert('ポップアップがブロックされました。このサイトのポップアップを許可してからもう一度お試しください。');\n        return false;\n      }\n      var origin = location.origin;\n      var start = url ? origin + '/proxy?url=' + encodeURIComponent(url) : '';\n      var page =\n        '<!doctype html><html><head><meta charset=\"utf-8\">' +\n        '<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">' +\n        '<style>' +\n        'html,body{margin:0;height:100%;background:#0b1020;font-family:system-ui,sans-serif}' +\n        'body{display:flex;flex-direction:column}' +\n        '#bar{display:flex;gap:6px;padding:6px;background:#111827;border-bottom:1px solid #334155}' +\n        '#u{flex:1;min-width:0;background:#0b1020;border:1px solid #334155;border-radius:999px;' +\n        'color:#e5e7eb;font-size:14px;padding:8px 14px;outline:none}' +\n        '#u:focus{border-color:#60a5fa}' +\n        '#bar button{background:#3b82f6;color:#fff;border:none;border-radius:999px;padding:0 16px;font-size:14px;cursor:pointer}' +\n        '#v{flex:1;width:100%;border:0;background:#fff}' +\n        '</style></head><body>' +\n        '<form id=\"bar\"><input id=\"u\" type=\"text\" placeholder=\"URL を入力 / 検索\" autocomplete=\"off\">' +\n        '<button type=\"submit\">移動</button></form>' +\n        '<iframe id=\"v\"></iframe>' +\n        '<script>' +\n        'var O=' + JSON.stringify(origin) + ';' +\n        'var S=' + JSON.stringify(start) + ';' +\n        'function R(v){v=v.trim();if(!v)return\"\";' +\n        'if(/^https?:\\\\/\\\\//i.test(v))return v;' +\n        'if(/^[^\\\\s]+\\\\.[^\\\\s]{2,}$/.test(v)||/^localhost/.test(v))return\"https://\"+v;' +\n        'return\"https://duckduckgo.com/html/?q=\"+encodeURIComponent(v);}' +\n        'var F=document.getElementById(\"v\");' +\n        'F.src=S||(O+\"/\");' +\n        'document.getElementById(\"bar\").addEventListener(\"submit\",function(e){' +\n        'e.preventDefault();var u=R(document.getElementById(\"u\").value);' +\n        'if(u)F.src=O+\"/proxy?url=\"+encodeURIComponent(u);});' +\n        '<\\/script></body></html>';\n      w.document.open();\n      w.document.write(page);\n      w.document.close();\n      return true;\n    }\n\n    var cloakBox = document.getElementById('cloak');\n    try { cloakBox.checked = localStorage.getItem('cloak') === '1'; } catch (e) {}\n    cloakBox.addEventListener('change', function () {\n      try { localStorage.setItem('cloak', cloakBox.checked ? '1' : '0'); } catch (e) {}\n    });\n\n    document.getElementById('f').addEventListener('submit', function (e) {\n      e.preventDefault();\n      var url = resolveUrl(document.getElementById('u').value);\n      if (cloakBox.checked) {\n        openCloaked(url);\n        return;\n      }\n      if (!url) return;\n      location.href = '/proxy?url=' + encodeURIComponent(url);\n    });\n  </script>\n</body>\n</html>\n";

app.get('/', (req, res) => {
  res.type('html').send(INDEX_HTML);
});
app.get('/healthz', (_, res) => res.send('ok'));

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
  const host = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('private address');
    return;
  }
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) {
    throw new Error('private address');
  }
}

/* ---------- Cookie 管理（サイトごとの Cookie をサーバー側で保持） ---------- */
// ブラウザには pxsid（セッションID）だけを渡し、各サイトの Cookie はここに保存する。
// これでサイト間で Cookie が混ざらず、ログインが必要なサイトも使えるようになる。
const SESSIONS = new Map(); // sid -> { jar: Map, seen: number }
const SESSION_TTL = 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 2000;
const MAX_COOKIES = 400;

function parseCookieHeader(header) {
  const out = {};
  String(header || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return out;
}

function getSession(req, res, create) {
  const sid = parseCookieHeader(req.headers.cookie).pxsid;
  let s = sid && SESSIONS.get(sid);
  if (!s && create && res) {
    if (SESSIONS.size >= MAX_SESSIONS) SESSIONS.delete(SESSIONS.keys().next().value);
    const id = crypto.randomBytes(24).toString('hex');
    s = { jar: new Map(), seen: Date.now() };
    SESSIONS.set(id, s);
    res.append('Set-Cookie',
      `pxsid=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${req.secure ? '; Secure' : ''}`);
  }
  if (s) s.seen = Date.now();
  return s || null;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of SESSIONS) if (now - s.seen > SESSION_TTL) SESSIONS.delete(id);
}, 10 * 60 * 1000).unref();

function pathMatch(reqPath, cookiePath) {
  if (reqPath === cookiePath) return true;
  if (!reqPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || reqPath[cookiePath.length] === '/';
}

function storeCookie(session, str, url, fromScript) {
  const parts = String(str).split(';');
  const nv = parts[0];
  const eq = nv.indexOf('=');
  if (eq < 1) return;
  const name = nv.slice(0, eq).trim();
  const value = nv.slice(eq + 1).trim();
  if (!name) return;

  const host = url.hostname.toLowerCase();
  let domain = host;
  let hostOnly = true;
  let path = null;
  let secure = false;
  let httpOnly = false;
  let expires = null;
  let maxAge = null;

  for (const attr of parts.slice(1)) {
    const i = attr.indexOf('=');
    const k = (i < 0 ? attr : attr.slice(0, i)).trim().toLowerCase();
    const v = i < 0 ? '' : attr.slice(i + 1).trim();
    if (k === 'domain' && v) {
      const d = v.replace(/^\./, '').toLowerCase();
      if (!(host === d || host.endsWith('.' + d))) return; // 他ドメインへの Cookie は拒否
      if (!d.includes('.') && d !== 'localhost') return;    // com などへの Cookie は拒否
      domain = d;
      hostOnly = false;
    } else if (k === 'path' && v.startsWith('/')) {
      path = v;
    } else if (k === 'secure') {
      secure = true;
    } else if (k === 'httponly') {
      httpOnly = !fromScript;
    } else if (k === 'max-age') {
      const n = parseInt(v, 10);
      if (!Number.isNaN(n)) maxAge = Date.now() + n * 1000;
    } else if (k === 'expires') {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) expires = t;
    }
  }
  if (maxAge !== null) expires = maxAge;
  if (!path) {
    const p = url.pathname || '/';
    path = p.lastIndexOf('/') > 0 ? p.slice(0, p.lastIndexOf('/')) : '/';
  }

  const key = `${domain}|${path}|${name}`;
  if (expires !== null && expires <= Date.now()) {
    session.jar.delete(key);
    return;
  }
  session.jar.delete(key); // 並び順を新しくする
  session.jar.set(key, { name, value, domain, hostOnly, path, secure, httpOnly, expires });
  while (session.jar.size > MAX_COOKIES) session.jar.delete(session.jar.keys().next().value);
}

function cookieHeaderFor(session, url, includeHttpOnly) {
  if (!session) return '';
  const host = url.hostname.toLowerCase();
  const now = Date.now();
  const list = [];
  for (const [key, c] of session.jar) {
    if (c.expires !== null && c.expires <= now) { session.jar.delete(key); continue; }
    const domainOk = c.hostOnly ? host === c.domain : (host === c.domain || host.endsWith('.' + c.domain));
    if (!domainOk) continue;
    if (!pathMatch(url.pathname || '/', c.path)) continue;
    if (c.secure && url.protocol !== 'https:' && url.protocol !== 'wss:') continue;
    if (c.httpOnly && !includeHttpOnly) continue;
    list.push(c);
  }
  list.sort((a, b) => b.path.length - a.path.length);
  return list.map(c => `${c.name}=${c.value}`).join('; ');
}

function splitSetCookie(header) {
  if (!header) return [];
  return header.split(/,(?=\s*[^;,=\s]+=)/);
}

function storeResponseCookies(session, headers, url) {
  if (!session) return;
  const list = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : splitSetCookie(headers.get('set-cookie'));
  for (const c of list) storeCookie(session, c, url, false);
}

// ページ内のJSが document.cookie に書いた Cookie を受け取る
app.post('/__cookie', express.json({ limit: '16kb' }), (req, res) => {
  try {
    const { url, cookie } = req.body || {};
    const u = new URL(url);
    if (typeof cookie !== 'string' || cookie.length > 4096 || (u.protocol !== 'http:' && u.protocol !== 'https:')) {
      throw new Error('bad request');
    }
    const session = getSession(req, res, true);
    storeCookie(session, cookie, u, true);
    res.status(204).end();
  } catch {
    res.status(400).end();
  }
});

/* ---------- URL 書き換え ---------- */
function proxify(value, base) {
  if (!value) return value;
  const v = value.trim();
  if (/^(#|data:|javascript:|mailto:|tel:|blob:|about:)/i.test(v)) return value;
  if (v.startsWith('/proxy?url=')) return value;
  try {
    const abs = new URL(v, base);
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return value;
    const hash = abs.hash;
    abs.hash = '';
    return '/proxy?url=' + encodeURIComponent(abs.href) + hash;
  } catch {
    return value;
  }
}

function rewriteSrcset(value, base) {
  return value
    .split(/,\s+/)
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

/* ---------- ページに差し込むスクリプト ---------- */
// ページ内のJSが動的に作るリンク・画像・スクリプト・通信もプロキシ経由にする
const SHIM = String.raw`
(function(){
  if (window.__pxShim) return;
  window.__pxShim = 1;
  var S = document.currentScript;
  var B = S.getAttribute('data-base');
  var ORIGIN = location.origin;
  var PFX = '/proxy?url=';
  var of = window.fetch ? window.fetch.bind(window) : null;
  var SA = Element.prototype.setAttribute;

  /* プロキシURL -> 元のURL */
  function real(v){
    try{
      if (typeof v !== 'string') return v;
      var i = v.indexOf(PFX);
      if (i !== 0 && v.indexOf(ORIGIN + PFX) !== 0) return v;
      var rest = v.slice(v.indexOf(PFX) + PFX.length);
      var h = rest.indexOf('#'), hash = '';
      if (h >= 0) { hash = rest.slice(h); rest = rest.slice(0, h); }
      return decodeURIComponent(rest) + hash;
    }catch(e){ return v; }
  }

  /* 元のURL -> プロキシURL */
  function P(u){
    try{
      if (u === null || u === undefined) return u;
      if (typeof u !== 'string') u = String(u);
      var t = u.trim();
      if (!t || /^(#|data:|javascript:|blob:|mailto:|tel:|about:)/i.test(t)) return u;
      if (t.indexOf(PFX) === 0) return u;
      var a = new URL(t, B);
      if (a.origin === ORIGIN) {
        if (a.pathname === '/proxy') return u;
        a = new URL(a.pathname + a.search + a.hash, B);
      }
      if (a.protocol !== 'http:' && a.protocol !== 'https:') return u;
      var hash = a.hash;
      a.hash = '';
      return PFX + encodeURIComponent(a.href) + hash;
    }catch(e){ return u; }
  }

  function PS(v){
    if (typeof v !== 'string') return v;
    return v.split(/,\s+/).map(function(p){
      var x = p.trim().split(/\s+/);
      x[0] = P(x[0]);
      return x.join(' ');
    }).join(', ');
  }

  /* HTML文字列中の src / href / action / poster / srcset を書き換え */
  function RH(h){
    if (typeof h !== 'string' || h.indexOf('<') < 0) return h;
    return h.replace(/(\s(?:src|href|action|poster)\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, function(m, pre, a, b){
      var dq = a !== undefined;
      var v = (dq ? a : b).replace(/&amp;/g, '&');
      var out = P(v);
      if (!dq) out = out.replace(/'/g, '%27');
      return pre + (dq ? '"' : "'") + out + (dq ? '"' : "'");
    }).replace(/(\ssrcset\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, function(m, pre, a, b){
      var dq = a !== undefined;
      var out = PS((dq ? a : b).replace(/&amp;/g, '&'));
      if (!dq) out = out.replace(/'/g, '%27');
      return pre + (dq ? '"' : "'") + out + (dq ? '"' : "'");
    });
  }

  function guard(fn){ try{ fn(); }catch(e){} }

  /* 要素の src / href などのプロパティ */
  guard(function(){
    [
      ['HTMLAnchorElement','href'], ['HTMLAreaElement','href'], ['HTMLLinkElement','href'],
      ['HTMLScriptElement','src'], ['HTMLImageElement','src'], ['HTMLSourceElement','src'],
      ['HTMLIFrameElement','src'], ['HTMLMediaElement','src'], ['HTMLEmbedElement','src'],
      ['HTMLTrackElement','src'], ['HTMLInputElement','src'], ['HTMLObjectElement','data'],
      ['HTMLFormElement','action'], ['HTMLVideoElement','poster'],
      ['HTMLImageElement','srcset','s'], ['HTMLSourceElement','srcset','s']
    ].forEach(function(e){
      var C = window[e[0]];
      if (!C) return;
      var d = Object.getOwnPropertyDescriptor(C.prototype, e[1]);
      if (!d || !d.get || !d.set) return;
      Object.defineProperty(C.prototype, e[1], {
        configurable: true, enumerable: d.enumerable,
        get: function(){ var v = d.get.call(this); return e[2] ? v : real(v); },
        set: function(v){ d.set.call(this, e[2] ? PS(v) : P(v)); }
      });
    });
  });

  /* setAttribute */
  guard(function(){
    var URLATTR = {src:1, href:1, action:1, poster:1, data:1, formaction:1};
    Element.prototype.setAttribute = function(n, v){
      try{
        var ln = String(n).toLowerCase();
        if (ln === 'srcset') v = PS(v);
        else if (URLATTR[ln] === 1 &&
                 !(ln === 'data' && this.tagName !== 'OBJECT') &&
                 !(ln === 'action' && this.tagName !== 'FORM')) v = P(v);
      }catch(e){}
      return SA.call(this, n, v);
    };
  });

  /* innerHTML / outerHTML / insertAdjacentHTML / document.write */
  guard(function(){
    ['innerHTML','outerHTML'].forEach(function(prop){
      var d = Object.getOwnPropertyDescriptor(Element.prototype, prop);
      if (!d || !d.set) return;
      Object.defineProperty(Element.prototype, prop, {
        configurable: true, enumerable: d.enumerable, get: d.get,
        set: function(v){ d.set.call(this, RH(v)); }
      });
    });
    var IAH = Element.prototype.insertAdjacentHTML;
    Element.prototype.insertAdjacentHTML = function(pos, h){ return IAH.call(this, pos, RH(h)); };
    ['write','writeln'].forEach(function(m){
      var o = Document.prototype[m];
      document[m] = function(){ return o.apply(document, [].slice.call(arguments).map(RH)); };
    });
  });

  /* fetch / XHR / sendBeacon / EventSource / Worker / window.open */
  guard(function(){
    if (of) window.fetch = function(input, init){
      if (typeof Request !== 'undefined' && input instanceof Request) {
        var u = P(input.url);
        if (u === input.url) return of(input, init);
        var m = input.method;
        var p = (m === 'GET' || m === 'HEAD') ? Promise.resolve(undefined) : input.clone().arrayBuffer();
        return p.then(function(body){
          return of(new Request(u, {method: m, headers: input.headers, body: body, credentials: 'same-origin', redirect: input.redirect, signal: input.signal}), init);
        });
      }
      return of(P(input), init);
    };
    var oo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m, u){
      arguments[1] = P(u);
      return oo.apply(this, arguments);
    };
    if (navigator.sendBeacon) {
      var SB = navigator.sendBeacon;
      navigator.sendBeacon = function(u, d){ return SB.call(navigator, P(u), d); };
    }
    if (window.EventSource) {
      var OE = window.EventSource;
      var E = function(u, o){ return new OE(P(u), o); };
      E.prototype = OE.prototype; E.CONNECTING = 0; E.OPEN = 1; E.CLOSED = 2;
      window.EventSource = E;
    }
    if (window.Worker) {
      var OW = window.Worker;
      var W = function(u, o){ return new OW(P(u), o); };
      W.prototype = OW.prototype;
      window.Worker = W;
    }
    var ow = window.open;
    window.open = function(u){
      if (u) arguments[0] = P(u);
      return ow.apply(this, arguments);
    };
  });

  /* WebSocket */
  guard(function(){
    var OWS = window.WebSocket;
    if (!OWS) return;
    var WS = function(url, protocols){
      var out = String(url);
      try{
        var a = new URL(String(url), B);
        if (a.host === location.host && a.pathname !== '/__ws') {
          a = new URL(a.pathname + a.search, B);
        }
        if (a.protocol === 'http:') a.protocol = 'ws:';
        if (a.protocol === 'https:') a.protocol = 'wss:';
        if (a.protocol === 'ws:' || a.protocol === 'wss:') {
          if (!(a.host === location.host && a.pathname === '/__ws')) {
            out = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/__ws?url=' + encodeURIComponent(a.href);
          }
        }
      }catch(e){}
      return protocols === undefined ? new OWS(out) : new OWS(out, protocols);
    };
    WS.prototype = OWS.prototype;
    WS.CONNECTING = 0; WS.OPEN = 1; WS.CLOSING = 2; WS.CLOSED = 3;
    window.WebSocket = WS;
  });

  /* history.pushState / replaceState */
  guard(function(){
    ['pushState','replaceState'].forEach(function(m){
      var o = history[m];
      history[m] = function(s, t, u){
        if (u !== undefined && u !== null) u = P(u);
        return o.call(this, s, t, u);
      };
    });
  });

  /* Service Worker は無効化（プロキシのオリジンに登録されて動作が混ざるため） */
  guard(function(){
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register = function(){
        return Promise.reject(new Error('Service workers are disabled in this proxy'));
      };
    }
  });

  /* GET フォーム: action のクエリが送信時に消えるので、送信先を hidden 項目で渡す */
  function fixForm(f){
    try{
      if (!f || f.tagName !== 'FORM') return;
      var m = (f.getAttribute('method') || 'get').toLowerCase();
      if (m !== 'get') return;
      var raw = f.getAttribute('action');
      var ex = f.querySelector('input[name="__pxurl"]');
      if (ex && raw === '/proxy') return;
      var p = (raw === null || raw === '') ? P(B) : P(raw);
      var h = p.indexOf('#');
      if (h >= 0) p = p.slice(0, h);
      if (p.indexOf(PFX) !== 0) return;
      var r = decodeURIComponent(p.slice(PFX.length));
      var inp = ex;
      if (!inp) {
        inp = document.createElement('input');
        inp.type = 'hidden';
        inp.name = '__pxurl';
        f.insertBefore(inp, f.firstChild);
      }
      inp.value = r;
      SA.call(f, 'action', '/proxy');
    }catch(e){}
  }
  guard(function(){
    document.addEventListener('submit', function(e){ fixForm(e.target); }, true);
    var os = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function(){ fixForm(this); return os.call(this); };
  });

  /* location.href = ... / location.assign() などの画面遷移をプロキシ経由にする */
  guard(function(){
    if (!window.navigation || !navigation.addEventListener) return;
    navigation.addEventListener('navigate', function(e){
      try{
        if (!e.cancelable || e.hashChange || e.downloadRequest !== null || e.formData) return;
        if (e.destination.sameDocument) return;
        if (e.navigationType !== 'push' && e.navigationType !== 'replace') return;
        var d = new URL(e.destination.url);
        if (d.origin === ORIGIN && (d.pathname === '/proxy' || window.__pxAllowNav)) return;
        var t = d.origin === ORIGIN ? new URL(d.pathname + d.search + d.hash, B).href : d.href;
        if (!/^https?:/i.test(t)) return;
        e.preventDefault();
        setTimeout(function(){ location.href = PFX + encodeURIComponent(t); }, 0);
      }catch(err){}
    });
  });

  /* document.cookie（サーバー側のCookie保管庫と同期） */
  guard(function(){
    var jar = {};
    (S.getAttribute('data-cookie') || '').split(';').forEach(function(p){
      var i = p.indexOf('=');
      if (i > 0) jar[p.slice(0, i).trim()] = p.slice(i + 1).trim();
    });
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: function(){
        return Object.keys(jar).map(function(k){ return k + '=' + jar[k]; }).join('; ');
      },
      set: function(v){
        v = String(v);
        var parts = v.split(';');
        var i = parts[0].indexOf('=');
        if (i > 0) {
          var name = parts[0].slice(0, i).trim(), val = parts[0].slice(i + 1).trim();
          var dead = false;
          for (var k = 1; k < parts.length; k++) {
            var a = parts[k].trim(), al = a.toLowerCase();
            if (al.indexOf('max-age=') === 0) {
              var n = parseInt(a.slice(8), 10);
              if (!isNaN(n) && n <= 0) dead = true;
            } else if (al.indexOf('expires=') === 0) {
              var t = Date.parse(a.slice(8));
              if (!isNaN(t) && t <= Date.now()) dead = true;
            }
          }
          if (dead) delete jar[name]; else jar[name] = val;
        }
        try{
          if (of) of('/__cookie', {
            method: 'POST', headers: {'content-type': 'application/json'},
            body: JSON.stringify({url: B, cookie: v}), keepalive: true, credentials: 'same-origin'
          }).catch(function(){});
        }catch(e){}
      }
    });
  });
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
    root.getElementById('home').onclick = function(){ window.__pxAllowNav = true; location.href = '/'; };
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
  // 宣言が無い場合: UTF-8として読めなければ Shift_JIS とみなす
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    try { return new TextDecoder('shift_jis').decode(buf); } catch { /* fallthrough */ }
  }
  return new TextDecoder('utf-8').decode(buf);
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function rewriteHtml(html, base, cookieStr) {
  const $ = cheerio.load(html);

  $('base').remove();
  // 出力は常にUTF-8にするので、元の文字コード宣言は取り除く
  $('meta[charset]').remove();
  $('meta[http-equiv]').filter((_, el) => ($(el).attr('http-equiv') || '').toLowerCase() === 'content-type').remove();
  // Referer が来ないとプロキシが元ページを判別できないので、referrer 指定は無効化
  $('meta[name="referrer"]').remove();
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
    ['embed', 'src'], ['object', 'data'], ['form', 'action'], ['input', 'src'], ['track', 'src'],
    ['use', 'href'], ['use', 'xlink:href'], ['image', 'href'], ['image', 'xlink:href'],
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

  const baseAttr = escapeAttr(base);
  const shimTag = `<script data-base="${baseAttr}" data-cookie="${escapeAttr(cookieStr || '')}">${SHIM}</script>`;
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
  'referrer-policy', 'link', 'clear-site-data', 'alt-svc', 'permissions-policy',
  'origin-agent-cluster', 'document-policy', 'accept-ch',
]);

// Referer（/proxy?url=... のページ）から、そのページの元のURLを取り出す
function pageUrlFromReferer(ref) {
  if (!ref) return null;
  try {
    const r = new URL(ref);
    if (r.pathname !== '/proxy') return null;
    const u = r.searchParams.get('url') || r.searchParams.get('__pxurl');
    if (!u) return null;
    const p = new URL(u);
    if (p.protocol !== 'http:' && p.protocol !== 'https:') return null;
    p.hash = '';
    return p.href;
  } catch {
    return null;
  }
}

app.all('/proxy', express.raw({ type: () => true, limit: '10mb' }), async (req, res) => {
  const qs = new URL(req.originalUrl, 'http://x').searchParams;
  let raw = (qs.get('url') || '').trim();
  const fbRaw = (qs.get('__fb') || '').trim();

  // GET フォーム: __pxurl に送信先、残りのクエリがフォームの入力内容
  if (!raw && qs.get('__pxurl')) {
    try {
      const u = new URL(qs.get('__pxurl'));
      qs.delete('__pxurl');
      u.search = qs.toString();
      raw = u.href;
    } catch {
      return res.status(400).send('このURLにはアクセスできません');
    }
  }
  if (!raw) return res.status(400).send('url パラメータがありません');
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;

  let target;
  let fallback = null;
  try {
    target = new URL(raw);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('bad protocol');
    await assertPublicHost(target.hostname);
    if (fbRaw) {
      const f = new URL(fbRaw);
      if (f.protocol === 'http:' || f.protocol === 'https:') fallback = f;
    }
  } catch {
    return res.status(400).send('このURLにはアクセスできません');
  }

  const session = getSession(req, res, true);
  const pageUrl = pageUrlFromReferer(req.get('referer'));
  const isBodyMethod = !['GET', 'HEAD'].includes(req.method);
  const hasBody = isBodyMethod && Buffer.isBuffer(req.body) && req.body.length > 0;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  res.on('close', () => { clearTimeout(timer); ctl.abort(); });

  function doFetch(t) {
    const headers = {
      'user-agent': req.get('user-agent') || 'Mozilla/5.0',
      accept: req.get('accept') || '*/*',
      'accept-language': req.get('accept-language') || 'ja,en;q=0.8',
    };
    if (req.get('content-type')) headers['content-type'] = req.get('content-type');
    // 動画などの途中再生（Range）
    if (req.get('range')) headers.range = req.get('range');
    if (req.get('if-range')) headers['if-range'] = req.get('if-range');
    // サイトによっては Referer / Origin を確認する
    if (pageUrl) {
      headers.referer = pageUrl;
      if (isBodyMethod) headers.origin = new URL(pageUrl).origin;
    } else if (isBodyMethod) {
      headers.origin = t.origin;
    }
    const ck = cookieHeaderFor(session, t, true);
    if (ck) headers.cookie = ck;
    return fetch(t.href, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: 'manual',
      signal: ctl.signal,
    });
  }

  try {
    let upstream = await doFetch(target);

    // 相対パスの推測が外れたとき（モジュールの import など）は予備のURLで再試行
    if (upstream.status === 404 && fallback) {
      try {
        await assertPublicHost(fallback.hostname);
        try { await upstream.body?.cancel(); } catch { /* ignore */ }
        upstream = await doFetch(fallback);
        target = fallback;
      } catch { /* 元のレスポンスを使う */ }
    }

    storeResponseCookies(session, upstream.headers, target);

    // リダイレクトもプロキシ経由にする
    if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location')) {
      clearTimeout(timer);
      return res.redirect(upstream.status, proxify(upstream.headers.get('location'), target.href));
    }

    upstream.headers.forEach((value, key) => {
      if (!STRIP_RES_HEADERS.has(key.toLowerCase())) res.setHeader(key, value);
    });
    res.status(upstream.status);

    const type = (upstream.headers.get('content-type') || '').toLowerCase();
    const isHtml = type.includes('text/html') || type.includes('application/xhtml+xml');
    const isCss = type.includes('text/css');

    if ((isHtml || isCss) && req.method !== 'HEAD') {
      const buf = Buffer.from(await upstream.arrayBuffer());
      clearTimeout(timer);
      if (isHtml) {
        const html = decodeBody(buf, type, 'html');
        res.setHeader('content-type', 'text/html; charset=utf-8');
        return res.send(rewriteHtml(html, target.href, cookieHeaderFor(session, target, false)));
      }
      const css = decodeBody(buf, type, 'css');
      res.setHeader('content-type', 'text/css; charset=utf-8');
      return res.send(rewriteCss(css, target.href));
    }

    // 画像・動画・JSなどは、ためずにそのまま流す（途中再生・大きいファイル向け）
    clearTimeout(timer);
    const len = upstream.headers.get('content-length');
    if (len && !upstream.headers.get('content-encoding')) res.setHeader('content-length', len);
    if (!upstream.body || req.method === 'HEAD') return res.end();
    pipeline(Readable.fromWeb(upstream.body), res, () => {});
  } catch (err) {
    clearTimeout(timer);
    if (res.headersSent) return res.destroy();
    const timedOut = err.name === 'AbortError' || err.name === 'TimeoutError';
    res.status(502).send('取得に失敗しました: ' + (timedOut ? 'タイムアウト' : err.message));
  }
});

// ページ内のJSが「/api/xxx」のようにプロキシを通さず直接アクセスしてきた場合の救済。
// Referer から元のサイトを割り出して、プロキシ経由にやり直させる。
app.use((req, res) => {
  const pageUrl = pageUrlFromReferer(req.get('referer'));
  if (pageUrl) {
    try {
      const base = new URL(pageUrl);
      let primary = new URL(req.originalUrl, base).href;
      let fb = null;
      // JSファイルからの相対 import（./chunk.js）は、そのJSのフォルダ基準で探す
      if (/\.m?js$/i.test(base.pathname)) {
        const rel = new URL(req.originalUrl.replace(/^\/+/, ''), base).href;
        if (rel !== primary) { fb = primary; primary = rel; }
      }
      let loc = '/proxy?url=' + encodeURIComponent(primary);
      if (fb) loc += '&__fb=' + encodeURIComponent(fb);
      return res.redirect(307, loc);
    } catch { /* fallthrough */ }
  }
  res.status(404).send('Not Found');
});

const server = app.listen(PORT, () => console.log(`proxy listening on ${PORT}`));

/* ---------- WebSocket 中継 ---------- */
const wss = new WebSocketServer({
  noServer: true,
  handleProtocols: (protocols, request) => request.__pxProto || false,
});

function safeCloseCode(c) {
  return Number.isInteger(c) && c >= 1000 && c <= 4999 && ![1004, 1005, 1006, 1015].includes(c) ? c : 1000;
}

server.on('upgrade', async (req, socket, head) => {
  const fail = () => {
    try { socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); } catch { /* ignore */ }
    socket.destroy();
  };
  try {
    const u = new URL(req.url, 'http://x');
    if (u.pathname !== '/__ws') return socket.destroy();
    const target = new URL(u.searchParams.get('url'));
    if (target.protocol !== 'ws:' && target.protocol !== 'wss:') return fail();
    await assertPublicHost(target.hostname);

    const httpUrl = new URL(target.href.replace(/^ws/i, 'http'));
    const session = getSession(req, null, false);
    const cookie = cookieHeaderFor(session, httpUrl, true);
    const protocols = String(req.headers['sec-websocket-protocol'] || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const headers = {
      origin: httpUrl.origin,
      'user-agent': req.headers['user-agent'] || 'Mozilla/5.0',
    };
    if (cookie) headers.cookie = cookie;

    const upstream = new WebSocket(target.href, protocols, { headers, handshakeTimeout: 15000 });
    let opened = false;
    upstream.once('error', () => { if (!opened) fail(); });
    upstream.once('open', () => {
      opened = true;
      req.__pxProto = upstream.protocol || false;
      wss.handleUpgrade(req, socket, head, (client) => {
        client.on('message', (data, isBinary) => {
          if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
        });
        upstream.on('message', (data, isBinary) => {
          if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
        });
        client.on('close', (code) => {
          if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
            try { upstream.close(safeCloseCode(code)); } catch { upstream.terminate(); }
          }
        });
        upstream.on('close', (code) => {
          if (client.readyState === WebSocket.OPEN) {
            try { client.close(safeCloseCode(code)); } catch { client.terminate(); }
          }
        });
        client.on('error', () => upstream.terminate());
        upstream.on('error', () => client.terminate());
      });
    });
  } catch {
    fail();
  }
});
