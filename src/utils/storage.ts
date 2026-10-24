import { INITIAL_MASTER_DATABASE } from '../data/seedDatabase';
import {
  CustomFolder,
  DynamicCategoryNode,
  ExamCategory,
  ExamFamily,
  Flashcard,
  GitHubSyncConfig,
  MasterDatabase,
  PromotionalOfferItem,
  PYQTrendTopic,
  Question,
  ReferralPolicyConfig,
  StudentFeedbackItem,
  StudentLocalState,
  StudentSaleLog,
  StudyNote,
  SupportContactConfig,
  SupportTicket,
  SyncAuditLog,
  TestSeriesPack,
} from '../types/database';
import {
  generateDeviceId,
  generateReferralCode,
  getActiveAdminSession,
  verifyProKeyForDevice,
} from './cryptoLock';

const DB_STORAGE_KEY_V3 = 'universal_exam_prep_master_db_v3_0';
const LEGACY_DB_STORAGE_KEY_V26 = 'ssc_prep_master_database_v2_6';
const BACKUP_DB_STORAGE_KEY_V26 = 'ssc_prep_backup_v2_6_pre_v3_migration';
const STUDENT_STATE_KEY = 'ssc_prep_student_state_v2_6';
const GITHUB_SYNC_KEY = 'ssc_prep_github_sync_config_v1';
const THEME_STORAGE_KEY = 'ssc_prep_theme_mode';
const OFFLINE_SYNC_QUEUE_KEY = 'zyvra_offline_sync_queue_v1';
const TRANSLATION_CACHE_KEY = 'zyvra_question_translation_cache_v1';

const IDB_NAME = 'SSCExamPrepProOfflineDB';
const IDB_STORE = 'app_store';

function writeToIndexedDB(key: string, value: unknown): void {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return;
  try {
    const req = window.indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
    };
  } catch {
    // Fallback to localStorage already handled
  }
}

export function safeLower(val?: string | null): string {
  return typeof val === 'string' ? val.trim().toLowerCase() : '';
}

/**
 * Matches two exam identifiers or display names flexibly
 * (e.g. 'SSC CGL' <-> 'SSC CGL (Combined Graduate Level)', 'Railway NTPC' <-> 'Railway RRB NTPC (CBT 1 & CBT 2)')
 */
export function examStringsMatch(a?: string | null, b?: string | null): boolean {
  const sa = safeLower(a);
  const sb = safeLower(b);
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  if (sa.includes(sb) || sb.includes(sa)) return true;

  const baseA = sa.split('(')[0].trim();
  const baseB = sb.split('(')[0].trim();
  if (baseA && baseB && (baseA === baseB || baseA.includes(baseB) || baseB.includes(baseA))) {
    return true;
  }

  // Check if both strings refer to the same seeded ExamCategory (by id, name, or shortCode)
  const matchedExamA = INITIAL_MASTER_DATABASE.exams.find(
    (ex) =>
      safeLower(ex.id) === sa ||
      safeLower(ex.name) === sa ||
      safeLower(ex.shortCode) === sa ||
      safeLower(ex.code) === sa
  );
  if (matchedExamA) {
    const idLow = safeLower(matchedExamA.id);
    const nameLow = safeLower(matchedExamA.name);
    const codeLow = safeLower(matchedExamA.shortCode || matchedExamA.code);
    if (
      sb === idLow ||
      sb === nameLow ||
      sb === codeLow ||
      sb.includes(idLow) ||
      idLow.includes(sb)
    ) {
      return true;
    }
  }

  return false;
}

export function computeQuestionFingerprint(q: Pick<Question, 'question_en' | 'options_en'>): string {
  const normQ = safeLower(q.question_en).replace(/[^a-z0-9]/g, '').slice(0, 60);
  const normOpt = (q.options_en || [])
    .map((o) => safeLower(o).replace(/[^a-z0-9]/g, ''))
    .join('|')
    .slice(0, 40);
  return `fp-${normQ}-${normOpt}`;
}

/**
 * Helper to check if a question belongs to a given exam either directly (`q.exam`)
 * or via `q.examMappings` (Multi-Exam shared question mapping).
 */
export function questionMatchesExam(
  q: Question,
  examName: string,
  stageId?: string,
  paperId?: string
): boolean {
  if (!q || q.status === 'archived') return false;
  if (!examName || examName === 'ALL') return true;

  const qStage = q.stageId || q.stage;
  const qPaper = q.paperId || q.paper;

  const directMatch =
    examStringsMatch(q.exam, examName) &&
    (!stageId || stageId === 'ALL' || !qStage || examStringsMatch(qStage, stageId)) &&
    (!paperId || paperId === 'ALL' || !qPaper || examStringsMatch(qPaper, paperId));

  if (directMatch) return true;

  if (Array.isArray(q.examMappings) && q.examMappings.length > 0) {
    return q.examMappings.some((m) => {
      if (!m) return false;
      const mappedExam = m.examId || m.examName || '';
      const mappedStage = m.stageId || m.stage;
      const mappedPaper = m.paperId || m.paper;
      return (
        examStringsMatch(mappedExam, examName) &&
        (!stageId || stageId === 'ALL' || !mappedStage || examStringsMatch(mappedStage, stageId)) &&
        (!paperId || paperId === 'ALL' || !mappedPaper || examStringsMatch(mappedPaper, paperId))
      );
    });
  }
  return false;
}

export function getQuestionsForExam(
  db: MasterDatabase,
  examName: string,
  stageId?: string,
  paperId?: string
): Question[] {
  return (db.questions || []).filter((q) => questionMatchesExam(q, examName, stageId, paperId));
}

export function getNotesForExam(db: MasterDatabase, examName: string): StudyNote[] {
  if (!examName || examName === 'ALL') return db.notes || [];
  return (db.notes || []).filter((n) => {
    if (!n.exam && (!n.examIds || n.examIds.length === 0)) return true;
    if (n.exam === 'All SSC Exams') return true;
    if (n.exam && examStringsMatch(n.exam, examName)) return true;
    if (Array.isArray(n.examIds) && n.examIds.some((id) => examStringsMatch(id, examName))) {
      return true;
    }
    return false;
  });
}

export function getFoldersForExam(db: MasterDatabase, examName: string): CustomFolder[] {
  if (!examName || examName === 'ALL') return db.folders || [];
  return (db.folders || []).filter((f) => {
    if (f.exam === 'All SSC Exams') return true;
    if (f.exam && examStringsMatch(f.exam, examName)) return true;
    if (Array.isArray(f.examIds) && f.examIds.some((id) => examStringsMatch(id, examName))) {
      return true;
    }
    return false;
  });
}

function normalizeFamily(f: ExamFamily): ExamFamily {
  const orderVal = f.displayOrder ?? f.order ?? 1;
  const activeVal = f.isActive ?? f.active ?? true;
  return {
    ...f,
    name: f.name || f.name_en || 'Exam Family',
    name_en: f.name_en || f.name || 'Exam Family',
    name_hi: f.name_hi || f.name || 'परीक्षा समूह',
    description: f.description || f.description_en || '',
    description_en: f.description_en || f.description || '',
    description_hi: f.description_hi || f.description || '',
    displayOrder: orderVal,
    order: orderVal,
    isActive: activeVal,
    active: activeVal,
  };
}

