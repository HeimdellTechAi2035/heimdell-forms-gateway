import http from 'node:http';

const PORT = Number(process.env.PORT || 3100);
const MAX_BODY_BYTES = 64 * 1024;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 8;

const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS ||
    'https://greenfixexterior-care.co.uk,https://www.greenfixexterior-care.co.uk,https://remoteability.org.uk,https://www.remoteability.org.uk,https://heimdell-tech-ai.co.uk,https://www.heimdell-tech-ai.co.uk,https://heimdelltechai2035.github.io')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

const routes = new Map([
  ['/heimdell/contact', {
    formName: 'contact',
    subject: 'New Heimdell Tech AI enquiry',
    toEnv: 'HEIMDELL_FORM_TO',
    defaultTo: 'andrew@heimdell-tech-ai.co.uk',
    successUrl: 'https://heimdell-tech-ai.co.uk/get-started.html?sent=1',
  }],
  ['/greenfix/quote-request', {
    formName: 'quote-request',
    subject: 'New Greenfix quote request',
    toEnv: 'GREENFIX_FORM_TO',
    defaultTo: 'admin@greenfixexterior-care.co.uk',
    successUrl: 'https://greenfixexterior-care.co.uk/thank-you.html',
  }],
  ['/remoteability/contact', {
    formName: 'contact',
    subject: 'New RemoteAbility contact enquiry',
    toEnv: 'REMOTEABILITY_FORM_TO',
    defaultTo: 'contact@remoteability.org.uk',
    successUrl: 'https://www.remoteability.org.uk/thank-you.html',
  }],
  ['/remoteability/participant-application', {
    formName: 'participant-application',
    subject: 'New RemoteAbility participant application',
    toEnv: 'REMOTEABILITY_FORM_TO',
    defaultTo: 'contact@remoteability.org.uk',
    successUrl: 'https://www.remoteability.org.uk/thank-you.html',
  }],
  ['/remoteability/referral', {
    formName: 'referral',
    subject: 'New RemoteAbility referral',
    toEnv: 'REMOTEABILITY_FORM_TO',
    defaultTo: 'contact@remoteability.org.uk',
    successUrl: 'https://www.remoteability.org.uk/thank-you.html',
  }],
  ['/remoteability/support-request', {
    formName: 'support-request',
    subject: 'New RemoteAbility support request',
    toEnv: 'REMOTEABILITY_FORM_TO',
    defaultTo: 'contact@remoteability.org.uk',
    successUrl: 'https://www.remoteability.org.uk/thank-you.html',
  }],
  ['/remoteability/unleashed-event-enquiry', {
    formName: 'unleashed-event-enquiry',
    subject: 'New RemoteAbility UNLEASHED event enquiry',
    toEnv: 'REMOTEABILITY_FORM_TO',
    defaultTo: 'contact@remoteability.org.uk',
    successUrl: 'https://www.remoteability.org.uk/unleashed-thank-you.html',
  }],
]);

const rateBuckets = new Map();

function securityHeaders(extra = {}) {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...extra,
  };
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, securityHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
  res.end(JSON.stringify(body));
}

function sendErrorPage(res, statusCode, message) {
  const safeMessage = escapeHtml(message);
  res.writeHead(statusCode, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Form not sent</title><body><main><h1>We could not send your form</h1><p>${safeMessage}</p><p>Please go back and try again, or contact the organisation directly.</p></main></body></html>`);
}

function clientAddress(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function isRateLimited(address) {
  const now = Date.now();
  const bucket = rateBuckets.get(address);
  if (!bucket || now - bucket.startedAt >= WINDOW_MS) {
    rateBuckets.set(address, { startedAt: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_REQUESTS_PER_WINDOW;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function normaliseFields(params) {
  const fields = new Map();
  for (const [rawName, rawValue] of params) {
    const name = rawName.replace(/\[\]$/, '').trim().slice(0, 80);
    if (!name || name === 'bot-field' || name === 'form-name') continue;
    const value = rawValue.replace(/\0/g, '').trim().slice(0, 5000);
    if (!value) continue;
    const current = fields.get(name);
    if (current) current.push(value);
    else fields.set(name, [value]);
  }
  return fields;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function humanise(name) {
  return name.replaceAll('-', ' ').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function renderEmail(route, fields) {
  const rows = [];
  for (const [name, values] of fields) {
    const safeValues = values.map((value) => escapeHtml(value).replaceAll('\n', '<br>')).join('<br>');
    rows.push(`<tr><th align="left" valign="top" style="padding:8px;border:1px solid #ddd">${escapeHtml(humanise(name))}</th><td style="padding:8px;border:1px solid #ddd">${safeValues}</td></tr>`);
  }
  return `<!doctype html><html><body><h1>${escapeHtml(route.subject)}</h1><p>Submitted through the verified website form. No copy has been stored by the forms gateway.</p><table style="border-collapse:collapse">${rows.join('')}</table></body></html>`;
}

function findReplyTo(fields) {
  for (const key of ['email', 'referrer-email']) {
    const candidate = fields.get(key)?.[0];
    if (candidate && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) return candidate;
  }
  return undefined;
}

async function sendEmail(route, fields) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const to = process.env[route.toEnv] || route.defaultTo;
  if (!apiKey || !from || !to) throw new Error('EMAIL_NOT_CONFIGURED');

  const payload = {
    from,
    to: [to],
    subject: route.subject,
    html: renderEmail(route, fields),
  };
  const replyTo = findReplyTo(fields);
  if (replyTo) payload.reply_to = replyTo;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const providerStatus = response.status;
    await response.text();
    throw new Error(`EMAIL_PROVIDER_${providerStatus}`);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { status: 'ok' });
  }

  const route = routes.get(url.pathname);
  if (!route) return sendJson(res, 404, { error: 'Not found' });
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const origin = String(req.headers.origin || '');
  if (!allowedOrigins.has(origin)) return sendErrorPage(res, 403, 'The form origin was not accepted.');

  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/x-www-form-urlencoded') {
    return sendErrorPage(res, 415, 'The form format was not accepted.');
  }

  const address = clientAddress(req);
  if (isRateLimited(address)) return sendErrorPage(res, 429, 'Too many submissions were received. Please wait and try again.');

  try {
    const body = await readBody(req);
    const params = new URLSearchParams(body);

    if (params.get('bot-field')) {
      res.writeHead(303, securityHeaders({ Location: route.successUrl }));
      return res.end();
    }

    if (params.get('form-name') !== route.formName) {
      return sendErrorPage(res, 400, 'The form identifier was invalid.');
    }

    const fields = normaliseFields(params);
    if (fields.size === 0) return sendErrorPage(res, 400, 'The form did not contain any information.');

    await sendEmail(route, fields);
    res.writeHead(303, securityHeaders({ Location: route.successUrl }));
    return res.end();
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNKNOWN';
    console.error(JSON.stringify({ event: 'form_delivery_failed', route: url.pathname, code }));
    if (code === 'BODY_TOO_LARGE') return sendErrorPage(res, 413, 'The form was too large.');
    return sendErrorPage(res, 503, 'Email delivery is temporarily unavailable. Your information has not been stored.');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'forms_gateway_started', port: PORT }));
});
