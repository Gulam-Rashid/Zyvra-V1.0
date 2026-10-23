/**
 * ZYVRA — Production Admin Authentication Backend Server (Node.js Built-in HTTP + Crypto)
 *
 * Zero external runtime dependencies required. Uses Node's built-in `http` and `crypto`
 * modules (`scryptSync`, `timingSafeEqual`, `createHmac`) to provide:
 *   1. Server-side salted scrypt password hash verification
 *   2. IP-based rate limiting and brute-force lockout protection
 *   3. HMAC-SHA256 signed session tokens + HTTP-only cookie support
 *
 * Generate a salted password hash for your `.env`:
 *   node server.mjs --hash "YourStrongAdminPassword"
 *
 * Required Server Environment Variables (NEVER prefix these with VITE_):
 *   ADMIN_LOGIN_ID="your_admin_id"
 *   ADMIN_PASSWORD_HASH="<salt_hex>:<scrypt_hash_hex>"
 *   ADMIN_SESSION_SECRET="<32+_byte_random_hex_secret>"
 *   ALLOWED_ORIGIN="https://your-username.github.io"
 */

import http from 'node:http';
import crypto from 'node:crypto';

// CLI helper to generate a salted scrypt hash
if (process.argv[2] === '--hash' && process.argv[3]) {
  const password = process.argv[3];
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  console.log('\nCopy this line into your server .env file (never into VITE_ variables):\n');
  console.log(`ADMIN_PASSWORD_HASH="${salt}:${derived}"\n`);
  process.exit(0);
}

const PORT = Number(process.env.PORT || 4000);
const ADMIN_LOGIN_ID = process.env.ADMIN_LOGIN_ID || '';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const ADMIN_SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

// Rate limiting store: IP -> { count, lockedUntil }
const rateLimitMap = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60 * 1000;

function verifyScryptPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const keyBuffer = Buffer.from(keyHex, 'hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  if (keyBuffer.length !== derivedKey.length) return false;
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}

function constantTimeStringMatch(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function createSignedToken(loginId) {
  const payload = Buffer.from(
    JSON.stringify({
      sub: loginId,
      role: 'admin',
      iat: Date.now(),
      exp: Date.now() + 4 * 60 * 60 * 1000,
    })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', ADMIN_SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function sendJson(res, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  const clientIp =
    (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown';

  if (req.method === 'POST' && req.url === '/api/admin/login') {
    const rate = rateLimitMap.get(clientIp) || { count: 0, lockedUntil: 0 };
    if (rate.lockedUntil && Date.now() < rate.lockedUntil) {
      const waitSec = Math.ceil((rate.lockedUntil - Date.now()) / 1000);
      sendJson(res, 429, {
        error: `Too many failed attempts. Please wait ${waitSec} seconds.`,
      });
      return;
    }

    if (!ADMIN_LOGIN_ID || !ADMIN_PASSWORD_HASH) {
      sendJson(res, 503, {
        error:
          'Server admin credentials are not configured. Set ADMIN_LOGIN_ID and ADMIN_PASSWORD_HASH on the backend server.',
      });
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 8192) req.destroy();
    });
    req.on('end', () => {
      try {
        const { loginId = '', password = '' } = JSON.parse(body || '{}');
        const idMatches = constantTimeStringMatch(loginId.trim(), ADMIN_LOGIN_ID);
        const passMatches = verifyScryptPassword(String(password), ADMIN_PASSWORD_HASH);

        if (!idMatches || !passMatches) {
          const nextCount = (rate.count || 0) + 1;
          rateLimitMap.set(clientIp, {
            count: nextCount >= MAX_ATTEMPTS ? 0 : nextCount,
            lockedUntil: nextCount >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0,
          });
          sendJson(res, 401, { error: 'Invalid Administrator Login ID or Passcode.' });
          return;
        }

        rateLimitMap.delete(clientIp);
        const token = createSignedToken(ADMIN_LOGIN_ID);
        sendJson(
          res,
          200,
          { ok: true, token },
          {
            'Set-Cookie': `zyvra_admin_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=14400`,
          }
        );
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON request body.' });
      }
    });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});


server.listen(PORT, '0.0.0.0', () => {
  console.log(`Zyvra Admin Auth Server listening on port ${PORT}`);
});
