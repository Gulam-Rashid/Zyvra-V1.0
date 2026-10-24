const MASTER_SECRET_SALT = 'SSC_PRO_TCS_MASTER_SALT_2026_V9';
const DEVICE_TOKEN_STORAGE_KEY = 'ssc_prep_hardware_install_token_v1';
const ADMIN_SESSION_STORAGE_KEY = 'zyvra_admin_session_v1';
const ADMIN_CRED_STORAGE_KEY = 'zyvra_admin_cred_v2';
const ADMIN_LOCKOUT_STORAGE_KEY = 'zyvra_admin_lockout_v1';

/**
 * Generates or retrieves a persistent hardware signature component combined with
 * deterministic device properties (screen, cores, platform, canvas fingerprint).
 */
function getHardwareSignature(): string {
  if (typeof window === 'undefined') return 'SSR-NODE-SIG';

  let persistentToken = localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY);
  if (!persistentToken) {
    const screenSig = `${window.screen?.width || 1080}x${window.screen?.height || 2400}x${window.screen?.colorDepth || 24}`;
    const cores = navigator.hardwareConcurrency || 8;
    const platform = navigator.platform || 'AndroidArm64';
    const tz = Intl?.DateTimeFormat()?.resolvedOptions()?.timeZone || 'Asia/Kolkata';

    let canvasHash = 'CANVAS_STD';
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 120;
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.textBaseline = 'top';
        ctx.font = '13px monospace';
        ctx.fillStyle = '#6366f1';
        ctx.fillRect(4, 4, 50, 20);
        ctx.fillStyle = '#06b6d4';
        ctx.fillText('ZYVRA-LOCK-ID', 8, 8);
        canvasHash = canvas.toDataURL().slice(-32);
      }
    } catch {
      canvasHash = 'CANVAS_FALLBACK';
    }

    persistentToken = `${screenSig}|${cores}|${platform}|${tz}|${canvasHash}`;
    localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, persistentToken);
  }
  return persistentToken;
}

/**
 * Deterministic 32-bit FNV-1a + DJB2 hybrid hash
 */
