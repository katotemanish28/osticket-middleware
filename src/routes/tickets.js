const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', ticketController.getUserTickets);
router.post('/', ticketController.createTicket);
router.get('/stats', ticketController.getStats);
router.get('/search', ticketController.searchTickets);
router.get('/:id', ticketController.getTicketDetail);
router.put('/:id', ticketController.updateTicket);      // EDIT
router.delete('/:id', ticketController.deleteTicket);   // DELETE

// Reply to ticket
router.post('/:id/message.json', ticketController.replyToTicket);

// Get ticket messages/replies
router.get('/:id/messages', ticketController.getTicketMessages);

// Upload attachment (stub - can be implemented later)
router.post('/:id/attachments', (req, res) => {
  res.status(501).json({
    success: false,
    message: 'Attachment upload not yet implemented'
  });
});

module.exports = router;