function normalizeExam(e: ExamCategory): ExamCategory {
  const orderVal = e.sortOrder ?? e.order ?? 99;
  const activeVal = e.isActive ?? e.active ?? true;
  const shortCodeVal = e.shortCode || e.code || e.id || 'EXAM';
  const authorityVal =
    e.stateOrAuthority || e.conductingBody || 'Official Examination Authority';
  return {
    ...e,
    id: e.id || e.name || 'EXAM',
    name: e.name || e.id || 'Exam',
    name_hi: e.name_hi || e.name || e.id || 'परीक्षा',
    shortCode: shortCodeVal,
    code: e.code || shortCodeVal,
    stateOrAuthority: authorityVal,
    conductingBody: e.conductingBody || authorityVal,
    level: e.level || 'Central',
    sortOrder: orderVal,
    order: orderVal,
    isActive: activeVal,
    active: activeVal,
    marksPerCorrect: e.marksPerCorrect ?? 2.0,
    negativeMarking: e.negativeMarking ?? 0.5,
    marksPerUnanswered: e.marksPerUnanswered ?? 0,
    defaultDurationMinutes: e.defaultDurationMinutes ?? 60,
    defaultQuestionCount: e.defaultQuestionCount ?? 100,
    maxMarks: e.maxMarks ?? 200,
    subjects: Array.isArray(e.subjects) ? e.subjects : [],
    stages: Array.isArray(e.stages) ? e.stages : [],
  };
}

function normalizeFolder(f: CustomFolder): CustomFolder {
  const primaryExam = f.exam || (Array.isArray(f.examIds) && f.examIds[0]) || 'SSC CGL';
  const labelEn = f.name_en || f.name || 'Study Folder';
  return {
    ...f,
    name: f.name || labelEn,
    name_en: labelEn,
    name_hi: f.name_hi || f.name || labelEn,
    exam: primaryExam,
    examIds: Array.isArray(f.examIds) && f.examIds.length > 0 ? f.examIds : [primaryExam],
    subject: f.subject || 'All Subjects',
  };
}

function normalizeQuestion(q: Question, seedQ?: Question): Question {
  const merged = { ...(seedQ || {}), ...q };
  const rawMappings = Array.isArray(merged.examMappings) ? merged.examMappings : [];
  const primaryExam =
    merged.exam || rawMappings[0]?.examId || rawMappings[0]?.examName || 'SSC CGL';

  const normalizedMappings = rawMappings
    .filter(Boolean)
    .map((m) => {
      const exId = m.examId || m.examName || primaryExam;
      return {
        ...m,
        examId: exId,
        examName: m.examName || exId,
        stageId: m.stageId || m.stage,
        stage: m.stage || m.stageId,
        paperId: m.paperId || m.paper,
        paper: m.paper || m.paperId,
      };
    });

  return {
    ...merged,
    exam: primaryExam,
    examFamilyId: merged.examFamilyId || 'fam-ssc',
    stage: merged.stage || merged.stageId,
    stageId: merged.stageId || merged.stage,
    paper: merged.paper || merged.paperId,
    paperId: merged.paperId || merged.paper,
    subject: merged.subject || 'General Awareness & Static GK',
    topic: merged.topic || merged.chapter || 'General Topic',
    chapter: merged.chapter || merged.topic || 'General Topic',
    pyqTag: merged.pyqTag || 'Official PYQ',
    question_en: merged.question_en || '',
    question_hi: merged.question_hi || merged.question_en || '',
    options_en:
      Array.isArray(merged.options_en) && merged.options_en.length === 4
        ? merged.options_en
        : ['Option A', 'Option B', 'Option C', 'Option D'],
    options_hi:
      Array.isArray(merged.options_hi) && merged.options_hi.length === 4
        ? merged.options_hi
        : merged.options_en || ['विकल्प A', 'विकल्प B', 'विकल्प C', 'विकल्प D'],
    basic_en: merged.basic_en || '',
    basic_hi: merged.basic_hi || merged.basic_en || '',
    trick_en: merged.trick_en || '',
    trick_hi: merged.trick_hi || merged.trick_en || '',
    questionType: merged.questionType || 'mcq_single',
    marksPerCorrect: merged.marksPerCorrect ?? 2.0,
    negativeMarks: merged.negativeMarks ?? 0.5,
    sourceClassification: merged.sourceClassification || 'verified_pyq',
    verificationStatus: merged.verificationStatus || 'verified',
    status: merged.status || 'published',
    examMappings: normalizedMappings,
    fingerprint: merged.fingerprint || computeQuestionFingerprint(merged),
  };
}

function normalizeNote(n: StudyNote): StudyNote {
  const primaryExam = n.exam || (Array.isArray(n.examIds) && n.examIds[0]) || 'SSC CGL';
  return {
    ...n,
    title_en: n.title_en || 'Study Note',
    title_hi: n.title_hi || n.title_en || 'अध्ययन नोट्स',
    subject: n.subject || 'General Studies',
    topic: n.topic || 'Core Concept',
    exam: primaryExam,
    examIds: Array.isArray(n.examIds) && n.examIds.length > 0 ? n.examIds : [primaryExam],
    content_en: n.content_en || '',
    content_hi: n.content_hi || n.content_en || '',
  };
}

function normalizeFlashcard(fc: Flashcard): Flashcard {
  const primaryExam = fc.exam || (Array.isArray(fc.examIds) && fc.examIds[0]) || 'SSC CGL';
  return {
    ...fc,
    exam: primaryExam,
    examIds: Array.isArray(fc.examIds) && fc.examIds.length > 0 ? fc.examIds : [primaryExam],
    subject: fc.subject || 'General Studies',
    topic: fc.topic || 'Key Formula',
    front_en: fc.front_en || '',
    front_hi: fc.front_hi || fc.front_en || '',
    back_en: fc.back_en || '',
    back_hi: fc.back_hi || fc.back_en || '',
    trick_en: fc.trick_en || '',
    trick_hi: fc.trick_hi || fc.trick_en || '',
  };
}

function normalizeTrend(t: PYQTrendTopic): PYQTrendTopic {
  const ex = t.examId || t.exam || 'SSC CGL';
  const stg = t.stageOrPaper || t.stage || 'Tier-1';
  const src = t.source || t.sourceNote || 'Official Question Papers';
  return {
    ...t,
    examId: ex,
    exam: t.exam || ex,
    stageOrPaper: stg,
    stage: t.stage || stg,
    subject: t.subject || 'General Studies',
    topic_en: t.topic_en || 'High-Weightage Topic',
    topic_hi: t.topic_hi || t.topic_en || 'प्रमुख अध्याय',
    avgQuestionsPerShift: t.avgQuestionsPerShift || '2–3 Qs / Paper',
    priority: t.priority || 'High Priority',
    shiftsAsked: t.shiftsAsked ?? 10,
    weightagePercent: t.weightagePercent ?? 85,
    source: src,
    sourceNote: t.sourceNote || src,
    verificationStatus: t.verificationStatus || 'verified',
    yearBreakdown: t.yearBreakdown || {
      '2021': 10,
      '2022': 12,
      '2023': 14,
      '2024': 15,
      '2025': 15,
    },
  };
}

function normalizeSale(s: StudentSaleLog): StudentSaleLog {
  const coupon = s.couponUsed || s.couponCode || 'NONE';
  const key = s.proKey || s.generatedProKey || '';
  const scope = s.unlockedScope || s.examScope || 'Universal All-Exams Pro';
  return {
    ...s,
    couponUsed: coupon,
    couponCode: coupon,
    proKey: key,
    generatedProKey: key,
    unlockedScope: scope,
    examScope: scope,
  };
}