export function computeDeterministicHash(input: string): number {
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

/**
 * Deterministically generates a unique Student Device ID formatted as `ZYV-XXXX-XXX`
 * e.g., `ZYV-8492-X7B`.
 * Re-installing on the same phone with the same mobile number regenerates the exact same Device ID.
 */
export function generateDeviceId(mobileNumber: string = ''): string {
  const cleanMobile = mobileNumber.replace(/\D/g, '').slice(-10) || '9999900000';
  const hwSig = getHardwareSignature();
  const payload = `SSC_DEVICE::${cleanMobile}::${hwSig}`;
  const hashNum = computeDeterministicHash(payload);

  const fourDigits = String((hashNum % 9000) + 1000);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const c1 = alphabet[(hashNum >>> 4) % alphabet.length];
  const c2 = String((hashNum >>> 8) % 10);
  const c3 = alphabet[(hashNum >>> 12) % alphabet.length];

  return `ZYV-${fourDigits}-${c1}${c2}${c3}`;
}

/**
 * Deterministic Salted Hash Algorithm shared between the App Verifier
 * and the Admin Key Generator:
 * Accepts `ZYV-XXXX-XXX`, `SSC-XXXX-XXX`, or `DEV-XXXX-XXX` for full backward compatibility.
 */
export function generateProKey(
  deviceId: string,
  secretMasterSalt: string = MASTER_SECRET_SALT
): string {
  const normalizedDevice = deviceId.trim().toUpperCase();
  if (
    (!normalizedDevice.startsWith('ZYV-') &&
      !normalizedDevice.startsWith('SSC-') &&
      !normalizedDevice.startsWith('DEV-')) ||
    normalizedDevice.length < 9
  ) {
    return '';
  }

  // Normalize prefix to core suffix so existing SSC-XXXX-XXX and ZYV-XXXX-XXX map deterministically
  const canonicalDevice = normalizedDevice.replace(/^(ZYV-|DEV-)/, 'SSC-');
  const raw = `${canonicalDevice}::${secretMasterSalt}::SSC_UNLOCK_2026`;
  const h1 = computeDeterministicHash(raw);
  const h2 = computeDeterministicHash(raw.split('').reverse().join('') + secretMasterSalt);

  const fourDigits = String((h1 % 9000) + 1000);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const s1 = alphabet[h2 % alphabet.length];
  const s2 = alphabet[(h1 >>> 6) % alphabet.length];
  const s3 = alphabet[(h2 >>> 11) % alphabet.length];

  return `PRO-${fourDigits}-${s1}${s2}${s3}`;
}

/**
 * Local Demo Device-Bound Pro Key Verification.
 * Note: In a static browser environment, this serves as a local deterrent;
 * true entitlement protection requires server-side verification via VITE_API_BASE_URL.
 */
export function verifyProKeyForDevice(
  currentDeviceId: string,
  enteredKey: string
): { valid: boolean; expectedKey: string; message: string } {
  const cleanEntered = enteredKey.trim().toUpperCase();
  const expectedKey = generateProKey(currentDeviceId);

  if (!cleanEntered || !cleanEntered.startsWith('PRO-') || cleanEntered.length !== 12) {
    return {
      valid: false,
      expectedKey,
      message: 'Please enter a valid 12-character Zyvra Activation Key formatted as PRO-XXXX-XXX.',
    };
  }

  if (cleanEntered === expectedKey) {
    return {
      valid: true,
      expectedKey,
      message:
        'Zyvra Pro Activated Successfully! All Competitive Exam PYQ Tests, Custom Test Builder & Study Notes are unlocked on this device.',
    };
  }

  return {
    valid: false,
    expectedKey,
    message:
      'Invalid Key! This Activation Key does not match your current Device ID.',
  };
}

// ============================================================================
// STUDENT REFERRAL CODE GENERATOR (Deterministic & Unique per Device ID)
// ============================================================================

export function generateReferralCode(deviceId: string): string {
  const clean = (deviceId || 'ZYV-1000-AAA').trim().toUpperCase();
  const h = computeDeterministicHash(`ZYVRA_REF_2026::${clean}`);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const c1 = alphabet[h % alphabet.length];
  const c2 = alphabet[(h >>> 5) % alphabet.length];
  const c3 = alphabet[(h >>> 10) % alphabet.length];
  const digits = String((h % 900) + 100);
  return `ZYVREF-${digits}${c1}${c2}${c3}`;
}

// ============================================================================
// ADMIN AUTHENTICATION & SESSION MANAGEMENT
// No hardcoded login IDs or passcodes are stored in frontend source code.
// ============================================================================

export interface AdminSession {
  loginId: string;
  mode: 'backend_jwt' | 'local_owner';
  token?: string;
  authenticatedAt: string;
  expiresAt: number;
}

interface StoredAdminCredentialRecord {
  version: 2;
  salt: string;
  loginIdHash: string;
  passcodeHash: string;
  updatedAt: string;
}

interface AdminLockoutState {
  failedAttempts: number;
  lockedUntil: number;
}

function generateRandomHexSalt(bytesLength = 16): string {
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const arr = new Uint8Array(bytesLength);
    window.crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Mobile-safe deterministic multi-round salted hash fallback when Web Crypto (`crypto.subtle`)
 * is unavailable on non-HTTPS mobile LAN IPs or custom Android WebView origins, while using
 * native SHA-256 whenever available.
 */
async function computeSha256Hex(message: string): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(message);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fall through to deterministic multi-round fallback
    }
  }
  const h1 = computeDeterministicHash(`R1::${message}`).toString(16).padStart(8, '0');
  const h2 = computeDeterministicHash(
    `R2::${message.split('').reverse().join('')}`
  )
    .toString(16)
    .padStart(8, '0');
  const h3 = computeDeterministicHash(`R3::${h1}::${message}::${h2}`)
    .toString(16)
    .padStart(8, '0');
  return `${h1}${h2}${h3}`;
}

