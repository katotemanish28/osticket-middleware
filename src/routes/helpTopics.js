const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

// Get help topics (categories)
router.get('/', async (req, res) => {
  try {
    // Return default help topics - you can customize this based on your osTicket setup
    res.json({
      success: true,
      data: [
        { id: 1, topic: 'General Inquiry', ispublic: 1 },
        { id: 2, topic: 'Technical Support', ispublic: 1 },
        { id: 3, topic: 'Billing', ispublic: 1 },
        { id: 4, topic: 'Feature Request', ispublic: 1 },
      ]
    });
  } catch (error) {
    console.error('Get help topics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch help topics'
    });
  }
});

// Get custom fields for a help topic
router.get('/:id/fields', async (req, res) => {
  try {
    // Return empty array for now - can be extended later
    res.json({
      success: true,
      data: []
    });
  } catch (error) {
    console.error('Get custom fields error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch custom fields'
    });
  }
});

module.exports = router;
