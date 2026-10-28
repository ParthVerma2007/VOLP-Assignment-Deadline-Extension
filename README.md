# VOLP Assignment Tracker (Fully Local Browser Extension)

A completely standalone Chrome/Edge extension that tracks your VOLP assignments with **zero server**, **zero hosting costs**, and **100% privacy**.

---

## 🔒 Security & Privacy Architecture

- **No Remote Servers**: Runs entirely inside your browser. No passwords, tokens, or personal assignment data ever cross any external network.
- **AES-256-GCM Encryption**: Credentials (email & password) are encrypted client-side using the native Web Crypto API with **100,000 PBKDF2 iterations (SHA-256)** and unique 12-byte initialization vectors (IV).
- **Optional Master PIN**: Adds a secondary passphrase layer. Without the PIN, stored credentials cannot be decrypted even by someone with local file access.
- **Direct Session Scraping**: Uses your active browser login on `classroom.volp.in` / `learner.volp.in` to scrape courses and subjective assignments directly into `chrome.storage.local`.

---

## 📁 Files in `D:\VOLP_SCRAPER\Local_extension\`

```
Local_extension/
├── manifest.json       # Chrome Manifest V3 configuration
├── crypto.js           # Native AES-GCM (256-bit) + PBKDF2 encryption engine
├── storage.js          # Local storage wrapper (courses, assignments, sync metadata)
├── scraper.js          # In-browser parser for startCourse and getSubjectiveAssignment_new
├── content.js          # Injected into VOLP pages for auto-fill & session scraping
├── background.js       # Service worker updating the pending assignments badge count
├── popup.html          # Extension dashboard UI with 3 tabs: Assignments, Sync, Credentials
├── popup.css           # Modern dark-mode UI styling
├── popup.js            # Controller handling table sorting, filtering, and scrape triggers
└── icons/              # 16px, 48px, 128px extension icons
```

---

## 🚀 How to Install

1. Open **Google Chrome**, **Brave**, or **Microsoft Edge**.
2. Navigate to:
   ```
   chrome://extensions
   ```
   *(or `edge://extensions` in Edge)*
3. Enable **"Developer mode"** (toggle in the top-right corner).
4. Click **"Load unpacked"**.
5. Select the folder:
   ```
   D:\VOLP_SCRAPER\Local_extension
   ```
6. Pin the extension to your browser toolbar!

---

## 💡 How to Use

### Step 1: Save Credentials (Encrypted)
1. Click the extension icon.
2. Go to the **Credentials** tab.
3. Enter your VOLP email and password (and optional Master PIN).
4. Click **"Save Encrypted"**.

### Step 2: Log into VOLP & Scrape
1. Open [classroom.volp.in](https://classroom.volp.in) or click **"Open VOLP"** in the **Sync & Scrape** tab.
2. Click **"Auto-Fill & Submit"** or log in normally.
3. Once logged in, open the extension and click **"Start Local Scrape"**.
4. The extension fetches all enrolled courses and assignments directly from your active session.

### Step 3: View & Track Assignments
1. Switch to the **Assignments** tab.
2. View:
   - **Status summary badges**: Courses, Total, Pending, Submitted.
   - **Interactive table**: Filter by Pending/Submitted status or course name.
   - Search assignment questions in real time.
3. Click **"Export JSON"** anytime for a standalone backup.
4. The extension badge on your browser toolbar will show your pending assignment count at a glance!
