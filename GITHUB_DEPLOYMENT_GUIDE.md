# Zyvra — GitHub Pages डिप्लॉयमेंट और एडमिन सुरक्षा (Admin Security) गाइड (सरल हिंदी में)

यह गाइड आपको **Zyvra (Universal Competitive Exam Preparation Platform)** के नए **Admin Authentication Security Upgrade**, पासकोड सेटअप/रीसेट प्रक्रिया और प्रोडक्शन बैकएंड आर्किटेक्चर को सरल हिंदी में समझाती है।

---

## 1. एडमिन पैनल (Admin Control Center) कैसे खोलें? (गुप्त 5-टैप तरीका)

छात्रों की सुरक्षा के लिए अब **Profile** पेज या फुटर में कहीं भी `"Administrator Login"` का पब्लिक बटन या लिंक **नहीं** दिखता है, और न ही कोई एडमिन आईडी (`Sajiya@8800`) स्क्रीन पर दिखाई देती है।

**एडमिन लॉगिन बॉक्स खोलने का गुप्त तरीका (Discreet Entry Flow):**
1. ऐप में नीचे या ऊपर के नेविगेशन से **Profile (प्रोफ़ाइल)** टैब पर जाएँ।
2. प्रोफ़ाइल कार्ड के बाईं ओर (या नीचे फुटर में) बने **Zyvra Logo** पर **लगातार 5 बार (3 सेकंड के अंदर) टैप/क्लिक करें**।
3. 5 बार टैप करते ही **Administrator Authentication** डायलॉग खुल जाएगा।

---

## 2. एडमिन आईडी और पासकोड कैसे सेट या रीसेट करें? (Static GitHub Pages मोड)

### A. पहली बार एडमिन आईडी और पासकोड बनाना (First-Time Owner Setup)
जब आप पहली बार अपने ब्राउज़र में 5-टैप करके एडमिन बॉक्स खोलेंगे:
1. आपको **First-Time Owner Setup (Create Owner Admin Credentials)** स्क्रीन दिखेगी।
2. यहाँ अपनी पसंद का **New Admin Login ID** (कम से कम 4 अक्षर) और **New Administrator Passcode** (कम से कम 6 अक्षर) डालें और **Initialize & Sign In** पर क्लिक करें।
3. आपका लॉगिन आईडी और पासकोड सुरक्षित **Salted SHA-256 Hash** के रूप में आपके ब्राउज़र में सेव हो जाएगा (कोड में कोई भी पासवर्ड हार्डकोड नहीं है)।

### B. यदि आप अपना लोकल पासकोड भूल गए हैं तो उसे रीसेट कैसे करें? (Owner Credential Reset)
बिना किसी छात्र के डेटा, टेस्ट हिस्ट्री या प्रश्न बैंक (`zyvra_master_db_v3`) को नुकसान पहुँचाए आप दो सुरक्षित तरीकों से अपना एडमिन पासकोड रीसेट कर सकते हैं:

#### तरीका 1: GitHub Personal Access Token (PAT) द्वारा वेरिफिकेशन (अनुशंसित)
1. 5-टैप करके एडमिन डायलॉग खोलें और **Owner Credential Reset** टैब पर क्लिक करें।
2. **Connected GitHub Repository** में अपने रिपॉजिटरी का नाम लिखें (जैसे: `username/Zyvra-V1.0`)।
3. **GitHub Personal Access Token** में अपना GitHub PAT (`ghp_...`) डालें।
4. अपना **New Admin Login ID** और **New Administrator Passcode** डालकर **Verify & Reset Credentials** पर क्लिक करें।
5. ऐप सीधे GitHub API से जाँच करेगा कि आप इस रिपॉजिटरी के असली मालिक (Owner) हैं और तुरंत आपका नया पासकोड सेट कर देगा।

#### तरीका 2: अपने कंप्यूटर/मोबाइल ब्राउज़र के Console से लोकल रीसेट
यदि आप अपने ही लैपटॉप पर हैं और तुरंत लोकल क्रेडेंशियल रीसेट करना चाहते हैं:
1. ब्राउज़र में `F12` दबाकर **Developer Tools -> Console** खोलें।
2. नीचे दी गई कमांड चलाएँ:
   ```javascript
   localStorage.removeItem('zyvra_admin_cred_v2');
   localStorage.removeItem('zyvra_admin_passcode_hash_v1');
   ```
