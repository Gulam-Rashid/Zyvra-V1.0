import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Lock,
  Minus,
  Plus,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { LanguageMode, StudyNote } from '../types/database';

interface PDFReaderModalProps {
  note: StudyNote;
  theme: 'dark' | 'light';
  language: LanguageMode;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  onClose: () => void;
}

export const PDFReaderModal: React.FC<PDFReaderModalProps> = ({
  note,
  theme,
  language,
  isBookmarked,
  onToggleBookmark,
  onClose,
}) => {
  const isDark = theme === 'dark';
  const [readLang, setReadLang] = useState<LanguageMode>(language);
  const [zoom, setZoom] = useState(100);
  const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg'>('base');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');

  const totalPages = Math.max(1, note.pageCount || 1);

  const pages = useMemo(() => {
    const rawEn = (note.content_en || '').split(/\n---\n|\n\n(?=\d+\.)/g);
    const rawHi = (note.content_hi || note.content_en || '').split(/\n---\n|\n\n(?=\d+\.)/g);
    const count = Math.max(totalPages, rawEn.length, rawHi.length);
    const result: Array<{ en: string; hi: string }> = [];
    for (let i = 0; i < count; i++) {
      result.push({
        en: rawEn[i] || note.content_en || '',
        hi: rawHi[i] || note.content_hi || note.content_en || '',
      });
    }
    return result;
  }, [note, totalPages]);

  const activePage = pages[Math.min(currentPage - 1, pages.length - 1)] || {
    en: note.content_en,
    hi: note.content_hi,
  };

  const handleDownload = () => {
    if (!note.allowDownload) return;
    if (note.pdfUrl && note.pdfUrl.startsWith('data:application/pdf')) {
      const a = document.createElement('a');
      a.href = note.pdfUrl;
      a.download = `${note.title_en.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
      a.click();
      return;
    }
    const textBlob = new Blob(
      [
        `${note.title_en}\n${note.title_hi}\nSubject: ${note.subject} | Topic: ${note.topic}\n\n${note.content_en}\n\n${note.content_hi}`,
      ],
      { type: 'text/plain;charset=utf-8' }
    );
    const url = URL.createObjectURL(textBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${note.title_en.replace(/[^a-zA-Z0-9_-]/g, '_')}_Notes.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fontSizeClass =
    fontSize === 'sm'
      ? 'text-sm leading-relaxed'
      : fontSize === 'lg'
      ? 'text-lg leading-loose'
      : 'text-base leading-relaxed';

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col ${
        isDark ? 'bg-[#0A0E17] text-slate-100' : 'bg-[#F8FAFC] text-slate-900'
      }`}
    >
      {/* Top Reader Bar */}
      <header
        className={`sticky top-0 z-20 border-b px-4 py-3 ${
          isDark ? 'liquid-glass-dark' : 'liquid-glass-light'
        }`}
      >
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              onClick={onClose}
              className={`inline-flex min-h-[42px] min-w-[42px] items-center justify-center rounded-xl border transition ${
                isDark
                  ? 'border-white/10 text-slate-300 hover:bg-white/5'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
              title="Back to Study Hub"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-indigo-400">
                {note.exam || 'All Exams'} · {note.subject} · {note.topic}
              </p>
              <h1 className="truncate text-sm font-bold sm:text-base">
                {readLang === 'hi' ? note.title_hi : note.title_en}
              </h1>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Language Toggle */}
            <button
              onClick={() =>
                setReadLang((prev) =>
                  prev === 'bilingual' ? 'en' : prev === 'en' ? 'hi' : 'bilingual'
                )
              }
              className={`min-h-[40px] rounded-xl border px-3 py-1.5 text-xs font-bold ${
                isDark
                  ? 'border-white/15 bg-white/5 text-slate-200'
                  : 'border-slate-200 bg-white text-slate-800'
              }`}
            >
              अ/A · {readLang === 'bilingual' ? 'Bi' : readLang.toUpperCase()}
            </button>

            {/* Bookmark */}
            <button
              onClick={onToggleBookmark}
              className={`inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border transition ${
                isBookmarked
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-400'
                  : isDark
                  ? 'border-white/15 text-slate-300 hover:bg-white/5'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
              title="Bookmark Study Note"
            >
              {isBookmarked ? (
                <BookmarkCheck className="h-4 w-4" />
              ) : (
                <Bookmark className="h-4 w-4" />
              )}
            </button>

            {/* Download or Protected Indicator */}
            {note.allowDownload ? (
              <button
                onClick={handleDownload}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Download</span>
              </button>
            ) : (
              <span
                className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium ${
                  isDark
                    ? 'border-white/10 bg-white/[0.03] text-slate-400'
                    : 'border-slate-200 bg-slate-100 text-slate-600'
                }`}
                title="View-Only Protected Document"
              >
                <Lock className="h-3.5 w-3.5 text-amber-400" />
                <span className="hidden sm:inline">View-Only</span>
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Secondary Reading Toolbar (Search + Font Size / Zoom) */}
      <div
        className={`border-b px-4 py-2.5 ${
          isDark ? 'border-white/10 bg-[#0F172A]' : 'border-slate-200 bg-white'
        }`}
      >
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2">
          <div className="relative min-w-[200px] flex-1 max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Find keyword in notes..."
              className={`w-full rounded-xl border py-1.5 pl-8 pr-3 text-xs outline-none ${
                isDark
                  ? 'border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500'
                  : 'border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400'
              }`}
            />
          </div>

          <div className="flex items-center gap-2">
            {/* Font size toggle */}
            <div
              className={`inline-flex items-center rounded-xl border p-0.5 ${
                isDark ? 'border-white/10 bg-white/[0.03]' : 'border-slate-200 bg-slate-100'
              }`}
            >
              {(
                [
                  { id: 'sm', label: 'A-' },
                  { id: 'base', label: 'A' },
                  { id: 'lg', label: 'A+' },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setFontSize(s.id)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                    fontSize === s.id
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {note.type === 'pdf' && (
              <div className="hidden items-center gap-1 sm:flex">
                <button
                  onClick={() => setZoom((z) => Math.max(80, z - 10))}
                  className="rounded-lg border border-white/10 p-1.5 text-slate-400 hover:text-white"
                  title="Zoom Out"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <span className="w-11 text-center text-xs font-semibold tabular-nums">
                  {zoom}%
                </span>
                <button
                  onClick={() => setZoom((z) => Math.min(150, z + 10))}
                  className="rounded-lg border border-white/10 p-1.5 text-slate-400 hover:text-white"
                  title="Zoom In"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Reader Surface */}
      <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
        {note.pdfUrl && note.pdfUrl.startsWith('data:application/pdf') ? (
          <iframe
            src={note.pdfUrl}
            title={note.title_en}
            className="h-[72vh] w-full rounded-2xl border border-white/10 bg-white"
          />
        ) : (
          <article
            style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
            className={`rounded-2xl p-6 sm:p-8 transition ${
              isDark ? 'surface-card-dark' : 'surface-card-light'
            }`}
          >
            {/* Document Metadata Header */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-2 border-b pb-4 border-white/10">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <FileText className="h-4 w-4 text-indigo-400" />
                <span>{note.type === 'pdf' ? 'Official Study PDF Sheet' : 'Revision Notes'}</span>
                <span>·</span>
                <span>Updated {note.updatedAt}</span>
              </div>
              {pages.length > 1 && (
                <span className="text-xs font-semibold text-indigo-400 tabular-nums">
                  Page {currentPage} of {pages.length}
                </span>
              )}
            </div>

            {searchQuery.trim() && (() => {
              const q = searchQuery.trim().toLowerCase();
              const hayEn =
                readLang === 'en' || readLang === 'bilingual' ? activePage.en.toLowerCase() : '';
              const hayHi =
                readLang === 'hi' || readLang === 'bilingual' ? activePage.hi.toLowerCase() : '';
              const countMatches = (str: string) => {
                if (!str || !q) return 0;
                let idx = 0;
                let c = 0;
                while ((idx = str.indexOf(q, idx)) !== -1) {
                  c += 1;
                  idx += q.length;
                }
                return c;
              };
              const totalMatches = countMatches(hayEn) + countMatches(hayHi);
              return (
                <div className="mb-4 flex items-center justify-between rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-2 text-xs text-indigo-300">
                  <span>
                    Showing matches for <strong>"{searchQuery}"</strong>
                  </span>
                  <span className="font-bold tabular-nums">
                    {totalMatches} {totalMatches === 1 ? 'match' : 'matches'} on this page
                  </span>
                </div>
              );
            })()}

            {/* English Section */}
            {(readLang === 'en' || readLang === 'bilingual') && (
              <div className={`reading-prose whitespace-pre-line ${fontSizeClass}`}>
                {searchQuery.trim()
                  ? activePage.en
                      .split(
                        new RegExp(
                          `(${searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`,
                          'gi'
                        )
                      )
                      .map((part, idx) =>
                        part.toLowerCase() === searchQuery.trim().toLowerCase() ? (
                          <mark
                            key={idx}
                            className="rounded bg-amber-400/30 px-1 font-semibold text-amber-200"
                          >
                            {part}
                          </mark>
                        ) : (
                          part
                        )
                      )
                  : activePage.en}
              </div>
            )}

            {/* Divider in Bilingual Mode */}
            {readLang === 'bilingual' && (
              <hr className="my-6 border-white/10" />
            )}

            {/* Hindi Section */}
            {(readLang === 'hi' || readLang === 'bilingual') && (
              <div
                className={`reading-prose whitespace-pre-line ${fontSizeClass} ${
                  readLang === 'bilingual'
                    ? isDark
                      ? 'text-slate-300'
                      : 'text-slate-700'
                    : ''
                }`}
              >
                {searchQuery.trim()
                  ? activePage.hi
                      .split(
                        new RegExp(
                          `(${searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`,
                          'gi'
                        )
                      )
                      .map((part, idx) =>
                        part.toLowerCase() === searchQuery.trim().toLowerCase() ? (
                          <mark
                            key={idx}
                            className="rounded bg-amber-400/30 px-1 font-semibold text-amber-200"
                          >
                            {part}
                          </mark>
                        ) : (
                          part
                        )
                      )
                  : activePage.hi}
              </div>
            )}
          </article>
        )}
      </main>

      {/* Bottom Pagination Bar for Multi-Page Notes/PDFs */}
      {pages.length > 1 && (
        <footer
          className={`sticky bottom-0 z-20 border-t px-4 py-3 ${
            isDark ? 'liquid-glass-dark' : 'liquid-glass-light'
          }`}
        >
          <div className="mx-auto flex max-w-3xl items-center justify-between">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className={`inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold disabled:opacity-40 ${
                isDark
                  ? 'border-white/10 bg-white/5 text-slate-200'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous Page
            </button>

            <span className="text-xs font-bold tabular-nums text-slate-400">
              Page {currentPage} / {pages.length}
            </span>

            <button
              onClick={() => setCurrentPage((p) => Math.min(pages.length, p + 1))}
              disabled={currentPage >= pages.length}
              className={`inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold disabled:opacity-40 ${
                isDark
                  ? 'border-white/10 bg-white/5 text-slate-200'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              Next Page
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </footer>
      )}
    </div>
  );
};
