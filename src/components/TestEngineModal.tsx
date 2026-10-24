import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  Clock,
  Flag,
  Globe,
  HelpCircle,
  Home,
  Languages,
  LayoutGrid,
  Lightbulb,
  Lock,
  MessageSquarePlus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sliders,
  Sparkles,
  Star,
  Trophy,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  ActiveTestConfig,
  LanguageMode,
  Question,
  StudentFeedbackItem,
  StudentLocalState,
  TestAttemptRecord,
} from '../types/database';
import { translateQuestionContent } from '../utils/storage';

interface TestEngineModalProps {
  config: ActiveTestConfig;
  theme: 'dark' | 'light';
  language: LanguageMode;
  onLanguageChange: (lang: LanguageMode) => void;
  studentState: StudentLocalState;
  onToggleBookmarkQuestion: (questionId: string) => void;
  onCompleteTest: (record: TestAttemptRecord) => void;
  onSubmitFeedback?: (feedback: StudentFeedbackItem) => void;
  onStartNextTest?: () => void;
  onGoHome?: () => void;
  onClose: () => void;
}

type TestPhase = 'instructions' | 'active' | 'submitted';
type ReviewFilter = 'all' | 'wrong' | 'skipped' | 'correct';

type TargetTranslationLang = 'hi' | 'en' | 'bn' | 'mr' | 'ta' | 'te' | 'ur';

interface TranslatedPayload {
  lang: TargetTranslationLang;
  questionText: string;
  options: string[];
  explanation: string;
  provider: string;
}

