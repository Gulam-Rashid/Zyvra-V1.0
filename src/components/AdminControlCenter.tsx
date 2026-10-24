import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  Gift,
  Headphones,
  Image as ImageIcon,
  KeyRound,
  Layers,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Shield,
  Sliders,
  Sparkles,
  Star,
  Tag,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  AdminSecurityAuditEntry,
  CommissionStatus,
  CouponCode,
  CustomFolder,
  DynamicCategoryNode,
  ExamCategory,
  ExamFamily,
  ExamStageConfig,
  GitHubSyncConfig,
  ImportBatchHistory,
  MasterDatabase,
  OfferTemplateId,
  PromotionalOfferItem,
  Question,
  QuestionExamMapping,
  QuestionSourceClassification,
  ReferralCommissionRecord,
  ReferralPolicyConfig,
  StudentFeedbackItem,
  StudentSaleLog,
  StudyNote,
  SupportContactConfig,
  SupportTicket,
  TestSeriesPack,
} from '../types/database';
import {
  AdminSession,
  clearAdminSession,
  generateProKey,
  getActiveAdminSession,
  hasLocalAdminCredentials,
  initializeOrUpdateLocalAdminCredentials,
  normalizeWhatsAppNumber,
  saveAdminSession,
  verifyGitHubRepoOwnershipForReset,
  verifyLocalAdminCredentials,
} from '../utils/cryptoLock';
import {
  computeQuestionFingerprint,
  createSyncAuditEntry,
  getAdminAuthHeaders,
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
  | 'categories'
  | 'subjects'
  | 'questions'
  | 'import'
  | 'tests'
  | 'notes'
  | 'students'
  | 'pricing'
  | 'referrals'
  | 'support'
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

  // Admin Session & Login State (No hardcoded Login ID or Passcode)
  const [adminSession, setAdminSession] = useState<AdminSession | null>(() =>
    getActiveAdminSession()
  );
  const [isLocalCredInitialized, setIsLocalCredInitialized] = useState<boolean>(() =>
    hasLocalAdminCredentials()
  );
  const [authDialogMode, setAuthDialogMode] = useState<'signin' | 'setup' | 'recovery'>(() =>
    hasLocalAdminCredentials() ? 'signin' : 'setup'
  );
  const [loginIdInput, setLoginIdInput] = useState('');
  const [passcodeInput, setPasscodeInput] = useState('');
  const [passcodeConfirmInput, setPasscodeConfirmInput] = useState('');
  const [recoveryRepoInput, setRecoveryRepoInput] = useState('');
  const [recoveryPatInput, setRecoveryPatInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginSuccessMsg, setLoginSuccessMsg] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

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
  const [packFolderId, setPackFolderId] = useState(
    db.folders.find((f) => f.type === 'test')?.id || db.folders[0]?.id || 'folder-cgl-pyq'
  );
  // Phase 8: Admin Test Customization Rules State
  const [packCustomizationAllowed, setPackCustomizationAllowed] = useState(true);
  const [packAllowModeSwitch, setPackAllowModeSwitch] = useState(true);
  const [packAllowTimerChange, setPackAllowTimerChange] = useState(true);
  const [packAllowQCountChange, setPackAllowQCountChange] = useState(false);
  const [packRandomizeQuestions, setPackRandomizeQuestions] = useState(false);
  const [packCategoryId, setPackCategoryId] = useState(
    db.dynamicCategories?.find((c) => !c.parentId)?.id || ''
  );
  const [packSubcategoryId, setPackSubcategoryId] = useState('');

  // Phase 10: Dynamic Categories & Subcategories State
  const [catNameEn, setCatNameEn] = useState('');
  const [catNameHi, setCatNameHi] = useState('');
  const [catParentId, setCatParentId] = useState<string>('');
  const [catDesc, setCatDesc] = useState('');
  const [catOrder, setCatOrder] = useState('1');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);

  // Phase 11: Promotional Offers & Visual Templates State
  const [promoTitleEn, setPromoTitleEn] = useState('');
  const [promoTitleHi, setPromoTitleHi] = useState('');
  const [promoSubtitleEn, setPromoSubtitleEn] = useState('');
  const [promoBadgeText, setPromoBadgeText] = useState('SPECIAL OFFER');
  const [promoDiscountText, setPromoDiscountText] = useState('70% OFF');
  const [promoCouponCode, setPromoCouponCode] = useState('ZYVRA50');
  const [promoTemplateId, setPromoTemplateId] = useState<OfferTemplateId>('royal_indigo');
  const [promoCtaText, setPromoCtaText] = useState('Claim Offer Now');
  const [promoValidUntil, setPromoValidUntil] = useState('2027-12-31');
  const [promoBannerImageUrl, setPromoBannerImageUrl] = useState('');
  const [promoImageError, setPromoImageError] = useState('');

  // Phase 9: Refer & Earn Policy State
  const [referralForm, setReferralForm] = useState<ReferralPolicyConfig>(() =>
    db.referralPolicy || {
      enabled: true,
      commissionType: 'percent',
      commissionValue: 20,
      minPayoutThreshold: 100,
      qualifyingEvent: 'pro_activation',
      termsSummary:
        'Earn 20% commission on every verified Pro Pass upgrade made using your referral code.',
    }
  );

  // Phase 5: Support & Contact Config + Ticket Reply State
  const [supportForm, setSupportForm] = useState<SupportContactConfig>(() =>
    db.supportConfig || {
      supportEmail: 'support@zyvra.in',
      helplineNumber: '+91-9876543210',
      whatsappSupport: '+91-9876543210',
      workingHours: 'Mon – Sat, 9:00 AM to 7:00 PM IST',
      supportAddress: 'Zyvra EdTech Academic Desk, Patna & New Delhi, India',
      responseSlaEn: 'Standard response within 4 working hours.',
      responseSlaHi: 'सामान्यतः 4 कार्य घंटों के भीतर उत्तर दिया जाता है।',
    }
  );
  const [ticketReplyInputs, setTicketReplyInputs] = useState<Record<string, string>>({});

  // ============================================================================
  // 6. NOTES & PDFS STATE
  // ============================================================================
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
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
  // 7. STUDENTS & PRO KEY GENERATOR + WHATSAPP MANAGEMENT STATE
  // ============================================================================
  const [genStudentName, setGenStudentName] = useState('');
  const [genMobile, setGenMobile] = useState('');
  const [genDeviceId, setGenDeviceId] = useState('');
  const [genUtr, setGenUtr] = useState('');
  const [genAmount, setGenAmount] = useState(String(db.offers.offerPrice || 149));
  const [genScope, setGenScope] = useState('Universal All-Exams Pro');
  const [generatedKeyOutput, setGeneratedKeyOutput] = useState('');

  interface UnifiedStudentRecord {
    recordType: 'sale_and_profile' | 'sale_only' | 'profile_only';
    saleId: string | null;
    studentName: string;
    deviceId: string;
    mobile: string;
    whatsappNumber: string;
    whatsappVerified: boolean;
    whatsappUpdatedAt: string | null;
    whatsappUpdatedBy: string | null;
    proKey: string;
    utrNumber: string;
    amountPaid: number;
    paymentStatus: string;
    activatedAt: string;
    keyExpiresAt: string | null;
    keyRevoked: boolean;
    testHistoryCount: number;
  }

  const [serverStudents, setServerStudents] = useState<UnifiedStudentRecord[]>([]);
  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [editingStudentWa, setEditingStudentWa] = useState<UnifiedStudentRecord | null>(null);
  const [editWaNewValue, setEditWaNewValue] = useState('');
  const [editWaScope, setEditWaScope] = useState<'both' | 'sale_only' | 'profile_only'>('both');
  const [editWaConfirmed, setEditWaConfirmed] = useState(false);
  const [editWaBusy, setEditWaBusy] = useState(false);
  const [editWaFeedback, setEditWaFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // ============================================================================
  // 8. PRICING & COUPONS STATE
  // ============================================================================
  const [offerForm, setOfferForm] = useState({ ...db.offers });
  const [newCouponCode, setNewCouponCode] = useState('');
  const [newCouponType, setNewCouponType] = useState<'flat' | 'percent'>('flat');
  const [newCouponValue, setNewCouponValue] = useState('30');
  const [newCouponTag, setNewCouponTag] = useState('Educator Campaign');

  // ============================================================================
  // 9. CLOUD SYNC & SECURE ADMIN ACCOUNT SETTINGS (EMAIL OTP) STATE
  // ============================================================================
  const [ghConfig, setGhConfig] = useState<GitHubSyncConfig>(() => loadGitHubSyncConfig());
  const [syncBusy, setSyncBusy] = useState(false);

  const [adminSecInfo, setAdminSecInfo] = useState<{
    loginId: string;
    sessionVersion: number;
    updatedAt: string;
    emailOtpConfigured: boolean;
    smtpConfigured: boolean;
    auditLogs: AdminSecurityAuditEntry[];
  } | null>(null);
  const [secActionType, setSecActionType] = useState<
    'change_username' | 'change_password' | 'change_both'
  >('change_password');
  const [secCurrentPassword, setSecCurrentPassword] = useState('');
  const [secNewLoginId, setSecNewLoginId] = useState('');
  const [secNewPassword, setSecNewPassword] = useState('');
  const [secConfirmPassword, setSecConfirmPassword] = useState('');
  const [secOtpChallengeId, setSecOtpChallengeId] = useState<string | null>(null);
  const [secOtpCode, setSecOtpCode] = useState('');
  const [secOtpExpiresAt, setSecOtpExpiresAt] = useState<string | null>(null);
  const [secBusy, setSecBusy] = useState(false);
  const [secFeedback, setSecFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const apiBaseUrl =
    (typeof import.meta !== 'undefined' &&
      (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE_URL) ||
    '';

  const fetchServerStudents = useCallback(async (search = '') => {
    const base = apiBaseUrl.trim().replace(/\/$/, '');
    try {
      const qs = search.trim() ? `?q=${encodeURIComponent(search.trim())}` : '';
      const res = await fetch(`${base}/api/admin/students${qs}`, {
        headers: getAdminAuthHeaders(),
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.students)) {
          setServerStudents(data.students);
          return;
        }
      }
    } catch {
      // Fallback to local db.salesLog when offline
    }
    const localRows: UnifiedStudentRecord[] = (db.salesLog || []).map((sale) => {
      const norm = normalizeWhatsAppNumber(sale.whatsappNumber || sale.mobile || '');
      return {
        recordType: 'sale_only',
        saleId: sale.id,
        studentName: sale.studentName,
        deviceId: sale.deviceId,
        mobile: sale.mobile,
        whatsappNumber: norm.valid ? norm.normalized : sale.whatsappNumber || `+91${sale.mobile}`,
        whatsappVerified: Boolean(sale.whatsappVerified),
        whatsappUpdatedAt: sale.whatsappUpdatedAt || null,
        whatsappUpdatedBy: sale.whatsappUpdatedBy || null,
        proKey: sale.proKey || sale.generatedProKey || '',
        utrNumber: sale.utrNumber,
        amountPaid: sale.amountPaid,
        paymentStatus: sale.paymentStatus || 'paid',
        activatedAt: sale.activatedAt || sale.createdAt || '',
        keyExpiresAt: sale.keyExpiresAt ? String(sale.keyExpiresAt) : null,
        keyRevoked: Boolean(sale.keyRevoked),
        testHistoryCount: 0,
      };
    });
    setServerStudents(localRows);
  }, [apiBaseUrl, db.salesLog]);

  const fetchAdminSecurityInfo = useCallback(async () => {
    const base = apiBaseUrl.trim().replace(/\/$/, '');
    try {
      const res = await fetch(`${base}/api/admin/account/info`, {
        headers: getAdminAuthHeaders(),
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setAdminSecInfo({
          loginId: data.loginId,
          sessionVersion: data.sessionVersion || 1,
          updatedAt: data.updatedAt || new Date().toISOString(),
          emailOtpConfigured: Boolean(data.emailOtpConfigured),
          smtpConfigured: Boolean(data.smtpConfigured),
          auditLogs: Array.isArray(data.auditLogs) ? data.auditLogs : [],
        });
      }
    } catch {
      // Offline mode
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    if (!adminSession) return;
    if (activeSection === 'students') {
      fetchServerStudents(studentSearchQuery);
    } else if (activeSection === 'sync') {
      fetchAdminSecurityInfo();
    }
  }, [
    adminSession,
    activeSection,
    studentSearchQuery,
    fetchServerStudents,
    fetchAdminSecurityInfo,
  ]);

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
  // ADMIN AUTHENTICATION HANDLERS (Mobile + Backend API + Salted Local Owner Auth)
  // ============================================================================
  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginBusy(true);
    setLoginError('');
    setLoginSuccessMsg('');

    const base = apiBaseUrl.trim().replace(/\/$/, '');

    // Path 1: Explicit VITE_API_BASE_URL Backend Authentication
    if (base) {
      try {
        const res = await fetch(`${base}/api/admin/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loginId: loginIdInput.trim(),
            password: passcodeInput,
            autoProvisionIfUnconfigured: true,
          }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          setLoginError(errData.error || 'Backend authentication failed: Invalid credentials.');
          setLoginBusy(false);
          return;
        }
        const data = await res.json();
        const session: AdminSession = {
          loginId: loginIdInput.trim(),
          mode: 'backend_jwt',
          token: data.token,
          authenticatedAt: new Date().toLocaleTimeString('en-IN'),
          expiresAt: Date.now() + 8 * 60 * 60 * 1000,
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

    // Path 2A: Initial Owner Setup (provisions both local salted hash AND unified same-origin backend)
    if (authDialogMode === 'setup') {
      if (passcodeInput !== passcodeConfirmInput) {
        setLoginError('Passcode and Confirm Passcode do not match.');
        setLoginBusy(false);
        return;
      }
      const initRes = await initializeOrUpdateLocalAdminCredentials(loginIdInput, passcodeInput);
      if (!initRes.ok) {
        setLoginError(initRes.error || 'Failed to initialize credentials.');
        setLoginBusy(false);
        return;
      }
      let backendToken: string | undefined;
      try {
        const srvRes = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loginId: loginIdInput.trim(),
            password: passcodeInput,
            autoProvisionIfUnconfigured: true,
          }),
        });
        if (srvRes.ok) {
          const srvData = await srvRes.json();
          backendToken = srvData.token;
        }
      } catch {
        // Offline / static deployment fallback
      }

      setIsLocalCredInitialized(true);
      const session: AdminSession = {
        loginId: loginIdInput.trim(),
        mode: backendToken ? 'backend_jwt' : 'local_owner',
        token: backendToken,
        authenticatedAt: new Date().toLocaleTimeString('en-IN'),
        expiresAt: Date.now() + 8 * 60 * 60 * 1000,
      };
      saveAdminSession(session);
      setAdminSession(session);
      setPasscodeInput('');
      setPasscodeConfirmInput('');
      setLoginBusy(false);
      return;
    }

    // Path 2B: Owner Credential Recovery via GitHub Repository Ownership Verification
    if (authDialogMode === 'recovery') {
      if (passcodeInput !== passcodeConfirmInput) {
        setLoginError('New Passcode and Confirm Passcode do not match.');
        setLoginBusy(false);
        return;
      }
      const ghVerify = await verifyGitHubRepoOwnershipForReset(recoveryRepoInput, recoveryPatInput);
      if (!ghVerify.ok) {
        setLoginError(ghVerify.error || 'GitHub repository ownership verification failed.');
        setLoginBusy(false);
        return;
      }
      const resetRes = await initializeOrUpdateLocalAdminCredentials(loginIdInput, passcodeInput);
      if (!resetRes.ok) {
        setLoginError(resetRes.error || 'Failed to save new credentials.');
        setLoginBusy(false);
        return;
      }
      setIsLocalCredInitialized(true);
      setRecoveryPatInput('');
      setPasscodeInput('');
      setPasscodeConfirmInput('');
      setAuthDialogMode('signin');
      setLoginSuccessMsg('Repository ownership verified! Your new Admin credentials have been saved.');
      setLoginBusy(false);
      return;
    }

    // Path 2C: Sign-In (Checks unified same-origin backend first, then local salted SHA-256 only if backend is unreachable)
    try {
      const srvRes = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loginId: loginIdInput.trim(),
          password: passcodeInput,
        }),
      });
      if (srvRes.ok) {
        const srvData = await srvRes.json();
        await initializeOrUpdateLocalAdminCredentials(loginIdInput.trim(), passcodeInput);
        setIsLocalCredInitialized(true);
        const session: AdminSession = {
          loginId: loginIdInput.trim(),
          mode: 'backend_jwt',
          token: srvData.token,
          authenticatedAt: new Date().toLocaleTimeString('en-IN'),
          expiresAt: Date.now() + 8 * 60 * 60 * 1000,
        };
        saveAdminSession(session);
        setAdminSession(session);
        setPasscodeInput('');
        setLoginBusy(false);
        return;
      }
      if (srvRes.status === 401 || srvRes.status === 429) {
        const errData = await srvRes.json().catch(() => ({}));
        setLoginError(errData.error || 'Invalid Admin Login ID or Passcode.');
        setLoginBusy(false);
        return;
      }
    } catch {
      // Fall through to local salted hash verification only when offline or static deployment
    }

    const check = await verifyLocalAdminCredentials(loginIdInput, passcodeInput);
    setLoginBusy(false);

    if (!check.ok) {
      setLoginError(check.error || 'Authentication failed.');
      return;
    }

    const session: AdminSession = {
      loginId: loginIdInput.trim(),
      mode: 'local_owner',
      authenticatedAt: new Date().toLocaleTimeString('en-IN'),
      expiresAt: Date.now() + 8 * 60 * 60 * 1000,
    };
    saveAdminSession(session);
    setAdminSession(session);
    setPasscodeInput('');
  };

  const handleAdminLogout = () => {
    fetch('/api/admin/logout', { method: 'POST' }).catch(() => {});
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
      folderId: packFolderId || db.folders[0]?.id || 'folder-cgl-pyq',
      subject: 'All Subjects',
      questionIds: qIds,
      durationMinutes: parseInt(packDuration, 10) || 30,
      marksPerCorrect: parseFloat(packMarksCorrect) || 2.0,
      negativeMarking: parseFloat(packNegMarks) >= 0 ? parseFloat(packNegMarks) : 0.5,
      shiftTag: packShiftTag.trim() || 'Official Set',
      isPro: packIsPro,
      categoryId: packCategoryId || undefined,
      subcategoryId: packSubcategoryId || undefined,
      dynamicCategoryId: packCategoryId || undefined,
      dynamicSubcategoryId: packSubcategoryId || undefined,
      customizationRules: {
        customizationAllowed: packCustomizationAllowed,
        allowModeSwitch: packCustomizationAllowed ? packAllowModeSwitch : false,
        allowTimerChange: packCustomizationAllowed ? packAllowTimerChange : false,
        allowQuestionCountChange: packCustomizationAllowed ? packAllowQCountChange : false,
        allowCategoryFilter: false,
        randomizeQuestions: packRandomizeQuestions,
      },
    };
    onUpdateDatabase({
      ...db,
      testSeries: [newPack, ...db.testSeries],
    });
    setPackTitleEn('');
    setPackTitleHi('');
    notify(
      `Published Test Pack "${newPack.title_en}" (${
        packCustomizationAllowed ? 'Customizable' : 'Fixed Parameters'
      }).`
    );
  };

  // Phase 10: Save Dynamic Category / Subcategory
  const handleSaveDynamicCategory = () => {
    if (!catNameEn.trim()) {
      notify('Enter category or subcategory name in English.', false);
      return;
    }
    const list = db.dynamicCategories || [];
    const slug = catNameEn
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    if (editingCatId) {
      let editedNode: DynamicCategoryNode | null = null;
      const updated = list.map((c) => {
        if (c.id === editingCatId) {
          editedNode = {
            ...c,
            name: catNameEn.trim(),
            name_en: catNameEn.trim(),
            name_hi: catNameHi.trim() || catNameEn.trim(),
            slug,
            parentId: catParentId || null,
            description: catDesc.trim() || undefined,
            order: Number(catOrder) || 1,
          };
          return editedNode;
        }
        return c;
      });
      onUpdateDatabase({ ...db, dynamicCategories: updated });
      if (editedNode) {
        fetch('/api/admin/categories', {
          method: 'POST',
          headers: getAdminAuthHeaders(),
          credentials: 'include',
          body: JSON.stringify(editedNode),
        }).catch(() => {});
      }
      setEditingCatId(null);
      notify(`Updated category "${catNameEn.trim()}".`);
    } else {
      const node: DynamicCategoryNode = {
        id: `dcat-${Date.now()}`,
        name: catNameEn.trim(),
        name_en: catNameEn.trim(),
        name_hi: catNameHi.trim() || catNameEn.trim(),
        slug,
        parentId: catParentId || null,
        description: catDesc.trim() || undefined,
        order: Number(catOrder) || list.length + 1,
        status: 'active',
        createdAt: Date.now(),
      };
      onUpdateDatabase({ ...db, dynamicCategories: [...list, node] });
      fetch('/api/admin/categories', {
        method: 'POST',
        headers: getAdminAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(node),
      }).catch(() => {});
      notify(
        `Created ${catParentId ? 'Subcategory' : 'Main Category'} "${node.name_en}".`
      );
    }
    setCatNameEn('');
    setCatNameHi('');
    setCatDesc('');
  };

  // Phase 11: Promotional Offer Image Upload & Offer Creation
  const handlePromoBannerFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setPromoImageError('');
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPromoImageError('Invalid file format. Please select a PNG, JPG, WEBP, or SVG image.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setPromoImageError('Image exceeds 2MB size limit. Please choose a smaller image.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') {
        const dataUrl = reader.result;
        try {
          const res = await fetch('/api/admin/offers/upload-image', {
            method: 'POST',
            headers: getAdminAuthHeaders(),
            credentials: 'include',
            body: JSON.stringify({ dataUrl, fileName: file.name }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            setPromoImageError(err.error || 'Image validation failed.');
            return;
          }
        } catch {
          // Offline local validation already passed
        }
        setPromoBannerImageUrl(dataUrl);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCreatePromoOffer = () => {
    if (!promoTitleEn.trim()) {
      notify('Enter an Offer Headline first.', false);
      return;
    }
    const subtitleDefault =
      promoSubtitleEn.trim() ||
      'Unlock all verified PYQ papers, mock tests, and dual-method solutions.';
    const item: PromotionalOfferItem = {
      id: `promo-${Date.now()}`,
      title: promoTitleEn.trim(),
      title_en: promoTitleEn.trim(),
      title_hi: promoTitleHi.trim() || promoTitleEn.trim(),
      subtitle: subtitleDefault,
      subtitle_en: subtitleDefault,
      subtitle_hi:
        promoSubtitleEn.trim() ||
        'सभी परीक्षाओं के PYQ और मॉक टेस्ट अनलॉक करें।',
      badgeText: promoBadgeText.trim() || 'LIMITED OFFER',
      discountText: promoDiscountText.trim() || '70% OFF',
      couponCode: promoCouponCode.trim().toUpperCase() || undefined,
      templateId: promoTemplateId,
      bannerImageUrl: promoBannerImageUrl || undefined,
      ctaText: promoCtaText.trim() || 'Unlock Now',
      originalPrice: db.offers?.mrp || 999,
      finalPrice: db.offers?.offerPrice || 149,
      validFrom: new Date().toISOString().slice(0, 10),
      validUntil: promoValidUntil || '2027-12-31',
      priority: (db.promotionalOffers || []).length + 1,
      active: true,
      isActive: true,
    };
    onUpdateDatabase({
      ...db,
      promotionalOffers: [item, ...(db.promotionalOffers || [])],
    });
    fetch('/api/admin/offers', {
      method: 'POST',
      headers: getAdminAuthHeaders(),
      credentials: 'include',
      body: JSON.stringify(item),
    }).catch(() => {});
    setPromoTitleEn('');
    setPromoTitleHi('');
    setPromoSubtitleEn('');
    setPromoBannerImageUrl('');
    notify(`Published Promotional Offer "${item.title_en}".`);
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

  const handleEditNote = (n: StudyNote) => {
    setEditingNoteId(n.id);
    setNoteTitleEn(n.title_en);
    setNoteTitleHi(n.title_hi || n.title_en);
    setNoteType(n.type);
    setNoteExam(n.exam || db.exams[0]?.name || 'SSC CGL');
    setNoteSubject(n.subject);
    setNoteTopic(n.topic || 'Revision Sheet');
    setNoteFolderId(n.folderId || db.folders[0]?.id || 'folder-notes');
    setNoteContentEn(n.content_en);
    setNoteContentHi(n.content_hi);
    setNotePdfDataUrl(n.pdfUrl || '');
    setNoteAllowDownload(Boolean(n.allowDownload));
    setNoteIsPro(Boolean(n.isPro));
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
      id: editingNoteId || `note-${Date.now()}`,
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
    const updatedNotes = editingNoteId
      ? db.notes.map((n) => (n.id === editingNoteId ? newNote : n))
      : [newNote, ...db.notes];
    onUpdateDatabase({
      ...db,
      notes: updatedNotes,
    });
    setEditingNoteId(null);
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
    const rawMobile = genMobile.trim() || '9876543210';
    const waCheck = normalizeWhatsAppNumber(rawMobile);
    if (!waCheck.valid) {
      notify(waCheck.error || 'Enter a valid WhatsApp/mobile number.', false);
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
      mobile: waCheck.localMobile,
      whatsappNumber: waCheck.normalized,
      whatsappVerified: false,
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
    notify(`Generated Device-Locked Pro Key: ${proKey} (WhatsApp: ${waCheck.normalized})`);
  };

  const handleSaveStudentWhatsApp = async () => {
    if (!editingStudentWa) return;
    setEditWaFeedback(null);
    const waCheck = normalizeWhatsAppNumber(editWaNewValue);
    if (!waCheck.valid) {
      setEditWaFeedback({ ok: false, text: waCheck.error || 'Invalid WhatsApp number format.' });
      return;
    }
    if (!editWaConfirmed) {
      setEditWaFeedback({
        ok: false,
        text: 'Please check the confirmation box acknowledging the impact before saving.',
      });
      return;
    }

    setEditWaBusy(true);
    const base = apiBaseUrl.trim().replace(/\/$/, '');
    try {
      const res = await fetch(`${base}/api/admin/students/whatsapp`, {
        method: 'PATCH',
        headers: getAdminAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          saleId: editingStudentWa.saleId,
          deviceId: editingStudentWa.deviceId,
          whatsappNumber: waCheck.normalized,
          updateScope: editWaScope,
          confirmImpact: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditWaFeedback({
          ok: false,
          text: data.error || 'Failed to update student WhatsApp number on server.',
        });
        setEditWaBusy(false);
        return;
      }

      const nowIso = new Date().toISOString();
      const updatedSales = (db.salesLog || []).map((s) => {
        const matchesSale = editingStudentWa.saleId && s.id === editingStudentWa.saleId;
        const matchesDevice =
          !editingStudentWa.saleId && s.deviceId === editingStudentWa.deviceId;
        if ((matchesSale || matchesDevice) && (editWaScope === 'both' || editWaScope === 'sale_only')) {
          return {
            ...s,
            mobile: waCheck.localMobile,
            whatsappNumber: waCheck.normalized,
            whatsappVerified: false,
            whatsappUpdatedAt: nowIso,
            whatsappUpdatedBy: adminSession?.loginId || 'admin',
          };
        }
        return s;
      });

      const nextAuditLogs = data.auditEntry
        ? [data.auditEntry, ...(db.adminAuditLogs || [])]
        : db.adminAuditLogs || [];

      onUpdateDatabase({
        ...db,
        salesLog: updatedSales,
        adminAuditLogs: nextAuditLogs,
      });

      await fetchServerStudents(studentSearchQuery);
      setEditWaBusy(false);
      setEditingStudentWa(null);
      setEditWaConfirmed(false);
      notify(data.message || `Updated WhatsApp number to ${waCheck.normalized}`);
    } catch {
      setEditWaFeedback({
        ok: false,
        text: 'Network error while saving WhatsApp number to backend.',
      });
      setEditWaBusy(false);
    }
  };

  const handleToggleStudentKeyRevoke = async (student: UnifiedStudentRecord) => {
    const base = apiBaseUrl.trim().replace(/\/$/, '');
    const nextRevoked = !student.keyRevoked;
    try {
      const res = await fetch(`${base}/api/admin/students/key-status`, {
        method: 'POST',
        headers: getAdminAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          saleId: student.saleId,
          deviceId: student.deviceId,
          keyRevoked: nextRevoked,
          keyExpiresAt: student.keyExpiresAt,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify(data.error || 'Failed to update key status.', false);
        return;
      }
      const updatedSales = (db.salesLog || []).map((s) =>
        (student.saleId && s.id === student.saleId) || s.deviceId === student.deviceId
          ? { ...s, keyRevoked: nextRevoked }
          : s
      );
      onUpdateDatabase({
        ...db,
        salesLog: updatedSales,
      });
      await fetchServerStudents(studentSearchQuery);
      notify(data.message || (nextRevoked ? 'Key revoked.' : 'Key restored.'));
    } catch {
      notify('Could not reach backend to update key status.', false);
    }
  };

  const handleRequestAdminEmailOtp = async () => {
    setSecFeedback(null);
    if (!secCurrentPassword) {
      setSecFeedback({ ok: false, text: 'Enter your current Admin Password first.' });
      return;
    }
    if (
      (secActionType === 'change_username' || secActionType === 'change_both') &&
      secNewLoginId.trim().length < 4
    ) {
      setSecFeedback({
        ok: false,
        text: 'New Admin Login ID must be between 4 and 32 characters.',
      });
      return;
    }
    if (secActionType === 'change_password' || secActionType === 'change_both') {
      if (secNewPassword.length < 8) {
        setSecFeedback({
          ok: false,
          text: 'New Admin Password must be at least 8 characters long.',
        });
        return;
      }
      if (secNewPassword !== secConfirmPassword) {
        setSecFeedback({
          ok: false,
          text: 'New Password and Confirm New Password do not match.',
        });
        return;
      }
    }

    setSecBusy(true);
    const base = apiBaseUrl.trim().replace(/\/$/, '');
    try {
      const res = await fetch(`${base}/api/admin/account/request-otp`, {
        method: 'POST',
        headers: getAdminAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          actionType: secActionType,
          currentPassword: secCurrentPassword,
          newLoginId:
            secActionType === 'change_username' || secActionType === 'change_both'
              ? secNewLoginId.trim()
              : undefined,
          newPassword:
            secActionType === 'change_password' || secActionType === 'change_both'
              ? secNewPassword
              : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setSecBusy(false);
      if (!res.ok) {
        setSecFeedback({
          ok: false,
          text: data.error || 'Could not send Email OTP verification code.',
        });
        return;
      }
      setSecOtpChallengeId(data.challengeId);
      setSecOtpExpiresAt(data.expiresAt || null);
      setSecOtpCode('');
      setSecFeedback({
        ok: true,
        text:
          data.message ||
          'A 6-digit verification code has been sent to the private administrator email.',
      });
    } catch {
      setSecBusy(false);
      setSecFeedback({
        ok: false,
        text: 'Could not reach backend server to request Email OTP.',
      });
    }
  };

  const handleVerifyAdminEmailOtpAndSave = async () => {
    if (!secOtpChallengeId) return;
    setSecFeedback(null);
    if (!/^\d{6}$/.test(secOtpCode.trim())) {
      setSecFeedback({ ok: false, text: 'Enter the 6-digit verification code from your email.' });
      return;
    }

    setSecBusy(true);
    const base = apiBaseUrl.trim().replace(/\/$/, '');
    try {
      const res = await fetch(`${base}/api/admin/account/verify-and-update`, {
        method: 'POST',
        headers: getAdminAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          challengeId: secOtpChallengeId,
          otpCode: secOtpCode.trim(),
          currentPassword: secCurrentPassword,
          newLoginId:
            secActionType === 'change_username' || secActionType === 'change_both'
              ? secNewLoginId.trim()
              : undefined,
          newPassword:
            secActionType === 'change_password' || secActionType === 'change_both'
              ? secNewPassword
              : undefined,
          confirmNewPassword:
            secActionType === 'change_password' || secActionType === 'change_both'
              ? secConfirmPassword
              : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setSecBusy(false);
      if (!res.ok) {
        setSecFeedback({
          ok: false,
          text: data.error || 'OTP verification failed.',
        });
        return;
      }

      const updatedLoginId = data.loginId || adminSession?.loginId || 'admin';
      const effectivePassword =
        secActionType === 'change_password' || secActionType === 'change_both'
          ? secNewPassword
          : secCurrentPassword;
      await initializeOrUpdateLocalAdminCredentials(updatedLoginId, effectivePassword);

      const nextSession: AdminSession = {
        loginId: updatedLoginId,
        mode: 'backend_jwt',
        token: data.token,
        authenticatedAt: new Date().toLocaleTimeString('en-IN'),
        expiresAt: Date.now() + 8 * 60 * 60 * 1000,
      };
      saveAdminSession(nextSession);
      setAdminSession(nextSession);

      // Clear sensitive inputs immediately
      setSecCurrentPassword('');
      setSecNewLoginId('');
      setSecNewPassword('');
      setSecConfirmPassword('');
      setSecOtpCode('');
      setSecOtpChallengeId(null);
      setSecOtpExpiresAt(null);

      await fetchAdminSecurityInfo();
      setSecFeedback({
        ok: true,
        text: data.message || 'Admin credentials updated and re-authenticated.',
      });
      notify(data.message || 'Admin credentials updated.');
    } catch {
      setSecBusy(false);
      setSecFeedback({
        ok: false,
        text: 'Network error while verifying OTP.',
      });
    }
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
  // ZYVRA ADMIN AUTHENTICATION SCREEN (No Exposed Credentials)
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
              title="Close Admin Dialog"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-indigo-400">
              <Shield className="h-3.5 w-3.5" />
              {apiBaseUrl
                ? 'Server-Side Administrator Authentication'
                : authDialogMode === 'setup'
                ? 'Initial Owner Credential Setup'
                : authDialogMode === 'recovery'
                ? 'Owner Credential Reset (GitHub Verified)'
                : 'Administrator Authentication'}
            </span>
            <h2 className="mt-1 text-lg font-bold">
              {apiBaseUrl
                ? 'Sign in to Zyvra Control Center'
                : authDialogMode === 'setup'
                ? 'Create Owner Admin Credentials'
                : authDialogMode === 'recovery'
                ? 'Reset Local Admin Credentials'
                : 'Sign in to Zyvra Control Center'}
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              {apiBaseUrl
                ? 'Enter your server-configured Administrator Login ID and Passcode.'
                : authDialogMode === 'setup'
                ? 'No local administrator credentials exist on this browser yet. Configure your private Admin Login ID and Passcode below (stored locally as salted SHA-256 hashes).'
                : authDialogMode === 'recovery'
                ? 'Verify write access to your GitHub repository using a Personal Access Token (PAT) to safely set a new Admin Login ID and Passcode without losing any student or exam data.'
                : 'Enter your configured Administrator Login ID and Passcode.'}
            </p>
          </div>

          {/* Mode Tabs for Static / Local Owner Deployment */}
          {!apiBaseUrl && (
            <div
              className={`mt-4 grid grid-cols-2 gap-1.5 rounded-xl p-1 ${
                isDark ? 'bg-white/[0.04]' : 'bg-slate-100'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  setLoginError('');
                  setLoginSuccessMsg('');
                  setAuthDialogMode(isLocalCredInitialized ? 'signin' : 'setup');
                }}
                className={`min-h-[36px] rounded-lg text-xs font-bold transition ${
                  authDialogMode !== 'recovery'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {isLocalCredInitialized ? 'Admin Sign In' : 'First-Time Owner Setup'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setLoginError('');
                  setLoginSuccessMsg('');
                  setAuthDialogMode('recovery');
                }}
                className={`min-h-[36px] rounded-lg text-xs font-bold transition ${
                  authDialogMode === 'recovery'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Owner Credential Reset
              </button>
            </div>
          )}

          <div className="mt-4 space-y-3.5">
            {!apiBaseUrl && authDialogMode === 'recovery' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-400">
                    Connected GitHub Repository (owner/repo)
                  </label>
                  <input
                    type="text"
                    value={recoveryRepoInput}
                    onChange={(e) => setRecoveryRepoInput(e.target.value)}
                    placeholder="e.g. username/Zyvra-V1.0"
                    required
                    className={`mt-1 min-h-[42px] w-full rounded-xl border px-3.5 text-xs font-semibold outline-none ${
                      isDark
                        ? 'border-white/15 bg-white/5 text-white'
                        : 'border-slate-300 bg-slate-50 text-slate-900'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400">
                    GitHub Personal Access Token (with repo write access)
                  </label>
                  <input
                    type="password"
                    value={recoveryPatInput}
                    onChange={(e) => setRecoveryPatInput(e.target.value)}
                    placeholder="ghp_... or github_pat_..."
                    required
                    className={`mt-1 min-h-[42px] w-full rounded-xl border px-3.5 font-mono text-xs outline-none ${
                      isDark
                        ? 'border-white/15 bg-white/5 text-white'
                        : 'border-slate-300 bg-slate-50 text-slate-900'
                    }`}
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-400">
                {authDialogMode === 'setup' || authDialogMode === 'recovery'
                  ? 'New Admin Login ID (min 4 chars)'
                  : 'Admin Login ID'}
              </label>
              <input
                type="text"
                value={loginIdInput}
                onChange={(e) => setLoginIdInput(e.target.value)}
                placeholder="Enter Admin Login ID"
                autoComplete="off"
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
                {authDialogMode === 'setup' || authDialogMode === 'recovery'
                  ? 'New Administrator Passcode (min 6 chars)'
                  : 'Administrator Passcode'}
              </label>
              <input
                type="password"
                value={passcodeInput}
                onChange={(e) => setPasscodeInput(e.target.value)}
                placeholder="Enter Passcode"
                autoComplete="new-password"
                required
                className={`mt-1 min-h-[44px] w-full rounded-xl border px-3.5 font-mono text-sm tracking-wider outline-none ${
                  isDark
                    ? 'border-white/15 bg-white/5 text-white'
                    : 'border-slate-300 bg-slate-50 text-slate-900'
                }`}
              />
            </div>

            {!apiBaseUrl && (authDialogMode === 'setup' || authDialogMode === 'recovery') && (
              <div>
                <label className="block text-xs font-semibold text-slate-400">
                  Confirm New Passcode
                </label>
                <input
                  type="password"
                  value={passcodeConfirmInput}
                  onChange={(e) => setPasscodeConfirmInput(e.target.value)}
                  placeholder="Re-enter Passcode"
                  autoComplete="new-password"
                  required
                  className={`mt-1 min-h-[44px] w-full rounded-xl border px-3.5 font-mono text-sm tracking-wider outline-none ${
                    isDark
                      ? 'border-white/15 bg-white/5 text-white'
                      : 'border-slate-300 bg-slate-50 text-slate-900'
                  }`}
                />
              </div>
            )}
          </div>

          {loginError && (
            <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-300">
              {loginError}
            </div>
          )}

          {loginSuccessMsg && (
            <div className="mt-3 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-300">
              {loginSuccessMsg}
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
            <strong className="text-slate-300">Security Architecture Note:</strong>{' '}
            {apiBaseUrl
              ? `Connected to Backend Auth Server (${apiBaseUrl}). Credentials are verified server-side using salted cryptographic hashing.`
              : 'GitHub Pages hosts static frontend files only and cannot enforce a true server-side security boundary. In static mode, credentials are salted and SHA-256 hashed in your browser storage. For production server-enforced security, deploy the backend API (server.ts) and set VITE_API_BASE_URL.'}
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
              {loginBusy
                ? 'Processing...'
                : apiBaseUrl
                ? 'Sign In'
                : authDialogMode === 'setup'
                ? 'Initialize & Sign In'
                : authDialogMode === 'recovery'
                ? 'Verify & Reset Credentials'
                : 'Sign In as Admin'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  const navItems: Array<{ id: AdminSection; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: 'exams', label: 'Exams & Families', icon: <Layers className="h-4 w-4" /> },
    {
      id: 'categories',
      label: 'Categories & Subcategories',
      icon: <Sliders className="h-4 w-4" />,
    },
    { id: 'subjects', label: 'Subjects & Chapters', icon: <BookOpen className="h-4 w-4" /> },
    { id: 'questions', label: 'Question Bank', icon: <Database className="h-4 w-4" /> },
    { id: 'import', label: 'Import & Export', icon: <Upload className="h-4 w-4" /> },
    { id: 'tests', label: 'Tests & Customization', icon: <FolderPlus className="h-4 w-4" /> },
    { id: 'notes', label: 'Notes & PDFs', icon: <FileText className="h-4 w-4" /> },
    { id: 'students', label: 'Students & Pro Keys', icon: <Users className="h-4 w-4" /> },
    { id: 'pricing', label: 'Offers & Templates', icon: <Tag className="h-4 w-4" /> },
    { id: 'referrals', label: 'Refer & Earn Ledger', icon: <Gift className="h-4 w-4" /> },
    {
      id: 'support',
      label: 'Feedback & Support Desk',
      icon: <Headphones className="h-4 w-4" />,
    },
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
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold sm:px-3 ${
              isDark
                ? 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
            }`}
            title="Export Master Database JSON"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Export DB</span>
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
      <div className="relative flex flex-1 overflow-hidden">
        {/* Mobile Backdrop Overlay */}
        {mobileMenuOpen && (
          <div
            onClick={() => setMobileMenuOpen(false)}
            className="fixed inset-0 top-16 z-30 bg-black/60 backdrop-blur-xs lg:hidden"
          />
        )}
        {/* Desktop Sidebar & Mobile Drawer */}
        <aside
          className={`${
            mobileMenuOpen ? 'fixed inset-y-16 left-0 z-40 block w-64 shadow-2xl' : 'hidden'
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
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={folderSubject}
                          onChange={(e) => setFolderSubject(e.target.value)}
                          className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                            isDark
                              ? 'border-white/10 bg-[#0F172A] text-white'
                              : 'border-slate-200 bg-white text-slate-900'
                          }`}
                        >
                          <option value="All Subjects">All Subjects</option>
                          {Object.keys(db.subjects || {}).map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        <label className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={folderIsPro}
                            onChange={(e) => setFolderIsPro(e.target.checked)}
                          />
                          <span>Pro Locked Folder</span>
                        </label>
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
                        placeholder="Test Title (English — e.g. BPSC TRE Full Mock #1)"
                        className={`min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-white/5 text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      />
                      <input
                        type="text"
                        value={packTitleHi}
                        onChange={(e) => setPackTitleHi(e.target.value)}
                        placeholder="टेस्ट शीर्षक (हिन्दी)"
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
                        <select
                          value={packFolderId}
                          onChange={(e) => setPackFolderId(e.target.value)}
                          className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                            isDark
                              ? 'border-white/10 bg-[#0F172A] text-white'
                              : 'border-slate-200 bg-white text-slate-900'
                          }`}
                        >
                          {db.folders.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name_en || f.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <input
                          type="number"
                          value={packDuration}
                          onChange={(e) => setPackDuration(e.target.value)}
                          placeholder="Mins (30)"
                          title="Duration in Minutes"
                          className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                            isDark
                              ? 'border-white/10 bg-white/5 text-white'
                              : 'border-slate-200 bg-white text-slate-900'
                          }`}
                        />
                        <input
                          type="number"
                          step="0.25"
                          value={packMarksCorrect}
                          onChange={(e) => setPackMarksCorrect(e.target.value)}
                          placeholder="+Marks (2.0)"
                          title="Marks per Correct Answer"
                          className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                            isDark
                              ? 'border-white/10 bg-white/5 text-white'
                              : 'border-slate-200 bg-white text-slate-900'
                          }`}
                        />
                        <input
                          type="number"
                          step="0.05"
                          value={packNegMarks}
                          onChange={(e) => setPackNegMarks(e.target.value)}
                          placeholder="-Neg (0.50)"
                          title="Negative Marking per Wrong Answer"
                          className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                            isDark
                              ? 'border-white/10 bg-white/5 text-white'
                              : 'border-slate-200 bg-white text-slate-900'
                          }`}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={packShiftTag}
                          onChange={(e) => setPackShiftTag(e.target.value)}
                          placeholder="Shift Tag (Official Set)"
                          className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                            isDark
                              ? 'border-white/10 bg-white/5 text-white'
                              : 'border-slate-200 bg-white text-slate-900'
                          }`}
                        />
                        <label className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={packIsPro}
                            onChange={(e) => setPackIsPro(e.target.checked)}
                          />
                          <span>Pro Pass Required</span>
                        </label>
                      </div>

                      {/* Dynamic Category & Subcategory Assignment (Phase 10) */}
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={packCategoryId}
                          onChange={(e) => {
                            setPackCategoryId(e.target.value);
                            setPackSubcategoryId('');
                          }}
                          className={`min-h-[40px] rounded-xl border px-3 text-xs outline-none ${
                            isDark
                              ? 'border-white/10 bg-[#0F172A] text-white'
                              : 'border-slate-200 bg-white text-slate-900'
                          }`}
                        >
                          <option value="">Main Category (Optional)</option>
                          {(db.dynamicCategories || [])
                            .filter((c) => !c.parentId && c.status !== 'archived')
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name_en}
                              </option>
                            ))}
                        </select>
                        <select
                          value={packSubcategoryId}
                          onChange={(e) => setPackSubcategoryId(e.target.value)}
                          className={`min-h-[40px] rounded-xl border px-3 text-xs outline-none ${
                            isDark
                              ? 'border-white/10 bg-[#0F172A] text-white'
                              : 'border-slate-200 bg-white text-slate-900'
                          }`}
                        >
                          <option value="">Subcategory (Optional)</option>
                          {(db.dynamicCategories || [])
                            .filter((c) => c.parentId === packCategoryId && c.status !== 'archived')
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name_en}
                              </option>
                            ))}
                        </select>
                      </div>

                      {/* Phase 8: Admin Test Customization Controls */}
                      <div
                        className={`rounded-xl border p-3 text-xs ${
                          isDark
                            ? 'border-indigo-500/30 bg-indigo-500/[0.05]'
                            : 'border-indigo-200 bg-indigo-50/60'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-indigo-400">
                            Customization Allowed for Students
                          </span>
                          <input
                            type="checkbox"
                            checked={packCustomizationAllowed}
                            onChange={(e) => setPackCustomizationAllowed(e.target.checked)}
                            className="h-4 w-4 accent-indigo-600"
                          />
                        </div>
                        {packCustomizationAllowed ? (
                          <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11px] text-slate-300">
                            <label className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={packAllowModeSwitch}
                                onChange={(e) => setPackAllowModeSwitch(e.target.checked)}
                              />
                              <span>Allow Mode Switch</span>
                            </label>
                            <label className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={packAllowTimerChange}
                                onChange={(e) => setPackAllowTimerChange(e.target.checked)}
                              />
                              <span>Allow Timer Edit</span>
                            </label>
                            <label className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={packAllowQCountChange}
                                onChange={(e) => setPackAllowQCountChange(e.target.checked)}
                              />
                              <span>Allow Question Count</span>
                            </label>
                            <label className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={packRandomizeQuestions}
                                onChange={(e) => setPackRandomizeQuestions(e.target.checked)}
                              />
                              <span>Shuffle Questions</span>
                            </label>
                          </div>
                        ) : (
                          <p className="mt-1.5 text-[11px] text-amber-400">
                            Students must attempt this test with fixed official duration, mode, and question set.
                          </p>
                        )}
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

                {/* Existing Folders & Test Packs Management Lists */}
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  <div
                    className={`rounded-2xl p-5 ${
                      isDark ? 'surface-card-dark' : 'surface-card-light'
                    }`}
                  >
                    <h3 className="text-sm font-bold">Existing Folders ({db.folders.length})</h3>
                    <div className="mt-3 divide-y divide-white/10">
                      {db.folders.map((f) => (
                        <div
                          key={f.id}
                          className="flex items-center justify-between gap-2 py-2.5 text-xs"
                        >
                          <div>
                            <p className="font-bold">{f.name_en || f.name}</p>
                            <p className="text-slate-400">
                              {f.exam} · {f.type.toUpperCase()} · {f.subject}{' '}
                              {f.isPro ? '· PRO' : '· FREE'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmDelete({
                                label: `Folder "${f.name_en || f.name}"`,
                                onConfirm: () => {
                                  onUpdateDatabase({
                                    ...db,
                                    folders: db.folders.filter((item) => item.id !== f.id),
                                  });
                                  setConfirmDelete(null);
                                  notify('Folder deleted.');
                                },
                              })
                            }
                            className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-rose-400"
                            title="Delete Folder"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div
                    className={`rounded-2xl p-5 ${
                      isDark ? 'surface-card-dark' : 'surface-card-light'
                    }`}
                  >
                    <h3 className="text-sm font-bold">
                      Published Test Series Packs ({db.testSeries.length})
                    </h3>
                    <div className="mt-3 divide-y divide-white/10">
                      {db.testSeries.map((pack) => {
                        const isCustomizable =
                          pack.customizationRules?.customizationAllowed !== false;
                        return (
                          <div
                            key={pack.id}
                            className="flex items-center justify-between gap-2 py-2.5 text-xs"
                          >
                            <div>
                              <p className="font-bold">{pack.title_en}</p>
                              <p className="text-slate-400">
                                {pack.exam} · {pack.questionIds.length} Qs · {pack.durationMinutes}m ·
                                +{pack.marksPerCorrect}/-{pack.negativeMarking}{' '}
                                {pack.isPro ? '· PRO' : '· FREE'}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  const nextAllowed = !isCustomizable;
                                  const updatedPacks = db.testSeries.map((p) =>
                                    p.id === pack.id
                                      ? {
                                          ...p,
                                          customizationRules: {
                                            customizationAllowed: nextAllowed,
                                            allowModeSwitch: nextAllowed,
                                            allowTimerChange: nextAllowed,
                                            allowQuestionCountChange: false,
                                            allowCategoryFilter: false,
                                            randomizeQuestions: false,
                                          },
                                        }
                                      : p
                                  );
                                  onUpdateDatabase({ ...db, testSeries: updatedPacks });
                                  notify(
                                    `Test Pack "${pack.title_en}" set to ${
                                      nextAllowed ? 'Customizable' : 'Fixed / Locked'
                                    }.`
                                  );
                                }}
                                className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${
                                  isCustomizable
                                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                    : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                                }`}
                                title="Toggle Student Customization Permission"
                              >
                                {isCustomizable ? 'Customizable' : 'Locked'}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmDelete({
                                    label: `Test Pack "${pack.title_en}"`,
                                    onConfirm: () => {
                                      onUpdateDatabase({
                                        ...db,
                                        testSeries: db.testSeries.filter(
                                          (item) => item.id !== pack.id
                                        ),
                                      });
                                      setConfirmDelete(null);
                                      notify('Test Series Pack deleted.');
                                    },
                                  })
                                }
                                className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-rose-400"
                                title="Delete Test Pack"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
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
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold">
                      {editingNoteId ? 'Edit Study Note / PDF' : 'Add Study Note / Upload PDF'}
                    </h3>
                    {editingNoteId && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingNoteId(null);
                          setNoteTitleEn('');
                          setNoteTitleHi('');
                          setNoteContentEn('');
                          setNoteContentHi('');
                        }}
                        className="text-xs text-slate-400 hover:text-white"
                      >
                        Cancel Edit
                      </button>
                    )}
                  </div>
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
                    <input
                      type="text"
                      value={noteTopic}
                      onChange={(e) => setNoteTopic(e.target.value)}
                      placeholder="Chapter / Topic (e.g. Constitutional Amendments)"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <select
                      value={noteFolderId}
                      onChange={(e) => setNoteFolderId(e.target.value)}
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-[#0F172A] text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    >
                      {db.folders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name_en || f.name}
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
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={noteIsPro}
                        onChange={(e) => setNoteIsPro(e.target.checked)}
                      />
                      <span>Pro Pass Required</span>
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
                      {editingNoteId ? 'Update Study Resource' : 'Save Study Resource'}
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
                            {n.exam || 'All Exams'} · {n.subject} · {n.topic} ·{' '}
                            {n.type.toUpperCase()} ·{' '}
                            {n.allowDownload ? 'Downloadable' : 'View-Only Locked'}{' '}
                            {n.isPro ? '· PRO' : '· FREE'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleEditNote(n)}
                            className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-300 hover:bg-white/10"
                            title="Edit Note"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
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
                            title="Delete Note"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================
                SECTION 8: STUDENTS, WHATSAPP MANAGEMENT & PRO KEY GENERATOR
               ================================================================ */}
            {activeSection === 'students' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-bold">
                    Student WhatsApp Directory & Device-Bound Pro Keys
                  </h2>
                  <p className="text-xs text-slate-400">
                    View, search, and manage student WhatsApp numbers (stored in normalized E.164 format), generate device-locked Pro Keys (`ZYV-XXXX-XXX`), and audit all contact changes without mutating keys, payments, or test history.
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
                      placeholder="Student WhatsApp (+919876543210 or 10 digits)"
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

                {/* Inline Student WhatsApp Edit & Confirmation Panel */}
                {editingStudentWa && (
                  <div className="rounded-2xl border-2 border-indigo-500/50 bg-indigo-950/30 p-5 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-400">
                          Edit Student WhatsApp Number (Admin Audited)
                        </span>
                        <h3 className="mt-0.5 text-sm font-bold text-white">
                          {editingStudentWa.studentName} · Device ID:{' '}
                          <span className="font-mono text-indigo-300">
                            {editingStudentWa.deviceId}
                          </span>
                        </h3>
                        <p className="text-xs text-slate-400">
                          Current WhatsApp:{' '}
                          <strong className="font-mono text-slate-200">
                            {editingStudentWa.whatsappNumber}
                          </strong>{' '}
                          · Pro Key:{' '}
                          <strong className="font-mono text-slate-200">
                            {editingStudentWa.proKey || 'None'}
                          </strong>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingStudentWa(null);
                          setEditWaFeedback(null);
                          setEditWaConfirmed(false);
                        }}
                        className="rounded-lg p-1.5 text-slate-400 hover:text-white"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">
                          New WhatsApp Number (E.164 with Country Code or 10-digit IN)
                        </label>
                        <input
                          type="tel"
                          value={editWaNewValue}
                          onChange={(e) => setEditWaNewValue(e.target.value)}
                          placeholder="+919876543210"
                          className="min-h-[42px] w-full rounded-xl border border-white/15 bg-white/5 px-3.5 font-mono text-xs text-white outline-none focus:border-indigo-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">
                          Record Update Scope
                        </label>
                        <select
                          value={editWaScope}
                          onChange={(e) =>
                            setEditWaScope(
                              e.target.value as 'both' | 'sale_only' | 'profile_only'
                            )
                          }
                          className="min-h-[42px] w-full rounded-xl border border-white/15 bg-slate-900 px-3 text-xs text-white outline-none"
                        >
                          <option value="both">
                            Update Both Key Purchase Record & Student Device Profile
                          </option>
                          <option value="sale_only">
                            Update Key Purchase Record Only (salesLog)
                          </option>
                          <option value="profile_only">
                            Update Student Device Profile Only (studentStates)
                          </option>
                        </select>
                      </div>
                    </div>

                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 leading-relaxed">
                      <strong>Data Integrity & Ownership Notice:</strong> Changing a student's WhatsApp number updates their contact record only. It does <strong>not</strong> verify phone ownership (status remains <em>Unverified</em>), and it will <strong>never</strong> alter the student's Device Lock ID (<code>{editingStudentWa.deviceId}</code>), Pro Key (<code>{editingStudentWa.proKey || 'N/A'}</code>), UTR (<code>{editingStudentWa.utrNumber}</code>), payment amount (₹{editingStudentWa.amountPaid}), or test history ({editingStudentWa.testHistoryCount} attempts).
                    </div>

                    <label className="flex items-start gap-2.5 text-xs text-slate-200 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={editWaConfirmed}
                        onChange={(e) => setEditWaConfirmed(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-white/20 accent-indigo-500"
                      />
                      <span>
                        I confirm this WhatsApp number change from{' '}
                        <code className="font-mono text-amber-300">
                          {editingStudentWa.whatsappNumber}
                        </code>{' '}
                        to{' '}
                        <code className="font-mono text-emerald-300">
                          {editWaNewValue.trim() || '...'}
                        </code>{' '}
                        and understand that this change will be recorded in the Admin Audit Log.
                      </span>
                    </label>

                    {editWaFeedback && (
                      <div
                        className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                          editWaFeedback.ok
                            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                            : 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                        }`}
                      >
                        {editWaFeedback.text}
                      </div>
                    )}

                    <div className="flex flex-wrap justify-end gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingStudentWa(null);
                          setEditWaFeedback(null);
                          setEditWaConfirmed(false);
                        }}
                        className="min-h-[40px] rounded-xl border border-white/15 px-4 text-xs font-semibold text-slate-300"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={editWaBusy}
                        onClick={handleSaveStudentWhatsApp}
                        className="min-h-[40px] rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
                      >
                        {editWaBusy ? 'Saving...' : 'Confirm & Save WhatsApp Number'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Unified Student Search & WhatsApp Management Table */}
                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold">
                        Student Directory, Key Ownership & WhatsApp Management ({serverStudents.length})
                      </h3>
                      <p className="text-xs text-slate-400">
                        Search by Student Name, Device Lock ID, Pro Key, UTR, or WhatsApp Number.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <div className="relative flex-1 sm:w-72">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          value={studentSearchQuery}
                          onChange={(e) => setStudentSearchQuery(e.target.value)}
                          placeholder="Search name, ZYV-ID, PRO-key, +91..."
                          className={`min-h-[38px] w-full rounded-xl border pl-8 pr-3 text-xs outline-none ${
                            isDark
                              ? 'border-white/10 bg-white/5 text-white'
                              : 'border-slate-200 bg-white text-slate-900'
                          }`}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => fetchServerStudents(studentSearchQuery)}
                        className="inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-white/10 px-3 text-xs font-semibold text-slate-300 hover:bg-white/5"
                        title="Refresh Student Directory"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Refresh
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 divide-y divide-white/10">
                    {serverStudents.length === 0 ? (
                      <p className="py-6 text-center text-xs text-slate-400">
                        No matching student or key purchase records found.
                      </p>
                    ) : (
                      serverStudents.map((stu) => (
                        <div
                          key={`${stu.saleId || 'profile'}-${stu.deviceId}`}
                          className="flex flex-wrap items-center justify-between gap-3 py-3.5 text-xs"
                        >
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-bold text-sm">{stu.studentName}</span>
                              <span className="font-mono font-bold text-emerald-400 tabular-nums">
                                {stu.whatsappNumber}
                              </span>
                              <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                                {stu.whatsappVerified ? 'Verified' : 'Unverified (Contact Record)'}
                              </span>
                              {stu.keyRevoked && (
                                <span className="rounded-md border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                                  KEY REVOKED
                                </span>
                              )}
                            </div>
                            <p className="font-mono text-slate-400">
                              Device Lock: <span className="text-slate-200">{stu.deviceId}</span> ·
                              Key: <span className="text-indigo-300">{stu.proKey || 'Free Tier'}</span>{' '}
                              · UTR: {stu.utrNumber} · Paid: ₹{stu.amountPaid} · Tests:{' '}
                              {stu.testHistoryCount}
                            </p>
                            {stu.whatsappUpdatedAt && (
                              <p className="text-[11px] text-slate-400">
                                Last WhatsApp edit:{' '}
                                {new Date(stu.whatsappUpdatedAt).toLocaleString('en-IN')} by{' '}
                                <span className="font-semibold text-slate-300">
                                  {stu.whatsappUpdatedBy || 'admin'}
                                </span>
                              </p>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingStudentWa(stu);
                                setEditWaNewValue(stu.whatsappNumber);
                                setEditWaScope('both');
                                setEditWaConfirmed(false);
                                setEditWaFeedback(null);
                              }}
                              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-indigo-600/90 px-3 text-xs font-bold text-white hover:bg-indigo-500"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                              Edit WhatsApp
                            </button>
                            {stu.proKey && (
                              <button
                                type="button"
                                onClick={() => handleToggleStudentKeyRevoke(stu)}
                                className={`inline-flex min-h-[36px] items-center gap-1 rounded-xl border px-3 text-xs font-semibold ${
                                  stu.keyRevoked
                                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                                    : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                                }`}
                              >
                                {stu.keyRevoked ? 'Restore Key' : 'Revoke Key'}
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Student WhatsApp Audit Log */}
                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <h3 className="text-sm font-bold">
                    Student WhatsApp & Key Security Audit Trail
                  </h3>
                  <p className="text-xs text-slate-400">
                    Immutable record of every Admin WhatsApp number update (old number, new number, timestamp, and acting admin).
                  </p>
                  <div className="mt-3 divide-y divide-white/10 max-h-60 overflow-y-auto">
                    {(db.adminAuditLogs || []).filter(
                      (a) =>
                        a.action === 'student_whatsapp_update' ||
                        a.action === 'student_whatsapp_updated' ||
                        a.action === 'UPDATE_STUDENT_WHATSAPP'
                    ).length === 0 ? (
                      <p className="py-4 text-xs text-slate-400">
                        No WhatsApp number edits recorded yet.
                      </p>
                    ) : (
                      (db.adminAuditLogs || [])
                        .filter(
                          (a) =>
                            a.action === 'student_whatsapp_update' ||
                            a.action === 'student_whatsapp_updated' ||
                            a.action === 'UPDATE_STUDENT_WHATSAPP'
                        )
                        .map((entry) => (
                          <div key={entry.id} className="py-2.5 text-xs space-y-0.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-bold text-slate-200">
                                {entry.targetStudentName || entry.studentName || 'Student'} (
                                {entry.targetDeviceId})
                              </span>
                              <span className="text-[11px] text-slate-400 tabular-nums">
                                {new Date(entry.timestamp).toLocaleString('en-IN')} · Admin:{' '}
                                <strong className="text-indigo-300">{entry.actorAdminId}</strong>
                              </span>
                            </div>
                            <p className="font-mono text-[11px] text-slate-300">
                              Old: <span className="text-rose-300">{entry.oldValue}</span> → New:{' '}
                              <span className="text-emerald-300">{entry.newValue}</span> (
                              {entry.updateScope || 'both'})
                            </p>
                          </div>
                        ))
                    )}
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

                {/* Phase 11: Promotional Offers, Visual Templates & Banner Image Manager */}
                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-amber-400" />
                    <h3 className="text-sm font-bold">
                      Promotional Offers, Visual Templates & Banner Images
                    </h3>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    Create rich student promotional cards using built-in visual templates or upload a custom banner image (max 2MB).
                  </p>

                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <input
                      type="text"
                      value={promoTitleEn}
                      onChange={(e) => setPromoTitleEn(e.target.value)}
                      placeholder="Offer Headline (English — e.g. BPSC & SSC Mega Scholarship)"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <input
                      type="text"
                      value={promoTitleHi}
                      onChange={(e) => setPromoTitleHi(e.target.value)}
                      placeholder="ऑफर शीर्षक (हिन्दी)"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <select
                      value={promoTemplateId}
                      onChange={(e) => setPromoTemplateId(e.target.value as OfferTemplateId)}
                      className={`min-h-[42px] rounded-xl border px-3 text-xs font-semibold outline-none ${
                        isDark
                          ? 'border-white/10 bg-[#0F172A] text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    >
                      <option value="royal_indigo">Template 1: Royal Indigo Gradient</option>
                      <option value="emerald_scholar">Template 2: Emerald Scholar Pass</option>
                      <option value="amber_festive">Template 3: Amber Festive Gold</option>
                      <option value="crimson_urgent">Template 4: Crimson Flash Sale</option>
                    </select>
                    <input
                      type="text"
                      value={promoBadgeText}
                      onChange={(e) => setPromoBadgeText(e.target.value)}
                      placeholder="Badge (e.g. FESTIVAL OFFER)"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <input
                      type="text"
                      value={promoDiscountText}
                      onChange={(e) => setPromoDiscountText(e.target.value)}
                      placeholder="Discount Text (e.g. 70% OFF)"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <input
                      type="text"
                      value={promoCouponCode}
                      onChange={(e) => setPromoCouponCode(e.target.value.toUpperCase())}
                      placeholder="Linked Coupon (e.g. ZYVRA50)"
                      className={`min-h-[42px] rounded-xl border px-3 font-mono text-xs uppercase outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <input
                      type="text"
                      value={promoSubtitleEn}
                      onChange={(e) => setPromoSubtitleEn(e.target.value)}
                      placeholder="Subtitle / Description"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <input
                      type="date"
                      value={promoValidUntil}
                      onChange={(e) => setPromoValidUntil(e.target.value)}
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <div>
                      <label className="flex min-h-[42px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-indigo-500/40 bg-indigo-500/10 px-3 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/20">
                        <ImageIcon className="h-4 w-4" />
                        <span>{promoBannerImageUrl ? 'Change Banner Image' : 'Upload Banner Image'}</span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/svg+xml"
                          onChange={handlePromoBannerFileChange}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>

                  {promoImageError && (
                    <p className="mt-2 text-xs font-semibold text-rose-400">{promoImageError}</p>
                  )}

                  {/* Live Offer Card Preview */}
                  {(promoTitleEn || promoBannerImageUrl) && (
                    <div className="mt-4 rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/90 via-slate-900 to-indigo-900/80 p-4 text-white">
                      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                        <div>
                          <span className="inline-block rounded-md bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-300">
                            {promoBadgeText || 'PREVIEW'} · {promoDiscountText}
                          </span>
                          <h4 className="mt-1 text-base font-extrabold">
                            {promoTitleEn || 'Offer Headline Preview'}
                          </h4>
                          <p className="mt-0.5 text-xs text-slate-300">
                            {promoSubtitleEn || 'Full Pro access to all exams and PYQ test packs.'}
                          </p>
                        </div>
                        {promoBannerImageUrl && (
                          <img
                            src={promoBannerImageUrl}
                            alt="Promotional Banner Preview"
                            className="h-16 w-28 rounded-xl object-cover border border-white/15"
                          />
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={handleCreatePromoOffer}
                      className="min-h-[42px] rounded-xl bg-emerald-600 px-5 text-xs font-bold text-white hover:bg-emerald-500"
                    >
                      Publish Promotional Offer
                    </button>
                  </div>

                  {/* Published Promotional Offers List */}
                  <div className="mt-4 divide-y divide-white/10">
                    {(db.promotionalOffers || []).map((offer) => (
                      <div
                        key={offer.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs"
                      >
                        <div className="flex items-center gap-3">
                          {offer.bannerImageUrl && (
                            <img
                              src={offer.bannerImageUrl}
                              alt={offer.title_en}
                              className="h-10 w-16 rounded-lg object-cover border border-white/10"
                            />
                          )}
                          <div>
                            <p className="font-bold">
                              {offer.title_en}{' '}
                              <span className="text-emerald-400">({offer.discountText})</span>
                            </p>
                            <p className="text-slate-400">
                              Template: {offer.templateId} · Valid until: {offer.validUntil} ·{' '}
                              {offer.active ? 'Active' : 'Paused'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const nextOffers = (db.promotionalOffers || []).map((o) =>
                                o.id === offer.id ? { ...o, active: !o.active } : o
                              );
                              onUpdateDatabase({ ...db, promotionalOffers: nextOffers });
                            }}
                            className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${
                              offer.active
                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                : 'border-slate-500/30 bg-slate-500/10 text-slate-400'
                            }`}
                          >
                            {offer.active ? 'Active' : 'Paused'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onUpdateDatabase({
                                ...db,
                                promotionalOffers: (db.promotionalOffers || []).filter(
                                  (o) => o.id !== offer.id
                                ),
                              });
                              notify('Promotional offer removed.');
                            }}
                            className="text-rose-400 hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================
                PHASE 10: DYNAMIC CATEGORIES & SUBCATEGORIES MANAGER
               ================================================================ */}
            {activeSection === 'categories' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-bold">
                    Dynamic Categories & Subcategories Hierarchy
                  </h2>
                  <p className="text-xs text-slate-400">
                    Create unlimited Main Categories and child Subcategories for organizing exams, PYQ sets, and custom tests.
                  </p>
                </div>

                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <h3 className="text-sm font-bold">
                    {editingCatId ? 'Edit Category / Subcategory' : 'Add Category or Subcategory'}
                  </h3>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <input
                      type="text"
                      value={catNameEn}
                      onChange={(e) => setCatNameEn(e.target.value)}
                      placeholder="Category Name (English)"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <input
                      type="text"
                      value={catNameHi}
                      onChange={(e) => setCatNameHi(e.target.value)}
                      placeholder="श्रेणी का नाम (हिन्दी)"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <select
                      value={catParentId}
                      onChange={(e) => setCatParentId(e.target.value)}
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-[#0F172A] text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    >
                      <option value="">Top-Level Main Category (No Parent)</option>
                      {(db.dynamicCategories || [])
                        .filter((c) => !c.parentId && c.id !== editingCatId)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            Subcategory under: {c.name_en}
                          </option>
                        ))}
                    </select>
                    <input
                      type="text"
                      value={catDesc}
                      onChange={(e) => setCatDesc(e.target.value)}
                      placeholder="Optional Description"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <input
                      type="number"
                      value={catOrder}
                      onChange={(e) => setCatOrder(e.target.value)}
                      placeholder="Display Order (1)"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={handleSaveDynamicCategory}
                      className="min-h-[42px] rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white hover:bg-indigo-500"
                    >
                      {editingCatId ? 'Update Category' : 'Add Category / Subcategory'}
                    </button>
                  </div>
                </div>

                {/* Hierarchical Tree View */}
                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <h3 className="text-sm font-bold">
                    Category & Subcategory Hierarchy ({(db.dynamicCategories || []).length} nodes)
                  </h3>
                  <div className="mt-4 space-y-4">
                    {(db.dynamicCategories || [])
                      .filter((c) => !c.parentId)
                      .sort((a, b) => a.order - b.order)
                      .map((mainCat) => {
                        const children = (db.dynamicCategories || [])
                          .filter((sub) => sub.parentId === mainCat.id)
                          .sort((a, b) => a.order - b.order);
                        return (
                          <div
                            key={mainCat.id}
                            className={`rounded-xl border p-4 ${
                              isDark
                                ? 'border-white/10 bg-white/[0.02]'
                                : 'border-slate-200 bg-slate-50'
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <span className="text-xs font-extrabold text-indigo-400">
                                  {mainCat.name_en} ({mainCat.name_hi})
                                </span>
                                <span className="ml-2 rounded-md bg-white/10 px-2 py-0.5 text-[10px]">
                                  {mainCat.status.toUpperCase()}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 text-xs">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingCatId(mainCat.id);
                                    setCatNameEn(mainCat.name_en);
                                    setCatNameHi(mainCat.name_hi);
                                    setCatParentId('');
                                    setCatOrder(String(mainCat.order));
                                  }}
                                  className="text-indigo-400 hover:underline"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = (db.dynamicCategories || []).map((c) =>
                                      c.id === mainCat.id
                                        ? {
                                            ...c,
                                            status:
                                              c.status === 'active'
                                                ? ('inactive' as const)
                                                : ('active' as const),
                                          }
                                        : c
                                    );
                                    onUpdateDatabase({ ...db, dynamicCategories: updated });
                                  }}
                                  className="text-amber-400 hover:underline"
                                >
                                  {mainCat.status === 'active' ? 'Deactivate' : 'Activate'}
                                </button>
                              </div>
                            </div>

                            {/* Child Subcategories */}
                            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {children.map((sub) => (
                                <div
                                  key={sub.id}
                                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
                                    isDark
                                      ? 'border-white/10 bg-[#0A0E17]'
                                      : 'border-slate-200 bg-white'
                                  }`}
                                >
                                  <div>
                                    <p className="font-semibold">{sub.name_en}</p>
                                    <p className="text-[11px] text-slate-400">
                                      {sub.name_hi} · {sub.status}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingCatId(sub.id);
                                        setCatNameEn(sub.name_en);
                                        setCatNameHi(sub.name_hi);
                                        setCatParentId(mainCat.id);
                                        setCatOrder(String(sub.order));
                                      }}
                                      className="text-indigo-400 hover:underline"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const isUsed = db.testSeries.some(
                                          (t) => t.subcategoryId === sub.id
                                        );
                                        if (isUsed) {
                                          const archived = (db.dynamicCategories || []).map((c) =>
                                            c.id === sub.id
                                              ? { ...c, status: 'archived' as const }
                                              : c
                                          );
                                          onUpdateDatabase({
                                            ...db,
                                            dynamicCategories: archived,
                                          });
                                          notify(
                                            'Subcategory is linked to tests; archived safely.'
                                          );
                                        } else {
                                          onUpdateDatabase({
                                            ...db,
                                            dynamicCategories: (
                                              db.dynamicCategories || []
                                            ).filter((c) => c.id !== sub.id),
                                          });
                                          notify('Subcategory deleted.');
                                        }
                                      }}
                                      className="text-rose-400 hover:underline"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================
                PHASE 9: REFER & EARN COMMISSION POLICY & LEDGER
               ================================================================ */}
            {activeSection === 'referrals' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-bold">Refer & Earn Commission Policy & Ledger</h2>
                  <p className="text-xs text-slate-400">
                    Configure referral commission rules, minimum payout thresholds, and approve or settle student referral commissions.
                  </p>
                </div>

                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold">Referral Commission Policy</h3>
                    <label className="flex items-center gap-2 text-xs font-bold text-emerald-400">
                      <input
                        type="checkbox"
                        checked={referralForm.enabled}
                        onChange={(e) =>
                          setReferralForm({ ...referralForm, enabled: e.target.checked })
                        }
                      />
                      <span>Program Enabled</span>
                    </label>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs text-slate-400">Commission Type</label>
                      <select
                        value={referralForm.commissionType}
                        onChange={(e) =>
                          setReferralForm({
                            ...referralForm,
                            commissionType: e.target.value as 'fixed' | 'percent',
                          })
                        }
                        className={`mt-1 min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-[#0F172A] text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      >
                        <option value="percent">Percentage of Order (%)</option>
                        <option value="fixed">Fixed Amount per Referral (₹)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400">
                        Commission Value ({referralForm.commissionType === 'percent' ? '%' : '₹'})
                      </label>
                      <input
                        type="number"
                        value={referralForm.commissionValue}
                        onChange={(e) =>
                          setReferralForm({
                            ...referralForm,
                            commissionValue: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        className={`mt-1 min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-white/5 text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400">
                        Minimum Payout Threshold (₹)
                      </label>
                      <input
                        type="number"
                        value={referralForm.minPayoutThreshold}
                        onChange={(e) =>
                          setReferralForm({
                            ...referralForm,
                            minPayoutThreshold: Math.max(10, Number(e.target.value) || 100),
                          })
                        }
                        className={`mt-1 min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-white/5 text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      />
                    </div>
                  </div>

                  <div className="mt-3">
                    <label className="block text-xs text-slate-400">Student Terms Summary</label>
                    <input
                      type="text"
                      value={referralForm.termsSummary}
                      onChange={(e) =>
                        setReferralForm({ ...referralForm, termsSummary: e.target.value })
                      }
                      className={`mt-1 min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                  </div>

                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        onUpdateDatabase({ ...db, referralPolicy: referralForm });
                        notify('Referral commission policy saved.');
                      }}
                      className="min-h-[42px] rounded-xl bg-indigo-600 px-5 text-xs font-bold text-white"
                    >
                      Save Commission Policy
                    </button>
                  </div>
                </div>

                {/* Commission Ledger & Payout Management */}
                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <h3 className="text-sm font-bold">
                    Student Commission Ledger ({(db.referralCommissions || []).length} records)
                  </h3>
                  {(db.referralCommissions || []).length === 0 ? (
                    <p className="mt-3 text-xs text-slate-400">
                      No referral commissions recorded yet.
                    </p>
                  ) : (
                    <div className="mt-3 divide-y divide-white/10">
                      {(db.referralCommissions || []).map((rec: ReferralCommissionRecord) => (
                        <div
                          key={rec.id}
                          className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs"
                        >
                          <div>
                            <p className="font-bold">
                              Referrer Code:{' '}
                              <span className="font-mono text-indigo-400">{rec.referrerCode}</span>{' '}
                              → Referee: {rec.refereeName} ({rec.refereeDeviceId})
                            </p>
                            <p className="text-slate-400">
                              Order: ₹{rec.orderAmount} · Commission:{' '}
                              <strong className="text-emerald-400">₹{rec.commissionAmount}</strong>
                              {rec.payoutUpiId ? ` · Payout UPI: ${rec.payoutUpiId}` : ''}
                            </p>
                          </div>
                          <select
                            value={rec.status}
                            onChange={(e) => {
                              const nextStatus = e.target.value as CommissionStatus;
                              const updated = (db.referralCommissions || []).map((c) =>
                                c.id === rec.id
                                  ? { ...c, status: nextStatus, updatedAt: Date.now() }
                                  : c
                              );
                              onUpdateDatabase({ ...db, referralCommissions: updated });
                              fetch(`/api/admin/referrals/commissions/${rec.id}`, {
                                method: 'PATCH',
                                headers: getAdminAuthHeaders(),
                                credentials: 'include',
                                body: JSON.stringify({ status: nextStatus }),
                              }).catch(() => {});
                              notify(`Commission ${rec.id} status updated to ${nextStatus}.`);
                            }}
                            className={`min-h-[36px] rounded-lg border px-2.5 text-xs font-bold ${
                              isDark
                                ? 'border-white/15 bg-[#0F172A] text-white'
                                : 'border-slate-300 bg-white text-slate-900'
                            }`}
                          >
                            <option value="pending">Pending Verification</option>
                            <option value="approved">Approved</option>
                            <option value="payable">Payable (Requested)</option>
                            <option value="paid">Paid / Settled</option>
                            <option value="rejected">Rejected (Fraud/Invalid)</option>
                            <option value="reversed">Reversed / Refunded</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ================================================================
                PHASES 4 & 5: STUDENT FEEDBACK INBOX & SUPPORT TICKET DESK
               ================================================================ */}
            {activeSection === 'support' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-bold">
                    Student Support Desk, Contact Details & Feedback Inbox
                  </h2>
                  <p className="text-xs text-slate-400">
                    Manage official Customer Care channels, respond to student Support Tickets, and review Test Feedback.
                  </p>
                </div>

                {/* Official Support Contact Config */}
                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <h3 className="text-sm font-bold">Customer Care & Contact Us Channels</h3>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input
                      type="email"
                      value={supportForm.supportEmail}
                      onChange={(e) =>
                        setSupportForm({ ...supportForm, supportEmail: e.target.value })
                      }
                      placeholder="Support Email (support@zyvra.in)"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <input
                      type="text"
                      value={supportForm.helplineNumber}
                      onChange={(e) =>
                        setSupportForm({ ...supportForm, helplineNumber: e.target.value })
                      }
                      placeholder="Helpline Phone (+91-...)"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <input
                      type="text"
                      value={supportForm.whatsappSupport}
                      onChange={(e) =>
                        setSupportForm({ ...supportForm, whatsappSupport: e.target.value })
                      }
                      placeholder="WhatsApp Support Number"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                    <input
                      type="text"
                      value={supportForm.workingHours}
                      onChange={(e) =>
                        setSupportForm({ ...supportForm, workingHours: e.target.value })
                      }
                      placeholder="Working Hours"
                      className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    />
                  </div>
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        onUpdateDatabase({ ...db, supportConfig: supportForm });
                        notify('Customer Care contact settings updated.');
                      }}
                      className="min-h-[40px] rounded-xl bg-indigo-600 px-5 text-xs font-bold text-white"
                    >
                      Save Contact Channels
                    </button>
                  </div>
                </div>

                {/* Support Tickets Queue */}
                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <h3 className="text-sm font-bold">
                    Student Support Tickets ({(db.supportTickets || []).length})
                  </h3>
                  {(db.supportTickets || []).length === 0 ? (
                    <p className="mt-3 text-xs text-slate-400">No support tickets raised yet.</p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {(db.supportTickets || []).map((tkt: SupportTicket) => (
                        <div
                          key={tkt.id}
                          className={`rounded-xl border p-4 text-xs ${
                            isDark
                              ? 'border-white/10 bg-white/[0.02]'
                              : 'border-slate-200 bg-slate-50'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <span className="font-mono font-bold text-indigo-400">{tkt.id}</span>{' '}
                              · <strong>{tkt.subject}</strong> ({tkt.studentName} · {tkt.deviceId})
                            </div>
                            <select
                              value={tkt.status}
                              onChange={(e) => {
                                const nextStatus = e.target.value as SupportTicket['status'];
                                const updated = (db.supportTickets || []).map((item) =>
                                  item.id === tkt.id
                                    ? { ...item, status: nextStatus, updatedAt: Date.now() }
                                    : item
                                );
                                onUpdateDatabase({ ...db, supportTickets: updated });
                                notify(`Ticket ${tkt.id} marked as ${nextStatus}.`);
                              }}
                              className={`rounded-lg border px-2.5 py-1 text-xs font-bold ${
                                isDark
                                  ? 'border-white/15 bg-[#0F172A] text-white'
                                  : 'border-slate-300 bg-white text-slate-900'
                              }`}
                            >
                              <option value="open">Open</option>
                              <option value="in_progress">In Progress</option>
                              <option value="resolved">Resolved</option>
                              <option value="closed">Closed</option>
                            </select>
                          </div>
                          <p className="mt-1.5 text-slate-300">{tkt.message}</p>

                          {/* Existing Replies */}
                          {(tkt.replies || []).length > 0 && (
                            <div className="mt-2 space-y-1.5 border-l-2 border-indigo-500/40 pl-3">
                              {tkt.replies.map((r) => (
                                <p key={r.id} className="text-[11px] text-slate-400">
                                  <strong className="text-indigo-300">{r.authorName}:</strong>{' '}
                                  {r.message}
                                </p>
                              ))}
                            </div>
                          )}

                          {/* Admin Reply Input */}
                          <div className="mt-3 flex gap-2">
                            <input
                              type="text"
                              value={ticketReplyInputs[tkt.id] || ''}
                              onChange={(e) =>
                                setTicketReplyInputs({
                                  ...ticketReplyInputs,
                                  [tkt.id]: e.target.value,
                                })
                              }
                              placeholder="Write official reply to student..."
                              className={`min-h-[36px] flex-1 rounded-lg border px-3 text-xs outline-none ${
                                isDark
                                  ? 'border-white/10 bg-[#0A0E17] text-white'
                                  : 'border-slate-200 bg-white text-slate-900'
                              }`}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const msg = (ticketReplyInputs[tkt.id] || '').trim();
                                if (!msg) return;
                                const nowStr = new Date().toLocaleString('en-IN');
                                const updated = (db.supportTickets || []).map((item) =>
                                  item.id === tkt.id
                                    ? {
                                        ...item,
                                        status: 'resolved' as const,
                                        updatedAt: Date.now(),
                                        replies: [
                                          ...(item.replies || []),
                                          {
                                            id: `RPL-${Date.now()}`,
                                            authorRole: 'admin' as const,
                                            authorName: 'Zyvra Support Desk',
                                            senderRole: 'admin' as const,
                                            senderName: 'Zyvra Support Desk',
                                            message: msg,
                                            timestamp: Date.now(),
                                            createdAt: nowStr,
                                          },
                                        ],
                                      }
                                    : item
                                );
                                onUpdateDatabase({ ...db, supportTickets: updated });
                                fetch(`/api/admin/tickets/${tkt.id}/reply`, {
                                  method: 'POST',
                                  headers: getAdminAuthHeaders(),
                                  credentials: 'include',
                                  body: JSON.stringify({
                                    message: msg,
                                    status: 'resolved',
                                    senderName: 'Zyvra Support Desk',
                                  }),
                                }).catch(() => {});
                                setTicketReplyInputs({ ...ticketReplyInputs, [tkt.id]: '' });
                                notify(`Reply sent for ticket ${tkt.id}.`);
                              }}
                              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white"
                            >
                              <Send className="h-3 w-3" />
                              Reply
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Student Test Feedback Inbox (Phase 4) */}
                <div
                  className={`rounded-2xl p-5 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <h3 className="text-sm font-bold">
                    Student Test Feedback Inbox ({(db.feedbackList || db.studentFeedback || []).length})
                  </h3>
                  {(db.feedbackList || db.studentFeedback || []).length === 0 ? (
                    <p className="mt-3 text-xs text-slate-400">
                      No student test feedback entries submitted yet.
                    </p>
                  ) : (
                    <div className="mt-3 divide-y divide-white/10">
                      {(db.feedbackList || db.studentFeedback || []).map((fb: StudentFeedbackItem) => (
                        <div
                          key={fb.id}
                          className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-amber-400">
                                {'★'.repeat(fb.rating)}
                              </span>
                              <span className="font-semibold">{fb.studentName}</span>
                              <span className="text-slate-400">
                                ({fb.packTitle || fb.testTitle || 'General App'} · {fb.category})
                              </span>
                            </div>
                            <p className="mt-1 text-slate-300">{fb.message}</p>
                          </div>
                          <select
                            value={fb.status}
                            onChange={(e) => {
                              const nextSt = e.target.value as StudentFeedbackItem['status'];
                              const sourceList = db.feedbackList || db.studentFeedback || [];
                              const updated = sourceList.map((item) =>
                                item.id === fb.id ? { ...item, status: nextSt } : item
                              );
                              onUpdateDatabase({
                                ...db,
                                feedbackList: updated,
                                studentFeedback: updated,
                              });
                              fetch(`/api/admin/feedback/${fb.id}`, {
                                method: 'PATCH',
                                headers: getAdminAuthHeaders(),
                                credentials: 'include',
                                body: JSON.stringify({ status: nextSt }),
                              }).catch(() => {});
                            }}
                            className={`rounded-lg border px-2.5 py-1 text-xs font-bold ${
                              isDark
                                ? 'border-white/15 bg-[#0F172A] text-white'
                                : 'border-slate-300 bg-white text-slate-900'
                            }`}
                          >
                            <option value="new">New</option>
                            <option value="reviewed">Reviewed</option>
                            <option value="resolved">Resolved</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ================================================================
                SECTION 10: CLOUD SYNC & ADMIN SECURITY SETTINGS
               ================================================================ */}
            {activeSection === 'sync' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-bold">
                    Admin Account Security (Email OTP Verified) & GitHub Cloud Sync
                  </h2>
                  <p className="text-xs text-slate-400">
                    Change your Admin Login ID / Username and Password with current-password + private Email OTP verification, review security audit logs, and synchronize `database.json` with GitHub.
                  </p>
                </div>

                {/* Secure Admin User ID & Password Management with Private Email OTP Verification */}
                <div
                  className={`rounded-2xl p-5 space-y-4 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-400">
                        Two-Step Admin Credential Security (Current Password + Email OTP)
                      </span>
                      <h3 className="text-sm font-bold mt-0.5">
                        Manage Admin Login ID & Password
                      </h3>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs">
                      Current Admin Login ID:{' '}
                      <strong className="font-mono text-indigo-300">
                        {adminSecInfo?.loginId || adminSession.loginId}
                      </strong>
                      {adminSecInfo?.sessionVersion ? (
                        <span className="ml-2 text-[11px] text-slate-400">
                          (Session v{adminSecInfo.sessionVersion})
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">
                    Every change to the Admin Login ID or Password requires verifying your <strong>current password</strong> followed by a <strong>6-digit one-time verification code (OTP)</strong> delivered to the server-configured private administrator security email. All prior admin sessions are automatically invalidated upon update.
                  </p>

                  {/* Action Type Selector */}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {(
                      [
                        { id: 'change_password', label: 'Change Admin Password' },
                        { id: 'change_username', label: 'Change Admin Login ID' },
                        { id: 'change_both', label: 'Change Both Login ID & Password' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setSecActionType(opt.id);
                          setSecOtpChallengeId(null);
                          setSecOtpCode('');
                          setSecFeedback(null);
                        }}
                        className={`min-h-[40px] rounded-xl border px-3 text-xs font-bold transition ${
                          secActionType === opt.id
                            ? 'border-indigo-500 bg-indigo-600 text-white'
                            : isDark
                            ? 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/10'
                            : 'border-slate-200 bg-slate-50 text-slate-700'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {/* Step 1 Inputs: Current Password + New Username / New Password */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-3xl">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1">
                        Current Admin Password (Required)
                      </label>
                      <input
                        type="password"
                        value={secCurrentPassword}
                        onChange={(e) => setSecCurrentPassword(e.target.value)}
                        placeholder="Enter current Admin Password"
                        autoComplete="current-password"
                        className={`min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-white/5 text-white'
                            : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      />
                    </div>

                    {(secActionType === 'change_username' || secActionType === 'change_both') && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-1">
                          New Admin Login ID (4–32 chars, letters/digits/._-)
                        </label>
                        <input
                          type="text"
                          value={secNewLoginId}
                          onChange={(e) => setSecNewLoginId(e.target.value)}
                          placeholder={`New Login ID (current: ${adminSession.loginId})`}
                          autoComplete="off"
                          className={`min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                            isDark
                              ? 'border-white/10 bg-white/5 text-white'
                              : 'border-slate-200 bg-white text-slate-900'
                          }`}
                        />
                      </div>
                    )}

                    {(secActionType === 'change_password' || secActionType === 'change_both') && (
                      <>
                        <div>
                          <label className="block text-xs font-semibold text-slate-400 mb-1">
                            New Admin Password (min 8 chars, upper + lower + digit/symbol)
                          </label>
                          <input
                            type="password"
                            value={secNewPassword}
                            onChange={(e) => setSecNewPassword(e.target.value)}
                            placeholder="Enter strong new password"
                            autoComplete="new-password"
                            className={`min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                              isDark
                                ? 'border-white/10 bg-white/5 text-white'
                                : 'border-slate-200 bg-white text-slate-900'
                            }`}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-400 mb-1">
                            Confirm New Admin Password
                          </label>
                          <input
                            type="password"
                            value={secConfirmPassword}
                            onChange={(e) => setSecConfirmPassword(e.target.value)}
                            placeholder="Re-enter new password"
                            autoComplete="new-password"
                            className={`min-h-[42px] w-full rounded-xl border px-3 text-xs outline-none ${
                              isDark
                                ? 'border-white/10 bg-white/5 text-white'
                                : 'border-slate-200 bg-white text-slate-900'
                            }`}
                          />
                        </div>
                      </>
                    )}
                  </div>

                  {/* Step 1 Button or Step 2 OTP Entry */}
                  {!secOtpChallengeId ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        disabled={secBusy}
                        onClick={handleRequestAdminEmailOtp}
                        className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        {secBusy ? 'Sending Verification OTP...' : 'Step 1: Send 6-Digit Email OTP'}
                      </button>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-indigo-500/40 bg-indigo-500/10 p-4 space-y-3 max-w-2xl">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-bold text-indigo-300">
                          Step 2: Enter 6-Digit Email OTP Verification Code
                        </span>
                        {secOtpExpiresAt && (
                          <span className="text-[11px] text-slate-400">
                            Expires at {new Date(secOtpExpiresAt).toLocaleTimeString('en-IN')}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={secOtpCode}
                          onChange={(e) => setSecOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="6-Digit OTP"
                          className="min-h-[42px] w-44 rounded-xl border border-indigo-400/50 bg-slate-950 px-3.5 text-center font-mono text-base font-bold tracking-widest text-white outline-none"
                        />
                        <button
                          type="button"
                          disabled={secBusy}
                          onClick={handleVerifyAdminEmailOtpAndSave}
                          className="min-h-[42px] rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                        >
                          {secBusy ? 'Verifying...' : 'Verify OTP & Update Credentials'}
                        </button>
                        <button
                          type="button"
                          disabled={secBusy}
                          onClick={handleRequestAdminEmailOtp}
                          className="min-h-[42px] rounded-xl border border-white/15 px-3 text-xs font-semibold text-slate-300 hover:bg-white/10"
                        >
                          Resend OTP
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSecOtpChallengeId(null);
                            setSecOtpCode('');
                          }}
                          className="min-h-[42px] rounded-xl border border-white/10 px-3 text-xs text-slate-400 hover:text-white"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {secFeedback && (
                    <div
                      className={`rounded-xl border px-3.5 py-2.5 text-xs font-semibold ${
                        secFeedback.ok
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                          : 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                      }`}
                    >
                      {secFeedback.text}
                    </div>
                  )}

                  {/* Admin Security Audit Trail */}
                  {adminSecInfo && adminSecInfo.auditLogs.length > 0 && (
                    <div className="pt-3 border-t border-white/10">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                        Recent Admin Account & Security Audit Events
                      </h4>
                      <div className="mt-2 divide-y divide-white/10 max-h-48 overflow-y-auto">
                        {adminSecInfo.auditLogs.slice(0, 12).map((log) => (
                          <div
                            key={log.id}
                            className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs"
                          >
                            <div>
                              <span className="font-semibold text-slate-200">{log.action}</span>:{' '}
                              <span className="text-slate-400">{log.summary || log.details}</span>
                            </div>
                            <span className="text-[11px] text-slate-400 tabular-nums">
                              {new Date(log.timestamp).toLocaleString('en-IN')} · {log.actorAdminId}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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

            {/* Correct Answer, Tag, Difficulty, Stage, Folder, Source & Pro */}
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
              <div>
                <label className="block text-xs text-slate-400">Exam Stage</label>
                <input
                  type="text"
                  value={qStage}
                  onChange={(e) => setQStage(e.target.value)}
                  placeholder="Tier 1 / Prelims"
                  className={`mt-1 min-h-[40px] w-full rounded-xl border px-3 text-xs outline-none ${
                    isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white'
                  }`}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400">Target Folder</label>
                <select
                  value={qFolderId}
                  onChange={(e) => setQFolderId(e.target.value)}
                  className={`mt-1 min-h-[40px] w-full rounded-xl border px-3 text-xs outline-none ${
                    isDark ? 'border-white/10 bg-[#0F172A]' : 'border-slate-200 bg-white'
                  }`}
                >
                  {db.folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name_en || f.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400">Source Classification</label>
                <select
                  value={qSourceClass}
                  onChange={(e) =>
                    setQSourceClass(e.target.value as QuestionSourceClassification)
                  }
                  className={`mt-1 min-h-[40px] w-full rounded-xl border px-3 text-xs outline-none ${
                    isDark ? 'border-white/10 bg-[#0F172A]' : 'border-slate-200 bg-white'
                  }`}
                >
                  <option value="verified_pyq">Verified PYQ</option>
                  <option value="ai_guess_paper">Trending / High-Yield</option>
                  <option value="custom_admin_set">Custom Admin</option>
                </select>
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={qIsPro}
                    onChange={(e) => setQIsPro(e.target.checked)}
                  />
                  <span>Pro Pass Locked Question</span>
                </label>
              </div>
            </div>

            {/* Dual Explanations (English & Hindi) */}
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
              <textarea
                rows={2}
                value={qBasicHi}
                onChange={(e) => setQBasicHi(e.target.value)}
                placeholder="विधि 1: मूल अवधारणा (हिन्दी)"
                className={`rounded-xl border p-2.5 text-xs outline-none ${
                  isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white'
                }`}
              />
              <textarea
                rows={2}
                value={qTrickHi}
                onChange={(e) => setQTrickHi(e.target.value)}
                placeholder="विधि 2: 15-सेकंड शॉर्ट ट्रिक (हिन्दी)"
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
