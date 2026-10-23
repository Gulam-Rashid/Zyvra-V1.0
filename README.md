# Zyvra — Universal Competitive Exam Preparation Platform

<p align="center">
  <img src="./public/zyvra-logo.svg" alt="Zyvra Logo" width="240" />
</p>

**Zyvra** is a modern, mobile-first, offline-capable **Universal Competitive Exam Preparation Platform (PWA)** engineered for students preparing for **SSC (CGL, CHSL, MTS, CPO, GD)**, **BPSC TRE**, **BPSC PCS**, **Bihar Daroga**, **Bihar SSC**, **Railway (NTPC, Group D, ALP)**, **UPSC**, and other dynamically configurable competitive examinations.

---

## 1. Key Features

### Student Experience
- **Dynamic Multi-Exam Architecture**: Switch seamlessly across Exam Categories, Exams, Stages/Papers, Subjects, and Chapters.
- **Full-Screen Distraction-Free Test Engine**:
  - Exam-wise Previous Year Question (PYQ) Mock Tests
  - Subject-wise & Chapter-wise Practice Mode
  - Custom Test Builder (filter by subject, chapter, difficulty, question count, and timer)
  - Question Palette (Answered, Unanswered, Marked for Review, Current)
  - Bilingual Support (English & Hindi toggle)
  - Dual-Method Explanations (**Basic Concept** + **15-Second Exam Trick**)
- **Revision & Study Hub**:
  - **Auto-Curated Mistake Notebook**: Automatically captures incorrect test responses for targeted re-practice.
  - **Saved Bookmarks**: Save important questions and filter by subject.
  - **Spaced-Repetition Flashcards**: Active recall cards for formulas, shortcuts, and high-yield facts.
  - **Rich Markdown Study Notes & In-App PDF Reader**: Read structured revision notes and PDF resources with search and zoom controls.
- **Performance Analytics**: Track overall accuracy, attempts, time per question, and subject-wise mastery.
- **Offline-First PWA**: Installable on Android, iOS, Windows, and macOS with service worker caching and offline status awareness.

### Admin Control Center
- **Dedicated Admin Login Screen**:
  - Configured Login ID: `King`
  - Supports local demo passcode configuration or optional backend JWT authentication via `VITE_API_BASE_URL`.
- **Full Content Management**:
  - Create, edit, enable/disable, and delete Exam Categories, Exams, Subjects, Chapters, Questions, Study Notes, PDFs, and Flashcards.
  - **Bulk Question Importer (JSON & CSV)** with downloadable sample templates (`/templates/sample-questions.json` and `/templates/sample-questions.csv`).
  - **Database Backup & Restore**: Export the complete platform database as JSON or restore from a JSON snapshot.
  - **GitHub Cloud Push**: Optional direct sync of `public/database.json` to your GitHub repository using a Personal Access Token (PAT) stored only in local memory/storage.

---

## 2. Deployment Architecture Decision

Zyvra uses **Option A (Static Frontend on GitHub Pages + Local Browser/PWA Storage)** by default, with built-in hooks for **Option B (External Backend API)**:

1. **Why Option A is the Default**:
   - Runs 100% free on **GitHub Pages** with zero server maintenance.
   - Pre-loads the comprehensive multi-exam dataset (`seedDatabase.ts` + optional `/public/database.json`) and persists user progress, bookmarks, mistakes, and admin customizations locally in `localStorage` and `IndexedDB`.
   - Uses relative asset paths (`base: './'`) and a `404.html` SPA router fallback so it works cleanly on any `https://<username>.github.io/<repo-name>/` URL.
2. **Optional Backend Mode (Option B)**:
   - Set `VITE_API_BASE_URL` in `.env` to connect Admin authentication (`POST /api/admin/login`) and server-side database APIs to an external Node/Express, Render, Railway, or Supabase backend.

---

## 3. Security Notice (Static vs. Backend Mode)

- **No Plaintext Password or Secret Committed**: The repository does not store any production password, API key, or GitHub Personal Access Token in source files.
- **Static Demo Mode Limitation**: When hosted purely as a static site on GitHub Pages without `VITE_API_BASE_URL`, Admin authentication (`King`) and Pro key generation operate in **Local Browser Demo Mode** (using SHA-256 hashed passcodes in `localStorage`). Any edits made in the Admin Panel in static mode are saved to that browser's local storage unless exported as JSON or pushed to GitHub.
- **Production Multi-User Security**: For real server-enforced Admin security and instant multi-user content updates without redeploying, configure `VITE_API_BASE_URL` to point to a backend server that verifies credentials with `bcrypt`/`argon2` and issues signed JWT tokens.

---

## 4. Windows Local Setup Instructions

Follow these exact steps on Windows (PowerShell or Command Prompt):

### Prerequisites
1. Install **Node.js (v18 or v20 LTS)** from [https://nodejs.org](https://nodejs.org).
2. Install **Git for Windows** from [https://git-scm.com](https://git-scm.com).
3. Install **VS Code** from [https://code.visualstudio.com](https://code.visualstudio.com).

### Step-by-Step Commands
```powershell
# 1. Clone your repository (or open the extracted project folder in VS Code)
git clone https://github.com/<your-username>/<your-repo-name>.git
cd <your-repo-name>

# 2. Install all project dependencies
npm install

# 3. (Optional) Create local environment file from example
copy .env.example .env

# 4. Start the local development server
npm run dev
```
Open **`http://localhost:3000`** in your browser.

### Build & Preview Production Bundle Locally
```powershell
# Create production build in /dist
npm run build

# Preview the production build locally
npm run preview
```

---

## 5. Project Structure

```text
├── .github/workflows/deploy.yml   # Automated GitHub Pages deployment workflow
├── public/
│   ├── icon.svg                   # Original Zyvra geometric vector icon
│   ├── zyvra-logo.svg             # Full Zyvra horizontal brand logo
│   ├── pwa-192x192.png            # PWA standard icon (192x192)
│   ├── pwa-512x512.png            # PWA high-res icon (512x512)
│   ├── pwa-maskable-512x512.png   # Android adaptive maskable icon
│   ├── apple-touch-icon.png       # iOS home screen icon (180x180)
│   ├── 404.html                   # GitHub Pages SPA routing fallback
│   └── templates/                 # Sample JSON & CSV bulk question templates
├── src/
│   ├── components/
│   │   ├── ZyvraLogo.tsx          # Reusable SVG brand logo & wordmark component
│   │   ├── AdminControlCenter.tsx # Admin login (King) & content CMS
│   │   ├── ActiveTestScreen.tsx   # Distraction-free exam engine
│   │   ├── StudyMaterialModal.tsx # Markdown notes & PDF reader
│   │   ├── FlashcardsModal.tsx    # Spaced-repetition active recall deck
│   │   └── ProActivationModal.tsx # Device-locked Pro activation modal
│   ├── data/seedDatabase.ts       # Multi-exam initial seed database
│   ├── hooks/                     # Online status & PWA install hooks
│   ├── utils/
│   │   ├── storage.ts             # LocalStorage + IndexedDB persistence layer
│   │   └── cryptoLock.ts          # Device ID, Pro signature & Admin auth utilities
│   ├── App.tsx                    # Main student workspace & navigation shell
│   └── main.tsx                   # Application entry point
├── GITHUB_DEPLOYMENT_GUIDE.md     # Complete deployment guide in Hindi
├── index.html                     # HTML entry with Zyvra SEO & PWA metadata
└── vite.config.ts                 # Vite + vite-plugin-pwa configuration
```