const TRANSLATION_LANGUAGES: { id: TargetTranslationLang; label: string; native: string }[] = [
  { id: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { id: 'en', label: 'English', native: 'English' },
  { id: 'bn', label: 'Bengali', native: 'বাংলা' },
  { id: 'mr', label: 'Marathi', native: 'मराठी' },
  { id: 'ta', label: 'Tamil', native: 'தமிழ்' },
  { id: 'te', label: 'Telugu', native: 'తెలుగు' },
  { id: 'ur', label: 'Urdu', native: 'اردو' },
];

export const TestEngineModal: React.FC<TestEngineModalProps> = ({
  config,
  theme,
  language,
  onLanguageChange,
  studentState,
  onToggleBookmarkQuestion,
  onCompleteTest,
  onSubmitFeedback,
  onStartNextTest,
  onGoHome,
  onClose,
}) => {
  const isDark = theme === 'dark';
  const rawQuestions: Question[] = config.questions || [];

  // Admin Customization Rules enforcement (Phase 8)
  const rules = useMemo(
    () =>
      config.customizationRules || {
        customizationAllowed: true,
        allowModeSwitch: true,
        allowTimerChange: true,
        allowQuestionCountChange: false,
        allowCategoryFilter: false,
        randomizeQuestions: false,
      },
    [config.customizationRules]
  );

  // Customizable pre-test parameters (bounded by Admin rules)
  const [activeMode, setActiveMode] = useState<'practice' | 'exam_hall'>(config.mode);
  const [activeTimerType, setActiveTimerType] = useState<'overall' | 'sprint' | 'none'>(
    config.timerType
  );
  const [customOverallMinutes, setCustomOverallMinutes] = useState<number>(
    Math.max(1, config.overallMinutes || 15)
  );
  const [customQuestionCount, setCustomQuestionCount] = useState<number>(rawQuestions.length);
  const [shouldRandomize, setShouldRandomize] = useState<boolean>(
    Boolean(rules.randomizeQuestions)
  );

  // Frozen question snapshot locked at test start so mid-test edits never corrupt active attempts
  const [frozenQuestions, setFrozenQuestions] = useState<Question[]>(rawQuestions);
  const questions = frozenQuestions.length > 0 ? frozenQuestions : rawQuestions;

  // Phase & Attempt state
  const [phase, setPhase] = useState<TestPhase>('instructions');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<string, number | null>>({});
  const [markedForReview, setMarkedForReview] = useState<Record<string, boolean>>({});
  const [visitedQuestions, setVisitedQuestions] = useState<Record<string, boolean>>(() =>
    rawQuestions[0] ? { [rawQuestions[0].id]: true } : {}
  );
  const [explanationTab, setExplanationTab] = useState<'both' | 'basic' | 'trick'>('both');
  const [showPaletteDrawer, setShowPaletteDrawer] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');

  // Duplicate submission guard (Phase 1)
  const isSubmittingRef = useRef(false);
  const [completedAttemptId, setCompletedAttemptId] = useState<string>('');
  const reviewSectionRef = useRef<HTMLElement | null>(null);

  // Per-question In-Test Translation state (Phase 7)
  const [targetTranslateLang, setTargetTranslateLang] = useState<TargetTranslationLang>('hi');
  const [showTranslateSelector, setShowTranslateSelector] = useState(false);
  const [activeTranslations, setActiveTranslations] = useState<Record<string, TranslatedPayload>>(
    {}
  );
  const [showTranslatedView, setShowTranslatedView] = useState<Record<string, boolean>>({});
  const [translatingQuestionId, setTranslatingQuestionId] = useState<string | null>(null);
  const [translationError, setTranslationError] = useState<Record<string, string>>({});

  // Post-Test Optional Student Feedback state (Phase 4)
  const [feedbackRating, setFeedbackRating] = useState<number>(0);
  const [feedbackCategory, setFeedbackCategory] = useState<
    'test_quality' | 'question_error' | 'ui_ux' | 'translation' | 'overall_experience'
  >('test_quality');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  const marksPerCorrect = config.marksPerCorrect ?? 2.0;
  const negativeMarking = config.negativeMarking ?? 0.5;
  const marksPerUnanswered = config.marksPerUnanswered ?? 0;

  // Timers only tick during 'active' phase
  const [overallSecondsLeft, setOverallSecondsLeft] = useState(
    Math.max(60, customOverallMinutes * 60)
  );
  const [sprintSecondsLeft, setSprintSecondsLeft] = useState(config.sprintSeconds || 45);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const currentQuestion: Question | undefined = questions[currentIndex];

  // Hardware Back Button / Browser Popstate Protection during Active Test (Phase 1)
  useEffect(() => {
    if (phase !== 'active') return;
    window.history.pushState({ zyvraActiveTest: true }, '');
    const handlePopState = () => {
      if (showPaletteDrawer) {
        setShowPaletteDrawer(false);
        window.history.pushState({ zyvraActiveTest: true }, '');
      } else if (showSubmitConfirm) {
        setShowSubmitConfirm(false);
        window.history.pushState({ zyvraActiveTest: true }, '');
      } else {
        setShowExitConfirm(true);
        window.history.pushState({ zyvraActiveTest: true }, '');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [phase, showPaletteDrawer, showSubmitConfirm]);

  // Mark question as visited when index changes
  useEffect(() => {
    if (phase === 'active' && currentQuestion) {
      setVisitedQuestions((prev) =>
        prev[currentQuestion.id] ? prev : { ...prev, [currentQuestion.id]: true }
      );
    }
  }, [currentIndex, phase, currentQuestion]);

  // Keyboard navigation support (ArrowLeft, ArrowRight, Escape)
  useEffect(() => {
    if (phase !== 'active') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowRight') {
        setCurrentIndex((prev) => Math.min(questions.length - 1, prev + 1));
      } else if (e.key === 'ArrowLeft') {
        setCurrentIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'Escape') {
        if (showPaletteDrawer) setShowPaletteDrawer(false);
        else if (showSubmitConfirm) setShowSubmitConfirm(false);
        else if (showExitConfirm) setShowExitConfirm(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase, questions.length, showPaletteDrawer, showSubmitConfirm, showExitConfirm]);

  // Overall countdown + elapsed timer
  useEffect(() => {
    if (phase !== 'active') return;
    const timer = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
      if (activeTimerType === 'overall') {
        setOverallSecondsLeft((prev) => {
          if (prev <= 1) {
            return 0;
          }
          return prev - 1;
        });
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, activeTimerType]);

  // Auto-submit when overall timer hits 0
  useEffect(() => {
    if (phase === 'active' && activeTimerType === 'overall' && overallSecondsLeft === 0) {
      finalizeSubmission();
    }
  }, [overallSecondsLeft, phase, activeTimerType]);

  // Sprint per-question timer
  useEffect(() => {
    if (phase !== 'active' || activeTimerType !== 'sprint') return;
    setSprintSecondsLeft(config.sprintSeconds || 45);
    const interval = window.setInterval(() => {
      setSprintSecondsLeft((prev) => {
        if (prev <= 1) {
          if (currentIndex < questions.length - 1) {
            setCurrentIndex((idx) => idx + 1);
          }
          return config.sprintSeconds || 45;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [currentIndex, phase, activeTimerType, config.sprintSeconds, questions.length]);

  const handleStartTestWithSnapshot = () => {
    isSubmittingRef.current = false;
    let list = [...rawQuestions];
    const allowedCustomization = Boolean(rules.customizationAllowed);

    if ((allowedCustomization && shouldRandomize) || (!allowedCustomization && rules.randomizeQuestions)) {
      list = [...list].sort(() => Math.random() - 0.5);
    }

    if (allowedCustomization && rules.allowQuestionCountChange) {
      const boundedCount = Math.max(1, Math.min(rawQuestions.length, customQuestionCount));
      list = list.slice(0, boundedCount);
    }

    setFrozenQuestions(list);
    setOverallSecondsLeft(Math.max(60, customOverallMinutes * 60));
    setVisitedQuestions(list[0] ? { [list[0].id]: true } : {});
    setCurrentIndex(0);
    setPhase('active');
  };

  const handleSelectOption = (optionIdx: number) => {
    if (phase !== 'active' || !currentQuestion) return;
    setUserAnswers((prev) => ({
      ...prev,
      [currentQuestion.id]: optionIdx,
    }));
  };

  const handleClearResponse = () => {
    if (phase !== 'active' || !currentQuestion) return;
    setUserAnswers((prev) => ({
      ...prev,
      [currentQuestion.id]: null,
    }));
  };

  const handleToggleReview = () => {
    if (phase !== 'active' || !currentQuestion) return;
    setMarkedForReview((prev) => ({
      ...prev,
      [currentQuestion.id]: !prev[currentQuestion.id],
    }));
  };

  const cycleLanguage = () => {
    const next: LanguageMode =
      language === 'bilingual' ? 'en' : language === 'en' ? 'hi' : 'bilingual';
    onLanguageChange(next);
  };

  // Per-question translation handler (Phase 7)
  const handleTranslateQuestion = async (q: Question, langOverride?: TargetTranslationLang) => {
    const targetLang = langOverride || targetTranslateLang;
    if (langOverride) {
      setTargetTranslateLang(langOverride);
    }

    // If already translated in the same language, toggle view
    const existing = activeTranslations[q.id];
    if (existing && existing.lang === targetLang && !langOverride) {
      setShowTranslatedView((prev) => ({ ...prev, [q.id]: !prev[q.id] }));
      return;
    }

    // Fast path for built-in verified Hindi or English fields
    if (targetLang === 'hi' && q.question_hi && q.options_hi?.length === q.options_en.length) {
      const payload: TranslatedPayload = {
        lang: 'hi',
        questionText: q.question_hi,
        options: q.options_hi,
        explanation: `${q.basic_hi || ''}${q.trick_hi ? `\n\nट्रिक: ${q.trick_hi}` : ''}`.trim(),
        provider: 'verified_bilingual',
      };
      setActiveTranslations((prev) => ({ ...prev, [q.id]: payload }));
      setShowTranslatedView((prev) => ({ ...prev, [q.id]: true }));
      setTranslationError((prev) => ({ ...prev, [q.id]: '' }));
      return;
    }

    if (targetLang === 'en' && q.question_en) {
      const payload: TranslatedPayload = {
        lang: 'en',
        questionText: q.question_en,
        options: q.options_en,
        explanation: `${q.basic_en || ''}${q.trick_en ? `\n\nTrick: ${q.trick_en}` : ''}`.trim(),
        provider: 'verified_bilingual',
      };
      setActiveTranslations((prev) => ({ ...prev, [q.id]: payload }));
      setShowTranslatedView((prev) => ({ ...prev, [q.id]: true }));
      setTranslationError((prev) => ({ ...prev, [q.id]: '' }));
      return;
    }

    setTranslatingQuestionId(q.id);
    setTranslationError((prev) => ({ ...prev, [q.id]: '' }));
    try {
      const res = await translateQuestionContent(q, targetLang);
      const payload: TranslatedPayload = {
        lang: targetLang,
        questionText: res.questionText,
        options: res.options,
        explanation: res.explanation,
        provider: res.provider,
      };
      setActiveTranslations((prev) => ({ ...prev, [q.id]: payload }));
      setShowTranslatedView((prev) => ({ ...prev, [q.id]: true }));
    } catch {
      setTranslationError((prev) => ({
        ...prev,
        [q.id]: 'Translation temporarily unavailable. Tap retry.',
      }));
    } finally {
      setTranslatingQuestionId(null);
    }
  };

  // Summary counts for Palette & Submit Confirmation
  const paletteStats = useMemo(() => {
    let answered = 0;
    let marked = 0;
    let visitedUnanswered = 0;
    let notVisited = 0;

    questions.forEach((q) => {
      const ans = userAnswers[q.id];
      const isAnswered = ans !== undefined && ans !== null;
      const isMarked = Boolean(markedForReview[q.id]);
      const isVisited = Boolean(visitedQuestions[q.id]);

      if (isAnswered) answered += 1;
      else if (isVisited) visitedUnanswered += 1;
      else notVisited += 1;

      if (isMarked) marked += 1;
    });

    return {
      total: questions.length,
      answered,
      unanswered: questions.length - answered,
      marked,
      visitedUnanswered,
      notVisited,
    };
  }, [questions, userAnswers, markedForReview, visitedQuestions]);

  // Final score calculation
  const resultMetrics = useMemo(() => {
    let attempted = 0;
    let correct = 0;
    let wrong = 0;
    let skipped = 0;

    questions.forEach((q) => {
      const ans = userAnswers[q.id];
      if (ans === undefined || ans === null) {
        skipped += 1;
      } else {
        attempted += 1;
        if (ans === q.correctIndex) {
          correct += 1;
        } else {
          wrong += 1;
        }
      }
    });

    const maxScore = Number((questions.length * marksPerCorrect).toFixed(2));
    const rawNet =
      correct * marksPerCorrect - wrong * negativeMarking + skipped * marksPerUnanswered;
    const netScore = Number(rawNet.toFixed(2));
    const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
    const avgSecondsPerQuestion =
      questions.length > 0 ? Math.max(1, Math.round(elapsedSeconds / questions.length)) : 0;

    const scaled200 =
      maxScore > 0 ? Number(((Math.max(0, netScore) / maxScore) * 200).toFixed(1)) : 0;
    const normalizedScore =
      accuracy >= 85
        ? Number(Math.min(200, scaled200 + 8.4).toFixed(1))
        : Number(Math.min(200, scaled200 + 3.2).toFixed(1));

    return {
      attempted,
      correct,
      wrong,
      skipped,
      maxScore,
      netScore,
      accuracy,
      avgSecondsPerQuestion,
      normalizedScore,
    };
  }, [questions, userAnswers, marksPerCorrect, negativeMarking, marksPerUnanswered, elapsedSeconds]);

  const finalizeSubmission = () => {
    if (phase === 'submitted' || isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    const attemptId = `attempt-${Date.now()}`;
    setCompletedAttemptId(attemptId);
    setShowSubmitConfirm(false);
    setShowPaletteDrawer(false);
    setPhase('submitted');

    const record: TestAttemptRecord = {
      id: attemptId,
      attemptId,
      packId: config.packId,
      packTitle: config.title,
      testTitle: config.title,
      exam: config.exam,
      stage: config.stage,
      paper: config.paper,
      stageOrPaper: config.stageOrPaper,
      mode: activeMode,
      timestamp: Date.now(),
      date: new Date().toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      totalQuestions: questions.length,
      attempted: resultMetrics.attempted,
      correct: resultMetrics.correct,
      wrong: resultMetrics.wrong,
      skipped: resultMetrics.skipped,
      marksPerCorrect,
      netScore: resultMetrics.netScore,
      score: resultMetrics.netScore,
      maxScore: resultMetrics.maxScore,
      totalMarks: resultMetrics.maxScore,
      negativeMarking,
      accuracy: resultMetrics.accuracy,
      avgSecondsPerQuestion: resultMetrics.avgSecondsPerQuestion,
      normalizedScore: resultMetrics.normalizedScore,
      isOfficialSimulation: config.isOfficialSimulation,
      questionIds: questions.map((q) => q.id),
      userAnswers,
      timeTakenSeconds: Math.max(1, elapsedSeconds),
      customizationSnapshot: {
        customizedByStudent: Boolean(rules.customizationAllowed),
        timerType: activeTimerType,
        overallMinutes: customOverallMinutes,
        questionCount: questions.length,
      },
    };
    onCompleteTest(record);
  };

  const handleRestartTest = () => {
    isSubmittingRef.current = false;
    setFeedbackSubmitted(false);
    setFeedbackRating(0);
    setFeedbackMessage('');
    setUserAnswers({});
    setMarkedForReview({});
    setVisitedQuestions(questions[0] ? { [questions[0].id]: true } : {});
    setCurrentIndex(0);
    setElapsedSeconds(0);
    setOverallSecondsLeft(Math.max(60, customOverallMinutes * 60));
    setSprintSecondsLeft(config.sprintSeconds || 45);
    setPhase('active');
  };

  const handleFeedbackSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (feedbackSubmitted || feedbackRating < 1) return;
    const item: StudentFeedbackItem = {
      id: `FB-${Date.now()}`,
      deviceId: studentState.deviceId,
      studentName: studentState.studentName || 'Student Aspirant',
      attemptId: completedAttemptId || `attempt-${Date.now()}`,
      packTitle: config.title,
      rating: feedbackRating as 1 | 2 | 3 | 4 | 5,
      category: feedbackCategory,
      message: feedbackMessage.trim() || `Rated ${feedbackRating}/5 stars for ${config.title}`,
      status: 'new',
      createdAt: Date.now(),
    };
    setFeedbackSubmitted(true);
    if (onSubmitFeedback) {
      onSubmitFeedback(item);
    }
  };

  const formatMMSS = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  if (!rawQuestions.length) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
        <div
          className={`w-full max-w-md rounded-2xl p-6 text-center ${
            isDark ? 'surface-card-dark text-white' : 'surface-card-light text-slate-900'
          }`}
        >
          <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-400" />
          <h3 className="text-lg font-bold">No Questions Found</h3>
          <p className="mt-1 text-sm text-slate-400">
            This test selection has no matching questions. Please adjust your filters and try again.
          </p>
          <button
            onClick={onClose}
            className="mt-5 min-h-[44px] w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Back to Workspace
          </button>
        </div>
      </div>
    );
  }

  // ============================================================================
  // PHASE 1: PRE-TEST SUMMARY, CUSTOMIZATION ENFORCEMENT & INSTRUCTIONS SCREEN
  // ============================================================================
  if (phase === 'instructions') {
    const canSwitchMode = rules.customizationAllowed && rules.allowModeSwitch;
    const canChangeTimer = rules.customizationAllowed && rules.allowTimerChange;
    const canChangeQCount = rules.customizationAllowed && rules.allowQuestionCountChange;

    return (
      <div
        className={`fixed inset-0 z-50 flex flex-col overflow-y-auto ${
          isDark ? 'bg-[#0A0E17] text-slate-100' : 'bg-[#F8FAFC] text-slate-900'
        }`}
      >
        {/* Top Header */}
        <header
          className={`sticky top-0 z-20 border-b px-4 py-3 ${
            isDark ? 'liquid-glass-dark' : 'liquid-glass-light'
          }`}
        >
          <div className="mx-auto flex max-w-3xl items-center justify-between">
            <button
              onClick={onClose}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                isDark
                  ? 'text-slate-300 hover:bg-white/5 hover:text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
              Pre-Test Instructions
            </span>
            <button
              onClick={onGoHome || onClose}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                isDark
                  ? 'text-slate-300 hover:bg-white/5 hover:text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Home className="h-4 w-4" />
              Home
            </button>
          </div>
        </header>

        {/* Main Instructions Content */}
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:py-8">
          <div
            className={`rounded-2xl p-5 sm:p-7 ${
              isDark ? 'surface-card-dark' : 'surface-card-light'
            }`}
          >
            {/* Exam & Stage Breadcrumb + Admin Customization Badge */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
                {config.exam}
                {config.stage ? ` · ${config.stage}` : ''}
                {config.paper ? ` · ${config.paper}` : ''}
              </p>
              <span
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${
                  rules.customizationAllowed
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                }`}
              >
                {rules.customizationAllowed ? (
                  <>
                    <Sliders className="h-3.5 w-3.5" />
                    Customization Allowed
                  </>
                ) : (
                  <>
                    <Lock className="h-3.5 w-3.5" />
                    Official Fixed Parameters (Locked by Admin)
                  </>
                )}
              </span>
            </div>

            <h1 className="mt-1.5 text-xl font-bold tracking-tight sm:text-2xl">{config.title}</h1>

            {/* Key Test Specs Grid */}
            <div
              className={`mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 ${
                isDark ? 'text-slate-200' : 'text-slate-800'
              }`}
            >
              <div
                className={`rounded-xl border p-3.5 ${
                  isDark ? 'border-white/10 bg-white/[0.02]' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <p className="text-xs text-slate-400">Questions</p>
                <p className="mt-1 text-lg font-bold tabular-nums">
                  {canChangeQCount ? customQuestionCount : rawQuestions.length} Qs
                </p>
              </div>
              <div
                className={`rounded-xl border p-3.5 ${
                  isDark ? 'border-white/10 bg-white/[0.02]' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <p className="text-xs text-slate-400">Duration</p>
                <p className="mt-1 text-lg font-bold tabular-nums">
                  {activeTimerType === 'overall'
                    ? `${customOverallMinutes} Mins`
                    : activeTimerType === 'sprint'
                    ? `${config.sprintSeconds || 45}s / Q`
                    : 'Untimed'}
                </p>
              </div>
              <div
                className={`rounded-xl border p-3.5 ${
                  isDark ? 'border-white/10 bg-white/[0.02]' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <p className="text-xs text-slate-400">Maximum Marks</p>
                <p className="mt-1 text-lg font-bold tabular-nums">
                  {(
                    (canChangeQCount ? customQuestionCount : rawQuestions.length) * marksPerCorrect
                  ).toFixed(1)}
                </p>
              </div>
              <div
                className={`rounded-xl border p-3.5 ${
                  isDark ? 'border-white/10 bg-white/[0.02]' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <p className="text-xs text-slate-400">Marking Scheme</p>
                <p className="mt-1 text-sm font-bold tabular-nums">
                  <span className="text-emerald-400">+{marksPerCorrect}</span>
                  {' / '}
                  <span className={negativeMarking > 0 ? 'text-rose-400' : 'text-slate-400'}>
                    {negativeMarking > 0 ? `-${negativeMarking}` : 'No Neg (0)'}
                  </span>
                </p>
              </div>
            </div>

            {/* Choose Test Mode (Respects Admin Customization Rules) */}
            <div className="mt-6">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Select Attempt Mode
                </label>
                {!canSwitchMode && (
                  <span className="text-[11px] font-medium text-amber-400">
                    Mode fixed by Admin for this exam pack
                  </span>
                )}
              </div>
              <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={!canSwitchMode && activeMode !== 'exam_hall'}
                  onClick={() => canSwitchMode && setActiveMode('exam_hall')}
                  className={`flex min-h-[64px] items-start gap-3 rounded-xl border p-3.5 text-left transition disabled:opacity-45 ${
                    activeMode === 'exam_hall'
                      ? 'border-indigo-500 bg-indigo-500/10'
                      : isDark
                      ? 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <ShieldCheck
                    className={`mt-0.5 h-5 w-5 shrink-0 ${
                      activeMode === 'exam_hall' ? 'text-indigo-400' : 'text-slate-400'
                    }`}
                  />
                  <div>
                    <p className="text-sm font-bold">Official Exam Hall Mode</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Real CBT simulation. Answers & explanations revealed only after final submit.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  disabled={!canSwitchMode && activeMode !== 'practice'}
                  onClick={() => canSwitchMode && setActiveMode('practice')}
                  className={`flex min-h-[64px] items-start gap-3 rounded-xl border p-3.5 text-left transition disabled:opacity-45 ${
                    activeMode === 'practice'
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : isDark
                      ? 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <Zap
                    className={`mt-0.5 h-5 w-5 shrink-0 ${
                      activeMode === 'practice' ? 'text-emerald-400' : 'text-slate-400'
                    }`}
                  />
                  <div>
                    <p className="text-sm font-bold">Instant Learning Mode</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Check answer immediately on tap with Basic Method + 15-Second Exam Trick.
                    </p>
                  </div>
                </button>
              </div>
            </div>

            {/* Optional Student Customization Controls (Only shown when Admin allows) */}
            {rules.customizationAllowed && (canChangeTimer || canChangeQCount) && (
              <div
                className={`mt-6 rounded-xl border p-4 ${
                  isDark ? 'border-indigo-500/25 bg-indigo-500/[0.04]' : 'border-indigo-200 bg-indigo-50/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-indigo-400">
                    <Sliders className="h-3.5 w-3.5" />
                    Student Test Customization Options
                  </p>
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={shouldRandomize}
                      onChange={(e) => setShouldRandomize(e.target.checked)}
                      className="h-4 w-4 rounded accent-indigo-600"
                    />
                    Shuffle Question Order
                  </label>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {canChangeTimer && (
                    <div>
                      <label className="block text-xs font-medium text-slate-400">
                        Timer Mode & Duration (Mins)
                      </label>
                      <div className="mt-1.5 flex gap-2">
                        <select
                          value={activeTimerType}
                          onChange={(e) =>
                            setActiveTimerType(e.target.value as 'overall' | 'sprint' | 'none')
                          }
                          className={`min-h-[40px] flex-1 rounded-xl border px-3 text-xs font-semibold ${
                            isDark
                              ? 'border-white/10 bg-[#0A0E17] text-slate-100'
                              : 'border-slate-300 bg-white text-slate-800'
                          }`}
                        >
                          <option value="overall">Overall Exam Countdown</option>
                          <option value="sprint">Per-Question Sprint Timer</option>
                          <option value="none">Untimed Practice</option>
                        </select>
                        {activeTimerType === 'overall' && (
                          <input
                            type="number"
                            min={1}
                            max={180}
                            value={customOverallMinutes}
                            onChange={(e) =>
                              setCustomOverallMinutes(
                                Math.max(1, Math.min(180, Number(e.target.value) || 15))
                              )
                            }
                            className={`min-h-[40px] w-20 rounded-xl border px-2.5 text-center text-xs font-bold ${
                              isDark
                                ? 'border-white/10 bg-[#0A0E17] text-slate-100'
                                : 'border-slate-300 bg-white text-slate-800'
                            }`}
                          />
                        )}
                      </div>
                    </div>
                  )}

                  {canChangeQCount && (
                    <div>
                      <label className="block text-xs font-medium text-slate-400">
                        Number of Questions (Max {rawQuestions.length})
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={rawQuestions.length}
                        value={customQuestionCount}
                        onChange={(e) =>
                          setCustomQuestionCount(
                            Math.max(1, Math.min(rawQuestions.length, Number(e.target.value) || 1))
                          )
                        }
                        className={`mt-1.5 min-h-[40px] w-full rounded-xl border px-3 text-xs font-bold ${
                          isDark
                            ? 'border-white/10 bg-[#0A0E17] text-slate-100'
                            : 'border-slate-300 bg-white text-slate-800'
                        }`}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Choose Default Question Language */}
            <div className="mt-6">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                Question Paper Language (Can be toggled or translated anytime during test)
              </label>
              <div className="mt-2.5 grid grid-cols-3 gap-2.5">
                {(
                  [
                    { id: 'bilingual', label: 'Bilingual (EN + हिं)' },
                    { id: 'en', label: 'English Only' },
                    { id: 'hi', label: 'हिन्दी (Hindi)' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onLanguageChange(item.id)}
                    className={`min-h-[44px] rounded-xl border px-3 py-2 text-xs font-semibold transition sm:text-sm ${
                      language === item.id
                        ? 'border-indigo-500 bg-indigo-600 text-white'
                        : isDark
                        ? 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Official Instructions Summary */}
            <div
              className={`mt-6 rounded-xl border p-4 ${
                isDark ? 'border-white/10 bg-white/[0.02]' : 'border-slate-200 bg-slate-50/70'
              }`}
            >
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Important Exam Instructions
              </h2>
              <ul className="mt-2.5 space-y-2 text-xs leading-relaxed text-slate-400 sm:text-sm">
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                  <span>
                    Each correct answer awards <strong className="text-emerald-400">+{marksPerCorrect} marks</strong>.
                    {negativeMarking > 0
                      ? ` Each wrong answer deducts -${negativeMarking} marks.`
                      : ' There is NO negative marking for wrong answers.'}
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                  <span>
                    Use the <strong>Translate</strong> button on any question to read it in Hindi, English, Bengali, Marathi, Tamil, Telugu, or Urdu without losing your selected answer or timer.
                  </span>
                </li>
              </ul>
            </div>

            {/* Primary CTA */}
            <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={onClose}
                className={`min-h-[48px] rounded-xl border px-5 py-3 text-sm font-semibold transition ${
                  isDark
                    ? 'border-white/10 text-slate-300 hover:bg-white/5'
                    : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleStartTestWithSnapshot}
                className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-base font-bold text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-500 sm:flex-initial sm:min-w-[240px]"
              >
                Start Test Now
                <ArrowRight className="h-5 w-5" />
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ============================================================================
  // PHASE 3: STRUCTURED RESULTS, CLEAR NAVIGATION, FEEDBACK & QUESTION REVIEW
  // ============================================================================
  if (phase === 'submitted') {
    const filteredReviewQuestions = questions.filter((q) => {
      const ans = userAnswers[q.id];
      const isSkipped = ans === undefined || ans === null;
      const isCorrect = !isSkipped && ans === q.correctIndex;
      if (reviewFilter === 'wrong') return !isSkipped && !isCorrect;
      if (reviewFilter === 'skipped') return isSkipped;
      if (reviewFilter === 'correct') return isCorrect;
      return true;
    });

    return (
      <div
        className={`fixed inset-0 z-50 flex flex-col overflow-y-auto ${
          isDark ? 'bg-[#0A0E17] text-slate-100' : 'bg-[#F8FAFC] text-slate-900'
        }`}
      >
        {/* Sticky Result Navigation Header (Phase 1 Fix: Always Accessible Home/Back/Review) */}
        <header
          className={`sticky top-0 z-20 border-b px-4 py-3 ${
            isDark ? 'liquid-glass-dark' : 'liquid-glass-light'
          }`}
        >
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                onClick={onGoHome || onClose}
                className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                  isDark
                    ? 'border-white/15 bg-white/5 text-slate-200 hover:bg-white/10'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                }`}
                title="Back to Home Dashboard"
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Dashboard</span>
              </button>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-400">
                  Result Summary · {config.exam}
                </p>
                <h1 className="truncate text-sm font-bold sm:text-base">{config.title}</h1>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={cycleLanguage}
                className={`min-h-[40px] rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                  isDark
                    ? 'border-white/15 bg-white/5 text-slate-200'
                    : 'border-slate-300 bg-white text-slate-800'
                }`}
              >
                अ/A · {language === 'bilingual' ? 'Bi' : language.toUpperCase()}
              </button>
              <button
                onClick={onGoHome || onClose}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                <Home className="h-3.5 w-3.5" />
                Home
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-6">
          {/* Score Card Hero + Post-Submission Action Bar */}
          <section
            className={`rounded-2xl p-5 sm:p-6 ${
              isDark ? 'surface-card-dark' : 'surface-card-light'
            }`}
          >
            <div className="flex flex-col justify-between gap-4 border-b pb-5 sm:flex-row sm:items-center border-white/10">
              <div>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  <Trophy className="h-4 w-4" />
                  Test Submitted Successfully
                </span>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold tabular-nums sm:text-4xl">
                    {resultMetrics.netScore}
                  </span>
                  <span className="text-sm text-slate-400 tabular-nums">
                    / {resultMetrics.maxScore} Marks
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Marking: +{marksPerCorrect} correct ·{' '}
                  {negativeMarking > 0 ? `-${negativeMarking} negative` : 'No negative marking'} · Time:{' '}
                  {formatMMSS(elapsedSeconds)}
                </p>
              </div>

              {/* Phase 1 Post-Test Navigation Actions */}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    reviewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                  className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition ${
                    isDark
                      ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25'
                      : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                  }`}
                >
                  Review Answers
                </button>
                <button
                  type="button"
                  onClick={handleRestartTest}
                  className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition ${
                    isDark
                      ? 'border-white/15 bg-white/5 text-slate-200 hover:bg-white/10'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <RotateCcw className="h-4 w-4" />
                  Retry Test
                </button>
                {onStartNextTest && (
                  <button
                    type="button"
                    onClick={onStartNextTest}
                    className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition ${
                      isDark
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    }`}
                  >
                    Next Test
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onGoHome || onClose}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
                >
                  <Home className="h-4 w-4" />
                  Home / Dashboard
                </button>
              </div>
            </div>

            {/* 4 Key Metrics Grid */}
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div
                className={`rounded-xl border p-3.5 ${
                  isDark ? 'border-white/10 bg-white/[0.02]' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <p className="text-xs text-slate-400">Accuracy</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-emerald-400">
                  {resultMetrics.accuracy}%
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {resultMetrics.attempted} of {questions.length} attempted
                </p>
              </div>

              <div
                className={`rounded-xl border p-3.5 ${
                  isDark ? 'border-white/10 bg-white/[0.02]' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <p className="text-xs text-slate-400">Correct</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-emerald-400">
                  {resultMetrics.correct}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  +{(resultMetrics.correct * marksPerCorrect).toFixed(2)} marks
                </p>
              </div>

              <div
                className={`rounded-xl border p-3.5 ${
                  isDark ? 'border-white/10 bg-white/[0.02]' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <p className="text-xs text-slate-400">Incorrect</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-rose-400">
                  {resultMetrics.wrong}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  -{(resultMetrics.wrong * negativeMarking).toFixed(2)} penalty
                </p>
              </div>

              <div
                className={`rounded-xl border p-3.5 ${
                  isDark ? 'border-white/10 bg-white/[0.02]' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <p className="text-xs text-slate-400">Unanswered / Speed</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-amber-400">
                  {resultMetrics.skipped} Qs
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Avg {resultMetrics.avgSecondsPerQuestion}s / question
                </p>
              </div>
            </div>
          </section>

          {/* Phase 4: Optional Student Feedback Card */}
          <section
            className={`rounded-2xl p-5 ${
              isDark ? 'surface-card-dark' : 'surface-card-light'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MessageSquarePlus className="h-4 w-4 text-indigo-400" />
                <h2 className="text-sm font-bold">Share Optional Test Feedback</h2>
              </div>
              <span className="text-[11px] text-slate-400">Optional · Helps improve Zyvra</span>
            </div>

            {feedbackSubmitted ? (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs font-semibold text-emerald-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Thank you! Your feedback has been recorded for the Academic Review team.
              </div>
            ) : (
              <form onSubmit={handleFeedbackSubmit} className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setFeedbackRating(star)}
                        className="rounded-lg p-1.5 transition hover:scale-110"
                        title={`Rate ${star} Star${star > 1 ? 's' : ''}`}
                      >
                        <Star
                          className={`h-5 w-5 ${
                            star <= feedbackRating
                              ? 'fill-amber-400 text-amber-400'
                              : 'text-slate-500'
                          }`}
                        />
                      </button>
                    ))}
                  </div>

                  <select
                    value={feedbackCategory}
                    onChange={(e) => setFeedbackCategory(e.target.value as any)}
                    className={`min-h-[38px] rounded-xl border px-3 text-xs font-semibold ${
                      isDark
                        ? 'border-white/10 bg-[#0A0E17] text-slate-200'
                        : 'border-slate-200 bg-slate-50 text-slate-800'
                    }`}
                  >
                    <option value="test_quality">Question & Explanation Quality</option>
                    <option value="question_error">Report Question / Option Error</option>
                    <option value="translation">Translation Accuracy</option>
                    <option value="ui_ux">Mobile App Experience</option>
                    <option value="overall_experience">Overall Experience</option>
                  </select>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={feedbackMessage}
                    onChange={(e) => setFeedbackMessage(e.target.value)}
                    placeholder="Optional comments or question number to review..."
                    className={`min-h-[42px] flex-1 rounded-xl border px-3.5 text-xs ${
                      isDark
                        ? 'border-white/10 bg-[#0A0E17] text-slate-100 placeholder:text-slate-500'
                        : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400'
                    }`}
                  />
                  <button
                    type="submit"
                    disabled={feedbackRating < 1}
                    className="min-h-[42px] rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-indigo-500 disabled:opacity-40"
                  >
                    Submit Feedback
                  </button>
                </div>
              </form>
            )}
          </section>

          {/* Filterable Solutions Review */}
          <section ref={reviewSectionRef} className="space-y-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <h2 className="text-base font-bold">
                Detailed Solutions ({filteredReviewQuestions.length})
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { id: 'all', label: `All (${questions.length})` },
                    { id: 'wrong', label: `Wrong (${resultMetrics.wrong})` },
                    { id: 'skipped', label: `Skipped (${resultMetrics.skipped})` },
                    { id: 'correct', label: `Correct (${resultMetrics.correct})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setReviewFilter(tab.id)}
                    className={`min-h-[38px] rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                      reviewFilter === tab.id
                        ? 'bg-indigo-600 text-white'
                        : isDark
                        ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                        : 'bg-slate-200/70 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredReviewQuestions.length === 0 ? (
              <div
                className={`rounded-2xl p-8 text-center ${
                  isDark ? 'surface-card-dark' : 'surface-card-light'
                }`}
              >
                <p className="text-sm text-slate-400">No questions match this filter.</p>
              </div>
            ) : (
              filteredReviewQuestions.map((q) => {
                const originalNumber = questions.findIndex((item) => item.id === q.id) + 1;
                const userAns = userAnswers[q.id];
                const isSkipped = userAns === undefined || userAns === null;
                const isCorrect = !isSkipped && userAns === q.correctIndex;
                const isBookmarked = studentState.bookmarkedQuestionIds.includes(q.id);
                const qTrans = activeTranslations[q.id];
                const isShowingTrans = Boolean(showTranslatedView[q.id] && qTrans);

                return (
                  <article
                    key={q.id}
                    className={`rounded-2xl p-5 ${
                      isDark ? 'surface-card-dark' : 'surface-card-light'
                    }`}
                  >
                    {/* Top Metadata Line */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-bold text-indigo-400">Q.{originalNumber}</span>
                          <span className="text-slate-500">·</span>
                          <span
                            className={`inline-flex items-center gap-1 font-semibold ${
                              isCorrect
                                ? 'text-emerald-400'
                                : isSkipped
                                ? 'text-amber-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {isCorrect ? (
                              <>
                                <CheckCircle2 className="h-3.5 w-3.5" /> Correct (+{marksPerCorrect})
                              </>
                            ) : isSkipped ? (
                              <>
                                <HelpCircle className="h-3.5 w-3.5" /> Unanswered (0)
                              </>
                            ) : (
                              <>
                                <XCircle className="h-3.5 w-3.5" /> Wrong (-{negativeMarking})
                              </>
                            )}
                          </span>
                          <span className="text-slate-500">·</span>
                          <span className="text-slate-400">
                            {q.subject} · {q.topic} · {q.pyqTag}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleTranslateQuestion(q)}
                          className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-semibold transition ${
                            isShowingTrans
                              ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300'
                              : isDark
                              ? 'border-white/10 text-slate-300 hover:bg-white/5'
                              : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <Languages className="h-3.5 w-3.5" />
                          {translatingQuestionId === q.id
                            ? 'Translating...'
                            : isShowingTrans
                            ? 'Show Original'
                            : 'Translate'}
                        </button>

                        <button
                          onClick={() => onToggleBookmarkQuestion(q.id)}
                          className={`inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-xl border transition ${
                            isBookmarked
                              ? 'border-amber-500/40 bg-amber-500/15 text-amber-400'
                              : isDark
                              ? 'border-white/10 text-slate-400 hover:bg-white/5'
                              : 'border-slate-200 text-slate-500 hover:bg-slate-100'
                          }`}
                          title="Bookmark Question"
                        >
                          {isBookmarked ? (
                            <BookmarkCheck className="h-4 w-4" />
                          ) : (
                            <Bookmark className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Question Stem */}
                    <div className="reading-prose mt-3 space-y-1.5 text-sm sm:text-base">
                      {isShowingTrans && qTrans ? (
                        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-400">
                            Translated ({qTrans.lang.toUpperCase()})
                          </p>
                          <p className="mt-1 font-medium">{qTrans.questionText}</p>
                        </div>
                      ) : (
                        <>
                          {(language === 'en' || language === 'bilingual') && (
                            <p className="font-medium">{q.question_en}</p>
                          )}
                          {(language === 'hi' || language === 'bilingual') && (
                            <p
                              className={
                                language === 'bilingual' ? 'text-slate-400' : 'font-medium'
                              }
                            >
                              {q.question_hi}
                            </p>
                          )}
                        </>
                      )}
                    </div>

                    {/* Options Review */}
                    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {q.options_en.map((optEn, optIdx) => {
                        const optHi = q.options_hi[optIdx] || optEn;
                        const transOpt =
                          isShowingTrans && qTrans?.options?.[optIdx]
                            ? qTrans.options[optIdx]
                            : null;
                        const isRightOpt = optIdx === q.correctIndex;
                        const isUserPicked = userAns === optIdx;

                        return (
                          <div
                            key={optIdx}
                            className={`flex items-start gap-2.5 rounded-xl border p-3 text-xs sm:text-sm ${
                              isRightOpt
                                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                                : isUserPicked
                                ? 'border-rose-500/50 bg-rose-500/10 text-rose-300'
                                : isDark
                                ? 'border-white/10 bg-white/[0.02] text-slate-300'
                                : 'border-slate-200 bg-slate-50 text-slate-700'
                            }`}
                          >
                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-black/20 text-[11px] font-bold">
                              {String.fromCharCode(65 + optIdx)}
                            </span>
                            <div className="flex-1">
                              {transOpt ? (
                                <p>{transOpt}</p>
                              ) : (
                                <>
                                  {(language === 'en' || language === 'bilingual') && <p>{optEn}</p>}
                                  {(language === 'hi' || language === 'bilingual') && (
                                    <p className="text-xs opacity-85">{optHi}</p>
                                  )}
                                </>
                              )}
                            </div>
                            {isRightOpt && (
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                            )}
                            {!isRightOpt && isUserPicked && (
                              <XCircle className="h-4 w-4 shrink-0 text-rose-400" />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Dual Method Explanation */}
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div
                        className={`rounded-xl border p-3.5 ${
                          isDark
                            ? 'border-white/10 bg-white/[0.02]'
                            : 'border-slate-200 bg-slate-50'
                        }`}
                      >
                        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-indigo-400">
                          <Lightbulb className="h-3.5 w-3.5" />
                          Method 1: Basic Concept
                        </p>
                        {(language === 'en' || language === 'bilingual') && (
                          <p className="mt-1.5 text-xs leading-relaxed sm:text-sm">{q.basic_en}</p>
                        )}
                        {(language === 'hi' || language === 'bilingual') && (
                          <p className="mt-1 text-xs leading-relaxed text-slate-400">
                            {q.basic_hi}
                          </p>
                        )}
                      </div>

                      <div
                        className={`rounded-xl border p-3.5 ${
                          isDark
                            ? 'border-emerald-500/25 bg-emerald-500/[0.05]'
                            : 'border-emerald-300 bg-emerald-50/60'
                        }`}
                      >
                        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-400">
                          <Sparkles className="h-3.5 w-3.5" />
                          Method 2: 15-Second Exam Trick
                        </p>
                        {(language === 'en' || language === 'bilingual') && (
                          <p className="mt-1.5 text-xs leading-relaxed sm:text-sm">{q.trick_en}</p>
                        )}
                        {(language === 'hi' || language === 'bilingual') && (
                          <p className="mt-1 text-xs leading-relaxed text-slate-400">
                            {q.trick_hi}
                          </p>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </section>
        </main>
      </div>
    );
  }

  // ============================================================================
  // PHASE 2: ACTIVE DISTRACTION-FREE TEST SCREEN (WITH IN-TEST TRANSLATION)
  // ============================================================================
  const selectedOpt = currentQuestion ? userAnswers[currentQuestion.id] : null;
  const isCurrentAnswered = selectedOpt !== undefined && selectedOpt !== null;
  const isCurrentMarked = currentQuestion ? Boolean(markedForReview[currentQuestion.id]) : false;
  const isCurrentBookmarked = currentQuestion
    ? studentState.bookmarkedQuestionIds.includes(currentQuestion.id)
    : false;
  const showInstantFeedback = activeMode === 'practice' && isCurrentAnswered;

  const currentTranslation = currentQuestion ? activeTranslations[currentQuestion.id] : undefined;
  const isShowingCurrentTranslation = currentQuestion
    ? Boolean(showTranslatedView[currentQuestion.id] && currentTranslation)
    : false;
  const currentTranslateError = currentQuestion ? translationError[currentQuestion.id] : '';

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col ${
        isDark ? 'bg-[#0A0E17] text-slate-100' : 'bg-[#F8FAFC] text-slate-900'
      }`}
    >
      {/* Top Distraction-Free Exam Header */}
      <header
        className={`sticky top-0 z-20 border-b px-3 py-2.5 sm:px-6 ${
          isDark ? 'liquid-glass-dark' : 'liquid-glass-light'
        }`}
      >
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-2">
          {/* Left: Back/Exit + Title */}
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setShowExitConfirm(true)}
              className={`inline-flex min-h-[42px] min-w-[42px] items-center justify-center rounded-xl border transition ${
                isDark
                  ? 'border-white/10 text-slate-300 hover:bg-white/5'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
              title="Exit Test"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold sm:text-sm">{config.title}</p>
              <p className="truncate text-[11px] text-slate-400">
                {config.exam}
                {config.stage ? ` · ${config.stage}` : ''} ·{' '}
                {activeMode === 'exam_hall' ? 'Exam Hall Mode' : 'Practice Mode'}
              </p>
            </div>
          </div>

          {/* Right: Timer, Language Toggle, Palette Drawer Trigger */}
          <div className="flex shrink-0 items-center gap-2">
            {activeTimerType !== 'none' && (
              <div
                className={`inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold tabular-nums sm:text-sm ${
                  (activeTimerType === 'overall' && overallSecondsLeft < 60) ||
                  (activeTimerType === 'sprint' && sprintSecondsLeft <= 10)
                    ? 'border-rose-500/50 bg-rose-500/15 text-rose-400'
                    : isDark
                    ? 'border-white/10 bg-white/[0.04] text-slate-100'
                    : 'border-slate-200 bg-slate-100 text-slate-900'
                }`}
              >
                <Clock className="h-3.5 w-3.5 text-indigo-400" />
                {activeTimerType === 'overall'
                  ? formatMMSS(overallSecondsLeft)
                  : `${sprintSecondsLeft}s`}
              </div>
            )}

            <button
              type="button"
              onClick={cycleLanguage}
              className={`min-h-[42px] rounded-xl border px-2.5 py-1.5 text-xs font-bold transition ${
                isDark
                  ? 'border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/10'
                  : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-100'
              }`}
              title="Switch Question Paper Language"
            >
              अ/A · {language === 'bilingual' ? 'Bi' : language.toUpperCase()}
            </button>

            <button
              type="button"
              onClick={() => setShowPaletteDrawer(true)}
              className={`inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                isDark
                  ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25'
                  : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
              }`}
              title="Open Question Palette"
            >
              <LayoutGrid className="h-4 w-4" />
              <span className="tabular-nums">
                {paletteStats.answered}/{paletteStats.total}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Scrollable Question Workspace */}
      {currentQuestion && (
        <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
          {/* Question Number + Metadata + Per-Question Translate + Bookmark */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3.5 border-white/10">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-bold text-white tabular-nums">
                Q. {currentIndex + 1} / {questions.length}
              </span>
              <span className="text-xs text-slate-400">
                {currentQuestion.subject} · {currentQuestion.topic}
              </span>
              <span className="text-xs font-medium text-indigo-400">
                · {currentQuestion.pyqTag}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="tabular-nums text-slate-400">
                <strong className="text-emerald-400">+{marksPerCorrect}</strong>
                {' / '}
                <strong className={negativeMarking > 0 ? 'text-rose-400' : 'text-slate-400'}>
                  {negativeMarking > 0 ? `-${negativeMarking}` : '0'}
                </strong>
              </span>

              {/* Phase 7: Per-Question Translate Button */}
              <div className="relative flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleTranslateQuestion(currentQuestion)}
                  disabled={translatingQuestionId === currentQuestion.id}
                  className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                    isShowingCurrentTranslation
                      ? 'border-indigo-500 bg-indigo-600 text-white'
                      : isDark
                      ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20'
                      : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                  }`}
                  title="Translate this question into your preferred language"
                >
                  <Languages className="h-3.5 w-3.5" />
                  <span>
                    {translatingQuestionId === currentQuestion.id
                      ? 'Translating...'
                      : isShowingCurrentTranslation
                      ? `Original (${currentTranslation?.lang.toUpperCase()})`
                      : `Translate (${
                          TRANSLATION_LANGUAGES.find((l) => l.id === targetTranslateLang)?.native ||
                          'हिन्दी'
                        })`}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowTranslateSelector((prev) => !prev)}
                  className={`inline-flex min-h-[38px] items-center justify-center rounded-xl border px-2 text-xs font-semibold transition ${
                    isDark
                      ? 'border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                  title="Choose Translation Language"
                >
                  <Globe className="h-3.5 w-3.5" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => onToggleBookmarkQuestion(currentQuestion.id)}
                className={`inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-xl border transition ${
                  isCurrentBookmarked
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-400'
                    : isDark
                    ? 'border-white/10 text-slate-400 hover:bg-white/5'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
                title="Bookmark Question"
              >
                {isCurrentBookmarked ? (
                  <BookmarkCheck className="h-4 w-4" />
                ) : (
                  <Bookmark className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Language Picker Bar for Per-Question Translation (Phase 7) */}
          {showTranslateSelector && (
            <div
              className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2.5 ${
                isDark ? 'border-indigo-500/30 bg-[#111827]' : 'border-indigo-200 bg-indigo-50/70'
              }`}
            >
              <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-400">
                Translate Question To:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {TRANSLATION_LANGUAGES.map((langItem) => (
                  <button
                    key={langItem.id}
                    type="button"
                    onClick={() => {
                      setShowTranslateSelector(false);
                      handleTranslateQuestion(currentQuestion, langItem.id);
                    }}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      targetTranslateLang === langItem.id
                        ? 'bg-indigo-600 text-white'
                        : isDark
                        ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                        : 'bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {langItem.native} ({langItem.label})
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Translation Error Retry Bar */}
          {currentTranslateError && (
            <div className="mt-3 flex items-center justify-between rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs text-rose-300">
              <span>{currentTranslateError}</span>
              <button
                type="button"
                onClick={() => handleTranslateQuestion(currentQuestion, targetTranslateLang)}
                className="inline-flex items-center gap-1 font-bold underline"
              >
                <RefreshCw className="h-3 w-3" /> Retry
              </button>
            </div>
          )}

          {/* Question Statement */}
          <div className="reading-prose mt-5 space-y-2.5">
            {isShowingCurrentTranslation && currentTranslation ? (
              <div
                className={`rounded-2xl border p-4 ${
                  isDark
                    ? 'border-indigo-500/40 bg-indigo-500/[0.08]'
                    : 'border-indigo-200 bg-indigo-50/70'
                }`}
              >
                <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-indigo-400">
                  <span>
                    Translated View (
                    {TRANSLATION_LANGUAGES.find((l) => l.id === currentTranslation.lang)?.native ||
                      currentTranslation.lang.toUpperCase()}
                    )
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setShowTranslatedView((prev) => ({
                        ...prev,
                        [currentQuestion.id]: false,
                      }))
                    }
                    className="underline"
                  >
                    Switch to Original
                  </button>
                </div>
                <p className="text-base font-semibold leading-relaxed sm:text-lg">
                  {currentTranslation.questionText}
                </p>
              </div>
            ) : (
              <>
                {(language === 'en' || language === 'bilingual') && (
                  <p className="text-base font-semibold leading-relaxed sm:text-lg">
                    {currentQuestion.question_en}
                  </p>
                )}
                {(language === 'hi' || language === 'bilingual') && (
                  <p
                    className={`text-base leading-relaxed sm:text-lg ${
                      language === 'bilingual'
                        ? isDark
                          ? 'text-slate-300'
                          : 'text-slate-600'
                        : 'font-semibold'
                    }`}
                  >
                    {currentQuestion.question_hi}
                  </p>
                )}
              </>
            )}
          </div>

          {/* 4 Option Cards (48px+ comfortable touch targets) */}
          <div className="mt-6 space-y-3">
            {currentQuestion.options_en.map((optEn, idx) => {
              const optHi = currentQuestion.options_hi[idx] || optEn;
              const translatedOptionText =
                isShowingCurrentTranslation && currentTranslation?.options?.[idx]
                  ? currentTranslation.options[idx]
                  : null;
              const isSelected = selectedOpt === idx;
              const isCorrectOption = idx === currentQuestion.correctIndex;

              let cardStyle = isDark
                ? 'border-white/10 bg-[#111827] hover:border-white/25'
                : 'border-slate-200 bg-white hover:border-slate-300';

              if (showInstantFeedback) {
                if (isCorrectOption) {
                  cardStyle = 'border-emerald-500 bg-emerald-500/10';
                } else if (isSelected && !isCorrectOption) {
                  cardStyle = 'border-rose-500 bg-rose-500/10';
                }
              } else if (isSelected) {
                cardStyle = 'border-indigo-500 bg-indigo-500/15 ring-1 ring-indigo-500';
              }

              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectOption(idx)}
                  className={`flex min-h-[56px] w-full items-start gap-3.5 rounded-2xl border p-4 text-left transition ${cardStyle}`}
                >
                  <span
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                      showInstantFeedback && isCorrectOption
                        ? 'bg-emerald-500 text-slate-950'
                        : showInstantFeedback && isSelected && !isCorrectOption
                        ? 'bg-rose-500 text-white'
                        : isSelected
                        ? 'bg-indigo-600 text-white'
                        : isDark
                        ? 'bg-white/10 text-slate-300'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {String.fromCharCode(65 + idx)}
                  </span>

                  <div className="flex-1 space-y-1 text-sm sm:text-base">
                    {translatedOptionText ? (
                      <>
                        <p className="font-medium leading-snug">{translatedOptionText}</p>
                        <p className="text-xs opacity-70">{optEn}</p>
                      </>
                    ) : (
                      <>
                        {(language === 'en' || language === 'bilingual') && (
                          <p className="font-medium leading-snug">{optEn}</p>
                        )}
                        {(language === 'hi' || language === 'bilingual') && (
                          <p
                            className={`leading-snug ${
                              language === 'bilingual'
                                ? 'text-xs sm:text-sm opacity-85'
                                : 'font-medium'
                            }`}
                          >
                            {optHi}
                          </p>
                        )}
                      </>
                    )}
                  </div>

                  {showInstantFeedback && isCorrectOption && (
                    <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-emerald-400" />
                  )}
                  {showInstantFeedback && isSelected && !isCorrectOption && (
                    <XCircle className="mt-1 h-5 w-5 shrink-0 text-rose-400" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Instant Practice Mode Dual Explanation */}
          {showInstantFeedback && (
            <div
              className={`mt-6 rounded-2xl border p-4 sm:p-5 ${
                isDark ? 'surface-card-dark' : 'surface-card-light'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 border-white/10">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">
                  Dual-Method Solution
                </span>
                <div className="flex gap-1.5">
                  {(
                    [
                      { id: 'both', label: 'Both Methods' },
                      { id: 'basic', label: 'Basic Concept' },
                      { id: 'trick', label: '15s Exam Trick' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setExplanationTab(t.id)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                        explanationTab === t.id
                          ? 'bg-indigo-600 text-white'
                          : isDark
                          ? 'bg-white/5 text-slate-300'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3.5 space-y-3">
                {isShowingCurrentTranslation && currentTranslation?.explanation && (
                  <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3.5 text-xs leading-relaxed sm:text-sm">
                    <p className="font-bold text-indigo-400">
                      Translated Explanation ({currentTranslation.lang.toUpperCase()})
                    </p>
                    <p className="mt-1">{currentTranslation.explanation}</p>
                  </div>
                )}

                {(explanationTab === 'both' || explanationTab === 'basic') && (
                  <div
                    className={`rounded-xl border p-3.5 ${
                      isDark ? 'border-white/10 bg-white/[0.02]' : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <p className="text-xs font-bold text-indigo-400">Method 1: Basic Concept</p>
                    {(language === 'en' || language === 'bilingual') && (
                      <p className="mt-1 text-xs leading-relaxed sm:text-sm">
                        {currentQuestion.basic_en}
                      </p>
                    )}
                    {(language === 'hi' || language === 'bilingual') && (
                      <p className="mt-1 text-xs leading-relaxed text-slate-400">
                        {currentQuestion.basic_hi}
                      </p>
                    )}
                  </div>
                )}

                {(explanationTab === 'both' || explanationTab === 'trick') && (
                  <div
                    className={`rounded-xl border p-3.5 ${
                      isDark
                        ? 'border-emerald-500/30 bg-emerald-500/[0.06]'
                        : 'border-emerald-200 bg-emerald-50/70'
                    }`}
                  >
                    <p className="text-xs font-bold text-emerald-400">
                      Method 2: 15-Second Exam Trick
                    </p>
                    {(language === 'en' || language === 'bilingual') && (
                      <p className="mt-1 text-xs leading-relaxed sm:text-sm">
                        {currentQuestion.trick_en}
                      </p>
                    )}
                    {(language === 'hi' || language === 'bilingual') && (
                      <p className="mt-1 text-xs leading-relaxed text-slate-400">
                        {currentQuestion.trick_hi}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      )}

      {/* Sticky Bottom Test Controls */}
      <footer
        className={`sticky bottom-0 z-20 border-t px-3 py-3 sm:px-6 ${
          isDark ? 'liquid-glass-dark' : 'liquid-glass-light'
        }`}
      >
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2">
          {/* Secondary Actions: Mark for Review & Clear Response */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleToggleReview}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                isCurrentMarked
                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                  : isDark
                  ? 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/10'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Flag className="h-3.5 w-3.5" />
              <span>{isCurrentMarked ? 'Marked' : 'Review'}</span>
            </button>

            <button
              type="button"
              onClick={handleClearResponse}
              disabled={!isCurrentAnswered}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition disabled:opacity-40 ${
                isDark
                  ? 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/10'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              Clear
            </button>
          </div>

          {/* Primary Navigation: Previous, Next, Submit */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
              disabled={currentIndex === 0}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition disabled:opacity-40 ${
                isDark
                  ? 'border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/10'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              <ArrowLeft className="h-4 w-4" />
              Prev
            </button>

            {currentIndex < questions.length - 1 ? (
              <button
                type="button"
                onClick={() => setCurrentIndex((prev) => Math.min(questions.length - 1, prev + 1))}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500 sm:text-sm"
              >
                Save & Next
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => setShowSubmitConfirm(true)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 sm:text-sm"
            >
              Submit Test
            </button>
          </div>
        </div>
      </footer>

      {/* ==========================================================================
          QUESTION PALETTE DRAWER (Accessible Legend + Jump to Any Question)
         ========================================================================== */}
      {showPaletteDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm">
          <div
            className={`flex h-full w-full max-w-sm flex-col justify-between p-5 ${
              isDark ? 'bg-[#0F172A] text-slate-100' : 'bg-white text-slate-900'
            }`}
          >
            <div className="overflow-y-auto">
              <div className="flex items-center justify-between border-b pb-3.5 border-white/10">
                <div>
                  <h3 className="text-base font-bold">Question Palette</h3>
                  <p className="text-xs text-slate-400">Tap any number to jump directly</p>
                </div>
                <button
                  onClick={() => setShowPaletteDrawer(false)}
                  className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-white/10"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Accessible Status Legend (Icons + Labels + Colors) */}
              <div className="mt-4 grid grid-cols-2 gap-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-600 text-[11px] font-bold text-white">
                    ✓
                  </span>
                  <span>Answered ({paletteStats.answered})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg border-2 border-amber-500 text-[11px] font-bold text-amber-400">
                    !
                  </span>
                  <span>Not Answered ({paletteStats.visitedUnanswered})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg border-2 border-indigo-400 bg-indigo-500/20 text-[11px] font-bold text-indigo-300">
                    ⚑
                  </span>
                  <span>Marked ({paletteStats.marked})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-lg border text-[11px] ${
                      isDark ? 'border-white/15 text-slate-400' : 'border-slate-300 text-slate-500'
                    }`}
                  >
                    -
                  </span>
                  <span>Not Visited ({paletteStats.notVisited})</span>
                </div>
              </div>

              {/* Number Grid */}
              <div className="mt-5 grid grid-cols-5 gap-2.5">
                {questions.map((q, idx) => {
                  const ans = userAnswers[q.id];
                  const isAnswered = ans !== undefined && ans !== null;
                  const isMarked = Boolean(markedForReview[q.id]);
                  const isVisited = Boolean(visitedQuestions[q.id]);
                  const isCurrent = idx === currentIndex;

                  let btnClass = isDark
                    ? 'border-white/15 bg-white/[0.03] text-slate-300'
                    : 'border-slate-200 bg-slate-50 text-slate-700';

                  if (isAnswered) {
                    btnClass = 'border-emerald-500 bg-emerald-600 text-white';
                  } else if (isMarked) {
                    btnClass = 'border-indigo-400 bg-indigo-500/25 text-indigo-200';
                  } else if (isVisited) {
                    btnClass = 'border-amber-500/70 bg-amber-500/10 text-amber-300';
                  }

                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => {
                        setCurrentIndex(idx);
                        setShowPaletteDrawer(false);
                      }}
                      className={`relative flex h-11 w-full items-center justify-center rounded-xl border text-xs font-bold tabular-nums transition ${btnClass} ${
                        isCurrent ? 'ring-2 ring-indigo-400 ring-offset-2 ring-offset-slate-900' : ''
                      }`}
                    >
                      {idx + 1}
                      {isMarked && (
                        <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-400" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-t pt-4 border-white/10">
              <button
                type="button"
                onClick={() => {
                  setShowPaletteDrawer(false);
                  setShowSubmitConfirm(true);
                }}
                className="min-h-[48px] w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-500"
              >
                Review & Submit Test
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================================================
          SUBMISSION CONFIRMATION DIALOG (Prevents Accidental or Duplicate Submit)
         ========================================================================== */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div
            className={`w-full max-w-md rounded-2xl p-6 ${
              isDark ? 'surface-card-dark text-slate-100' : 'surface-card-light text-slate-900'
            }`}
          >
            <h3 className="text-lg font-bold">Submit Test?</h3>
            <p className="mt-1 text-xs text-slate-400">
              Please review your attempt summary before final submission.
            </p>

            <div className="mt-4 grid grid-cols-3 gap-2.5 text-center">
              <div
                className={`rounded-xl border p-3 ${
                  isDark ? 'border-white/10 bg-white/[0.03]' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <p className="text-xs text-slate-400">Answered</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-emerald-400">
                  {paletteStats.answered}
                </p>
              </div>
              <div
                className={`rounded-xl border p-3 ${
                  isDark ? 'border-white/10 bg-white/[0.03]' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <p className="text-xs text-slate-400">Unanswered</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-amber-400">
                  {paletteStats.unanswered}
                </p>
              </div>
              <div
                className={`rounded-xl border p-3 ${
                  isDark ? 'border-white/10 bg-white/[0.03]' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <p className="text-xs text-slate-400">For Review</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-indigo-400">
                  {paletteStats.marked}
                </p>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setShowSubmitConfirm(false)}
                className={`min-h-[46px] flex-1 rounded-xl border px-4 py-2.5 text-xs font-semibold sm:text-sm ${
                  isDark
                    ? 'border-white/15 text-slate-200 hover:bg-white/5'
                    : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                Return to Test
              </button>
              <button
                type="button"
                onClick={finalizeSubmission}
                className="min-h-[46px] flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 sm:text-sm"
              >
                Confirm & Submit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================================================
          EXIT TEST CONFIRMATION DIALOG
         ========================================================================== */}
      {showExitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div
            className={`w-full max-w-md rounded-2xl p-6 ${
              isDark ? 'surface-card-dark text-slate-100' : 'surface-card-light text-slate-900'
            }`}
          >
            <h3 className="text-lg font-bold">Leave Active Test?</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Leaving now will discard your current unsubmitted attempt. You can also submit now to save your score.
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => setShowExitConfirm(false)}
                className={`min-h-[44px] flex-1 rounded-xl border px-4 py-2 text-xs font-semibold ${
                  isDark ? 'border-white/15 text-slate-200' : 'border-slate-300 text-slate-700'
                }`}
              >
                Continue Test
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowExitConfirm(false);
                  finalizeSubmission();
                }}
                className="min-h-[44px] flex-1 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500"
              >
                Submit & Save
              </button>
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] w-full rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500 sm:w-auto"
              >
                Discard & Exit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