/**
 * Non-destructive, idempotent migration from Schema v2.6 (SSC-only) to Schema v3.0 (Universal Multi-Exam).
 * When `rawLegacyOrV3.schemaVersion === 3`, preserves exact Admin additions and deletions without
 * re-inserting deleted seed records.
 */
export function migrateDatabaseToV3(rawLegacyOrV3: Partial<MasterDatabase>): MasterDatabase {
  const seed = INITIAL_MASTER_DATABASE;
  const isAlreadyV3 = rawLegacyOrV3?.schemaVersion === 3;

  // 1. Exam Families
  const familyMap = new Map<string, ExamFamily>();
  if (!isAlreadyV3 || !Array.isArray(rawLegacyOrV3.examFamilies)) {
    (seed.examFamilies || []).forEach((f) => familyMap.set(f.id, normalizeFamily(f)));
  }
  (rawLegacyOrV3.examFamilies || []).forEach((f) => {
    if (!f || !f.id) return;
    const prev = familyMap.get(f.id);
    familyMap.set(f.id, normalizeFamily({ ...(prev || {}), ...f }));
  });

  // 2. Exams
  const examMap = new Map<string, ExamCategory>();
  if (!isAlreadyV3 || !Array.isArray(rawLegacyOrV3.exams)) {
    (seed.exams || []).forEach((e) => examMap.set(safeLower(e.id || e.name), normalizeExam(e)));
  }
  (rawLegacyOrV3.exams || []).forEach((legacyExam) => {
    if (!legacyExam) return;
    const keyById = safeLower(legacyExam.id);
    const keyByName = safeLower(legacyExam.name);
    const matchedKey = examMap.has(keyById)
      ? keyById
      : examMap.has(keyByName)
      ? keyByName
      : Array.from(examMap.keys()).find((k) => examStringsMatch(k, keyById || keyByName)) ||
        keyById ||
        keyByName;

    if (!matchedKey) return;
    const seedMatch = examMap.get(matchedKey);
    if (seedMatch) {
      examMap.set(
        matchedKey,
        normalizeExam({
          ...seedMatch,
          ...legacyExam,
          id: seedMatch.id || legacyExam.id,
          name: legacyExam.name || seedMatch.name,
          familyId: legacyExam.familyId || seedMatch.familyId || 'fam-ssc',
          stages:
            Array.isArray(legacyExam.stages) && legacyExam.stages.length > 0
              ? legacyExam.stages
              : seedMatch.stages,
          subjects: Array.from(
            new Set([...(seedMatch.subjects || []), ...(legacyExam.subjects || [])])
          ),
        })
      );
    } else {
      examMap.set(matchedKey, normalizeExam(legacyExam));
    }
  });

  // 3. Questions (Preserve Admin deletions when already on v3)
  const seedQuestionLookup = new Map<string, Question>();
  (seed.questions || []).forEach((q) => seedQuestionLookup.set(q.id, q));

  const questionMap = new Map<string, Question>();
  if (!isAlreadyV3 || !Array.isArray(rawLegacyOrV3.questions)) {
    (seed.questions || []).forEach((q) => questionMap.set(q.id, normalizeQuestion(q)));
  }
  (rawLegacyOrV3.questions || []).forEach((q) => {
    if (!q || !q.id) return;
    const seedQ = seedQuestionLookup.get(q.id);
    questionMap.set(q.id, normalizeQuestion(q, seedQ));
  });

  // 4. Folders, Notes, Flashcards, Trends, TestSeries
  const folderMap = new Map<string, CustomFolder>();
  if (!isAlreadyV3 || !Array.isArray(rawLegacyOrV3.folders)) {
    (seed.folders || []).forEach((f) => folderMap.set(f.id, normalizeFolder(f)));
  }
  (rawLegacyOrV3.folders || []).forEach((f) => {
    if (!f || !f.id) return;
    folderMap.set(f.id, normalizeFolder({ ...(folderMap.get(f.id) || {}), ...f }));
  });

  const noteMap = new Map<string, StudyNote>();
  if (!isAlreadyV3 || !Array.isArray(rawLegacyOrV3.notes)) {
    (seed.notes || []).forEach((n) => noteMap.set(n.id, normalizeNote(n)));
  }
  (rawLegacyOrV3.notes || []).forEach((n) => {
    if (!n || !n.id) return;
    noteMap.set(n.id, normalizeNote({ ...(noteMap.get(n.id) || {}), ...n }));
  });

  const flashcardMap = new Map<string, Flashcard>();
  if (!isAlreadyV3 || !Array.isArray(rawLegacyOrV3.flashcards)) {
    (seed.flashcards || []).forEach((fc) => flashcardMap.set(fc.id, normalizeFlashcard(fc)));
  }
  (rawLegacyOrV3.flashcards || []).forEach((fc) => {
    if (!fc || !fc.id) return;
    flashcardMap.set(fc.id, normalizeFlashcard({ ...(flashcardMap.get(fc.id) || {}), ...fc }));
  });

  const trendMap = new Map<string, PYQTrendTopic>();
  const seedTrends = seed.pyqTrends || seed.trends || [];
  const rawTrends = rawLegacyOrV3.pyqTrends || rawLegacyOrV3.trends;
  if (!isAlreadyV3 || !Array.isArray(rawTrends)) {
    seedTrends.forEach((t) => {
      if (t && t.id) trendMap.set(t.id, normalizeTrend(t));
    });
  }
  (rawTrends || []).forEach((t) => {
    if (t && t.id) {
      trendMap.set(t.id, normalizeTrend({ ...(trendMap.get(t.id) || {}), ...t }));
    }
  });

  const testSeriesMap = new Map<string, TestSeriesPack>();
  if (!isAlreadyV3 || !Array.isArray(rawLegacyOrV3.testSeries)) {
    (seed.testSeries || []).forEach((ts) =>
      testSeriesMap.set(ts.id, {
        ...ts,
        customizationRules: ts.customizationRules || {
          customizationAllowed: true,
          allowModeSwitch: true,
          allowTimerChange: true,
          allowQuestionCountChange: false,
          allowCategoryFilter: false,
          randomizeQuestions: false,
        },
      })
    );
  }
  (rawLegacyOrV3.testSeries || []).forEach((ts) => {
    if (ts && ts.id) {
      const existing = testSeriesMap.get(ts.id);
      testSeriesMap.set(ts.id, {
        ...(existing || {}),
        ...ts,
        customizationRules: ts.customizationRules ||
          existing?.customizationRules || {
            customizationAllowed: true,
            allowModeSwitch: true,
            allowTimerChange: true,
            allowQuestionCountChange: false,
            allowCategoryFilter: false,
            randomizeQuestions: false,
          },
      });
    }
  });

  const rawSales = Array.isArray(rawLegacyOrV3.salesLog)
    ? rawLegacyOrV3.salesLog
    : Array.isArray(rawLegacyOrV3.salesLogs)
    ? rawLegacyOrV3.salesLogs
    : seed.salesLog || seed.salesLogs || [];
  const normalizedSales = rawSales.filter(Boolean).map(normalizeSale);

  const normalizedTrends = Array.from(trendMap.values());

  const defaultDynamicCategories: DynamicCategoryNode[] = [
    {
      id: 'cat-quant',
      name_en: 'Quantitative Aptitude & Maths',
      name_hi: 'मात्रात्मक अभियोग्यता एवं गणित',
      parentId: null,
      examId: 'ALL',
      subject: 'Quantitative Aptitude',
      order: 1,
      status: 'active',
      createdAt: '2026-10-01',
    },
    {
      id: 'subcat-quant-arith',
      name_en: 'Arithmetic (Percentage, Profit & Loss, SI/CI)',
      name_hi: 'अंकगणित (प्रतिशत, लाभ-हानि, ब्याज)',
      parentId: 'cat-quant',
      examId: 'ALL',
      subject: 'Quantitative Aptitude',
      order: 1,
      status: 'active',
      createdAt: '2026-10-01',
    },
    {
      id: 'subcat-quant-adv',
      name_en: 'Advance Maths (Algebra, Geometry, Trigonometry)',
      name_hi: 'एडवांस मैथ्स (बीजगणित, ज्यामिति, त्रिकोणमिति)',
      parentId: 'cat-quant',
      examId: 'SSC CGL',
      subject: 'Quantitative Aptitude',
      order: 2,
      status: 'active',
      createdAt: '2026-10-01',
    },
    {
      id: 'cat-gs',
      name_en: 'General Studies & Static GK',
      name_hi: 'सामान्य अध्ययन एवं स्टेटिक जीके',
      parentId: null,
      examId: 'ALL',
      subject: 'General Awareness & Static GK',
      order: 2,
      status: 'active',
      createdAt: '2026-10-01',
    },
    {
      id: 'subcat-gs-polity',
      name_en: 'Indian Polity & Constitution',
      name_hi: 'भारतीय राजव्यवस्था एवं संविधान',
      parentId: 'cat-gs',
      examId: 'ALL',
      subject: 'General Awareness & Static GK',
      order: 1,
      status: 'active',
      createdAt: '2026-10-01',
    },
    {
      id: 'subcat-gs-bihar',
      name_en: 'Bihar Special GK & History',
      name_hi: 'बिहार स्पेशल सामान्य ज्ञान एवं इतिहास',
      parentId: 'cat-gs',
      examId: 'BPSC TRE',
      subject: 'Bihar Special & General Studies',
      order: 2,
      status: 'active',
      createdAt: '2026-10-01',
    },
  ];

  const defaultPromotionalOffers: PromotionalOfferItem[] = [
    {
      id: 'promo-universal-2026',
      title_en: 'Zyvra Universal All-Exams Pro Pass — Festive Scholarship Offer',
      title_hi: 'ज़िवरा यूनिवर्सल ऑल-एग्जाम प्रो पास — विशेष छात्रवृत्ति ऑफर',
      description_en:
        'Unlock all SSC, BPSC TRE, BPSC PCS, Bihar Daroga, Railway & UPSC PYQ Mocks, Custom Test Builder, and Bilingual Study PDFs.',
      description_hi:
        'सभी SSC, BPSC TRE, BPSC PCS, बिहार दरोगा, रेलवे और UPSC टेस्ट सीरीज़ व स्टडी नोट्स अनलॉक करें।',
      templateId: 'royal_indigo',
      discountType: 'flat',
      discountValue: 30,
      couponCode: 'SSC30',
      validFrom: '2026-01-01',
      validUntil: '2027-12-31',
      targetDestination: 'pro_modal',
      isActive: true,
      createdAt: '2026-10-01',
    },
  ];

  const defaultSupportConfig: SupportContactConfig = {
    isConfigured: true,
    supportEmail: 'support@zyvra.in',
    helplineNumber: '+91-9876543210',
    whatsappSupport: '919876543210',
    workingHours_en: 'Mon – Sat, 9:00 AM to 7:00 PM IST',
    workingHours_hi: 'सोमवार – शनिवार, सुबह 9:00 से शाम 7:00 बजे तक',
    supportNotice_en:
      'Raise a support ticket below for Pro activation, test question queries, or account sync help. Our academic team replies directly inside your ticket thread.',
    supportNotice_hi:
      'प्रो एक्टिवेशन, प्रश्न संदेह या अकाउंट सिंक सहायता के लिए नीचे सपोर्ट टिकट दर्ज करें।',
  };

  const defaultReferralPolicy: ReferralPolicyConfig = {
    enabled: true,
    commissionType: 'fixed',
    commissionValue: 30,
    qualifyingEvent: 'pro_pass_verified',
    minPayoutThreshold: 90,
    offerStartDate: '2026-01-01',
    offerEndDate: '2027-12-31',
    terms_en:
      'Earn verified commission when an aspirant joins using your referral code and completes a verified Zyvra Pro Pass activation.',
    terms_hi:
      'जब कोई छात्र आपके रेफरल कोड से जुड़कर सत्यापित Zyvra Pro Pass सक्रिय करता है, तो आपको कमीशन मिलता है।',
  };

  return {
    version: '3.0.0-UNIVERSAL',
    schemaVersion: 3,
    lastUpdated: rawLegacyOrV3.lastUpdated || new Date().toISOString(),
    examFamilies: Array.from(familyMap.values()).sort(
      (a, b) => (a.displayOrder ?? a.order ?? 1) - (b.displayOrder ?? b.order ?? 1)
    ),
    exams: Array.from(examMap.values()).sort(
      (a, b) => (a.sortOrder ?? a.order ?? 99) - (b.sortOrder ?? b.order ?? 99)
    ),
    subjects:
      isAlreadyV3 && rawLegacyOrV3.subjects
        ? { ...rawLegacyOrV3.subjects }
        : {
            ...(seed.subjects || {}),
            ...(rawLegacyOrV3.subjects || {}),
          },
    subtopicsMap: {
      ...(seed.subtopicsMap || {}),
      ...(rawLegacyOrV3.subtopicsMap || {}),
    },
    dynamicCategories: Array.isArray(rawLegacyOrV3.dynamicCategories)
      ? rawLegacyOrV3.dynamicCategories
      : defaultDynamicCategories,
    folders: Array.from(folderMap.values()),
    pyqTrends: normalizedTrends,
    trends: normalizedTrends,
    testSeries: Array.from(testSeriesMap.values()),
    questions: Array.from(questionMap.values()),
    notes: Array.from(noteMap.values()),
    flashcards: Array.from(flashcardMap.values()),
    offers: {
      ...seed.offers,
      ...(rawLegacyOrV3.offers || {}),
    },
    promotionalOffers: Array.isArray(rawLegacyOrV3.promotionalOffers)
      ? rawLegacyOrV3.promotionalOffers
      : defaultPromotionalOffers,
    coupons: Array.isArray(rawLegacyOrV3.coupons) ? rawLegacyOrV3.coupons : seed.coupons,
    salesLog: normalizedSales,
    salesLogs: normalizedSales,
    feedbackList: Array.isArray(rawLegacyOrV3.feedbackList) ? rawLegacyOrV3.feedbackList : [],
    supportTickets: Array.isArray(rawLegacyOrV3.supportTickets)
      ? rawLegacyOrV3.supportTickets
      : [],
    supportConfig: rawLegacyOrV3.supportConfig
      ? { ...defaultSupportConfig, ...rawLegacyOrV3.supportConfig }
      : defaultSupportConfig,
    referralPolicy: rawLegacyOrV3.referralPolicy
      ? { ...defaultReferralPolicy, ...rawLegacyOrV3.referralPolicy }
      : defaultReferralPolicy,
    referralAttributions: Array.isArray(rawLegacyOrV3.referralAttributions)
      ? rawLegacyOrV3.referralAttributions
      : [],
    referralCommissions: Array.isArray(rawLegacyOrV3.referralCommissions)
      ? rawLegacyOrV3.referralCommissions
      : [],
    importHistory: Array.isArray(rawLegacyOrV3.importHistory)
      ? rawLegacyOrV3.importHistory
      : seed.importHistory || [],
    syncAuditLogs: Array.isArray(rawLegacyOrV3.syncAuditLogs)
      ? rawLegacyOrV3.syncAuditLogs
      : seed.syncAuditLogs || [],
  };
}

