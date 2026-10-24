import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Cloud,
  CloudOff,
  Compass,
  Copy,
  Download,
  FileText,
  Folder,
  Gift,
  Headphones,
  Home,
  Layers,
  Lock,
  Menu,
  MessageSquare,
  Moon,
  Phone,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Sliders,
  Sparkles,
  Star,
  Sun,
  Tag,
  Target,
  TrendingUp,
  Trophy,
  User,
  WifiOff,
  X,
} from 'lucide-react';
import { AdminControlCenter } from './components/AdminControlCenter';
import { PDFReaderModal } from './components/PDFReaderModal';
import { ProUnlockModal } from './components/ProUnlockModal';
import { TestEngineModal } from './components/TestEngineModal';
import { ZyvraLogo } from './components/ZyvraLogo';
import { useOnlineStatus, usePWAInstall } from './hooks/usePWA';
import {
  ActiveTestConfig,
  ExamCategory,
  LanguageMode,
  MasterDatabase,
  OfferTemplateId,
  StudentFeedbackItem,
  StudentLocalState,
  StudentSaleLog,
  StudyNote,
  SupportTicket,
  TestAttemptRecord,
  TestSeriesPack,
} from './types/database';
import { generateDeviceId, generateReferralCode } from './utils/cryptoLock';
import {
  enqueueOfflineSyncItem,
  examStringsMatch,
  getFoldersForExam,
  getNotesForExam,
  getQuestionsForExam,
  loadMasterDatabase,
  loadStudentState,
  loadThemeMode,
  pushMasterDatabaseToCloudBackend,
  safeLower,
  saveMasterDatabase,
  saveStudentState,
  saveThemeMode,
  syncWithCloudBackend,
} from './utils/storage';

type PrimaryTab = 'home' | 'exams' | 'practice' | 'study' | 'profile';
type StudySubTab = 'text' | 'pdf' | 'flashcards' | 'bookmarks' | 'mistakes';
type ExamsSubView = 'series' | 'trends';
type ProfileSectionView = 'overview' | 'referrals' | 'support';

