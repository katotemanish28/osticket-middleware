const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');

router.post('/login', authController.login);
router.post('/register', authController.register);
router.post('/forgot-password', authController.forgotPassword);
router.post('/verify-otp', authController.verifyOtp);
router.post('/reset-password', authController.resetPassword);
router.post('/change-password', authMiddleware, authController.changePassword);
router.post('/push-token', authMiddleware, authController.registerPushToken);
router.delete('/push-token', authMiddleware, authController.unregisterPushToken);
router.get('/verify', authMiddleware, authController.verify);

module.exports = router;
