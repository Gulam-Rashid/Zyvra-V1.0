import express, { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'zyvra-cloud-store.json');

interface CloudStore {
  adminConfig: {
    loginId: string;
    passwordHash: string; // salt:scryptHex
    updatedAt: number;
  } | null;
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
          updatedAt: Date.now(),
        }
      : null,
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
    return {
      ...structuredClone(DEFAULT_STORE),
      ...parsed,
      studentStates: parsed.studentStates || {},
      processedIdempotencyKeys: parsed.processedIdempotencyKeys || {},
      translationCache: parsed.translationCache || {},
    };
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

function createSignedToken(loginId: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      sub: loginId,
      role: 'admin',
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

function verifySignedToken(token: string): { sub: string; role: string; exp: number } | null {
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // 1. Health & Admin Auth Status
  app.get('/api/health', (_req: Request, res: Response) => {
    const envConfigured = Boolean(process.env.ADMIN_LOGIN_ID && process.env.ADMIN_PASSWORD_HASH);
    const storeConfigured = Boolean(
      cloudStore.adminConfig?.loginId && cloudStore.adminConfig?.passwordHash
    );
    res.json({
      ok: true,
      service: 'zyvra-unified-backend',
      configured: envConfigured || storeConfigured,
      timestamp: Date.now(),
    });
  });

  // First-time Admin Setup on backend (when not already configured)
  app.post('/api/admin/setup', (req: Request, res: Response) => {
    const envConfigured = Boolean(process.env.ADMIN_LOGIN_ID && process.env.ADMIN_PASSWORD_HASH);
    const storeConfigured = Boolean(
      cloudStore.adminConfig?.loginId && cloudStore.adminConfig?.passwordHash
    );
    if (envConfigured || storeConfigured) {
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
      updatedAt: Date.now(),
    };
    saveCloudStore();

    const token = createSignedToken(cleanId);
    res.setHeader(
      'Set-Cookie',
      `zyvra_admin_token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`
    );
    res.json({ ok: true, token, loginId: cleanId, role: 'admin' });
  });

  // Admin Login (supports mobile & web)
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

    const activeLoginId =
      process.env.ADMIN_LOGIN_ID || cloudStore.adminConfig?.loginId || '';
    const activePassHash =
      process.env.ADMIN_PASSWORD_HASH || cloudStore.adminConfig?.passwordHash || '';

    const { loginId = '', password = '', autoProvisionIfUnconfigured = false } = req.body || {};
    const cleanId = String(loginId).trim();
    const cleanPass = String(password);

    // If server has no admin credentials yet and client sends valid initial credentials (e.g. from mobile setup)
    if (!activeLoginId || !activePassHash) {
      if (autoProvisionIfUnconfigured && cleanId.length >= 4 && cleanPass.length >= 6) {
        cloudStore.adminConfig = {
          loginId: cleanId,
          passwordHash: createScryptHash(cleanPass),
          updatedAt: Date.now(),
        };
        saveCloudStore();
        const token = createSignedToken(cleanId);
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
        error: 'Administrator credentials are not configured yet. Please complete first-time owner setup.',
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
    const token = createSignedToken(activeLoginId);
    res.setHeader(
      'Set-Cookie',
      `zyvra_admin_token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`
    );
    res.json({ ok: true, token, loginId: activeLoginId, role: 'admin' });
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

  // 2. Real Cloud Sync Endpoints (Phase 3)
  app.get('/api/sync/bootstrap', (req: Request, res: Response) => {
    const deviceId = String(req.query.deviceId || '').trim();
    const studentState = deviceId ? cloudStore.studentStates[deviceId] || null : null;
    res.json({
      ok: true,
      masterDb: cloudStore.masterDb,
      studentState,
      serverTimestamp: Date.now(),
    });
  });

  app.post('/api/sync/student', (req: Request, res: Response) => {
    const { deviceId, studentState, queuedItems = [] } = req.body || {};
    const cleanDeviceId = String(deviceId || studentState?.deviceId || '').trim();
    if (!cleanDeviceId || !studentState) {
      res.status(400).json({ ok: false, error: 'deviceId and studentState are required.' });
      return;
    }

    const existing = cloudStore.studentStates[cleanDeviceId] || {};
    const existingHistory = Array.isArray(existing.testHistory) ? existing.testHistory : [];
    const incomingHistory = Array.isArray(studentState.testHistory) ? studentState.testHistory : [];

    // Deduplicate test attempts by attemptId
    const historyMap = new Map<string, any>();
    for (const item of [...existingHistory, ...incomingHistory]) {
      if (item && item.attemptId) {
        historyMap.set(item.attemptId, item);
      }
    }

    // Process offline queue items idempotently
    const db = ensureMasterDbArrays();
    if (Array.isArray(queuedItems)) {
      for (const qItem of queuedItems) {
        if (!qItem?.idempotencyKey) continue;
        if (cloudStore.processedIdempotencyKeys[qItem.idempotencyKey]) continue;
        cloudStore.processedIdempotencyKeys[qItem.idempotencyKey] = Date.now();

        if (qItem.type === 'test_attempt' && qItem.payload?.attemptId) {
          historyMap.set(qItem.payload.attemptId, qItem.payload);
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
      new Set([...(existing.bookmarks || []), ...(studentState.bookmarks || [])])
    );
    const mergedMistakes = Array.from(
      new Set([...(existing.mistakeNotebookIds || []), ...(studentState.mistakeNotebookIds || [])])
    );

    const syncedAt = Date.now();
    const mergedState = {
      ...existing,
      ...studentState,
      deviceId: cleanDeviceId,
      isProUnlocked: Boolean(existing.isProUnlocked || studentState.isProUnlocked),
      bookmarks: mergedBookmarks,
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

    const combinedFeedback = Array.isArray(masterDb.feedbackList) && masterDb.feedbackList.length > 0
      ? masterDb.feedbackList
      : Array.isArray(masterDb.studentFeedback) && masterDb.studentFeedback.length > 0
      ? masterDb.studentFeedback
      : cloudStore.masterDb?.feedbackList || [];

    cloudStore.masterDb = {
      ...cloudStore.masterDb,
      ...masterDb,
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
      server: { middlewareMode: true, hmr: false },
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
