const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465', // true for 465, false for 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Verify connection on startup
transporter.verify()
  .then(() => console.log('✓ Email service connected successfully'))
  .catch((err) => console.error('✗ Email service connection failed:', err.message));

/**
 * Send OTP email for password reset
 * @param {string} toEmail - Recipient email
 * @param {string} userName - Recipient name
 * @param {string} otp - 6-digit OTP code
 */
const sendOtpEmail = async (toEmail, userName, otp) => {
  // Developer Shortcut: Always log the OTP so you can use it even if email is blocked
  console.log(`\n🔑 [DEBUG] OTP for ${toEmail}: ${otp}\n`);

  // If SMTP is not fully configured, don't crash
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || process.env.SMTP_USER === 'your-email@gmail.com') {
    console.log('⚠️ SMTP not configured or using placeholders, skipping real email send.');
    return true; 
  }

  const mailOptions = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: 'osTicket - Password Reset OTP',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <div style="background: #1976d2; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
          <h2 style="margin: 0;">🔒 Password Reset</h2>
        </div>
        <div style="background: #fff; border: 1px solid #e0e0e0; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
          <p style="color: #333;">Hi <strong>${userName}</strong>,</p>
          <p style="color: #555;">You requested a password reset for your osTicket account. Use the OTP below to verify your identity:</p>
          <div style="background: #f5f5f5; border: 2px dashed #1976d2; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1976d2;">${otp}</span>
          </div>
          <p style="color: #888; font-size: 13px;">⏰ This OTP is valid for <strong>10 minutes</strong>.</p>
          <p style="color: #888; font-size: 13px;">If you didn't request this, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #aaa; font-size: 11px; text-align: center;">osTicket Mobile Support System</p>
        </div>
      </div>
    `,
  };

  return transporter.sendMail(mailOptions);
};

/**
 * Send email notification for new ticket creation
 * @param {string} toEmail - Recipient email
 * @param {string} userName - Recipient name
 * @param {string} ticketNumber - Generated ticket number
 * @param {string} subject - Ticket subject
 * @param {string} message - Ticket message snippet
 */
const sendTicketCreationEmail = async (toEmail, userName, ticketNumber, subject, message) => {
  // Truncate message for email preview
  const messagePreview = message.length > 150 ? message.substring(0, 150) + '...' : message;
  
  const mailOptions = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: `Support Ticket Opened [#${ticketNumber}]`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <div style="background: #1976d2; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
          <h2 style="margin: 0;">🎫 Ticket Created</h2>
        </div>
        <div style="background: #fff; border: 1px solid #e0e0e0; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
          <p style="color: #333;">Hi <strong>${userName}</strong>,</p>
          <p style="color: #555;">A request for support has been created and assigned ticket number <strong>#${ticketNumber}</strong>.</p>
          <div style="background: #f5f5f5; border-left: 4px solid #1976d2; padding: 15px; margin: 20px 0;">
            <h4 style="margin: 0 0 8px 0; color: #1976d2;">${subject}</h4>
            <p style="color: #666; font-size: 14px; margin: 0; line-height: 1.5;">${messagePreview}</p>
          </div>
          <p style="color: #888; font-size: 13px;">Our team will get back to you as soon as possible.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #aaa; font-size: 11px; text-align: center;">osTicket Mobile Support System</p>
        </div>
      </div>
    `,
  };

  return transporter.sendMail(mailOptions);
};

module.exports = { sendOtpEmail, sendTicketCreationEmail };
