/**
 * VOLP Assistant Background Service Worker (Manifest V3)
 * Operates purely locally:
 * - Intercepts live VOLP network requests to capture active 'Token', 'Uid', and 'Ut' headers.
 * - Stores live session tokens in chrome.storage.local so the scraper always has a valid token.
 * - Updates extension badge with pending assignment count.
 * - Executes background/headless scrape using an automated tab if VOLP is not already open.
 */

importScripts('storage.js', 'crypto.js');

const SESSION_KEY = 'volp_live_session';

// 1. Capture live auth headers from any outgoing request to volp.in
if (chrome.webRequest && chrome.webRequest.onBeforeSendHeaders) {
    chrome.webRequest.onBeforeSendHeaders.addListener(
        (details) => {
            if (details.requestHeaders) {
                let token = null;
                let uid = null;
                let ut = null;

                for (const header of details.requestHeaders) {
                    const name = header.name.toLowerCase();
                    if (name === 'token' && header.value && header.value.length > 15) {
                        token = header.value;
                    } else if (name === 'uid' && header.value) {
                        uid = header.value;
                    } else if (name === 'ut' && header.value) {
                        ut = header.value;
                    }
                }

                if (token) {
                    chrome.storage.local.get([SESSION_KEY], (res) => {
                        const existing = res[SESSION_KEY] || {};
                        const updated = {
                            token: token,
                            uid: uid || existing.uid || '',
                            ut: ut || existing.ut || 'Learner',
                            capturedAt: Date.now()
                        };
                        chrome.storage.local.set({ [SESSION_KEY]: updated });
                    });
                }
            }
        },
        { urls: ["*://*.volp.in/*"] },
        ["requestHeaders"]
    );
}

// 2. Badge Update Logic
async function updateBadge() {
    try {
        const stats = await VolpStorage.getStats();
        const pending = stats.pending_assignments;
        if (pending > 0) {
            chrome.action.setBadgeText({ text: String(pending) });
            chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' }); // orange
        } else if (stats.total_assignments > 0) {
            chrome.action.setBadgeText({ text: '✓' });
            chrome.action.setBadgeBackgroundColor({ color: '#22c55e' }); // green
        } else {
            chrome.action.setBadgeText({ text: '' });
        }
    } catch (e) {
        chrome.action.setBadgeText({ text: '' });
    }
}

chrome.runtime.onInstalled.addListener(() => {
    updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
    updateBadge();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
        if (changes.volp_assignments || changes.volp_courses) {
            updateBadge();
        }
    }
});

// 3. Reliable Message Sending to Tab (Retries until Content Script is Ready)
async function sendTabMessageWithRetry(tabId, message, maxRetries = 15, delayMs = 600) {
    for (let i = 0; i < maxRetries; i++) {
        const resp = await new Promise((resolve) => {
            chrome.tabs.sendMessage(tabId, message, (r) => {
                if (chrome.runtime.lastError) {
                    resolve(null);
                } else {
                    resolve(r);
                }
            });
        });

        if (resp !== null) {
            return resp;
        }

        // Try injecting content script manually if not yet loaded
        if (i === 2 || i === 6) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['crypto.js', 'storage.js', 'scraper.js', 'content.js']
                });
            } catch (e) {}
        }

        await new Promise(r => setTimeout(r, delayMs));
    }
    return null;
}

// Helper to wait for a tab to finish loading
function waitForTabLoaded(tabId, timeoutMs = 25000) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        }, timeoutMs);

        function listener(updatedTabId, changeInfo) {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                clearTimeout(timer);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        }
        chrome.tabs.onUpdated.addListener(listener);
    });
}

// 4. Headless / Background Scrape Runner
async function runHeadlessScrape(masterPin = '') {
    // 1. Load decrypted credentials
    let creds = null;
    try {
        creds = await VolpCrypto.loadCredentials(masterPin);
    } catch (e) {
        throw new Error('Failed to decrypt credentials. Enter Master PIN if set.');
    }

    if (!creds || !creds.email || !creds.password) {
        throw new Error('No credentials saved. Save your email & password in the Credentials tab first.');
    }

    // 2. Check if a VOLP tab is already open
    const tabs = await chrome.tabs.query({ url: "*://*.volp.in/*" });
    let targetTab = null;
    let createdTempTab = false;

    if (tabs.length > 0) {
        targetTab = tabs[0];
    } else {
        // Create tab in the background without stealing user focus
        targetTab = await chrome.tabs.create({
            url: "https://classroom.volp.in/login",
            active: false
        });
        createdTempTab = true;
    }

    try {
        await waitForTabLoaded(targetTab.id);

        // Check if already logged in
        chrome.runtime.sendMessage({
            action: 'SCRAPE_PROGRESS',
            step: 'check',
            message: 'Checking VOLP login status...'
        }).catch(() => {});

        let checkRes = await sendTabMessageWithRetry(targetTab.id, { action: 'CHECK_LOGIN_STATE' }, 10, 500);

        if (!checkRes || !checkRes.isLoggedIn) {
            chrome.runtime.sendMessage({
                action: 'SCRAPE_PROGRESS',
                step: 'login',
                message: 'Auto-logging into VOLP...'
            }).catch(() => {});

            // Fill and submit login form
            const fillRes = await sendTabMessageWithRetry(targetTab.id, {
                action: 'FILL_CREDENTIALS',
                email: creds.email,
                password: creds.password
            }, 10, 500);

            if (!fillRes || !fillRes.success) {
                // If on login page but fields weren't found, re-navigate directly
                await chrome.tabs.update(targetTab.id, { url: "https://classroom.volp.in/login" });
                await waitForTabLoaded(targetTab.id);
                await sendTabMessageWithRetry(targetTab.id, {
                    action: 'FILL_CREDENTIALS',
                    email: creds.email,
                    password: creds.password
                }, 10, 600);
            }

            // Wait for navigation / redirect after login
            await new Promise(r => setTimeout(r, 4500));
            await waitForTabLoaded(targetTab.id);
        }

        // Navigate to my-courses if still on login
        const currentTabState = await chrome.tabs.get(targetTab.id);
        if (currentTabState.url && currentTabState.url.includes('login')) {
            await chrome.tabs.update(targetTab.id, { url: "https://classroom.volp.in/learner/my-courses" });
            await waitForTabLoaded(targetTab.id);
            await new Promise(r => setTimeout(r, 2000));
        }

        // Trigger local scrape on this tab
        chrome.runtime.sendMessage({
            action: 'SCRAPE_PROGRESS',
            step: 'courses',
            message: 'Session verified! Fetching courses and assignments...'
        }).catch(() => {});

        const scrapeResult = await sendTabMessageWithRetry(targetTab.id, { action: 'START_LOCAL_SCRAPE' }, 12, 800);

        if (!scrapeResult) {
            throw new Error('VOLP page did not respond. Check credentials or open VOLP once in a tab.');
        }

        return scrapeResult;
    } finally {
        if (createdTempTab && targetTab) {
            try {
                await chrome.tabs.remove(targetTab.id);
            } catch (e) {}
        }
    }
}

// 5. Message Dispatcher
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'UPDATE_BADGE') {
        updateBadge();
        sendResponse({ success: true });
        return false;
    }

    if (request.action === 'RUN_HEADLESS_SCRAPE') {
        (async () => {
            try {
                const res = await runHeadlessScrape(request.masterPin || '');
                sendResponse(res || { success: false, error: 'No response from scrape worker' });
            } catch (err) {
                sendResponse({ success: false, error: err.message || 'Headless scrape failed' });
            }
        })();
        return true; // Keep async channel open
    }

    return true;
});
