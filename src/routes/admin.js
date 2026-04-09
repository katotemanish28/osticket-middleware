const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');
const adminTicketController = require('../controllers/adminTicketController');

// All admin routes require auth + admin role
router.use(authMiddleware);
router.use(adminMiddleware);

// Agents
router.get('/agents', adminTicketController.getAgents);
router.post('/agents', adminTicketController.createAgent);

// Tickets management
router.get('/tickets', adminTicketController.listTickets);
router.get('/tickets/:id', adminTicketController.getTicket);
router.patch('/tickets/:id/status', adminTicketController.updateStatus);
router.patch('/tickets/:id/priority', adminTicketController.updatePriority);
router.get('/tickets/:id/messages', adminTicketController.getTicketMessages);
router.post('/tickets/:id/reply', adminTicketController.replyToTicket);

module.exports = router;

