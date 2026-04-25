res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
const http    = require('http');
const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;

// ─── helpers ────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end',  ()    => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type':  'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// ─── InfinityPay ─────────────────────────────────────────────
function chamarInfinityPay(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const opts = {
      hostname: 'api.checkout.infinitepay.io',
      path:     '/links',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          if (res.statusCode >= 400) {
            reject(new Error(`InfinityPay ${res.statusCode}: ${raw}`));
          } else {
            resolve(data);
          }
        } catch {
          reject(new Error('Resposta inválida da InfinityPay: ' + raw));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Roteador ────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://localhost:${PORT}`);

  // ── POST /criar-pagamento ──────────────────────────────────
  if (req.method === 'POST' && pathname === '/criar-pagamento') {
    try {
      const { desc, total } = await readBody(req);

      if (!desc || !total) {
        return sendJSON(res, 400, { error: 'Campos desc e total são obrigatórios.' });
      }
      if (typeof total !== 'number' || total <= 0) {
        return sendJSON(res, 400, { error: 'total deve ser um número positivo em centavos.' });
      }

      const payload = {
        handle:    'voarbalonismo',
        order_nsu: 'pedido-' + Date.now(),
        itens: [
          {
            quantity:    1,
            price:       total,        // já em centavos
            description: String(desc),
          }
        ],
        redirect_url: 'https://seusite.com/confirmado',
      };

      console.log('→ Enviando para InfinityPay:', JSON.stringify(payload, null, 2));

      const data = await chamarInfinityPay(payload);

      console.log('← Resposta InfinityPay:', JSON.stringify(data, null, 2));

      const payment_url = data.payment_url || data.url || data.checkout_url;
      if (!payment_url) {
        return sendJSON(res, 502, { error: 'InfinityPay não retornou link.', raw: data });
      }

      return sendJSON(res, 200, { payment_url });

    } catch (e) {
      console.error('Erro /criar-pagamento:', e.message);
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // ── GET / → servir o index.html ───────────────────────────
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    return serveFile(res, path.join(__dirname, 'index.html'), 'text/html; charset=utf-8');
  }

  // ── Arquivos estáticos (fotos/, logo/, etc.) ──────────────
  if (req.method === 'GET') {
    const filePath = path.join(__dirname, pathname);
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
      '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
    };
    return serveFile(res, filePath, types[ext] || 'application/octet-stream');
  }

  // ── 404 ───────────────────────────────────────────────────
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n✅ VOAR servidor rodando em http://localhost:${PORT}\n`);
});
