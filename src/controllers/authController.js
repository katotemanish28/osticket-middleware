const pool = require('../config/database');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    const emailLower = email.toLowerCase().trim();

    const [rows] = await pool.query(
      `SELECT u.*, e.address AS email
       FROM ost_user u
       JOIN ost_user_email e ON e.user_id = u.id
       WHERE e.address = ?`,
      [emailLower]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const user = rows[0];

    // Verify password against bcrypt hash in ost_user_account
    const [accountRows] = await pool.query(
      `SELECT passwd FROM ost_user_account WHERE user_id = ? LIMIT 1`,
      [user.id]
    );

    let passwordMatch = false;
    if (accountRows.length > 0 && accountRows[0].passwd) {
      passwordMatch = await bcrypt.compare(password, accountRows[0].passwd);
    }

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Determine role based on ADMIN_EMAILS env (comma-separated list)
    const adminEmails = (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean);

    const role = adminEmails.includes(emailLower) ? 'admin' : 'user';

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        name: user.name,
        role
      },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Write login to osTicket system log
    try {
      const prefix = process.env.DB_PREFIX || 'ost_';
      await pool.query(
        `INSERT INTO ${prefix}syslog (log_type, title, log, logger, ip_address, created, updated)
         VALUES ('Warning', ?, ?, 'API', '', NOW(), NOW())`,
        [
          `Login`,
          `User "${user.name}" (ID: ${user.id}, email: ${emailLower}, role: ${role}) logged in via the mobile API.`
        ]
      );
    } catch (logErr) {
      console.warn('Syslog insert failed (non-fatal):', logErr.message);
    }

    res.json({
      success: true,
      token,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

exports.verify = async (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
};

exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const emailLower = email.toLowerCase().trim();

    // Check if email already registered
    const [existing] = await pool.query(
      `SELECT id FROM ost_user_email WHERE address = ? LIMIT 1`,
      [emailLower]
    );
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const now = new Date();

    // Insert into ost_user
    const [userResult] = await pool.query(
      `INSERT INTO ost_user (name, created, updated) VALUES (?, ?, ?)`,
      [name.trim(), now, now]
    );
    const userId = userResult.insertId;

    // Insert into ost_user_email
    await pool.query(
      `INSERT INTO ost_user_email (user_id, flags, address) VALUES (?, 0, ?)`,
      [userId, emailLower]
    );

    // Hash password and store in ost_user_account
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO ost_user_account (user_id, status, timezone, passwd, backend, extra) VALUES (?, 0, '', ?, 'core', '')`,
      [userId, hashedPassword]
    );

    // Determine role
    const adminEmails = (process.env.ADMIN_EMAILS || '')
      .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    const role = adminEmails.includes(emailLower) ? 'admin' : 'user';

    const token = jwt.sign(
      { userId, email: emailLower, name: name.trim(), role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Write signup to osTicket system log
    try {
      const prefix = process.env.DB_PREFIX || 'ost_';
      await pool.query(
        `INSERT INTO ${prefix}syslog (log_type, title, log, logger, ip_address, created, updated)
         VALUES ('Warning', ?, ?, 'API', '', NOW(), NOW())`,
        [
          `Sign Up`,
          `New account created for "${name.trim()}" (ID: ${userId}, email: ${emailLower}, role: ${role}) via the mobile API.`
        ]
      );
    } catch (logErr) {
      console.warn('Syslog insert failed (non-fatal):', logErr.message);
    }

    res.status(201).json({
      success: true,
      token,
      data: { id: userId, name: name.trim(), email: emailLower, role }
    });

  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ===== Forgot Password with Email OTP =====
const { sendOtpEmail } = require('../utils/mailer');

// In-memory OTP store: { email: { otp, expiresAt, userId, userName, attempts } }
const otpStore = new Map();

// Forgot password — generate OTP and send via email
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const emailLower = email.toLowerCase().trim();

    const [rows] = await pool.query(
      `SELECT u.id, u.name FROM ost_user u
       JOIN ost_user_email e ON e.user_id = u.id
       WHERE e.address = ?`,
      [emailLower]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'No account found with this email address' });
    }

    const [accountRows] = await pool.query(
      `SELECT user_id FROM ost_user_account WHERE user_id = ? LIMIT 1`,
      [rows[0].id]
    );

    if (accountRows.length === 0) {
      return res.status(404).json({ success: false, message: 'No account credentials found for this email' });
    }

    // Generate 6-digit OTP
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    otpStore.set(emailLower, {
      otp,
      expiresAt,
      userId: rows[0].id,
      userName: rows[0].name,
      attempts: 0,
    });

    // Send OTP via email
    try {
      await sendOtpEmail(emailLower, rows[0].name, otp);
    } catch (emailErr) {
      console.error('Failed to send OTP email:', emailErr.message);
      otpStore.delete(emailLower);
      return res.status(500).json({ success: false, message: 'Failed to send OTP email. Please try again later.' });
    }

    res.json({
      success: true,
      message: 'OTP has been sent to your email address.',
      data: { email: emailLower, name: rows[0].name }
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Verify OTP — returns a short-lived reset token
exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required' });
    }

    const emailLower = email.toLowerCase().trim();
    const stored = otpStore.get(emailLower);

    if (!stored) {
      return res.status(400).json({ success: false, message: 'No OTP request found. Please request a new OTP.' });
    }

    if (Date.now() > stored.expiresAt) {
      otpStore.delete(emailLower);
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    if (stored.attempts >= 5) {
      otpStore.delete(emailLower);
      return res.status(429).json({ success: false, message: 'Too many incorrect attempts. Please request a new OTP.' });
    }

    if (stored.otp !== otp.trim()) {
      stored.attempts += 1;
      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${5 - stored.attempts} attempt(s) remaining.`
      });
    }

    // OTP valid — generate short-lived reset token (5 min)
    const resetToken = jwt.sign(
      { userId: stored.userId, email: emailLower, purpose: 'password-reset' },
      process.env.JWT_SECRET,
      { expiresIn: '5m' }
    );

    otpStore.delete(emailLower);

    res.json({
      success: true,
      message: 'OTP verified successfully.',
      resetToken,
    });

  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Reset password — requires valid reset token from OTP verification
