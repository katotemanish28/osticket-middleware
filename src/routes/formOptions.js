const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const pool = require('../config/database');

router.use(authMiddleware);

router.get('/departments', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name FROM ost_department');
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch departments' });
  }
});

router.get('/slas', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name FROM ost_sla');
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch SLA plans' });
  }
});

router.get('/sources', async (req, res) => {
  try {
    res.json({
      success: true,
      data: [
        { id: 'Phone', name: 'Phone' },
        { id: 'Email', name: 'Email' },
        { id: 'API', name: 'API' },
        { id: 'Other', name: 'Other' },
      ]
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch sources' });
  }
});

module.exports = router;