export function getActiveAdminSession(): AdminSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw =
      sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY) ||
      localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminSession;
    if (!parsed || Date.now() > parsed.expiresAt) {
      sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
      localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveAdminSession(session: AdminSession): void {
  if (typeof window === 'undefined') return;
  const serialized = JSON.stringify(session);
  try {
    sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, serialized);
  } catch {
    // Ignore quota/security errors in restricted mobile webviews
  }
  try {
    localStorage.setItem(ADMIN_SESSION_STORAGE_KEY, serialized);
  } catch {
    // Ignore quota/security errors
  }
}

export function clearAdminSession(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
  } catch {
    // Ignore
  }
  try {
    localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

/**
 * Checks whether local owner credentials have been initialized on this browser.
 */
export function hasLocalAdminCredentials(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(ADMIN_CRED_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as StoredAdminCredentialRecord;
    return Boolean(parsed && parsed.salt && parsed.loginIdHash && parsed.passcodeHash);
  } catch {
    return false;
  }
}

/**
 * Returns remaining lockout seconds if failed login attempts exceeded threshold.
 */
export function getAdminLockoutRemainingSeconds(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = sessionStorage.getItem(ADMIN_LOCKOUT_STORAGE_KEY);
    if (!raw) return 0;
    const state = JSON.parse(raw) as AdminLockoutState;
    if (state.lockedUntil && Date.now() < state.lockedUntil) {
      return Math.ceil((state.lockedUntil - Date.now()) / 1000);
    }
    return 0;
  } catch {
    return 0;
  }
}

function recordFailedAdminAttempt(): { remainingBeforeLock: number; lockedSeconds: number } {
  if (typeof window === 'undefined') return { remainingBeforeLock: 5, lockedSeconds: 0 };
  try {
    const raw = sessionStorage.getItem(ADMIN_LOCKOUT_STORAGE_KEY);
    const current: AdminLockoutState = raw
      ? JSON.parse(raw)
      : { failedAttempts: 0, lockedUntil: 0 };
    const nextAttempts = (current.failedAttempts || 0) + 1;
    if (nextAttempts >= 5) {
      const lockedUntil = Date.now() + 60 * 1000;
      sessionStorage.setItem(
        ADMIN_LOCKOUT_STORAGE_KEY,
        JSON.stringify({ failedAttempts: 0, lockedUntil })
      );
      return { remainingBeforeLock: 0, lockedSeconds: 60 };
    }
    sessionStorage.setItem(
      ADMIN_LOCKOUT_STORAGE_KEY,
      JSON.stringify({ failedAttempts: nextAttempts, lockedUntil: 0 })
    );
    return { remainingBeforeLock: Math.max(0, 5 - nextAttempts), lockedSeconds: 0 };
  } catch {
    return { remainingBeforeLock: 3, lockedSeconds: 0 };
  }
}

function clearFailedAdminAttempts(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(ADMIN_LOCKOUT_STORAGE_KEY);
}

/**
 * Initializes or updates the local owner Admin Login ID and Passcode using salted SHA-256 hashing.
 */
export async function initializeOrUpdateLocalAdminCredentials(
  loginId: string,
  passcode: string
): Promise<{ ok: boolean; error?: string }> {
  if (typeof window === 'undefined') {
    return { ok: false, error: 'Browser storage unavailable.' };
  }
  const cleanId = loginId.trim();
  const cleanPass = passcode.trim();

  if (cleanId.length < 4) {
    return { ok: false, error: 'Admin Login ID must be at least 4 characters.' };
  }
  if (cleanPass.length < 6) {
    return { ok: false, error: 'Admin Passcode must be at least 6 characters.' };
  }

  const salt = generateRandomHexSalt(16);
  const loginIdHash = await computeSha256Hex(`ZYVRA_ID_V2::${salt}::${cleanId}`);
  const passcodeHash = await computeSha256Hex(`ZYVRA_PASS_V2::${salt}::${cleanPass}`);

  const record: StoredAdminCredentialRecord = {
    version: 2,
    salt,
    loginIdHash,
    passcodeHash,
    updatedAt: new Date().toISOString(),
  };

  localStorage.setItem(ADMIN_CRED_STORAGE_KEY, JSON.stringify(record));
  clearFailedAdminAttempts();
  return { ok: true };
}

