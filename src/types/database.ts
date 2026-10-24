export type LanguageMode = 'en' | 'hi' | 'bilingual';

export type QuestionType =
  | 'mcq_single'
  | 'mcq_multi'
  | 'statement'
  | 'numerical'
  | 'descriptive';

export type QuestionSourceClassification =
  | 'verified_pyq'
  | 'memory_based_pyq'
  | 'model_practice'
  | 'ai_generated'
  | 'ai_practice'
  | 'custom_mock';

export type VerificationStatus =
  | 'verified'
  | 'memory_based'
  | 'model_reviewed'
  | 'ai_predicted';

export type StudyResourceType =
  | 'text'
  | 'pdf'
  | 'formula_sheet'
  | 'formula'
  | 'current_affairs'
  | 'syllabus'
  | 'answer_key'
  | 'flashcard_deck'
  | 'video_link'
  | 'audio_resource'
  | 'external_link';

export interface ExamFamily {
  id: string;
  code?: string;
  name: string;
  name_en?: string;
  name_hi: string;
  description: string;
  description_en?: string;
  description_hi?: string;
  icon: string;
  color: string;
  displayOrder: number;
  order?: number;
  isActive: boolean;
  active?: boolean;
  isArchived?: boolean;
  isPro?: boolean;
}

export interface ExamPaperConfig {
  id: string;
  name: string;
  name_hi?: string;
  durationMinutes: number;
  questionCount?: number;
  totalQuestions?: number;
  maxMarks: number;
  marksPerCorrect: number;
  negativeMarks?: number;
  negativeMarking?: number;
  marksPerUnanswered?: number;
  subjects: string[];
}

export interface ExamStageConfig {
  id: string;
  name: string;
  name_hi?: string;
  code?: string;
  order?: number;
  hasPapers?: boolean;
  papers: ExamPaperConfig[];
}

export interface ExamCategory {
  id: string;
  name: string;
  name_hi?: string;
  badge: string;
  isActive: boolean;
  active?: boolean;
  // Universal Upgrade 2.0 Fields
  shortCode?: string;
  code?: string;
  familyId?: string;
  stateOrAuthority?: string;
  conductingBody?: string;
  level?: 'Central' | 'State' | 'District' | 'Other';
  description?: string;
  icon?: string;
  themeColor?: string;
  languages?: LanguageMode[];
  bilingualSupported?: boolean;
  hasStages?: boolean;
  hasPapers?: boolean;
  stages?: ExamStageConfig[];
  subjects?: string[];
  syllabusOverview?: string;
  officialPatternRef?: string;
  marksPerCorrect?: number;
  negativeMarking?: number;
  marksPerUnanswered?: number;
  defaultDurationMinutes?: number;
  defaultQuestionCount?: number;
  maxMarks?: number;
  accessType?: 'free' | 'pro';
  isVisible?: boolean;
  isFeatured?: boolean;
  isPopular?: boolean;
  sortOrder?: number;
  order?: number;
}

export interface CustomFolder {
  id: string;
  name: string;
  name_en?: string;
  name_hi?: string;
  description_en?: string;
  description_hi?: string;
  type: 'test' | 'note';
  exam: string;
  examIds?: string[]; // Multi-exam mapping
  parentFolderId?: string;
  subject: string;
  icon: string;
  color: string;
  isPro: boolean;
  sortOrder?: number;
  order?: number;
}

export interface QuestionExamMapping {
  examFamilyId?: string;
  examId: string;
  examName?: string;
  stageId?: string;
  stage?: string;
  paperId?: string;
  paper?: string;
  subject?: string;
  chapter?: string;
  topic?: string;
  pyqTag?: string;
}

export interface Question {
  id: string;
  exam: string;
  tier?: string;
  stage?: string;
  stageId?: string;
  paper?: string;
  paperId?: string;
  folderId: string;
  category: 'pyq' | 'guess' | 'sectional' | 'topic';
  pyqTag: string;
  subject: string;
  chapter?: string;
  topic: string;
  difficulty: 'Easy' | 'Moderate' | 'Hard';
  isPro: boolean;
  questionType?: QuestionType;
  question_hi: string;
  question_en: string;
  options_hi: string[];
  options_en: string[];
  correctIndex: number;
  correctIndices?: number[];
  numericalAnswer?: string;
  basic_hi: string;
  basic_en: string;
  trick_hi: string;
  trick_en: string;
  // Universal Upgrade 2.0 Authenticity & Multi-Exam Mapping
  examFamilyId?: string;
  examMappings?: QuestionExamMapping[];
  sourceClassification?: QuestionSourceClassification;
  verificationStatus?: VerificationStatus;
  status?: 'draft' | 'published' | 'archived';
  pyqYear?: string;
  shiftReference?: string;
  fingerprint?: string;
  tags?: string[];
  marksCorrect?: number;
  marksPerCorrect?: number;
  marksWrong?: number;
  negativeMarks?: number;
  updatedAt?: string;
}