export function App() {
  // Core Persistent State
  const [db, setDb] = useState<MasterDatabase>(() => loadMasterDatabase());
  const [studentState, setStudentState] = useState<StudentLocalState>(() => loadStudentState());
  const [theme, setTheme] = useState<'dark' | 'light'>(() => loadThemeMode());
  const [language, setLanguage] = useState<LanguageMode>('bilingual');

  // PWA & Offline Hooks
  const isOnline = useOnlineStatus();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSInstallGuide, setShowIOSInstallGuide] = useState(false);

  // Primary Navigation
  const [activeTab, setActiveTab] = useState<PrimaryTab>('home');

  // Active Exam & Stage Selection
  const activeExams = useMemo(
    () => (db.exams || []).filter((e) => e.isActive !== false),
    [db.exams]
  );

  const [selectedExam, setSelectedExam] = useState<string>(() => {
    const saved = studentState.selectedExamName;
    if (saved && activeExams.some((e) => examStringsMatch(e.name, saved))) {
      return saved;
    }
    return activeExams[0]?.name || 'SSC CGL';
  });

  const currentExamObj: ExamCategory | undefined = useMemo(
    () =>
      activeExams.find(
        (e) =>
          examStringsMatch(e.name, selectedExam) ||
          examStringsMatch(e.id, selectedExam) ||
          examStringsMatch(e.shortCode, selectedExam)
      ) || activeExams[0],
    [activeExams, selectedExam]
  );

  const [selectedStage, setSelectedStage] = useState<string>('ALL');

  useEffect(() => {
    setSelectedStage('ALL');
  }, [selectedExam]);

  // Exam Discovery Filters
  const [selectedFamilyId, setSelectedFamilyId] = useState<string>('ALL');
  const [examSearchQuery, setExamSearchQuery] = useState<string>('');
  const [showExamSwitcherModal, setShowExamSwitcherModal] = useState<boolean>(false);

  // Exams Tab Sub-View & Filters
  const [examsSubView, setExamsSubView] = useState<ExamsSubView>('series');
  const [selectedFolderId, setSelectedFolderId] = useState<string>('ALL');
  const [seriesCategoryFilter, setSeriesCategoryFilter] = useState<
    'ALL' | 'pyq' | 'guess' | 'sectional'
  >('ALL');
  const [trendSubjectFilter, setTrendSubjectFilter] = useState<string>('ALL');
  const [trendSearch, setTrendSearch] = useState<string>('');

  // Practice Tab (4-Step Guided Custom Test Builder)
  const [builderStep, setBuilderStep] = useState<1 | 2 | 3 | 4>(1);
  const [customSubject, setCustomSubject] = useState<string>('ALL');
  const [customTopic, setCustomTopic] = useState<string>('ALL');
  const [customFolderId, setCustomFolderId] = useState<string>('ALL');
  const [customSourcePool, setCustomSourcePool] = useState<
    'ALL' | 'verified_pyq' | 'ai_guess' | 'bookmarks' | 'mistakes'
  >('ALL');
  const [customDifficulty, setCustomDifficulty] = useState<'ALL' | 'Easy' | 'Moderate' | 'Hard'>(
    'ALL'
  );
  const [customQuestionCount, setCustomQuestionCount] = useState<number>(10);
  const [customMode, setCustomMode] = useState<'practice' | 'exam_hall'>('exam_hall');
  const [customTimerType, setCustomTimerType] = useState<'overall' | 'sprint' | 'none'>('overall');
  const [customOverallMinutes, setCustomOverallMinutes] = useState<number>(15);
  const [customSprintSeconds, setCustomSprintSeconds] = useState<number>(45);
  const [customMarkingPreset, setCustomMarkingPreset] = useState<
    'exam_default' | 'ssc_standard' | 'bpsc_no_neg' | 'bpsc_one_third'
  >('exam_default');

  // Study Hub State
  const [studySubTab, setStudySubTab] = useState<StudySubTab>('text');
  const [studySearch, setStudySearch] = useState<string>('');
  const [studySubjectFilter, setStudySubjectFilter] = useState<string>('ALL');
  const [studyFolderFilter] = useState<string>('ALL');
  const [flashcardIndex, setFlashcardIndex] = useState<number>(0);
  const [flashcardFlipped, setFlashcardFlipped] = useState<boolean>(false);

  // Modals & Overlays
  const [activeTestConfig, setActiveTestConfig] = useState<ActiveTestConfig | null>(null);
  const [activeNoteReader, setActiveNoteReader] = useState<StudyNote | null>(null);
  const [showProModal, setShowProModal] = useState<boolean>(false);
  const [showAdminModal, setShowAdminModal] = useState<boolean>(false);
  const [showMobileDrawer, setShowMobileDrawer] = useState<boolean>(false);
  const [adminTapCount, setAdminTapCount] = useState<number>(0);
  const [copiedDeviceToast, setCopiedDeviceToast] = useState<boolean>(false);
  const [copiedReferralToast, setCopiedReferralToast] = useState<boolean>(false);

  // Navigation History Stack & Profile Sub-Section
  const [tabHistory, setTabHistory] = useState<PrimaryTab[]>(['home']);
  const [profileSection, setProfileSection] = useState<ProfileSectionView>('overview');
  const [selectedDynamicCatId, setSelectedDynamicCatId] = useState<string>('ALL');

  // Cloud Sync State
  const [isSyncingCloud, setIsSyncingCloud] = useState<boolean>(false);

  // Refer & Earn Form State
  const [friendReferralInput, setFriendReferralInput] = useState<string>(
    studentState.referredByCode || ''
  );
  const [referralApplyMsg, setReferralApplyMsg] = useState<string>('');
  const [payoutUpiInput, setPayoutUpiInput] = useState<string>('');
  const [payoutMsg, setPayoutMsg] = useState<string>('');

  // Support Ticket & General Feedback Form State
  const [ticketSubject, setTicketSubject] = useState<string>('');
  const [ticketCategory, setTicketCategory] = useState<SupportTicket['category']>('technical');
  const [ticketPriority, setTicketPriority] = useState<SupportTicket['priority']>('medium');
  const [ticketMessage, setTicketMessage] = useState<string>('');
  const [ticketSubmitToast, setTicketSubmitToast] = useState<string>('');

  const [generalFeedbackRating, setGeneralFeedbackRating] = useState<number>(5);
  const [generalFeedbackCategory, setGeneralFeedbackCategory] =
    useState<StudentFeedbackItem['category']>('overall_experience');
  const [generalFeedbackMsg, setGeneralFeedbackMsg] = useState<string>('');
  const [generalFeedbackToast, setGeneralFeedbackToast] = useState<string>('');

  const isDark = theme === 'dark';

  // Navigate to tab with browser history & back stack support
  const navigateToTab = useCallback(
    (nextTab: PrimaryTab, subSection?: ProfileSectionView) => {
      setActiveTab((prev) => {
        if (prev !== nextTab) {
          setTabHistory((hist) => [...hist.slice(-8), nextTab]);
          try {
            window.history.pushState({ zyvraTab: nextTab }, '');
          } catch {
            // ignore
          }
        }
        return nextTab;
      });
      if (subSection) {
        setProfileSection(subSection);
      }
      setShowMobileDrawer(false);
    },
    []
  );

  const handleNavigateBack = useCallback(() => {
    if (showMobileDrawer) {
      setShowMobileDrawer(false);
      return;
    }
    if (showExamSwitcherModal) {
      setShowExamSwitcherModal(false);
      return;
    }
    if (tabHistory.length > 1) {
      const nextHist = tabHistory.slice(0, -1);
      const prevTab = nextHist[nextHist.length - 1] || 'home';
      setTabHistory(nextHist);
      setActiveTab(prevTab);
    } else if (activeTab !== 'home') {
      setActiveTab('home');
    }
  }, [showMobileDrawer, showExamSwitcherModal, tabHistory, activeTab]);

  // Listen to hardware / browser back button when no modal is capturing it
  useEffect(() => {
    const onPopState = () => {
      if (!activeTestConfig && !activeNoteReader && !showProModal && !showAdminModal) {
        handleNavigateBack();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [activeTestConfig, activeNoteReader, showProModal, showAdminModal, handleNavigateBack]);

  // Real Cloud Sync Bootstrap & Reconnect Effect
  const triggerCloudSync = useCallback(async () => {
    setIsSyncingCloud(true);
    try {
      const res = await syncWithCloudBackend();
      setDb(res.db);
      setStudentState(res.student);
    } finally {
      setIsSyncingCloud(false);
    }
  }, []);

  useEffect(() => {
    triggerCloudSync();
  }, [triggerCloudSync]);

  useEffect(() => {
    if (isOnline) {
      triggerCloudSync();
    }
  }, [isOnline, triggerCloudSync]);

  // Parse ?ref=ZYVREF-XXXX from URL if present
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlRef = params.get('ref');
      if (urlRef && !studentState.referredByCode && urlRef !== studentState.referralCode) {
        setFriendReferralInput(urlRef.toUpperCase());
      }
    } catch {
      // ignore
    }
  }, [studentState.referredByCode, studentState.referralCode]);

  // Sync theme & student state
  const handleToggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    saveThemeMode(next);
  };

  const cycleLanguage = () => {
    setLanguage((prev) =>
      prev === 'bilingual' ? 'en' : prev === 'en' ? 'hi' : 'bilingual'
    );
  };

  const persistAndQueueStudentState = (updated: StudentLocalState) => {
    const withPending: StudentLocalState = {
      ...updated,
      syncStatus: isOnline ? 'synced' : 'pending',
      lastSyncedAt: new Date().toISOString(),
    };
    setStudentState(withPending);
    saveStudentState(withPending);
    enqueueOfflineSyncItem('student_state', withPending);
    if (isOnline) {
      syncWithCloudBackend().then((res) => {
        setDb(res.db);
        setStudentState(res.student);
      });
    }
  };

  const handleSelectExam = (examName: string) => {
    setSelectedExam(examName);
    setSelectedFolderId('ALL');
    setSelectedDynamicCatId('ALL');
    setCustomSubject('ALL');
    setCustomTopic('ALL');
    setCustomFolderId('ALL');
    const recents = Array.from(
      new Set([examName, ...(studentState.recentExamNames || [])])
    ).slice(0, 6);
    const updated: StudentLocalState = {
      ...studentState,
      selectedExamName: examName,
      recentExamNames: recents,
    };
    persistAndQueueStudentState(updated);
    setShowExamSwitcherModal(false);
  };

  // Update Database from Admin & push to Cloud
  const handleUpdateDatabase = (updatedDb: MasterDatabase) => {
    setDb(updatedDb);
    saveMasterDatabase(updatedDb);
    pushMasterDatabaseToCloudBackend(updatedDb);
  };

  // Scoped Data for Currently Selected Exam
  const examQuestions = useMemo(
    () => getQuestionsForExam(db, selectedExam, selectedStage),
    [db, selectedExam, selectedStage]
  );

  const examFolders = useMemo(
    () => getFoldersForExam(db, selectedExam),
    [db, selectedExam]
  );

  const examNotes = useMemo(
    () => getNotesForExam(db, selectedExam),
    [db, selectedExam]
  );

  const examSubjectsList = useMemo(() => {
    if (currentExamObj?.subjects && currentExamObj.subjects.length > 0) {
      return currentExamObj.subjects;
    }
    return Object.keys(db.subjects || {});
  }, [currentExamObj, db.subjects]);

  // Filtered Exams for Exam Switcher & Discovery
  const filteredDiscoveryExams = useMemo(() => {
    return activeExams.filter((ex) => {
      const matchesFam = selectedFamilyId === 'ALL' || ex.familyId === selectedFamilyId;
      const q = safeLower(examSearchQuery);
      const matchesSearch =
        !q ||
        safeLower(ex.name).includes(q) ||
        safeLower(ex.name_hi).includes(q) ||
        safeLower(ex.shortCode).includes(q) ||
        safeLower(ex.stateOrAuthority).includes(q);
      return matchesFam && matchesSearch;
    });
  }, [activeExams, selectedFamilyId, examSearchQuery]);

  // Filtered PYQ Trends for Selected Exam
  const filteredTrends = useMemo(() => {
    return (db.pyqTrends || []).filter((t) => {
      const targetExam = t.examId || t.exam || 'SSC CGL';
      const matchesEx = examStringsMatch(targetExam, selectedExam);
      const matchesSub = trendSubjectFilter === 'ALL' || t.subject === trendSubjectFilter;
      const q = safeLower(trendSearch);
      const matchesQuery =
        !q ||
        safeLower(t.topic_en).includes(q) ||
        safeLower(t.topic_hi).includes(q) ||
        safeLower(t.subject).includes(q);
      return matchesEx && matchesSub && matchesQuery;
    });
  }, [db.pyqTrends, selectedExam, trendSubjectFilter, trendSearch]);

  // Active Dynamic Categories for Current Exam
  const examDynamicCategories = useMemo(() => {
    return (db.dynamicCategories || [])
      .filter(
        (cat) =>
          cat.status === 'active' &&
          (!cat.examId ||
            cat.examId === 'ALL' ||
            examStringsMatch(cat.examId, selectedExam) ||
            examStringsMatch(cat.examId, currentExamObj?.id))
      )
      .sort((a, b) => a.order - b.order);
  }, [db.dynamicCategories, selectedExam, currentExamObj]);

  // Active Promotional Offers for Current Exam
  const activePromotionalOffers = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return (db.promotionalOffers || []).filter((off) => {
      const isOffActive = off.isActive ?? off.active ?? true;
      if (!isOffActive) return false;
      if (off.validFrom && off.validFrom > today) return false;
      if (off.validUntil && off.validUntil < today) return false;
      if (
        off.targetExam &&
        off.targetExam !== 'ALL' &&
        !examStringsMatch(off.targetExam, selectedExam)
      ) {
        return false;
      }
      return true;
    });
  }, [db.promotionalOffers, selectedExam]);

  // Filtered Test Series Packs
  const filteredTestPacks = useMemo(() => {
    return (db.testSeries || []).filter((pack) => {
      const matchesExam =
        examStringsMatch(pack.exam, selectedExam) || pack.exam === 'All SSC Exams';
      const matchesFolder = selectedFolderId === 'ALL' || pack.folderId === selectedFolderId;
      const matchesCat =
        seriesCategoryFilter === 'ALL' || pack.category === seriesCategoryFilter;
      const matchesDynCat =
        selectedDynamicCatId === 'ALL' ||
        pack.categoryId === selectedDynamicCatId ||
        pack.subcategoryId === selectedDynamicCatId ||
        pack.dynamicCategoryId === selectedDynamicCatId ||
        pack.dynamicSubcategoryId === selectedDynamicCatId;
      return matchesExam && matchesFolder && matchesCat && matchesDynCat;
    });
  }, [db.testSeries, selectedExam, selectedFolderId, seriesCategoryFilter, selectedDynamicCatId]);

  // Custom Test Builder Matching Question Pool
  const customBuilderPool = useMemo(() => {
    let pool = examQuestions.length > 0 ? examQuestions : db.questions;

    if (customSubject !== 'ALL') {
      pool = pool.filter((q) => q.subject === customSubject);
    }
    if (customTopic !== 'ALL') {
      pool = pool.filter((q) => q.topic === customTopic || q.chapter === customTopic);
    }
    if (customFolderId !== 'ALL') {
      pool = pool.filter((q) => q.folderId === customFolderId);
    }
    if (customDifficulty !== 'ALL') {
      pool = pool.filter((q) => q.difficulty === customDifficulty);
    }
    if (customSourcePool === 'verified_pyq') {
      pool = pool.filter(
        (q) => q.category === 'pyq' || q.sourceClassification === 'verified_pyq'
      );
    } else if (customSourcePool === 'ai_guess') {
      pool = pool.filter(
        (q) => q.category === 'guess' || q.sourceClassification === 'ai_practice'
      );
    } else if (customSourcePool === 'bookmarks') {
      pool = pool.filter((q) => studentState.bookmarkedQuestionIds.includes(q.id));
    } else if (customSourcePool === 'mistakes') {
      pool = pool.filter((q) => Boolean(studentState.mistakes[q.id]));
    }

    if (!studentState.isProUnlocked) {
      pool = pool.filter((q) => !q.isPro);
    }

    return pool;
  }, [
    examQuestions,
    db.questions,
    customSubject,
    customTopic,
    customFolderId,
    customDifficulty,
    customSourcePool,
    studentState.bookmarkedQuestionIds,
    studentState.mistakes,
    studentState.isProUnlocked,
  ]);

  // Study Hub Filtered Notes
  const filteredStudyNotes = useMemo(() => {
    const targetType = studySubTab === 'pdf' ? 'pdf' : 'text';
    return examNotes.filter((n) => {
      if (n.type !== targetType) return false;
      if (studySubjectFilter !== 'ALL' && n.subject !== studySubjectFilter) return false;
      if (studyFolderFilter !== 'ALL' && n.folderId !== studyFolderFilter) return false;
      const q = safeLower(studySearch);
      if (
        q &&
        !safeLower(n.title_en).includes(q) &&
        !safeLower(n.title_hi).includes(q) &&
        !safeLower(n.topic).includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [examNotes, studySubTab, studySubjectFilter, studyFolderFilter, studySearch]);

  // Bookmarked Questions & Mistake Questions
  const bookmarkedQuestions = useMemo(
    () => db.questions.filter((q) => studentState.bookmarkedQuestionIds.includes(q.id)),
    [db.questions, studentState.bookmarkedQuestionIds]
  );

  const mistakeQuestions = useMemo(
    () => db.questions.filter((q) => Boolean(studentState.mistakes[q.id])),
    [db.questions, studentState.mistakes]
  );

  // Student Progress Summary Stats
  const progressSnapshot = useMemo(() => {
    const history = studentState.testHistory || [];
    const totalTests = history.length;
    const totalPracticed = history.reduce((acc, h) => acc + (h.attempted || 0), 0);
    const avgAccuracy =
      totalTests > 0
        ? Math.round(history.reduce((acc, h) => acc + (h.accuracy || 0), 0) / totalTests)
        : 0;
    return { totalTests, totalPracticed, avgAccuracy };
  }, [studentState.testHistory]);

  // ============================================================================
  // TEST LAUNCHERS & HANDLERS
  // ============================================================================
  const launchTestPack = (pack: TestSeriesPack) => {
    if (pack.isPro && !studentState.isProUnlocked) {
      setShowProModal(true);
      return;
    }
    const packQs = db.questions.filter((q) => pack.questionIds.includes(q.id));
    const fallbackQs = examQuestions.length > 0 ? examQuestions : db.questions.slice(0, 8);
    const finalQs = packQs.length > 0 ? packQs : fallbackQs;

    setActiveTestConfig({
      packId: pack.id,
      title: language === 'hi' ? pack.title_hi : pack.title_en,
      exam: pack.exam || selectedExam,
      stage: selectedStage !== 'ALL' ? selectedStage : currentExamObj?.stages?.[0]?.name,
      questions: finalQs,
      mode: 'exam_hall',
      timerType: 'overall',
      overallMinutes: pack.durationMinutes || 20,
      sprintSeconds: 45,
      marksPerCorrect: pack.marksPerCorrect ?? currentExamObj?.marksPerCorrect ?? 2.0,
      negativeMarking: pack.negativeMarking ?? currentExamObj?.negativeMarking ?? 0.5,
      marksPerUnanswered: 0,
      isOfficialSimulation: true,
      customizationRules: pack.customizationRules,
    });
  };

  const launchQuickExamPractice = (categoryFilter?: 'pyq' | 'guess') => {
    let pool = examQuestions.length > 0 ? examQuestions : db.questions;
    if (categoryFilter) {
      const catMatches = pool.filter((q) => q.category === categoryFilter);
      if (catMatches.length > 0) pool = catMatches;
    }
    if (!studentState.isProUnlocked) {
      const freeOnly = pool.filter((q) => !q.isPro);
      if (freeOnly.length > 0) pool = freeOnly;
    }
    const chosen = pool.slice(0, 10);
    setActiveTestConfig({
      title: `${selectedExam} ${categoryFilter === 'guess' ? 'Expected Mock' : 'Official PYQ Practice'}`,
      exam: selectedExam,
      stage: selectedStage !== 'ALL' ? selectedStage : currentExamObj?.stages?.[0]?.name,
      questions: chosen,
      mode: 'practice',
      timerType: 'overall',
      overallMinutes: 15,
      sprintSeconds: 45,
      marksPerCorrect: currentExamObj?.marksPerCorrect ?? 2.0,
      negativeMarking: currentExamObj?.negativeMarking ?? 0.5,
      marksPerUnanswered: 0,
    });
  };

  const launchCustomBuiltTest = () => {
    if (customBuilderPool.length === 0) return;
    const chosen = customBuilderPool.slice(0, customQuestionCount);

    let marksCorrect = currentExamObj?.marksPerCorrect ?? 2.0;
    let negMarks = currentExamObj?.negativeMarking ?? 0.5;
    if (customMarkingPreset === 'ssc_standard') {
      marksCorrect = 2.0;
      negMarks = 0.5;
    } else if (customMarkingPreset === 'bpsc_no_neg') {
      marksCorrect = 1.0;
      negMarks = 0.0;
    } else if (customMarkingPreset === 'bpsc_one_third') {
      marksCorrect = 1.0;
      negMarks = 0.33;
    }

    setActiveTestConfig({
      title: `${selectedExam} Custom Test (${
        customSubject === 'ALL' ? 'Full Syllabus' : customSubject
      })`,
      exam: selectedExam,
      stage: selectedStage !== 'ALL' ? selectedStage : currentExamObj?.stages?.[0]?.name,
      questions: chosen,
      mode: customMode,
      timerType: customTimerType,
      overallMinutes: customOverallMinutes,
      sprintSeconds: customSprintSeconds,
      marksPerCorrect: marksCorrect,
      negativeMarking: negMarks,
      marksPerUnanswered: 0,
    });
  };

  const launchMistakeRetest = () => {
    if (mistakeQuestions.length === 0) return;
    setActiveTestConfig({
      title: `Mistake Notebook Retest (${mistakeQuestions.length} Questions)`,
      exam: selectedExam,
      questions: mistakeQuestions,
      mode: 'practice',
      timerType: 'overall',
      overallMinutes: Math.max(10, mistakeQuestions.length * 2),
      sprintSeconds: 45,
      marksPerCorrect: currentExamObj?.marksPerCorrect ?? 2.0,
      negativeMarking: currentExamObj?.negativeMarking ?? 0.5,
    });
  };

  const handleCompleteTest = (record: TestAttemptRecord) => {
    const nextMistakes = { ...studentState.mistakes };
    record.questionIds.forEach((qid) => {
      const qObj = db.questions.find((q) => q.id === qid);
      if (!qObj) return;
      const ans = record.userAnswers[qid];
      if (ans === undefined || ans === null) {
        nextMistakes[qid] = {
          questionId: qid,
          examId: record.exam,
          errorCount: (nextMistakes[qid]?.errorCount || 0) + 1,
          lastReason: 'skipped',
          updatedAt: new Date().toISOString().slice(0, 10),
        };
      } else if (ans !== qObj.correctIndex) {
        nextMistakes[qid] = {
          questionId: qid,
          examId: record.exam,
          errorCount: (nextMistakes[qid]?.errorCount || 0) + 1,
          lastReason: 'wrong',
          updatedAt: new Date().toISOString().slice(0, 10),
        };
      } else if (nextMistakes[qid]) {
        delete nextMistakes[qid];
      }
    });

    const updatedState: StudentLocalState = {
      ...studentState,
      mistakes: nextMistakes,
      testHistory: [record, ...(studentState.testHistory || [])].slice(0, 50),
    };
    persistAndQueueStudentState(updatedState);
  };

  const handleSubmitTestFeedback = async (feedbackPayload: {
    testAttemptId?: string;
    attemptId?: string;
    testTitle?: string;
    packTitle?: string;
    exam?: string;
    rating: number;
    category: StudentFeedbackItem['category'];
    message: string;
  }) => {
    const newItem: StudentFeedbackItem = {
      id: `fb-${Date.now()}`,
      studentName: studentState.studentName,
      mobile: studentState.mobileNumber,
      deviceId: studentState.deviceId,
      testAttemptId: feedbackPayload.testAttemptId || feedbackPayload.attemptId,
      testTitle: feedbackPayload.testTitle || feedbackPayload.packTitle,
      exam: feedbackPayload.exam || selectedExam,
      rating: feedbackPayload.rating,
      category: feedbackPayload.category,
      message: feedbackPayload.message,
      status: 'unread',
      createdAt: new Date().toLocaleString('en-IN'),
    };
    const mergedFeedback = [newItem, ...(db.studentFeedback || db.feedbackList || [])];
    const nextDb: MasterDatabase = {
      ...db,
      studentFeedback: mergedFeedback,
      feedbackList: mergedFeedback,
    };
    setDb(nextDb);
    saveMasterDatabase(nextDb);
    enqueueOfflineSyncItem('feedback', newItem);
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newItem),
      });
    } catch {
      // queued in offline sync queue
    }
  };

  const handleCreateSupportTicket = async () => {
    if (!ticketSubject.trim() || !ticketMessage.trim()) return;
    const newTicket: SupportTicket = {
      id: `tkt-${Date.now()}`,
      ticketNumber: `TKT-${Math.floor(100000 + Math.random() * 900000)}`,
      studentName: studentState.studentName,
      mobile: studentState.mobileNumber,
      deviceId: studentState.deviceId,
      category: ticketCategory,
      subject: ticketSubject.trim(),
      message: ticketMessage.trim(),
      status: 'open',
      priority: ticketPriority,
      createdAt: new Date().toLocaleString('en-IN'),
      updatedAt: new Date().toLocaleString('en-IN'),
      replies: [],
    };
    const nextDb: MasterDatabase = {
      ...db,
      supportTickets: [newTicket, ...(db.supportTickets || [])],
    };
    setDb(nextDb);
    saveMasterDatabase(nextDb);
    enqueueOfflineSyncItem('ticket', newTicket);
    setTicketSubject('');
    setTicketMessage('');
    setTicketSubmitToast(`Ticket ${newTicket.ticketNumber} created!`);
    setTimeout(() => setTicketSubmitToast(''), 4000);
    try {
      await fetch('/api/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTicket),
      });
    } catch {
      // queued in offline sync queue
    }
  };

  const handleApplyReferralCode = async () => {
    const cleanCode = friendReferralInput.trim().toUpperCase();
    if (!cleanCode) return;
    if (cleanCode === studentState.referralCode) {
      setReferralApplyMsg('Self-referral is blocked.');
      return;
    }
    try {
      const res = await fetch('/api/referrals/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referralCode: cleanCode,
          referredStudentName: studentState.studentName,
          referredMobile: studentState.mobileNumber,
          referredDeviceId: studentState.deviceId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setReferralApplyMsg(data.error || 'Could not apply referral code.');
        return;
      }
      const updated = { ...studentState, referredByCode: cleanCode };
      persistAndQueueStudentState(updated);
      setReferralApplyMsg('Referral code linked! Qualifying purchase rewards your referrer.');
    } catch {
      const updated = { ...studentState, referredByCode: cleanCode };
      persistAndQueueStudentState(updated);
      setReferralApplyMsg('Saved locally and queued for verification.');
    }
  };

  const handleRequestReferralPayout = async () => {
    if (!payoutUpiInput.trim()) {
      setPayoutMsg('Please enter your UPI ID for payout.');
      return;
    }
    try {
      const res = await fetch('/api/referrals/payout-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referrerDeviceId: studentState.deviceId,
          referralCode: studentState.referralCode,
          upiId: payoutUpiInput.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPayoutMsg(data.error || 'Minimum payout threshold not met yet.');
        return;
      }
      const requestedVal = data.totalRequested ?? data.totalPayable ?? 0;
      setPayoutMsg(`Payout request submitted for ₹${requestedVal}!`);
      triggerCloudSync();
    } catch {
      setPayoutMsg('Connect to internet to submit live payout request.');
    }
  };

  const handleToggleBookmarkQuestion = (questionId: string) => {
    const exists = studentState.bookmarkedQuestionIds.includes(questionId);
    const nextIds = exists
      ? studentState.bookmarkedQuestionIds.filter((id) => id !== questionId)
      : [questionId, ...studentState.bookmarkedQuestionIds];
    const updated = { ...studentState, bookmarkedQuestionIds: nextIds };
    persistAndQueueStudentState(updated);
  };

  const handleToggleBookmarkNote = (noteId: string) => {
    const exists = studentState.bookmarkedNoteIds.includes(noteId);
    const nextIds = exists
      ? studentState.bookmarkedNoteIds.filter((id) => id !== noteId)
      : [noteId, ...studentState.bookmarkedNoteIds];
    const updated = { ...studentState, bookmarkedNoteIds: nextIds };
    persistAndQueueStudentState(updated);
  };

  const handleUpdateStudentIdentity = (name: string, mobile: string) => {
    const newDevice = generateDeviceId(mobile);
    const newRefCode = generateReferralCode(newDevice);
    const updated: StudentLocalState = {
      ...studentState,
      studentName: name,
      mobileNumber: mobile,
      deviceId: newDevice,
      referralCode: newRefCode,
    };
    persistAndQueueStudentState(updated);
  };

  const handleProUnlockSuccess = (
    proKey: string,
    couponCode = 'NONE',
    amountPaid = 149,
    utrNumber = 'DIRECT-KEY'
  ) => {
    const updatedStudent: StudentLocalState = {
      ...studentState,
      isProUnlocked: true,
      activatedProKey: proKey,
      activatedAt: new Date().toLocaleString('en-IN'),
    };
    persistAndQueueStudentState(updatedStudent);

    const newSale: StudentSaleLog = {
      id: `sale-${Date.now()}`,
      studentName: studentState.studentName,
      mobile: studentState.mobileNumber,
      deviceId: studentState.deviceId,
      utrNumber,
      amountPaid,
      couponUsed: couponCode,
      proKey,
      generatedProKey: proKey,
      unlockedScope: 'Universal All-Exams Pro',
      activatedAt: new Date().toLocaleString('en-IN'),
      referredByCode: studentState.referredByCode,
    };
    handleUpdateDatabase({
      ...db,
      salesLog: [newSale, ...(db.salesLog || [])],
    });

    if (studentState.referredByCode) {
      fetch('/api/referrals/qualify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referralCode: studentState.referredByCode,
          referredStudentName: studentState.studentName,
          referredMobile: studentState.mobileNumber,
          referredDeviceId: studentState.deviceId,
          purchaseAmount: amountPaid,
          utrNumber,
        }),
      })
        .then(() => triggerCloudSync())
        .catch(() => {});
    }
  };

  // Discreet 5-Tap Gesture on Zyvra Logo in Profile Area (Discovery mechanism only)
  const [lastAdminTapTime, setLastAdminTapTime] = useState<number>(0);
  const handleVersionTap = () => {
    const now = Date.now();
    const withinWindow = now - lastAdminTapTime < 3000;
    const next = withinWindow ? adminTapCount + 1 : 1;
    setLastAdminTapTime(now);
    if (next >= 5) {
      setAdminTapCount(0);
      setShowAdminModal(true);
    } else {
      setAdminTapCount(next);
    }
  };

  const primaryNavItems: Array<{
    id: PrimaryTab;
    label_en: string;
    label_hi: string;
    icon: React.ReactNode;
  }> = [
    { id: 'home', label_en: 'Home', label_hi: 'होम', icon: <Home className="h-4 w-4" /> },
    { id: 'exams', label_en: 'Exams', label_hi: 'परीक्षाएं', icon: <Compass className="h-4 w-4" /> },
    {
      id: 'practice',
      label_en: 'Practice',
      label_hi: 'कस्टम टेस्ट',
      icon: <Sliders className="h-4 w-4" />,
    },
    {
      id: 'study',
      label_en: 'Study',
      label_hi: 'स्टडी हब',
      icon: <BookOpen className="h-4 w-4" />,
    },
    {
      id: 'profile',
      label_en: 'Profile',
      label_hi: 'प्रोफ़ाइल',
      icon: <User className="h-4 w-4" />,
    },
  ];

  return (
    <div
      className={`min-h-screen overflow-x-hidden transition-colors ${
        isDark ? 'bg-[#0A0E17] text-slate-100' : 'bg-[#F8FAFC] text-slate-900'
      }`}
    >
      {/* ==========================================================================
          OFFLINE CONNECTIVITY INDICATOR BANNER
         ========================================================================== */}
      {!isOnline && (
        <div className="bg-amber-500/95 px-4 py-1.5 text-center text-xs font-bold text-slate-950">
          <span className="inline-flex items-center gap-1.5">
            <WifiOff className="h-3.5 w-3.5" />
            Offline Mode Active — Zyvra is running from your local cached question bank & study notes.
          </span>
        </div>
      )}

      {/* ==========================================================================
          STICKY TOP BAR (3-Zone Desktop Contract + Mobile Compact Header + Drawer)
         ========================================================================== */}
      <header
        className={`sticky top-0 z-30 h-16 border-b px-3 sm:px-6 ${
          isDark ? 'liquid-glass-dark' : 'liquid-glass-light'
        }`}
      >
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-2 sm:gap-3">
          {/* Zone 1 (Left): Hamburger Menu + Back Button + Zyvra Brand Logo + Exam Switcher */}
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden sm:gap-2.5">
            {/* Hamburger Menu Button */}
            <button
              type="button"
              onClick={() => setShowMobileDrawer(true)}
              className={`inline-flex min-h-[38px] min-w-[38px] shrink-0 items-center justify-center rounded-xl border transition ${
                isDark
                  ? 'border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/10'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
              }`}
              title="Open Navigation Menu"
              aria-label="Open Navigation Menu"
            >
              <Menu className="h-4 w-4" />
            </button>

            {/* Contextual Back Button when not on Home */}
            {activeTab !== 'home' && (
              <button
                type="button"
                onClick={handleNavigateBack}
                className={`inline-flex min-h-[38px] min-w-[38px] shrink-0 items-center justify-center rounded-xl border transition ${
                  isDark
                    ? 'border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/10'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
                title="Go Back"
                aria-label="Go Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}

            <button
              type="button"
              onClick={() => navigateToTab('home')}
              className="shrink-0 text-left focus:outline-none"
              title="Zyvra Home"
            >
              <ZyvraLogo size="md" showTagline={false} />
            </button>

            {/* Quick Exam Switcher Trigger */}
            <button
              type="button"
              onClick={() => setShowExamSwitcherModal(true)}
              className={`inline-flex min-h-[36px] min-w-0 max-w-[108px] shrink items-center gap-1 overflow-hidden whitespace-nowrap rounded-xl border px-2 py-1.5 text-xs font-bold transition sm:min-h-[38px] sm:max-w-[180px] sm:gap-1.5 sm:px-3 ${
                isDark
                  ? 'border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/10'
                  : 'border-slate-200 bg-slate-100 text-slate-900 hover:bg-slate-200/70'
              }`}
              title="Switch Target Exam"
            >
              <span className="h-2 w-2 shrink-0 rounded-full bg-cyan-400" />
              <span className="min-w-0 flex-1 truncate">{currentExamObj?.shortCode || selectedExam}</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400 rotate-90" />
            </button>
          </div>

          {/* Zone 2 (Center — Desktop Only): 5 Primary Navigation Links */}
          <nav className="hidden lg:flex shrink-0 items-center gap-1">
            {primaryNavItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateToTab(item.id)}
                  className={`inline-flex min-h-[40px] items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                    isActive
                      ? 'bg-indigo-600 text-white'
                      : isDark
                      ? 'text-slate-300 hover:bg-white/5 hover:text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  {item.icon}
                  <span>{language === 'hi' ? item.label_hi : item.label_en}</span>
                </button>
              );
            })}
          </nav>

          {/* Zone 3 (Right): Cloud Sync Status, PWA Install, Language, Theme & Pro Status */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {/* Real Cloud Sync Badge */}
            <button
              type="button"
              onClick={triggerCloudSync}
              className={`inline-flex min-h-[36px] items-center gap-1 rounded-xl border px-2 py-1 text-[11px] font-bold transition sm:min-h-[38px] sm:px-2.5 ${
                studentState.syncStatus === 'synced' && isOnline
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : studentState.syncStatus === 'failed'
                  ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
              }`}
              title={
                studentState.syncStatus === 'synced' && isOnline
                  ? `Cloud Synced (${studentState.lastSyncedAt || 'Live'})`
                  : 'Sync Pending — Tap to Sync with Cloud'
              }
            >
              {isSyncingCloud ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : studentState.syncStatus === 'synced' && isOnline ? (
                <Cloud className="h-3.5 w-3.5" />
              ) : (
                <CloudOff className="h-3.5 w-3.5" />
              )}
              <span className="hidden md:inline">
                {isSyncingCloud
                  ? 'Syncing...'
                  : studentState.syncStatus === 'synced' && isOnline
                  ? 'Synced'
                  : studentState.syncStatus === 'failed'
                  ? 'Sync Failed'
                  : 'Sync Pending'}
              </span>
            </button>

            {!isInstalled && isInstallable && (
              <button
                type="button"
                onClick={install}
                className="hidden sm:inline-flex min-h-[38px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-bold text-cyan-300 hover:bg-cyan-500/20"
                title="Install Zyvra App"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Install</span>
              </button>
            )}

            <button
              type="button"
              onClick={cycleLanguage}
              className={`inline-flex min-h-[36px] shrink-0 items-center justify-center whitespace-nowrap rounded-xl border px-2 py-1.5 text-[11px] font-bold transition sm:min-h-[38px] sm:px-2.5 sm:text-xs ${
                isDark
                  ? 'border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/10'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
              }`}
              title="Switch App Language (Bilingual / English / Hindi)"
            >
              अ/A · {language === 'bilingual' ? 'Bi' : language.toUpperCase()}
            </button>

            <button
              type="button"
              onClick={handleToggleTheme}
              className={`inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-xl border transition ${
                isDark
                  ? 'border-white/10 bg-white/[0.04] text-amber-300 hover:bg-white/10'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
              }`}
              title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {studentState.isProUnlocked ? (
              <span className="hidden sm:inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-400">
                <ShieldCheck className="h-4 w-4" />
                Pro Active
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setShowProModal(true)}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Pro</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ==========================================================================
          SLIDE-OUT HAMBURGER NAVIGATION DRAWER (MOBILE & DESKTOP)
         ========================================================================== */}
      {showMobileDrawer && (
        <div className="fixed inset-0 z-50 flex bg-black/70 backdrop-blur-sm">
          <div
            className={`flex h-full w-80 max-w-[85vw] flex-col justify-between border-r p-5 ${
              isDark
                ? 'border-white/10 bg-[#0F1624] text-slate-100'
                : 'border-slate-200 bg-white text-slate-900'
            }`}
          >
            <div className="space-y-5 overflow-y-auto">
              <div className="flex items-center justify-between border-b pb-4 border-white/10">
                <ZyvraLogo size="md" showTagline={true} />
                <button
                  type="button"
                  onClick={() => setShowMobileDrawer(false)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Active Student Identity */}
              <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-3.5">
                <p className="text-xs font-bold text-indigo-400">{studentState.studentName}</p>
                <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
                  Target: {selectedExam} · ID: {studentState.deviceId}
                </p>
              </div>

              {/* Drawer Navigation Links */}
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => navigateToTab('home')}
                  className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3.5 text-xs font-bold ${
                    activeTab === 'home' ? 'bg-indigo-600 text-white' : 'hover:bg-white/5'
                  }`}
                >
                  <Home className="h-4 w-4" />
                  <span>Home Dashboard</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigateToTab('exams')}
                  className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3.5 text-xs font-bold ${
                    activeTab === 'exams' ? 'bg-indigo-600 text-white' : 'hover:bg-white/5'
                  }`}
                >
                  <Compass className="h-4 w-4" />
                  <span>Exams, Test Series & PYQs</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigateToTab('practice')}
                  className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3.5 text-xs font-bold ${
                    activeTab === 'practice' ? 'bg-indigo-600 text-white' : 'hover:bg-white/5'
                  }`}
                >
                  <Sliders className="h-4 w-4" />
                  <span>Custom Practice Builder</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigateToTab('study')}
                  className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3.5 text-xs font-bold ${
                    activeTab === 'study' ? 'bg-indigo-600 text-white' : 'hover:bg-white/5'
                  }`}
                >
                  <BookOpen className="h-4 w-4" />
                  <span>Study Notes, PDFs & Flashcards</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigateToTab('profile', 'referrals')}
                  className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3.5 text-xs font-bold ${
                    activeTab === 'profile' && profileSection === 'referrals'
                      ? 'bg-indigo-600 text-white'
                      : 'hover:bg-white/5'
                  }`}
                >
                  <Gift className="h-4 w-4 text-amber-400" />
                  <span>Refer & Earn Rewards</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigateToTab('profile', 'support')}
                  className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3.5 text-xs font-bold ${
                    activeTab === 'profile' && profileSection === 'support'
                      ? 'bg-indigo-600 text-white'
                      : 'hover:bg-white/5'
                  }`}
                >
                  <Headphones className="h-4 w-4 text-cyan-400" />
                  <span>Support, Contact & Feedback</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigateToTab('profile', 'overview')}
                  className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3.5 text-xs font-bold ${
                    activeTab === 'profile' && profileSection === 'overview'
                      ? 'bg-indigo-600 text-white'
                      : 'hover:bg-white/5'
                  }`}
                >
                  <User className="h-4 w-4" />
                  <span>Profile & Test History</span>
                </button>
              </div>
            </div>

            <div className="space-y-2 border-t pt-4 border-white/10">
              <button
                type="button"
                onClick={() => {
                  triggerCloudSync();
                  setShowMobileDrawer(false);
                }}
                className="flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-xs font-bold text-emerald-400"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Sync Cloud Progress Now
              </button>
            </div>
          </div>
          <div className="flex-1" onClick={() => setShowMobileDrawer(false)} />
        </div>
      )}

      {/* ==========================================================================
          MAIN WORKSPACE CONTAINER
         ========================================================================== */}
      <main className="mx-auto max-w-6xl px-3.5 pb-28 pt-5 sm:px-6 md:pb-12">
        {/* ========================================================================
            TAB 1: HOME — CALM, FOCUSED STUDENT WORKSPACE
           ======================================================================== */}
        {activeTab === 'home' && (
          <div className="space-y-7">
            {/* Section A + B: Active Exam Context & Single Prominent Study Action */}
            <section
              className={`rounded-2xl p-5 sm:p-7 ${
                isDark ? 'surface-card-dark' : 'surface-card-light'
              }`}
            >
              <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
                <div className="space-y-2 max-w-2xl">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="font-bold uppercase tracking-wider text-indigo-400">
                      Active Target Exam
                    </span>
                    <span>·</span>
                    <span>{currentExamObj?.stateOrAuthority || 'Official Board'}</span>
                    <span>·</span>
                    <span className="tabular-nums">
                      Marking: +{currentExamObj?.marksPerCorrect ?? 2.0} /{' '}
                      {(currentExamObj?.negativeMarking ?? 0.5) > 0
                        ? `-${currentExamObj?.negativeMarking}`
                        : 'No Negative (0)'}
                    </span>
                  </div>

                  <h1 className="text-xl font-extrabold tracking-tight sm:text-3xl">
                    {language === 'hi' && currentExamObj?.name_hi
                      ? currentExamObj.name_hi
                      : currentExamObj?.name || selectedExam}
                  </h1>

                  <p className="text-xs leading-relaxed text-slate-400 sm:text-sm">
                    {currentExamObj?.description ||
                      'Practice official shift-wise PYQs, bilingual explanations with 15-second shortcuts, and structured study notes on Zyvra.'}
                  </p>

                  {/* Stage Selector Pills if the exam has multiple stages */}
                  {currentExamObj?.stages && currentExamObj.stages.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 pt-2">
                      <span className="text-xs font-semibold text-slate-400">Stage:</span>
                      <button
                        type="button"
                        onClick={() => setSelectedStage('ALL')}
                        className={`min-h-[34px] rounded-xl px-3 py-1 text-xs font-semibold transition ${
                          selectedStage === 'ALL'
                            ? 'bg-indigo-600 text-white'
                            : isDark
                            ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        All Stages
                      </button>
                      {currentExamObj.stages.map((stg) => (
                        <button
                          key={stg.id}
                          type="button"
                          onClick={() => setSelectedStage(stg.name)}
                          className={`min-h-[34px] rounded-xl px-3 py-1 text-xs font-semibold transition ${
                            selectedStage === stg.name
                              ? 'bg-indigo-600 text-white'
                              : isDark
                              ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {stg.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Primary Study Action Box */}
                <div className="flex flex-col gap-2.5 sm:flex-row lg:flex-col lg:min-w-[260px]">
                  <button
                    type="button"
                    onClick={() => launchQuickExamPractice('pyq')}
                    className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    Continue PYQ Practice
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowExamSwitcherModal(true)}
                    className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border px-5 py-2.5 text-xs font-semibold transition ${
                      isDark
                        ? 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/10'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    Switch Target Exam ({activeExams.length})
                  </button>
                </div>
              </div>
            </section>

            {/* Promotional Offers & Templates Strip (Phase 11) */}
            {activePromotionalOffers.length > 0 && !studentState.isProUnlocked && (
              <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {activePromotionalOffers.map((promo) => {
                  const templateTheme: Record<OfferTemplateId, string> = {
                    royal_indigo:
                      'from-indigo-950/90 via-indigo-900/60 to-slate-950 border-indigo-500/40',
                    emerald_scholar:
                      'from-emerald-950/90 via-teal-900/60 to-slate-950 border-emerald-500/40',
                    amber_festive:
                      'from-amber-950/90 via-orange-900/60 to-slate-950 border-amber-500/40',
                    crimson_urgent:
                      'from-rose-950/90 via-red-900/60 to-slate-950 border-rose-500/40',
                  };
                  return (
                    <div
                      key={promo.id}
                      className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 text-white ${
                        templateTheme[promo.templateId] || templateTheme.royal_indigo
                      }`}
                    >
                      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-md bg-white/15 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-300">
                              {promo.badgeText || promo.discountText || `${promo.discountPercent || 70}% OFF`}
                            </span>
                            {promo.couponCode && (
                              <span className="inline-flex items-center gap-1 rounded-md border border-white/20 bg-black/30 px-2 py-0.5 font-mono text-[11px] font-bold text-cyan-300">
                                <Tag className="h-3 w-3" />
                                {promo.couponCode}
                              </span>
                            )}
                          </div>
                          <h3 className="text-base font-extrabold">
                            {language === 'hi'
                              ? promo.title_hi || promo.title_en || promo.title
                              : promo.title_en || promo.title}
                          </h3>
                          <p className="text-xs text-slate-200">
                            {language === 'hi'
                              ? promo.subtitle_hi || promo.subtitle_en || promo.subtitle
                              : promo.subtitle_en || promo.subtitle}
                          </p>
                          <div className="flex items-baseline gap-2 pt-1">
                            <span className="text-xl font-extrabold text-emerald-400">
                              ₹{promo.finalPrice ?? db.offers?.offerPrice ?? 149}
                            </span>
                            <span className="text-xs text-slate-400 line-through">
                              ₹{promo.originalPrice ?? db.offers?.mrp ?? 999}
                            </span>
                            <span className="text-[11px] text-slate-300">
                              Valid till {promo.validUntil}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-col items-start gap-2 sm:items-end">
                          {promo.bannerImageUrl && (
                            <img
                              src={promo.bannerImageUrl}
                              alt={promo.title_en || promo.title || 'Promotional Offer'}
                              className="h-16 w-28 rounded-xl border border-white/15 object-cover"
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => setShowProModal(true)}
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-xs font-extrabold text-slate-950 hover:bg-slate-100"
                          >
                            <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                            Claim Offer
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </section>
            )}

            {/* Section C: 6 Clean Learning Shortcuts */}
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-bold">Study & Practice Modes</h2>
                <span className="text-xs text-slate-400">
                  {examQuestions.length} Questions · {examNotes.length} Study Notes
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('exams');
                    setExamsSubView('series');
                    setSeriesCategoryFilter('pyq');
                  }}
                  className={`flex min-h-[100px] flex-col justify-between rounded-2xl p-4 text-left transition hover:border-indigo-500/50 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <Trophy className="h-5 w-5 text-indigo-400" />
                  <div>
                    <p className="text-sm font-bold">PYQ Practice</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">Official shift papers</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('exams');
                    setExamsSubView('series');
                    setSeriesCategoryFilter('ALL');
                  }}
                  className={`flex min-h-[100px] flex-col justify-between rounded-2xl p-4 text-left transition hover:border-indigo-500/50 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <Target className="h-5 w-5 text-emerald-400" />
                  <div>
                    <p className="text-sm font-bold">Mock Tests</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {filteredTestPacks.length} test packs
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('practice');
                    setBuilderStep(1);
                  }}
                  className={`flex min-h-[100px] flex-col justify-between rounded-2xl p-4 text-left transition hover:border-indigo-500/50 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <Sliders className="h-5 w-5 text-amber-400" />
                  <div>
                    <p className="text-sm font-bold">Custom Test</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">By topic & timer</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('study');
                    setStudySubTab('text');
                  }}
                  className={`flex min-h-[100px] flex-col justify-between rounded-2xl p-4 text-left transition hover:border-indigo-500/50 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <FileText className="h-5 w-5 text-cyan-400" />
                  <div>
                    <p className="text-sm font-bold">Study Notes</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {examNotes.length} notes & PDFs
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('study');
                    setStudySubTab('mistakes');
                  }}
                  className={`flex min-h-[100px] flex-col justify-between rounded-2xl p-4 text-left transition hover:border-indigo-500/50 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <RotateCcw className="h-5 w-5 text-rose-400" />
                  <div>
                    <p className="text-sm font-bold">Mistake Book</p>
                    <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
                      {mistakeQuestions.length} to revise
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('study');
                    setStudySubTab('bookmarks');
                  }}
                  className={`flex min-h-[100px] flex-col justify-between rounded-2xl p-4 text-left transition hover:border-indigo-500/50 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <Bookmark className="h-5 w-5 text-amber-400" />
                  <div>
                    <p className="text-sm font-bold">Bookmarks</p>
                    <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
                      {bookmarkedQuestions.length} saved Qs
                    </p>
                  </div>
                </button>
              </div>
            </section>

            {/* Section D: Concise Progress Snapshot + Recommended Test Packs */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Left 2 Columns: Recommended Test Series for Selected Exam */}
              <div className="space-y-3 lg:col-span-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold">
                    Recommended Tests for {currentExamObj?.shortCode || selectedExam}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setActiveTab('exams')}
                    className="text-xs font-bold text-indigo-400 hover:underline"
                  >
                    View All ({filteredTestPacks.length})
                  </button>
                </div>

                <div className="space-y-3">
                  {filteredTestPacks.slice(0, 3).map((pack) => (
                    <div
                      key={pack.id}
                      className={`flex flex-col justify-between gap-4 rounded-2xl p-4 sm:flex-row sm:items-center ${
                        isDark ? 'surface-card-dark' : 'surface-card-light'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                          <span className="font-semibold text-indigo-400">{pack.shiftTag}</span>
                          <span>·</span>
                          <span className="tabular-nums">{pack.questionIds.length} Qs</span>
                          <span>·</span>
                          <span className="tabular-nums">{pack.durationMinutes} Mins</span>
                          <span>·</span>
                          <span className="tabular-nums">
                            +{pack.marksPerCorrect ?? 2.0} / -
                            {pack.negativeMarking > 0 ? pack.negativeMarking : '0'}
                          </span>
                        </div>
                        <h3 className="text-sm font-bold sm:text-base">
                          {language === 'hi' ? pack.title_hi : pack.title_en}
                        </h3>
                      </div>

                      <button
                        type="button"
                        onClick={() => launchTestPack(pack)}
                        className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500"
                      >
                        {pack.isPro && !studentState.isProUnlocked ? (
                          <>
                            <Lock className="h-3.5 w-3.5" />
                            Unlock Pro
                          </>
                        ) : (
                          <>
                            Start Test
                            <ArrowRight className="h-3.5 w-3.5" />
                          </>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Column: Clean 3-Stat Progress Snapshot */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold">Your Progress</h2>
                  <button
                    type="button"
                    onClick={() => setActiveTab('profile')}
                    className="text-xs font-bold text-indigo-400 hover:underline"
                  >
                    Full Analytics
                  </button>
                </div>

                <div
                  className={`rounded-2xl p-5 space-y-4 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div
                      className={`rounded-xl border p-3 ${
                        isDark ? 'border-white/10 bg-white/[0.02]' : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <p className="text-[11px] text-slate-400">Tests Done</p>
                      <p className="mt-1 text-xl font-extrabold tabular-nums">
                        {progressSnapshot.totalTests}
                      </p>
                    </div>
                    <div
                      className={`rounded-xl border p-3 ${
                        isDark ? 'border-white/10 bg-white/[0.02]' : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <p className="text-[11px] text-slate-400">Accuracy</p>
                      <p className="mt-1 text-xl font-extrabold tabular-nums text-emerald-400">
                        {progressSnapshot.avgAccuracy}%
                      </p>
                    </div>
                    <div
                      className={`rounded-xl border p-3 ${
                        isDark ? 'border-white/10 bg-white/[0.02]' : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <p className="text-[11px] text-slate-400">Practiced</p>
                      <p className="mt-1 text-xl font-extrabold tabular-nums text-indigo-400">
                        {progressSnapshot.totalPracticed}
                      </p>
                    </div>
                  </div>

                  {mistakeQuestions.length > 0 && (
                    <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5">
                      <div>
                        <p className="text-xs font-bold text-rose-300">
                          {mistakeQuestions.length} Questions in Mistake Notebook
                        </p>
                        <p className="text-[11px] text-slate-400">
                          Clear them by answering correctly in a retest
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={launchMistakeRetest}
                        className="min-h-[36px] shrink-0 rounded-lg bg-rose-600 px-3 text-xs font-bold text-white hover:bg-rose-500"
                      >
                        Retest
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Section E: Quick Exam Discovery Grid */}
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold">Supported Competitive Exams on Zyvra</h2>
                  <p className="text-xs text-slate-400">
                    Tap any exam to switch your active syllabus, question bank, and marking scheme
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowExamSwitcherModal(true)}
                  className="text-xs font-bold text-indigo-400 hover:underline"
                >
                  Search All Exams
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {activeExams.slice(0, 8).map((ex) => {
                  const isCurrent = examStringsMatch(ex.name, selectedExam);
                  return (
                    <button
                      key={ex.id}
                      type="button"
                      onClick={() => handleSelectExam(ex.name)}
                      className={`flex min-h-[84px] flex-col justify-between rounded-2xl border p-4 text-left transition ${
                        isCurrent
                          ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500'
                          : isDark
                          ? 'border-white/10 bg-[#111827] hover:border-white/25'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-indigo-400">
                          {ex.shortCode || ex.id}
                        </span>
                        <span className="text-[11px] text-slate-400 tabular-nums">
                          +{ex.marksPerCorrect ?? 2}/-{ex.negativeMarking ?? 0.5}
                        </span>
                      </div>
                      <div>
                        <p className="truncate text-sm font-bold">{ex.name}</p>
                        <p className="truncate text-[11px] text-slate-400">
                          {ex.stateOrAuthority}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {/* ========================================================================
            TAB 2: EXAMS — TEST SERIES, FOLDERS & VERIFIED PYQ TRENDS
           ======================================================================== */}
        {activeTab === 'exams' && (
          <div className="space-y-6">
            {/* Active Exam Header & Sub-View Switcher */}
            <div
              className={`flex flex-col justify-between gap-4 rounded-2xl p-5 sm:flex-row sm:items-center ${
                isDark ? 'surface-card-dark' : 'surface-card-light'
              }`}
            >
              <div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="font-bold text-indigo-400">{selectedExam}</span>
                  <span>·</span>
                  <span>{currentExamObj?.stateOrAuthority}</span>
                </div>
                <h1 className="mt-1 text-xl font-bold">
                  Test Series & Official PYQ Trend Engine
                </h1>
              </div>

              <div
                className={`inline-flex rounded-xl p-1 ${
                  isDark ? 'bg-white/[0.05]' : 'bg-slate-100'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setExamsSubView('series')}
                  className={`min-h-[38px] rounded-lg px-4 text-xs font-bold transition ${
                    examsSubView === 'series'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Test Series ({filteredTestPacks.length})
                </button>
                <button
                  type="button"
                  onClick={() => setExamsSubView('trends')}
                  className={`min-h-[38px] rounded-lg px-4 text-xs font-bold transition ${
                    examsSubView === 'trends'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  5-Year PYQ Trends ({filteredTrends.length})
                </button>
              </div>
            </div>

             {examsSubView === 'series' ? (
               <div className="space-y-5">
                 {/* Dynamic Category & Subcategory Filter Strip (Phase 10) */}
                 {examDynamicCategories.length > 0 && (
                   <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                     <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-400">
                       <Layers className="h-3.5 w-3.5 text-indigo-400" />
                       Category:
                     </span>
                     <button
                       type="button"
                       onClick={() => setSelectedDynamicCatId('ALL')}
                       className={`min-h-[34px] shrink-0 rounded-xl px-3 text-xs font-semibold transition ${
                         selectedDynamicCatId === 'ALL'
                           ? 'bg-indigo-600 text-white'
                           : isDark
                           ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                           : 'bg-white text-slate-700 border border-slate-200'
                       }`}
                     >
                       All Categories
                     </button>
                     {examDynamicCategories.map((cat) => (
                       <button
                         key={cat.id}
                         type="button"
                         onClick={() => setSelectedDynamicCatId(cat.id)}
                         className={`min-h-[34px] shrink-0 rounded-xl px-3 text-xs font-semibold transition ${
                           selectedDynamicCatId === cat.id
                             ? 'bg-indigo-600 text-white'
                             : isDark
                             ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                             : 'bg-white text-slate-700 border border-slate-200'
                         }`}
                       >
                         {cat.parentId ? '↳ ' : ''}
                         {language === 'hi'
                           ? cat.name_hi || cat.name_en || cat.name
                           : cat.name_en || cat.name}
                       </button>
                     ))}
                   </div>
                 )}

                 {/* Folder Filter Strip */}
                 <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                   <button
                     type="button"
                     onClick={() => setSelectedFolderId('ALL')}
                     className={`min-h-[38px] shrink-0 rounded-xl px-3.5 text-xs font-semibold transition ${
                       selectedFolderId === 'ALL'
                         ? 'bg-indigo-600 text-white'
                         : isDark
                         ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                         : 'bg-white text-slate-700 border border-slate-200'
                     }`}
                   >
                     All Folders
                   </button>
                   {examFolders
                     .filter((f) => f.type === 'test')
                     .map((folder) => (
                       <button
                         key={folder.id}
                         type="button"
                         onClick={() => setSelectedFolderId(folder.id)}
                         className={`inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold transition ${
                           selectedFolderId === folder.id
                             ? 'bg-indigo-600 text-white'
                             : isDark
                             ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                             : 'bg-white text-slate-700 border border-slate-200'
                         }`}
                       >
                         <Folder className="h-3.5 w-3.5 text-indigo-400" />
                         <span>{language === 'hi' ? folder.name_hi : folder.name_en}</span>
                       </button>
                     ))}
                 </div>

                {/* Test Pack List */}
                {filteredTestPacks.length === 0 ? (
                  <div
                    className={`rounded-2xl p-8 text-center ${
                      isDark ? 'surface-card-dark' : 'surface-card-light'
                    }`}
                  >
                    <p className="text-sm font-semibold">No Test Packs in this folder yet</p>
                    <p className="mt-1 text-xs text-slate-400">
                      You can launch an instant PYQ practice set or create a Custom Test.
                    </p>
                    <button
                      type="button"
                      onClick={() => launchQuickExamPractice('pyq')}
                      className="mt-4 min-h-[42px] rounded-xl bg-indigo-600 px-5 text-xs font-bold text-white"
                    >
                      Start Instant PYQ Practice
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {filteredTestPacks.map((pack) => (
                      <div
                        key={pack.id}
                        className={`flex flex-col justify-between gap-4 rounded-2xl p-5 ${
                          isDark ? 'surface-card-dark' : 'surface-card-light'
                        }`}
                      >
                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                            <span className="font-bold text-indigo-400">{pack.shiftTag}</span>
                            <span className="tabular-nums">
                              {pack.questionIds.length} Qs · {pack.durationMinutes} Mins
                            </span>
                          </div>
                          <h3 className="mt-1.5 text-base font-bold">
                            {language === 'hi' ? pack.title_hi : pack.title_en}
                          </h3>
                          <p className="mt-1 text-xs text-slate-400">
                            Marking: +{pack.marksPerCorrect ?? 2.0} Correct ·{' '}
                            {pack.negativeMarking > 0
                              ? `-${pack.negativeMarking} Negative`
                              : 'No Negative Marking (0)'}
                          </p>
                        </div>

                        <div className="flex items-center justify-between border-t pt-3.5 border-white/10">
                          <span className="text-xs text-slate-400">{pack.subject}</span>
                          <button
                            type="button"
                            onClick={() => launchTestPack(pack)}
                            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500"
                          >
                            {pack.isPro && !studentState.isProUnlocked ? (
                              <>
                                <Lock className="h-3.5 w-3.5" />
                                Pro Pass
                              </>
                            ) : (
                              <>
                                View Instructions & Start
                                <ArrowRight className="h-3.5 w-3.5" />
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* Verified 5-Year PYQ Trend Analysis View */
              <div className="space-y-4">
                <div
                  className={`flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={trendSearch}
                      onChange={(e) => setTrendSearch(e.target.value)}
                      placeholder="Search high-weightage topic..."
                      className={`min-h-[42px] w-full rounded-xl border pl-9 pr-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-900'
                      }`}
                    />
                  </div>
                  <select
                    value={trendSubjectFilter}
                    onChange={(e) => setTrendSubjectFilter(e.target.value)}
                    className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                      isDark
                        ? 'border-white/10 bg-[#0F172A] text-white'
                        : 'border-slate-200 bg-white text-slate-900'
                    }`}
                  >
                    <option value="ALL">All Subjects</option>
                    {examSubjectsList.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                {filteredTrends.length === 0 ? (
                  <div
                    className={`rounded-2xl p-8 text-center ${
                      isDark ? 'surface-card-dark' : 'surface-card-light'
                    }`}
                  >
                    <TrendingUp className="mx-auto h-8 w-8 text-slate-400" />
                    <h3 className="mt-2 text-sm font-bold">
                      Verified Trend Data Not Yet Added for {selectedExam}
                    </h3>
                    <p className="mt-1 text-xs text-slate-400">
                      Zyvra only displays verified shift-wise PYQ frequencies. You can still practice all {examQuestions.length} questions for {selectedExam}.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {filteredTrends.map((row) => (
                      <div
                        key={row.id}
                        className={`rounded-2xl p-5 ${
                          isDark ? 'surface-card-dark' : 'surface-card-light'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-indigo-400">
                              {row.subject} · {row.priority}
                            </p>
                            <h3 className="mt-1 text-base font-bold">
                              {language === 'hi' ? row.topic_hi : row.topic_en}
                            </h3>
                          </div>
                          <span className="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-400 tabular-nums">
                            {row.avgQuestionsPerShift}
                          </span>
                        </div>

                        {/* Year-by-Year Breakdown */}
                        <div className="mt-4 grid grid-cols-5 gap-2 text-center">
                          {Object.entries(row.yearBreakdown || {}).map(([yr, cnt]) => (
                            <div
                              key={yr}
                              className={`rounded-lg border p-2 ${
                                isDark
                                  ? 'border-white/10 bg-white/[0.02]'
                                  : 'border-slate-200 bg-slate-50'
                              }`}
                            >
                              <p className="text-[10px] text-slate-400 tabular-nums">{yr}</p>
                              <p className="text-xs font-bold tabular-nums">{cnt} Qs</p>
                            </div>
                          ))}
                        </div>

                        <div className="mt-4 flex items-center justify-between border-t pt-3 border-white/10 text-xs">
                          <span className="text-slate-400">
                            Source: {row.source || 'Official PYQ Papers'}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setCustomSubject(row.subject);
                              setCustomTopic('ALL');
                              setActiveTab('practice');
                              setBuilderStep(4);
                            }}
                            className="font-bold text-indigo-400 hover:underline"
                          >
                            Practice Topic →
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================
            TAB 3: PRACTICE — 4-STEP GUIDED CUSTOM TEST BUILDER
           ======================================================================== */}
        {activeTab === 'practice' && (
          <div className="mx-auto max-w-3xl space-y-6">
            {/* Builder Header + Live Matching Pool Counter */}
            <div
              className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl p-5 ${
                isDark ? 'surface-card-dark' : 'surface-card-light'
              }`}
            >
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-indigo-400">
                  Custom Test Builder · {selectedExam}
                </p>
                <h1 className="mt-0.5 text-xl font-bold">Build Your Own Practice Test</h1>
              </div>
              <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-2 text-right">
                <p className="text-[11px] text-indigo-300">Matching Questions</p>
                <p className="text-lg font-extrabold tabular-nums text-indigo-400">
                  {customBuilderPool.length} Available
                </p>
              </div>
            </div>

            {/* 4-Step Progress Bar */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  { step: 1, title: '1. Content' },
                  { step: 2, title: '2. Source Pool' },
                  { step: 3, title: '3. Settings' },
                  { step: 4, title: '4. Review' },
                ] as const
              ).map((s) => (
                <button
                  key={s.step}
                  type="button"
                  onClick={() => setBuilderStep(s.step)}
                  className={`min-h-[42px] rounded-xl border px-2 py-2 text-xs font-bold transition ${
                    builderStep === s.step
                      ? 'border-indigo-500 bg-indigo-600 text-white'
                      : builderStep > s.step
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : isDark
                      ? 'border-white/10 bg-white/[0.03] text-slate-400'
                      : 'border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  {s.title}
                </button>
              ))}
            </div>

            {/* Step Body Card */}
            <div
              className={`rounded-2xl p-5 sm:p-6 ${
                isDark ? 'surface-card-dark' : 'surface-card-light'
              }`}
            >
              {builderStep === 1 && (
                <div className="space-y-4">
                  <h2 className="text-base font-bold">Step 1: Select Exam, Subject & Topic</h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400">
                        Target Competitive Exam
                      </label>
                      <select
                        value={selectedExam}
                        onChange={(e) => handleSelectExam(e.target.value)}
                        className={`mt-1.5 min-h-[44px] w-full rounded-xl border px-3 text-xs font-semibold outline-none ${
                          isDark
                            ? 'border-white/10 bg-[#0F172A] text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-900'
                        }`}
                      >
                        {activeExams.map((ex) => (
                          <option key={ex.id} value={ex.name}>
                            {ex.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-400">
                        Subject
                      </label>
                      <select
                        value={customSubject}
                        onChange={(e) => {
                          setCustomSubject(e.target.value);
                          setCustomTopic('ALL');
                        }}
                        className={`mt-1.5 min-h-[44px] w-full rounded-xl border px-3 text-xs font-semibold outline-none ${
                          isDark
                            ? 'border-white/10 bg-[#0F172A] text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-900'
                        }`}
                      >
                        <option value="ALL">All Subjects (Full Mixed Mock)</option>
                        {examSubjectsList.map((sub) => (
                          <option key={sub} value={sub}>
                            {sub}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-400">
                        Chapter / Topic
                      </label>
                      <select
                        value={customTopic}
                        onChange={(e) => setCustomTopic(e.target.value)}
                        className={`mt-1.5 min-h-[44px] w-full rounded-xl border px-3 text-xs font-semibold outline-none ${
                          isDark
                            ? 'border-white/10 bg-[#0F172A] text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-900'
                        }`}
                      >
                        <option value="ALL">All Topics</option>
                        {(customSubject !== 'ALL' ? db.subjects[customSubject] || [] : []).map(
                          (t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          )
                        )}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-400">
                        Custom Folder Filter
                      </label>
                      <select
                        value={customFolderId}
                        onChange={(e) => setCustomFolderId(e.target.value)}
                        className={`mt-1.5 min-h-[44px] w-full rounded-xl border px-3 text-xs font-semibold outline-none ${
                          isDark
                            ? 'border-white/10 bg-[#0F172A] text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-900'
                        }`}
                      >
                        <option value="ALL">All Folders</option>
                        {examFolders.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name_en}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end pt-4">
                    <button
                      type="button"
                      onClick={() => setBuilderStep(2)}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-indigo-600 px-5 text-xs font-bold text-white hover:bg-indigo-500"
                    >
                      Next: Question Pool
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {builderStep === 2 && (
                <div className="space-y-4">
                  <h2 className="text-base font-bold">Step 2: Choose Question Source Pool</h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {(
                      [
                        {
                          id: 'ALL',
                          title: 'All Exam Questions',
                          desc: 'Combine verified PYQs and high-probability model questions',
                        },
                        {
                          id: 'verified_pyq',
                          title: 'Official Verified PYQs Only',
                          desc: 'Strictly authentic previous year shift questions',
                        },
                        {
                          id: 'ai_guess',
                          title: 'Expected / Model Practice',
                          desc: 'Pattern-matched new questions for upcoming shifts',
                        },
                        {
                          id: 'bookmarks',
                          title: `My Bookmarks (${bookmarkedQuestions.length})`,
                          desc: 'Practice only questions you have bookmarked',
                        },
                        {
                          id: 'mistakes',
                          title: `Mistake Notebook (${mistakeQuestions.length})`,
                          desc: 'Re-attempt questions you previously got wrong or skipped',
                        },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setCustomSourcePool(opt.id)}
                        className={`flex min-h-[72px] flex-col justify-between rounded-xl border p-4 text-left transition ${
                          customSourcePool === opt.id
                            ? 'border-indigo-500 bg-indigo-500/15'
                            : isDark
                            ? 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
                            : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                        }`}
                      >
                        <p className="text-sm font-bold">{opt.title}</p>
                        <p className="mt-1 text-xs text-slate-400">{opt.desc}</p>
                      </button>
                    ))}
                  </div>

                  <div className="flex justify-between pt-4">
                    <button
                      type="button"
                      onClick={() => setBuilderStep(1)}
                      className="min-h-[44px] rounded-xl border border-white/15 px-4 text-xs font-semibold"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => setBuilderStep(3)}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-indigo-600 px-5 text-xs font-bold text-white"
                    >
                      Next: Test Settings
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {builderStep === 3 && (
                <div className="space-y-4">
                  <h2 className="text-base font-bold">Step 3: Configure Timer, Mode & Marking</h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400">
                        Number of Questions
                      </label>
                      <div className="mt-1.5 grid grid-cols-5 gap-1.5">
                        {[5, 10, 20, 25, 50].map((cnt) => (
                          <button
                            key={cnt}
                            type="button"
                            onClick={() => setCustomQuestionCount(cnt)}
                            className={`min-h-[40px] rounded-xl border text-xs font-bold tabular-nums ${
                              customQuestionCount === cnt
                                ? 'border-indigo-500 bg-indigo-600 text-white'
                                : isDark
                                ? 'border-white/10 bg-white/5'
                                : 'border-slate-200 bg-slate-50'
                            }`}
                          >
                            {cnt}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-400">
                        Difficulty Level
                      </label>
                      <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                        {(['ALL', 'Easy', 'Moderate', 'Hard'] as const).map((diff) => (
                          <button
                            key={diff}
                            type="button"
                            onClick={() => setCustomDifficulty(diff)}
                            className={`min-h-[40px] rounded-xl border text-xs font-bold ${
                              customDifficulty === diff
                                ? 'border-indigo-500 bg-indigo-600 text-white'
                                : isDark
                                ? 'border-white/10 bg-white/5'
                                : 'border-slate-200 bg-slate-50'
                            }`}
                          >
                            {diff}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-400">
                        Attempt Mode
                      </label>
                      <select
                        value={customMode}
                        onChange={(e) =>
                          setCustomMode(e.target.value as 'practice' | 'exam_hall')
                        }
                        className={`mt-1.5 min-h-[44px] w-full rounded-xl border px-3 text-xs font-semibold outline-none ${
                          isDark
                            ? 'border-white/10 bg-[#0F172A] text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-900'
                        }`}
                      >
                        <option value="exam_hall">Official Exam Hall Mode (Submit at End)</option>
                        <option value="practice">Instant Learning Mode (Immediate Solution)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-400">
                        Timer Mode
                      </label>
                      <select
                        value={customTimerType}
                        onChange={(e) =>
                          setCustomTimerType(e.target.value as 'overall' | 'sprint' | 'none')
                        }
                        className={`mt-1.5 min-h-[44px] w-full rounded-xl border px-3 text-xs font-semibold outline-none ${
                          isDark
                            ? 'border-white/10 bg-[#0F172A] text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-900'
                        }`}
                      >
                        <option value="overall">Overall Exam Countdown ({customOverallMinutes}m)</option>
                        <option value="sprint">Per-Question Sprint ({customSprintSeconds}s/Q)</option>
                        <option value="none">Untimed Relaxed Practice</option>
                      </select>
                    </div>

                    {customTimerType === 'overall' && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-400">
                          Duration (Minutes)
                        </label>
                        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                          {[10, 15, 30, 60].map((mins) => (
                            <button
                              key={mins}
                              type="button"
                              onClick={() => setCustomOverallMinutes(mins)}
                              className={`min-h-[40px] rounded-xl border text-xs font-bold tabular-nums ${
                                customOverallMinutes === mins
                                  ? 'border-indigo-500 bg-indigo-600 text-white'
                                  : isDark
                                  ? 'border-white/10 bg-white/5'
                                  : 'border-slate-200 bg-slate-50'
                              }`}
                            >
                              {mins}m
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {customTimerType === 'sprint' && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-400">
                          Sprint Time per Question (Seconds)
                        </label>
                        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                          {[20, 30, 45, 60].map((secs) => (
                            <button
                              key={secs}
                              type="button"
                              onClick={() => setCustomSprintSeconds(secs)}
                              className={`min-h-[40px] rounded-xl border text-xs font-bold tabular-nums ${
                                customSprintSeconds === secs
                                  ? 'border-indigo-500 bg-indigo-600 text-white'
                                  : isDark
                                  ? 'border-white/10 bg-white/5'
                                  : 'border-slate-200 bg-slate-50'
                              }`}
                            >
                              {secs}s
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-400">
                        Marking Scheme Rule
                      </label>
                      <select
                        value={customMarkingPreset}
                        onChange={(e) =>
                          setCustomMarkingPreset(
                            e.target.value as
                              | 'exam_default'
                              | 'ssc_standard'
                              | 'bpsc_no_neg'
                              | 'bpsc_one_third'
                          )
                        }
                        className={`mt-1.5 min-h-[44px] w-full rounded-xl border px-3 text-xs font-semibold outline-none ${
                          isDark
                            ? 'border-white/10 bg-[#0F172A] text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-900'
                        }`}
                      >
                        <option value="exam_default">
                          {selectedExam} Official (+{currentExamObj?.marksPerCorrect ?? 2}/-
                          {currentExamObj?.negativeMarking ?? 0.5})
                        </option>
                        <option value="ssc_standard">SSC Standard (+2.0 / -0.50)</option>
                        <option value="bpsc_no_neg">BPSC TRE (+1.0 / No Negative 0.00)</option>
                        <option value="bpsc_one_third">1/3rd Negative (+1.0 / -0.33)</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-between pt-4">
                    <button
                      type="button"
                      onClick={() => setBuilderStep(2)}
                      className="min-h-[44px] rounded-xl border border-white/15 px-4 text-xs font-semibold"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => setBuilderStep(4)}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-indigo-600 px-5 text-xs font-bold text-white"
                    >
                      Next: Review & Launch
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {builderStep === 4 && (
                <div className="space-y-5">
                  <h2 className="text-base font-bold">Step 4: Review Custom Test Configuration</h2>
                  <div
                    className={`grid grid-cols-2 gap-3 rounded-xl border p-4 sm:grid-cols-3 ${
                      isDark ? 'border-white/10 bg-white/[0.02]' : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <div>
                      <p className="text-xs text-slate-400">Target Exam</p>
                      <p className="mt-0.5 text-sm font-bold">{selectedExam}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Subject</p>
                      <p className="mt-0.5 text-sm font-bold">
                        {customSubject === 'ALL' ? 'All Subjects' : customSubject}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Question Pool</p>
                      <p className="mt-0.5 text-sm font-bold uppercase">{customSourcePool}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Questions to Launch</p>
                      <p className="mt-0.5 text-sm font-bold tabular-nums text-emerald-400">
                        {Math.min(customQuestionCount, customBuilderPool.length)} Questions
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Difficulty</p>
                      <p className="mt-0.5 text-sm font-bold">{customDifficulty}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Timer</p>
                      <p className="mt-0.5 text-sm font-bold capitalize">{customTimerType}</p>
                    </div>
                  </div>

                  {customBuilderPool.length === 0 ? (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-300">
                      No questions match this exact filter combination. Try switching Subject or Question Pool to "All".
                    </div>
                  ) : null}

                  <div className="flex flex-wrap justify-between gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setBuilderStep(3)}
                      className="min-h-[46px] rounded-xl border border-white/15 px-5 text-xs font-semibold"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      disabled={customBuilderPool.length === 0}
                      onClick={launchCustomBuiltTest}
                      className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-indigo-600 px-6 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500 disabled:opacity-40"
                    >
                      <Play className="h-4 w-4 fill-current" />
                      Launch Custom Test ({Math.min(customQuestionCount, customBuilderPool.length)}{' '}
                      Qs)
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================
            TAB 4: STUDY HUB — NOTES, PDFS, FLASHCARDS, BOOKMARKS & MISTAKES
           ======================================================================== */}
        {activeTab === 'study' && (
          <div className="space-y-6">
            {/* Sub-navigation bar */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
              {(
                [
                  { id: 'text', label: 'Revision Notes' },
                  { id: 'pdf', label: 'PDF Sheets' },
                  { id: 'flashcards', label: `Flashcards (${db.flashcards.length})` },
                  { id: 'bookmarks', label: `Bookmarks (${bookmarkedQuestions.length})` },
                  { id: 'mistakes', label: `Mistake Notebook (${mistakeQuestions.length})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStudySubTab(tab.id)}
                  className={`min-h-[42px] shrink-0 rounded-xl px-4 py-2 text-xs font-bold transition ${
                    studySubTab === tab.id
                      ? 'bg-indigo-600 text-white'
                      : isDark
                      ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                      : 'bg-white text-slate-700 border border-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Text Notes & PDF Sheets View */}
            {(studySubTab === 'text' || studySubTab === 'pdf') && (
              <div className="space-y-4">
                <div
                  className={`flex flex-col gap-3 rounded-2xl p-4 sm:flex-row ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={studySearch}
                      onChange={(e) => setStudySearch(e.target.value)}
                      placeholder="Search study notes or formula sheets..."
                      className={`min-h-[42px] w-full rounded-xl border pl-9 pr-3 text-xs outline-none ${
                        isDark
                          ? 'border-white/10 bg-white/5 text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-900'
                      }`}
                    />
                  </div>
                  <select
                    value={studySubjectFilter}
                    onChange={(e) => setStudySubjectFilter(e.target.value)}
                    className={`min-h-[42px] rounded-xl border px-3 text-xs outline-none ${
                      isDark
                        ? 'border-white/10 bg-[#0F172A] text-white'
                        : 'border-slate-200 bg-white text-slate-900'
                    }`}
                  >
                    <option value="ALL">All Subjects</option>
                    {examSubjectsList.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                {filteredStudyNotes.length === 0 ? (
                  <div
                    className={`rounded-2xl p-8 text-center ${
                      isDark ? 'surface-card-dark' : 'surface-card-light'
                    }`}
                  >
                    <p className="text-sm font-semibold">No matching study documents found</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Try clearing your subject filter or switching between Revision Notes and PDF Sheets.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {filteredStudyNotes.map((note) => (
                      <div
                        key={note.id}
                        className={`flex flex-col justify-between gap-4 rounded-2xl p-5 ${
                          isDark ? 'surface-card-dark' : 'surface-card-light'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                            <span className="font-semibold text-indigo-400">
                              {note.subject} · {note.topic}
                            </span>
                            <span>{note.type.toUpperCase()}</span>
                          </div>
                          <h3 className="mt-1.5 text-base font-bold">
                            {language === 'hi' ? note.title_hi : note.title_en}
                          </h3>
                          <p className="mt-1 line-clamp-2 text-xs text-slate-400">
                            {language === 'hi' ? note.content_hi : note.content_en}
                          </p>
                        </div>

                        <div className="flex items-center justify-between border-t pt-3.5 border-white/10">
                          <span className="text-[11px] text-slate-400">
                            {note.allowDownload ? 'Downloadable' : 'In-App Reader'}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (note.isPro && !studentState.isProUnlocked) {
                                setShowProModal(true);
                                return;
                              }
                              setActiveNoteReader(note);
                            }}
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-indigo-500"
                          >
                            {note.isPro && !studentState.isProUnlocked ? (
                              <>
                                <Lock className="h-3.5 w-3.5" />
                                Unlock Pro
                              </>
                            ) : (
                              <>Read Now</>
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Flashcards View */}
            {studySubTab === 'flashcards' && (
              <div className="mx-auto max-w-xl space-y-4">
                {db.flashcards.length > 0 ? (() => {
                  const safeIdx = flashcardIndex % db.flashcards.length;
                  const activeCard = db.flashcards[safeIdx];
                  const isMastered = Boolean(
                    activeCard && (studentState.masteredFlashcardIds || []).includes(activeCard.id)
                  );
                  return (
                    <div
                      className={`rounded-2xl p-6 ${
                        isDark ? 'surface-card-dark' : 'surface-card-light'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                        <span className="font-bold text-indigo-400">
                          {activeCard?.subject} · {activeCard?.topic}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (!activeCard) return;
                              const currentList = studentState.masteredFlashcardIds || [];
                              const nextList = isMastered
                                ? currentList.filter((id) => id !== activeCard.id)
                                : [...currentList, activeCard.id];
                              setStudentState((prev) => ({
                                ...prev,
                                masteredFlashcardIds: nextList,
                              }));
                            }}
                            className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${
                              isMastered
                                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
                                : isDark
                                ? 'border-white/10 bg-white/5 text-slate-300'
                                : 'border-slate-200 bg-slate-100 text-slate-700'
                            }`}
                          >
                            {isMastered ? 'Mastered ✓' : 'Mark Mastered'}
                          </button>
                          <span className="tabular-nums">
                            Card {safeIdx + 1} of {db.flashcards.length}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setFlashcardFlipped((v) => !v)}
                        className={`mt-4 flex min-h-[200px] w-full flex-col items-center justify-center rounded-2xl border p-6 text-center transition ${
                          isDark
                            ? 'border-white/10 bg-white/[0.03] hover:bg-white/[0.05]'
                            : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                        }`}
                      >
                        <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-400">
                          {flashcardFlipped
                            ? 'Answer & 15s Exam Trick'
                            : 'Question Prompt (Tap to Flip)'}
                        </span>
                        <p className="mt-3 text-base font-bold sm:text-lg">
                          {flashcardFlipped
                            ? language === 'hi'
                              ? activeCard?.back_hi
                              : activeCard?.back_en
                            : language === 'hi'
                            ? activeCard?.front_hi
                            : activeCard?.front_en}
                        </p>
                        {flashcardFlipped && (
                          <p className="mt-3 text-xs text-emerald-400">
                            Trick:{' '}
                            {language === 'hi'
                              ? activeCard?.trick_hi
                              : activeCard?.trick_en}
                          </p>
                        )}
                      </button>

                      <div className="mt-5 flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setFlashcardFlipped(false);
                            setFlashcardIndex((i) =>
                              i === 0 ? db.flashcards.length - 1 : i - 1
                            );
                          }}
                          className={`min-h-[42px] flex-1 rounded-xl border text-xs font-semibold ${
                            isDark ? 'border-white/15' : 'border-slate-300'
                          }`}
                        >
                          Previous Card
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFlashcardFlipped(false);
                            setFlashcardIndex((i) => (i + 1) % db.flashcards.length);
                          }}
                          className="min-h-[42px] flex-1 rounded-xl bg-indigo-600 text-xs font-bold text-white"
                        >
                          Next Card
                        </button>
                      </div>
                    </div>
                  );
                })() : (
                  <div
                    className={`rounded-2xl p-8 text-center ${
                      isDark ? 'surface-card-dark' : 'surface-card-light'
                    }`}
                  >
                    <p className="text-sm font-semibold">No flashcards available yet</p>
                  </div>
                )}
              </div>
            )}

            {/* Bookmarks View */}
            {studySubTab === 'bookmarks' && (
              <div className="space-y-3">
                {bookmarkedQuestions.length === 0 ? (
                  <div
                    className={`rounded-2xl p-8 text-center ${
                      isDark ? 'surface-card-dark' : 'surface-card-light'
                    }`}
                  >
                    <Bookmark className="mx-auto h-8 w-8 text-slate-400" />
                    <p className="mt-2 text-sm font-bold">No Bookmarked Questions Yet</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Tap the bookmark icon during any test to save tricky questions here.
                    </p>
                  </div>
                ) : (
                  bookmarkedQuestions.map((q) => (
                    <div
                      key={q.id}
                      className={`rounded-2xl p-5 ${
                        isDark ? 'surface-card-dark' : 'surface-card-light'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>
                          <strong className="text-indigo-400">{q.exam}</strong> · {q.subject} ·{' '}
                          {q.pyqTag}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleToggleBookmarkQuestion(q.id)}
                          className="text-rose-400 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                      <p className="mt-2 text-sm font-semibold">{q.question_en}</p>
                      <p className="mt-1 text-xs text-slate-400">{q.question_hi}</p>
                      <p className="mt-3 text-xs text-emerald-400">
                        <strong>15s Trick:</strong> {q.trick_en}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Mistake Notebook View */}
            {studySubTab === 'mistakes' && (
              <div className="space-y-4">
                {mistakeQuestions.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
                    <div>
                      <h3 className="text-sm font-bold text-rose-300">
                        {mistakeQuestions.length} Questions in Your Mistake Notebook
                      </h3>
                      <p className="text-xs text-slate-400">
                        Answering a question correctly in a Retest automatically clears it from your Mistake Notebook.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={launchMistakeRetest}
                      className="min-h-[42px] rounded-xl bg-rose-600 px-5 text-xs font-bold text-white hover:bg-rose-500"
                    >
                      Start Mistake Retest
                    </button>
                  </div>
                )}

                {mistakeQuestions.length === 0 ? (
                  <div
                    className={`rounded-2xl p-8 text-center ${
                      isDark ? 'surface-card-dark' : 'surface-card-light'
                    }`}
                  >
                    <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
                    <p className="mt-2 text-sm font-bold">Zero Pending Mistakes!</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Any question you miss or skip in a test will automatically be collected here for targeted revision.
                    </p>
                  </div>
                ) : (
                  mistakeQuestions.map((q) => (
                    <div
                      key={q.id}
                      className={`rounded-2xl p-5 ${
                        isDark ? 'surface-card-dark' : 'surface-card-light'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>
                          <strong className="text-rose-400">
                            {studentState.mistakes[q.id]?.lastReason.toUpperCase()}
                          </strong>{' '}
                          · {q.exam} · {q.subject}
                        </span>
                        <span className="tabular-nums">
                          Missed {studentState.mistakes[q.id]?.errorCount || 1}x
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-semibold">{q.question_en}</p>
                      <p className="mt-2 text-xs text-emerald-400">
                        <strong>15s Trick:</strong> {q.trick_en}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================
            TAB 5: PROFILE — ANALYTICS, TEST HISTORY, PWA INSTALL & ADMIN ACCESS
           ======================================================================== */}
        {activeTab === 'profile' && (
          <div className="space-y-6">
            {/* Identity & Device Lock Card */}
            <section
              className={`rounded-2xl p-5 sm:p-6 ${
                isDark ? 'surface-card-dark' : 'surface-card-light'
              }`}
            >
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div className="flex items-start gap-3.5">
                  <div
                    onClick={handleVersionTap}
                    role="presentation"
                    className="shrink-0 select-none pt-0.5 cursor-default"
                  >
                    <ZyvraLogo size="sm" showTagline={false} />
                  </div>
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">
                      Zyvra Student Account & Device ID
                    </span>
                    <h1 className="mt-1 text-xl font-bold">{studentState.studentName}</h1>
                    <p className="text-xs text-slate-400 tabular-nums">
                      Registered Mobile: +91 {studentState.mobileNumber}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2">
                    <span className="block text-[10px] uppercase tracking-wider text-slate-400">
                      Device Lock ID
                    </span>
                    <span className="font-mono text-xs font-bold tabular-nums">
                      {studentState.deviceId}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(studentState.deviceId);
                      setCopiedDeviceToast(true);
                      setTimeout(() => setCopiedDeviceToast(false), 2000);
                    }}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 text-xs font-bold text-white"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copiedDeviceToast ? 'Copied' : 'Copy ID'}
                  </button>
                </div>
              </div>

              {/* PWA Install Row for Mobile / Desktop / iOS */}
              {!isInstalled && (isInstallable || isIOS) && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3.5">
                  <div>
                    <p className="text-xs font-bold text-cyan-300">
                      Install Zyvra on Your Home Screen
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Launch Zyvra like a native app with instant offline access to PYQs and study notes.
                    </p>
                  </div>
                  {isInstallable ? (
                    <button
                      type="button"
                      onClick={install}
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-cyan-600 px-4 text-xs font-bold text-white hover:bg-cyan-500"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Install App
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowIOSInstallGuide(true)}
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-cyan-600 px-4 text-xs font-bold text-white hover:bg-cyan-500"
                    >
                      Install on iOS
                    </button>
                  )}
                </div>
              )}
              {/* Profile Sub-Navigation Pills: Overview / Refer & Earn / Support & Contact */}
              <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4 border-white/10">
                <button
                  type="button"
                  onClick={() => setProfileSection('overview')}
                  className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-4 text-xs font-bold transition ${
                    profileSection === 'overview'
                      ? 'bg-indigo-600 text-white'
                      : isDark
                      ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  <Trophy className="h-3.5 w-3.5" />
                  Test History & Analytics
                </button>
                <button
                  type="button"
                  onClick={() => setProfileSection('referrals')}
                  className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-4 text-xs font-bold transition ${
                    profileSection === 'referrals'
                      ? 'bg-indigo-600 text-white'
                      : isDark
                      ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  <Gift className="h-3.5 w-3.5 text-amber-400" />
                  Refer & Earn Rewards
                </button>
                <button
                  type="button"
                  onClick={() => setProfileSection('support')}
                  className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-4 text-xs font-bold transition ${
                    profileSection === 'support'
                      ? 'bg-indigo-600 text-white'
                      : isDark
                      ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  <Headphones className="h-3.5 w-3.5 text-cyan-400" />
                  Support, Contact & Feedback
                </button>
              </div>
            </section>

            {/* SUB-SECTION 1: REFER & EARN HUB (Phase 9) */}
            {profileSection === 'referrals' && (
              <section
                className={`rounded-2xl p-5 sm:p-6 space-y-5 ${
                  isDark ? 'surface-card-dark' : 'surface-card-light'
                }`}
              >
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                      Zyvra Student Ambassador Program
                    </span>
                    <h2 className="mt-1 text-lg font-extrabold">
                      Refer Friends & Earn{' '}
                      {db.referralPolicy?.commissionType === 'percent'
                        ? `${db.referralPolicy.commissionValue}% Commission`
                        : `₹${db.referralPolicy?.commissionValue || 30} Per Qualifying Pro Unlock`}
                    </h2>
                    <p className="mt-1 text-xs text-slate-400">
                      Share your unique referral code with friends. When they unlock Zyvra Pro, your commission is credited to your ledger.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2">
                      <span className="block text-[10px] uppercase tracking-wider text-amber-300">
                        Your Referral Code
                      </span>
                      <span className="font-mono text-sm font-extrabold text-amber-400">
                        {studentState.referralCode}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const shareUrl = `${window.location.origin}${window.location.pathname}?ref=${studentState.referralCode}`;
                        navigator.clipboard?.writeText(
                          `Prepare for SSC, BPSC, Railway & UPSC on Zyvra! Use my referral code ${studentState.referralCode} or link: ${shareUrl}`
                        );
                        setCopiedReferralToast(true);
                        setTimeout(() => setCopiedReferralToast(false), 2500);
                      }}
                      className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-amber-500 px-4 text-xs font-extrabold text-slate-950 hover:bg-amber-400"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                      {copiedReferralToast ? 'Copied Link!' : 'Copy Share Link'}
                    </button>
                  </div>
                </div>

                {/* Referral Earnings Stats */}
                {(() => {
                  const myCommissions = (db.referralCommissions || []).filter(
                    (c) =>
                      c.referralCode === studentState.referralCode ||
                      c.referrerDeviceId === studentState.deviceId
                  );
                  const totalEarned = myCommissions
                    .filter((c) => ['approved', 'payable', 'paid'].includes(c.status))
                    .reduce((acc, c) => acc + c.commissionAmount, 0);
                  const pendingAmt = myCommissions
                    .filter((c) => c.status === 'pending')
                    .reduce((acc, c) => acc + c.commissionAmount, 0);
                  const paidAmt = myCommissions
                    .filter((c) => c.status === 'paid')
                    .reduce((acc, c) => acc + c.commissionAmount, 0);

                  return (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
                          <p className="text-[11px] text-slate-400">Total Referrals</p>
                          <p className="mt-1 text-xl font-extrabold tabular-nums">
                            {myCommissions.length}
                          </p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
                          <p className="text-[11px] text-slate-400">Pending Verification</p>
                          <p className="mt-1 text-xl font-extrabold tabular-nums text-amber-400">
                            ₹{pendingAmt}
                          </p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
                          <p className="text-[11px] text-slate-400">Approved & Payable</p>
                          <p className="mt-1 text-xl font-extrabold tabular-nums text-emerald-400">
                            ₹{totalEarned - paidAmt}
                          </p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
                          <p className="text-[11px] text-slate-400">Paid Out</p>
                          <p className="mt-1 text-xl font-extrabold tabular-nums text-indigo-400">
                            ₹{paidAmt}
                          </p>
                        </div>
                      </div>

                      {/* Apply a Friend's Referral Code + Request Payout */}
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="rounded-xl border border-white/10 p-4 space-y-2.5">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-400">
                            Have a Friend&apos;s Referral Code?
                          </h3>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={friendReferralInput}
                              onChange={(e) => setFriendReferralInput(e.target.value.toUpperCase())}
                              placeholder="Enter code e.g. ZYVREF-AB12"
                              disabled={Boolean(studentState.referredByCode)}
                              className={`min-h-[40px] flex-1 rounded-xl border px-3 text-xs font-mono uppercase outline-none ${
                                isDark
                                  ? 'border-white/10 bg-white/5 text-white'
                                  : 'border-slate-200 bg-slate-50 text-slate-900'
                              }`}
                            />
                            <button
                              type="button"
                              onClick={handleApplyReferralCode}
                              disabled={Boolean(studentState.referredByCode)}
                              className="min-h-[40px] rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white disabled:opacity-50"
                            >
                              {studentState.referredByCode ? 'Linked' : 'Apply Code'}
                            </button>
                          </div>
                          {referralApplyMsg && (
                            <p className="text-[11px] font-semibold text-emerald-400">
                              {referralApplyMsg}
                            </p>
                          )}
                        </div>

                        <div className="rounded-xl border border-white/10 p-4 space-y-2.5">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                            Request UPI Commission Payout (Min ₹
                            {db.referralPolicy?.minPayoutThreshold || 100})
                          </h3>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={payoutUpiInput}
                              onChange={(e) => setPayoutUpiInput(e.target.value)}
                              placeholder="yourname@upi"
                              className={`min-h-[40px] flex-1 rounded-xl border px-3 text-xs outline-none ${
                                isDark
                                  ? 'border-white/10 bg-white/5 text-white'
                                  : 'border-slate-200 bg-slate-50 text-slate-900'
                              }`}
                            />
                            <button
                              type="button"
                              onClick={handleRequestReferralPayout}
                              className="min-h-[40px] rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white hover:bg-emerald-500"
                            >
                              Request Payout
                            </button>
                          </div>
                          {payoutMsg && (
                            <p className="text-[11px] font-semibold text-amber-400">{payoutMsg}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </section>
            )}

            {/* SUB-SECTION 2: SUPPORT, CONTACT US & FEEDBACK DESK (Phase 4 & 5) */}
            {profileSection === 'support' && (
              <div className="space-y-6">
                {/* Official Contact Channels */}
                <section
                  className={`rounded-2xl p-5 sm:p-6 space-y-4 ${
                    isDark ? 'surface-card-dark' : 'surface-card-light'
                  }`}
                >
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">
                      Customer Care & Student Helpdesk
                    </span>
                    <h2 className="mt-1 text-lg font-extrabold">Contact Us & Raise a Support Ticket</h2>
                    <p className="text-xs text-slate-400">
                      Working Hours: {db.supportConfig?.workingHours || 'Mon–Sat, 9:00 AM – 7:00 PM IST'}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <a
                      href={`mailto:${db.supportConfig?.supportEmail || 'support@zyvra.in'}`}
                      className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3.5 hover:border-indigo-500/40"
                    >
                      <MessageSquare className="h-5 w-5 text-indigo-400" />
                      <div>
                        <p className="text-[11px] text-slate-400">Email Support</p>
                        <p className="text-xs font-bold">
                          {db.supportConfig?.supportEmail || 'support@zyvra.in'}
                        </p>
                      </div>
                    </a>
                    <a
                      href={`tel:${db.supportConfig?.helplineNumber || '+919800000000'}`}
                      className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3.5 hover:border-emerald-500/40"
                    >
                      <Phone className="h-5 w-5 text-emerald-400" />
                      <div>
                        <p className="text-[11px] text-slate-400">Student Helpline</p>
                        <p className="text-xs font-bold">
                          {db.supportConfig?.helplineNumber || '+91 98000 00000'}
                        </p>
                      </div>
                    </a>
                    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
                      <Headphones className="h-5 w-5 text-cyan-400" />
                      <div>
                        <p className="text-[11px] text-slate-400">WhatsApp Desk</p>
                        <p className="text-xs font-bold">
                          {db.supportConfig?.whatsappSupport || '+91 98000 00000'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Create Support Ticket Form */}
                  <div className="grid grid-cols-1 gap-5 pt-2 lg:grid-cols-2">
                    <div className="space-y-3 rounded-xl border border-white/10 p-4">
                      <h3 className="text-sm font-bold">Raise a Support Ticket</h3>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={ticketCategory}
                          onChange={(e) =>
                            setTicketCategory(e.target.value as SupportTicket['category'])
                          }
                          className={`min-h-[40px] rounded-xl border px-3 text-xs outline-none ${
                            isDark
                              ? 'border-white/10 bg-[#111827] text-white'
                              : 'border-slate-200 bg-slate-50 text-slate-900'
                          }`}
                        >
                          <option value="technical">Technical Issue</option>
                          <option value="payment_pro">Pro Key / Payment</option>
                          <option value="question_error">Question / Answer Doubt</option>
                          <option value="account_sync">Account / Cloud Sync</option>
                          <option value="other">Other Query</option>
                        </select>
                        <select
                          value={ticketPriority}
                          onChange={(e) =>
                            setTicketPriority(e.target.value as SupportTicket['priority'])
                          }
                          className={`min-h-[40px] rounded-xl border px-3 text-xs outline-none ${
                            isDark
                              ? 'border-white/10 bg-[#111827] text-white'
                              : 'border-slate-200 bg-slate-50 text-slate-900'
                          }`}
                        >
                          <option value="low">Low Priority</option>
                          <option value="medium">Medium Priority</option>
                          <option value="high">High Priority</option>
                        </select>
                      </div>
                      <input
                        type="text"
                        value={ticketSubject}
                        onChange={(e) => setTicketSubject(e.target.value)}
                        placeholder="Brief subject (e.g., Doubt in BPSC PYQ Q14)"
                        className={`min-h-[40px] w-full rounded-xl border px-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-white/5 text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-900'
                        }`}
                      />
                      <textarea
                        rows={3}
                        value={ticketMessage}
                        onChange={(e) => setTicketMessage(e.target.value)}
                        placeholder="Describe your issue or question in detail..."
                        className={`w-full rounded-xl border p-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-white/5 text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-900'
                        }`}
                      />
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={handleCreateSupportTicket}
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white hover:bg-indigo-500"
                        >
                          <Send className="h-3.5 w-3.5" />
                          Submit Ticket
                        </button>
                        {ticketSubmitToast && (
                          <span className="text-xs font-bold text-emerald-400">
                            {ticketSubmitToast}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Submit General App Feedback */}
                    <div className="space-y-3 rounded-xl border border-white/10 p-4">
                      <h3 className="text-sm font-bold">Share Student Feedback</h3>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">Rating:</span>
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            onClick={() => setGeneralFeedbackRating(star)}
                            className={`rounded-lg p-1.5 ${
                              generalFeedbackRating >= star ? 'text-amber-400' : 'text-slate-600'
                            }`}
                          >
                            <Star className="h-4 w-4 fill-current" />
                          </button>
                        ))}
                      </div>
                      <select
                        value={generalFeedbackCategory}
                        onChange={(e) =>
                          setGeneralFeedbackCategory(
                            e.target.value as StudentFeedbackItem['category']
                          )
                        }
                        className={`min-h-[40px] w-full rounded-xl border px-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-[#111827] text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-900'
                        }`}
                      >
                        <option value="overall_experience">Overall App Experience</option>
                        <option value="question_quality">Question & Explanation Quality</option>
                        <option value="feature_request">New Exam / Feature Request</option>
                        <option value="ui_bug">UI / Mobile Responsiveness</option>
                      </select>
                      <textarea
                        rows={3}
                        value={generalFeedbackMsg}
                        onChange={(e) => setGeneralFeedbackMsg(e.target.value)}
                        placeholder="Tell us what you love or what we should improve..."
                        className={`w-full rounded-xl border p-3 text-xs outline-none ${
                          isDark
                            ? 'border-white/10 bg-white/5 text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-900'
                        }`}
                      />
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (!generalFeedbackMsg.trim()) return;
                            handleSubmitTestFeedback({
                              exam: selectedExam,
                              rating: generalFeedbackRating,
                              category: generalFeedbackCategory,
                              message: generalFeedbackMsg.trim(),
                            });
                            setGeneralFeedbackMsg('');
                            setGeneralFeedbackToast('Thank you! Feedback recorded.');
                            setTimeout(() => setGeneralFeedbackToast(''), 3500);
                          }}
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white hover:bg-emerald-500"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Send Feedback
                        </button>
                        {generalFeedbackToast && (
                          <span className="text-xs font-bold text-emerald-400">
                            {generalFeedbackToast}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Student's Raised Support Tickets & Admin Replies */}
                  <div className="space-y-2.5 pt-2">
                    <h3 className="text-sm font-bold">Your Support Tickets</h3>
                    {(db.supportTickets || []).filter(
                      (t) =>
                        t.deviceId === studentState.deviceId ||
                        t.mobile === studentState.mobileNumber
                    ).length === 0 ? (
                      <p className="text-xs text-slate-400">No support tickets raised yet.</p>
                    ) : (
                      (db.supportTickets || [])
                        .filter(
                          (t) =>
                            t.deviceId === studentState.deviceId ||
                            t.mobile === studentState.mobileNumber
                        )
                        .map((tkt) => (
                          <div
                            key={tkt.id}
                            className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 space-y-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-mono text-xs font-bold text-indigo-400">
                                {tkt.ticketNumber} · {tkt.subject}
                              </span>
                              <span className="rounded-lg bg-indigo-500/20 px-2.5 py-0.5 text-[10px] font-bold uppercase text-indigo-300">
                                {tkt.status}
                              </span>
                            </div>
                            <p className="text-xs text-slate-300">{tkt.message}</p>
                            {tkt.replies && tkt.replies.length > 0 && (
                              <div className="space-y-1.5 border-t border-white/10 pt-2">
                                {tkt.replies.map((rep) => (
                                  <div
                                    key={rep.id}
                                    className="rounded-lg bg-emerald-500/10 p-2 text-xs text-emerald-200"
                                  >
                                    <strong>{rep.senderName || rep.authorName || 'Zyvra Support Desk'}:</strong>{' '}
                                    {rep.message}{' '}
                                    <span className="text-[10px] text-slate-400">
                                      ({rep.createdAt || (rep.timestamp ? new Date(rep.timestamp).toLocaleString('en-IN') : '')})
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))
                    )}
                  </div>
                </section>
              </div>
            )}

            {/* SUB-SECTION 3: RECENT TEST ATTEMPT HISTORY */}
            {profileSection === 'overview' && (
              <section className="space-y-3">
                <h2 className="text-base font-bold">
                  Recent Test History ({studentState.testHistory.length})
                </h2>
                {studentState.testHistory.length === 0 ? (
                  <div
                    className={`rounded-2xl p-8 text-center ${
                      isDark ? 'surface-card-dark' : 'surface-card-light'
                    }`}
                  >
                    <p className="text-sm text-slate-400">No tests completed yet.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {studentState.testHistory.map((att) => (
                      <div
                        key={att.id}
                        className={`flex flex-col justify-between gap-3 rounded-2xl p-4 sm:flex-row sm:items-center ${
                          isDark ? 'surface-card-dark' : 'surface-card-light'
                        }`}
                      >
                        <div>
                          <p className="text-xs font-semibold text-indigo-400">
                            {att.exam} · {att.date}
                          </p>
                          <h3 className="mt-0.5 text-sm font-bold">{att.testTitle}</h3>
                          <p className="mt-1 text-xs text-slate-400 tabular-nums">
                            Score: <strong>{att.netScore}</strong>/{att.maxScore} · Accuracy:{' '}
                            <strong className="text-emerald-400">{att.accuracy}%</strong> · Correct:{' '}
                            {att.correct} · Wrong: {att.wrong}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            const qs = db.questions.filter((q) =>
                              att.questionIds.includes(q.id)
                            );
                            if (qs.length === 0) return;
                            setActiveTestConfig({
                              title: att.testTitle,
                              exam: att.exam,
                              questions: qs,
                              mode: att.mode,
                              timerType: 'overall',
                              overallMinutes: 15,
                              sprintSeconds: 45,
                              marksPerCorrect: att.marksPerCorrect ?? 2.0,
                              negativeMarking: att.negativeMarking ?? 0.5,
                            });
                          }}
                          className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl border border-white/15 px-3.5 text-xs font-semibold hover:bg-white/5"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Re-Attempt
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Student Footer (Discreet 5-tap on Zyvra Logo; no public Admin link) */}
            <footer className="border-t pt-6 text-center border-white/10">
              <div className="flex flex-col items-center justify-center gap-2">
                <div
                  onClick={handleVersionTap}
                  role="presentation"
                  className="select-none cursor-default"
                >
                  <ZyvraLogo size="sm" showTagline={false} />
                </div>
                <p
                  onClick={handleVersionTap}
                  className="select-none rounded-xl px-4 py-1 text-xs text-slate-500 cursor-default"
                >
                  Zyvra Universal Competitive Exam Platform · v{db.version}
                </p>
              </div>
            </footer>
          </div>
        )}
      </main>

      {/* ==========================================================================
          FLOATING MOBILE BOTTOM NAVIGATION DOCK (md:hidden)
         ========================================================================== */}
      <nav
        className={`fixed bottom-0 inset-x-0 z-30 border-t px-2 py-1.5 md:hidden ${
          isDark ? 'liquid-glass-dark' : 'liquid-glass-light'
        }`}
      >
        <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
          {primaryNavItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateToTab(item.id)}
                className={`flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-xl py-1 text-[11px] font-bold transition ${
                  isActive
                    ? 'text-indigo-400'
                    : isDark
                    ? 'text-slate-400 hover:text-slate-200'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {item.icon}
                <span className="truncate max-w-full">
                  {language === 'hi' ? item.label_hi : item.label_en}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* ==========================================================================
          iOS SAFARI PWA INSTALL GUIDE MODAL
         ========================================================================== */}
      {showIOSInstallGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div
            className={`w-full max-w-sm rounded-2xl p-6 ${
              isDark ? 'surface-card-dark text-slate-100' : 'surface-card-light text-slate-900'
            }`}
          >
            <h3 className="text-base font-bold">Install Zyvra on iPhone / iPad</h3>
            <ol className="mt-3 space-y-2 text-xs text-slate-400">
              <li>1. Tap the <strong>Share</strong> icon in your Safari toolbar.</li>
              <li>2. Scroll down and select <strong>Add to Home Screen</strong>.</li>
              <li>3. Tap <strong>Add</strong> to launch Zyvra in full-screen standalone mode.</li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIOSInstallGuide(false)}
              className="mt-5 min-h-[42px] w-full rounded-xl bg-indigo-600 text-xs font-bold text-white"
            >
              Got It
            </button>
          </div>
        </div>
      )}

      {/* ==========================================================================
          UNIVERSAL EXAM SWITCHER MODAL
         ========================================================================== */}
      {showExamSwitcherModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div
            className={`flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl p-5 sm:p-6 ${
              isDark ? 'surface-card-dark text-slate-100' : 'surface-card-light text-slate-900'
            }`}
          >
            <div className="flex items-center justify-between border-b pb-3.5 border-white/10">
              <div>
                <h2 className="text-base font-bold sm:text-lg">Select Your Target Exam</h2>
                <p className="text-xs text-slate-400">
                  Switching exams updates your syllabus, PYQ trends, marking scheme, and study notes
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowExamSwitcherModal(false)}
                className="rounded-xl border border-white/10 px-3 py-1.5 text-xs font-semibold"
              >
                Close
              </button>
            </div>

            {/* Search & Family Filter */}
            <div className="mt-4 space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={examSearchQuery}
                  onChange={(e) => setExamSearchQuery(e.target.value)}
                  placeholder="Search SSC CGL, BPSC TRE, Bihar Daroga, Railway NTPC, UPSC..."
                  className={`min-h-[42px] w-full rounded-xl border pl-9 pr-3 text-xs outline-none ${
                    isDark
                      ? 'border-white/10 bg-white/5 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-900'
                  }`}
                />
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                <button
                  type="button"
                  onClick={() => setSelectedFamilyId('ALL')}
                  className={`min-h-[34px] shrink-0 rounded-lg px-3 text-xs font-semibold ${
                    selectedFamilyId === 'ALL'
                      ? 'bg-indigo-600 text-white'
                      : isDark
                      ? 'bg-white/5 text-slate-300'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  All Families
                </button>
                {db.examFamilies.map((fam) => (
                  <button
                    key={fam.id}
                    type="button"
                    onClick={() => setSelectedFamilyId(fam.id)}
                    className={`min-h-[34px] shrink-0 rounded-lg px-3 text-xs font-semibold ${
                      selectedFamilyId === fam.id
                        ? 'bg-indigo-600 text-white'
                        : isDark
                        ? 'bg-white/5 text-slate-300'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {fam.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Exams List */}
            <div className="mt-4 grid flex-1 grid-cols-1 gap-2.5 overflow-y-auto sm:grid-cols-2">
              {filteredDiscoveryExams.map((ex) => {
                const isSelected = examStringsMatch(ex.name, selectedExam);
                return (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => handleSelectExam(ex.name)}
                    className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-500/15'
                        : isDark
                        ? 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
                        : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-indigo-400">
                        {ex.shortCode || ex.id}
                      </span>
                      <span className="text-[11px] text-slate-400 tabular-nums">
                        +{ex.marksPerCorrect ?? 2}/-{ex.negativeMarking ?? 0.5}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-bold">{ex.name}</p>
                    <p className="text-[11px] text-slate-400">{ex.stateOrAuthority}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ==========================================================================
          ACTIVE MODALS (TEST ENGINE, PDF/NOTE READER, PRO PASS, ADMIN)
         ========================================================================== */}
      {activeTestConfig && (
        <TestEngineModal
          config={activeTestConfig}
          theme={theme}
          language={language}
          onLanguageChange={setLanguage}
          studentState={studentState}
          onToggleBookmarkQuestion={handleToggleBookmarkQuestion}
          onCompleteTest={handleCompleteTest}
          onSubmitFeedback={handleSubmitTestFeedback}
          onGoHome={() => {
            setActiveTestConfig(null);
            navigateToTab('home');
          }}
          onStartNextTest={() => {
            const nextPack = filteredTestPacks.find(
              (p) => p.id !== activeTestConfig.packId && (!p.isPro || studentState.isProUnlocked)
            );
            if (nextPack) {
              launchTestPack(nextPack);
            } else {
              launchQuickExamPractice('pyq');
            }
          }}
          onClose={() => setActiveTestConfig(null)}
        />
      )}

      {activeNoteReader && (
        <PDFReaderModal
          note={activeNoteReader}
          theme={theme}
          language={language}
          isBookmarked={studentState.bookmarkedNoteIds.includes(activeNoteReader.id)}
          onToggleBookmark={() => handleToggleBookmarkNote(activeNoteReader.id)}
          onClose={() => setActiveNoteReader(null)}
        />
      )}

      {showProModal && (
        <ProUnlockModal
          offers={db.offers}
          coupons={db.coupons}
          studentState={studentState}
          theme={theme}
          language={language}
          onUpdateMobile={handleUpdateStudentIdentity}
          onUnlockSuccess={handleProUnlockSuccess}
          onClose={() => setShowProModal(false)}
        />
      )}

      {showAdminModal && (
        <AdminControlCenter
          db={db}
          theme={theme}
          onUpdateDatabase={handleUpdateDatabase}
          onClose={() => setShowAdminModal(false)}
        />
      )}
    </div>
  );
}

export default App;
