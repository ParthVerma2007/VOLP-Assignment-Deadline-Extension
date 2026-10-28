/**
 * VOLP Assistant Content Script
 * Runs on https://classroom.volp.in/* and https://learner.volp.in/*
 * Capabilities:
 * 1. Auto-fill login form securely from AES-decrypted credentials
 * 2. In-browser scraping: fetch courses and assignments directly using active session tokens
 * 3. Save scraped courses & assignments directly to chrome.storage.local
 */

const EMAIL_SELECTORS = [
    'input[type="email"]',
    'input[name="email"]',
    'input[name="username"]',
    'input[placeholder*="email" i]',
    'input[placeholder*="user" i]',
    '#email',
    '#username'
];

const PASSWORD_SELECTORS = [
    'input[type="password"]',
    'input[name="password"]',
    '#password'
];

const SUBMIT_SELECTORS = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button.v-btn',
    'button'
];

function findElement(selectors) {
    for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) {
            return el;
        }
    }
    return null;
}

function clearAndSetInputValue(input, value) {
    input.focus();
    // Clear existing text completely
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // Set new value using native value setter to bypass any framework property overrides (Vue/React)
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeInputValueSetter) {
        nativeInputValueSetter.call(input, value);
    } else {
        input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
}

function fillAndSubmit(email, password, shouldSubmit = true) {
    const emailField = findElement(EMAIL_SELECTORS);
    const passField = findElement(PASSWORD_SELECTORS);

    if (!emailField || !passField) {
        return false;
    }

    // Clear and rewrite using stored credentials
    clearAndSetInputValue(emailField, email);
    clearAndSetInputValue(passField, password);

    if (shouldSubmit) {
        setTimeout(() => {
            const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
            const loginBtn = buttons.find(b => {
                const txt = (b.innerText || b.value || '').toLowerCase();
                return txt.includes('login') || txt.includes('sign in') || txt.includes('log in');
            });

            if (loginBtn) {
                loginBtn.click();
            } else {
                const fallbackSubmit = findElement(SUBMIT_SELECTORS);
                if (fallbackSubmit) fallbackSubmit.click();
            }
        }, 300);
    }

    return true;
}

// Full In-Browser Scrape Pipeline
async function runInBrowserScrape(sendProgress) {
    let session = VolpScraper.getAuthSession();
    
    // Fallback: check chrome.storage.local captured by background webRequest listener
    if (!session || !session.token) {
        const liveSessionData = await new Promise(r => chrome.storage.local.get(['volp_live_session'], r));
        if (liveSessionData && liveSessionData.volp_live_session && liveSessionData.volp_live_session.token) {
            session = {
                token: liveSessionData.volp_live_session.token,
                uid: liveSessionData.volp_live_session.uid || session.uid,
                ut: liveSessionData.volp_live_session.ut || session.ut || 'Learner'
            };
        }
    }

    if (!session || !session.token) {
        throw new Error('Not logged into VOLP or session token not found. Please log in or refresh your VOLP tab.');
    }

    sendProgress({ step: 'courses', message: 'Fetching enrolled courses...' });
    const courses = await VolpScraper.fetchCourseList(session);
    if (!courses || courses.length === 0) {
        throw new Error('No courses found or authentication failed.');
    }

    await VolpStorage.saveCourses(courses);

    let totalAssignments = 0;
    const allAssignments = [];

    for (let i = 0; i < courses.length; i++) {
        const c = courses[i];
        sendProgress({
            step: 'assignments',
            current: i + 1,
            total: courses.length,
            courseName: c.course_name,
            message: `Fetching assignments for [${i + 1}/${courses.length}]: ${c.course_name}`
        });

        try {
            const assignments = await VolpScraper.fetchAssignmentsForCourse(c, session);
            if (assignments.length > 0) {
                await VolpStorage.saveAssignments(assignments, c.course_name);
                totalAssignments += assignments.length;
                allAssignments.push(...assignments);
            }
        } catch (err) {
            console.error(`Error fetching assignments for ${c.course_name}:`, err);
        }
    }

    await VolpStorage.updateSyncMeta('SUCCESS', 'Synced successfully via in-browser scraper', courses.length, totalAssignments);

    return {
        coursesCount: courses.length,
        assignmentsCount: totalAssignments
    };
}

// Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'FILL_CREDENTIALS') {
        const success = fillAndSubmit(request.email, request.password);
        sendResponse({ success });
        return false;
    }

    if (request.action === 'CHECK_LOGIN_STATE') {
        let session = VolpScraper.getAuthSession();
        if (!session.token) {
            chrome.storage.local.get(['volp_live_session'], (res) => {
                const live = res.volp_live_session;
                sendResponse({
                    isLoggedIn: Boolean((live && live.token && live.token.length > 15) || (session.token && session.token.length > 15)),
                    hasUid: Boolean((live && live.uid) || session.uid)
                });
            });
            return true;
        }
        sendResponse({
            isLoggedIn: Boolean(session.token && session.token.length > 15),
            hasUid: Boolean(session.uid)
        });
        return false;
    }

    if (request.action === 'START_LOCAL_SCRAPE') {
        (async () => {
            try {
                const result = await runInBrowserScrape((progress) => {
                    chrome.runtime.sendMessage({ action: 'SCRAPE_PROGRESS', ...progress }).catch(() => {});
                });
                sendResponse({ success: true, ...result });
            } catch (err) {
                await VolpStorage.updateSyncMeta('FAILED', err.message || 'Scrape failed');
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true; // Keep message channel open for async response
    }

    return true;
});