export interface StudyNote {
  id: string;
  title_hi: string;
  title_en: string;
  type: 'text' | 'pdf';
  resourceType?: StudyResourceType;
  examFamilyId?: string;
  exam?: string;
  examIds?: string[];
  stageOrPaper?: string;
  subject: string;
  chapter?: string;
  topic: string;
  folderId: string;
  content_hi: string;
  content_en: string;
  pdfUrl: string;
  pageCount: number;
  allowDownload: boolean;
  isPro: boolean;
  source?: string;
  verificationStatus?: VerificationStatus;
  updatedAt: string;
}

export interface Flashcard {
  id: string;
  exam?: string;
  examIds?: string[];
  subject: string;
  topic: string;
  front_hi: string;
  front_en: string;
  back_hi: string;
  back_en: string;
  trick_hi: string;
  trick_en: string;
  isPro?: boolean;
}

export interface OfferConfig {
  mrp: number;
  offerPrice: number;
  bannerHeadline_en: string;
  bannerHeadline_hi: string;
  bannerSubtext_en: string;
  upiId: string;
  merchantName: string;
  whatsappNumber: string;
  razorpayLink: string;
  countdownEndsAt: string;
  adminPin?: string;
  applicableExamIds?: string[]; // Empty or 'ALL' means Universal Pass
  passScope?: 'universal' | 'exam_pack';
}

export interface CouponCode {
  code: string;
  type: 'flat' | 'percent';
  value: number;
  affiliateTag: string;
  applicableExamId?: string;
  active: boolean;
  usageCount?: number;
}

export interface PYQTrendTopic {
  id: string;
  examId?: string; // e.g., 'SSC CGL', 'BPSC PCS', 'Bihar Daroga'
  exam?: string;
  stageOrPaper?: string;
  stage?: string;
  subject: string;
  topic_en: string;
  topic_hi: string;
  avgQuestionsPerShift: string | number;
  priority: 'High Priority' | 'Must Revise' | 'Trend Rising' | 'Moderate';
  shiftsAsked: number;
  weightagePercent: number;
  source?: string;
  sourceNote?: string;
  verificationStatus?: VerificationStatus;
  methodologyNote?: string;
  yearBreakdown: Record<string, number>;
}

export type PYQTrendRow = PYQTrendTopic;

export interface TestCustomizationRules {
  customizationAllowed: boolean;
  allowModeSwitch: boolean;
  allowTimerChange: boolean;
  allowQuestionCountChange: boolean;
  allowCategoryFilter: boolean;
  randomizeQuestions: boolean;
}

export interface DynamicCategoryNode {
  id: string;
  name?: string;
  name_en: string;
  name_hi: string;
  slug?: string;
  description?: string;
  parentId: string | null; // null = top-level category; non-null = subcategory (supports unlimited nesting)
  examId?: string; // 'ALL' or specific exam name/id
  subject?: string;
  order: number;
  status: 'active' | 'inactive' | 'archived';
  createdAt: string | number;
}

export interface StudentFeedbackItem {
  id: string;
  studentName: string;
  mobile?: string;
  mobileNumber?: string;
  deviceId: string;
  exam?: string;
  attemptId?: string;
  testId?: string;
  testAttemptId?: string;
  testTitle?: string;
  packTitle?: string;
  rating: number;
  category:
    | 'test_quality'
    | 'question_error'
    | 'ui_ux'
    | 'translation'
    | 'other'
    | 'overall_experience'
    | 'question_quality'
    | 'feature_request'
    | 'ui_bug';
  message: string;
  status: 'new' | 'unread' | 'reviewed' | 'resolved';
  adminResponse?: string;
  createdAt: string | number;
  updatedAt?: string | number;
}

export interface SupportTicketReply {
  id: string;
  senderRole?: 'student' | 'admin';
  authorRole?: 'student' | 'admin';
  senderName?: string;
  authorName?: string;
  message: string;
  createdAt?: string | number;
  timestamp?: string | number;
}

export interface SupportTicket {
  id: string;
  ticketCode?: string; // e.g. TKT-482910
  ticketNumber?: string;
  studentName: string;
  mobile?: string;
  mobileNumber?: string;
  deviceId: string;
  exam?: string;
  category:
    | 'payment_pro'
    | 'technical_bug'
    | 'technical'
    | 'content_doubt'
    | 'question_error'
    | 'account_sync'
    | 'other';
  priority?: 'low' | 'medium' | 'high';
  subject: string;
  message: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  createdAt: string | number;
  updatedAt: string | number;
  replies: SupportTicketReply[];
}

