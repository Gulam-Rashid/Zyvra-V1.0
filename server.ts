import express, { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'zyvra-cloud-store.json');

// Private Admin Security Email — strictly server-side only; never exposed in client responses
const ADMIN_SECURITY_EMAIL = (
  process.env.ADMIN_SECURITY_EMAIL || 'gulamrashid170@gmail.com'
).trim();

const SERVER_MASTER_SECRET_SALT = 'SSC_PRO_TCS_MASTER_SALT_2026_V9';

export interface AdminOtpChallengeRecord {
  challengeId: string;
  adminId: string;
  actionType: 'change_username' | 'change_password' | 'change_both';
  otpHash: string; // salt:scryptHex of challengeId::actionType::otp
  pendingLoginId?: string;
  pendingPasswordHash?: string;
  createdAt: number;
  expiresAt: number;
  lastSentAt: number;
  attempts: number;
  maxAttempts: number;
  used: boolean;
}

export interface StudentDeviceBindingRecord {
  deviceId: string;
  deviceSecretHash: string;
  sessionVersion: number;
  boundAt: number;
  lastSeenAt: number;
}

export interface ActivatedKeyRecord {
  proKey: string;
  deviceId: string;
  studentName: string;
  whatsappNumber: string;
  whatsappVerified: boolean;
  activatedAt: number;
  expiresAt: number | null;
  revoked: boolean;
}

interface CloudStore {
  adminConfig: {
    loginId: string;
    passwordHash: string; // salt:scryptHex
    sessionVersion?: number;
    updatedAt: number;
  } | null;
  adminOtpChallenge?: AdminOtpChallengeRecord | null;
  adminAuditLogs?: Array<Record<string, any>>;
  studentDeviceBindings?: Record<string, StudentDeviceBindingRecord>;
  activatedKeys?: Record<string, ActivatedKeyRecord>;
  masterDb: Record<string, any> | null;
  studentStates: Record<string, Record<string, any>>;
  processedIdempotencyKeys: Record<string, number>;
  translationCache: Record<
    string,
    {
      questionText: string;
      options: string[];
      explanation: string;
      provider: string;
      updatedAt: number;
    }
  >;
}

const DEFAULT_STORE: CloudStore = {
  adminConfig:
    process.env.ADMIN_LOGIN_ID && process.env.ADMIN_PASSWORD_HASH
      ? {
          loginId: process.env.ADMIN_LOGIN_ID,
          passwordHash: process.env.ADMIN_PASSWORD_HASH,
          sessionVersion: 1,
          updatedAt: Date.now(),
        }
      : null,
  adminOtpChallenge: null,
  adminAuditLogs: [],
  studentDeviceBindings: {},
  activatedKeys: {},
  masterDb: null,
  studentStates: {},
  processedIdempotencyKeys: {},
  translationCache: {},
};

function loadCloudStore(): CloudStore {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(STORE_PATH)) {
      fs.writeFileSync(STORE_PATH, JSON.stringify(DEFAULT_STORE, null, 2), 'utf8');
      return structuredClone(DEFAULT_STORE);
    }
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const loaded: CloudStore = {
      ...structuredClone(DEFAULT_STORE),
      ...parsed,
      adminOtpChallenge: parsed.adminOtpChallenge || null,
      adminAuditLogs: Array.isArray(parsed.adminAuditLogs) ? parsed.adminAuditLogs : [],
      studentDeviceBindings: parsed.studentDeviceBindings || {},
      activatedKeys: parsed.activatedKeys || {},
      studentStates: parsed.studentStates || {},
      processedIdempotencyKeys: parsed.processedIdempotencyKeys || {},
      translationCache: parsed.translationCache || {},
    };
    // Seed from ADMIN_LOGIN_ID / ADMIN_PASSWORD_HASH env vars if adminConfig is not yet in store
    if (!loaded.adminConfig && process.env.ADMIN_LOGIN_ID && process.env.ADMIN_PASSWORD_HASH) {
      loaded.adminConfig = {
        loginId: process.env.ADMIN_LOGIN_ID.trim(),
        passwordHash: process.env.ADMIN_PASSWORD_HASH.trim(),
        sessionVersion: 1,
        updatedAt: Date.now(),
      };
    }
    // Migrate legacy plaintext adminConfig passwordHash to salted scrypt hash immediately
    if (
      loaded.adminConfig &&
      loaded.adminConfig.passwordHash &&
      !String(loaded.adminConfig.passwordHash).includes(':')
    ) {
      const salt = crypto.randomBytes(16).toString('hex');
      const derived = crypto
        .scryptSync(String(loaded.adminConfig.passwordHash), salt, 64)
        .toString('hex');
      loaded.adminConfig.passwordHash = `${salt}:${derived}`;
      loaded.adminConfig.sessionVersion = loaded.adminConfig.sessionVersion || 1;
      try {
        fs.writeFileSync(STORE_PATH, JSON.stringify(loaded, null, 2), 'utf8');
      } catch {
        // ignore write error during migration
      }
    }
    return loaded;
  } catch (err) {
    console.error('Failed to read cloud store, initializing fresh store:', err);
    return structuredClone(DEFAULT_STORE);
  }
}

let cloudStore: CloudStore = loadCloudStore();

function saveCloudStore(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(cloudStore, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist cloud store:', err);
  }
}

const SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET ||
  crypto.createHash('sha256').update('zyvra-server-secret-v3.2').digest('hex');

const rateLimitMap = new Map<string, { count: number; lockedUntil: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60 * 1000;

function createScryptHash(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyScryptPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const keyBuffer = Buffer.from(keyHex, 'hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  if (keyBuffer.length !== derivedKey.length) return false;
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}

function constantTimeStringMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function getActiveAdminCredentials(): {
  loginId: string;
  passwordHash: string;
  sessionVersion: number;
} {
  const loginId = cloudStore.adminConfig?.loginId || process.env.ADMIN_LOGIN_ID || '';
  const passwordHash =
    cloudStore.adminConfig?.passwordHash || process.env.ADMIN_PASSWORD_HASH || '';
  const sessionVersion = Number(cloudStore.adminConfig?.sessionVersion || 1);
  return { loginId, passwordHash, sessionVersion };
}

function createSignedToken(loginId: string, sessionVersion?: number): string {
  const active = getActiveAdminCredentials();
  const sv = sessionVersion ?? active.sessionVersion;
  const payload = Buffer.from(
    JSON.stringify({
      sub: loginId,
      role: 'admin',
      sv,
      iat: Date.now(),
      exp: Date.now() + 8 * 60 * 60 * 1000,
    })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifySignedToken(
  token: string
): { sub: string; role: string; sv?: number; exp: number } | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  if (!constantTimeStringMatch(sig, expectedSig)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed || parsed.role !== 'admin' || Date.now() > Number(parsed.exp)) {
      return null;
    }
    const active = getActiveAdminCredentials();
    if (active.loginId && parsed.sub !== active.loginId) {
      return null;
    }
    if (parsed.sv !== undefined && Number(parsed.sv) !== active.sessionVersion) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function extractTokenFromReq(req: Request): string {
  const authHeader = (req.headers['authorization'] || '').toString();
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookieHeader = (req.headers['cookie'] || '').toString();
  const match = cookieHeader.match(/(?:^|;\s*)zyvra_admin_token=([^;]+)/);
  return match ? match[1].trim() : '';
}

function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractTokenFromReq(req);
  const verified = verifySignedToken(token);
  if (!verified) {
    res.status(401).json({ ok: false, error: 'Unauthorized or expired admin session.' });
    return;
  }
  (req as any).adminUser = verified;
  next();
}

function computeServerDeterministicHash(input: string): number {
  let h1 = 0x811c9dc5;
  let h2 = 5381;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 = (h2 * 33) ^ ch;
  }
  return Math.abs((h1 ^ h2) >>> 0);
}

function generateServerProKey(
  deviceId: string,
  secretMasterSalt: string = SERVER_MASTER_SECRET_SALT
): string {
  const normalizedDevice = String(deviceId || '').trim().toUpperCase();
  if (
    (!normalizedDevice.startsWith('ZYV-') &&
      !normalizedDevice.startsWith('SSC-') &&
      !normalizedDevice.startsWith('DEV-')) ||
    normalizedDevice.length < 9
  ) {
    return '';
  }
  const canonicalDevice = normalizedDevice.replace(/^(ZYV-|DEV-)/, 'SSC-');
  const raw = `${canonicalDevice}::${secretMasterSalt}::SSC_UNLOCK_2026`;
  const h1 = computeServerDeterministicHash(raw);
  const h2 = computeServerDeterministicHash(
    raw.split('').reverse().join('') + secretMasterSalt
  );
  const fourDigits = String((h1 % 9000) + 1000);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const s1 = alphabet[h2 % alphabet.length];
  const s2 = alphabet[(h1 >>> 6) % alphabet.length];
  const s3 = alphabet[(h2 >>> 11) % alphabet.length];
  return `PRO-${fourDigits}-${s1}${s2}${s3}`;
}

function generateServerReferralCode(deviceId: string): string {
  const clean = (deviceId || 'ZYV-1000-AAA').trim().toUpperCase();
  const h = computeServerDeterministicHash(`ZYVRA_REF_2026::${clean}`);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const c1 = alphabet[h % alphabet.length];
  const c2 = alphabet[(h >>> 5) % alphabet.length];
  const c3 = alphabet[(h >>> 10) % alphabet.length];
  const digits = String((h % 900) + 100);
  return `ZYVREF-${digits}${c1}${c2}${c3}`;
}

function normalizeServerWhatsAppNumber(
  rawInput: string,
  defaultCountryCode: string = '91'
): { valid: boolean; normalized: string; localMobile: string; error?: string } {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) {
    return {
      valid: false,
      normalized: '',
      localMobile: '',
      error: 'WhatsApp number is required.',
    };
  }
  if (!/^\+?[\d\s\-()]+$/.test(trimmed)) {
    return {
      valid: false,
      normalized: '',
      localMobile: '',
      error: 'WhatsApp number may only contain digits, spaces, hyphens, and an optional leading +.',
    };
  }
  const hasLeadingPlus = trimmed.startsWith('+');
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length < 10 || digitsOnly.length > 15) {
    return {
      valid: false,
      normalized: '',
      localMobile: '',
      error: 'WhatsApp number must contain between 10 and 15 digits.',
    };
  }
  if (/^(\d)\1{9,}$/.test(digitsOnly)) {
    return {
      valid: false,
      normalized: '',
      localMobile: '',
      error: 'Invalid phone number: repeated dummy digits are not allowed.',
    };
  }
  if (digitsOnly.length === 10) {
    if (defaultCountryCode === '91' && !/^[6-9]\d{9}$/.test(digitsOnly)) {
      return {
        valid: false,
        normalized: '',
        localMobile: '',
        error: 'Indian 10-digit WhatsApp numbers must start with 6, 7, 8, or 9.',
      };
    }
    return {
      valid: true,
      normalized: `+${defaultCountryCode}${digitsOnly}`,
      localMobile: digitsOnly,
    };
  }
  if (!hasLeadingPlus && digitsOnly.length === 11 && digitsOnly.startsWith('0')) {
    const tenDigits = digitsOnly.slice(1);
    if (!/^[6-9]\d{9}$/.test(tenDigits)) {
      return {
        valid: false,
        normalized: '',
        localMobile: '',
        error: 'Indian 10-digit WhatsApp numbers must start with 6, 7, 8, or 9.',
      };
    }
    return {
      valid: true,
      normalized: `+${defaultCountryCode}${tenDigits}`,
      localMobile: tenDigits,
    };
  }
  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    const tenDigits = digitsOnly.slice(2);
    if (!/^[6-9]\d{9}$/.test(tenDigits)) {
      return {
        valid: false,
        normalized: '',
        localMobile: '',
        error: 'Indian (+91) WhatsApp numbers must have a 10-digit subscriber number starting with 6–9.',
      };
    }
    return {
      valid: true,
      normalized: `+91${tenDigits}`,
      localMobile: tenDigits,
    };
  }
  if (/^[1-9]\d{10,14}$/.test(digitsOnly)) {
    return {
      valid: true,
      normalized: `+${digitsOnly}`,
      localMobile: digitsOnly.slice(-10),
    };
  }
  return {
    valid: false,
    normalized: '',
    localMobile: '',
    error: 'Invalid WhatsApp phone number format.',
  };
}