3. पेज रीफ्रेश करें और Zyvra लोगो पर 5 बार टैप करें — अब आपको फिर से **First-Time Owner Setup** स्क्रीन मिल जाएगी। (इससे आपका कोई भी प्रश्न या छात्र डेटा डिलीट नहीं होगा)।

---

## 3. स्टैटिक GitHub Pages की सीमा और प्रोडक्शन बैकएंड आर्किटेक्चर (सरल हिंदी में)

### स्टैटिक होस्टिंग की सच्चाई (Static Frontend Limitation)
- **GitHub Pages** केवल स्टैटिक फाइलें (HTML, CSS, JavaScript) होस्ट करता है।
- स्टैटिक वेबसाइट का सारा कोड यूज़र के ब्राउज़र में डाउनलोड होता है, इसलिए केवल फ्रंटएंड (`localStorage`) में रखा गया लॉगिन केवल आपके अपने ब्राउज़र/डिवाइस की सुरक्षा के लिए होता है — यह किसी पब्लिक सर्वर की तरह 100% अभेद्य सुरक्षा (True Server Security Boundary) नहीं दे सकता।
- कभी भी `VITE_` वाले एनवायरनमेंट वेरिएबल्स में अपना एडमिन पासवर्ड या सीक्रेट न रखें, क्योंकि `VITE_` वेरिएबल्स बिल्ड होते समय पब्लिक JavaScript बंडल में शामिल हो जाते हैं।

### असली प्रोडक्शन बैकएंड कैसे लगाएँ? (`server.mjs` का उपयोग)
हमने प्रोजेक्ट की रूट डायरेक्टरी में **`server.mjs`** नाम का एक तैयार प्रोडक्शन बैकएंड सर्वर दिया है। इसमें:
- **Salted `scrypt` Password Hashing** और **Timing-Safe Comparison** है।
- **Brute-Force Rate Limiting** (5 गलत प्रयासों पर 60 सेकंड का लॉकआउट) है।
- **HMAC-SHA256 Signed Session Token** और **HttpOnly Secure Cookie** की सुविधा है।

#### बैकएंड सर्वर को चालू करने के स्टेप्स:
1. **अपने पासवर्ड का सुरक्षित Hash बनाएँ:**
   टर्मिनल में यह कमांड चलाएँ:
   ```bash
   node server.mjs --hash "ApnaStrongPasswordYahanLikhein"
   ```
   यह आपको `ADMIN_PASSWORD_HASH="salt:hash"` आउटपुट देगा।

2. **बैकएंड सर्वर (Render / Railway / VPS) पर Environment Variables सेट करें:**
   अपने बैकएंड सर्वर की सेटिंग्स में ये वेरिएबल्स जोड़ें (इन्हें कभी भी GitHub में कमिट न करें):
   ```env
   ADMIN_LOGIN_ID="आपकी_गुप्त_एडमिन_आईडी"
   ADMIN_PASSWORD_HASH="ऊपर_मिला_हुआ_साल्ट_और_हैश"
   ADMIN_SESSION_SECRET="कोई_भी_लंबी_रैंडम_सीक्रेट_स्ट्रिंग"
   ALLOWED_ORIGIN="https://your-username.github.io"
   ```

3. **फ्रंटएंड को बैकएंड से जोड़ें:**
   जब आपका `server.mjs` किसी क्लाउड सर्वर (जैसे Render या Railway) पर लाइव हो जाए, तो केवल उसका पब्लिक URL अपने फ्रंटएंड के `VITE_API_BASE_URL` में डालें। इसके बाद Zyvra का एडमिन पैनल सीधे सर्वर से वेरिफाई होकर ही खुलेगा।

---

## 4. GitHub Pages पर ऑटोमैटिक डिप्लॉयमेंट (`.github/workflows/deploy.yml`)

1. प्रोजेक्ट में `package-lock.json` और `.github/workflows/deploy.yml` पहले से सही बेस पाथ (`/Zyvra-V1.0/`) के साथ तैयार हैं।
2. जब भी आप कोड को GitHub पर Push या Sync करेंगे, GitHub Actions अपने आप `npm ci` और `npm run build` चलाकर `dist` फोल्डर को GitHub Pages पर पब्लिश कर देगा।
