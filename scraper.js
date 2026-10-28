 /**
 * VOLP Scraper Service (Pure JavaScript / In-Browser)
 * Executes inside content script context directly on https://classroom.volp.in or learner.volp.in
 * Automatically captures auth headers (Token, Uid, Ut) and fetches courses & assignments.
 */

const VolpScraper = (function () {
    const START_COURSE_ENDPOINT = "https://learner.volp.in/learnerCourseDashboard/startCourse";
    const ASSIGNMENT_ENDPOINT = "https://learner.volp.in/SubjectiveAssignment/getSubjectiveAssignment_new";
    const COURSE_LIST_ENDPOINT = "https://learner.volp.in/learnerCourseDashboard/learnerCourseList";

    function cleanHtmlText(rawHtml) {
        if (!rawHtml || typeof rawHtml !== 'string') return '';
        let text = rawHtml.replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, '\n');
        text = text.replace(/<[^>]+>/g, '');
        const temp = document.createElement('textarea');
        temp.innerHTML = text;
        text = temp.value;
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        return lines.join('\n');
    }

    function extractCourseFields(item) {
        const rawCid = item.crsid || item.course_id || item.courseId || item.id;
        const rawLid = item.learnercoffid || item.course_offering_learner_id || item.courseOfferingLearnerId || item.offeringLearnerId || item.id;

        const courseId = parseInt(rawCid, 10) || rawCid;
        const offeringLearnerId = parseInt(rawLid, 10) || rawLid;

        const courseObj = (item.course && typeof item.course === 'object') ? item.course : {};
        const courseName = courseObj.course_name || item.code || item.description || item.course_name || item.courseName || `Course_${courseId}`;

        return {
            course_id: courseId,
            course_offering_learner_id: offeringLearnerId,
            course_name: String(courseName).trim(),
            is_archived: Boolean(item.is_archived),
            instructor: item.inst || null
        };
    }

    function parseLearnerCourseList(jsonData) {
        let items = [];
        if (Array.isArray(jsonData)) {
            items = jsonData;
        } else if (jsonData && typeof jsonData === 'object') {
            if (Array.isArray(jsonData.col_list)) {
                items = jsonData.col_list;
            } else {
                for (const key of ['courses', 'course_list', 'data', 'result', 'response', 'learner_courses', 'courseList']) {
                    if (Array.isArray(jsonData[key])) {
                        items = jsonData[key];
                        break;
                    }
                }
            }
            if (items.length === 0 && jsonData.data && typeof jsonData.data === 'object') {
                for (const subkey of ['col_list', 'courses', 'course_list', 'list']) {
                    if (Array.isArray(jsonData.data[subkey])) {
                        items = jsonData.data[subkey];
                        break;
                    }
                }
            }
        }

        const courses = [];
        for (const item of items) {
            if (item && typeof item === 'object') {
                const c = extractCourseFields(item);
                if (c.course_id !== null && c.course_id !== undefined) {
                    courses.push(c);
                }
            }
        }
        return courses;
    }

    function parseAssignmentItem(q, courseId, courseName) {
        const rawQuestion = q.question || q.title || q.name || '';
        const cleanQuestion = cleanHtmlText(rawQuestion);

        const submitted = (
            q.issubmitted === true ||
            q.submitted === true ||
            String(q.isalreadysubmitted || '').toLowerCase() === 'true' ||
            String(q.isalready_submitted || '').toLowerCase() === 'true'
        );

        let assId = q.ass_id || q.id;
        const parsedAssId = parseInt(assId, 10);
        if (!isNaN(parsedAssId)) assId = parsedAssId;

        return {
            ass_id: assId,
            course_id: courseId,
            course_name: courseName || '',
            due_date: q.due_date || q.dueDate || '',
            grace_date: q.grace_date || null,
            question: cleanQuestion,
            question_html: rawQuestion,
            is_submitted: submitted,
            weightage: q.weightage !== undefined ? q.weightage : null,
            is_evaluated: Boolean(q.isevaluated),
            graded: Boolean(q.graded),
            obtained_marks: parseFloat(q.obtained_marks) || 0.0,
            teacher_remark: q.teacher_remark || '',
            submitted_answer_file_name: q.submitted_answer_file_name || null,
            submitted_answer_file_path: q.submitted_answer_file_path || null,
            submitted_text_answer: q.submitted_text_answer || null,
            grade: q.grade || null
        };
    }

    function getAuthSession() {
        let token = null;
        let uid = null;
        let ut = 'Learner';

        function checkObject(obj, sourceName) {
            if (!obj || typeof obj !== 'object') return;
            for (const key of Object.keys(obj)) {
                try {
                    const kLower = key.toLowerCase();
                    const val = obj[key];
                    if (typeof val === 'string') {
                        // Check if value is a JSON string itself
                        if (val.startsWith('{') && val.endsWith('}')) {
                            try {
                                const parsed = JSON.parse(val);
                                checkObject(parsed, `${sourceName}->${key}`);
                            } catch (e) {}
                        }

                        if (!token && (kLower.includes('token') || kLower === 'jwt' || kLower === 'access_token' || kLower === 'authtoken') && val.length > 15) {
                            token = val;
                        }
                        if (!uid && (kLower === 'uid' || kLower === 'email' || kLower === 'username' || kLower === 'user_id' || kLower === 'userid') && val.length > 2) {
                            uid = val;
                        }
                    } else if (typeof val === 'object' && val !== null) {
                        checkObject(val, `${sourceName}->${key}`);
                    }
                } catch (e) {}
            }
        }

        // 1. Scan localStorage
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                const val = localStorage.getItem(key);
                const kLower = (key || '').toLowerCase();
                
                if (val && typeof val === 'string') {
                    if (val.startsWith('{') && val.endsWith('}')) {
                        try {
                            const parsed = JSON.parse(val);
                            checkObject(parsed, 'localStorage');
                        } catch (e) {}
                    }
                    if (!token && (kLower.includes('token') || kLower === 'jwt') && val.length > 15) {
                        token = val;
                    }
                    if (!uid && (kLower === 'uid' || kLower === 'email' || kLower === 'username') && val.length > 2) {
                        uid = val;
                    }
                }
            }
        } catch (e) {}

        // 2. Scan sessionStorage
        try {
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                const val = sessionStorage.getItem(key);
                const kLower = (key || '').toLowerCase();
                
                if (val && typeof val === 'string') {
                    if (val.startsWith('{') && val.endsWith('}')) {
                        try {
                            const parsed = JSON.parse(val);
                            checkObject(parsed, 'sessionStorage');
                        } catch (e) {}
                    }
                    if (!token && (kLower.includes('token') || kLower === 'jwt') && val.length > 15) {
                        token = val;
                    }
                    if (!uid && (kLower === 'uid' || kLower === 'email' || kLower === 'username') && val.length > 2) {
                        uid = val;
                    }
                }
            }
        } catch (e) {}

        // 3. Scan document.cookie for Token or session cookies
        try {
            const cookies = document.cookie.split(';');
            for (let c of cookies) {
                const parts = c.trim().split('=');
                if (parts.length >= 2) {
                    const name = parts[0].trim().toLowerCase();
                    const value = decodeURIComponent(parts.slice(1).join('=')).trim();
                    if (!token && (name.includes('token') || name === 'jwt') && value.length > 15) {
                        token = value;
                    }
                    if (!uid && (name === 'uid' || name === 'email') && value.length > 2) {
                        uid = value;
                    }
                }
            }
        } catch (e) {}

        // 4. Check window global/Vue state if available
        try {
            if (window.$nuxt && window.$nuxt.$auth && window.$nuxt.$auth.strategy) {
                const tok = window.$nuxt.$auth.strategy.token?.get();
                if (tok) token = tok.replace('Bearer ', '');
            }
        } catch (e) {}

        return { token, uid, ut };
    }

    async function fetchCourseList(session) {
        const headers = {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json;charset=UTF-8',
            'Device': 'Web',
            'Organization-Code': 'null',
            'Router-Path': '/learner/my-courses',
            'Token': session.token || '',
            'Uid': session.uid || '',
            'Ut': session.ut || 'Learner'
        };

        const res = await fetch(COURSE_LIST_ENDPOINT, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({})
        });

        if (!res.ok) {
            throw new Error(`Failed to fetch course list: HTTP ${res.status}`);
        }

        const data = await res.json();
        if (data && String(data.status) === '401') {
            throw new Error('VOLP Session Expired (Status 401). Please log in again.');
        }

        return parseLearnerCourseList(data);
    }

    async function fetchAssignmentsForCourse(course, session) {
        const cid = course.course_id;
        const lid = course.course_offering_learner_id;

        const headers = {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json;charset=UTF-8',
            'Device': 'Web',
            'Organization-Code': 'null',
            'Router-Path': '/learner-subjective-assignment',
            'Token': session.token || '',
            'Uid': session.uid || '',
            'Ut': session.ut || 'Learner'
        };

        // 1. Initialize course context via startCourse
        try {
            await fetch(START_COURSE_ENDPOINT, {
                method: 'POST',
                headers: { ...headers, 'Router-Path': '/learner/my-courses' },
                body: JSON.stringify({ colid: lid })
            });
        } catch (e) {
            console.warn('[VOLP Scraper] startCourse warning:', e);
        }

        // 2. Fetch subjective assignments
        const res = await fetch(ASSIGNMENT_ENDPOINT, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                course_offering_learner_id: lid,
                type: 'content',
                courseId: cid
            })
        });

        if (!res.ok) {
            console.warn(`[VOLP Scraper] HTTP ${res.status} for course ${cid}`);
            return [];
        }

        const data = await res.json();
        if (!data || String(data.status) === '401') {
            console.warn(`[VOLP Scraper] Auth 401 on course ${cid}`);
            return [];
        }

        const rawQuestions = data.question_list || data.data || [];
        const assignments = [];
        if (Array.isArray(rawQuestions)) {
            for (const q of rawQuestions) {
                if (q && typeof q === 'object') {
                    assignments.push(parseAssignmentItem(q, cid, course.course_name));
                }
            }
        }
        return assignments;
    }

    return {
        getAuthSession,
        fetchCourseList,
        fetchAssignmentsForCourse,
        cleanHtmlText
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = VolpScraper;
}
