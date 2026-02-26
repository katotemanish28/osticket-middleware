const pool = require('../config/database');

// List all tickets (admin)
exports.listTickets = async (req, res) => {
  try {
    const {
      status = 'all',
      page = 1,
      limit = 20,
      search = '',
    } = req.query;

    const offset = (page - 1) * limit;
    let conditions = 'WHERE 1=1';

    // Filter by status (state)
    if (status !== 'all') {
      const [statuses] = await pool.query(
        `SELECT id FROM ${process.env.DB_PREFIX}ticket_status WHERE state = ?`,
        [status]
      );
      if (statuses.length > 0) {
        conditions += ` AND t.status_id = ${statuses[0].id}`;
      }
    }

    const params = [];

    // Simple search over number, subject, user email
    if (search) {
      conditions += ' AND (t.number LIKE ? OR c.subject LIKE ? OR ue.address LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    const [tickets] = await pool.query(
      `SELECT 
        t.ticket_id,
        t.number,
        t.status_id,
        c.priority as priority_id,
        t.created,
        t.updated,
        c.subject,
        s.name as status_name,
        s.state as status_state,
        p.priority as priority_name,
        u.name as user_name,
        ue.address as user_email
      FROM ${process.env.DB_PREFIX}ticket t
      LEFT JOIN ${process.env.DB_PREFIX}ticket__cdata c ON t.ticket_id = c.ticket_id
      LEFT JOIN ${process.env.DB_PREFIX}ticket_status s ON t.status_id = s.id
      LEFT JOIN ${process.env.DB_PREFIX}ticket_priority p ON c.priority = p.priority_id
      LEFT JOIN ${process.env.DB_PREFIX}user u ON t.user_id = u.id
      LEFT JOIN ${process.env.DB_PREFIX}user_email ue ON ue.user_id = u.id AND ue.id = t.user_email_id
      ${conditions}
      ORDER BY t.created DESC
      LIMIT ? OFFSET ?`,
      [...params, parseInt(limit, 10), (page - 1) * limit]
    );

    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total
       FROM ${process.env.DB_PREFIX}ticket t
       LEFT JOIN ${process.env.DB_PREFIX}ticket__cdata c ON t.ticket_id = c.ticket_id
       LEFT JOIN ${process.env.DB_PREFIX}user u ON t.user_id = u.id
       LEFT JOIN ${process.env.DB_PREFIX}user_email ue ON ue.user_id = u.id AND ue.id = t.user_email_id
       ${conditions}`,
      params
    );

    res.json({
      success: true,
      tickets,
      total: countResult[0].total,
      page: parseInt(page, 10),
    });
  } catch (error) {
    console.error('Admin list tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tickets',
    });
  }
};

// Get any ticket (admin)
exports.getTicket = async (req, res) => {
  try {
    const ticketIdParam = req.params.id;
    const ticketId = ticketIdParam ? parseInt(ticketIdParam, 10) : NaN;
    if (isNaN(ticketId) || ticketId < 1) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ticket ID',
      });
    }

    const [tickets] = await pool.query(
      `SELECT 
        t.*,
        c.subject,
        e.body as message,
        u.name as user_name,
        ue.address as user_email,
        s.name as status_name,
        s.state as status,
        c.priority as priority_id,
        p.priority as priority_name
      FROM ${process.env.DB_PREFIX}ticket t
      LEFT JOIN ${process.env.DB_PREFIX}ticket__cdata c ON t.ticket_id = c.ticket_id
      LEFT JOIN ${process.env.DB_PREFIX}thread th ON th.object_id = t.ticket_id AND th.object_type = 'T'
      LEFT JOIN ${process.env.DB_PREFIX}thread_entry e ON th.id = e.thread_id AND e.pid = 0
      LEFT JOIN ${process.env.DB_PREFIX}user u ON t.user_id = u.id
      LEFT JOIN ${process.env.DB_PREFIX}user_email ue ON ue.user_id = u.id AND ue.id = t.user_email_id
      LEFT JOIN ${process.env.DB_PREFIX}ticket_status s ON t.status_id = s.id
      LEFT JOIN ${process.env.DB_PREFIX}ticket_priority p ON c.priority = p.priority_id
      WHERE t.ticket_id = ?`,
      [ticketId]
    );

    if (!tickets || tickets.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    res.json({
      success: true,
      data: tickets[0],
    });
  } catch (error) {
    console.error('Admin get ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch ticket',
    });
  }
};

// Update ticket status (admin)
exports.updateStatus = async (req, res) => {
  try {
    const ticketIdParam = req.params.id;
    const ticketId = ticketIdParam ? parseInt(ticketIdParam, 10) : NaN;
    const { status, statusId } = req.body;

    if (isNaN(ticketId) || ticketId < 1) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ticket ID',
      });
    }

    let newStatusId = statusId;

    if (!newStatusId && status) {
      const [rows] = await pool.query(
        `SELECT id FROM ${process.env.DB_PREFIX}ticket_status WHERE state = ? OR name = ? LIMIT 1`,
        [status, status]
      );
      if (rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Unknown status',
        });
      }
      newStatusId = rows[0].id;
    }

    if (!newStatusId) {
      return res.status(400).json({
        success: false,
        message: 'Status or statusId is required',
      });
    }

    await pool.query(
      `UPDATE ${process.env.DB_PREFIX}ticket
       SET status_id = ?, updated = NOW()
       WHERE ticket_id = ?`,
      [newStatusId, ticketId]
    );

    res.json({
      success: true,
      message: 'Status updated successfully',
      data: { ticket_id: ticketId, status_id: newStatusId },
    });
  } catch (error) {
    console.error('Admin update status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update status',
    });
  }
};

// Update ticket priority (admin)
exports.updatePriority = async (req, res) => {
  try {
    const ticketIdParam = req.params.id;
    const ticketId = ticketIdParam ? parseInt(ticketIdParam, 10) : NaN;
    const { priority, priorityId } = req.body;

    if (isNaN(ticketId) || ticketId < 1) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ticket ID',
      });
    }

    let newPriorityId = priorityId;

    if (!newPriorityId && priority) {
      const [rows] = await pool.query(
        `SELECT priority_id FROM ${process.env.DB_PREFIX}ticket_priority WHERE priority = ? LIMIT 1`,
        [priority]
      );
      if (rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Unknown priority',
        });
      }
      newPriorityId = rows[0].priority_id;
    }

    if (!newPriorityId) {
      return res.status(400).json({
        success: false,
        message: 'Priority or priorityId is required',
      });
    }

    await pool.query(
      `UPDATE ${process.env.DB_PREFIX}ticket__cdata
       SET priority = ?
       WHERE ticket_id = ?`,
      [newPriorityId, ticketId]
    );

    await pool.query(
      `UPDATE ${process.env.DB_PREFIX}ticket
       SET updated = NOW()
       WHERE ticket_id = ?`,
      [ticketId]
    );

    res.json({
      success: true,
      message: 'Priority updated successfully',
      data: { ticket_id: ticketId, priority_id: newPriorityId },
    });
  } catch (error) {
    console.error('Admin update priority error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update priority',
    });
  }
};

// Get ticket messages (admin - no ownership check)
exports.getTicketMessages = async (req, res) => {
  try {
    const ticketId = parseInt(req.params.id, 10);

    if (isNaN(ticketId) || ticketId < 1) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ticket ID',
      });
    }

    const prefix = process.env.DB_PREFIX || 'ost_';

    // Get the thread for this ticket
    const [threads] = await pool.query(
      `SELECT id FROM ${prefix}thread WHERE object_id = ? AND object_type = 'T' LIMIT 1`,
      [ticketId]
    );

    if (threads.length === 0) {
      return res.json({
        success: true,
        messages: [],
      });
    }

    const threadId = threads[0].id;

    // Fetch all thread entries
    const [messages] = await pool.query(
      `SELECT 
        e.id,
        e.thread_id,
        e.user_id,
        e.staff_id,
        e.type,
        e.poster as user_name,
        e.body as message,
        e.created,
        e.updated
      FROM ${prefix}thread_entry e
      WHERE e.thread_id = ?
      ORDER BY e.created ASC`,
      [threadId]
    );

    // For admin view, mark which are from staff vs user
    const enrichedMessages = messages.map(msg => ({
      ...msg,
      is_staff: msg.staff_id > 0,
      is_own: msg.staff_id > 0, // Admin sees staff replies as "own"
      message: msg.message ? msg.message.replace(/<[^>]*>/g, '').trim() : '',
    }));

    res.json({
      success: true,
      messages: enrichedMessages,
    });
  } catch (error) {
    console.error('Admin get ticket messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch messages',
    });
  }
};

// Reply to ticket (admin - no ownership check, posts as staff)
exports.replyToTicket = async (req, res) => {
  try {
    const ticketId = parseInt(req.params.id, 10);
    const { message } = req.body;
    const adminUserId = req.user.userId;

    if (isNaN(ticketId) || ticketId < 1) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ticket ID',
      });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message is required',
      });
    }

    const prefix = process.env.DB_PREFIX || 'ost_';

    // Get the thread for this ticket
    const [threads] = await pool.query(
      `SELECT id FROM ${prefix}thread WHERE object_id = ? AND object_type = 'T' LIMIT 1`,
      [ticketId]
    );

    if (threads.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket thread not found',
      });
    }

    const threadId = threads[0].id;

    // Get admin's name
    const [userRows] = await pool.query(
      `SELECT name FROM ${prefix}user WHERE id = ?`,
      [adminUserId]
    );
    const posterName = (userRows.length > 0 && userRows[0].name) ? userRows[0].name + ' (Admin)' : 'Admin';

    // Insert reply as staff response (type 'R' for response, staff_id set)
    const [insertResult] = await pool.query(
      `INSERT INTO ${prefix}thread_entry 
        (pid, thread_id, staff_id, user_id, type, flags, poster, body, format, ip_address, created, updated)
       VALUES (0, ?, ?, 0, 'R', 0, ?, ?, 'html', '', NOW(), NOW())`,
      [threadId, adminUserId, posterName, message.trim()]
    );

    // Update ticket timestamp
    await pool.query(
      `UPDATE ${prefix}ticket SET updated = NOW() WHERE ticket_id = ?`,
      [ticketId]
    );

    // Write to osTicket system log
    try {
      await pool.query(
        `INSERT INTO ${prefix}syslog (log_type, title, log, logger, ip_address, created, updated)
         VALUES ('Warning', ?, ?, 'API', '', NOW(), NOW())`,
        [
          `Admin Ticket Reply`,
          `Admin "${posterName}" (ID: ${adminUserId}) replied to ticket ID ${ticketId} via the mobile API.`
        ]
      );
    } catch (logErr) {
      console.warn('Syslog insert failed (non-fatal):', logErr.message);
    }

    res.status(201).json({
      success: true,
      message: 'Reply sent successfully',
      data: {
        id: insertResult.insertId,
        thread_id: threadId,
        user_name: posterName,
        message: message.trim(),
        is_own: true,
        is_staff: true,
        created: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Admin reply to ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send reply',
    });
  }
};
