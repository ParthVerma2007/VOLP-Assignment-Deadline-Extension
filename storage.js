/**
 * Local Data Storage Manager using chrome.storage.local.
 * Stores courses and assignments scraped directly from VOLP.
 * No server or external database required — all data stays encrypted / local in the browser.
 */

const VolpStorage = (function () {
    const COURSES_KEY = 'volp_courses';
    const ASSIGNMENTS_KEY = 'volp_assignments';
    const SYNC_META_KEY = 'volp_sync_meta';

    function storageGet(keys) {
        return new Promise((resolve) => {
            chrome.storage.local.get(keys, (result) => resolve(result));
        });
    }

    function storageSet(data) {
        return new Promise((resolve) => {
            chrome.storage.local.set(data, () => resolve());
        });
    }

    async function getCourses() {
        const result = await storageGet([COURSES_KEY]);
        return result[COURSES_KEY] || [];
    }

    async function saveCourses(courses) {
        const existing = await getCourses();
        const map = {};
        for (const c of existing) map[c.course_id] = c;
        for (const c of courses) {
            map[c.course_id] = { ...map[c.course_id], ...c, updated_at: new Date().toISOString() };
        }
        const merged = Object.values(map);
        await storageSet({ [COURSES_KEY]: merged });
        return merged;
    }

    async function getAssignments(filters = {}) {
        const result = await storageGet([ASSIGNMENTS_KEY]);
        let assignments = result[ASSIGNMENTS_KEY] || [];

        if (filters.course_id !== undefined && filters.course_id !== null && filters.course_id !== '') {
            const cid = parseInt(filters.course_id, 10);
            assignments = assignments.filter(a => a.course_id === cid);
        }
        if (filters.is_submitted !== undefined && filters.is_submitted !== null && filters.is_submitted !== '') {
            const isSub = filters.is_submitted === true || filters.is_submitted === 'true';
            assignments = assignments.filter(a => a.is_submitted === isSub);
        }
        if (filters.search) {
            const q = filters.search.toLowerCase().trim();
            assignments = assignments.filter(a =>
                (a.question && a.question.toLowerCase().includes(q)) ||
                (a.course_name && a.course_name.toLowerCase().includes(q))
            );
        }
        return assignments;
    }

    async function saveAssignments(assignments, courseName = '') {
        const existing = await getAssignments();
        const map = {};
        for (const a of existing) map[a.ass_id] = a;
        for (const a of assignments) {
            map[a.ass_id] = {
                ...map[a.ass_id],
                ...a,
                course_name: courseName || a.course_name || (map[a.ass_id] && map[a.ass_id].course_name) || '',
                updated_at: new Date().toISOString()
            };
        }
        const merged = Object.values(map);
        await storageSet({ [ASSIGNMENTS_KEY]: merged });
        return merged;
    }

    async function getStats() {
        const courses = await getCourses();
        const assignments = await getAssignments();
        const submitted = assignments.filter(a => a.is_submitted === true);
        const pending = assignments.filter(a => a.is_submitted === false);
        const meta = await getSyncMeta();

        return {
            total_courses: courses.length,
            total_assignments: assignments.length,
            submitted_assignments: submitted.length,
            pending_assignments: pending.length,
            last_synced: meta.last_synced || null
        };
    }

    async function getSyncMeta() {
        const result = await storageGet([SYNC_META_KEY]);
        return result[SYNC_META_KEY] || {};
    }

    async function updateSyncMeta(status, message = '', totalCourses = 0, totalAssignments = 0) {
        const meta = {
            last_synced: new Date().toISOString(),
            status: status,
            message: message,
            totalCourses: totalCourses,
            totalAssignments: totalAssignments
        };
        await storageSet({ [SYNC_META_KEY]: meta });
        return meta;
    }

    async function clearAllData() {
        return new Promise((resolve) => {
            chrome.storage.local.remove([COURSES_KEY, ASSIGNMENTS_KEY, SYNC_META_KEY], () => {
                resolve(true);
            });
        });
    }

    return {
        getCourses,
        saveCourses,
        getAssignments,
        saveAssignments,
        getStats,
        getSyncMeta,
        updateSyncMeta,
        clearAllData
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = VolpStorage;
}
