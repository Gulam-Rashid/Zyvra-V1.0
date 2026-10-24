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

function ensureMasterDbArrays(): Record<string, any> {
  if (!cloudStore.masterDb) {
    cloudStore.masterDb = {
      version: 3,
      lastUpdated: Date.now(),
      feedbackList: [],
      supportTickets: [],
      referralAttributions: [],
      referralCommissions: [],
      promotionalOffers: [],
      dynamicCategories: [],
      salesHistory: [],
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
    : [];
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

    if (cleanId.length < 4 || cleanPass.length < 8) {
      res.status(400).json({
        ok: false,
        error: 'Login ID must be at least 4 characters and Passcode at least 8 characters.',
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
      if (autoProvisionIfUnconfigured && cleanId.length >= 4 && cleanPass.length >= 8) {
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

  app.put('/api/sync/master', (req: Request, res: Response) => {
    const { masterDb } = req.body || {};
    if (!masterDb || typeof masterDb !== 'object') {
      res.status(400).json({ ok: false, error: 'Valid masterDb payload is required.' });
      return;
    }

    cloudStore.masterDb = {
      ...cloudStore.masterDb,
      ...masterDb,
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
    // Prevent duplicate feedback for the same test attempt
    if (feedback.attemptId) {
      const duplicate = db.feedbackList.find(
        (f: any) => f.deviceId === feedback.deviceId && f.attemptId === feedback.attemptId
      );
      if (duplicate) {
        res.json({ ok: true, item: duplicate, duplicate: true });
        return;
      }
    }

    const item = {
      id: feedback.id || `FB-${Date.now()}`,
      deviceId: String(feedback.deviceId),
      studentName: String(feedback.studentName || 'Student Aspirant').slice(0, 80),
      attemptId: feedback.attemptId ? String(feedback.attemptId) : undefined,
      packTitle: feedback.packTitle ? String(feedback.packTitle) : undefined,
      rating: ratingNum,
      category: feedback.category || 'overall_experience',
      message: String(feedback.message || '').trim().slice(0, 1500),
      status: 'new',
      createdAt: feedback.createdAt || Date.now(),
    };

    db.feedbackList.unshift(item);
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
    const newTicket = {
      id: ticket.id || `TKT-${Math.floor(100000 + Math.random() * 900000)}`,
      deviceId: String(ticket.deviceId),
      studentName: String(ticket.studentName || 'Student').trim().slice(0, 80),
      contactInfo: String(ticket.contactInfo || '').trim().slice(0, 120),
      category: ticket.category || 'technical_bug',
      subject: String(ticket.subject).trim().slice(0, 160),
      message: String(ticket.message).trim().slice(0, 2000),
      status: 'open',
      priority: ticket.priority || 'medium',
      createdAt: ticket.createdAt || Date.now(),
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

  app.post('/api/admin/tickets/:id/reply', (req: Request, res: Response) => {
    const { id } = req.params;
    const { message, status, authorName = 'Zyvra Support Desk' } = req.body || {};
    const db = ensureMasterDbArrays();
    const ticket = db.supportTickets.find((t: any) => t.id === id);
    if (!ticket) {
      res.status(404).json({ ok: false, error: 'Support ticket not found.' });
      return;
    }
    if (message && String(message).trim()) {
      ticket.replies = Array.isArray(ticket.replies) ? ticket.replies : [];
      ticket.replies.push({
        id: `RPL-${Date.now()}`,
        authorRole: 'admin',
        authorName,
        message: String(message).trim(),
        timestamp: Date.now(),
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
    const referralCode = body.referralCode || '';
    const cleanReferee = String(refereeDeviceId || '').trim();
    const cleanCode = String(referralCode || '').trim().toUpperCase();

    if (!cleanReferee || !cleanCode) {
      res.status(400).json({ ok: false, error: 'Device ID and Referral Code are required.' });
      return;
    }

    // Derive expected self-code to block self-referral
    const selfClean = cleanReferee.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(-6);
    let selfHash = 0;
    for (let i = 0; i < cleanReferee.length; i++) {
      selfHash = (selfHash * 31 + cleanReferee.charCodeAt(i)) >>> 0;
    }
    const selfSuffix = (selfHash % 1296).toString(36).toUpperCase().padStart(2, '0');
    const selfReferralCode = `ZYVREF-${selfClean}${selfSuffix}`;

    if (cleanCode === selfReferralCode) {
      res.status(400).json({
        ok: false,
        error: 'Self-referral is not permitted. Please use a referral code from another student.',
      });
      return;
    }

    const db = ensureMasterDbArrays();
    const existingAttr = db.referralAttributions.find(
      (a: any) => a.refereeDeviceId === cleanReferee
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

    if (referrerDeviceId === cleanReferee) {
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
      status: 'registered',
      registeredAt: Date.now(),
    };

    db.referralAttributions.unshift(attribution);
    db.lastUpdated = Date.now();
    saveCloudStore();

    res.json({ ok: true, attribution });
  });

  app.post('/api/referrals/qualify', (req: Request, res: Response) => {
    const {
      refereeDeviceId,
      refereeName = 'Student',
      referralCode = '',
      orderAmount = 199,
      utrNumber = '',
    } = req.body || {};

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

    const cleanCode = String(referralCode || '').trim().toUpperCase();
    const cleanUtr = String(utrNumber || '').trim();

    // Anti-fraud: prevent duplicate commission for the same UTR or same referee
    const duplicate = db.referralCommissions.find(
      (c: any) =>
        (cleanUtr && c.utrNumber === cleanUtr) ||
        (refereeDeviceId && c.refereeDeviceId === refereeDeviceId)
    );
    if (duplicate) {
      res.json({ ok: true, commission: duplicate, duplicate: true });
      return;
    }

    // Server-side commission calculation (never trust client calculation)
    const numericOrder = Math.max(0, Number(orderAmount) || 0);
    const calculatedCommission =
      policy.commissionType === 'fixed'
        ? Math.min(numericOrder, Number(policy.commissionValue) || 0)
        : Math.round((numericOrder * (Number(policy.commissionValue) || 0)) / 100);

    let referrerDeviceId = `REFOWNER-${cleanCode}`;
    for (const [devId, st] of Object.entries(cloudStore.studentStates)) {
      if (String(st?.referralCode || '').toUpperCase() === cleanCode) {
        referrerDeviceId = devId;
        break;
      }
    }

    const record = {
      id: `COM-${Date.now()}`,
      referrerDeviceId,
      referrerCode: cleanCode,
      refereeDeviceId: String(refereeDeviceId || 'UNKNOWN'),
      refereeName: String(refereeName).slice(0, 80),
      orderAmount: numericOrder,
      commissionAmount: calculatedCommission,
      status: 'pending',
      utrNumber: cleanUtr || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    db.referralCommissions.unshift(record);
    const attr = db.referralAttributions.find(
      (a: any) => a.refereeDeviceId === refereeDeviceId
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
    const { referrerCode, payoutUpiId } = req.body || {};
    const cleanCode = String(referrerCode || '').trim().toUpperCase();
    const cleanUpi = String(payoutUpiId || '').trim();
    if (!cleanCode || !cleanUpi) {
      res.status(400).json({ ok: false, error: 'Referral code and UPI ID are required.' });
      return;
    }

    const db = ensureMasterDbArrays();
    const eligible = db.referralCommissions.filter(
      (c: any) =>
        c.referrerCode === cleanCode &&
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

    res.json({ ok: true, updatedCount: eligible.length, totalPayable: totalEligible });
  });

  // 7. Promotional Offer Image Validation Endpoint (Phase 11)
  app.post('/api/admin/offers/upload-image', (req: Request, res: Response) => {
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