export function loadMasterDatabase(): MasterDatabase {
  try {
    const rawV3 = localStorage.getItem(DB_STORAGE_KEY_V3);
    if (rawV3) {
      const parsedV3 = JSON.parse(rawV3) as Partial<MasterDatabase>;
      return migrateDatabaseToV3(parsedV3);
    }

    const rawLegacyV26 = localStorage.getItem(LEGACY_DB_STORAGE_KEY_V26);
    if (rawLegacyV26) {
      if (!localStorage.getItem(BACKUP_DB_STORAGE_KEY_V26)) {
        localStorage.setItem(BACKUP_DB_STORAGE_KEY_V26, rawLegacyV26);
        writeToIndexedDB(BACKUP_DB_STORAGE_KEY_V26, JSON.parse(rawLegacyV26));
      }
      const parsedLegacy = JSON.parse(rawLegacyV26) as Partial<MasterDatabase>;
      const migrated = migrateDatabaseToV3(parsedLegacy);
      saveMasterDatabase(migrated);
      return migrated;
    }

    const freshDb = migrateDatabaseToV3(INITIAL_MASTER_DATABASE);
    localStorage.setItem(DB_STORAGE_KEY_V3, JSON.stringify(freshDb));
    writeToIndexedDB(DB_STORAGE_KEY_V3, freshDb);
    return freshDb;
  } catch {
    return migrateDatabaseToV3(INITIAL_MASTER_DATABASE);
  }
}

