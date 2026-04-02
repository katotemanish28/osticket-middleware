const https = require('https');
const pool = require('../config/database');

/**
 * Send push notification to a specific user via Expo Push API
 * @param {number} userId - User ID to notify
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Extra data (e.g. { ticketId })
 */
const sendPushToUser = async (userId, title, body, data = {}) => {
    try {
        const [rows] = await pool.query(
            `SELECT token FROM push_tokens WHERE user_id = ?`,
            [userId]
        );

        if (rows.length === 0) return;

        const tokens = rows.map(r => r.token);
        await sendToExpoPush(tokens, title, body, data);
    } catch (err) {
        console.warn('Push notification failed (non-fatal):', err.message);
    }
};

/**
 * Send push notification to all admin users
 * @param {string} title
 * @param {string} body
 * @param {object} data
 */
const sendPushToAdmins = async (title, body, data = {}) => {
    try {
        const adminEmails = (process.env.ADMIN_EMAILS || '')
            .split(',')
            .map(e => e.trim().toLowerCase())
            .filter(Boolean);

        if (adminEmails.length === 0) return;

        const prefix = process.env.DB_PREFIX || 'ost_';

        // Get admin user IDs from emails
        const placeholders = adminEmails.map(() => '?').join(',');
        const [adminUsers] = await pool.query(
            `SELECT u.id FROM ${prefix}user u
       JOIN ${prefix}user_email e ON e.user_id = u.id
       WHERE e.address IN (${placeholders})`,
            adminEmails
        );

        if (adminUsers.length === 0) return;

        const adminIds = adminUsers.map(u => u.id);
        const idPlaceholders = adminIds.map(() => '?').join(',');
        const [rows] = await pool.query(
            `SELECT token FROM push_tokens WHERE user_id IN (${idPlaceholders})`,
            adminIds
        );

        if (rows.length === 0) return;

        const tokens = rows.map(r => r.token);
        await sendToExpoPush(tokens, title, body, data);
    } catch (err) {
        console.warn('Push to admins failed (non-fatal):', err.message);
    }
};

/**
 * Send push notifications via Expo Push API
 * @param {string[]} pushTokens - Array of ExpoPushToken strings
 * @param {string} title
 * @param {string} body
 * @param {object} data
 */
const sendToExpoPush = (pushTokens, title, body, data = {}) => {
    return new Promise((resolve, reject) => {
        const messages = pushTokens
            .filter(token => token && token.startsWith('ExponentPushToken['))
            .map(token => ({
                to: token,
                sound: 'default',
                title,
                body,
                data,
            }));

        if (messages.length === 0) {
            return resolve();
        }

        const postData = JSON.stringify(messages);

        const options = {
            hostname: 'exp.host',
            path: '/--/api/v2/push/send',
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip, deflate',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(body);
                } else {
                    console.warn('Expo push response:', res.statusCode, body);
                    resolve();
                }
            });
        });

        req.on('error', (err) => {
            console.warn('Expo push request error:', err.message);
            resolve(); // Don't reject — push failures are non-fatal
        });

        req.write(postData);
        req.end();
    });
};

module.exports = { sendPushToUser, sendPushToAdmins };
