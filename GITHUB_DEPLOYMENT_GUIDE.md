# Zyvra — GitHub और GitHub Pages डिप्लॉयमेंट गाइड (हिंदी में)

यह गाइड आपको **Zyvra (Universal Competitive Exam Preparation Platform)** को अपने Windows कंप्यूटर पर चलाने, GitHub पर अपलोड करने और **GitHub Pages** पर बिल्कुल मुफ्त (Free) लाइव होस्ट करने की पूरी प्रक्रिया आसान हिंदी में समझाती है।

---

## भाग A (Part A): अपने कंप्यूटर (Windows) पर प्रोजेक्ट तैयार करना

### 1. ज़रूरी सॉफ्टवेयर इंस्टॉल करें
अपने कंप्यूटर में नीचे दिए गए तीन सॉफ्टवेयर इंस्टॉल कर लें (यदि पहले से इंस्टॉल हैं तो यह स्टेप छोड़ दें):
1. **Node.js (LTS वर्शन 18 या 20):** [https://nodejs.org](https://nodejs.org) से डाउनलोड और इंस्टॉल करें।
2. **Git for Windows:** [https://git-scm.com/download/win](https://git-scm.com/download/win) से इंस्टॉल करें।
3. **VS Code (Visual Studio Code):** [https://code.visualstudio.com](https://code.visualstudio.com) से इंस्टॉल करें।

### 2. प्रोजेक्ट फोल्डर को VS Code में खोलें
1. अपने कंप्यूटर में **Zyvra** प्रोजेक्ट के ज़िप (ZIP) फोल्डर को Extract करें।
2. **VS Code** खोलें -> ऊपर **File > Open Folder** पर क्लिक करें और अपना प्रोजेक्ट फोल्डर चुनें।
3. VS Code में टर्मिनल खोलने के लिए कीबोर्ड पर **`Ctrl + ~`** (Ctrl और Backtick बटन) दबाएँ या ऊपर मेनू से **Terminal > New Terminal** चुनें।

### 3. प्रोजेक्ट को लोकल कंप्यूटर पर चलाकर देखें
टर्मिनल में नीचे दिए गए कमांड एक-एक करके टाइप करें और `Enter` दबाएँ:

```powershell
# 1. सभी ज़रूरी पैकेज (Dependencies) इंस्टॉल करें
npm install

# 2. लोकल डेवलपमेंट सर्वर शुरू करें
npm run dev
```
- अब आपके टर्मिनल में `http://localhost:3000` दिखाई देगा। इसे अपने ब्राउज़र (Chrome/Edge) में खोलें।

### 4. प्रोडक्शन बिल्ड (Build) चेक करें
GitHub पर अपलोड करने से पहले यह जाँच लें कि प्रोजेक्ट बिना किसी एरर के बिल्ड हो रहा है:

```powershell
npm run build
```
- यह कमांड चलने के बाद आपके प्रोजेक्ट में `dist` नाम का फोल्डर बन जाएगा।

### 5. ध्यान दें: कौन सी फाइलें GitHub पर अपलोड नहीं करनी हैं?
प्रोजेक्ट में `.gitignore` फाइल पहले से सेट है। यह अपने आप इन फाइलों को रोक देगी:
- `node_modules/` (यह बहुत बड़ा फोल्डर होता है, इसे कभी अपलोड न करें)
- `.env` या `.env.local` (इसमें आपके प्राइवेट सीक्रेट या पासवर्ड होते हैं)
- `dist/` (GitHub Actions इसे अपने आप बनाएगा)

---

## भाग B (Part B): GitHub पर नया Repository बनाना और कोड अपलोड करना

### 1. GitHub पर नया Repository बनाएँ
1. [https://github.com](https://github.com) पर लॉग इन करें।
2. ऊपर दाईं तरफ **`+`** आइकन पर क्लिक करें और **New repository** चुनें।
3. **Repository name** में लिखें: `zyvra` (या अपनी पसंद का नाम)।
4. इसे **Public** रखें (मुफ्त GitHub Pages के लिए Public होना ज़रूरी है)।
5. *Add a README file* या *.gitignore* पर टिक **न करें** (क्योंकि ये हमारे प्रोजेक्ट में पहले से मौजूद हैं)।
6. **Create repository** बटन पर क्लिक करें।

### 2. अपने कंप्यूटर से कोड GitHub पर भेजें (Push करें)
VS Code के टर्मिनल में नीचे दिए गए कमांड क्रम से चलाएँ:

```powershell
# 1. Git शुरू करें
git init

# 2. सभी फाइलों को स्टेज करें
git add .

# 3. पहला कमिट (Commit) बनाएँ
git commit -m "Initial production release of Zyvra"

# 4. मुख्य ब्रांच का नाम main रखें
git branch -M main

# 5. अपने GitHub Repository का लिंक जोड़ें (नीचे अपने GitHub यूज़रनेम और रिपॉजिटरी का नाम बदलें)
git remote add origin https://github.com/YOUR_USERNAME/zyvra.git

# 6. कोड को GitHub पर अपलोड (Push) करें
git push -u origin main
```

---

## भाग C (Part C): वेबसाइट को लाइव (Host) करना

### विकल्प 1 (अनुशंसित): केवल GitHub Pages पर होस्टिंग (100% Free)
हमने प्रोजेक्ट में `.github/workflows/deploy.yml` फाइल पहले से बना दी है, जो आपके ऐप को अपने आप बिल्ड और पब्लिश कर देगी। बस यह एक सेटिंग करें:

1. अपने GitHub Repository पेज पर जाएँ।
2. ऊपर **Settings** टैब पर क्लिक करें।
3. बाईं तरफ के मेनू में **Pages** पर क्लिक करें।
4. **Build and deployment** के नीचे **Source** ड्रॉपडाउन में **`GitHub Actions`** चुनें।
5. अब ऊपर **Actions** टैब पर क्लिक करें। आप देखेंगे कि **"Deploy Zyvra to GitHub Pages"** वर्कफ़्लो चल रहा है।
6. 1–2 मिनट में जब उस पर हरा टिक (Green Checkmark) आ जाए, तो आपकी वेबसाइट लाइव हो जाएगी!
7. आपकी लाइव वेबसाइट का लिंक ऐसा होगा:
   `https://YOUR_USERNAME.github.io/zyvra/`

---

## भाग D (Part D): बैकएंड और डेटाबेस सेटअप (यदि आप मल्टी-यूज़र क्लाउड सिंक चाहते हैं)

Zyvra दो तरीकों से काम करता है:

### 1. लोकल / GitHub डायरेक्ट सिंक मोड (बिना अलग सर्वर के)
- डिफ़ॉल्ट रूप से Zyvra का सारा डेटा `seedDatabase.ts` और ब्राउज़र के `localStorage` / `IndexedDB` में सुरक्षित रहता है।
- **सभी छात्रों के लिए नया कंटेंट लाइव करने का तरीका:**
  1. एडमिन पैनल (`Admin` बटन) खोलें और लॉग इन करें (`Sajiya@8800`)।
  2. नए प्रश्न (CSV/JSON), परीक्षा या नोट्स जोड़ें।
  3. **Cloud Sync / Backup** टैब में जाकर **Export JSON Backup** पर क्लिक करें और डाउनलोड हुई फाइल को अपने प्रोजेक्ट के `public/database.json` के रूप में सेव करके GitHub पर Push कर दें—या सीधे एडमिन पैनल में अपना GitHub Personal Access Token (PAT) डालकर **Push to GitHub** बटन दबाएँ।

### 2. एक्सटर्नल बैकएंड मोड (Render / Railway / Supabase)
यदि आप चाहते हैं कि एडमिन पासवर्ड सर्वर पर चेक हो (`JWT Auth`):
1. अपने बैकएंड सर्वर को Render या Railway पर होस्ट करें।
2. `.env` फाइल में `VITE_API_BASE_URL="https://your-backend-api.onrender.com"` सेट करें।
3. ऐप अपने आप `/api/admin/login` के ज़रिए सर्वर से ऑथेंटिकेशन करेगा।

---

## भाग E (Part E): लाइव होने के बाद जाँच (Verification Checklist)

जब आपकी वेबसाइट लाइव हो जाए, तो नीचे दी गई चीज़ें ज़रूर चेक करें:

1. **वेबसाइट और लोगो:**
   - क्या वेबसाइट मोबाइल और लैपटॉप दोनों पर सही खुल रही है?
   - क्या ऊपर **Zyvra** का नया लोगो और नाम दिख रहा है?
2. **परीक्षा और टेस्ट इंजन (Test Engine):**
   - ऊपर से अलग-अलग परीक्षाएँ (जैसे **SSC CGL, BPSC TRE, Bihar Daroga, Railway NTPC**) बदलकर देखें।
   - **Start Mock** या **Custom Test** पर क्लिक करके एक टेस्ट दें, भाषा (English/Hindi) बदलें और टेस्ट सबमिट करके रिज़ल्ट तथा **15-Second Trick** देखें।
3. **एडमिन पैनल (Admin Panel) और लॉगिन:**
   - ऊपर दाईं तरफ **Admin** बटन (या फुटर में बैज पर 5 बार टैप) करें।
   - **Admin Login ID** में `Sajiya@8800` पहले से भरा मिलेगा। पहली बार अपना लोकल पासकोड सेट करें और लॉग इन करें।
   - **Questions** टैब में जाकर **Sample CSV** या **Sample JSON** डाउनलोड करें और उसे अपलोड करके देखें।
4. **मोबाइल ऐप इंस्टॉलेशन (PWA Install) और ऑफलाइन मोड:**
   - मोबाइल के Chrome ब्राउज़र में वेबसाइट खोलें और हेडर में दिख रहे **Install App** बटन पर क्लिक करके ऐप को होम स्क्रीन पर इंस्टॉल करें।
   - इंटरनेट बंद करने पर ऊपर **Offline Mode Active** बैनर दिखाई देगा और पहले से लोड किए गए प्रश्न व नोट्स बिना इंटरनेट के भी काम करेंगे।

---

### भविष्य में ऐप को अपडेट कैसे करें?
जब भी आप अपने कंप्यूटर पर कोड या डेटा में कोई बदलाव करें, बस टर्मिनल में ये 3 कमांड चलाएँ:

```powershell
git add .
git commit -m "Updated exam questions and features"
git push
```
GitHub Actions अपने आप 1 मिनट के अंदर आपकी लाइव वेबसाइट को अपडेट कर देगा!