export function saveMasterDatabase(db: MasterDatabase): void {
  try {
    const updated = migrateDatabaseToV3({
      ...db,
      schemaVersion: 3,
      lastUpdated: new Date().toISOString(),
    });
    localStorage.setItem(DB_STORAGE_KEY_V3, JSON.stringify(updated));
    localStorage.setItem(LEGACY_DB_STORAGE_KEY_V26, JSON.stringify(updated));
    writeToIndexedDB(DB_STORAGE_KEY_V3, updated);
  } catch (err) {
    console.error('Failed to save master database:', err);
    writeToIndexedDB(DB_STORAGE_KEY_V3, db);
  }
}

export function loadStudentState(): StudentLocalState {
  const defaultMobile = '9876543210';
  const defaultDeviceId = generateDeviceId(defaultMobile);

  const initialState: StudentLocalState = {
    studentName: 'Zyvra Exam Aspirant',
    mobileNumber: defaultMobile,
    deviceId: defaultDeviceId,
    isProUnlocked: false,
    activatedProKey: '',
    activatedAt: null,
    unlockedExamPacks: ['ALL'],
    recentExamNames: ['SSC CGL', 'BPSC TRE', 'Bihar Daroga'],
    bookmarkedQuestionIds: ['q-quant-1', 'q-gs-1', 'q-bpsc-1'],
    bookmarkedNoteIds: ['note-text-1', 'note-bpsc-special-1'],
    masteredFlashcardIds: [],
    mistakes: {
      'q-quant-4': {
        questionId: 'q-quant-4',
        errorCount: 2,
        lastReason: 'wrong',
        updatedAt: '2026-10-20',
      },
      'q-eng-2': {
        questionId: 'q-eng-2',
        errorCount: 1,
        lastReason: 'skipped',
        updatedAt: '2026-10-20',
      },
    },
    testHistory: [
      {
        id: 'att-demo-1',
        testTitle: 'SSC CGL Tier-1 Official PYQ Mock (14 July Shift-1)',
        exam: 'SSC CGL',
        stage: 'Tier-1',
        paper: 'Paper-1 (CBT)',
        mode: 'exam_hall',
        date: '2026-10-20 18:30',
        totalQuestions: 8,
        attempted: 7,
        correct: 6,
        wrong: 1,
        skipped: 1,
        netScore: 11.5,
        maxScore: 16,
        marksPerCorrect: 2.0,
        negativeMarking: 0.5,
        accuracy: 86,
        avgSecondsPerQuestion: 24,
        normalizedScore: 148.4,
        questionIds: [
          'q-quant-1',
          'q-quant-2',
          'q-reas-1',
          'q-reas-2',
          'q-eng-1',
          'q-gs-1',
          'q-gs-2',
          'q-gs-4',
        ],
        userAnswers: {
          'q-quant-1': 0,
          'q-quant-2': 0,
          'q-reas-1': 0,
          'q-reas-2': 0,
          'q-eng-1': 1,
          'q-gs-1': 0,
          'q-gs-2': 0,
          'q-gs-4': null,
        },
        timeTakenSeconds: 192,
      },
      {
        id: 'att-demo-2',
        testTitle: 'BPSC TRE Primary & Middle Teacher GS Mock (No Negative Marking)',
        exam: 'BPSC TRE',
        stage: 'Primary',
        paper: 'General Studies',
        mode: 'practice',
        date: '2026-10-21 09:15',
        totalQuestions: 2,
        attempted: 2,
        correct: 2,
        wrong: 0,
        skipped: 0,
        netScore: 2.0,
        maxScore: 2.0,
        marksPerCorrect: 1.0,
        negativeMarking: 0.0,
        accuracy: 100,
        avgSecondsPerQuestion: 19,
        normalizedScore: 2.0,
        questionIds: ['q-bpsc-1', 'q-bpsc-2'],
        userAnswers: {
          'q-bpsc-1': 0,
          'q-bpsc-2': 0,
        },
        timeTakenSeconds: 38,
      },
    ],
  };

  try {
    const raw = localStorage.getItem(STUDENT_STATE_KEY);
    if (!raw) {
      localStorage.setItem(STUDENT_STATE_KEY, JSON.stringify(initialState));
      writeToIndexedDB(STUDENT_STATE_KEY, initialState);
      return initialState;
    }
    const parsed = JSON.parse(raw) as StudentLocalState;
    const currentDeviceId = generateDeviceId(parsed.mobileNumber || defaultMobile);
    let verifiedPro = false;
    if (parsed.isProUnlocked && parsed.activatedProKey) {
      const check = verifyProKeyForDevice(currentDeviceId, parsed.activatedProKey);
      verifiedPro = check.valid;
    }

    return {
      ...initialState,
      ...parsed,
      deviceId: currentDeviceId,
      referralCode: parsed.referralCode || generateReferralCode(currentDeviceId),
      isProUnlocked: verifiedPro,
      recentExamNames:
        Array.isArray(parsed.recentExamNames) && parsed.recentExamNames.length > 0
          ? parsed.recentExamNames
          : initialState.recentExamNames,
    };
  } catch {
    return {
      ...initialState,
      referralCode: generateReferralCode(defaultDeviceId),
    };
  }
}

export function saveStudentState(state: StudentLocalState): void {
  try {
    localStorage.setItem(STUDENT_STATE_KEY, JSON.stringify(state));
    writeToIndexedDB(STUDENT_STATE_KEY, state);
  } catch (err) {
    console.error('Failed to save student state:', err);
    writeToIndexedDB(STUDENT_STATE_KEY, state);
  }
}

