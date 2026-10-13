/**
 * API Client - Lightweight HTTP wrapper for ETT backend
 * No dependencies; uses fetch API
 */

class APIClient {
    constructor(baseURL = 'http://localhost:3000/api') {
        this.baseURL = baseURL;
    }

    /**
     * Create a new session
     * @param {Object} data - { task_name, started_at }
     * @returns {Promise<Object>} Session data
     */
    async createSession(data) {
        return this.post('/sessions', { session: data });
    }

    /**
     * Get session by ID
     * @param {number} sessionId
     * @returns {Promise<Object>} Session with tasks
     */
    async getSession(sessionId) {
        return this.get(`/sessions/${sessionId}`);
    }

    /**
     * Update session
     * @param {number} sessionId
     * @param {Object} data - Fields to update
     * @returns {Promise<Object>} Updated session
     */
    async updateSession(sessionId, data) {
        return this.patch(`/sessions/${sessionId}`, { session: data });
    }

    /**
     * Create a task
     * @param {number} sessionId
     * @param {Object} data - { name, duration_minutes, completed_at }
     * @returns {Promise<Object>} Task data
     */
    async createTask(sessionId, data) {
        return this.post(`/sessions/${sessionId}/tasks`, { task: data });
    }

    /**
     * Update a task
     * @param {number} sessionId
     * @param {number} taskId
     * @param {Object} data - Fields to update
     * @returns {Promise<Object>} Updated task
     */
    async updateTask(sessionId, taskId, data) {
        return this.patch(`/sessions/${sessionId}/tasks/${taskId}`, { task: data });
    }

    /**
     * Log interval (15-min block completion)
     * @param {number} sessionId
     * @param {Object} data - { interval_number, task_id, completed_at }
     * @returns {Promise<Object>} Interval log
     */
    async logInterval(sessionId, data) {
        return this.post(`/sessions/${sessionId}/intervals`, { interval_log: data });
    }

    // Private helper methods
    async get(endpoint) {
        return this.request('GET', endpoint);
    }

    async post(endpoint, body) {
        return this.request('POST', endpoint, body);
    }

    async patch(endpoint, body) {
        return this.request('PATCH', endpoint, body);
    }

    async request(method, endpoint, body = null) {
        const url = `${this.baseURL}${endpoint}`;
        const options = {
            method,
            headers: { 'Content-Type': 'application/json' },
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                throw new Error(`API error: ${response.status} ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`Request failed [${method} ${endpoint}]:`, error);
            throw error;
        }
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = APIClient;
}
