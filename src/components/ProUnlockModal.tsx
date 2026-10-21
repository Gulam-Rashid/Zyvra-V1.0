import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  KeyRound,
  Lock,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Tag,
  X,
} from 'lucide-react';
import { CouponCode, LanguageMode, OfferConfig, StudentLocalState } from '../types/database';
import { verifyProKeyForDevice } from '../utils/cryptoLock';

interface ProUnlockModalProps {
  offers: OfferConfig;
  coupons: CouponCode[];
  studentState: StudentLocalState;
  theme: 'dark' | 'light';
  language: LanguageMode;
  onUpdateMobile: (name: string, mobile: string) => void;
  onUnlockSuccess: (
    proKey: string,
    couponCode?: string,
    amountPaid?: number,
    utrNumber?: string
  ) => void;
  onClose: () => void;
}

export const ProUnlockModal: React.FC<ProUnlockModalProps> = ({
  offers,
  coupons,
  studentState,
  theme,
  onUpdateMobile,
  onUnlockSuccess,
  onClose,
}) => {
  const isDark = theme === 'dark';

  const [stepTab, setStepTab] = useState<'plans' | 'activate'>('plans');
  const [studentName, setStudentName] = useState(studentState.studentName || '');
  const [mobileNumber, setMobileNumber] = useState(studentState.mobileNumber || '');
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<CouponCode | null>(null);
  const [couponMessage, setCouponMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [utrNumber, setUtrNumber] = useState('');
  const [proKeyInput, setProKeyInput] = useState('');
  const [verifyMsg, setVerifyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copiedDevice, setCopiedDevice] = useState(false);

  const pricing = useMemo(() => {
    const base = offers.offerPrice || 99;
    const mrp = offers.mrp || 999;
    let discount = 0;
    if (appliedCoupon) {
      if (appliedCoupon.type === 'flat') {
        discount = appliedCoupon.value;
      } else {
        discount = Math.round((base * appliedCoupon.value) / 100);
      }
    }
    const finalPayable = Math.max(1, base - discount);
    return { mrp, base, discount, finalPayable };
  }, [offers, appliedCoupon]);

  const handleApplyCoupon = () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    const found = coupons.find((c) => c.active && c.code.toUpperCase() === code);
    if (!found) {
      setAppliedCoupon(null);
      setCouponMessage({ ok: false, text: 'Invalid or expired coupon code.' });
      return;
    }
    setAppliedCoupon(found);
    setCouponMessage({
      ok: true,
      text: `Coupon ${found.code} applied! Final payable: ₹${
        found.type === 'flat'
          ? Math.max(1, offers.offerPrice - found.value)
          : Math.max(1, offers.offerPrice - Math.round((offers.offerPrice * found.value) / 100))
      }`,
    });
  };

  const handleSaveIdentity = () => {
    const cleanPhone = mobileNumber.replace(/\D/g, '').slice(-10);
    if (cleanPhone.length < 10) {
      setVerifyMsg({ ok: false, text: 'Please enter a valid 10-digit mobile number.' });
      return;
    }
    onUpdateMobile(studentName.trim() || 'Aspirant', cleanPhone);
    setVerifyMsg({ ok: true, text: 'Device ID updated for your mobile number.' });
  };

  const handleCopyDeviceId = () => {
    navigator.clipboard?.writeText(studentState.deviceId);
    setCopiedDevice(true);
    setTimeout(() => setCopiedDevice(false), 2000);
  };

  const handleVerifyKey = () => {
    const result = verifyProKeyForDevice(studentState.deviceId, proKeyInput);
    if (!result.valid) {
      setVerifyMsg({ ok: false, text: result.message || 'Invalid Pro Key.' });
      return;
    }
    setVerifyMsg({ ok: true, text: 'Pro Key verified! All exams and tests unlocked.' });
    setTimeout(() => {
      onUnlockSuccess(
        proKeyInput.trim().toUpperCase(),
        appliedCoupon?.code || 'NONE',
        pricing.finalPayable,
        utrNumber.trim() || 'DIRECT-KEY'
      );
      onClose();
    }, 600);
  };

  const upiDeepLink = `upi://pay?pa=${encodeURIComponent(
    offers.upiId
  )}&pn=${encodeURIComponent(offers.merchantName)}&am=${pricing.finalPayable}&cu=INR`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm overflow-y-auto">
      <div
        className={`w-full max-w-lg rounded-2xl p-5 sm:p-6 ${
          isDark ? 'surface-card-dark text-slate-100' : 'surface-card-light text-slate-900'
        }`}
      >
        {/* Top Bar */}
        <div className="flex items-start justify-between gap-3 border-b pb-4 border-white/10">
          <div>
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-indigo-400">
              <Sparkles className="h-3.5 w-3.5" />
              Universal All-Exams Pro Pass
            </span>
            <h2 className="mt-1 text-lg font-bold sm:text-xl">{offers.bannerHeadline_en}</h2>
            <p className="mt-0.5 text-xs text-slate-400">{offers.bannerSubtext_en}</p>
          </div>
          <button
            onClick={onClose}
            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-white/10 text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode Switcher Tabs */}
        <div
          className={`mt-4 grid grid-cols-2 gap-1.5 rounded-xl p-1 ${
            isDark ? 'bg-white/[0.04]' : 'bg-slate-100'
          }`}
        >
          <button
            type="button"
            onClick={() => setStepTab('plans')}
            className={`min-h-[40px] rounded-lg text-xs font-bold transition ${
              stepTab === 'plans'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            1. Plan & Payment (₹{pricing.finalPayable})
          </button>
          <button
            type="button"
            onClick={() => setStepTab('activate')}
            className={`min-h-[40px] rounded-lg text-xs font-bold transition ${
              stepTab === 'activate'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            2. Enter Pro Activation Key
          </button>
        </div>

        {stepTab === 'plans' ? (
          <div className="mt-5 space-y-4">
            {/* Pricing Box */}
            <div
              className={`flex items-center justify-between rounded-xl border p-4 ${
                isDark ? 'border-indigo-500/30 bg-indigo-500/10' : 'border-indigo-200 bg-indigo-50'
              }`}
            >
              <div>
                <p className="text-xs font-semibold text-indigo-400">
                  1-Year Unlimited Access (All Central & State Exams)
                </p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-extrabold tabular-nums">
                    ₹{pricing.finalPayable}
                  </span>
                  <span className="text-xs text-slate-400 line-through tabular-nums">
                    ₹{pricing.mrp}
                  </span>
                  {pricing.discount > 0 && (
                    <span className="text-xs font-bold text-emerald-400">
                      Saved ₹{pricing.discount}
                    </span>
                  )}
                </div>
              </div>
              <ShieldCheck className="h-8 w-8 text-indigo-400" />
            </div>

            {/* What's Included vs Free */}
            <div
              className={`rounded-xl border p-3.5 text-xs ${
                isDark ? 'border-white/10 bg-white/[0.02]' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <p className="font-bold uppercase tracking-wider text-slate-400">
                Included in Pro Pass
              </p>
              <ul className="mt-2 space-y-1.5 text-slate-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  <span>All SSC, BPSC TRE, BPSC PCS, Bihar Daroga, Railway & UPSC PYQ Mocks</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  <span>Unlimited Custom Test Builder + Dual-Method 15-Second Tricks</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  <span>All Protected Study PDFs, Formula Sheets & Mistake Notebook Retests</span>
                </li>
              </ul>
            </div>

            {/* Coupon Code Input */}
            <div>
              <label className="block text-xs font-semibold text-slate-400">
                Have a Discount / Educator Coupon?
              </label>
              <div className="mt-1.5 flex gap-2">
                <div className="relative flex-1">
                  <Tag className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                    placeholder="e.g. SSC50 or SELECTION20"
                    className={`min-h-[42px] w-full rounded-xl border pl-8 pr-3 text-xs font-bold uppercase outline-none ${
                      isDark
                        ? 'border-white/10 bg-white/5 text-white'
                        : 'border-slate-200 bg-white text-slate-900'
                    }`}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleApplyCoupon}
                  className="min-h-[42px] rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white hover:bg-indigo-500"
                >
                  Apply
                </button>
              </div>
              {couponMessage && (
                <p
                  className={`mt-1.5 text-xs font-medium ${
                    couponMessage.ok ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {couponMessage.text}
                </p>
              )}
            </div>

            {/* Payment Actions */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <a
                href={upiDeepLink}
                className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500"
              >
                Pay ₹{pricing.finalPayable} via UPI App
              </a>
              <button
                type="button"
                onClick={() => setStepTab('activate')}
                className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-500"
              >
                <KeyRound className="h-4 w-4" />
                I Have a Pro Key
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {/* Step 1: Student Name & Mobile -> Device ID */}
            <div
              className={`rounded-xl border p-3.5 ${
                isDark ? 'border-white/10 bg-white/[0.02]' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <p className="text-xs font-bold text-slate-300">
                Step 1: Confirm Mobile & Copy Your Device Lock ID
              </p>
              <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  placeholder="Your Name"
                  className={`min-h-[40px] rounded-xl border px-3 text-xs outline-none ${
                    isDark
                      ? 'border-white/10 bg-white/5 text-white'
                      : 'border-slate-200 bg-white text-slate-900'
                  }`}
                />
                <div className="flex gap-1.5">
                  <input
                    type="tel"
                    value={mobileNumber}
                    onChange={(e) => setMobileNumber(e.target.value)}
                    placeholder="10-Digit Mobile"
                    className={`min-h-[40px] flex-1 rounded-xl border px-3 text-xs tabular-nums outline-none ${
                      isDark
                        ? 'border-white/10 bg-white/5 text-white'
                        : 'border-slate-200 bg-white text-slate-900'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={handleSaveIdentity}
                    className="rounded-xl bg-indigo-600 px-3 text-xs font-bold text-white"
                  >
                    Update
                  </button>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2">
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-indigo-300">
                    Your Hardware Device ID
                  </span>
                  <p className="font-mono text-xs font-bold text-white tabular-nums">
                    {studentState.deviceId}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyDeviceId}
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/20"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copiedDevice ? 'Copied' : 'Copy ID'}
                </button>
              </div>
            </div>

            {/* Step 2: Enter UTR & Pro Key */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-400">
                  Optional: 12-Digit UPI UTR / Reference No.
                </label>
                <input
                  type="text"
                  value={utrNumber}
                  onChange={(e) => setUtrNumber(e.target.value)}
                  placeholder="e.g. 429812349876"
                  className={`mt-1 min-h-[42px] w-full rounded-xl border px-3 text-xs font-mono outline-none ${
                    isDark
                      ? 'border-white/10 bg-white/5 text-white'
                      : 'border-slate-200 bg-white text-slate-900'
                  }`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400">
                  Enter Your Device-Bound Pro Activation Key
                </label>
                <input
                  type="text"
                  value={proKeyInput}
                  onChange={(e) => setProKeyInput(e.target.value.toUpperCase())}
                  placeholder="PRO-XXXX-XXXX-XXXX"
                  className={`mt-1 min-h-[44px] w-full rounded-xl border px-3 font-mono text-sm font-bold uppercase tracking-wider outline-none ${
                    isDark
                      ? 'border-indigo-500/40 bg-white/5 text-white'
                      : 'border-indigo-300 bg-white text-slate-900'
                  }`}
                />
                <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
                  <Lock className="h-3 w-3 text-amber-400" />
                  Anti-Piracy Note: A key generated for {studentState.deviceId} works exclusively on this device.
                </p>
              </div>

              {verifyMsg && (
                <div
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                    verifyMsg.ok
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                      : 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                  }`}
                >
                  {verifyMsg.text}
                </div>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={handleVerifyKey}
                  className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-500 sm:text-sm"
                >
                  <KeyRound className="h-4 w-4" />
                  Verify & Unlock Pro
                </button>
                <a
                  href={`https://wa.me/${offers.whatsappNumber}?text=${encodeURIComponent(
                    `Hello Admin! Please send my Pro Key.\nName: ${studentName}\nMobile: ${mobileNumber}\nDevice ID: ${studentState.deviceId}\nAmount: ₹${pricing.finalPayable}\nUTR: ${utrNumber || 'Paid'}`
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-[46px] items-center justify-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20"
                >
                  <MessageSquare className="h-4 w-4" />
                  Get Key on WhatsApp
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