export function loadGitHubSyncConfig(): GitHubSyncConfig {
  const fallback: GitHubSyncConfig = {
    repo: 'zyvra-official/zyvra-master-db',
    branch: 'main',
    filePath: 'database.json',
    pat: '',
    lastSyncedAt: null,
  };
  try {
    const raw = localStorage.getItem(GITHUB_SYNC_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function saveGitHubSyncConfig(cfg: GitHubSyncConfig): void {
  localStorage.setItem(GITHUB_SYNC_KEY, JSON.stringify(cfg));
}

export function loadThemeMode(): 'dark' | 'light' {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return saved === 'light' ? 'light' : 'dark';
}

export function saveThemeMode(mode: 'dark' | 'light'): void {
  localStorage.setItem(THEME_STORAGE_KEY, mode);
}

export function createSyncAuditEntry(
  action: SyncAuditLog['action'],
  status: SyncAuditLog['status'],
  summary: string,
  db: MasterDatabase
): SyncAuditLog {
  return {
    id: `sync-${Date.now()}`,
    timestamp: new Date().toLocaleString('en-IN'),
    action,
    status,
    summary,
    examsCount: (db.exams || []).length,
    questionsCount: (db.questions || []).length,
    notesCount: (db.notes || []).length,
  };
}

/**
 * Direct In-App GitHub Cloud Sync via GitHub REST API
 * PUT /repos/{owner}/{repo}/contents/{path}
 */
export async function pushDatabaseToGitHub(
  config: GitHubSyncConfig,
  db: MasterDatabase
): Promise<{ ok: boolean; message: string }> {
  const cleanRepo = config.repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
  const branch = config.branch.trim() || 'main';
  const filePath = config.filePath.trim().replace(/^\//, '') || 'database.json';
  const pat = config.pat.trim();

  if (!cleanRepo.includes('/') || !pat) {
    return {
      ok: false,
      message:
        'Please enter a valid GitHub "owner/repo" and Personal Access Token (PAT) to push live to GitHub Cloud.',
    };
  }

  const apiUrl = `https://api.github.com/repos/${cleanRepo}/contents/${filePath}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${pat}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  try {
    let existingSha: string | undefined;
    const getRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, {
      method: 'GET',
      headers,
    });
    if (getRes.ok) {
      const existingData = await getRes.json();
      existingSha = existingData.sha;
    }

    const jsonString = JSON.stringify(db, null, 2);
    const utf8Bytes = new TextEncoder().encode(jsonString);
    let binaryStr = '';
    for (let i = 0; i < utf8Bytes.length; i++) {
      binaryStr += String.fromCharCode(utf8Bytes[i]);
    }
    const base64Content = btoa(binaryStr);

    const putBody: Record<string, unknown> = {
      message: `Sync Universal Exam Prep DB v3 (${db.exams.length} Exams, ${db.questions.length} Qs, ${db.notes.length} Notes) — ${new Date().toISOString()}`,
      content: base64Content,
      branch,
    };
    if (existingSha) {
      putBody.sha = existingSha;
    }

    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(putBody),
    });

    if (!putRes.ok) {
      const errBody = await putRes.json().catch(() => ({}));
      return {
        ok: false,
        message: `GitHub API Error (${putRes.status}): ${errBody.message || putRes.statusText}`,
      };
    }

    return {
      ok: true,
      message: `Successfully published database.json (${db.exams.length} Exams, ${db.questions.length} Questions, ${db.notes.length} Notes) to ${cleanRepo}@${branch}!`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error';
    return {
      ok: false,
      message: `GitHub Cloud Sync failed: ${msg}`,
    };
  }
}

/**
 * Syncs an uploaded PDF file directly to GitHub `/pdfs/<filename>.pdf` when GitHub PAT is configured
 */
export async function uploadPdfToGitHubRepo(
  config: GitHubSyncConfig,
  fileName: string,
  base64DataUrl: string
): Promise<{ ok: boolean; remoteUrl?: string; message: string }> {
  const cleanRepo = config.repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
  const branch = config.branch.trim() || 'main';
  const pat = config.pat.trim();

  if (!cleanRepo.includes('/') || !pat) {
    return {
      ok: false,
      message:
        'Stored locally in Offline DB (configure GitHub PAT in Cloud Sync tab to also push to /pdfs/ on GitHub).',
    };
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const pdfPath = `pdfs/${safeName}`;
  const apiUrl = `https://api.github.com/repos/${cleanRepo}/contents/${pdfPath}`;
  const base64Clean = base64DataUrl.includes(',')
    ? base64DataUrl.split(',')[1]
    : base64DataUrl;

  try {
    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${pat}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `Upload study PDF ${safeName}`,
        content: base64Clean,
        branch,
      }),
    });

    if (!putRes.ok) {
      return { ok: false, message: 'Saved PDF locally; GitHub /pdfs/ upload skipped.' };
    }
    const data = await putRes.json();
    return {
      ok: true,
      remoteUrl: data?.content?.download_url || base64DataUrl,
      message: `Synced ${safeName} to GitHub /pdfs/ directory!`,
    };
  } catch {
    return { ok: false, message: 'Saved PDF locally in IndexedDB.' };
  }
}

