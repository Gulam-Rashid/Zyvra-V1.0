import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Cloud,
  Copy,
  Database,
  Download,
  Edit3,
  FileSpreadsheet,
  FileText,
  FolderPlus,
  KeyRound,
  Layers,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  Tag,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  CouponCode,
  CustomFolder,
  ExamCategory,
  ExamFamily,
  ExamStageConfig,
  GitHubSyncConfig,
  ImportBatchHistory,
  MasterDatabase,
  Question,
  QuestionExamMapping,
  QuestionSourceClassification,
  StudentSaleLog,
  StudyNote,
  TestSeriesPack,
} from '../types/database';
import {
  AdminSession,
  clearAdminSession,
  DEFAULT_ADMIN_LOGIN_ID,
  generateProKey,
  getActiveAdminSession,
  saveAdminSession,
  setLocalAdminPasscode,
  verifyLocalAdminPasscode,
} from '../utils/cryptoLock';
import {
  computeQuestionFingerprint,
  createSyncAuditEntry,
  loadGitHubSyncConfig,
  pullDatabaseFromGitHub,
  pushDatabaseToGitHub,
  saveGitHubSyncConfig,
  uploadPdfToGitHubRepo,
} from '../utils/storage';
import { ZyvraLogo } from './ZyvraLogo';

interface AdminControlCenterProps {
  db: MasterDatabase;
  theme: 'dark' | 'light';
  onUpdateDatabase: (updated: MasterDatabase) => void;
  onClose: () => void;
}