exports.resetPassword = async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({ success: false, message: 'Reset token and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    // Verify the reset token
    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch (tokenErr) {
      return res.status(401).json({ success: false, message: 'Reset token is invalid or expired. Please start over.' });
    }

    if (decoded.purpose !== 'password-reset') {
      return res.status(401).json({ success: false, message: 'Invalid reset token.' });
    }

    const userId = decoded.userId;
    const emailLower = decoded.email;

    const [userRows] = await pool.query(`SELECT name FROM ost_user WHERE id = ?`, [userId]);
    const userName = (userRows.length > 0) ? userRows[0].name : 'Unknown';

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const [updateResult] = await pool.query(
      `UPDATE ost_user_account SET passwd = ? WHERE user_id = ?`,
      [hashedPassword, userId]
    );

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Failed to update password. Account not found.' });
    }

    // Log to syslog
    try {
      const prefix = process.env.DB_PREFIX || 'ost_';
      await pool.query(
        `INSERT INTO ${prefix}syslog (log_type, title, log, logger, ip_address, created, updated)
         VALUES ('Warning', ?, ?, 'API', '', NOW(), NOW())`,
        [
          'Password Reset',
          `Password was reset for user "${userName}" (ID: ${userId}, email: ${emailLower}) via the mobile API (OTP verified).`
        ]
      );
    } catch (logErr) {
      console.warn('Syslog insert failed (non-fatal):', logErr.message);
    }

    res.json({
      success: true,
      message: 'Password has been reset successfully. You can now login with your new password.'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Change password (logged-in user)
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ success: false, message: 'New password must be different from current password' });
    }

    // Get current password hash
    const [accountRows] = await pool.query(
      `SELECT passwd FROM ost_user_account WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    if (accountRows.length === 0 || !accountRows[0].passwd) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    // Verify current password
    const passwordMatch = await bcrypt.compare(currentPassword, accountRows[0].passwd);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    // Hash and update new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query(
      `UPDATE ost_user_account SET passwd = ? WHERE user_id = ?`,
      [hashedPassword, userId]
    );

    // Log to syslog
    try {
      const prefix = process.env.DB_PREFIX || 'ost_';
      const [userRows] = await pool.query(`SELECT name FROM ${prefix}user WHERE id = ?`, [userId]);
      const userName = (userRows.length > 0) ? userRows[0].name : 'Unknown';
      await pool.query(
        `INSERT INTO ${prefix}syslog (log_type, title, log, logger, ip_address, created, updated)
         VALUES ('Warning', ?, ?, 'API', '', NOW(), NOW())`,
        [
          'Password Changed',
          `User "${userName}" (ID: ${userId}) changed their password via the mobile API.`
        ]
      );
    } catch (logErr) {
      console.warn('Syslog insert failed (non-fatal):', logErr.message);
    }

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Register push notification token
exports.registerPushToken = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, message: 'Push token is required' });
    }

    // Upsert: insert or update if token already exists
    await pool.query(
      `INSERT INTO push_tokens (user_id, token, created_at, updated_at)
       VALUES (?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE user_id = ?, updated_at = NOW()`,
      [userId, token, userId]
    );

    res.json({ success: true, message: 'Push token registered' });
  } catch (error) {
    console.error('Register push token error:', error);
    res.status(500).json({ success: false, message: 'Failed to register push token' });
  }
};

// Unregister push notification token
exports.unregisterPushToken = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, message: 'Push token is required' });
    }

    await pool.query(`DELETE FROM push_tokens WHERE token = ?`, [token]);

    res.json({ success: true, message: 'Push token unregistered' });
  } catch (error) {
    console.error('Unregister push token error:', error);
    res.status(500).json({ success: false, message: 'Failed to unregister push token' });
  }
};
