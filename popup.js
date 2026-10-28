/**
 * VOLP Assistant Popup Controller (Local Version)
 * Manages UI tabs, encrypted credential forms, table filtering, and in-browser scrape trigger.
 */

document.addEventListener('DOMContentLoaded', async () => {
    // ── Tab Navigation ──
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const targetId = btn.getAttribute('data-tab');
            document.getElementById(targetId).classList.add('active');

            if (targetId === 'tabAssignments') {
                loadAndRenderAssignments();
            }
        });
    });

    // ── Elements: Credential Form ──
    const credForm = document.getElementById('credForm');
    const credEmail = document.getElementById('credEmail');
    const credPassword = document.getElementById('credPassword');
    const credMasterPin = document.getElementById('credMasterPin');
    const togglePasswordBtn = document.getElementById('togglePasswordBtn');
    const clearCredsBtn = document.getElementById('clearCredsBtn');
    const credToast = document.getElementById('credToast');
    const clearDataBtn = document.getElementById('clearDataBtn');

    // ── Elements: Sync & Actions ──
    const scrapeActiveTabBtn = document.getElementById('scrapeActiveTabBtn');
    const openVolpBtn = document.getElementById('openVolpBtn');
    const autoFillBtn = document.getElementById('autoFillBtn');
    const syncToast = document.getElementById('syncToast');
    const progressContainer = document.getElementById('progressContainer');
    const progressStatusText = document.getElementById('progressStatusText');
    const progressBarFill = document.getElementById('progressBarFill');
    const loginBadge = document.getElementById('loginBadge');

    // ── Elements: Table & Filters ──
    const searchInput = document.getElementById('searchInput');
    const statusFilter = document.getElementById('statusFilter');
    const courseFilter = document.getElementById('courseFilter');
    const assignmentsTableBody = document.getElementById('assignmentsTableBody');
    const statCourses = document.getElementById('statCourses');
    const statTotal = document.getElementById('statTotal');
    const statPending = document.getElementById('statPending');
    const statSubmitted = document.getElementById('statSubmitted');
    const lastSyncedText = document.getElementById('lastSyncedText');
    const exportJsonBtn = document.getElementById('exportJsonBtn');

    // 1. Password Visibility Toggle
    togglePasswordBtn.addEventListener('click', () => {
        if (credPassword.type === 'password') {
            credPassword.type = 'text';
            togglePasswordBtn.textContent = '🔒';
        } else {
            credPassword.type = 'password';
            togglePasswordBtn.textContent = '👁️';
        }
    });

    // 2. Check and Load Stored Encrypted Credentials
    async function loadSavedCreds() {
        const has = await VolpCrypto.hasCredentials();
        if (has) {
            try {
                const creds = await VolpCrypto.loadCredentials('');
                if (creds) {
                    credEmail.value = creds.email || '';
                    credPassword.value = creds.password || '';
                }
            } catch (e) {
                // Pin protected
                showToast(credToast, 'Credentials protected with PIN. Enter PIN to decrypt.', 'info');
            }
        }
    }
    loadSavedCreds();

    // 3. Save Encrypted Credentials
    credForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = credEmail.value.trim();
        const password = credPassword.value;
        const pin = credMasterPin.value.trim();

        if (!email || !password) {
            showToast(credToast, 'Email and Password are required.', 'error');
            return;
        }

        try {
            await VolpCrypto.saveCredentials(email, password, pin);
            showToast(credToast, 'Credentials encrypted and stored locally with AES-256!', 'success');
        } catch (err) {
            showToast(credToast, `Encryption error: ${err.message}`, 'error');
        }
    });

    // 4. Clear Credentials
    clearCredsBtn.addEventListener('click', async () => {
        await VolpCrypto.clearCredentials();
        credEmail.value = '';
        credPassword.value = '';
        credMasterPin.value = '';
        showToast(credToast, 'Encrypted credentials deleted.', 'info');
    });

    // 5. Clear Assignments Cache
    clearDataBtn.addEventListener('click', async () => {
        if (confirm('Delete all stored assignments and courses from local storage?')) {
            await VolpStorage.clearAllData();
            await loadAndRenderAssignments();
            showToast(credToast, 'Local database cleared.', 'info');
        }
    });

    // 6. Check Active Tab VOLP Login State
    async function checkVolpSession() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs[0];
            if (activeTab && activeTab.url && (activeTab.url.includes('volp.in'))) {
                chrome.tabs.sendMessage(activeTab.id, { action: 'CHECK_LOGIN_STATE' }, (resp) => {
                    if (chrome.runtime.lastError || !resp) {
                        setLoginBadge(false, 'Not On VOLP');
                    } else if (resp.isLoggedIn) {
                        setLoginBadge(true, 'Logged In');
                    } else {
                        setLoginBadge(false, 'Logged Out');
                    }
                });
            } else {
                setLoginBadge(false, 'Open VOLP Tab');
            }
        });
    }

    function setLoginBadge(isLogged, text) {
        loginBadge.textContent = text;
        if (isLogged) {
            loginBadge.className = 'badge badge-status logged-in';
        } else {
            loginBadge.className = 'badge badge-status logged-out';
        }
    }
    checkVolpSession();

    // 7. Auto-Fill Login
    autoFillBtn.addEventListener('click', async () => {
        const pin = credMasterPin.value.trim();
        let creds = null;
        try {
            creds = await VolpCrypto.loadCredentials(pin);
        } catch (e) {
            showToast(syncToast, 'Decryption failed. Enter your Master PIN.', 'error');
            return;
        }

        if (!creds || !creds.email || !creds.password) {
            showToast(syncToast, 'Please save credentials first in the Credentials tab.', 'error');
            return;
        }

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs[0];
            const isVolp = activeTab && activeTab.url && activeTab.url.includes('classroom.volp.in');

            if (isVolp) {
                chrome.tabs.sendMessage(activeTab.id, {
                    action: 'FILL_CREDENTIALS',
                    email: creds.email,
                    password: creds.password
                }, (resp) => {
                    if (chrome.runtime.lastError || !resp || !resp.success) {
                        showToast(syncToast, 'Could not find login fields on this page.', 'error');
                    } else {
                        showToast(syncToast, 'Credentials filled and submitted!', 'success');
                        setTimeout(checkVolpSession, 2000);
                    }
                });
            } else {
                chrome.tabs.create({ url: 'https://classroom.volp.in/login' });
            }
        });
    });

    // 8. Open VOLP Tab
    openVolpBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://classroom.volp.in/learner/my-courses' });
    });

    // 9. Start Local Scrape (Works on active tab OR headlessly without opening VOLP)
    scrapeActiveTabBtn.addEventListener('click', async () => {
        const pin = credMasterPin.value.trim();

        scrapeActiveTabBtn.disabled = true;
        progressContainer.classList.add('active');
        progressStatusText.textContent = 'Checking VOLP tabs & session...';
        progressBarFill.style.width = '10%';

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs[0];
            const isVolp = activeTab && activeTab.url && activeTab.url.includes('volp.in');

            if (isVolp) {
                // If user is currently looking at a VOLP tab, scrape directly via that tab
                progressStatusText.textContent = 'Connecting to active VOLP tab...';
                progressBarFill.style.width = '20%';

                chrome.tabs.sendMessage(activeTab.id, { action: 'START_LOCAL_SCRAPE' }, async (resp) => {
                    if (chrome.runtime.lastError || !resp) {
                        // Fallback to background headless if tab isn't responsive
                        chrome.runtime.sendMessage({
                            action: 'RUN_HEADLESS_SCRAPE',
                            masterPin: pin
                        }, async (bgResp) => {
                            handleScrapeResponse(bgResp);
                        });
                    } else {
                        handleScrapeResponse(resp);
                    }
                });
            } else {
                // Not on VOLP: run headlessly in background!
                progressStatusText.textContent = 'Starting background headless scrape...';
                progressBarFill.style.width = '20%';

                chrome.runtime.sendMessage({
                    action: 'RUN_HEADLESS_SCRAPE',
                    masterPin: pin
                }, async (resp) => {
                    handleScrapeResponse(resp);
                });
            }
        });
    });

    async function handleScrapeResponse(resp) {
        scrapeActiveTabBtn.disabled = false;

        if (chrome.runtime.lastError) {
            progressContainer.classList.remove('active');
            showToast(syncToast, 'Could not start scraper. Check saved credentials or open VOLP once.', 'error');
            return;
        }

        if (resp && resp.success) {
            progressBarFill.style.width = '100%';
            progressStatusText.textContent = `Completed! ${resp.coursesCount} courses, ${resp.assignmentsCount} assignments.`;
            showToast(syncToast, `Success! Saved ${resp.assignmentsCount} assignments to local storage.`, 'success');
            await loadAndRenderAssignments();
            chrome.runtime.sendMessage({ action: 'UPDATE_BADGE' });
        } else {
            progressContainer.classList.remove('active');
            showToast(syncToast, (resp && resp.error) || 'Scrape failed. Please check credentials or log into VOLP.', 'error');
        }
    }

    // Listen for progress messages from content script
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'SCRAPE_PROGRESS') {
            if (msg.step === 'courses') {
                progressBarFill.style.width = '25%';
                progressStatusText.textContent = msg.message;
            } else if (msg.step === 'assignments') {
                const pct = 25 + Math.round((msg.current / msg.total) * 70);
                progressBarFill.style.width = `${pct}%`;
                progressStatusText.textContent = msg.message;
            }
        }
    });

    // 10. Load and Render Assignments Table
    async function loadAndRenderAssignments() {
        const stats = await VolpStorage.getStats();
        statCourses.textContent = stats.total_courses;
        statTotal.textContent = stats.total_assignments;
        statPending.textContent = stats.pending_assignments;
        statSubmitted.textContent = stats.submitted_assignments;

        if (stats.last_synced) {
            const dt = new Date(stats.last_synced);
            lastSyncedText.textContent = `Last synced: ${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        } else {
            lastSyncedText.textContent = 'Last synced: Never';
        }

        // Populate course dropdown if empty
        const courses = await VolpStorage.getCourses();
        const currentCourseVal = courseFilter.value;
        courseFilter.innerHTML = '<option value="">All Courses</option>';
        for (const c of courses) {
            const opt = document.createElement('option');
            opt.value = c.course_id;
            opt.textContent = c.course_name;
            if (String(c.course_id) === currentCourseVal) opt.selected = true;
            courseFilter.appendChild(opt);
        }

        // Apply filters
        const filters = {
            search: searchInput.value.trim(),
            is_submitted: statusFilter.value !== '' ? statusFilter.value : null,
            course_id: courseFilter.value !== '' ? courseFilter.value : null
        };

        const assignments = await VolpStorage.getAssignments(filters);

        if (assignments.length === 0) {
            assignmentsTableBody.innerHTML = `
                <tr>
                    <td colspan="4" class="empty-state">
                        ${stats.total_assignments === 0 ? 'No assignments stored yet. Click "Sync & Scrape" to fetch from VOLP!' : 'No assignments match your filters.'}
                    </td>
                </tr>
            `;
            return;
        }

        // Sort: pending first, then by due_date
        assignments.sort((a, b) => {
            if (a.is_submitted === b.is_submitted) {
                return (a.due_date || '').localeCompare(b.due_date || '');
            }
            return a.is_submitted ? 1 : -1;
        });

        assignmentsTableBody.innerHTML = '';
        for (const a of assignments) {
            const tr = document.createElement('tr');

            const isSub = a.is_submitted === true;
            const statusBadge = isSub
                ? `<span class="status-pill submitted">✓ Submitted</span>`
                : `<span class="status-pill pending">⏳ Pending</span>`;

            const dueDisplay = a.due_date ? a.due_date : 'No deadline';
            const cleanQ = a.question ? (a.question.length > 120 ? a.question.slice(0, 120) + '...' : a.question) : '(No question text)';

            tr.innerHTML = `
                <td>
                    <div class="course-tag">${escapeHtml(a.course_name || 'Course #' + a.course_id)}</div>
                    <span style="font-size: 10px; color: #64748b;">ID: ${a.ass_id}</span>
                </td>
                <td>
                    <div class="q-text" title="${escapeHtml(a.question || '')}">${escapeHtml(cleanQ)}</div>
                    ${a.weightage ? `<span style="font-size: 10px; color: #94a3b8;">Weightage: ${a.weightage}</span>` : ''}
                </td>
                <td>
                    <div class="due-date">${escapeHtml(dueDisplay)}</div>
                    ${a.grace_date ? `<span style="font-size: 9.5px; color: #f59e0b;">Grace: ${escapeHtml(a.grace_date)}</span>` : ''}
                </td>
                <td>
                    ${statusBadge}
                    ${a.obtained_marks ? `<div style="font-size: 10px; margin-top: 3px; color: #22c55e;">Marks: ${a.obtained_marks}</div>` : ''}
                </td>
            `;
            assignmentsTableBody.appendChild(tr);
        }
    }

    // Filter Listeners
    searchInput.addEventListener('input', debounce(loadAndRenderAssignments, 250));
    statusFilter.addEventListener('change', loadAndRenderAssignments);
    courseFilter.addEventListener('change', loadAndRenderAssignments);

    // 11. Export JSON
    exportJsonBtn.addEventListener('click', async () => {
        const courses = await VolpStorage.getCourses();
        const assignments = await VolpStorage.getAssignments();
        const meta = await VolpStorage.getSyncMeta();

        const exportData = {
            exported_at: new Date().toISOString(),
            sync_meta: meta,
            courses_count: courses.length,
            assignments_count: assignments.length,
            courses,
            assignments
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `volp_assignments_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    // ── Helper Utilities ──
    function showToast(elem, msg, type = 'info') {
        elem.textContent = msg;
        elem.className = `toast-msg show ${type}`;
        setTimeout(() => {
            elem.classList.remove('show');
        }, 5000);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    // Initial render
    loadAndRenderAssignments();
});