export interface SupportContactConfig {
  isConfigured?: boolean;
  supportEmail: string;
  helplineNumber: string;
  whatsappSupport: string;
  workingHours?: string;
  workingHours_en?: string;
  workingHours_hi?: string;
  supportAddress?: string;
  responseSlaEn?: string;
  responseSlaHi?: string;
  supportNotice_en?: string;
  supportNotice_hi?: string;
}

export interface ReferralPolicyConfig {
  enabled: boolean;
  commissionType: 'fixed' | 'percent';
  commissionValue: number;
  qualifyingEvent?: 'pro_pass_verified' | string;
  minPayoutThreshold: number;
  offerStartDate?: string;
  offerEndDate?: string;
  termsSummary?: string;
  terms_en?: string;
  terms_hi?: string;
}

export type CommissionStatus =
  | 'pending'
  | 'approved'
  | 'payable'
  | 'paid'
  | 'rejected'
  | 'reversed';

export interface ReferralCommissionRecord {
  id: string;
  referrerDeviceId: string;
  referrerCode?: string;
  referralCode?: string;
  referrerName: string;
  referrerMobile: string;
  refereeDeviceId?: string;
  referredDeviceId?: string;
  refereeName?: string;
  referredStudentName?: string;
  refereeMobile?: string;
  referredMobile?: string;
  saleId?: string;
  utrNumber: string;
  purchaseAmount?: number;
  orderAmount?: number;
  commissionType?: 'fixed' | 'percent';
  commissionRate?: number;
  commissionAmount: number;
  status: CommissionStatus;
  payoutMethod?: 'upi' | 'bank_manual';
  payoutUpiId?: string;
  payoutDetails?: string;
  payoutReference?: string;
  adminNote?: string;
  createdAt: string | number;
  updatedAt?: string | number;
}

export interface ReferralAttribution {
  id: string;
  referrerCode: string;
  referrerDeviceId: string;
  refereeDeviceId: string;
  refereeName: string;
  refereeMobile: string;
  status: 'attributed' | 'qualified' | 'invalid';
  createdAt: string | number;
}

export type OfferTemplateId =
  | 'royal_indigo'
  | 'emerald_scholar'
  | 'amber_festive'
  | 'crimson_urgent';

export interface PromotionalOfferItem {
  id: string;
  title?: string;
  title_en?: string;
  title_hi?: string;
  subtitle?: string;
  subtitle_en?: string;
  subtitle_hi?: string;
  description_en?: string;
  description_hi?: string;
  badgeText?: string;
  discountText?: string;
  ctaText?: string;
  priority?: number;
  templateId: OfferTemplateId;
  discountType?: 'flat' | 'percent';
  discountValue?: number;
  discountPercent?: number;
  originalPrice?: number;
  finalPrice?: number;
  couponCode?: string;
  bannerImageUrl?: string;
  validFrom: string;
  validUntil: string;
  targetExam?: string;
  targetDestination?: 'pro_modal' | 'tests' | 'practice' | 'study';
  isActive?: boolean;
  active?: boolean;
  createdAt?: string | number;
}

export interface TestSeriesPack {
  id: string;
  title_en: string;
  title_hi: string;
  examFamilyId?: string;
  exam: string;
  stageId?: string;
  paperId?: string;
  category: 'pyq' | 'guess' | 'sectional' | 'topic';
  categoryId?: string;
  subcategoryId?: string;
  subcategoryIds?: string[];
  dynamicCategoryId?: string;
  dynamicSubcategoryId?: string;
  folderId: string;
  subject: string;
  questionIds: string[];
  durationMinutes: number;
  marksPerCorrect?: number;
  negativeMarking: number;
  marksPerUnanswered?: number;
  shiftTag: string;
  sourceClassification?: QuestionSourceClassification;
  isPro: boolean;
  customizationRules?: TestCustomizationRules;
}

export interface StudentSaleLog {
  id: string;
  studentName: string;
  mobile: string;
  deviceId: string;
  utrNumber: string;
  amountPaid: number;
  couponUsed?: string;
  couponCode?: string;
  referredByCode?: string;
  referralCodeUsed?: string;
  paymentStatus?: 'verified' | 'refunded' | 'cancelled';
  proKey?: string;
  generatedProKey?: string;
  unlockedScope?: string;
  examScope?: string;
  createdAt?: string;
  activatedAt?: string;
}

