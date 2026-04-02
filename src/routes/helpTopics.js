const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const pool = require('../config/database');

router.use(authMiddleware);

// Get help topics (categories)
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT topic_id as id, topic FROM ost_help_topic');
    res.json({
      success: true,
      data: rows
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