export async function pullDatabaseFromGitHub(
  config: GitHubSyncConfig
): Promise<{ ok: boolean; db?: MasterDatabase; message: string }> {
  const cleanRepo = config.repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
  const branch = config.branch.trim() || 'main';
  const filePath = config.filePath.trim().replace(/^\//, '') || 'database.json';
  const pat = config.pat.trim();

  if (!cleanRepo.includes('/')) {
    return { ok: false, message: 'Enter a valid GitHub "owner/repo" first.' };
  }

  const apiUrl = `https://api.github.com/repos/${cleanRepo}/contents/${filePath}?ref=${encodeURIComponent(
    branch
  )}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.raw+json',
  };
  if (pat) {
    headers.Authorization = `Bearer ${pat}`;
  }

  try {
    const res = await fetch(apiUrl, { headers });
    if (!res.ok) {
      return {
        ok: false,
        message: `Could not fetch ${filePath} from ${cleanRepo} (${res.status}).`,
      };
    }
    const remoteRaw = (await res.json()) as Partial<MasterDatabase>;
    if (!remoteRaw || !Array.isArray(remoteRaw.questions)) {
      return { ok: false, message: 'Remote file is not a valid MasterDatabase JSON schema.' };
    }
    const migratedRemote = migrateDatabaseToV3(remoteRaw);
    return {
      ok: true,
      db: migratedRemote,
      message: `Pulled and validated ${migratedRemote.exams.length} exams, ${migratedRemote.questions.length} questions, and ${migratedRemote.notes.length} notes from GitHub Cloud!`,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      message: `Failed to pull from GitHub: ${
        err instanceof Error ? err.message : 'Unknown error'
      }`,
    };
  }
}

// ============================================================================
// REAL CLOUD SYNC, TRANSLATION, FEEDBACK, SUPPORT & REFERRAL API CLIENT
// Supports same-origin `/api/*` backend OR configured `VITE_API_BASE_URL`
// with automatic offline queue and retry.
// ============================================================================

export function resolveApiBaseUrl(): string {
  const envUrl =
    (typeof import.meta !== 'undefined' &&
      (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE_URL) ||
    '';
  return envUrl.trim().replace(/\/$/, '');
}

export function getAdminAuthHeaders(): Record<string, string> {
  const sess = getActiveAdminSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (sess?.token) {
    headers['Authorization'] = `Bearer ${sess.token}`;
  }
  return headers;
}

export interface OfflineQueueItem {
  id: string;
  endpoint: string;
  method: 'POST' | 'PUT' | 'PATCH';
  payload: unknown;
  createdAt: number;
}

export function getOfflineSyncQueue(): OfflineQueueItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(OFFLINE_SYNC_QUEUE_KEY);
    return raw ? (JSON.parse(raw) as OfflineQueueItem[]) : [];
  } catch {
    return [];
  }
}

export function enqueueOfflineSyncItem(
  itemOrType:
    | Omit<OfflineQueueItem, 'id' | 'createdAt'>
    | 'student_state'
    | 'master_db'
    | 'feedback'
    | 'ticket',
  optionalPayload?: unknown
): void {
  if (typeof window === 'undefined') return;
  try {
    let item: Omit<OfflineQueueItem, 'id' | 'createdAt'>;
    if (typeof itemOrType === 'string') {
      const endpointMap: Record<string, { endpoint: string; method: 'POST' | 'PUT' }> = {
        student_state: { endpoint: '/api/sync/student', method: 'POST' },
        master_db: { endpoint: '/api/sync/master', method: 'PUT' },
        feedback: { endpoint: '/api/feedback', method: 'POST' },
        ticket: { endpoint: '/api/support/tickets', method: 'POST' },
      };
      const cfg = endpointMap[itemOrType] || { endpoint: '/api/sync/student', method: 'POST' };
      item = {
        endpoint: cfg.endpoint,
        method: cfg.method,
        payload:
          itemOrType === 'student_state'
            ? {
                deviceId: (optionalPayload as StudentLocalState)?.deviceId,
                mobileNumber: (optionalPayload as StudentLocalState)?.mobileNumber,
                studentState: optionalPayload,
              }
            : optionalPayload,
      };
    } else {
      item = itemOrType;
    }

    const queue = getOfflineSyncQueue();
    const filtered = queue.filter(
      (q) => !(q.endpoint === item.endpoint && q.method === item.method)
    );
    filtered.push({
      ...item,
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now(),
    });
    localStorage.setItem(OFFLINE_SYNC_QUEUE_KEY, JSON.stringify(filtered.slice(-30)));
  } catch {
    // Ignore storage errors
  }
}

export async function flushOfflineSyncQueue(): Promise<{
  flushed: number;
  remaining: number;
}> {
  const queue = getOfflineSyncQueue();
  if (queue.length === 0) return { flushed: 0, remaining: 0 };

  const base = resolveApiBaseUrl();
  const remainingItems: OfflineQueueItem[] = [];
  let flushed = 0;

  for (const item of queue) {
    try {
      const res = await fetch(`${base}${item.endpoint}`, {
        method: item.method,
        headers: getAdminAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(item.payload),
      });
      if (res.ok || res.status === 400 || res.status === 409) {
        flushed += 1;
      } else {
        remainingItems.push(item);
      }
    } catch {
      remainingItems.push(item);
    }
  }

  if (typeof window !== 'undefined') {
    localStorage.setItem(OFFLINE_SYNC_QUEUE_KEY, JSON.stringify(remainingItems));
  }
  return { flushed, remaining: remainingItems.length };
}

/**
 * Synchronizes both MasterDatabase and StudentLocalState with the backend server (`/api/sync/*`).
 * Merges student testHistory, bookmarks, and mistakes non-destructively across devices.
 */
export async function syncWithCloudBackend(
  providedStudent?: StudentLocalState
): Promise<{
  ok: boolean;
  status: 'synced' | 'pending' | 'failed';
  db: MasterDatabase;
  student: StudentLocalState;
  masterDb?: MasterDatabase;
  studentState?: StudentLocalState;
  syncedAt?: string;
  message: string;
}> {
  const currentStudent = providedStudent || loadStudentState();
  const localDb = loadMasterDatabase();
  const base = resolveApiBaseUrl();
  try {
    await flushOfflineSyncQueue();

    // 1. Push latest student state (idempotent merge on backend)
    const pushRes = await fetch(`${base}/api/sync/student`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        deviceId: currentStudent.deviceId,
        mobileNumber: currentStudent.mobileNumber,
        studentState: currentStudent,
      }),
    });

    // 2. Pull authoritative bootstrap state
    const pullRes = await fetch(
      `${base}/api/sync/bootstrap?deviceId=${encodeURIComponent(
        currentStudent.deviceId
      )}&mobile=${encodeURIComponent(currentStudent.mobileNumber || '')}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
      }
    );

    if (!pullRes.ok) {
      throw new Error(`HTTP ${pullRes.status}`);
    }

    const data = await pullRes.json();
    const syncedAt = data.syncedAt || new Date().toISOString();
    const remoteMaster = data.masterDb
      ? migrateDatabaseToV3(data.masterDb)
      : localDb;

    let mergedStudent: StudentLocalState = {
      ...currentStudent,
      syncStatus: 'synced',
      lastSyncedAt: syncedAt,
      lastCloudSyncedAt: syncedAt,
    };

    if (data.studentState) {
      const rem = data.studentState as StudentLocalState;
      const attemptMap = new Map<string, StudentLocalState['testHistory'][0]>();
      (rem.testHistory || []).forEach((a) => attemptMap.set(a.id, a));
      (currentStudent.testHistory || []).forEach((a) => attemptMap.set(a.id, a));

      mergedStudent = {
        ...currentStudent,
        ...rem,
        deviceId: currentStudent.deviceId,
        referralCode:
          rem.referralCode ||
          currentStudent.referralCode ||
          generateReferralCode(currentStudent.deviceId),
        isProUnlocked: Boolean(currentStudent.isProUnlocked || rem.isProUnlocked),
        bookmarkedQuestionIds: Array.from(
          new Set([
            ...(rem.bookmarkedQuestionIds || []),
            ...(currentStudent.bookmarkedQuestionIds || []),
          ])
        ),
        bookmarkedNoteIds: Array.from(
          new Set([
            ...(rem.bookmarkedNoteIds || []),
            ...(currentStudent.bookmarkedNoteIds || []),
          ])
        ),
        masteredFlashcardIds: Array.from(
          new Set([
            ...(rem.masteredFlashcardIds || []),
            ...(currentStudent.masteredFlashcardIds || []),
          ])
        ),
        mistakes: {
          ...(rem.mistakes || {}),
          ...(currentStudent.mistakes || {}),
        },
        testHistory: Array.from(attemptMap.values()),
        syncStatus: 'synced',
        lastSyncedAt: syncedAt,
        lastCloudSyncedAt: syncedAt,
      };
      saveStudentState(mergedStudent);
    }

    if (remoteMaster) {
      saveMasterDatabase(remoteMaster);
    }

    return {
      ok: pushRes.ok && pullRes.ok,
      status: 'synced',
      db: remoteMaster,
      student: mergedStudent,
      masterDb: remoteMaster,
      studentState: mergedStudent,
      syncedAt,
      message: 'Cloud Sync completed.',
    };
  } catch {
    enqueueOfflineSyncItem({
      endpoint: '/api/sync/student',
      method: 'POST',
      payload: {
        deviceId: currentStudent.deviceId,
        mobileNumber: currentStudent.mobileNumber,
        studentState: currentStudent,
      },
    });
    const fallbackStatus = getOfflineSyncQueue().length > 0 ? 'pending' : 'failed';
    const fallbackStudent: StudentLocalState = {
      ...currentStudent,
      syncStatus: fallbackStatus,
    };
    return {
      ok: false,
      status: fallbackStatus,
      db: localDb,
      student: fallbackStudent,
      masterDb: localDb,
      studentState: fallbackStudent,
      message: 'Offline / server unreachable — changes queued for automatic sync.',
    };
  }
}

export async function pushMasterDatabaseToCloudBackend(
  updatedDb: MasterDatabase
): Promise<{ ok: boolean; status: 'synced' | 'pending' | 'failed'; message: string }> {
  const base = resolveApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/sync/master`, {
      method: 'PUT',
      headers: getAdminAuthHeaders(),
      credentials: 'include',
      body: JSON.stringify({ masterDb: updatedDb }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return {
        ok: false,
        status: 'failed',
        message: err.error || `Server sync failed (${res.status})`,
      };
    }
    return {
      ok: true,
      status: 'synced',
      message: 'Master database synced to Cloud Server.',
    };
  } catch {
    enqueueOfflineSyncItem({
      endpoint: '/api/sync/master',
      method: 'PUT',
      payload: { masterDb: updatedDb },
    });
    return {
      ok: false,
      status: 'pending',
      message: 'Saved locally & queued for Cloud Sync.',
    };
  }
}

/**
 * Translates a question statement, options, and explanation into the target language
 * using the server-side translation endpoint (`/api/translate`) with local cache
 * and verified bilingual fallback. Never alters question ID, answer selection, or scoring.
 */
export interface TranslatedQuestionPayload {
  targetLang: string;
  targetLangLabel: string;
  questionText: string;
  options: string[];
  explanation?: string;
  basicExplanation: string;
  trickExplanation: string;
  provider: 'verified_bilingual' | 'cloud_ai' | 'offline_dictionary';
}

export async function translateQuestionContent(
  qOrInput:
    | Question
    | {
        question: Question;
        targetLanguage: 'hi' | 'en' | 'bn' | 'mr' | 'ta' | 'te' | 'ur';
      },
  maybeTargetLang?: 'hi' | 'en' | 'bn' | 'mr' | 'ta' | 'te' | 'ur'
): Promise<{
  ok: boolean;
  questionText: string;
  options: string[];
  explanation: string;
  provider: string;
  data?: TranslatedQuestionPayload;
  error?: string;
}> {
  const q: Question = 'question' in qOrInput ? qOrInput.question : qOrInput;
  const targetLang: 'hi' | 'en' | 'bn' | 'mr' | 'ta' | 'te' | 'ur' =
    ('targetLanguage' in qOrInput ? qOrInput.targetLanguage : maybeTargetLang) || 'hi';

  const langLabels: Record<string, string> = {
    hi: 'हिन्दी (Hindi)',
    en: 'English',
    bn: 'বাংলা (Bengali)',
    mr: 'मराठी (Marathi)',
    ta: 'தமிழ் (Tamil)',
    te: 'తెలుగు (Telugu)',
    ur: 'اردو (Urdu)',
  };

  // Fast path 1: Verified built-in Hindi / English
  if (targetLang === 'hi' && q.question_hi && q.question_hi !== q.question_en) {
    const opts =
      Array.isArray(q.options_hi) && q.options_hi.length === 4
        ? q.options_hi
        : q.options_en;
    const exp = q.basic_hi || q.basic_en || '';
    const data: TranslatedQuestionPayload = {
      targetLang: 'hi',
      targetLangLabel: langLabels.hi,
      questionText: q.question_hi,
      options: opts,
      explanation: exp,
      basicExplanation: exp,
      trickExplanation: q.trick_hi || q.trick_en,
      provider: 'verified_bilingual',
    };
    return {
      ok: true,
      questionText: data.questionText,
      options: data.options,
      explanation: exp,
      provider: data.provider,
      data,
    };
  }
  if (targetLang === 'en' && q.question_en) {
    const exp = q.basic_en || '';
    const data: TranslatedQuestionPayload = {
      targetLang: 'en',
      targetLangLabel: langLabels.en,
      questionText: q.question_en,
      options: q.options_en,
      explanation: exp,
      basicExplanation: exp,
      trickExplanation: q.trick_en,
      provider: 'verified_bilingual',
    };
    return {
      ok: true,
      questionText: data.questionText,
      options: data.options,
      explanation: exp,
      provider: data.provider,
      data,
    };
  }

  // Fast path 2: Check local translation cache
  const cacheKey = `${q.id}::${targetLang}`;
  if (typeof window !== 'undefined') {
    try {
      const rawCache = localStorage.getItem(TRANSLATION_CACHE_KEY);
      if (rawCache) {
        const parsedCache = JSON.parse(rawCache) as Record<string, TranslatedQuestionPayload>;
        if (parsedCache[cacheKey]) {
          const cached = parsedCache[cacheKey];
          return {
            ok: true,
            questionText: cached.questionText,
            options: cached.options,
            explanation: cached.explanation || cached.basicExplanation || '',
            provider: cached.provider,
            data: cached,
          };
        }
      }
    } catch {
      // Ignore cache read error
    }
  }

  // Path 3: Call backend `/api/translate`
  const base = resolveApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questionId: q.id,
        targetLang,
        question_en: q.question_en,
        question_hi: q.question_hi,
        options_en: q.options_en,
        options_hi: q.options_hi,
        basic_en: q.basic_en,
        basic_hi: q.basic_hi,
        trick_en: q.trick_en,
        trick_hi: q.trick_hi,
      }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const fallbackText = targetLang === 'hi' ? q.question_hi || q.question_en : q.question_en;
      const fallbackOpts = targetLang === 'hi' ? q.options_hi || q.options_en : q.options_en;
      const fallbackExp = targetLang === 'hi' ? q.basic_hi || q.basic_en : q.basic_en;
      return {
        ok: false,
        questionText: fallbackText,
        options: fallbackOpts,
        explanation: fallbackExp,
        provider: 'verified_bilingual',
        error:
          errData.error ||
          `Translation service returned HTTP ${res.status}. Showing verified bilingual content.`,
      };
    }
    const payload = (await res.json()) as {
      ok: boolean;
      data?: TranslatedQuestionPayload;
      error?: string;
    };
    const resolvedData: TranslatedQuestionPayload = payload.data || {
      targetLang,
      targetLangLabel: langLabels[targetLang] || targetLang,
      questionText: q.question_hi || q.question_en,
      options: q.options_hi || q.options_en,
      explanation: q.basic_hi || q.basic_en,
      basicExplanation: q.basic_hi || q.basic_en,
      trickExplanation: q.trick_hi || q.trick_en,
      provider: 'offline_dictionary',
    };
    if (payload.ok && payload.data && typeof window !== 'undefined') {
      try {
        const rawCache = localStorage.getItem(TRANSLATION_CACHE_KEY);
        const parsedCache = rawCache ? JSON.parse(rawCache) : {};
        parsedCache[cacheKey] = resolvedData;
        localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(parsedCache));
      } catch {
        // Ignore
      }
    }
    return {
      ok: payload.ok,
      questionText: resolvedData.questionText,
      options: resolvedData.options,
      explanation: resolvedData.explanation || resolvedData.basicExplanation || '',
      provider: resolvedData.provider,
      data: resolvedData,
      error: payload.error,
    };
  } catch {
    const fallbackText = q.question_hi || q.question_en;
    const fallbackOpts = q.options_hi || q.options_en;
    const fallbackExp = q.basic_hi || q.basic_en;
    return {
      ok: true,
      questionText: fallbackText,
      options: fallbackOpts,
      explanation: fallbackExp,
      provider: 'verified_bilingual',
    };
  }
}

