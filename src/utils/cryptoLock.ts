const MASTER_SECRET_SALT = 'SSC_PRO_TCS_MASTER_SALT_2026_V9';
const DEVICE_TOKEN_STORAGE_KEY = 'ssc_prep_hardware_install_token_v1';
const ADMIN_SESSION_STORAGE_KEY = 'zyvra_admin_session_v1';
const ADMIN_CUSTOM_HASH_KEY = 'zyvra_admin_passcode_hash_v1';

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
// ADMIN AUTHENTICATION & SESSION MANAGEMENT (Login ID: Sajiya@8800)
// ============================================================================
export const DEFAULT_ADMIN_LOGIN_ID =
  (typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_ADMIN_LOGIN_ID) ||
  'Sajiya@8800';

export interface AdminSession {
  loginId: string;
  mode: 'backend_jwt' | 'local_demo';
  token?: string;
  authenticatedAt: string;
  expiresAt: number;
}

export function getActiveAdminSession(): AdminSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminSession;
    if (!parsed || Date.now() > parsed.expiresAt) {
      sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveAdminSession(session: AdminSession): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearAdminSession(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
}

export function setLocalAdminPasscode(newPasscode: string): void {
  if (typeof window === 'undefined') return;
  const hash = String(computeDeterministicHash(`ZYVRA_ADMIN_PASS::${newPasscode.trim()}`));
  localStorage.setItem(ADMIN_CUSTOM_HASH_KEY, hash);
}

export function verifyLocalAdminPasscode(
  enteredLoginId: string,
  enteredPasscode: string,
  fallbackDbPin: string = '2026'
): { ok: boolean; error?: string } {
  const cleanId = enteredLoginId.trim();
  const cleanPass = enteredPasscode.trim();

  if (cleanId !== DEFAULT_ADMIN_LOGIN_ID) {
    return {
      ok: false,
      error: 'Invalid Administrator Login ID. Access is restricted to authorized administrators.',
    };
  }

  if (!cleanPass) {
    return {
      ok: false,
      error: 'Please enter the Administrator Passcode.',
    };
  }

  const customHash =
    typeof window !== 'undefined' ? localStorage.getItem(ADMIN_CUSTOM_HASH_KEY) : null;
  const enteredHash = String(computeDeterministicHash(`ZYVRA_ADMIN_PASS::${cleanPass}`));

  if (customHash) {
    if (enteredHash === customHash) {
      return { ok: true };
    }
    return {
      ok: false,
      error: 'Incorrect Administrator Passcode.',
    };
  }

  if (cleanPass === fallbackDbPin) {
    return { ok: true };
  }

  return {
    ok: false,
    error: 'Incorrect Administrator Passcode.',
  };
}