export interface ImportBatchHistory {
  id: string;
  timestamp: string;
  examId?: string;
  targetExam?: string;
  sourceType?: 'json' | 'csv' | 'paste';
  subject?: string;
  addedQuestionIds: string[];
  addedNoteIds?: string[];
  skippedDuplicates: number;
  invalidRowsCount?: number;
  summary: string;
}

export interface SyncAuditLog {
  id: string;
  timestamp: string;
  action:
    | 'push'
    | 'pull'
    | 'migration'
    | 'backup'
    | 'push_github'
    | 'pull_github'
    | 'cloud_sync';
  status: 'success' | 'failed';
  summary: string;
  examsCount?: number;
  questionsCount?: number;
  notesCount?: number;
}

export interface MasterDatabase {
  schemaVersion: number;
  version: string;
  lastUpdated: string;
  examFamilies: ExamFamily[];
  exams: ExamCategory[];
  subjects: Record<string, string[]>;
  examSubjectsMap?: Record<string, string[]>;
  subtopicsMap?: Record<string, string[]>;
  dynamicCategories?: DynamicCategoryNode[];
  folders: CustomFolder[];
  pyqTrends: PYQTrendTopic[];
  trends?: PYQTrendTopic[];
  testSeries: TestSeriesPack[];
  questions: Question[];
  notes: StudyNote[];
  flashcards: Flashcard[];
  offers: OfferConfig;
  promotionalOffers?: PromotionalOfferItem[];
  coupons: CouponCode[];
  salesLog: StudentSaleLog[];
  salesLogs?: StudentSaleLog[];
  studentFeedback?: StudentFeedbackItem[];
  feedbackList?: StudentFeedbackItem[];
  supportTickets?: SupportTicket[];
  supportConfig?: SupportContactConfig;
  referralPolicy?: ReferralPolicyConfig;
  referralAttributions?: ReferralAttribution[];
  referralCommissions?: ReferralCommissionRecord[];
  importHistory?: ImportBatchHistory[];
  syncAuditLogs?: SyncAuditLog[];
}

export interface MistakeEntry {
  questionId: string;
  examId?: string;
  errorCount: number;
  lastReason: 'wrong' | 'skipped';
  updatedAt: string;
}

export interface TestAttemptRecord {
  id: string;
  attemptId?: string;
  testId?: string;
  packId?: string;
  packTitle?: string;
  testTitle: string;
  exam: string;
  stage?: string;
  paper?: string;
  stageOrPaper?: string;
  mode: 'practice' | 'exam_hall';
  date: string;
  timestamp?: number | string;
  totalQuestions: number;
  attempted: number;
  correct: number;
  wrong: number;
  skipped: number;
  marksPerCorrect?: number;
  score?: number;
  netScore: number;
  maxScore: number;
  totalMarks?: number;
  negativeMarking: number;
  accuracy: number;
  avgSecondsPerQuestion: number;
  normalizedScore: number | null;
  isOfficialSimulation?: boolean;
  isFixedTest?: boolean;
  questionIds: string[];
  userAnswers: Record<string, number | null>;
  timeTakenSeconds: number;
  customizationSnapshot?: {
    customizedByStudent: boolean;
    timerType: string;
    overallMinutes: number;
    questionCount: number;
  };
}

export interface StudentLocalState {
  studentName: string;
  mobileNumber: string;
  deviceId: string;
  referralCode?: string;
  referredByCode?: string;
  payoutUpiId?: string;
  isProUnlocked: boolean;
  unlockedExamIds?: string[];
  unlockedExamPacks?: string[];
  activatedProKey: string;
  activatedAt: string | null;
  recentlyPracticedExamIds?: string[];
  recentExamNames?: string[];
  activeExamId?: string;
  selectedExamName?: string;
  bookmarkedQuestionIds: string[];
  bookmarkedNoteIds: string[];
  masteredFlashcardIds: string[];
  mistakes: Record<string, MistakeEntry>;
  testHistory: TestAttemptRecord[];
  syncStatus?: 'synced' | 'pending' | 'failed';
  lastSyncedAt?: string;
  lastCloudSyncedAt?: string | null;
}

export interface GitHubSyncConfig {
  repo: string;
  branch: string;
  filePath: string;
  pat: string;
  lastSyncedAt: string | null;
}

export interface ActiveTestConfig {
  testId?: string;
  packId?: string;
  title: string;
  exam: string;
  stage?: string;
  paper?: string;
  stageOrPaper?: string;
  questions: Question[];
  mode: 'practice' | 'exam_hall';
  timerType: 'overall' | 'sprint' | 'none';
  overallMinutes: number;
  sprintSeconds: number;
  marksPerCorrect?: number;
  negativeMarking: number;
  marksPerUnanswered?: number;
  isOfficialSimulation?: boolean;
  customizationRules?: TestCustomizationRules;
}