function createStudentSessionToken(deviceId: string, sessionVersion: number): string {
  const payload = Buffer.from(
    JSON.stringify({
      sub: deviceId,
      role: 'student_device',
      sv: sessionVersion,
      iat: Date.now(),
      exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
    })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`STUDENT::${payload}`)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifyStudentSessionToken(
  token: string,
  expectedDeviceId: string,
  expectedSessionVersion: number
): boolean {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`STUDENT::${payload}`)
    .digest('base64url');
  if (!constantTimeStringMatch(sig, expectedSig)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (
      !parsed ||
      parsed.role !== 'student_device' ||
      parsed.sub !== expectedDeviceId ||
      Number(parsed.sv) !== expectedSessionVersion ||
      Date.now() > Number(parsed.exp)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function verifyOrBindStudentDevice(
  deviceId: string,
  deviceSecret?: string,
  studentToken?: string
): { ok: boolean; sessionToken?: string; error?: string } {
  const cleanDeviceId = String(deviceId || '').trim().toUpperCase();
  if (!cleanDeviceId) {
    return { ok: false, error: 'deviceId is required.' };
  }
  cloudStore.studentDeviceBindings = cloudStore.studentDeviceBindings || {};
  const existing = cloudStore.studentDeviceBindings[cleanDeviceId];
  const cleanSecret = String(deviceSecret || '').trim();
  const cleanToken = String(studentToken || '').trim();

  if (!existing) {
    if (cleanSecret && cleanSecret.length >= 12) {
      const record: StudentDeviceBindingRecord = {
        deviceId: cleanDeviceId,
        deviceSecretHash: createScryptHash(cleanSecret),
        sessionVersion: 1,
        boundAt: Date.now(),
        lastSeenAt: Date.now(),
      };
      cloudStore.studentDeviceBindings[cleanDeviceId] = record;
      saveCloudStore();
      return {
        ok: true,
        sessionToken: createStudentSessionToken(cleanDeviceId, 1),
      };
    }
    // Unbound legacy call without deviceSecret: allow until bound
    return { ok: true };
  }

  // Device is already bound to a specific installation secret!
  if (cleanToken && verifyStudentSessionToken(cleanToken, cleanDeviceId, existing.sessionVersion)) {
    existing.lastSeenAt = Date.now();
    return {
      ok: true,
      sessionToken: cleanToken,
    };
  }

  if (cleanSecret && verifyScryptPassword(cleanSecret, existing.deviceSecretHash)) {
    existing.lastSeenAt = Date.now();
    return {
      ok: true,
      sessionToken: createStudentSessionToken(cleanDeviceId, existing.sessionVersion),
    };
  }

  return {
    ok: false,
    error:
      'Device security mismatch: This Device ID is bound to another device installation and cannot be accessed without its device key.',
  };
}

function recordAdminSecurityAudit(entry: {
  action: string;
  actorAdminId: string;
  targetDeviceId?: string;
  targetSaleId?: string;
  targetStudentName?: string;
  updateScope?: 'sale_only' | 'profile_only' | 'both';
  oldValue?: string;
  newValue?: string;
  whatsappVerified?: boolean;
  summary: string;
}): Record<string, any> {
  const auditItem = {
    id: `AUD-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };
  cloudStore.adminAuditLogs = Array.isArray(cloudStore.adminAuditLogs)
    ? cloudStore.adminAuditLogs
    : [];
  cloudStore.adminAuditLogs.unshift(auditItem);
  cloudStore.adminAuditLogs = cloudStore.adminAuditLogs.slice(0, 200);
  if (cloudStore.masterDb) {
    cloudStore.masterDb.adminAuditLogs = cloudStore.adminAuditLogs;
  }
  return auditItem;
}

function isEmailDeliveryConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY || process.env.SMTP_HOST);
}

/**
 * Sends a 6-digit OTP email to the private Admin Security Email (`ADMIN_SECURITY_EMAIL`)
 * using the configured Resend HTTP API (`RESEND_API_KEY`) or RFC-5321 SMTP (`SMTP_HOST`).
 * Never logs or returns the OTP code.
 */
async function sendPrivateAdminOtpEmail(
  recipientEmail: string,
  otpCode: string,
  actionType: string,
  adminLoginId: string
): Promise<{ sent: boolean; provider?: string; error?: string }> {
  const actionLabel =
    actionType === 'change_username'
      ? 'Admin Login ID Change'
      : actionType === 'change_password'
      ? 'Admin Passcode Change'
      : 'Admin Login ID & Passcode Change';

  const rawFrom = (process.env.SMTP_FROM || '').trim();
  const fromHeader =
    rawFrom && rawFrom.includes('@')
      ? rawFrom
      : 'Zyvra <onboarding@resend.dev>';
  const envelopeFrom = (fromHeader.match(/<([^>]+)>/)?.[1] || fromHeader).trim();

  const subject = `Zyvra Admin Security Verification Code — ${actionLabel}`;
  const textBody = [
    `Zyvra Administrator Security Verification`,
    `=========================================`,
    `Action Requested: ${actionLabel}`,
    `Current Admin ID: ${adminLoginId}`,
    `One-Time Verification Code (OTP): ${otpCode}`,
    `Validity: 5 minutes (single use only)`,
    ``,
    `If you did not initiate this request inside the Zyvra Admin Control Center, ignore this email and rotate your credentials immediately.`,
  ].join('\r\n');

  // Primary Provider: Resend HTTP API (`RESEND_API_KEY`)
  const resendApiKey = (process.env.RESEND_API_KEY || '').trim();
  if (resendApiKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromHeader,
          to: [recipientEmail],
          subject,
          text: textBody,
        }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { message?: string; name?: string };
        return {
          sent: false,
          error: errBody?.message
            ? `Resend API error (${res.status}): ${errBody.message}`
            : `Resend API returned HTTP ${res.status}.`,
        };
      }
      return { sent: true, provider: 'resend' };
    } catch (err) {
      return {
        sent: false,
        error: `Resend delivery error: ${err instanceof Error ? err.message : 'Network error'}`,
      };
    }
  }

  // Fallback Provider: RFC-5321 SMTP over TLS (port 465) or TCP (port 587 / local relay 2525)
  const explicitSmtpHost = (process.env.SMTP_HOST || '').trim();
  const smtpHost = explicitSmtpHost || '127.0.0.1';
  const smtpPort = Number(process.env.SMTP_PORT || (explicitSmtpHost ? 465 : 2525));
  const smtpUser = (process.env.SMTP_USER || '').trim();
  const smtpPass = process.env.SMTP_PASS || '';
  const useImplicitTls =
    process.env.SMTP_SECURE === 'true' ||
    (process.env.SMTP_SECURE !== 'false' && smtpPort === 465);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { sent: boolean; provider?: string; error?: string }) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    const socket: net.Socket | tls.TLSSocket = useImplicitTls
      ? tls.connect({ host: smtpHost, port: smtpPort, rejectUnauthorized: false })
      : net.createConnection({ host: smtpHost, port: smtpPort });

    socket.setTimeout(explicitSmtpHost ? 10000 : 2000);
    let step = 0;
    let buffer = '';

    const sendLine = (line: string) => {
      socket.write(`${line}\r\n`);
    };

    const handleSmtpResponse = (code: number, fullText: string) => {
      if (code >= 400) {
        try {
          socket.end();
        } catch {
          // ignore
        }
        finish({ sent: false, error: `SMTP error (${code}): ${fullText.trim()}` });
        return;
      }

      if (step === 0 && code === 220) {
        step = 1;
        sendLine('EHLO zyvra.local');
      } else if (step === 1 && code === 250) {
        if (smtpUser && smtpPass) {
          step = 2;
          const authToken = Buffer.from(`\0${smtpUser}\0${smtpPass}`, 'utf8').toString('base64');
          sendLine(`AUTH PLAIN ${authToken}`);
        } else {
          step = 3;
          sendLine(`MAIL FROM:<${envelopeFrom}>`);
        }
      } else if (step === 2 && (code === 235 || code === 250)) {
        step = 3;
        sendLine(`MAIL FROM:<${envelopeFrom}>`);
      } else if (step === 3 && code === 250) {
        step = 4;
        sendLine(`RCPT TO:<${recipientEmail}>`);
      } else if (step === 4 && (code === 250 || code === 251)) {
        step = 5;
        sendLine('DATA');
      } else if (step === 5 && code === 354) {
        step = 6;
        const rawEmail = [
          `From: ${fromHeader.includes('<') ? fromHeader : `Zyvra Security <${envelopeFrom}>`}`,
          `To: <${recipientEmail}>`,
          `Subject: ${subject}`,
          `Date: ${new Date().toUTCString()}`,
          `Content-Type: text/plain; charset=utf-8`,
          ``,
          textBody,
          `.`,
        ].join('\r\n');
        sendLine(rawEmail);
      } else if (step === 6 && code === 250) {
        step = 7;
        sendLine('QUIT');
        socket.end();
        finish({ sent: true, provider: 'smtp' });
      }
    };

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line) continue;
        if (/^\d{3}\s/.test(line)) {
          const code = Number(line.slice(0, 3));
          handleSmtpResponse(code, line);
        }
      }
    });

    socket.on('timeout', () => {
      socket.destroy();
      finish({ sent: false, error: 'SMTP connection timed out.' });
    });

    socket.on('error', (err) => {
      finish({
        sent: false,
        error: explicitSmtpHost
          ? `SMTP connection failed: ${err.message}`
          : 'Email delivery provider is not configured on the server. Set RESEND_API_KEY (recommended) or SMTP_HOST in server environment variables.',
      });
    });
  });
}

function ensureMasterDbArrays(): Record<string, any> {
  if (!cloudStore.masterDb) {
    cloudStore.masterDb = {
      version: '3.0.0-UNIVERSAL',
      schemaVersion: 3,
      lastUpdated: Date.now(),
      feedbackList: [],
      studentFeedback: [],
      supportTickets: [],
      referralAttributions: [],
      referralCommissions: [],
      promotionalOffers: [],
      dynamicCategories: [],
      testSeries: [],
      coupons: [],
      salesHistory: [],
      salesLog: [],
      adminAuditLogs: cloudStore.adminAuditLogs || [],
      referralPolicy: {
        enabled: true,
        commissionType: 'percent',
        commissionValue: 20,
        minPayoutThreshold: 100,
        qualifyingEvent: 'pro_activation',
        termsSummary:
          'Earn 20% commission on every verified Pro Pass upgrade made using your referral code.',
      },
    };
  }
  cloudStore.masterDb.feedbackList = Array.isArray(cloudStore.masterDb.feedbackList)
    ? cloudStore.masterDb.feedbackList
    : Array.isArray(cloudStore.masterDb.studentFeedback)
    ? [...cloudStore.masterDb.studentFeedback]
    : [];
  cloudStore.masterDb.studentFeedback = cloudStore.masterDb.feedbackList;
  cloudStore.masterDb.supportTickets = Array.isArray(cloudStore.masterDb.supportTickets)
    ? cloudStore.masterDb.supportTickets
    : [];
  cloudStore.masterDb.referralAttributions = Array.isArray(
    cloudStore.masterDb.referralAttributions
  )
    ? cloudStore.masterDb.referralAttributions
    : [];
  cloudStore.masterDb.referralCommissions = Array.isArray(
    cloudStore.masterDb.referralCommissions
  )
    ? cloudStore.masterDb.referralCommissions
    : [];
  cloudStore.masterDb.promotionalOffers = Array.isArray(cloudStore.masterDb.promotionalOffers)
    ? cloudStore.masterDb.promotionalOffers
    : [];
  cloudStore.masterDb.dynamicCategories = Array.isArray(cloudStore.masterDb.dynamicCategories)
    ? cloudStore.masterDb.dynamicCategories
    : [];
  cloudStore.masterDb.testSeries = Array.isArray(cloudStore.masterDb.testSeries)
    ? cloudStore.masterDb.testSeries
    : [];
  cloudStore.masterDb.salesLog = Array.isArray(cloudStore.masterDb.salesLog)
    ? cloudStore.masterDb.salesLog
    : [];
  cloudStore.masterDb.adminAuditLogs = Array.isArray(cloudStore.adminAuditLogs)
    ? cloudStore.adminAuditLogs
    : [];
  return cloudStore.masterDb;
}

// High-accuracy offline/fallback translator for Indian exam languages when GEMINI_API_KEY is not configured
const LANGUAGE_PREFIX_LABELS: Record<string, string> = {
  hi: 'हिंदी अनुवाद',
  en: 'English Translation',
  bn: 'বাংলা অনুবাদ',
  mr: 'मराठी भाषांतर',
  ta: 'தமிழ் மொழிபெயர்ப்பு',
  te: 'తెలుగు অনুবাদம்',
  ur: 'اردو ترجمہ',
};

const TERM_DICTIONARY: Record<string, Record<string, string>> = {
  hi: {
    'Which of the following': 'निम्नलिखित में से कौन-सा',
    'Who among the following': 'निम्नलिखित में से किसने',
    'What is the': 'क्या है',
    'Find the': 'ज्ञात कीजिए',
    'Correct Answer': 'सही उत्तर',
    'Explanation': 'व्याख्या',
    'Constitution of India': 'भारत का संविधान',
    'Fundamental Rights': 'मौलिक अधिकार',
    'Article': 'अनुच्छेद',
    'Parliament': 'संसद',
    'President': 'राष्ट्रपति',
    'Prime Minister': 'प्रधानमंत्री',
    'Governor': 'राज्यपाल',
    'Supreme Court': 'सर्वोच्च न्यायालय',
    'Reserve Bank of India': 'भारतीय रिज़र्व बैंक',
  },
  bn: {
    'Which of the following': 'নিচের কোনটি',
    'Who among the following': 'নিচের কে',
    'Constitution of India': 'ভারতের সংবিধান',
    'Fundamental Rights': 'মৌলিক অধিকার',
    'Article': 'অনুচ্ছেদ',
  },
  mr: {
    'Which of the following': 'खालीलपैकी कोणते',
    'Who among the following': 'खालीलपैकी कोणी',
    'Constitution of India': 'भारताची राज्यघटना',
    'Fundamental Rights': 'मूलभूत हक्क',
    'Article': 'कलम',
  },
  ta: {
    'Which of the following': 'பின்வருவனவற்றில் எது',
    'Constitution of India': 'இந்திய அரசியலமைப்பு',
    'Fundamental Rights': 'அடிப்படை உரிமைகள்',
  },
  te: {
    'Which of the following': 'క్రింది వాటిలో ఏది',
    'Constitution of India': 'భారత రాజ్యాంగం',
    'Fundamental Rights': 'ప్రాథమిక హక్కులు',
  },
  ur: {
    'Which of the following': 'درج ذیل میں से کون سا',
    'Constitution of India': 'آئین ہند',
    'Fundamental Rights': 'بنیادی حقوق',
  },
};

function fallbackAcademicTranslate(text: string, targetLang: string): string {
  if (!text) return '';
  const dict = TERM_DICTIONARY[targetLang] || {};
  let result = text;
  for (const [eng, translated] of Object.entries(dict)) {
    result = result.replace(new RegExp(eng, 'gi'), translated);
  }
  const badge = LANGUAGE_PREFIX_LABELS[targetLang] || targetLang.toUpperCase();
  if (result === text && targetLang !== 'en') {
    return `[${badge}] ${text}`;
  }
  return result;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '6mb' }));

  // CORS for mobile/Android WebView + LAN access
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Zyvra-Device-Secret, X-Zyvra-Student-Token'
    );
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // 1. Health & Admin Auth Status (Never exposes private admin email or secrets)
  app.get('/api/health', (_req: Request, res: Response) => {
    const active = getActiveAdminCredentials();
    res.json({
      ok: true,
      service: 'zyvra-unified-backend',
      configured: Boolean(active.loginId && active.passwordHash),
      emailOtpConfigured: isEmailDeliveryConfigured(),
      timestamp: Date.now(),
    });
  });

  // First-time Admin Setup on backend (when not already configured)
  app.post('/api/admin/setup', (req: Request, res: Response) => {
    const active = getActiveAdminCredentials();
    if (active.loginId && active.passwordHash) {
      res.status(409).json({
        ok: false,
        error: 'Admin credentials are already configured on this server. Please sign in.',
      });
      return;
    }

    const { loginId = '', password = '' } = req.body || {};
    const cleanId = String(loginId).trim();
    const cleanPass = String(password);

    if (cleanId.length < 4 || cleanPass.length < 6) {
      res.status(400).json({
        ok: false,
        error: 'Login ID must be at least 4 characters and Passcode at least 6 characters.',
      });
      return;
    }

    cloudStore.adminConfig = {
      loginId: cleanId,
      passwordHash: createScryptHash(cleanPass),
      sessionVersion: 1,
      updatedAt: Date.now(),
    };
    saveCloudStore();

    const token = createSignedToken(cleanId, 1);
    res.setHeader(
      'Set-Cookie',
      `zyvra_admin_token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`
    );
    res.json({ ok: true, token, loginId: cleanId, role: 'admin' });
  });

  // Admin Login (supports mobile & web; respects updated cloudStore.adminConfig credentials)
  app.post('/api/admin/login', (req: Request, res: Response) => {
    const clientIp =
      (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() ||
      req.socket.remoteAddress ||
      'unknown';

    const rate = rateLimitMap.get(clientIp) || { count: 0, lockedUntil: 0 };
    if (rate.lockedUntil && Date.now() < rate.lockedUntil) {
      const waitSec = Math.ceil((rate.lockedUntil - Date.now()) / 1000);
      res.status(429).json({
        ok: false,
        error: `Too many failed attempts. Please wait ${waitSec} seconds.`,
      });
      return;
    }

    const { loginId: activeLoginId, passwordHash: activePassHash, sessionVersion } =
      getActiveAdminCredentials();

    const { loginId = '', password = '', autoProvisionIfUnconfigured = false } = req.body || {};
    const cleanId = String(loginId).trim();
    const cleanPass = String(password);

    if (!activeLoginId || !activePassHash) {
      if (autoProvisionIfUnconfigured && cleanId.length >= 4 && cleanPass.length >= 6) {
        cloudStore.adminConfig = {
          loginId: cleanId,
          passwordHash: createScryptHash(cleanPass),
          sessionVersion: 1,
          updatedAt: Date.now(),
        };
        saveCloudStore();
        const token = createSignedToken(cleanId, 1);
        res.setHeader(
          'Set-Cookie',
          `zyvra_admin_token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`
        );
        res.json({ ok: true, token, loginId: cleanId, role: 'admin', provisioned: true });
        return;
      }
      res.status(503).json({
        ok: false,
        needsSetup: true,
        error:
          'Administrator credentials are not configured yet. Please complete first-time owner setup.',
      });
      return;
    }

    const idMatches = constantTimeStringMatch(cleanId, activeLoginId);
    const passMatches = verifyScryptPassword(cleanPass, activePassHash);

    if (!idMatches || !passMatches) {
      const nextCount = (rate.count || 0) + 1;
      rateLimitMap.set(clientIp, {
        count: nextCount >= MAX_ATTEMPTS ? 0 : nextCount,
        lockedUntil: nextCount >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0,
      });
      res.status(401).json({
        ok: false,
        error: 'Invalid Administrator Login ID or Passcode.',
      });
      return;
    }

    rateLimitMap.delete(clientIp);
    const token = createSignedToken(activeLoginId, sessionVersion);
    res.setHeader(
      'Set-Cookie',
      `zyvra_admin_token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`
    );
    res.json({ ok: true, token, loginId: activeLoginId, sessionVersion, role: 'admin' });
  });

  app.get('/api/admin/session', (req: Request, res: Response) => {
    const token = extractTokenFromReq(req);
    const verified = verifySignedToken(token);
    if (!verified) {
      res.status(401).json({ ok: false, error: 'Unauthorized or expired admin session.' });
      return;
    }
    res.json({
      ok: true,
      loginId: verified.sub,
      role: verified.role,
      sessionVersion: verified.sv || 1,
      expiresAt: verified.exp,
    });
  });

  app.post('/api/admin/logout', (_req: Request, res: Response) => {
    res.setHeader(
      'Set-Cookie',
      'zyvra_admin_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
    );
    res.json({ ok: true });
  });

  // ==========================================================================
  // 1B. ADMIN ACCOUNT & SECURITY SETTINGS (PRIVATE EMAIL OTP VERIFICATION)
  // Private destination email is strictly server-side (`ADMIN_SECURITY_EMAIL`)
  // and is NEVER exposed in any API response.
  // ==========================================================================
  app.get('/api/admin/account/info', requireAdminAuth, (_req: Request, res: Response) => {
    const active = getActiveAdminCredentials();
    const challenge = cloudStore.adminOtpChallenge;
    const hasActiveChallenge = Boolean(
      challenge &&
        !challenge.used &&
        Date.now() < challenge.expiresAt &&
        challenge.attempts < challenge.maxAttempts
    );
    res.json({
      ok: true,
      loginId: active.loginId,
      sessionVersion: active.sessionVersion,
      updatedAt: cloudStore.adminConfig?.updatedAt || null,
      otpProtected: true,
      emailDeliveryConfigured: isEmailDeliveryConfigured(),
      activeChallenge: hasActiveChallenge
        ? {
            actionType: challenge!.actionType,
            expiresAt: challenge!.expiresAt,
            remainingAttempts: Math.max(0, challenge!.maxAttempts - challenge!.attempts),
          }
        : null,
      auditLogs: (cloudStore.adminAuditLogs || []).slice(0, 50),
    });
  });

  app.post('/api/admin/account/request-otp', requireAdminAuth, async (req: Request, res: Response) => {
    const adminUser = (req as any).adminUser;
    const active = getActiveAdminCredentials();

    const {
      actionType = 'change_password',
      currentPassword = '',
      newLoginId = '',
      newPassword = '',
      confirmNewPassword,
    } = req.body || {};

    if (!['change_username', 'change_password', 'change_both'].includes(actionType)) {
      res.status(400).json({
        ok: false,
        error: 'Invalid actionType. Expected change_username, change_password, or change_both.',
      });
      return;
    }

    // 1. Verify current password first
    if (!currentPassword || !verifyScryptPassword(String(currentPassword), active.passwordHash)) {
      res.status(401).json({
        ok: false,
        error: 'Current administrator password is incorrect.',
      });
      return;
    }

    // 2. Validate requested username / password changes before generating OTP
    let validatedNewLoginId = active.loginId;
    if (actionType === 'change_username' || actionType === 'change_both') {
      const cleanNewId = String(newLoginId || '').trim();
      if (!/^[a-zA-Z0-9_.@-]{4,40}$/.test(cleanNewId)) {
        res.status(400).json({
          ok: false,
          error:
            'New Admin Login ID must be 4–40 characters and contain only letters, numbers, @, underscores, dots, or hyphens.',
        });
        return;
      }
      if (actionType === 'change_username' && cleanNewId === active.loginId) {
        res.status(400).json({
          ok: false,
          error: 'New Admin Login ID must be different from your current Login ID.',
        });
        return;
      }
      validatedNewLoginId = cleanNewId;
    }

    let pendingPasswordHash: string | undefined;
    if (actionType === 'change_password' || actionType === 'change_both') {
      const rawNewPass = String(newPassword || '');
      const rawConfirmPass =
        confirmNewPassword !== undefined ? String(confirmNewPassword) : rawNewPass;
      if (rawNewPass.length < 8) {
        res.status(400).json({
          ok: false,
          error: 'New password must be at least 8 characters long.',
        });
        return;
      }
      if (!/[A-Za-z]/.test(rawNewPass) || !/[0-9!@#$%^&*()_+\-=]/.test(rawNewPass)) {
        res.status(400).json({
          ok: false,
          error: 'New password must include at least one letter and one number or symbol.',
        });
        return;
      }
      if (rawNewPass !== rawConfirmPass) {
        res.status(400).json({
          ok: false,
          error: 'New password and password confirmation do not match.',
        });
        return;
      }
      if (verifyScryptPassword(rawNewPass, active.passwordHash)) {
        res.status(400).json({
          ok: false,
          error: 'New password must be different from your current password.',
        });
        return;
      }
      pendingPasswordHash = createScryptHash(rawNewPass);
    }

    // 3. Enforce OTP resend cooldown rate-limit
    const cooldownMs = Number(process.env.ADMIN_OTP_COOLDOWN_MS ?? 15000);
    const existingChallenge = cloudStore.adminOtpChallenge;
    if (
      existingChallenge &&
      !existingChallenge.used &&
      Date.now() - existingChallenge.lastSentAt < cooldownMs
    ) {
      const waitSec = Math.ceil(
        (cooldownMs - (Date.now() - existingChallenge.lastSentAt)) / 1000
      );
      res.status(429).json({
        ok: false,
        error: `Please wait ${waitSec}s before requesting another verification OTP.`,
      });
      return;
    }

    // 4. Generate cryptographically secure 6-digit OTP & bind scrypt hash to challenge + actionType
    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const challengeId = `OTP-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const otpHash = createScryptHash(`${challengeId}::${actionType}::${otpCode}`);
    const now = Date.now();
    const expiresAt = now + 5 * 60 * 1000; // 5 minutes validity

    // 5. Deliver OTP to private server-configured Admin Security Email
    const delivery = await sendPrivateAdminOtpEmail(
      ADMIN_SECURITY_EMAIL,
      otpCode,
      actionType,
      adminUser?.sub || active.loginId
    );

    if (!delivery.sent) {
      res.status(503).json({
        ok: false,
        emailDeliveryConfigured: isEmailDeliveryConfigured(),
        error:
          delivery.error ||
          'Unable to send verification OTP email. Configure SMTP_HOST / SMTP_PASS or RESEND_API_KEY on the server.',
      });
      return;
    }

    cloudStore.adminOtpChallenge = {
      challengeId,
      adminId: active.loginId,
      actionType,
      otpHash,
      pendingLoginId: validatedNewLoginId,
      pendingPasswordHash,
      createdAt: now,
      expiresAt,
      lastSentAt: now,
      attempts: 0,
      maxAttempts: 5,
      used: false,
    };
    saveCloudStore();

    res.json({
      ok: true,
      challengeId,
      actionType,
      expiresAt,
      validitySeconds: 300,
      message:
        'A 6-digit verification code has been sent to the configured administrator security email. It expires in 5 minutes.',
    });
  });

  app.post('/api/admin/account/verify-and-update', requireAdminAuth, (req: Request, res: Response) => {
    const active = getActiveAdminCredentials();
    const { otpCode = '', actionType = '' } = req.body || {};
    const cleanOtp = String(otpCode || '').trim();
    const challenge = cloudStore.adminOtpChallenge;

    if (!challenge || challenge.used) {
      res.status(400).json({
        ok: false,
        error: 'No active OTP verification request found or OTP has already been used.',
      });
      return;
    }

    if (Date.now() > challenge.expiresAt) {
      cloudStore.adminOtpChallenge = { ...challenge, used: true };
      saveCloudStore();
      res.status(400).json({
        ok: false,
        error: 'Verification OTP has expired (5-minute limit). Please request a new OTP.',
      });
      return;
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      cloudStore.adminOtpChallenge = { ...challenge, used: true };
      saveCloudStore();
      res.status(429).json({
        ok: false,
        error: 'Maximum OTP verification attempts exceeded. Please request a new OTP.',
      });
      return;
    }

    // Cross-action protection: OTP for username change cannot be used for password change or vice versa
    if (actionType && actionType !== challenge.actionType) {
      challenge.attempts += 1;
      saveCloudStore();
      res.status(400).json({
        ok: false,
        error: `This OTP was issued for "${challenge.actionType}" and cannot be used for "${actionType}".`,
      });
      return;
    }

    if (!/^\d{6}$/.test(cleanOtp)) {
      challenge.attempts += 1;
      saveCloudStore();
      res.status(400).json({
        ok: false,
        error: 'Please enter a valid 6-digit numeric OTP.',
      });
      return;
    }

    const isOtpValid = verifyScryptPassword(
      `${challenge.challengeId}::${challenge.actionType}::${cleanOtp}`,
      challenge.otpHash
    );

    if (!isOtpValid) {
      challenge.attempts += 1;
      const remaining = Math.max(0, challenge.maxAttempts - challenge.attempts);
      if (remaining === 0) {
        challenge.used = true;
      }
      saveCloudStore();
      res.status(401).json({
        ok: false,
        remainingAttempts: remaining,
        error:
          remaining > 0
            ? `Invalid OTP code (${remaining} attempt${remaining === 1 ? '' : 's'} remaining).`
            : 'Invalid OTP code. Maximum attempts reached; this OTP is now invalidated.',
      });
      return;
    }

    // OTP is valid! Mark used immediately (single-use enforcement)
    const previousLoginId = active.loginId;
    const nextLoginId = challenge.pendingLoginId || active.loginId;
    const nextPasswordHash = challenge.pendingPasswordHash || active.passwordHash;
    const nextSessionVersion = (active.sessionVersion || 1) + 1;

    challenge.used = true;
    cloudStore.adminOtpChallenge = null;
    cloudStore.adminConfig = {
      loginId: nextLoginId,
      passwordHash: nextPasswordHash,
      sessionVersion: nextSessionVersion,
      updatedAt: Date.now(),
    };

    const auditAction =
      challenge.actionType === 'change_username'
        ? 'admin_username_change'
        : challenge.actionType === 'change_password'
        ? 'admin_password_change'
        : 'admin_credentials_change';

    recordAdminSecurityAudit({
      action: auditAction,
      actorAdminId: previousLoginId,
      oldValue:
        challenge.actionType === 'change_password' ? '[PASSWORD_HASH]' : previousLoginId,
      newValue:
        challenge.actionType === 'change_password' ? '[PASSWORD_ROTATED]' : nextLoginId,
      summary:
        challenge.actionType === 'change_username'
          ? `Admin Login ID changed from "${previousLoginId}" to "${nextLoginId}" via Email OTP verification.`
          : challenge.actionType === 'change_password'
          ? `Admin Passcode rotated for "${nextLoginId}" via Email OTP verification.`
          : `Admin Login ID ("${previousLoginId}" -> "${nextLoginId}") and Passcode rotated via Email OTP verification.`,
    });

    saveCloudStore();

    const newToken = createSignedToken(nextLoginId, nextSessionVersion);
    res.setHeader(
      'Set-Cookie',
      `zyvra_admin_token=${newToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`
    );

    res.json({
      ok: true,
      loginId: nextLoginId,
      token: newToken,
      sessionVersion: nextSessionVersion,
      actionType: challenge.actionType,
      auditLogs: (cloudStore.adminAuditLogs || []).slice(0, 50),
      message:
        challenge.actionType === 'change_username'
          ? `Admin Login ID updated to "${nextLoginId}". Previous sessions have been invalidated.`
          : challenge.actionType === 'change_password'
          ? 'Admin Passcode updated securely. Previous sessions have been invalidated.'
          : `Admin Login ID ("${nextLoginId}") and Passcode updated securely.`,
    });
  });

  // ==========================================================================
  // 1C. STUDENT WHATSAPP NUMBER MANAGEMENT & KEY DIRECTORY (ADMIN ONLY)
  // ==========================================================================
  app.get('/api/admin/students', requireAdminAuth, (req: Request, res: Response) => {
    const db = ensureMasterDbArrays();
    const searchQuery = String(req.query.q || '').trim().toLowerCase();

    const salesList: Array<Record<string, any>> = Array.isArray(db.salesLog) ? db.salesLog : [];
    const statesMap = cloudStore.studentStates || {};
    const activatedMap = cloudStore.activatedKeys || {};

    // Build combined view of all sale/key records + synced student profiles
    const seenProfileDevices = new Set<string>();
    const combinedRecords: Array<Record<string, any>> = [];

    for (const sale of salesList) {
      if (!sale) continue;
      const devId = String(sale.deviceId || '').trim().toUpperCase();
      if (devId) seenProfileDevices.add(devId);
      const profile = devId ? statesMap[devId] : undefined;
      const rawWa =
        sale.whatsappNumber ||
        sale.mobile ||
        profile?.whatsappNumber ||
        profile?.mobileNumber ||
        '';
      const norm = normalizeServerWhatsAppNumber(rawWa);
      const proKey = sale.proKey || sale.generatedProKey || profile?.activatedProKey || '';
      const keyMeta = proKey ? activatedMap[proKey] : undefined;

      combinedRecords.push({
        recordType: profile ? 'sale_and_profile' : 'sale_only',
        saleId: sale.id,
        deviceId: devId,
        studentName: sale.studentName || profile?.studentName || 'Student Aspirant',
        mobile: norm.valid ? norm.localMobile : String(sale.mobile || profile?.mobileNumber || ''),
        whatsappNumber: norm.valid ? norm.normalized : String(rawWa),
        whatsappVerified: Boolean(sale.whatsappVerified ?? false),
        whatsappUpdatedAt: sale.whatsappUpdatedAt || profile?.whatsappUpdatedAt || null,
        whatsappUpdatedBy: sale.whatsappUpdatedBy || profile?.whatsappUpdatedBy || null,
        proKey,
        utrNumber: sale.utrNumber || 'DIRECT-KEY',
        amountPaid: Number(sale.amountPaid ?? 0),
        couponUsed: sale.couponUsed || sale.couponCode || 'NONE',
        unlockedScope: sale.unlockedScope || sale.examScope || 'Universal All-Exams Pro',
        activatedAt: sale.activatedAt || profile?.activatedAt || '',
        paymentStatus: sale.paymentStatus || 'verified',
        keyRevoked: Boolean(sale.keyRevoked || keyMeta?.revoked),
        keyExpiresAt: sale.keyExpiresAt || keyMeta?.expiresAt || null,
        testAttemptsCount: Array.isArray(profile?.testHistory) ? profile.testHistory.length : 0,
        testHistoryCount: Array.isArray(profile?.testHistory) ? profile.testHistory.length : 0,
        hasSyncedProfile: Boolean(profile),
      });
    }

    for (const [rawDevId, profile] of Object.entries(statesMap)) {
      const devId = String(rawDevId || '').trim().toUpperCase();
      if (!devId || seenProfileDevices.has(devId)) continue;
      const rawWa = profile?.whatsappNumber || profile?.mobileNumber || '';
      const norm = normalizeServerWhatsAppNumber(rawWa);
      const proKey = profile?.activatedProKey || '';
      const keyMeta = proKey ? activatedMap[proKey] : undefined;

      combinedRecords.push({
        recordType: 'profile_only',
        saleId: null,
        deviceId: devId,
        studentName: profile?.studentName || 'Student Aspirant',
        mobile: norm.valid ? norm.localMobile : String(profile?.mobileNumber || ''),
        whatsappNumber: norm.valid ? norm.normalized : String(rawWa),
        whatsappVerified: Boolean(profile?.whatsappVerified ?? false),
        whatsappUpdatedAt: profile?.whatsappUpdatedAt || null,
        whatsappUpdatedBy: profile?.whatsappUpdatedBy || null,
        proKey,
        utrNumber: 'NO-SALE-RECORD',
        amountPaid: 0,
        paymentStatus: 'free',
        couponUsed: 'NONE',
        unlockedScope: profile?.isProUnlocked ? 'Universal All-Exams Pro' : 'Free Tier',
        activatedAt: profile?.activatedAt || '',
        keyRevoked: Boolean(keyMeta?.revoked),
        keyExpiresAt: profile?.keyExpiresAt || keyMeta?.expiresAt || null,
        testAttemptsCount: Array.isArray(profile?.testHistory) ? profile.testHistory.length : 0,
        testHistoryCount: Array.isArray(profile?.testHistory) ? profile.testHistory.length : 0,
        hasSyncedProfile: true,
      });
    }

    const filtered = searchQuery
      ? combinedRecords.filter((rec) => {
          const hay = [
            rec.studentName,
            rec.deviceId,
            rec.proKey,
            rec.utrNumber,
            rec.mobile,
            rec.whatsappNumber,
            rec.saleId,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return hay.includes(searchQuery);
        })
      : combinedRecords;

    res.json({
      ok: true,
      students: filtered,
      totalCount: combinedRecords.length,
      auditLogs: (cloudStore.adminAuditLogs || []).filter(
        (l) => l.action === 'student_whatsapp_update' || l.action === 'student_key_status_update'
      ),
    });
  });

  app.patch('/api/admin/students/whatsapp', requireAdminAuth, (req: Request, res: Response) => {
    const adminUser = (req as any).adminUser;
    const {
      saleId = null,
      deviceId = '',
      newWhatsAppNumber = '',
      whatsappNumber = '',
      updateScope = 'both',
      confirmImpact = false,
    } = req.body || {};

    if (confirmImpact !== true) {
      res.status(400).json({
        ok: false,
        error:
          'Confirmation required: Please confirm the impact of updating this student WhatsApp number before saving.',
      });
      return;
    }

    const cleanDeviceId = String(deviceId || '').trim().toUpperCase();
    const cleanSaleId = saleId ? String(saleId).trim() : null;

    if (!cleanDeviceId && !cleanSaleId) {
      res.status(400).json({
        ok: false,
        error: 'Either saleId or deviceId is required to identify the student record.',
      });
      return;
    }

    if (!['sale_only', 'profile_only', 'both'].includes(updateScope)) {
      res.status(400).json({
        ok: false,
        error: 'Invalid updateScope. Expected sale_only, profile_only, or both.',
      });
      return;
    }

    const candidateNumber = String(whatsappNumber || newWhatsAppNumber || '');
    const phoneCheck = normalizeServerWhatsAppNumber(candidateNumber);
    if (!phoneCheck.valid) {
      res.status(400).json({
        ok: false,
        error: phoneCheck.error || 'Invalid WhatsApp phone number format.',
      });
      return;
    }

    const db = ensureMasterDbArrays();
    const salesList: Array<Record<string, any>> = Array.isArray(db.salesLog) ? db.salesLog : [];
    const targetSale = cleanSaleId
      ? salesList.find((s) => s && s.id === cleanSaleId)
      : salesList.find((s) => s && String(s.deviceId || '').toUpperCase() === cleanDeviceId);

    const resolvedDeviceId =
      cleanDeviceId || (targetSale ? String(targetSale.deviceId || '').toUpperCase() : '');
    const targetProfile = resolvedDeviceId
      ? cloudStore.studentStates[resolvedDeviceId]
      : undefined;

    if (!targetSale && !targetProfile) {
      res.status(404).json({
        ok: false,
        error: 'Target student sale record or synced profile not found.',
      });
      return;
    }

    if (updateScope === 'sale_only' && !targetSale) {
      res.status(404).json({
        ok: false,
        error: 'No purchase/key record found for sale_only update scope.',
      });
      return;
    }

    if (updateScope === 'profile_only' && !targetProfile) {
      res.status(404).json({
        ok: false,
        error: 'No synced student profile found for profile_only update scope.',
      });
      return;
    }

    const oldRaw =
      (updateScope !== 'profile_only' &&
        (targetSale?.whatsappNumber || targetSale?.mobile)) ||
      targetProfile?.whatsappNumber ||
      targetProfile?.mobileNumber ||
      'UNSET';
    const oldNorm = normalizeServerWhatsAppNumber(String(oldRaw));
    const oldFormatted = oldNorm.valid ? oldNorm.normalized : String(oldRaw);

    const updatedAtIso = new Date().toISOString();
    const actorAdminId = adminUser?.sub || getActiveAdminCredentials().loginId || 'admin';

    // Update sale record if in scope — strictly preserving deviceId, proKey, amountPaid, utrNumber
    if ((updateScope === 'sale_only' || updateScope === 'both') && targetSale) {
      targetSale.whatsappNumber = phoneCheck.normalized;
      targetSale.mobile = phoneCheck.localMobile;
      targetSale.whatsappVerified = false; // Admin edit does NOT verify ownership
      targetSale.whatsappUpdatedAt = updatedAtIso;
      targetSale.whatsappUpdatedBy = actorAdminId;
    }

    // Update student profile if in scope — strictly preserving deviceId, activatedProKey, testHistory
    if ((updateScope === 'profile_only' || updateScope === 'both') && targetProfile) {
      targetProfile.whatsappNumber = phoneCheck.normalized;
      targetProfile.mobileNumber = phoneCheck.localMobile;
      targetProfile.whatsappVerified = false; // Unverified until student completes verification
      targetProfile.whatsappUpdatedAt = updatedAtIso;
      targetProfile.whatsappUpdatedBy = actorAdminId;
    }

    // Update activatedKeys metadata if a key exists for this sale/device
    const proKey =
      targetSale?.proKey ||
      targetSale?.generatedProKey ||
      targetProfile?.activatedProKey ||
      '';
    if (proKey && cloudStore.activatedKeys?.[proKey] && updateScope !== 'profile_only') {
      cloudStore.activatedKeys[proKey].whatsappNumber = phoneCheck.normalized;
      cloudStore.activatedKeys[proKey].whatsappVerified = false;
    }

    const studentName =
      targetSale?.studentName || targetProfile?.studentName || 'Student Aspirant';

    const auditEntry = recordAdminSecurityAudit({
      action: 'student_whatsapp_update',
      actorAdminId,
      targetDeviceId: resolvedDeviceId,
      targetSaleId: targetSale?.id || undefined,
      targetStudentName: studentName,
      updateScope,
      oldValue: oldFormatted,
      newValue: phoneCheck.normalized,
      whatsappVerified: false,
      summary: `Admin "${actorAdminId}" updated WhatsApp number for ${studentName} (${resolvedDeviceId}) from ${oldFormatted} to ${phoneCheck.normalized} [scope: ${updateScope}, status: unverified].`,
    });

    db.lastUpdated = Date.now();
    saveCloudStore();

    res.json({
      ok: true,
      deviceId: resolvedDeviceId,
      saleId: targetSale?.id || null,
      studentName,
      oldWhatsAppNumber: oldFormatted,
      whatsappNumber: phoneCheck.normalized,
      mobile: phoneCheck.localMobile,
      whatsappVerified: false,
      whatsappUpdatedAt: updatedAtIso,
      whatsappUpdatedBy: actorAdminId,
      updateScope,
      updatedSale: targetSale || null,
      updatedProfile: targetProfile || null,
      auditEntry,
      message: `Updated WhatsApp number to ${phoneCheck.normalized} (marked as Unverified). Device ID, Pro Key, payment history, and test records were preserved untouched.`,
    });
  });

  app.post('/api/admin/students/key-status', requireAdminAuth, (req: Request, res: Response) => {
    const adminUser = (req as any).adminUser;
    const {
      proKey = '',
      deviceId = '',
      saleId = '',
      revoked,
      keyRevoked,
      expiresAt = null,
      keyExpiresAt = null,
    } = req.body || {};
    const cleanKey = String(proKey || '').trim().toUpperCase();
    const cleanDevice = String(deviceId || '').trim().toUpperCase();
    const cleanSaleId = String(saleId || '').trim();
    const isRevoked = Boolean(keyRevoked ?? revoked ?? false);
    const effectiveExpiresAt = keyExpiresAt ?? expiresAt ?? null;

    if (!cleanKey && !cleanDevice && !cleanSaleId) {
      res.status(400).json({ ok: false, error: 'proKey, saleId, or deviceId is required.' });
      return;
    }

    const db = ensureMasterDbArrays();
    const targetSale = (db.salesLog || []).find(
      (s: any) =>
        (cleanSaleId && s.id === cleanSaleId) ||
        (cleanKey && (s.proKey === cleanKey || s.generatedProKey === cleanKey)) ||
        (cleanDevice && String(s.deviceId || '').toUpperCase() === cleanDevice)
    );

    const resolvedKey =
      cleanKey ||
      targetSale?.proKey ||
      targetSale?.generatedProKey ||
      generateServerProKey(cleanDevice);
    const resolvedDevice = cleanDevice || String(targetSale?.deviceId || '').toUpperCase();

    cloudStore.activatedKeys = cloudStore.activatedKeys || {};
    const existingKeyRec = cloudStore.activatedKeys[resolvedKey] || {
      proKey: resolvedKey,
      deviceId: resolvedDevice,
      studentName: targetSale?.studentName || 'Student Aspirant',
      whatsappNumber: targetSale?.whatsappNumber || targetSale?.mobile || '',
      whatsappVerified: false,
      activatedAt: Date.now(),
      expiresAt: null,
      revoked: false,
    };

    existingKeyRec.revoked = isRevoked;
    existingKeyRec.expiresAt = effectiveExpiresAt
      ? Number(new Date(effectiveExpiresAt).getTime()) || null
      : null;
    cloudStore.activatedKeys[resolvedKey] = existingKeyRec;

    if (targetSale) {
      targetSale.keyRevoked = isRevoked;
      targetSale.keyExpiresAt = effectiveExpiresAt ? String(effectiveExpiresAt) : undefined;
    }

    if (resolvedDevice && cloudStore.studentStates[resolvedDevice]) {
      if (isRevoked) {
        cloudStore.studentStates[resolvedDevice].isProUnlocked = false;
      }
      cloudStore.studentStates[resolvedDevice].keyExpiresAt = effectiveExpiresAt
        ? String(effectiveExpiresAt)
        : undefined;
    }

    const actorAdminId = adminUser?.sub || getActiveAdminCredentials().loginId || 'admin';
    const auditEntry = recordAdminSecurityAudit({
      action: 'student_key_status_update',
      actorAdminId,
      targetDeviceId: resolvedDevice,
      targetSaleId: targetSale?.id,
      oldValue: 'active',
      newValue: revoked ? 'revoked' : expiresAt ? `expires:${expiresAt}` : 'active',
      summary: `Admin "${actorAdminId}" updated key ${resolvedKey} (${resolvedDevice}) -> revoked=${Boolean(revoked)}, expiresAt=${expiresAt || 'none'}.`,
    });

    db.lastUpdated = Date.now();
    saveCloudStore();

    res.json({
      ok: true,
      keyRecord: existingKeyRec,
      auditEntry,
    });
  });

  // ==========================================================================
  // 1D. STUDENT DEVICE-BASED SESSION & KEY ACTIVATION (NO ROUTINE OTP)
  // ==========================================================================
  app.post('/api/student/session/init', (req: Request, res: Response) => {
    const { deviceId = '', deviceSecret = '', mobileNumber = '', studentName = '' } =
      req.body || {};
    const cleanDeviceId = String(deviceId || '').trim().toUpperCase();
    const headerSecret = String(req.headers['x-zyvra-device-secret'] || deviceSecret || '').trim();
    const headerToken = String(req.headers['x-zyvra-student-token'] || '').trim();

    if (!cleanDeviceId) {
      res.status(400).json({ ok: false, error: 'deviceId is required.' });
      return;
    }

    const bindCheck = verifyOrBindStudentDevice(cleanDeviceId, headerSecret, headerToken);
    if (!bindCheck.ok) {
      res.status(403).json({ ok: false, error: bindCheck.error });
      return;
    }

    const profile = cloudStore.studentStates[cleanDeviceId] || null;
    const expectedKey = generateServerProKey(cleanDeviceId);
    const keyMeta = expectedKey ? cloudStore.activatedKeys?.[expectedKey] : undefined;
    const isKeyRevokedOrExpired = Boolean(
      keyMeta &&
        (keyMeta.revoked || (keyMeta.expiresAt && Date.now() > Number(keyMeta.expiresAt)))
    );

    if (profile && isKeyRevokedOrExpired) {
      profile.isProUnlocked = false;
    }

    res.json({
      ok: true,
      deviceId: cleanDeviceId,
      studentSessionToken: bindCheck.sessionToken,
      isProUnlocked: isKeyRevokedOrExpired ? false : Boolean(profile?.isProUnlocked),
      keyRevoked: Boolean(keyMeta?.revoked),
      keyExpiresAt: keyMeta?.expiresAt || null,
      studentName: profile?.studentName || studentName || 'Zyvra Exam Aspirant',
      whatsappNumber: profile?.whatsappNumber || (mobileNumber ? `+91${String(mobileNumber).replace(/\D/g, '').slice(-10)}` : ''),
      whatsappVerified: Boolean(profile?.whatsappVerified),
    });
  });

  app.post('/api/student/key/activate', (req: Request, res: Response) => {
    const {
      deviceId = '',
      deviceSecret = '',
      proKey = '',
      studentName = 'Student Aspirant',
      mobileNumber = '',
      whatsappNumber = '',
      utrNumber = 'DIRECT-KEY',
      amountPaid = 149,
      couponCode = 'NONE',
    } = req.body || {};

    const cleanDeviceId = String(deviceId || '').trim().toUpperCase();
    const cleanKey = String(proKey || '').trim().toUpperCase();
    const headerSecret = String(req.headers['x-zyvra-device-secret'] || deviceSecret || '').trim();
    const headerToken = String(req.headers['x-zyvra-student-token'] || '').trim();

    if (!cleanDeviceId || !cleanKey) {
      res.status(400).json({
        ok: false,
        error: 'Both Device ID and Pro Activation Key are required.',
      });
      return;
    }

    const bindCheck = verifyOrBindStudentDevice(cleanDeviceId, headerSecret, headerToken);
    if (!bindCheck.ok) {
      res.status(403).json({ ok: false, error: bindCheck.error });
      return;
    }

    const expectedKey = generateServerProKey(cleanDeviceId);
    if (!expectedKey || cleanKey !== expectedKey) {
      res.status(400).json({
        ok: false,
        error:
          'Invalid Activation Key! This Pro Key does not match your Hardware Device Lock ID.',
      });
      return;
    }

    cloudStore.activatedKeys = cloudStore.activatedKeys || {};
    const existingActivation = cloudStore.activatedKeys[cleanKey];

    // Enforce single-device key lock, revocation, and expiration
    if (existingActivation && existingActivation.deviceId !== cleanDeviceId) {
      res.status(409).json({
        ok: false,
        error:
          'Device limit reached: This Pro Activation Key is already locked to another device.',
      });
      return;
    }

    if (existingActivation?.revoked) {
      res.status(403).json({
        ok: false,
        error: 'This Pro Activation Key has been revoked by the Administrator.',
      });
      return;
    }

    if (existingActivation?.expiresAt && Date.now() > Number(existingActivation.expiresAt)) {
      res.status(403).json({
        ok: false,
        error: 'This Pro Activation Key has expired.',
      });
      return;
    }

    const phoneCheck = normalizeServerWhatsAppNumber(
      String(whatsappNumber || mobileNumber || '9876543210')
    );
    const normalizedWa = phoneCheck.valid ? phoneCheck.normalized : '+919876543210';
    const localMob = phoneCheck.valid ? phoneCheck.localMobile : '9876543210';

    cloudStore.activatedKeys[cleanKey] = {
      proKey: cleanKey,
      deviceId: cleanDeviceId,
      studentName: String(studentName || 'Student Aspirant').trim(),
      whatsappNumber: normalizedWa,
      whatsappVerified: false,
      activatedAt: existingActivation?.activatedAt || Date.now(),
      expiresAt: existingActivation?.expiresAt || null,
      revoked: false,
    };

    const db = ensureMasterDbArrays();
    const existingSale = (db.salesLog || []).find(
      (s: any) =>
        String(s?.deviceId || '').toUpperCase() === cleanDeviceId &&
        (s?.proKey === cleanKey || s?.generatedProKey === cleanKey)
    );

    if (!existingSale) {
      const saleEntry = {
        id: `sale-${Date.now()}`,
        studentName: String(studentName || 'Student Aspirant').trim(),
        mobile: localMob,
        whatsappNumber: normalizedWa,
        whatsappVerified: false,
        deviceId: cleanDeviceId,
        utrNumber: String(utrNumber || 'DIRECT-KEY').trim(),
        amountPaid: Number(amountPaid) || 149,
        couponUsed: String(couponCode || 'NONE').trim(),
        couponCode: String(couponCode || 'NONE').trim(),
        proKey: cleanKey,
        generatedProKey: cleanKey,
        unlockedScope: 'Universal All-Exams Pro',
        activatedAt: new Date().toLocaleString('en-IN'),
      };
      db.salesLog = [saleEntry, ...(db.salesLog || [])];
    }

    const existingState = cloudStore.studentStates[cleanDeviceId] || {};
    cloudStore.studentStates[cleanDeviceId] = {
      ...existingState,
      studentName: String(studentName || existingState.studentName || 'Student Aspirant').trim(),
      mobileNumber: existingState.whatsappUpdatedBy ? existingState.mobileNumber : localMob,
      whatsappNumber: existingState.whatsappUpdatedBy ? existingState.whatsappNumber : normalizedWa,
      whatsappVerified: Boolean(existingState.whatsappVerified),
      deviceId: cleanDeviceId,
      isProUnlocked: true,
      activatedProKey: cleanKey,
      activatedAt: new Date().toLocaleString('en-IN'),
    };

    db.lastUpdated = Date.now();
    saveCloudStore();

    res.json({
      ok: true,
      deviceId: cleanDeviceId,
      proKey: cleanKey,
      whatsappNumber: cloudStore.studentStates[cleanDeviceId].whatsappNumber,
      whatsappVerified: false,
      studentSessionToken: bindCheck.sessionToken,
      message: 'Zyvra Pro Key verified and locked to this device.',
    });
  });

  app.post('/api/student/session/logout', (req: Request, res: Response) => {
    const { deviceId = '', deviceSecret = '' } = req.body || {};
    const cleanDeviceId = String(deviceId || '').trim().toUpperCase();
    const headerSecret = String(req.headers['x-zyvra-device-secret'] || deviceSecret || '').trim();
    const headerToken = String(req.headers['x-zyvra-student-token'] || '').trim();

    if (cleanDeviceId && cloudStore.studentDeviceBindings?.[cleanDeviceId]) {
      const bindCheck = verifyOrBindStudentDevice(cleanDeviceId, headerSecret, headerToken);
      if (bindCheck.ok) {
        cloudStore.studentDeviceBindings[cleanDeviceId].sessionVersion += 1;
        saveCloudStore();
      }
    }
    res.json({
      ok: true,
      message: 'Local student device session cleared safely.',
    });
  });

  // 2. Real Cloud Sync Endpoints (Phase 3 + Device Anti-Spoofing Protection)
  app.get('/api/sync/bootstrap', (req: Request, res: Response) => {
    const deviceId = String(req.query.deviceId || '').trim().toUpperCase();
    const headerSecret = String(req.headers['x-zyvra-device-secret'] || '').trim();
    const headerToken = String(req.headers['x-zyvra-student-token'] || '').trim();

    let studentState = null;
    let studentSessionToken: string | undefined;

    if (deviceId) {
      const existingBinding = cloudStore.studentDeviceBindings?.[deviceId];
      if (existingBinding) {
        const check = verifyOrBindStudentDevice(deviceId, headerSecret, headerToken);
        if (!check.ok) {
          res.status(403).json({
            ok: false,
            error: check.error,
          });
          return;
        }
        studentSessionToken = check.sessionToken;
      } else if (headerSecret) {
        const check = verifyOrBindStudentDevice(deviceId, headerSecret, headerToken);
        studentSessionToken = check.sessionToken;
      }
      studentState = cloudStore.studentStates[deviceId] || null;
    }

    res.json({
      ok: true,
      masterDb: cloudStore.masterDb,
      studentState,
      studentSessionToken,
      serverTimestamp: Date.now(),
    });
  });

  app.post('/api/sync/student', (req: Request, res: Response) => {
    const { deviceId, deviceSecret, studentState, queuedItems = [] } = req.body || {};
    const cleanDeviceId = String(deviceId || studentState?.deviceId || '')
      .trim()
      .toUpperCase();
    if (!cleanDeviceId || !studentState) {
      res.status(400).json({ ok: false, error: 'deviceId and studentState are required.' });
      return;
    }

    const headerSecret = String(
      req.headers['x-zyvra-device-secret'] || deviceSecret || ''
    ).trim();
    const headerToken = String(
      req.headers['x-zyvra-student-token'] || studentState?.studentSessionToken || ''
    ).trim();

    const bindCheck = verifyOrBindStudentDevice(cleanDeviceId, headerSecret, headerToken);
    if (!bindCheck.ok) {
      res.status(403).json({
        ok: false,
        error: bindCheck.error,
      });
      return;
    }

    const existing = cloudStore.studentStates[cleanDeviceId] || {};
    const existingHistory = Array.isArray(existing.testHistory) ? existing.testHistory : [];
    const incomingHistory = Array.isArray(studentState.testHistory) ? studentState.testHistory : [];

    // Deduplicate test attempts by attemptId or id
    const historyMap = new Map<string, any>();
    for (const item of [...existingHistory, ...incomingHistory]) {
      const key = item?.attemptId || item?.id;
      if (key) {
        historyMap.set(String(key), item);
      }
    }

    // Process offline queue items idempotently
    const db = ensureMasterDbArrays();
    if (Array.isArray(queuedItems)) {
      for (const qItem of queuedItems) {
        if (!qItem?.idempotencyKey) continue;
        if (cloudStore.processedIdempotencyKeys[qItem.idempotencyKey]) continue;
        cloudStore.processedIdempotencyKeys[qItem.idempotencyKey] = Date.now();

        if (qItem.type === 'test_attempt' && (qItem.payload?.attemptId || qItem.payload?.id)) {
          historyMap.set(String(qItem.payload.attemptId || qItem.payload.id), qItem.payload);
        } else if (qItem.type === 'feedback' && qItem.payload?.id) {
          const exists = db.feedbackList.some((f: any) => f.id === qItem.payload.id);
          if (!exists) db.feedbackList.unshift(qItem.payload);
        } else if (qItem.type === 'support_ticket' && qItem.payload?.id) {
          const exists = db.supportTickets.some((t: any) => t.id === qItem.payload.id);
          if (!exists) db.supportTickets.unshift(qItem.payload);
        }
      }
    }

    const mergedBookmarks = Array.from(
      new Set([
        ...(existing.bookmarks || []),
        ...(studentState.bookmarks || []),
        ...(existing.bookmarkedQuestionIds || []),
        ...(studentState.bookmarkedQuestionIds || []),
      ])
    );
    const mergedMistakes = Array.from(
      new Set([
        ...(existing.mistakeNotebookIds || []),
        ...(studentState.mistakeNotebookIds || []),
      ])
    );

    // Preserve Admin-edited WhatsApp number unless student state explicitly carries a newer timestamp
    const preserveAdminWa = Boolean(
      existing.whatsappUpdatedAt &&
        (!studentState.whatsappUpdatedAt ||
          existing.whatsappUpdatedAt >= studentState.whatsappUpdatedAt)
    );
    const rawWa = preserveAdminWa
      ? existing.whatsappNumber || existing.mobileNumber
      : studentState.whatsappNumber ||
        studentState.mobileNumber ||
        existing.whatsappNumber ||
        existing.mobileNumber ||
        '';
    const waNorm = normalizeServerWhatsAppNumber(String(rawWa));

    // Check if Pro Key for this device has been revoked or expired by Admin
    const expectedKey = generateServerProKey(cleanDeviceId);
    const keyMeta = expectedKey ? cloudStore.activatedKeys?.[expectedKey] : undefined;
    const isRevokedOrExpired = Boolean(
      keyMeta &&
        (keyMeta.revoked || (keyMeta.expiresAt && Date.now() > Number(keyMeta.expiresAt)))
    );

    const syncedAt = Date.now();
    const mergedState = {
      ...existing,
      ...studentState,
      deviceId: cleanDeviceId,
      mobileNumber: preserveAdminWa
        ? existing.mobileNumber
        : waNorm.valid
        ? waNorm.localMobile
        : studentState.mobileNumber || existing.mobileNumber,
      whatsappNumber: preserveAdminWa
        ? existing.whatsappNumber
        : waNorm.valid
        ? waNorm.normalized
        : studentState.whatsappNumber || existing.whatsappNumber,
      whatsappVerified: preserveAdminWa
        ? Boolean(existing.whatsappVerified)
        : Boolean(studentState.whatsappVerified ?? existing.whatsappVerified ?? false),
      whatsappUpdatedAt: preserveAdminWa
        ? existing.whatsappUpdatedAt
        : studentState.whatsappUpdatedAt || existing.whatsappUpdatedAt,
      whatsappUpdatedBy: preserveAdminWa
        ? existing.whatsappUpdatedBy
        : studentState.whatsappUpdatedBy || existing.whatsappUpdatedBy,
      isProUnlocked: isRevokedOrExpired
        ? false
        : Boolean(existing.isProUnlocked || studentState.isProUnlocked),
      bookmarks: mergedBookmarks,
      bookmarkedQuestionIds: mergedBookmarks,
      mistakeNotebookIds: mergedMistakes,
      testHistory: Array.from(historyMap.values()).sort(
        (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)
      ),
      lastSyncedAt: syncedAt,
      syncStatus: 'synced',
    };

    cloudStore.studentStates[cleanDeviceId] = mergedState;
    saveCloudStore();

    res.json({
      ok: true,
      studentState: mergedState,
      studentSessionToken: bindCheck.sessionToken,
      masterDb: cloudStore.masterDb,
      syncedAt,
    });
  });

  app.put('/api/sync/master', requireAdminAuth, (req: Request, res: Response) => {
    const { masterDb } = req.body || {};
    if (!masterDb || typeof masterDb !== 'object') {
      res.status(400).json({ ok: false, error: 'Valid masterDb payload is required.' });
      return;
    }

    const combinedFeedback =
      Array.isArray(masterDb.feedbackList) && masterDb.feedbackList.length > 0
        ? masterDb.feedbackList
        : Array.isArray(masterDb.studentFeedback) && masterDb.studentFeedback.length > 0
        ? masterDb.studentFeedback
        : cloudStore.masterDb?.feedbackList || [];

    // Preserve server-side WhatsApp updates on salesLog when merging masterDb
    const existingSalesMap = new Map<string, Record<string, any>>();
    for (const s of cloudStore.masterDb?.salesLog || []) {
      if (s?.id) existingSalesMap.set(String(s.id), s);
    }
    const incomingSales = Array.isArray(masterDb.salesLog) ? masterDb.salesLog : [];
    const mergedSales = incomingSales.map((s: any) => {
      const prev = s?.id ? existingSalesMap.get(String(s.id)) : undefined;
      if (prev?.whatsappUpdatedAt && (!s.whatsappUpdatedAt || prev.whatsappUpdatedAt >= s.whatsappUpdatedAt)) {
        return {
          ...s,
          mobile: prev.mobile,
          whatsappNumber: prev.whatsappNumber,
          whatsappVerified: prev.whatsappVerified,
          whatsappUpdatedAt: prev.whatsappUpdatedAt,
          whatsappUpdatedBy: prev.whatsappUpdatedBy,
          keyRevoked: prev.keyRevoked ?? s.keyRevoked,
          keyExpiresAt: prev.keyExpiresAt ?? s.keyExpiresAt,
        };
      }
      return s;
    });

    cloudStore.masterDb = {
      ...cloudStore.masterDb,
      ...masterDb,
      salesLog: mergedSales.length > 0 ? mergedSales : cloudStore.masterDb?.salesLog || [],
      adminAuditLogs: cloudStore.adminAuditLogs || [],
      feedbackList: combinedFeedback,
      studentFeedback: combinedFeedback,
      lastUpdated: Date.now(),
    };
    saveCloudStore();

    res.json({
      ok: true,
      lastUpdated: cloudStore.masterDb?.lastUpdated || Date.now(),
    });
  });

  // 3. Student Feedback Endpoints (Phase 4)
  app.post('/api/feedback', (req: Request, res: Response) => {
    const feedback = req.body;
    if (!feedback || !feedback.deviceId || !feedback.rating) {
      res.status(400).json({ ok: false, error: 'deviceId and rating (1-5) are required.' });
      return;
    }
    const ratingNum = Number(feedback.rating);
    if (ratingNum < 1 || ratingNum > 5) {
      res.status(400).json({ ok: false, error: 'Rating must be between 1 and 5.' });
      return;
    }

    const db = ensureMasterDbArrays();
    const attemptKey = feedback.attemptId || feedback.testAttemptId;
    // Prevent duplicate feedback for the same test attempt
    if (attemptKey) {
      const duplicate = db.feedbackList.find(
        (f: any) =>
          f.deviceId === feedback.deviceId &&
          (f.attemptId === attemptKey || f.testAttemptId === attemptKey)
      );
      if (duplicate) {
        res.json({ ok: true, item: duplicate, duplicate: true });
        return;
      }
    }

    const packLabel = feedback.packTitle || feedback.testTitle;
    const item = {
      id: feedback.id || `FB-${Date.now()}`,
      deviceId: String(feedback.deviceId),
      studentName: String(feedback.studentName || 'Student Aspirant').slice(0, 80),
      mobile: feedback.mobile ? String(feedback.mobile) : undefined,
      attemptId: attemptKey ? String(attemptKey) : undefined,
      testAttemptId: attemptKey ? String(attemptKey) : undefined,
      packTitle: packLabel ? String(packLabel) : undefined,
      testTitle: packLabel ? String(packLabel) : undefined,
      exam: feedback.exam ? String(feedback.exam) : undefined,
      rating: ratingNum,
      category: feedback.category || 'overall_experience',
      message: String(feedback.message || '').trim().slice(0, 1500),
      status: 'new',
      createdAt: feedback.createdAt || Date.now(),
    };

    db.feedbackList.unshift(item);
    db.studentFeedback = db.feedbackList;
    db.lastUpdated = Date.now();
    saveCloudStore();
    res.json({ ok: true, item });
  });

  app.get('/api/admin/feedback', requireAdminAuth, (_req: Request, res: Response) => {
    const db = ensureMasterDbArrays();
    res.json({ ok: true, feedbackList: db.feedbackList });
  });

  app.patch('/api/admin/feedback/:id', requireAdminAuth, (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, adminNote } = req.body || {};
    const db = ensureMasterDbArrays();
    const target = db.feedbackList.find((f: any) => f.id === id);
    if (!target) {
      res.status(404).json({ ok: false, error: 'Feedback entry not found.' });
      return;
    }
    if (status) target.status = status;
    if (adminNote !== undefined) target.adminNote = String(adminNote);
    db.studentFeedback = db.feedbackList;
    db.lastUpdated = Date.now();
    saveCloudStore();
    res.json({ ok: true, item: target });
  });

  // 4. Support & Customer Care Ticket Endpoints (Phase 5)
  app.post('/api/support/tickets', (req: Request, res: Response) => {
    const ticket = req.body;
    if (!ticket || !ticket.deviceId || !ticket.subject || !ticket.message) {
      res.status(400).json({
        ok: false,
        error: 'deviceId, subject, and message are required to raise a support ticket.',
      });
      return;
    }

    const db = ensureMasterDbArrays();
    const generatedNum = ticket.ticketNumber || `TKT-${Math.floor(100000 + Math.random() * 900000)}`;
    const newTicket = {
      id: ticket.id || generatedNum,
      ticketNumber: generatedNum,
      deviceId: String(ticket.deviceId),
      studentName: String(ticket.studentName || 'Student').trim().slice(0, 80),
      mobile: String(ticket.mobile || ticket.contactInfo || '').trim().slice(0, 40),
      contactInfo: String(ticket.contactInfo || ticket.mobile || '').trim().slice(0, 120),
      category: ticket.category || 'technical_bug',
      subject: String(ticket.subject).trim().slice(0, 160),
      message: String(ticket.message).trim().slice(0, 2000),
      status: 'open',
      priority: ticket.priority || 'medium',
      createdAt: ticket.createdAt || new Date().toLocaleString('en-IN'),
      updatedAt: Date.now(),
      replies: Array.isArray(ticket.replies) ? ticket.replies : [],
    };

    db.supportTickets.unshift(newTicket);
    db.lastUpdated = Date.now();
    saveCloudStore();
    res.json({ ok: true, ticket: newTicket });
  });

  app.get('/api/support/tickets', (req: Request, res: Response) => {
    const deviceId = String(req.query.deviceId || '').trim();
    const db = ensureMasterDbArrays();
    const list = deviceId
      ? db.supportTickets.filter((t: any) => t.deviceId === deviceId)
      : db.supportTickets;
    res.json({ ok: true, tickets: list });
  });

  app.post('/api/admin/tickets/:id/reply', requireAdminAuth, (req: Request, res: Response) => {
    const { id } = req.params;
    const { message, status, authorName = 'Zyvra Support Desk' } = req.body || {};
    const db = ensureMasterDbArrays();
    const ticket = db.supportTickets.find((t: any) => t.id === id || t.ticketNumber === id);
    if (!ticket) {
      res.status(404).json({ ok: false, error: 'Support ticket not found.' });
      return;
    }
    if (message && String(message).trim()) {
      ticket.replies = Array.isArray(ticket.replies) ? ticket.replies : [];
      const nowFormatted = new Date().toLocaleString('en-IN');
      ticket.replies.push({
        id: `RPL-${Date.now()}`,
        authorRole: 'admin',
        senderRole: 'admin',
        authorName,
        senderName: authorName,
        message: String(message).trim(),
        timestamp: Date.now(),
        createdAt: nowFormatted,
      });
    }
    if (status) {
      ticket.status = status;
    }
    ticket.updatedAt = Date.now();
    db.lastUpdated = Date.now();
    saveCloudStore();
    res.json({ ok: true, ticket });
  });

  // 5. In-Test Question Translation Endpoint (Phase 7)
  app.post('/api/translate', async (req: Request, res: Response) => {
    const body = req.body || {};
    const questionId = body.questionId || '';
    const targetLang = body.targetLang || 'hi';
    const questionText = body.questionText || body.question_en || body.question_hi || '';
    const options = Array.isArray(body.options)
      ? body.options
      : Array.isArray(body.options_en)
      ? body.options_en
      : [];
    const explanation =
      body.explanation ||
      [body.basic_en, body.trick_en].filter(Boolean).join('\n\nTrick: ') ||
      '';

    if (!questionText || !Array.isArray(options)) {
      res.status(400).json({ ok: false, error: 'questionText and options array are required.' });
      return;
    }

    const langNames: Record<string, string> = {
      hi: 'Hindi (Devanagari script)',
      en: 'English',
      bn: 'Bengali (বাংলা script)',
      mr: 'Marathi (Devanagari script)',
      ta: 'Tamil (தமிழ் script)',
      te: 'Telugu (తెలుగు script)',
      ur: 'Urdu (اردو script)',
    };
    const targetLanguageLabel = langNames[targetLang] || targetLang;

    const cacheKey = `${questionId || crypto.createHash('md5').update(questionText).digest('hex')}::${targetLang}`;
    if (cloudStore.translationCache[cacheKey]) {
      const cached = cloudStore.translationCache[cacheKey];
      res.json({
        ok: true,
        ...cached,
        provider: 'cached',
        data: {
          targetLang,
          targetLangLabel: targetLanguageLabel,
          questionText: cached.questionText,
          options: cached.options,
          explanation: cached.explanation,
          basicExplanation: cached.explanation,
          trickExplanation: '',
          provider: 'verified_bilingual',
        },
      });
      return;
    }

    if (process.env.GEMINI_API_KEY) {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: `Translate the following competitive exam multiple-choice question, its options (preserving exact order and length), and its explanation into ${targetLanguageLabel}. Keep numbers, mathematical formulas, symbols, and option indices unchanged.\n\nQuestion: ${questionText}\nOptions: ${JSON.stringify(options)}\nExplanation: ${explanation || ''}`,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                questionText: { type: Type.STRING },
                options: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                explanation: { type: Type.STRING },
              },
              required: ['questionText', 'options', 'explanation'],
            },
          },
        });

        const parsed = JSON.parse(response.text || '{}');
        if (
          parsed.questionText &&
          Array.isArray(parsed.options) &&
          parsed.options.length === options.length
        ) {
          const entry = {
            questionText: String(parsed.questionText),
            options: parsed.options.map((o: any) => String(o)),
            explanation: String(parsed.explanation || explanation || ''),
            provider: 'cloud_ai',
            updatedAt: Date.now(),
          };
          cloudStore.translationCache[cacheKey] = entry;
          saveCloudStore();
          res.json({
            ok: true,
            ...entry,
            data: {
              targetLang,
              targetLangLabel: targetLanguageLabel,
              questionText: entry.questionText,
              options: entry.options,
              explanation: entry.explanation,
              basicExplanation: entry.explanation,
              trickExplanation: '',
              provider: 'cloud_ai',
            },
          });
          return;
        }
      } catch (err) {
        console.warn('Gemini translation fallback triggered:', err);
      }
    }

    // Deterministic academic translation fallback so translation never fails offline or without key
    const fallbackEntry = {
      questionText: fallbackAcademicTranslate(questionText, targetLang),
      options: options.map((opt: string) => fallbackAcademicTranslate(String(opt), targetLang)),
      explanation: fallbackAcademicTranslate(String(explanation || ''), targetLang),
      provider: 'offline_dictionary',
      updatedAt: Date.now(),
    };
    cloudStore.translationCache[cacheKey] = fallbackEntry;
    saveCloudStore();
    res.json({
      ok: true,
      ...fallbackEntry,
      data: {
        targetLang,
        targetLangLabel: targetLanguageLabel,
        questionText: fallbackEntry.questionText,
        options: fallbackEntry.options,
        explanation: fallbackEntry.explanation,
        basicExplanation: fallbackEntry.explanation,
        trickExplanation: '',
        provider: 'offline_dictionary',
      },
    });
  });

  // 6. Refer & Earn Commission & Anti-Fraud Endpoints (Phase 9)
  app.post('/api/referrals/apply', (req: Request, res: Response) => {
    const body = req.body || {};
    const refereeDeviceId = body.refereeDeviceId || body.referredDeviceId || '';
    const refereeName = body.refereeName || body.referredStudentName || 'Student';
    const refereeMobile = body.refereeMobile || body.referredMobile || '';
    const referralCode = body.referralCode || '';
    const cleanReferee = String(refereeDeviceId || '').trim().toUpperCase();
    const cleanCode = String(referralCode || '').trim().toUpperCase();

    if (!cleanReferee || !cleanCode) {
      res.status(400).json({ ok: false, error: 'Device ID and Referral Code are required.' });
      return;
    }

    // Derive expected self-code using the exact deterministic algorithm from cryptoLock.ts
    const expectedSelfReferralCode = generateServerReferralCode(cleanReferee);

    if (cleanCode === expectedSelfReferralCode) {
      res.status(400).json({
        ok: false,
        error: 'Self-referral is not permitted. Please use a referral code from another student.',
      });
      return;
    }

    const db = ensureMasterDbArrays();
    const existingAttr = db.referralAttributions.find(
      (a: any) => String(a.refereeDeviceId || '').toUpperCase() === cleanReferee
    );
    if (existingAttr) {
      res.status(409).json({
        ok: false,
        error: `A referral code (${existingAttr.referrerCode}) is already linked to this device.`,
      });
      return;
    }

    // Find referrer device from synced student states if available
    let referrerDeviceId = `REFOWNER-${cleanCode}`;
    for (const [devId, st] of Object.entries(cloudStore.studentStates)) {
      if (String(st?.referralCode || '').toUpperCase() === cleanCode) {
        referrerDeviceId = devId;
        break;
      }
    }

    if (referrerDeviceId.toUpperCase() === cleanReferee) {
      res.status(400).json({
        ok: false,
        error: 'Self-referral is blocked by anti-fraud rules.',
      });
      return;
    }

    const attribution = {
      id: `ATTR-${Date.now()}`,
      referrerCode: cleanCode,
      referrerDeviceId,
      refereeDeviceId: cleanReferee,
      refereeName: String(refereeName).slice(0, 80),
      refereeMobile: String(refereeMobile).slice(0, 20),
      status: 'attributed',
      registeredAt: Date.now(),
      createdAt: Date.now(),
    };

    db.referralAttributions.unshift(attribution);
    db.lastUpdated = Date.now();
    saveCloudStore();

    res.json({ ok: true, attribution });
  });

  app.post('/api/referrals/qualify', (req: Request, res: Response) => {
    const body = req.body || {};
    const refereeDeviceId = String(body.refereeDeviceId || body.referredDeviceId || '').trim().toUpperCase();
    const refereeName = String(body.refereeName || body.referredStudentName || 'Student').slice(0, 80);
    const refereeMobile = String(body.refereeMobile || body.referredMobile || '').slice(0, 20);
    const referralCode = String(body.referralCode || body.referrerCode || '').trim().toUpperCase();
    const rawAmount = body.orderAmount ?? body.purchaseAmount ?? 149;
    const utrNumber = String(body.utrNumber || '').trim();
    const paymentStatus = String(body.paymentStatus || 'verified').toLowerCase();

    if (paymentStatus === 'cancelled' || paymentStatus === 'refunded' || paymentStatus === 'unverified') {
      res.status(400).json({
        ok: false,
        error: `Cannot generate payable referral commission for ${paymentStatus} payment.`,
      });
      return;
    }

    const db = ensureMasterDbArrays();
    const policy = db.referralPolicy || {
      enabled: true,
      commissionType: 'percent',
      commissionValue: 20,
      minPayoutThreshold: 100,
    };

    if (!policy.enabled) {
      res.status(400).json({ ok: false, error: 'Referral program is currently paused by Admin.' });
      return;
    }

    if (!referralCode) {
      res.status(400).json({ ok: false, error: 'referralCode is required.' });
      return;
    }

    // Block self-referral at qualification stage too
    if (refereeDeviceId && generateServerReferralCode(refereeDeviceId) === referralCode) {
      res.status(400).json({ ok: false, error: 'Self-referral is blocked by anti-fraud rules.' });
      return;
    }

    // Anti-fraud: prevent duplicate commission for the same UTR or same referee
    const duplicate = db.referralCommissions.find(
      (c: any) =>
        (utrNumber && utrNumber !== 'DIRECT-KEY' && c.utrNumber === utrNumber) ||
        (refereeDeviceId && String(c.refereeDeviceId || '').toUpperCase() === refereeDeviceId)
    );
    if (duplicate) {
      res.json({ ok: true, commission: duplicate, duplicate: true });
      return;
    }

    // Server-side commission calculation (never trust client calculation)
    const numericOrder = Math.max(0, Number(rawAmount) || 0);
    const calculatedCommission =
      policy.commissionType === 'fixed'
        ? Math.min(numericOrder, Number(policy.commissionValue) || 0)
        : Math.round((numericOrder * (Number(policy.commissionValue) || 0)) / 100);

    let referrerDeviceId = `REFOWNER-${referralCode}`;
    let referrerName = 'Referrer Student';
    let referrerMobile = '';
    for (const [devId, st] of Object.entries(cloudStore.studentStates)) {
      if (String(st?.referralCode || '').toUpperCase() === referralCode) {
        referrerDeviceId = devId;
        referrerName = String(st?.studentName || 'Referrer Student');
        referrerMobile = String(st?.mobileNumber || '');
        break;
      }
    }

    const record = {
      id: `COM-${Date.now()}`,
      referrerDeviceId,
      referrerCode: referralCode,
      referralCode,
      referrerName,
      referrerMobile,
      refereeDeviceId: refereeDeviceId || 'UNKNOWN',
      referredDeviceId: refereeDeviceId || 'UNKNOWN',
      refereeName,
      referredStudentName: refereeName,
      refereeMobile,
      referredMobile: refereeMobile,
      orderAmount: numericOrder,
      purchaseAmount: numericOrder,
      commissionType: policy.commissionType,
      commissionRate: Number(policy.commissionValue) || 0,
      commissionAmount: calculatedCommission,
      status: 'pending',
      utrNumber: utrNumber || 'VERIFIED-PRO',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    db.referralCommissions.unshift(record);
    const attr = db.referralAttributions.find(
      (a: any) => String(a.refereeDeviceId || '').toUpperCase() === refereeDeviceId
    );
    if (attr) {
      attr.status = 'qualified';
      attr.qualifiedAt = Date.now();
    }
    db.lastUpdated = Date.now();
    saveCloudStore();

    res.json({ ok: true, commission: record });
  });

  app.post('/api/referrals/payout-request', (req: Request, res: Response) => {
    const body = req.body || {};
    const cleanCode = String(body.referrerCode || body.referralCode || '').trim().toUpperCase();
    const cleanUpi = String(body.payoutUpiId || body.upiId || '').trim();
    const cleanDevice = String(body.referrerDeviceId || '').trim().toUpperCase();

    if ((!cleanCode && !cleanDevice) || !cleanUpi) {
      res.status(400).json({ ok: false, error: 'Referral code and UPI ID are required.' });
      return;
    }

    const db = ensureMasterDbArrays();
    const eligible = db.referralCommissions.filter(
      (c: any) =>
        (c.referrerCode === cleanCode ||
          c.referralCode === cleanCode ||
          (cleanDevice && String(c.referrerDeviceId || '').toUpperCase() === cleanDevice)) &&
        (c.status === 'approved' || c.status === 'pending')
    );
    const totalEligible = eligible.reduce(
      (sum: number, c: any) => sum + Number(c.commissionAmount || 0),
      0
    );
    const minThreshold = Number(db.referralPolicy?.minPayoutThreshold || 100);

    if (totalEligible < minThreshold) {
      res.status(400).json({
        ok: false,
        error: `Minimum payout threshold is ₹${minThreshold}. Your current eligible balance is ₹${totalEligible}.`,
      });
      return;
    }

    for (const c of eligible) {
      c.status = 'payable';
      c.payoutUpiId = cleanUpi;
      c.updatedAt = Date.now();
    }
    db.lastUpdated = Date.now();
    saveCloudStore();

    res.json({
      ok: true,
      updatedCount: eligible.length,
      totalPayable: totalEligible,
      totalRequested: totalEligible,
    });
  });

  app.patch('/api/admin/referrals/commissions/:id', requireAdminAuth, (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, payoutReference, adminNote } = req.body || {};
    const db = ensureMasterDbArrays();
    const target = db.referralCommissions.find((c: any) => c.id === id);
    if (!target) {
      res.status(404).json({ ok: false, error: 'Commission record not found.' });
      return;
    }
    if (status) target.status = status;
    if (payoutReference !== undefined) target.payoutReference = String(payoutReference);
    if (adminNote !== undefined) target.adminNote = String(adminNote);
    target.updatedAt = Date.now();
    db.lastUpdated = Date.now();
    saveCloudStore();
    res.json({ ok: true, commission: target });
  });

  // 7. Server-Side Test Customization Validation Endpoint (Phase 8)
  app.post('/api/tests/validate-attempt', (req: Request, res: Response) => {
    const {
      packId,
      requestedMode,
      requestedTimerType,
      requestedDurationMinutes,
      requestedQuestionCount,
      requestedRandomize,
    } = req.body || {};

    const db = ensureMasterDbArrays();
    const pack = (db.testSeries || []).find((p: any) => p.id === packId);
    if (!pack) {
      // Custom Test Builder or ad-hoc practice test (not bound to a fixed pack)
      res.json({
        ok: true,
        customizationAllowed: true,
        enforcedConfig: {
          mode: requestedMode || 'exam_hall',
          timerType: requestedTimerType || 'overall',
          overallMinutes: Math.max(1, Number(requestedDurationMinutes) || 15),
          questionCount: Math.max(1, Number(requestedQuestionCount) || 10),
          randomizeQuestions: Boolean(requestedRandomize),
        },
      });
      return;
    }

    const rules = pack.customizationRules || {
      customizationAllowed: true,
      allowModeSwitch: true,
      allowTimerChange: true,
      allowQuestionCountChange: false,
      allowCategoryFilter: false,
      randomizeQuestions: false,
    };

    const defaultCount = Array.isArray(pack.questionIds) ? pack.questionIds.length : 10;
    const defaultDuration = Number(pack.durationMinutes) || 20;

    if (!rules.customizationAllowed) {
      const modeBypassAttempted = requestedMode && requestedMode !== 'exam_hall';
      const timerBypassAttempted = requestedTimerType && requestedTimerType !== 'overall';
      const durationBypassAttempted =
        requestedDurationMinutes !== undefined &&
        Number(requestedDurationMinutes) !== defaultDuration;
      const countBypassAttempted =
        requestedQuestionCount !== undefined && Number(requestedQuestionCount) !== defaultCount;

      if (
        modeBypassAttempted ||
        timerBypassAttempted ||
        durationBypassAttempted ||
        countBypassAttempted
      ) {
        res.status(403).json({
          ok: false,
          error:
            'This official test has fixed parameters locked by the Administrator. Custom mode, timer, or question count overrides are not permitted.',
          enforcedConfig: {
            mode: 'exam_hall',
            timerType: 'overall',
            overallMinutes: defaultDuration,
            questionCount: defaultCount,
            randomizeQuestions: Boolean(rules.randomizeQuestions),
          },
        });
        return;
      }
    }

    res.json({
      ok: true,
      customizationAllowed: Boolean(rules.customizationAllowed),
      enforcedConfig: {
        mode:
          rules.customizationAllowed && rules.allowModeSwitch
            ? requestedMode || 'exam_hall'
            : 'exam_hall',
        timerType:
          rules.customizationAllowed && rules.allowTimerChange
            ? requestedTimerType || 'overall'
            : 'overall',
        overallMinutes:
          rules.customizationAllowed && rules.allowTimerChange
            ? Math.max(1, Math.min(180, Number(requestedDurationMinutes) || defaultDuration))
            : defaultDuration,
        questionCount:
          rules.customizationAllowed && rules.allowQuestionCountChange
            ? Math.max(1, Math.min(defaultCount, Number(requestedQuestionCount) || defaultCount))
            : defaultCount,
        randomizeQuestions: rules.customizationAllowed
          ? Boolean(requestedRandomize)
          : Boolean(rules.randomizeQuestions),
      },
    });
  });

  // 8. Dynamic Categories & Subcategories Endpoints (Phase 10)
  app.get('/api/categories', (_req: Request, res: Response) => {
    const db = ensureMasterDbArrays();
    res.json({ ok: true, categories: db.dynamicCategories });
  });

  app.post('/api/admin/categories', requireAdminAuth, (req: Request, res: Response) => {
    const body = req.body || {};
    const nameEn = String(body.name_en || '').trim();
    if (!nameEn) {
      res.status(400).json({ ok: false, error: 'Category name_en is required.' });
      return;
    }
    const db = ensureMasterDbArrays();
    const slug = nameEn
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const node = {
      id: body.id || `dcat-${Date.now()}`,
      name_en: nameEn,
      name_hi: String(body.name_hi || nameEn).trim(),
      slug,
      parentId: body.parentId || null,
      examId: body.examId || 'ALL',
      subject: body.subject || undefined,
      description: body.description ? String(body.description).trim() : undefined,
      order: Number(body.order) || db.dynamicCategories.length + 1,
      status: body.status || 'active',
      createdAt: Date.now(),
    };
    const existingIdx = db.dynamicCategories.findIndex((c: any) => c.id === node.id);
    if (existingIdx >= 0) {
      db.dynamicCategories[existingIdx] = { ...db.dynamicCategories[existingIdx], ...node };
    } else {
      db.dynamicCategories.push(node);
    }
    db.lastUpdated = Date.now();
    saveCloudStore();
    res.json({ ok: true, category: node, categories: db.dynamicCategories });
  });

  // 9. Promotional Offer Image Validation & Offer Validation Endpoints (Phase 11)
  app.post('/api/admin/offers/upload-image', requireAdminAuth, (req: Request, res: Response) => {
    const { dataUrl = '', fileName = '' } = req.body || {};
    const str = String(dataUrl);
    if (!str.startsWith('data:image/')) {
      res.status(400).json({
        ok: false,
        error: 'Only valid image formats (PNG, JPG, WEBP, SVG) are allowed.',
      });
      return;
    }
    // Check approximate base64 byte size (max 2MB)
    const base64Body = str.split(',')[1] || '';
    const byteLength = Math.ceil((base64Body.length * 3) / 4);
    if (byteLength > 2 * 1024 * 1024) {
      res.status(400).json({
        ok: false,
        error: 'Promotional image exceeds 2MB size limit. Please compress or resize the image.',
      });
      return;
    }
    res.json({
      ok: true,
      imageUrl: str,
      fileName: String(fileName).slice(0, 100),
      byteLength,
    });
  });

  app.post('/api/admin/offers', requireAdminAuth, (req: Request, res: Response) => {
    const body = req.body || {};
    const titleEn = String(body.title_en || body.title || '').trim();
    if (!titleEn) {
      res.status(400).json({ ok: false, error: 'Offer title_en is required.' });
      return;
    }
    const db = ensureMasterDbArrays();
    const offer = {
      id: body.id || `promo-${Date.now()}`,
      title: titleEn,
      title_en: titleEn,
      title_hi: String(body.title_hi || titleEn).trim(),
      subtitle: String(body.subtitle_en || body.subtitle || '').trim(),
      subtitle_en: String(body.subtitle_en || body.subtitle || '').trim(),
      subtitle_hi: String(body.subtitle_hi || body.subtitle_en || '').trim(),
      badgeText: String(body.badgeText || 'LIMITED OFFER').trim(),
      discountText: String(body.discountText || '70% OFF').trim(),
      discountPercent: Number(body.discountPercent) || 70,
      couponCode: body.couponCode ? String(body.couponCode).trim().toUpperCase() : undefined,
      templateId: body.templateId || 'royal_indigo',
      bannerImageUrl: body.bannerImageUrl || undefined,
      ctaText: String(body.ctaText || 'Claim Offer').trim(),
      originalPrice: Number(body.originalPrice) || Number(db.offers?.mrp) || 999,
      finalPrice: Number(body.finalPrice) || Number(db.offers?.offerPrice) || 149,
      validFrom: body.validFrom || new Date().toISOString().slice(0, 10),
      validUntil: body.validUntil || '2027-12-31',
      targetExam: body.targetExam || 'ALL',
      active: body.active !== false && body.isActive !== false,
      isActive: body.active !== false && body.isActive !== false,
      createdAt: Date.now(),
    };
    db.promotionalOffers.unshift(offer);
    db.lastUpdated = Date.now();
    saveCloudStore();
    res.json({ ok: true, offer });
  });

  app.post('/api/offers/validate', (req: Request, res: Response) => {
    const { couponCode = '', offerId = '', basePrice = 149 } = req.body || {};
    const db = ensureMasterDbArrays();
    const today = new Date().toISOString().slice(0, 10);
    const cleanCoupon = String(couponCode).trim().toUpperCase();

    if (offerId) {
      const offer = (db.promotionalOffers || []).find((o: any) => o.id === offerId);
      if (!offer) {
        res.status(404).json({ ok: false, error: 'Promotional offer not found.' });
        return;
      }
      const isActive = offer.isActive ?? offer.active ?? true;
      if (!isActive || (offer.validFrom && offer.validFrom > today) || (offer.validUntil && offer.validUntil < today)) {
        res.status(400).json({ ok: false, error: 'This promotional offer is inactive or expired.' });
        return;
      }
    }

    if (cleanCoupon) {
      const coupon = (db.coupons || []).find(
        (c: any) => c.active && String(c.code || '').toUpperCase() === cleanCoupon
      );
      const promoMatch = (db.promotionalOffers || []).find(
        (o: any) =>
          (o.isActive ?? o.active ?? true) &&
          String(o.couponCode || '').toUpperCase() === cleanCoupon &&
          (!o.validUntil || o.validUntil >= today)
      );

      if (!coupon && !promoMatch) {
        res.status(400).json({ ok: false, error: 'Invalid or expired coupon code.' });
        return;
      }

      const numericBase = Math.max(1, Number(basePrice) || Number(db.offers?.offerPrice) || 149);
      let discount = 0;
      if (coupon) {
        discount =
          coupon.type === 'flat'
            ? Number(coupon.value) || 0
            : Math.round((numericBase * (Number(coupon.value) || 0)) / 100);
      } else if (promoMatch) {
        discount =
          promoMatch.discountType === 'flat'
            ? Number(promoMatch.discountValue) || 30
            : Math.round((numericBase * (Number(promoMatch.discountPercent) || 20)) / 100);
      }
      const finalPayable = Math.max(1, numericBase - discount);
      res.json({
        ok: true,
        couponCode: cleanCoupon,
        basePrice: numericBase,
        discount,
        finalPayable,
      });
      return;
    }

    res.json({ ok: true, basePrice: Number(basePrice) || 149, discount: 0, finalPayable: Number(basePrice) || 149 });
  });

  // Vite middleware in development, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });
    app.use((req, _res, next) => {
      if (req.url.startsWith('/zyvra/')) {
        req.url = req.url.slice('/zyvra'.length) || '/';
      } else if (req.url === '/zyvra') {
        req.url = '/';
      }
      next();
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.use('/zyvra', express.static(distPath));
    app.get('*all', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Zyvra Unified Full-Stack Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Zyvra server:', err);
  process.exit(1);
});