type AdminSection =
  | 'overview'
  | 'exams'
  | 'subjects'
  | 'questions'
  | 'import'
  | 'tests'
  | 'notes'
  | 'students'
  | 'pricing'
  | 'sync';

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export const AdminControlCenter: React.FC<AdminControlCenterProps> = ({
  db,
  theme,
  onUpdateDatabase,
  onClose,
}) => {
  const isDark = theme === 'dark';

  // Admin Session & Login State (Login ID: Sajiya@8800)
  const [adminSession, setAdminSession] = useState<AdminSession | null>(() =>
    getActiveAdminSession()
  );
  const [loginIdInput, setLoginIdInput] = useState(DEFAULT_ADMIN_LOGIN_ID);
  const [passcodeInput, setPasscodeInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [loginBusy, setLoginBusy] = useState(false);

  // Passcode Update State inside Security Tab
  const [newAdminPasscode, setNewAdminPasscode] = useState('');

  // Navigation & Status
  const [activeSection, setActiveSection] = useState<AdminSection>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    label: string;
    onConfirm: () => void;
  } | null>(null);

  const notify = (text: string, ok = true) => {
    setToast({ ok, text });
    window.setTimeout(() => setToast(null), 4000);
  };

  // ============================================================================
  // 1. EXAM & CATEGORY MANAGER STATE
  // ============================================================================
  const [famNameEn, setFamNameEn] = useState('');
  const [famNameHi, setFamNameHi] = useState('');
  const [famDesc, setFamDesc] = useState('');

  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [examName, setExamName] = useState('');
  const [examNameHi, setExamNameHi] = useState('');
  const [examShortCode, setExamShortCode] = useState('');
  const [examFamilyId, setExamFamilyId] = useState(db.examFamilies[0]?.id || 'fam-ssc');
  const [examAuthority, setExamAuthority] = useState('');
  const [examBadge, setExamBadge] = useState('Official Exam');
  const [examLevel, setExamLevel] = useState<'Central' | 'State' | 'District' | 'Other'>('Central');
  const [examMarksCorrect, setExamMarksCorrect] = useState('2.0');
  const [examNegMarks, setExamNegMarks] = useState('0.50');
  const [examDuration, setExamDuration] = useState('60');
  const [examStagesText, setExamStagesText] = useState('Tier-1, Tier-2');
  const [examAccessType, setExamAccessType] = useState<'free' | 'pro'>('free');

  // ============================================================================
  // 2. SUBJECTS & CHAPTERS STATE
  // ============================================================================
  const [selectedSubjectKey, setSelectedSubjectKey] = useState<string>(
    Object.keys(db.subjects || {})[0] || 'General Awareness & Static GK'
  );
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newChapterName, setNewChapterName] = useState('');
  const [targetExamForSubject, setTargetExamForSubject] = useState<string>(
    db.exams[0]?.name || 'SSC CGL'
  );

  // ============================================================================
  // 3. QUESTION BANK & VISUAL EDITOR STATE
  // ============================================================================
  const [qSearch, setQSearch] = useState('');
  const [qFilterExam, setQFilterExam] = useState('ALL');
  const [qFilterSubject, setQFilterSubject] = useState('ALL');
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);

  const [qExam, setQExam] = useState(db.exams[0]?.name || 'SSC CGL');
  const [qStage, setQStage] = useState('Tier-1');
  const [qSubject, setQSubject] = useState('Quantitative Aptitude');
  const [qTopic, setQTopic] = useState('Percentage');
  const [qFolderId, setQFolderId] = useState(db.folders[0]?.id || 'folder-cgl-pyq');
  const [qPyqTag, setQPyqTag] = useState('Official PYQ — Shift-1');
  const [qDifficulty, setQDifficulty] = useState<'Easy' | 'Moderate' | 'Hard'>('Moderate');
  const [qSourceClass, setQSourceClass] =
    useState<QuestionSourceClassification>('verified_pyq');
  const [qIsPro, setQIsPro] = useState(false);
  const [qEn, setQEn] = useState('');
  const [qHi, setQHi] = useState('');
  const [optEn0, setOptEn0] = useState('');
  const [optEn1, setOptEn1] = useState('');
  const [optEn2, setOptEn2] = useState('');
  const [optEn3, setOptEn3] = useState('');
  const [optHi0, setOptHi0] = useState('');
  const [optHi1, setOptHi1] = useState('');
  const [optHi2, setOptHi2] = useState('');
  const [optHi3, setOptHi3] = useState('');
  const [qCorrectIdx, setQCorrectIdx] = useState(0);
  const [qBasicEn, setQBasicEn] = useState('');
  const [qBasicHi, setQBasicHi] = useState('');
  const [qTrickEn, setQTrickEn] = useState('');
  const [qTrickHi, setQTrickHi] = useState('');
  const [qExtraExamIds, setQExtraExamIds] = useState<string[]>([]);

  // ============================================================================
  // 4. IMPORT & EXPORT STATE (JSON + CSV)
  // ============================================================================
  const [aiPromptExam, setAiPromptExam] = useState(db.exams[0]?.name || 'SSC CGL');
  const [aiPromptSubject, setAiPromptSubject] = useState('General Studies');
  const [aiPromptCount, setAiPromptCount] = useState('10');
  const [importFormat, setImportFormat] = useState<'json' | 'csv'>('json');
  const [bulkInputText, setBulkInputText] = useState('');
  const [dryRunResult, setDryRunResult] = useState<{
    validQuestions: Question[];
    duplicateCount: number;
    errors: string[];
  } | null>(null);

  // ============================================================================
  // 5. TESTS & FOLDERS STATE
  // ============================================================================
  const [folderNameEn, setFolderNameEn] = useState('');
  const [folderNameHi, setFolderNameHi] = useState('');
  const [folderType, setFolderType] = useState<'test' | 'note'>('test');
  const [folderExam, setFolderExam] = useState(db.exams[0]?.name || 'SSC CGL');
  const [folderSubject, setFolderSubject] = useState('All Subjects');
  const [folderIsPro, setFolderIsPro] = useState(false);

  const [packTitleEn, setPackTitleEn] = useState('');
  const [packTitleHi, setPackTitleHi] = useState('');
  const [packExam, setPackExam] = useState(db.exams[0]?.name || 'SSC CGL');
  const [packDuration, setPackDuration] = useState('30');
  const [packMarksCorrect, setPackMarksCorrect] = useState('2.0');
  const [packNegMarks, setPackNegMarks] = useState('0.50');
  const [packShiftTag, setPackShiftTag] = useState('Official Paper Set');
  const [packIsPro, setPackIsPro] = useState(false);

  // ============================================================================
  // 6. NOTES & PDFS STATE
  // ============================================================================
  const [noteTitleEn, setNoteTitleEn] = useState('');
  const [noteTitleHi, setNoteTitleHi] = useState('');
  const [noteType, setNoteType] = useState<'text' | 'pdf'>('text');
  const [noteExam, setNoteExam] = useState(db.exams[0]?.name || 'SSC CGL');
  const [noteSubject, setNoteSubject] = useState('General Awareness & Static GK');
  const [noteTopic, setNoteTopic] = useState('Important Revision Sheet');
  const [noteFolderId, setNoteFolderId] = useState(
    db.folders.find((f) => f.type === 'note')?.id || db.folders[0]?.id || 'folder-notes'
  );
  const [noteContentEn, setNoteContentEn] = useState('');
  const [noteContentHi, setNoteContentHi] = useState('');
  const [notePdfDataUrl, setNotePdfDataUrl] = useState('');
  const [notePdfFileName, setNotePdfFileName] = useState('');
  const [noteAllowDownload, setNoteAllowDownload] = useState(false);
  const [noteIsPro, setNoteIsPro] = useState(false);

  // ============================================================================
  // 7. STUDENTS & PRO KEY GENERATOR STATE
  // ============================================================================
  const [genStudentName, setGenStudentName] = useState('');
  const [genMobile, setGenMobile] = useState('');
  const [genDeviceId, setGenDeviceId] = useState('');
  const [genUtr, setGenUtr] = useState('');
  const [genAmount, setGenAmount] = useState(String(db.offers.offerPrice || 149));
  const [genScope, setGenScope] = useState('Universal All-Exams Pro');
  const [generatedKeyOutput, setGeneratedKeyOutput] = useState('');

  // ============================================================================
  // 8. PRICING & COUPONS STATE
  // ============================================================================
  const [offerForm, setOfferForm] = useState({ ...db.offers });
  const [newCouponCode, setNewCouponCode] = useState('');
  const [newCouponType, setNewCouponType] = useState<'flat' | 'percent'>('flat');
  const [newCouponValue, setNewCouponValue] = useState('30');
  const [newCouponTag, setNewCouponTag] = useState('Educator Campaign');

  // ============================================================================
  // 9. CLOUD SYNC STATE
  // ============================================================================
  const [ghConfig, setGhConfig] = useState<GitHubSyncConfig>(() => loadGitHubSyncConfig());
  const [syncBusy, setSyncBusy] = useState(false);

  const apiBaseUrl =
    (typeof import.meta !== 'undefined' &&
      (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE_URL) ||
    '';

  // Filtered Question Bank
  const filteredQuestions = useMemo(() => {
    return (db.questions || []).filter((q) => {
      if (q.status === 'archived') return false;
      const matchesExam =
        qFilterExam === 'ALL' ||
        q.exam === qFilterExam ||
        (q.examMappings || []).some((m) => m.examId === qFilterExam || m.examName === qFilterExam);
      const matchesSub = qFilterSubject === 'ALL' || q.subject === qFilterSubject;
      const qStr = `${q.question_en} ${q.question_hi} ${q.topic} ${q.pyqTag}`.toLowerCase();
      const matchesSearch = !qSearch.trim() || qStr.includes(qSearch.trim().toLowerCase());
      return matchesExam && matchesSub && matchesSearch;
    });
  }, [db.questions, qFilterExam, qFilterSubject, qSearch]);

  // ============================================================================
  // ADMIN AUTHENTICATION HANDLERS (Login ID: Sajiya@8800)
  // ============================================================================
  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (failedAttempts >= 5) {
      setLoginError('Too many failed login attempts. Please close and reopen the Admin dialog.');
      return;
    }

    setLoginBusy(true);
    setLoginError('');

    // Path 1: Production Backend Authentication when VITE_API_BASE_URL is configured
    if (apiBaseUrl.trim()) {
      try {
        const res = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/admin/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loginId: loginIdInput.trim(),
            password: passcodeInput,
          }),
        });
        if (!res.ok) {
          setFailedAttempts((c) => c + 1);
          setLoginError('Backend authentication failed: Invalid credentials.');
          setLoginBusy(false);
          return;
        }
        const data = await res.json();
        const session: AdminSession = {
          loginId: loginIdInput.trim(),
          mode: 'backend_jwt',
          token: data.token,
          authenticatedAt: new Date().toLocaleTimeString('en-IN'),
          expiresAt: Date.now() + 4 * 60 * 60 * 1000,
        };
        saveAdminSession(session);
        setAdminSession(session);
        setPasscodeInput('');
        setLoginBusy(false);
        return;
      } catch {
        setLoginError('Could not reach Backend Auth Server. Check VITE_API_BASE_URL.');
        setLoginBusy(false);
        return;
      }
    }

    // Path 2: Local Demonstration Mode (for Static / GitHub Pages use)
    const check = verifyLocalAdminPasscode(
      loginIdInput,
      passcodeInput,
      db.offers.adminPin || '2026'
    );
    setLoginBusy(false);

    if (!check.ok) {
      setFailedAttempts((c) => c + 1);
      setLoginError(check.error || 'Authentication failed.');
      return;
    }

    const session: AdminSession = {
      loginId: loginIdInput.trim(),
      mode: 'local_demo',
      authenticatedAt: new Date().toLocaleTimeString('en-IN'),
      expiresAt: Date.now() + 4 * 60 * 60 * 1000,
    };
    saveAdminSession(session);
    setAdminSession(session);
    setPasscodeInput('');
  };

  const handleAdminLogout = () => {
    clearAdminSession();
    setAdminSession(null);
    setPasscodeInput('');
  };

  // ============================================================================
  // CONTENT HANDLERS
  // ============================================================================
  const handleAddFamily = () => {
    if (!famNameEn.trim()) {
      notify('Enter an Exam Family name first.', false);
      return;
    }
    const newFam: ExamFamily = {
      id: `fam-${Date.now()}`,
      name: famNameEn.trim(),
      name_hi: famNameHi.trim() || famNameEn.trim(),
      description: famDesc.trim() || 'Competitive Examination Category',
      icon: 'Layers',
      color: 'indigo',
      displayOrder: db.examFamilies.length + 1,
      isActive: true,
    };
    onUpdateDatabase({
      ...db,
      examFamilies: [...db.examFamilies, newFam],
    });
    setFamNameEn('');
    setFamNameHi('');
    setFamDesc('');
    notify(`Exam Family "${newFam.name}" added.`);
  };

  const handleSaveExam = () => {
    if (!examName.trim()) {
      notify('Please enter an Exam Name.', false);
      return;
    }
    const parsedCorrect = parseFloat(examMarksCorrect) || 2.0;
    const parsedNeg = parseFloat(examNegMarks) >= 0 ? parseFloat(examNegMarks) : 0.5;
    const parsedDuration = parseInt(examDuration, 10) || 60;
    const stageNames = examStagesText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const builtStages: ExamStageConfig[] = (stageNames.length ? stageNames : ['Stage-1']).map(
      (stg, idx) => ({
        id: `stg-${idx + 1}`,
        name: stg,
        papers: [
          {
            id: `pap-${idx + 1}`,
            name: 'Paper-1',
            durationMinutes: parsedDuration,
            questionCount: 100,
            maxMarks: 100 * parsedCorrect,
            marksPerCorrect: parsedCorrect,
            negativeMarks: parsedNeg,
            negativeMarking: parsedNeg,
            subjects: Object.keys(db.subjects || {}),
          },
        ],
      })
    );

    if (editingExamId) {
      const updatedExams = db.exams.map((ex) =>
        ex.id === editingExamId
          ? {
              ...ex,
              name: examName.trim(),
              name_hi: examNameHi.trim() || examName.trim(),
              shortCode: examShortCode.trim() || examName.trim(),
              familyId: examFamilyId,
              stateOrAuthority: examAuthority.trim() || 'Examination Board',
              badge: examBadge.trim() || 'Official Exam',
              level: examLevel,
              marksPerCorrect: parsedCorrect,
              negativeMarking: parsedNeg,
              defaultDurationMinutes: parsedDuration,
              stages: builtStages,
              accessType: examAccessType,
            }
          : ex
      );
      onUpdateDatabase({ ...db, exams: updatedExams });
      setEditingExamId(null);
      notify(`Updated exam "${examName.trim()}".`);
    } else {
      const newEx: ExamCategory = {
        id: examShortCode.trim() || examName.trim(),
        name: examName.trim(),
        name_hi: examNameHi.trim() || examName.trim(),
        shortCode: examShortCode.trim() || examName.trim(),
        familyId: examFamilyId,
        stateOrAuthority: examAuthority.trim() || 'Examination Board',
        badge: examBadge.trim() || 'Official Exam',
        level: examLevel,
        isActive: true,
        marksPerCorrect: parsedCorrect,
        negativeMarking: parsedNeg,
        defaultDurationMinutes: parsedDuration,
        stages: builtStages,
        subjects: Object.keys(db.subjects || {}),
        accessType: examAccessType,
        sortOrder: db.exams.length + 1,
      };
      onUpdateDatabase({ ...db, exams: [...db.exams, newEx] });
      notify(`Added new exam "${newEx.name}".`);
    }

    setExamName('');
    setExamNameHi('');
    setExamShortCode('');
    setExamAuthority('');
  };

  const handleEditExamClick = (ex: ExamCategory) => {
    setEditingExamId(ex.id);
    setExamName(ex.name);
    setExamNameHi(ex.name_hi || '');
    setExamShortCode(ex.shortCode || ex.id);
    setExamFamilyId(ex.familyId || db.examFamilies[0]?.id || 'fam-ssc');
    setExamAuthority(ex.stateOrAuthority || '');
    setExamBadge(ex.badge || 'Official Exam');
    setExamLevel(ex.level || 'Central');
    setExamMarksCorrect(String(ex.marksPerCorrect ?? 2.0));
    setExamNegMarks(String(ex.negativeMarking ?? 0.5));
    setExamDuration(String(ex.defaultDurationMinutes ?? 60));
    setExamStagesText(
      (ex.stages || []).map((s) => s.name).join(', ') || 'Tier-1, Tier-2'
    );
    setExamAccessType(ex.accessType || 'free');
  };

  const handleAddSubject = () => {
    const clean = newSubjectName.trim();
    if (!clean) return;
    const updatedSubjects = {
      ...db.subjects,
      [clean]: db.subjects[clean] || ['General Concepts'],
    };
    const updatedExams = db.exams.map((ex) =>
      ex.name === targetExamForSubject || ex.id === targetExamForSubject
        ? {
            ...ex,
            subjects: Array.from(new Set([...(ex.subjects || []), clean])),
          }
        : ex
    );
    onUpdateDatabase({
      ...db,
      subjects: updatedSubjects,
      exams: updatedExams,
    });
    setSelectedSubjectKey(clean);
    setNewSubjectName('');
    notify(`Added subject "${clean}".`);
  };

  const handleAddChapter = () => {
    const clean = newChapterName.trim();
    if (!clean || !selectedSubjectKey) return;
    const currentList = db.subjects[selectedSubjectKey] || [];
    if (currentList.includes(clean)) {
      notify('Chapter already exists in this subject.', false);
      return;
    }
    onUpdateDatabase({
      ...db,
      subjects: {
        ...db.subjects,
        [selectedSubjectKey]: [...currentList, clean],
      },
    });
    setNewChapterName('');
    notify(`Added chapter "${clean}" under ${selectedSubjectKey}.`);
  };

  const openCreateQuestionModal = () => {
    setEditingQuestionId(null);
    setQEn('');
    setQHi('');
    setOptEn0('');
    setOptEn1('');
    setOptEn2('');
    setOptEn3('');
    setOptHi0('');
    setOptHi1('');
    setOptHi2('');
    setOptHi3('');
    setQCorrectIdx(0);
    setQBasicEn('');
    setQBasicHi('');
    setQTrickEn('');
    setQTrickHi('');
    setQExtraExamIds([]);
    setShowQuestionModal(true);
  };

  const openEditQuestionModal = (q: Question) => {
    setEditingQuestionId(q.id);
    setQExam(q.exam);
    setQStage(q.stage || 'Tier-1');
    setQSubject(q.subject);
    setQTopic(q.topic);
    setQFolderId(q.folderId);
    setQPyqTag(q.pyqTag);
    setQDifficulty(q.difficulty);
    setQSourceClass(q.sourceClassification || 'verified_pyq');
    setQIsPro(q.isPro);
    setQEn(q.question_en);
    setQHi(q.question_hi);
    setOptEn0(q.options_en[0] || '');
    setOptEn1(q.options_en[1] || '');
    setOptEn2(q.options_en[2] || '');
    setOptEn3(q.options_en[3] || '');
    setOptHi0(q.options_hi[0] || '');
    setOptHi1(q.options_hi[1] || '');
    setOptHi2(q.options_hi[2] || '');
    setOptHi3(q.options_hi[3] || '');
    setQCorrectIdx(q.correctIndex);
    setQBasicEn(q.basic_en);
    setQBasicHi(q.basic_hi);
    setQTrickEn(q.trick_en);
    setQTrickHi(q.trick_hi);
    setQExtraExamIds(
      (q.examMappings || []).map((m) => m.examId || m.examName || '').filter(Boolean)
    );
    setShowQuestionModal(true);
  };

  const handleSaveQuestion = () => {
    if (!qEn.trim() || !optEn0.trim() || !optEn1.trim()) {
      notify('Please fill at least the English question and options A & B.', false);
      return;
    }
    const optionsEn = [
      optEn0.trim(),
      optEn1.trim(),
      optEn2.trim() || 'Option C',
      optEn3.trim() || 'Option D',
    ];
    const optionsHi = [
      optHi0.trim() || optionsEn[0],
      optHi1.trim() || optionsEn[1],
      optHi2.trim() || optionsEn[2],
      optHi3.trim() || optionsEn[3],
    ];

    const mappings: QuestionExamMapping[] = Array.from(
      new Set([qExam, ...qExtraExamIds])
    ).map((exName) => ({
      examId: exName,
      examName: exName,
      stage: qStage,
      subject: qSubject,
      topic: qTopic,
      pyqTag: qPyqTag,
    }));

    const built: Question = {
      id: editingQuestionId || `q-${Date.now()}`,
      exam: qExam,
      stage: qStage,
      folderId: qFolderId,
      category: qSourceClass === 'verified_pyq' ? 'pyq' : 'guess',
      pyqTag: qPyqTag.trim() || 'Official PYQ',
      subject: qSubject,
      topic: qTopic,
      chapter: qTopic,
      difficulty: qDifficulty,
      isPro: qIsPro,
      question_en: qEn.trim(),
      question_hi: qHi.trim() || qEn.trim(),
      options_en: optionsEn,
      options_hi: optionsHi,
      correctIndex: qCorrectIdx,
      basic_en: qBasicEn.trim() || 'Standard step-by-step method.',
      basic_hi: qBasicHi.trim() || qBasicEn.trim() || 'मानक चरण-दर-चरण विधि।',
      trick_en: qTrickEn.trim() || 'Apply 15-second elimination / ratio shortcut.',
      trick_hi: qTrickHi.trim() || qTrickEn.trim() || '15-सेकंड शॉर्टकट ट्रिक।',
      sourceClassification: qSourceClass,
      verificationStatus: qSourceClass === 'verified_pyq' ? 'verified' : 'model_reviewed',
      status: 'published',
      examMappings: mappings,
      fingerprint: computeQuestionFingerprint({
        question_en: qEn.trim(),
        options_en: optionsEn,
      }),
    };

    const nextQuestions = editingQuestionId
      ? db.questions.map((item) => (item.id === editingQuestionId ? built : item))
      : [built, ...db.questions];

    onUpdateDatabase({
      ...db,
      questions: nextQuestions,
    });
    setShowQuestionModal(false);
    notify(editingQuestionId ? 'Question updated.' : 'New question published.');
  };

  // Dry-Run Bulk JSON / CSV Validator
  const handleDryRunBulkImport = () => {
    if (!bulkInputText.trim()) {
      notify(`Paste ${importFormat.toUpperCase()} question data first.`, false);
      return;
    }

    const existingFingerprints = new Set(
      db.questions.map((q) => q.fingerprint || computeQuestionFingerprint(q))
    );
    const validQuestions: Question[] = [];
    let duplicateCount = 0;
    const errors: string[] = [];

    try {
      let rawRows: Array<Record<string, unknown>> = [];

      if (importFormat === 'json') {
        const parsed = JSON.parse(bulkInputText);
        rawRows = Array.isArray(parsed) ? parsed : parsed.questions || [];
      } else {
        // CSV Parser
        const lines = bulkInputText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length < 2) {
          setDryRunResult({
            validQuestions: [],
            duplicateCount: 0,
            errors: ['CSV must include a header row and at least 1 data row.'],
          });
          return;
        }
        const headers = parseCsvLine(lines[0]);
        for (let i = 1; i < lines.length; i++) {
          const cols = parseCsvLine(lines[i]);
          const rowObj: Record<string, unknown> = {};
          headers.forEach((h, cIdx) => {
            rowObj[h] = cols[cIdx] ?? '';
          });
          rowObj.options_en = [
            String(rowObj.optionA_en || ''),
            String(rowObj.optionB_en || ''),
            String(rowObj.optionC_en || 'Option C'),
            String(rowObj.optionD_en || 'Option D'),
          ];
          rowObj.options_hi = [
            String(rowObj.optionA_hi || rowObj.optionA_en || ''),
            String(rowObj.optionB_hi || rowObj.optionB_en || ''),
            String(rowObj.optionC_hi || rowObj.optionC_en || ''),
            String(rowObj.optionD_hi || rowObj.optionD_en || ''),
          ];
          rawRows.push(rowObj);
        }
      }

      if (!Array.isArray(rawRows) || rawRows.length === 0) {
        setDryRunResult({
          validQuestions: [],
          duplicateCount: 0,
          errors: ['No valid question rows found in input.'],
        });
        return;
      }

      rawRows.forEach((raw, idx) => {
        const qEnText = String(raw.question_en || '').trim();
        const optsEn = Array.isArray(raw.options_en)
          ? raw.options_en.map((o) => String(o))
          : [];
        if (!qEnText || optsEn.length < 2 || !optsEn[0]) {
          errors.push(`Row #${idx + 1}: Missing question_en or options.`);
          return;
        }
        const fp = computeQuestionFingerprint({
          question_en: qEnText,
          options_en: optsEn,
        });
        if (existingFingerprints.has(fp)) {
          duplicateCount += 1;
          return;
        }
        existingFingerprints.add(fp);

        const optsHi = Array.isArray(raw.options_hi)
          ? raw.options_hi.map((o) => String(o)).slice(0, 4)
          : optsEn.slice(0, 4);

        validQuestions.push({
          id: String(raw.id || `q-bulk-${Date.now()}-${idx}`),
          exam: String(raw.exam || aiPromptExam),
          stage: String(raw.stage || 'Tier-1'),
          folderId: String(raw.folderId || db.folders[0]?.id || 'folder-cgl-pyq'),
          category: (raw.category as 'pyq' | 'guess') || 'pyq',
          pyqTag: String(raw.pyqTag || `${raw.exam || aiPromptExam} PYQ`),
          subject: String(raw.subject || aiPromptSubject),
          topic: String(raw.topic || 'Core Topic'),
          difficulty: (raw.difficulty as 'Easy' | 'Moderate' | 'Hard') || 'Moderate',
          isPro: Boolean(raw.isPro === true || raw.isPro === 'true'),
          question_en: qEnText,
          question_hi: String(raw.question_hi || qEnText),
          options_en: optsEn.slice(0, 4),
          options_hi: optsHi,
          correctIndex: Math.min(3, Math.max(0, Number(raw.correctIndex) || 0)),
          basic_en: String(raw.basic_en || 'Step-by-step conceptual explanation.'),
          basic_hi: String(raw.basic_hi || raw.basic_en || 'विस्तृत हल।'),
          trick_en: String(raw.trick_en || 'Fast exam shortcut.'),
          trick_hi: String(raw.trick_hi || raw.trick_en || 'तेज़ परीक्षा ट्रिक।'),
          sourceClassification: 'verified_pyq',
          verificationStatus: 'verified',
          status: 'published',
          fingerprint: fp,
        });
      });

      setDryRunResult({ validQuestions, duplicateCount, errors });
    } catch (err) {
      setDryRunResult({
        validQuestions: [],
        duplicateCount: 0,
        errors: [`Parse error: ${err instanceof Error ? err.message : 'Invalid format'}`],
      });
    }
  };

  const handleCommitBulkImport = () => {
    if (!dryRunResult || dryRunResult.validQuestions.length === 0) return;
    const batch: ImportBatchHistory = {
      id: `batch-${Date.now()}`,
      timestamp: new Date().toLocaleString('en-IN'),
      examId: aiPromptExam,
      sourceType: importFormat,
      subject: aiPromptSubject,
      addedQuestionIds: dryRunResult.validQuestions.map((q) => q.id),
      skippedDuplicates: dryRunResult.duplicateCount,
      summary: `Imported ${dryRunResult.validQuestions.length} questions (${importFormat.toUpperCase()}) for ${aiPromptExam}`,
    };
    onUpdateDatabase({
      ...db,
      questions: [...dryRunResult.validQuestions, ...db.questions],
      importHistory: [batch, ...(db.importHistory || [])],
    });
    setDryRunResult(null);
    setBulkInputText('');
    notify(`Committed ${batch.addedQuestionIds.length} questions to Zyvra Question Bank!`);
  };

  const handleRollbackBatch = (batch: ImportBatchHistory) => {
    const idSet = new Set(batch.addedQuestionIds);
    onUpdateDatabase({
      ...db,
      questions: db.questions.filter((q) => !idSet.has(q.id)),
      importHistory: (db.importHistory || []).filter((b) => b.id !== batch.id),
    });
    notify(`Rolled back batch (${batch.addedQuestionIds.length} questions removed).`);
  };

  const handleCreateFolder = () => {
    if (!folderNameEn.trim()) {
      notify('Enter folder name in English.', false);
      return;
    }
    const newF: CustomFolder = {
      id: `folder-${Date.now()}`,
      name: folderNameEn.trim(),
      name_en: folderNameEn.trim(),
      name_hi: folderNameHi.trim() || folderNameEn.trim(),
      type: folderType,
      exam: folderExam,
      examIds: [folderExam],
      subject: folderSubject,
      icon: folderType === 'test' ? 'Trophy' : 'FileText',
      color: 'indigo',
      isPro: folderIsPro,
    };
    onUpdateDatabase({
      ...db,
      folders: [newF, ...db.folders],
    });
    setFolderNameEn('');
    setFolderNameHi('');
    notify(`Created folder "${newF.name}".`);
  };

  const handleCreateTestPack = () => {
    if (!packTitleEn.trim()) {
      notify('Enter Test Series title.', false);
      return;
    }
    const matchingQs = db.questions.filter((q) => q.exam === packExam).map((q) => q.id);
    const qIds = matchingQs.length > 0 ? matchingQs : db.questions.slice(0, 8).map((q) => q.id);

    const newPack: TestSeriesPack = {
      id: `pack-${Date.now()}`,
      title_en: packTitleEn.trim(),
      title_hi: packTitleHi.trim() || packTitleEn.trim(),
      exam: packExam,
      category: 'pyq',
      folderId: db.folders[0]?.id || 'folder-cgl-pyq',
      subject: 'All Subjects',
      questionIds: qIds,
      durationMinutes: parseInt(packDuration, 10) || 30,
      marksPerCorrect: parseFloat(packMarksCorrect) || 2.0,
      negativeMarking: parseFloat(packNegMarks) >= 0 ? parseFloat(packNegMarks) : 0.5,
      shiftTag: packShiftTag.trim() || 'Official Set',
      isPro: packIsPro,
    };
    onUpdateDatabase({
      ...db,
      testSeries: [newPack, ...db.testSeries],
    });
    setPackTitleEn('');
    setPackTitleHi('');
    notify(`Published Test Pack "${newPack.title_en}".`);
  };

  const handlePdfFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNotePdfFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setNotePdfDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveNote = async () => {
    if (!noteTitleEn.trim()) {
      notify('Enter a note/PDF title first.', false);
      return;
    }
    let finalPdfUrl = notePdfDataUrl;
    if (noteType === 'pdf' && notePdfDataUrl && notePdfFileName) {
      const res = await uploadPdfToGitHubRepo(ghConfig, notePdfFileName, notePdfDataUrl);
      if (res.remoteUrl) finalPdfUrl = res.remoteUrl;
    }
    const newNote: StudyNote = {
      id: `note-${Date.now()}`,
      title_en: noteTitleEn.trim(),
      title_hi: noteTitleHi.trim() || noteTitleEn.trim(),
      type: noteType,
      exam: noteExam,
      examIds: [noteExam],
      subject: noteSubject,
      topic: noteTopic.trim() || 'Revision Sheet',
      folderId: noteFolderId,
      content_en: noteContentEn.trim() || 'High-yield exam revision points.',
      content_hi: noteContentHi.trim() || noteContentEn.trim() || 'महत्वपूर्ण परीक्षा संशोधन बिंदु।',
      pdfUrl: finalPdfUrl,
      pageCount: 1,
      allowDownload: noteAllowDownload,
      isPro: noteIsPro,
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    onUpdateDatabase({
      ...db,
      notes: [newNote, ...db.notes],
    });
    setNoteTitleEn('');
    setNoteTitleHi('');
    setNoteContentEn('');
    setNoteContentHi('');
    setNotePdfDataUrl('');
    setNotePdfFileName('');
    notify(`Saved ${noteType.toUpperCase()} resource "${newNote.title_en}".`);
  };

  const handleGenerateStudentKey = () => {
    if (!genDeviceId.trim()) {
      notify('Enter the student Device Lock ID (e.g. ZYV-8492-X7B).', false);
      return;
    }
    const proKey = generateProKey(genDeviceId.trim());
    if (!proKey) {
      notify('Invalid Device ID format. Expected ZYV-XXXX-XXX or SSC-XXXX-XXX.', false);
      return;
    }
    setGeneratedKeyOutput(proKey);

    const newSale: StudentSaleLog = {
      id: `sale-${Date.now()}`,
      studentName: genStudentName.trim() || 'Student Aspirant',
      mobile: genMobile.trim() || '9876543210',
      deviceId: genDeviceId.trim().toUpperCase(),
      utrNumber: genUtr.trim() || 'UPI-VERIFIED',
      amountPaid: parseFloat(genAmount) || db.offers.offerPrice || 149,
      couponUsed: 'NONE',
      proKey,
      generatedProKey: proKey,
      unlockedScope: genScope,
      activatedAt: new Date().toLocaleString('en-IN'),
    };
    onUpdateDatabase({
      ...db,
      salesLog: [newSale, ...(db.salesLog || [])],
    });
    notify(`Generated Device-Locked Pro Key: ${proKey}`);
  };

  const handlePushGitHub = async () => {
    setSyncBusy(true);
    saveGitHubSyncConfig(ghConfig);
    const res = await pushDatabaseToGitHub(ghConfig, db);
    const audit = createSyncAuditEntry('push_github', res.ok ? 'success' : 'failed', res.message, db);
    onUpdateDatabase({
      ...db,
      syncAuditLogs: [audit, ...(db.syncAuditLogs || [])],
    });
    setSyncBusy(false);
    notify(res.message, res.ok);
  };

  const handlePullGitHub = async () => {
    setSyncBusy(true);
    saveGitHubSyncConfig(ghConfig);
    const res = await pullDatabaseFromGitHub(ghConfig);
    setSyncBusy(false);
    if (res.ok && res.db) {
      onUpdateDatabase(res.db);
      notify(res.message, true);
    } else {
      notify(res.message, false);
    }
  };

  // ============================================================================
  // ZYVRA ADMIN LOGIN SCREEN (Login ID: Sajiya@8800)
  // ============================================================================
  if (!adminSession) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md overflow-y-auto">
        <form
          onSubmit={handleAdminLogin}
          className={`w-full max-w-md rounded-2xl p-6 ${
            isDark ? 'surface-card-dark text-slate-100' : 'surface-card-light text-slate-900'
          }`}
        >
          <div className="flex items-center justify-between border-b pb-4 border-white/10">
            <ZyvraLogo size="sm" showTagline={false} />
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:text-white"
              title="Close Admin Login"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-indigo-400">
              <Shield className="h-3.5 w-3.5" />
              Administrator Authentication
            </span>
            <h2 className="mt-1 text-lg font-bold">Sign in to Zyvra Control Center</h2>
            <p className="mt-1 text-xs text-slate-400">
              Authorized Administrator Login ID (<code className="text-indigo-300">Sajiya@8800</code>) and Passcode required.
            </p>
          </div>

          <div className="mt-4 space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-400">
                Admin Login ID
              </label>
              <input
                type="text"
                value={loginIdInput}
                onChange={(e) => setLoginIdInput(e.target.value)}
                placeholder="Sajiya@8800"
                required
                className={`mt-1 min-h-[44px] w-full rounded-xl border px-3.5 text-xs font-semibold outline-none ${
                  isDark
                    ? 'border-white/15 bg-white/5 text-white'
                    : 'border-slate-300 bg-slate-50 text-slate-900'
                }`}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400">
                Administrator Passcode
              </label>
              <input
                type="password"
                value={passcodeInput}
                onChange={(e) => setPasscodeInput(e.target.value)}
                placeholder="Enter Admin Passcode"
                autoFocus
                required
                className={`mt-1 min-h-[44px] w-full rounded-xl border px-3.5 font-mono text-sm tracking-wider outline-none ${
                  isDark
                    ? 'border-white/15 bg-white/5 text-white'
                    : 'border-slate-300 bg-slate-50 text-slate-900'
                }`}
              />
              {!apiBaseUrl && (
                <p className="mt-1 text-[11px] text-slate-400">
                  Local Demo Passcode defaults to your configured Admin PIN (initial default: 2026) and can be changed after signing in.
                </p>
              )}
            </div>
          </div>

          {loginError && (
            <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-300">
              {loginError}
            </div>
          )}

          {/* Honest Architecture Security Notice */}
          <div
            className={`mt-4 rounded-xl border p-3 text-[11px] leading-relaxed ${
              isDark
                ? 'border-white/10 bg-white/[0.02] text-slate-400'
                : 'border-slate-200 bg-slate-50 text-slate-600'
            }`}
          >
            <strong className="text-slate-300">Security & Deployment Note:</strong>{' '}
            {apiBaseUrl
              ? `Connected to Backend Auth API (${apiBaseUrl}). Credentials are verified server-side.`
              : 'Running in Static / Local Demo Mode. Frontend-only authentication protects local browser state for demonstration; for production multi-user security, configure VITE_API_BASE_URL or publish updates via GitHub Cloud Sync.'}
          </div>

          <div className="mt-5 flex gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className={`min-h-[44px] flex-1 rounded-xl border text-xs font-semibold ${
                isDark ? 'border-white/10 text-slate-300' : 'border-slate-200 text-slate-700'
              }`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loginBusy}
              className="min-h-[44px] flex-1 rounded-xl bg-indigo-600 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {loginBusy ? 'Signing In...' : 'Sign In as Admin'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  const navItems: Array<{ id: AdminSection; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: 'exams', label: 'Exams & Categories', icon: <Layers className="h-4 w-4" /> },
    { id: 'subjects', label: 'Subjects & Chapters', icon: <BookOpen className="h-4 w-4" /> },
    { id: 'questions', label: 'Question Bank', icon: <Database className="h-4 w-4" /> },
    { id: 'import', label: 'Import & Export', icon: <Upload className="h-4 w-4" /> },
    { id: 'tests', label: 'Tests & Folders', icon: <FolderPlus className="h-4 w-4" /> },
    { id: 'notes', label: 'Notes & PDFs', icon: <FileText className="h-4 w-4" /> },
    { id: 'students', label: 'Students & Pro Keys', icon: <Users className="h-4 w-4" /> },
    { id: 'pricing', label: 'Pricing & Coupons', icon: <Tag className="h-4 w-4" /> },
    { id: 'sync', label: 'Cloud Sync & Security', icon: <Cloud className="h-4 w-4" /> },
  ];

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col ${
        isDark ? 'bg-[#0A0E17] text-slate-100' : 'bg-[#F8FAFC] text-slate-900'
      }`}
    >
      {/* Top Admin Header */}
      <header
        className={`sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b px-4 sm:px-6 ${
          isDark ? 'liquid-glass-dark' : 'liquid-glass-light'
        }`}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-white/10 lg:hidden"
          >
            <Menu className="h-4 w-4" />
          </button>
          <ZyvraLogo size="sm" showTagline={false} />
          <div className="hidden sm:block border-l pl-3 border-white/10">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <h1 className="text-xs font-bold sm:text-sm">
                Admin Control Center ({adminSession.loginId})
              </h1>
            </div>
            <p className="text-[11px] text-slate-400">
              {db.exams.length} Exams · {db.questions.length} Questions ·{' '}
              {adminSession.mode === 'backend_jwt' ? 'Backend Auth' : 'Local Demo Session'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const blob = new Blob([JSON.stringify(db, null, 2)], {
                type: 'application/json',
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `zyvra_master_db_${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className={`hidden min-h-[40px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold sm:inline-flex ${
              isDark
                ? 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Download className="h-3.5 w-3.5" />
            Export DB
          </button>

          <button
            type="button"
            onClick={handleAdminLogout}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold ${
              isDark
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
                : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
            }`}
            title="Sign out of Admin session"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Logout</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-500"
          >
            Student View
          </button>
        </div>
      </header>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm rounded-xl border border-indigo-500/40 bg-slate-900/95 px-4 py-3 text-xs font-semibold text-white shadow-xl">
          <div className="flex items-center gap-2">
            <CheckCircle2
              className={`h-4 w-4 shrink-0 ${toast.ok ? 'text-emerald-400' : 'text-rose-400'}`}
            />
            <span>{toast.text}</span>
          </div>
        </div>
      )}

      {/* Body Layout: Sidebar + Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop Sidebar & Mobile Drawer */}
        <aside
          className={`${
            mobileMenuOpen ? 'fixed inset-y-16 left-0 z-40 block w-64' : 'hidden'
          } shrink-0 overflow-y-auto border-r p-3 lg:static lg:block lg:w-64 ${
            isDark
              ? 'border-white/10 bg-[#0D1322]'
              : 'border-slate-200 bg-white'
          }`}
        >
          <nav className="space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveSection(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`flex min-h-[42px] w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold transition ${
                  activeSection === item.id
                    ? 'bg-indigo-600 text-white'
                    : isDark
                    ? 'text-slate-300 hover:bg-white/5'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* Main Section Workspace */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto max-w-5xl space-y-6">
            {/* ================================================================
                SECTION 1: OVERVIEW
               ================================================================ */}
            {activeSection === 'overview' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-bold">Zyvra Platform Overview</h2>
                  <p className="text-xs text-slate-400">
                    Signed in as <strong className="text-indigo-400">{adminSession.loginId}</strong>. Manage competitive exam categories, bilingual questions, study resources, and student access.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div
                    className={`rounded-2xl p-4 ${
                      isDark ? 'surface-card-dark' : 'surface-card-light'
                    }`}
                  >
                    <p className="text-xs text-slate-400">Active Exams</p>
                    <p className="mt-1 text-2xl font-extrabold tabular-nums">{db.exams.length}</p>
                    <p className="mt-0.5 text-[11px] text-indigo-400">
                      Across {db.examFamilies.length} Exam Families
                    </p>
                  </div>
                  <div
                    className={`rounded-2xl p-4 ${
                      isDark ? 'surface-card-dark' : 'surface-card-light'
                    }`}
                  >
                    <p className="text-xs text-slate-400">Question Bank</p>
                    <p className="mt-1 text-2xl font-extrabold tabular-nums">
                      {db.questions.length}
                    </p>
                    <p className="mt-0.5 text-[11px] text-emerald-400">
                      Bilingual + Dual-Method
                    </p>
                  </div>
                  <div
                    className={`rounded-2xl p-4 ${
                      isDark ? 'surface-card-dark' : 'surface-card-light'
                    }`}
                  >
                    <p className="text-xs text-slate-400">Notes & PDFs</p>
                    <p className="mt-1 text-2xl font-extrabold tabular-nums">{db.notes.length}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {db.flashcards.length} Flashcards
                    </p>
                  </div>
                  <div
                    className={`rounded-2xl p-4 ${
                      isDark ? 'surface-card-dark' : 'surface-card-light'
                    }`}
                  >
                    <p className="text-xs text-slate-400">Pro Enrollments</p>
                    <p className="mt-1 text-2xl font-extrabold tabular-nums">
                      {(db.salesLog || []).length}
                    </p>
                    <p className="mt-0.5 text-[11px] text-amber-400">
                      Offer Price: ₹{db.offers.offerPrice}
                    </p>
                  </div>
                </div>

                {/* Quick Admin Actions */}
                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <h3 className="text-sm font-bold">Quick Management Shortcuts</h3>
                  <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveSection('questions');
                        openCreateQuestionModal();
                      }}
                      className="flex min-h-[54px] items-center gap-3 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3.5 text-left text-xs font-bold text-indigo-300 hover:bg-indigo-500/20"
                    >
                      <Plus className="h-4 w-4 shrink-0" />
                      Add Bilingual Question
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveSection('exams')}
                      className="flex min-h-[54px] items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-left text-xs font-bold text-emerald-300 hover:bg-emerald-500/20"
                    >
                      <Layers className="h-4 w-4 shrink-0" />
                      Add / Edit Exam Category
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveSection('import')}
                      className="flex min-h-[54px] items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-left text-xs font-bold text-amber-300 hover:bg-amber-500/20"
                    >
                      <FileSpreadsheet className="h-4 w-4 shrink-0" />
                      CSV / JSON Bulk Import
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================
                SECTION 2: EXAMS & CATEGORIES MANAGER
               ================================================================ */}
            {activeSection === 'exams' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-bold">Exam & Category Manager</h2>
                  <p className="text-xs text-slate-400">
                    Create or edit Exam Families and individual Competitive Exams with custom stages and marking schemes.
                  </p>
                </div>

                {/* Add/Edit Exam Form */}
                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <h3 className="text-sm font-bold">
                    {editingExamId ? `Edit Exam: ${examName}` : 'Add New Competitive Exam'}
                  </h3>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400">
                        Exam Name (English)
                      </label>
                      <input
                        type="text"
                        value={examName}
                        onChange={(e) => setExamName(e.target.value)}
                        placeholder="e.g. Bihar SSC Inter Level"
                        className={`mt-1 min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-white/5 text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400">
                        Exam Name (Hindi)
                      </label>
                      <input
                        type="text"
                        value={examNameHi}
                        onChange={(e) => setExamNameHi(e.target.value)}
                        placeholder="बिहार एसएससी इंटर स्तरीय"
                        className={`mt-1 min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-white/5 text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400">
                        Short Code
                      </label>
                      <input
                        type="text"
                        value={examShortCode}
                        onChange={(e) => setExamShortCode(e.target.value)}
                        placeholder="e.g. BSSC Inter"
                        className={`mt-1 min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-white/5 text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400">
                        Exam Family
                      </label>
                      <select
                        value={examFamilyId}
                        onChange={(e) => setExamFamilyId(e.target.value)}
                        className={`mt-1 min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-[#0F172A] text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      >
                        {db.examFamilies.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400">
                        Conducting Authority / State
                      </label>
                      <input
                        type="text"
                        value={examAuthority}
                        onChange={(e) => setExamAuthority(e.target.value)}
                        placeholder="e.g. BSSC Patna / SSC / RRB"
                        className={`mt-1 min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-white/5 text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400">
                        Stages (comma-separated)
                      </label>
                      <input
                        type="text"
                        value={examStagesText}
                        onChange={(e) => setExamStagesText(e.target.value)}
                        placeholder="Prelims, Mains"
                        className={`mt-1 min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-white/5 text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400">
                        Marks / Correct (+)
                      </label>
                      <input
                        type="number"
                        step="0.25"
                        value={examMarksCorrect}
                        onChange={(e) => setExamMarksCorrect(e.target.value)}
                        className={`mt-1 min-h-[42px] w-full rounded-xl border px-3 text-xs tabular-nums outline-none ${
                          isDark
                            ? 'border-white/10 bg-white/5 text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400">
                        Negative Marking (-, 0 for None)
                      </label>
                      <input
                        type="number"
                        step="0.05"
                        value={examNegMarks}
                        onChange={(e) => setExamNegMarks(e.target.value)}
                        className={`mt-1 min-h-[42px] w-full rounded-xl border px-3 text-xs tabular-nums outline-none ${
                          isDark
                            ? 'border-white/10 bg-white/5 text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400">
                        Default Duration (Mins)
                      </label>
                      <input
                        type="number"
                        value={examDuration}
                        onChange={(e) => setExamDuration(e.target.value)}
                        className={`mt-1 min-h-[42px] w-full rounded-xl border px-3 text-xs tabular-nums outline-none ${
                          isDark
                            ? 'border-white/10 bg-white/5 text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                    {editingExamId && (
                      <button
                        type="button"
                        onClick={() => setEditingExamId(null)}
                        className="min-h-[40px] rounded-xl border border-white/15 px-4 text-xs font-semibold"
                      >
                        Cancel Edit
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleSaveExam}
                      className="min-h-[42px] rounded-xl bg-indigo-600 px-5 text-xs font-bold text-white hover:bg-indigo-500"
                    >
                      {editingExamId ? 'Update Exam' : 'Save Exam Category'}
                    </button>
                  </div>
                </div>

                {/* Existing Exams List */}
                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <h3 className="text-sm font-bold">Configured Exams ({db.exams.length})</h3>
                  <div className="mt-3 divide-y divide-white/10">
                    {db.exams.map((ex) => (
                      <div
                        key={ex.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-3"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold">{ex.name}</span>
                            <span className="text-xs text-slate-400">
                              · {ex.stateOrAuthority} · +{ex.marksPerCorrect ?? 2}/-
                              {ex.negativeMarking ?? 0.5}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400">
                            Stages: {(ex.stages || []).map((s) => s.name).join(', ') || 'Default'}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleEditExamClick(ex)}
                            className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-white/10 px-2.5 text-xs font-semibold hover:bg-white/5"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onUpdateDatabase({
                                ...db,
                                exams: db.exams.map((item) =>
                                  item.id === ex.id
                                    ? { ...item, isActive: !item.isActive }
                                    : item
                                ),
                              });
                            }}
                            className={`min-h-[36px] rounded-lg px-2.5 text-xs font-bold ${
                              ex.isActive
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'bg-slate-500/20 text-slate-400'
                            }`}
                          >
                            {ex.isActive ? 'Active' : 'Hidden'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Add Exam Family */}
                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <h3 className="text-sm font-bold">Add Exam Family</h3>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <input
                      type="text"
                      value={famNameEn}
                      onChange={(e) => setFamNameEn(e.target.value)}
                      placeholder="Family Name (e.g. Banking & Insurance)"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <input
                      type="text"
                      value={famNameHi}
                      onChange={(e) => setFamNameHi(e.target.value)}
                      placeholder="हिन्दी नाम (बैंकिंग परीक्षा)"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={handleAddFamily}
                      className="min-h-[42px] rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white hover:bg-indigo-500"
                    >
                      Add Exam Family
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================
                SECTION 3: SUBJECTS & CHAPTERS
               ================================================================ */}
            {activeSection === 'subjects' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-bold">Subjects & Chapters</h2>
                  <p className="text-xs text-slate-400">
                    Manage subjects and chapter/topic lists used by the Question Bank and Custom Test Builder.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  {/* Add Subject */}
                  <div
                    className={`rounded-2xl p-5 ${
                      isDark ? 'surface-card-dark' : 'surface-card-light'
                    }`}
                  >
                    <h3 className="text-sm font-bold">Create Subject</h3>
                    <div className="mt-3 space-y-3">
                      <input
                        type="text"
                        value={newSubjectName}
                        onChange={(e) => setNewSubjectName(e.target.value)}
                        placeholder="e.g. Bihar Special GK & History"
                        className={`min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-white/5 text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      />
                      <select
                        value={targetExamForSubject}
                        onChange={(e) => setTargetExamForSubject(e.target.value)}
                        className={`min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-[#0F172A] text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      >
                        {db.exams.map((ex) => (
                          <option key={ex.id} value={ex.name}>
                            Link to Exam: {ex.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleAddSubject}
                        className="min-h-[42px] w-full rounded-xl bg-indigo-600 text-xs font-bold text-white hover:bg-indigo-500"
                      >
                        Add Subject
                      </button>
                    </div>
                  </div>

                  {/* Add Chapter to Selected Subject */}
                  <div
                    className={`rounded-2xl p-5 ${
                      isDark ? 'surface-card-dark' : 'surface-card-light'
                    }`}
                  >
                    <h3 className="text-sm font-bold">Manage Chapters</h3>
                    <div className="mt-3 space-y-3">
                      <select
                        value={selectedSubjectKey}
                        onChange={(e) => setSelectedSubjectKey(e.target.value)}
                        className={`min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-[#0F172A] text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      >
                        {Object.keys(db.subjects || {}).map((sub) => (
                          <option key={sub} value={sub}>
                            {sub} ({(db.subjects[sub] || []).length} chapters)
                          </option>
                        ))}
                      </select>

                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newChapterName}
                          onChange={(e) => setNewChapterName(e.target.value)}
                          placeholder="New Chapter / Topic Name"
                          className={`min-h-[42px] flex-1 rounded-xl border px-3 text-xs outline-none ${
                            isDark
                              ? 'border-white/10 bg-white/5 text-white'
                              : 'border-slate-200 bg-white text-slate-900'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={handleAddChapter}
                          className="min-h-[42px] rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white"
                        >
                          Add
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-1.5 pt-2">
                        {(db.subjects[selectedSubjectKey] || []).map((chap) => (
                          <span
                            key={chap}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${
                              isDark
                                ? 'border-white/10 bg-white/[0.03] text-slate-300'
                                : 'border-slate-200 bg-slate-50 text-slate-700'
                            }`}
                          >
                            {chap}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================
                SECTION 4: QUESTION BANK & MULTI-EXAM MAPPER
               ================================================================ */}
            {activeSection === 'questions' && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold">
                      Question Bank ({filteredQuestions.length})
                    </h2>
                    <p className="text-xs text-slate-400">
                      Search, filter, edit bilingual questions, or map a single question across multiple exams.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={openCreateQuestionModal}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500"
                  >
                    <Plus className="h-4 w-4" />
                    Add New Question
                  </button>
                </div>

                {/* Search & Filters */}
                <div
                  className={`grid grid-cols-1 gap-3 rounded-2xl p-4 sm:grid-cols-3 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={qSearch}
                      onChange={(e) => setQSearch(e.target.value)}
                      placeholder="Search question text or PYQ shift..."
                      className={`min-h-[42px] w-full rounded-xl border pl-9 pr-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                  </div>
                  <select
                    value={qFilterExam}
                    onChange={(e) => setQFilterExam(e.target.value)}
                    className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                      isDark
                        ? 'border-white/10 bg-[#0F172A] text-white'
                        : 'border-slate-200 bg-white text-slate-900'
                    }`}
                  >
                    <option value="ALL">All Exams</option>
                    {db.exams.map((ex) => (
                      <option key={ex.id} value={ex.name}>
                        {ex.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={qFilterSubject}
                    onChange={(e) => setQFilterSubject(e.target.value)}
                    className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                      isDark
                        ? 'border-white/10 bg-[#0F172A] text-white'
                        : 'border-slate-200 bg-white text-slate-900'
                    }`}
                  >
                    <option value="ALL">All Subjects</option>
                    {Object.keys(db.subjects || {}).map((sub) => (
                      <option key={sub} value={sub}>
                        {sub}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Question Rows */}
                <div className="space-y-3">
                  {filteredQuestions.map((q) => (
                    <div
                      key={q.id}
                      className={`rounded-2xl p-4 ${
                        isDark ? 'surface-card-dark' : 'surface-card-light'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="text-xs text-slate-400">
                          <strong className="text-indigo-400">{q.exam}</strong> · {q.subject} ·{' '}
                          {q.topic} · {q.pyqTag}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEditQuestionModal(q)}
                            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-white/10 px-2.5 text-xs font-semibold hover:bg-white/5"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmDelete({
                                label: `Question "${q.question_en.slice(0, 50)}..."`,
                                onConfirm: () => {
                                  onUpdateDatabase({
                                    ...db,
                                    questions: db.questions.filter((item) => item.id !== q.id),
                                  });
                                  setConfirmDelete(null);
                                  notify('Question deleted.');
                                },
                              })
                            }
                            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 text-xs font-semibold text-rose-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <p className="mt-2 text-sm font-medium">{q.question_en}</p>
                      <p className="mt-1 text-xs text-slate-400">{q.question_hi}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ================================================================
                SECTION 5: IMPORT & EXPORT (JSON + CSV + Sample Templates)
               ================================================================ */}
            {activeSection === 'import' && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold">Bulk Import & Export (JSON & CSV)</h2>
                    <p className="text-xs text-slate-400">
                      Download sample templates, validate bulk JSON or CSV imports with duplicate detection, or rollback batches.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href="./templates/sample-questions.csv"
                      download="zyvra-sample-questions.csv"
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/5"
                    >
                      <Download className="h-3.5 w-3.5 text-emerald-400" />
                      Sample CSV
                    </a>
                    <a
                      href="./templates/sample-questions.json"
                      download="zyvra-sample-questions.json"
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/5"
                    >
                      <Download className="h-3.5 w-3.5 text-indigo-400" />
                      Sample JSON
                    </a>
                  </div>
                </div>

                {/* AI Prompt Generator */}
                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <h3 className="text-sm font-bold">1-Click AI Question Extraction Prompt</h3>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <select
                      value={aiPromptExam}
                      onChange={(e) => setAiPromptExam(e.target.value)}
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-[#0F172A] text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    >
                      {db.exams.map((ex) => (
                        <option key={ex.id} value={ex.name}>
                          {ex.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={aiPromptSubject}
                      onChange={(e) => setAiPromptSubject(e.target.value)}
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-[#0F172A] text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    >
                      {Object.keys(db.subjects || {}).map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        const promptText = `Generate ${aiPromptCount} bilingual (English + Hindi) competitive exam questions for "${aiPromptExam}" in subject "${aiPromptSubject}" as a valid JSON array. Each object must contain: question_en, question_hi, options_en (array of 4 strings), options_hi (array of 4 strings), correctIndex (0-3), basic_en, basic_hi, trick_en, trick_hi, topic, pyqTag, difficulty ("Easy"|"Moderate"|"Hard").`;
                        navigator.clipboard?.writeText(promptText);
                        notify('Copied AI Extraction Prompt to clipboard!');
                      }}
                      className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white hover:bg-indigo-500"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy AI Prompt
                    </button>
                  </div>
                </div>

                {/* Dry-Run JSON / CSV Importer */}
                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold">
                      Bulk Question Importer (with Dry-Run Validation)
                    </h3>
                    <div className="inline-flex rounded-xl border border-white/10 p-1">
                      <button
                        type="button"
                        onClick={() => setImportFormat('json')}
                        className={`rounded-lg px-3 py-1 text-xs font-bold ${
                          importFormat === 'json'
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400'
                        }`}
                      >
                        JSON Format
                      </button>
                      <button
                        type="button"
                        onClick={() => setImportFormat('csv')}
                        className={`rounded-lg px-3 py-1 text-xs font-bold ${
                          importFormat === 'csv'
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400'
                        }`}
                      >
                        CSV Format
                      </button>
                    </div>
                  </div>

                  <textarea
                    rows={6}
                    value={bulkInputText}
                    onChange={(e) => setBulkInputText(e.target.value)}
                    placeholder={
                      importFormat === 'json'
                        ? 'Paste JSON array of questions here: [{"question_en": "...", "options_en": ["A","B","C","D"], "correctIndex": 0, ...}]'
                        : 'exam,stage,subject,topic,pyqTag,difficulty,question_en,question_hi,optionA_en,optionB_en,optionC_en,optionD_en,optionA_hi,optionB_hi,optionC_hi,optionD_hi,correctIndex,basic_en,basic_hi,trick_en,trick_hi'
                    }
                    className={`mt-3 w-full rounded-xl border p-3 font-mono text-xs outline-none ${
                      isDark
                        ? 'border-white/10 bg-white/5 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-900'
                    }`}
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleDryRunBulkImport}
                      className="min-h-[42px] rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white hover:bg-indigo-500"
                    >
                      Run Dry-Run Check ({importFormat.toUpperCase()})
                    </button>
                    {dryRunResult && dryRunResult.validQuestions.length > 0 && (
                      <button
                        type="button"
                        onClick={handleCommitBulkImport}
                        className="min-h-[42px] rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white hover:bg-emerald-500"
                      >
                        Commit {dryRunResult.validQuestions.length} Valid Questions
                      </button>
                    )}
                  </div>

                  {dryRunResult && (
                    <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-3.5 text-xs">
                      <p className="font-bold">
                        Dry-Run Report: {dryRunResult.validQuestions.length} Ready ·{' '}
                        {dryRunResult.duplicateCount} Duplicates Skipped ·{' '}
                        {dryRunResult.errors.length} Errors
                      </p>
                      {dryRunResult.errors.map((err, i) => (
                        <p key={i} className="mt-1 text-rose-400">
                          • {err}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                {/* Import Batch Rollback History */}
                {(db.importHistory || []).length > 0 && (
                  <div
                    className={`rounded-2xl p-5 ${
                      isDark ? 'surface-card-dark' : 'surface-card-light'
                    }`}
                  >
                    <h3 className="text-sm font-bold">Import Batch History (1-Click Rollback)</h3>
                    <div className="mt-3 divide-y divide-white/10">
                      {(db.importHistory || []).map((batch) => (
                        <div
                          key={batch.id}
                          className="flex items-center justify-between gap-2 py-2.5 text-xs"
                        >
                          <div>
                            <p className="font-semibold">{batch.summary}</p>
                            <p className="text-slate-400">{batch.timestamp}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRollbackBatch(batch)}
                            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 font-semibold text-rose-300"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Rollback
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ================================================================
                SECTION 6: TESTS & FOLDERS
               ================================================================ */}
            {activeSection === 'tests' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-bold">Tests & Custom Folders</h2>
                  <p className="text-xs text-slate-400">
                    Organize folders and publish structured Test Series packs for any exam.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  {/* Create Folder */}
                  <div
                    className={`rounded-2xl p-5 ${
                      isDark ? 'surface-card-dark' : 'surface-card-light'
                    }`}
                  >
                    <h3 className="text-sm font-bold">Create Study / Test Folder</h3>
                    <div className="mt-3 space-y-3">
                      <input
                        type="text"
                        value={folderNameEn}
                        onChange={(e) => setFolderNameEn(e.target.value)}
                        placeholder="Folder Title (English)"
                        className={`min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-white/5 text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      />
                      <input
                        type="text"
                        value={folderNameHi}
                        onChange={(e) => setFolderNameHi(e.target.value)}
                        placeholder="फ़ोल्डर का नाम (हिन्दी)"
                        className={`min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-white/5 text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={folderExam}
                          onChange={(e) => setFolderExam(e.target.value)}
                          className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                            isDark
                              ? 'border-white/10 bg-[#0F172A] text-white'
                              : 'border-slate-200 bg-white text-slate-900'
                          }`}
                        >
                          {db.exams.map((ex) => (
                            <option key={ex.id} value={ex.name}>
                              {ex.name}
                            </option>
                          ))}
                        </select>
                        <select
                          value={folderType}
                          onChange={(e) => setFolderType(e.target.value as 'test' | 'note')}
                          className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                            isDark
                              ? 'border-white/10 bg-[#0F172A] text-white'
                              : 'border-slate-200 bg-white text-slate-900'
                          }`}
                        >
                          <option value="test">Test Series Folder</option>
                          <option value="note">Study Notes Folder</option>
                        </select>
                      </div>
                      <button
                        type="button"
                        onClick={handleCreateFolder}
                        className="min-h-[42px] w-full rounded-xl bg-indigo-600 text-xs font-bold text-white hover:bg-indigo-500"
                      >
                        Create Folder
                      </button>
                    </div>
                  </div>

                  {/* Create Test Pack */}
                  <div
                    className={`rounded-2xl p-5 ${
                      isDark ? 'surface-card-dark' : 'surface-card-light'
                    }`}
                  >
                    <h3 className="text-sm font-bold">Publish Test Series Pack</h3>
                    <div className="mt-3 space-y-3">
                      <input
                        type="text"
                        value={packTitleEn}
                        onChange={(e) => setPackTitleEn(e.target.value)}
                        placeholder="Test Title (e.g. BPSC TRE Full Length Mock #1)"
                        className={`min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-white/5 text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={packExam}
                          onChange={(e) => setPackExam(e.target.value)}
                          className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                            isDark
                              ? 'border-white/10 bg-[#0F172A] text-white'
                              : 'border-slate-200 bg-white text-slate-900'
                          }`}
                        >
                          {db.exams.map((ex) => (
                            <option key={ex.id} value={ex.name}>
                              {ex.name}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          value={packDuration}
                          onChange={(e) => setPackDuration(e.target.value)}
                          placeholder="Duration (Mins)"
                          className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                            isDark
                              ? 'border-white/10 bg-white/5 text-white'
                              : 'border-slate-200 bg-white text-slate-900'
                          }`}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleCreateTestPack}
                        className="min-h-[42px] w-full rounded-xl bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-500"
                      >
                        Publish Test Pack
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================
                SECTION 7: NOTES & PDFS
               ================================================================ */}
            {activeSection === 'notes' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-bold">Study Notes & Protected PDFs</h2>
                  <p className="text-xs text-slate-400">
                    Upload PDF files or write bilingual study notes with View-Only or Downloadable permissions.
                  </p>
                </div>

                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <h3 className="text-sm font-bold">Add Study Note / Upload PDF</h3>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <input
                      type="text"
                      value={noteTitleEn}
                      onChange={(e) => setNoteTitleEn(e.target.value)}
                      placeholder="Title (English)"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <input
                      type="text"
                      value={noteTitleHi}
                      onChange={(e) => setNoteTitleHi(e.target.value)}
                      placeholder="शीर्षक (हिन्दी)"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <select
                      value={noteExam}
                      onChange={(e) => setNoteExam(e.target.value)}
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-[#0F172A] text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    >
                      {db.exams.map((ex) => (
                        <option key={ex.id} value={ex.name}>
                          {ex.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={noteSubject}
                      onChange={(e) => setNoteSubject(e.target.value)}
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-[#0F172A] text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    >
                      {Object.keys(db.subjects || {}).map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <select
                      value={noteType}
                      onChange={(e) => setNoteType(e.target.value as 'text' | 'pdf')}
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-[#0F172A] text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    >
                      <option value="text">Bilingual Text Note</option>
                      <option value="pdf">PDF Document</option>
                    </select>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={noteAllowDownload}
                        onChange={(e) => setNoteAllowDownload(e.target.checked)}
                      />
                      <span>Allow Student PDF Download</span>
                    </label>
                  </div>

                  {noteType === 'pdf' && (
                    <div className="mt-3">
                      <label className="block text-xs font-semibold text-slate-400">
                        Select Local PDF File (optional — or provide text below for built-in reader)
                      </label>
                      <input
                        type="file"
                        accept="application/pdf"
                        onChange={handlePdfFileUpload}
                        className="mt-1 text-xs text-slate-400"
                      />
                    </div>
                  )}

                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <textarea
                      rows={4}
                      value={noteContentEn}
                      onChange={(e) => setNoteContentEn(e.target.value)}
                      placeholder="English Study Content / Formula Sheet..."
                      className={`rounded-xl border p-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <textarea
                      rows={4}
                      value={noteContentHi}
                      onChange={(e) => setNoteContentHi(e.target.value)}
                      placeholder="हिन्दी अध्ययन सामग्री / सूत्र..."
                      className={`rounded-xl border p-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                  </div>

                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={handleSaveNote}
                      className="min-h-[42px] rounded-xl bg-indigo-600 px-5 text-xs font-bold text-white hover:bg-indigo-500"
                    >
                      Save Study Resource
                    </button>
                  </div>
                </div>

                {/* Existing Notes List */}
                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <h3 className="text-sm font-bold">Published Notes & PDFs ({db.notes.length})</h3>
                  <div className="mt-3 divide-y divide-white/10">
                    {db.notes.map((n) => (
                      <div
                        key={n.id}
                        className="flex items-center justify-between gap-3 py-3 text-xs"
                      >
                        <div>
                          <p className="font-bold">{n.title_en}</p>
                          <p className="text-slate-400">
                            {n.exam || 'All Exams'} · {n.subject} · {n.type.toUpperCase()} ·{' '}
                            {n.allowDownload ? 'Downloadable' : 'View-Only Locked'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmDelete({
                              label: `Note "${n.title_en}"`,
                              onConfirm: () => {
                                onUpdateDatabase({
                                  ...db,
                                  notes: db.notes.filter((item) => item.id !== n.id),
                                });
                                setConfirmDelete(null);
                                notify('Study note deleted.');
                              },
                            })
                          }
                          className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-rose-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================
                SECTION 8: STUDENTS & PRO ACCESS KEY GENERATOR
               ================================================================ */}
            {activeSection === 'students' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-bold">Students & Local Device-Bound Pro Keys</h2>
                  <p className="text-xs text-slate-400">
                    Generate device-bound Pro Activation Keys from a student's Zyvra Device ID (`ZYV-XXXX-XXX`) and track UTR payments.
                  </p>
                </div>

                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <h3 className="text-sm font-bold">Device-Bound Key Generator</h3>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <input
                      type="text"
                      value={genStudentName}
                      onChange={(e) => setGenStudentName(e.target.value)}
                      placeholder="Student Name"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <input
                      type="tel"
                      value={genMobile}
                      onChange={(e) => setGenMobile(e.target.value)}
                      placeholder="Student Mobile (10 digits)"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <input
                      type="text"
                      value={genDeviceId}
                      onChange={(e) => setGenDeviceId(e.target.value.toUpperCase())}
                      placeholder="Student Device ID (ZYV-8492-X7B)"
                      className={`min-h-[42px] rounded-xl border px-3 font-mono text-xs font-bold uppercase outline-none ${
                        isDark
                          ? 'border-indigo-500/40 bg-white/5 text-white'
                          : 'border-indigo-300 bg-white text-slate-900'
                      }`}
                    />
                    <input
                      type="text"
                      value={genUtr}
                      onChange={(e) => setGenUtr(e.target.value)}
                      placeholder="12-Digit UPI UTR No."
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <input
                      type="number"
                      value={genAmount}
                      onChange={(e) => setGenAmount(e.target.value)}
                      placeholder="Amount Paid (₹)"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={handleGenerateStudentKey}
                      className="min-h-[42px] rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white hover:bg-indigo-500"
                    >
                      Generate Pro Key
                    </button>
                  </div>

                  {generatedKeyOutput && (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3.5">
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-emerald-300">
                          Generated Device-Locked Pro Key
                        </p>
                        <p className="font-mono text-base font-extrabold text-white">
                          {generatedKeyOutput}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(generatedKeyOutput);
                          notify('Pro Key copied to clipboard!');
                        }}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy Key
                      </button>
                    </div>
                  )}
                </div>

                {/* Sales Log Table */}
                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <h3 className="text-sm font-bold">
                    Student Sales & Activation Log ({(db.salesLog || []).length})
                  </h3>
                  <div className="mt-3 divide-y divide-white/10">
                    {(db.salesLog || []).map((sale) => (
                      <div
                        key={sale.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs"
                      >
                        <div>
                          <p className="font-bold">
                            {sale.studentName} · {sale.mobile}
                          </p>
                          <p className="font-mono text-slate-400">
                            Device: {sale.deviceId} · Key: {sale.proKey || sale.generatedProKey} · UTR:{' '}
                            {sale.utrNumber}
                          </p>
                        </div>
                        <span className="font-bold text-emerald-400 tabular-nums">
                          ₹{sale.amountPaid}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================
                SECTION 9: PRICING & COUPONS
               ================================================================ */}
            {activeSection === 'pricing' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-bold">Pricing & Discount Coupons</h2>
                  <p className="text-xs text-slate-400">
                    Configure Zyvra Pro Pass pricing, UPI merchant details, and affiliate coupon codes.
                  </p>
                </div>

                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <h3 className="text-sm font-bold">Pro Pass Offer Configuration</h3>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs text-slate-400">MRP (₹)</label>
                      <input
                        type="number"
                        value={offerForm.mrp}
                        onChange={(e) =>
                          setOfferForm({ ...offerForm, mrp: Number(e.target.value) || 499 })
                        }
                        className={`mt-1 min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-white/5 text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400">Offer Price (₹)</label>
                      <input
                        type="number"
                        value={offerForm.offerPrice}
                        onChange={(e) =>
                          setOfferForm({ ...offerForm, offerPrice: Number(e.target.value) || 149 })
                        }
                        className={`mt-1 min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-white/5 text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400">Merchant UPI ID</label>
                      <input
                        type="text"
                        value={offerForm.upiId}
                        onChange={(e) => setOfferForm({ ...offerForm, upiId: e.target.value })}
                        className={`mt-1 min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-white/5 text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        onUpdateDatabase({ ...db, offers: offerForm });
                        notify('Pricing & Offer settings saved.');
                      }}
                      className="min-h-[42px] rounded-xl bg-indigo-600 px-5 text-xs font-bold text-white"
                    >
                      Save Offer Config
                    </button>
                  </div>
                </div>

                {/* Coupons Manager */}
                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <h3 className="text-sm font-bold">Discount & Educator Coupons</h3>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
                    <input
                      type="text"
                      value={newCouponCode}
                      onChange={(e) => setNewCouponCode(e.target.value.toUpperCase())}
                      placeholder="CODE (e.g. ZYVRA50)"
                      className={`min-h-[42px] rounded-xl border px-3 font-mono text-xs uppercase outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <select
                      value={newCouponType}
                      onChange={(e) => setNewCouponType(e.target.value as 'flat' | 'percent')}
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-[#0F172A] text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    >
                      <option value="flat">Flat Discount (₹)</option>
                      <option value="percent">Percentage (%)</option>
                    </select>
                    <input
                      type="number"
                      value={newCouponValue}
                      onChange={(e) => setNewCouponValue(e.target.value)}
                      placeholder="Value"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!newCouponCode.trim()) return;
                        const c: CouponCode = {
                          code: newCouponCode.trim().toUpperCase(),
                          type: newCouponType,
                          value: Number(newCouponValue) || 20,
                          affiliateTag: newCouponTag || 'Direct',
                          active: true,
                        };
                        onUpdateDatabase({
                          ...db,
                          coupons: [c, ...db.coupons],
                        });
                        setNewCouponCode('');
                        notify(`Created coupon ${c.code}.`);
                      }}
                      className="min-h-[42px] rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white"
                    >
                      Add Coupon
                    </button>
                  </div>

                  <div className="mt-4 divide-y divide-white/10">
                    {db.coupons.map((c) => (
                      <div
                        key={c.code}
                        className="flex items-center justify-between py-2.5 text-xs"
                      >
                        <div>
                          <span className="font-mono font-bold text-indigo-400">{c.code}</span> ·{' '}
                          <span>
                            {c.type === 'flat' ? `₹${c.value} OFF` : `${c.value}% OFF`}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateDatabase({
                              ...db,
                              coupons: db.coupons.filter((item) => item.code !== c.code),
                            })
                          }
                          className="text-rose-400 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================
                SECTION 10: CLOUD SYNC & ADMIN SECURITY SETTINGS
               ================================================================ */}
            {activeSection === 'sync' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-bold">GitHub Cloud Sync & Admin Security</h2>
                  <p className="text-xs text-slate-400">
                    Push or pull the Zyvra Master Database (`database.json`) via GitHub REST API, and manage your local Admin Passcode.
                  </p>
                </div>

                {/* Admin Passcode Configuration */}
                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <h3 className="text-sm font-bold">
                    Admin Credentials (`{DEFAULT_ADMIN_LOGIN_ID}`)
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    Update your local demonstration passcode hash for `{DEFAULT_ADMIN_LOGIN_ID}`. For production multi-user deployments, configure `VITE_API_BASE_URL` for server-side JWT authentication.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 max-w-md">
                    <input
                      type="password"
                      value={newAdminPasscode}
                      onChange={(e) => setNewAdminPasscode(e.target.value)}
                      placeholder="Enter New Passcode"
                      className={`min-h-[42px] flex-1 rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!newAdminPasscode.trim() || newAdminPasscode.trim().length < 4) {
                          notify('Passcode must be at least 4 characters.', false);
                          return;
                        }
                        setLocalAdminPasscode(newAdminPasscode);
                        setNewAdminPasscode('');
                        notify('Updated local Admin Passcode hash.');
                      }}
                      className="min-h-[42px] rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white hover:bg-indigo-500"
                    >
                      Update Passcode
                    </button>
                  </div>
                </div>

                {/* GitHub Repository Sync */}
                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <h3 className="text-sm font-bold">GitHub Repository Configuration</h3>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input
                      type="text"
                      value={ghConfig.repo}
                      onChange={(e) => setGhConfig({ ...ghConfig, repo: e.target.value })}
                      placeholder="owner/repository (e.g. username/zyvra)"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <input
                      type="text"
                      value={ghConfig.branch}
                      onChange={(e) => setGhConfig({ ...ghConfig, branch: e.target.value })}
                      placeholder="Branch (main)"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <input
                      type="text"
                      value={ghConfig.filePath}
                      onChange={(e) => setGhConfig({ ...ghConfig, filePath: e.target.value })}
                      placeholder="File path (database.json)"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <input
                      type="password"
                      value={ghConfig.pat}
                      onChange={(e) => setGhConfig({ ...ghConfig, pat: e.target.value })}
                      placeholder="GitHub Personal Access Token (ghp_...)"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={syncBusy}
                      onClick={handlePushGitHub}
                      className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-indigo-600 px-5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
                    >
                      <Upload className="h-4 w-4" />
                      Push Live Database to GitHub
                    </button>
                    <button
                      type="button"
                      disabled={syncBusy}
                      onClick={handlePullGitHub}
                      className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-white/15 px-5 text-xs font-bold hover:bg-white/5 disabled:opacity-50"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Pull Latest from GitHub
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* ==========================================================================
          VISUAL BILINGUAL QUESTION EDITOR MODAL
         ========================================================================== */}
      {showQuestionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
          <div
            className={`my-8 w-full max-w-3xl rounded-2xl p-6 max-h-[90vh] overflow-y-auto ${
              isDark ? 'surface-card-dark text-slate-100' : 'surface-card-light text-slate-900'
            }`}
          >
            <div className="flex items-center justify-between border-b pb-3 border-white/10">
              <h3 className="text-base font-bold">
                {editingQuestionId ? 'Edit Bilingual Question' : 'Create Bilingual Question'}
              </h3>
              <button
                type="button"
                onClick={() => setShowQuestionModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs text-slate-400">Primary Exam</label>
                <select
                  value={qExam}
                  onChange={(e) => setQExam(e.target.value)}
                  className={`mt-1 min-h-[40px] w-full rounded-xl border px-3 text-xs outline-none ${
                    isDark
                      ? 'border-white/10 bg-[#0F172A] text-white'
                      : 'border-slate-200 bg-white text-slate-900'
                  }`}
                >
                  {db.exams.map((ex) => (
                    <option key={ex.id} value={ex.name}>
                      {ex.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400">Subject</label>
                <select
                  value={qSubject}
                  onChange={(e) => setQSubject(e.target.value)}
                  className={`mt-1 min-h-[40px] w-full rounded-xl border px-3 text-xs outline-none ${
                    isDark
                      ? 'border-white/10 bg-[#0F172A] text-white'
                      : 'border-slate-200 bg-white text-slate-900'
                  }`}
                >
                  {Object.keys(db.subjects || {}).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400">Chapter / Topic</label>
                <input
                  type="text"
                  value={qTopic}
                  onChange={(e) => setQTopic(e.target.value)}
                  className={`mt-1 min-h-[40px] w-full rounded-xl border px-3 text-xs outline-none ${
                    isDark
                      ? 'border-white/10 bg-white/5 text-white'
                      : 'border-slate-200 bg-white text-slate-900'
                  }`}
                />
              </div>
            </div>

            {/* Question Statements */}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <textarea
                rows={3}
                value={qEn}
                onChange={(e) => setQEn(e.target.value)}
                placeholder="Question Statement (English)"
                className={`rounded-xl border p-3 text-xs outline-none ${
                  isDark
                    ? 'border-white/10 bg-white/5 text-white'
                    : 'border-slate-200 bg-white text-slate-900'
                }`}
              />
              <textarea
                rows={3}
                value={qHi}
                onChange={(e) => setQHi(e.target.value)}
                placeholder="प्रश्न कथन (हिन्दी)"
                className={`rounded-xl border p-3 text-xs outline-none ${
                  isDark
                    ? 'border-white/10 bg-white/5 text-white'
                    : 'border-slate-200 bg-white text-slate-900'
                }`}
              />
            </div>

            {/* 4 Options Bilingual */}
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="text"
                value={optEn0}
                onChange={(e) => setOptEn0(e.target.value)}
                placeholder="Option A (English)"
                className={`min-h-[38px] rounded-xl border px-3 text-xs outline-none ${
                  isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white'
                }`}
              />
              <input
                type="text"
                value={optHi0}
                onChange={(e) => setOptHi0(e.target.value)}
                placeholder="विकल्प A (हिन्दी)"
                className={`min-h-[38px] rounded-xl border px-3 text-xs outline-none ${
                  isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white'
                }`}
              />
              <input
                type="text"
                value={optEn1}
                onChange={(e) => setOptEn1(e.target.value)}
                placeholder="Option B (English)"
                className={`min-h-[38px] rounded-xl border px-3 text-xs outline-none ${
                  isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white'
                }`}
              />
              <input
                type="text"
                value={optHi1}
                onChange={(e) => setOptHi1(e.target.value)}
                placeholder="विकल्प B (हिन्दी)"
                className={`min-h-[38px] rounded-xl border px-3 text-xs outline-none ${
                  isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white'
                }`}
              />
              <input
                type="text"
                value={optEn2}
                onChange={(e) => setOptEn2(e.target.value)}
                placeholder="Option C (English)"
                className={`min-h-[38px] rounded-xl border px-3 text-xs outline-none ${
                  isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white'
                }`}
              />
              <input
                type="text"
                value={optHi2}
                onChange={(e) => setOptHi2(e.target.value)}
                placeholder="विकल्प C (हिन्दी)"
                className={`min-h-[38px] rounded-xl border px-3 text-xs outline-none ${
                  isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white'
                }`}
              />
              <input
                type="text"
                value={optEn3}
                onChange={(e) => setOptEn3(e.target.value)}
                placeholder="Option D (English)"
                className={`min-h-[38px] rounded-xl border px-3 text-xs outline-none ${
                  isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white'
                }`}
              />
              <input
                type="text"
                value={optHi3}
                onChange={(e) => setOptHi3(e.target.value)}
                placeholder="विकल्प D (हिन्दी)"
                className={`min-h-[38px] rounded-xl border px-3 text-xs outline-none ${
                  isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white'
                }`}
              />
            </div>

            {/* Correct Answer & Tag */}
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs text-slate-400">Correct Option</label>
                <select
                  value={qCorrectIdx}
                  onChange={(e) => setQCorrectIdx(Number(e.target.value))}
                  className={`mt-1 min-h-[40px] w-full rounded-xl border px-3 text-xs outline-none ${
                    isDark ? 'border-white/10 bg-[#0F172A]' : 'border-slate-200 bg-white'
                  }`}
                >
                  <option value={0}>Option A</option>
                  <option value={1}>Option B</option>
                  <option value={2}>Option C</option>
                  <option value={3}>Option D</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400">PYQ Shift Tag</label>
                <input
                  type="text"
                  value={qPyqTag}
                  onChange={(e) => setQPyqTag(e.target.value)}
                  className={`mt-1 min-h-[40px] w-full rounded-xl border px-3 text-xs outline-none ${
                    isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white'
                  }`}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400">Difficulty</label>
                <select
                  value={qDifficulty}
                  onChange={(e) =>
                    setQDifficulty(e.target.value as 'Easy' | 'Moderate' | 'Hard')
                  }
                  className={`mt-1 min-h-[40px] w-full rounded-xl border px-3 text-xs outline-none ${
                    isDark ? 'border-white/10 bg-[#0F172A]' : 'border-slate-200 bg-white'
                  }`}
                >
                  <option value="Easy">Easy</option>
                  <option value="Moderate">Moderate</option>
                  <option value="Hard">Hard</option>
                </select>
              </div>
            </div>

            {/* Dual Explanations */}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <textarea
                rows={2}
                value={qBasicEn}
                onChange={(e) => setQBasicEn(e.target.value)}
                placeholder="Method 1: Basic Concept (English)"
                className={`rounded-xl border p-2.5 text-xs outline-none ${
                  isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white'
                }`}
              />
              <textarea
                rows={2}
                value={qTrickEn}
                onChange={(e) => setQTrickEn(e.target.value)}
                placeholder="Method 2: 15-Second Exam Trick (English)"
                className={`rounded-xl border p-2.5 text-xs outline-none ${
                  isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white'
                }`}
              />
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowQuestionModal(false)}
                className="min-h-[42px] rounded-xl border border-white/15 px-4 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveQuestion}
                className="min-h-[42px] rounded-xl bg-indigo-600 px-5 text-xs font-bold text-white hover:bg-indigo-500"
              >
                Save Question
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================================================
          CONFIRM DELETE DIALOG
         ========================================================================== */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div
            className={`w-full max-w-sm rounded-2xl p-6 ${
              isDark ? 'surface-card-dark text-slate-100' : 'surface-card-light text-slate-900'
            }`}
          >
            <AlertTriangle className="h-8 w-8 text-rose-400" />
            <h3 className="mt-2 text-base font-bold">Confirm Deletion</h3>
            <p className="mt-1 text-xs text-slate-400">
              Are you sure you want to permanently delete {confirmDelete.label}?
            </p>
            <div className="mt-5 flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="min-h-[42px] flex-1 rounded-xl border border-white/15 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete.onConfirm}
                className="min-h-[42px] flex-1 rounded-xl bg-rose-600 text-xs font-bold text-white"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