/**
 * Verifies entered Admin Login ID and Passcode against the stored salted SHA-256 hashes.
 */
export async function verifyLocalAdminCredentials(
  enteredLoginId: string,
  enteredPasscode: string
): Promise<{ ok: boolean; error?: string }> {
  const lockSec = getAdminLockoutRemainingSeconds();
  if (lockSec > 0) {
    return {
      ok: false,
      error: `Too many failed attempts. Please wait ${lockSec}s before trying again.`,
    };
  }

  const cleanId = enteredLoginId.trim();
  const cleanPass = enteredPasscode.trim();

  if (!cleanId || !cleanPass) {
    return {
      ok: false,
      error: 'Both Admin Login ID and Passcode are required.',
    };
  }

  if (typeof window === 'undefined') {
    return { ok: false, error: 'Window environment unavailable.' };
  }

  const raw = localStorage.getItem(ADMIN_CRED_STORAGE_KEY);
  if (!raw) {
    return {
      ok: false,
      error: 'Administrator credentials have not been initialized on this device yet.',
    };
  }

  try {
    const stored = JSON.parse(raw) as StoredAdminCredentialRecord;
    const candidateIdHash = await computeSha256Hex(`ZYVRA_ID_V2::${stored.salt}::${cleanId}`);
    const candidatePassHash = await computeSha256Hex(`ZYVRA_PASS_V2::${stored.salt}::${cleanPass}`);

    if (candidateIdHash === stored.loginIdHash && candidatePassHash === stored.passcodeHash) {
      clearFailedAdminAttempts();
      return { ok: true };
    }

    const attemptInfo = recordFailedAdminAttempt();
    if (attemptInfo.lockedSeconds > 0) {
      return {
        ok: false,
        error: `Invalid credentials. Account locked for ${attemptInfo.lockedSeconds} seconds due to repeated failed attempts.`,
      };
    }

    return {
      ok: false,
      error: `Invalid Administrator Login ID or Passcode (${attemptInfo.remainingBeforeLock} attempt${
        attemptInfo.remainingBeforeLock === 1 ? '' : 's'
      } remaining).`,
    };
  } catch {
    return {
      ok: false,
      error: 'Corrupted credential store. Use Owner Credential Reset to re-initialize.',
    };
  }
}

/**
 * Verifies repository write/admin ownership via GitHub REST API before allowing
 * an owner-controlled local Admin credential reset on static GitHub Pages deployments.
 */
export async function verifyGitHubRepoOwnershipForReset(
  repoFullName: string,
  githubPat: string
): Promise<{ ok: boolean; error?: string }> {
  const cleanRepo = repoFullName.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  const cleanPat = githubPat.trim();

  if (!cleanRepo || !cleanRepo.includes('/')) {
    return {
      ok: false,
      error: 'Enter your GitHub repository in owner/repo format (e.g., username/Zyvra-V1.0).',
    };
  }
  if (!cleanPat || cleanPat.length < 10) {
    return {
      ok: false,
      error: 'Enter a valid GitHub Personal Access Token (PAT) with repo access.',
    };
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${cleanRepo}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${cleanPat}`,
      },
    });

    if (!res.ok) {
      return {
        ok: false,
        error: `GitHub verification failed (HTTP ${res.status}). Check your repository name and PAT.`,
      };
    }

    const data = await res.json();
    const hasWriteAccess = Boolean(data?.permissions?.admin || data?.permissions?.push);
    if (!hasWriteAccess) {
      return {
        ok: false,
        error: 'The provided token does not have admin or push permissions for this repository.',
      };
    }

    return { ok: true };
  } catch {
    return {
      ok: false,
      error: 'Network error while contacting GitHub API. Check your internet connection.',
    };
  }
}
