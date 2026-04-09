const pool = require('../config/database');
const { sendPushToAdmins } = require('../utils/pushNotifications');
const { sendTicketCreationEmail } = require('../utils/mailer');

// Create ticket
exports.createTicket = async (req, res) => {
  try {
    const userId = req.user.userId;
    console.log('--- NEW TICKET PAYLOAD ---');
    console.log(req.body);
    console.log('--------------------------');
    const { subject, message, priority = 2, topicId = 1, deptId = 1, ticketSource = 'API', slaPlanId = 0, dueDate = null, assignTo = 0 } = req.body;

    const parsedDeptId = parseInt(deptId, 10) || 1;
    const parsedTopicId = parseInt(topicId, 10) || 1;
    const parsedSlaPlanId = parseInt(slaPlanId, 10) || 0;
    const parsedAssignTo = parseInt(assignTo, 10) || 0;
    const parsedPriority = parseInt(priority, 10) || 2;

    if (!subject || !message) {
      return res.status(400).json({
        success: false,
        message: 'Subject and message are required'
      });
    }

    const prefix = process.env.DB_PREFIX || 'ost_';

    const [[userEmailRow]] = await pool.query(
      `SELECT id, address FROM ${prefix}user_email WHERE user_id = ? LIMIT 1`,
      [userId]
    );
    if (!userEmailRow) {
      return res.status(400).json({
        success: false,
        message: 'User email not found'
      });
    }
    const userEmailId = userEmailRow.id;
    const userEmailAddress = userEmailRow.address;

    const ticketNumber = String(Math.floor(100000 + Math.random() * 900000));

    const [ticketInsert] = await pool.query(
      `INSERT INTO ${prefix}ticket (
        number, user_id, user_email_id, status_id, dept_id, sla_id, topic_id,
        staff_id, team_id, email_id, lock_id, flags, sort, ip_address, source,
        source_extra, isoverdue, isanswered, created, updated, duedate
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, 0, 0, 0, 0, 0, '', ?, '', 0, 0, NOW(), NOW(), ?)`,
      [ticketNumber, userId, userEmailId, parsedDeptId, parsedSlaPlanId, parsedTopicId, parsedAssignTo, ticketSource || 'API', dueDate || null]
    );
    const ticketId = ticketInsert.insertId;

    await pool.query(
      `INSERT INTO ${prefix}ticket__cdata (ticket_id, subject, priority) VALUES (?, ?, ?)`,
      [ticketId, subject, parsedPriority]
    );

    const [threadInsert] = await pool.query(
      `INSERT INTO ${prefix}thread (object_id, object_type, created) VALUES (?, 'T', NOW())`,
      [ticketId]
    );
    const threadId = threadInsert.insertId;

    const [userRow] = await pool.query(`SELECT name FROM ${prefix}user WHERE id = ?`, [userId]);
    const posterName = (userRow && userRow[0] && userRow[0].name) ? userRow[0].name : 'User';

    await pool.query(
      `INSERT INTO ${prefix}thread_entry (pid, thread_id, staff_id, user_id, type, flags, poster, body, format, ip_address, created, updated)
       VALUES (0, ?, 0, ?, 'M', 0, ?, ?, 'html', '', NOW(), NOW())`,
      [threadId, userId, posterName, message]
    );

    // Write to osTicket system log so it appears in Dashboard → System Logs
    try {
      await pool.query(
        `INSERT INTO ${prefix}syslog (log_type, title, log, logger, ip_address, created, updated)
         VALUES ('Warning', ?, ?, 'API', '', NOW(), NOW())`,
        [
          `Create Ticket`,
          `Ticket "${subject}" (ID: ${ticketId}, #${ticketNumber}) was created by user ID ${userId} via the mobile API.`
        ]
      );
    } catch (logError) {
      console.error('Failed to log to syslog:', logError);
    }

    // Trigger email notification to the user (non-blocking background task)
    if (userEmailAddress) {
      sendTicketCreationEmail(userEmailAddress, posterName, ticketNumber, subject, message)
        .then(() => console.log(`✓ Ticket creation email sent to ${userEmailAddress} for ticket #${ticketNumber}`))
        .catch(emailError => console.error('✗ Failed to send ticket creation email (non-blocking):', emailError.message));
    }

    res.status(201).json({
      success: true,
      message: 'Ticket created successfully',
      data: {
        ticket_id: ticketId,
        number: ticketNumber,
        subject,
        status_id: 1,
      }
    });
  } catch (error) {
    console.error('Create ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create ticket'
    });
  }
};

// Get user tickets
exports.getUserTickets = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status = 'open', page = 1, limit = 20 } = req.query;

    const prefix = process.env.DB_PREFIX || 'ost_';
    const offset = (page - 1) * limit;
    let statusCondition = '';
    const queryParams = [userId];

    if (status !== 'all') {
      const [statuses] = await pool.query(
        `SELECT id FROM ${prefix}ticket_status WHERE state = ?`,
        [status]
      );
      if (statuses.length > 0) {
        statusCondition = 'AND t.status_id = ?';
        queryParams.push(statuses[0].id);
      }
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
        p.priority as priority_name
      FROM ${prefix}ticket t
      LEFT JOIN ${prefix}ticket__cdata c ON t.ticket_id = c.ticket_id
      LEFT JOIN ${prefix}ticket_status s ON t.status_id = s.id
      LEFT JOIN ${prefix}ticket_priority p ON c.priority = p.priority_id
      WHERE t.user_id = ? ${statusCondition}
      ORDER BY t.created DESC
      LIMIT ? OFFSET ?`,
      [...queryParams, parseInt(limit), offset]
    );

    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total 
       FROM ${prefix}ticket t
       WHERE t.user_id = ? ${statusCondition}`,
      queryParams
    );

    res.json({
      success: true,
      tickets,
      total: countResult[0].total,
      page: parseInt(page),
    });

  } catch (error) {
    console.error('Get tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tickets'
    });
  }
};

// Get single ticket
exports.getTicketDetail = async (req, res) => {
  try {
    const userId = req.user.userId;
    const ticketIdParam = req.params.id;
    const ticketId = ticketIdParam ? parseInt(ticketIdParam, 10) : NaN;
    if (isNaN(ticketId) || ticketId < 1) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ticket ID'
      });
    }

    const prefix = process.env.DB_PREFIX || 'ost_';

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
        p.priority as priority_name,
        ht.topic as help_topic,
        d.name as department_name,
        sla.name as sla_name
      FROM ${prefix}ticket t
      LEFT JOIN ${prefix}ticket__cdata c ON t.ticket_id = c.ticket_id
      LEFT JOIN ${prefix}thread th ON th.object_id = t.ticket_id AND th.object_type = 'T'
      LEFT JOIN ${prefix}thread_entry e ON th.id = e.thread_id AND e.pid = 0
      LEFT JOIN ${prefix}user u ON t.user_id = u.id
      LEFT JOIN ${prefix}user_email ue ON ue.user_id = u.id AND ue.id = t.user_email_id
      LEFT JOIN ${prefix}ticket_status s ON t.status_id = s.id
      LEFT JOIN ${prefix}ticket_priority p ON c.priority = p.priority_id
      LEFT JOIN ${prefix}help_topic ht ON t.topic_id = ht.topic_id
      LEFT JOIN ${prefix}department d ON t.dept_id = d.id
      LEFT JOIN ${prefix}sla sla ON t.sla_id = sla.id
      WHERE t.ticket_id = ? AND t.user_id = ?`,
      [ticketId, userId]
    );

    if (!tickets || tickets.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    res.json({
      success: true,
      data: tickets[0]
    });

  } catch (error) {
    console.error('Get ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch ticket'
    });
  }
};

// Update ticket (EDIT)
exports.updateTicket = async (req, res) => {
  try {
    const userId = req.user.userId;
    const ticketId = req.params.id;
    const { subject, priority } = req.body;

    const prefix = process.env.DB_PREFIX || 'ost_';

    // Verify ownership
    const [tickets] = await pool.query(
      `SELECT ticket_id FROM ${prefix}ticket 
       WHERE ticket_id = ? AND user_id = ?`,
      [ticketId, userId]
    );

    if (tickets.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found or access denied'
      });
    }

    // Update priority in ticket__cdata
    if (priority !== undefined) {
      await pool.query(
        `UPDATE ${prefix}ticket__cdata 
         SET priority = ? 
         WHERE ticket_id = ?`,
        [priority, ticketId]
      );
    }

    // Update subject in ticket__cdata
    if (subject !== undefined) {
      await pool.query(
        `UPDATE ${prefix}ticket__cdata 
         SET subject = ? 
         WHERE ticket_id = ?`,
        [subject, ticketId]
      );
    }

    // Update ticket updated timestamp if any changes were made
    if (subject !== undefined || priority !== undefined) {
      await pool.query(
        `UPDATE ${prefix}ticket 
         SET updated = NOW() 
         WHERE ticket_id = ?`,
        [ticketId]
      );
    }

    res.json({
      success: true,
      message: 'Ticket updated successfully',
      data: { ticket_id: ticketId }
    });

  } catch (error) {
    console.error('Update ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update ticket'
    });
  }
};

// Delete ticket
exports.deleteTicket = async (req, res) => {
  try {
    const userId = req.user.userId;
    const ticketId = req.params.id;

    const prefix = process.env.DB_PREFIX || 'ost_';

    // Verify ownership
    const [tickets] = await pool.query(
      `SELECT ticket_id FROM ${prefix}ticket 
       WHERE ticket_id = ? AND user_id = ?`,
      [ticketId, userId]
    );

    if (tickets.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found or access denied'
      });
    }

    // Fetch ticket number before deletion for logging
    const [[ticketMeta]] = await pool.query(
      `SELECT t.number, c.subject FROM ${prefix}ticket t
       LEFT JOIN ${prefix}ticket__cdata c ON c.ticket_id = t.ticket_id
       WHERE t.ticket_id = ? LIMIT 1`,
      [ticketId]
    );
    const ticketNumber = ticketMeta ? ticketMeta.number : ticketId;
    const ticketSubject = ticketMeta ? ticketMeta.subject : 'N/A';

    // Delete ticket (this will cascade to related tables if FK constraints are set)
    await pool.query(
      `DELETE FROM ${prefix}ticket WHERE ticket_id = ?`,
      [ticketId]
    );

    // Write deletion to osTicket system log
    try {
      await pool.query(
        `INSERT INTO ${prefix}syslog (log_type, title, log, logger, ip_address, created, updated)
         VALUES ('Warning', ?, ?, 'API', '', NOW(), NOW())`,
        [
          `Delete Ticket`,
          `Ticket "${ticketSubject}" (ID: ${ticketId}, #${ticketNumber}) was deleted by user ID ${userId} via the mobile API.`
        ]
      );
    } catch (logErr) {
      console.warn('Syslog insert failed (non-fatal):', logErr.message);
    }

    res.json({
      success: true,
      message: 'Ticket deleted successfully'
    });

  } catch (error) {
    console.error('Delete ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete ticket'
    });
  }
};

// Get ticket statistics
exports.getStats = async (req, res) => {
  try {
    const userId = req.user.userId;

    const [stats] = await pool.query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN s.state = 'open' THEN 1 ELSE 0 END) as open,
        SUM(CASE WHEN s.state = 'closed' THEN 1 ELSE 0 END) as closed
      FROM ${process.env.DB_PREFIX}ticket t
      LEFT JOIN ${process.env.DB_PREFIX}ticket_status s ON t.status_id = s.id
      WHERE t.user_id = ?`,
      [userId]
    );

    res.json({
      success: true,
      data: stats[0]
    });

  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics'
    });
  }
};

// Get ticket messages/replies
exports.getTicketMessages = async (req, res) => {
  try {
    const userId = req.user.userId;
    const ticketId = parseInt(req.params.id, 10);

    if (isNaN(ticketId) || ticketId < 1) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ticket ID'
      });
    }

    const prefix = process.env.DB_PREFIX || 'ost_';

    // Verify the user owns this ticket
    const [tickets] = await pool.query(
      `SELECT ticket_id FROM ${prefix}ticket WHERE ticket_id = ? AND user_id = ?`,
      [ticketId, userId]
    );

    if (tickets.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found or access denied'
      });
    }

    // Get the thread for this ticket
    const [threads] = await pool.query(
      `SELECT id FROM ${prefix}thread WHERE object_id = ? AND object_type = 'T' LIMIT 1`,
      [ticketId]
    );

    if (threads.length === 0) {
      return res.json({
        success: true,
        messages: []
      });
    }

    const threadId = threads[0].id;

    // Fetch all thread entries (messages) for this thread
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

    // Mark which messages are from the current user
    const enrichedMessages = messages.map(msg => ({
      ...msg,
      is_own: msg.user_id === userId,
      // Clean up HTML tags from body if present
      message: msg.message ? msg.message.replace(/<[^>]*>/g, '').trim() : '',
    }));

    res.json({
      success: true,
      messages: enrichedMessages
    });

  } catch (error) {
    console.error('Get ticket messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch messages'
    });
  }
};

// Reply to a ticket
exports.replyToTicket = async (req, res) => {
  try {
    const userId = req.user.userId;
    const ticketId = parseInt(req.params.id, 10);
    const { message } = req.body;

    if (isNaN(ticketId) || ticketId < 1) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ticket ID'
      });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    const prefix = process.env.DB_PREFIX || 'ost_';

    // Verify the user owns this ticket
    const [tickets] = await pool.query(
      `SELECT ticket_id FROM ${prefix}ticket WHERE ticket_id = ? AND user_id = ?`,
      [ticketId, userId]
    );

    if (tickets.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found or access denied'
      });
    }

    // Get the thread for this ticket
    const [threads] = await pool.query(
      `SELECT id FROM ${prefix}thread WHERE object_id = ? AND object_type = 'T' LIMIT 1`,
      [ticketId]
    );

    if (threads.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket thread not found'
      });
    }

    const threadId = threads[0].id;

    // Get the user's name for the poster field
    const [userRows] = await pool.query(
      `SELECT name FROM ${prefix}user WHERE id = ?`,
      [userId]
    );
    const posterName = (userRows.length > 0 && userRows[0].name) ? userRows[0].name : 'User';

    // Insert the reply into thread_entry
    const [insertResult] = await pool.query(
      `INSERT INTO ${prefix}thread_entry 
        (pid, thread_id, staff_id, user_id, type, flags, poster, body, format, ip_address, created, updated)
       VALUES (0, ?, 0, ?, 'M', 0, ?, ?, 'html', '', NOW(), NOW())`,
      [threadId, userId, posterName, message.trim()]
    );

    // Update the ticket's updated timestamp
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
          `Ticket Reply`,
          `User "${posterName}" (ID: ${userId}) replied to ticket ID ${ticketId} via the mobile API.`
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
        user_id: userId,
        user_name: posterName,
        message: message.trim(),
        is_own: true,
        created: new Date().toISOString(),
      }
    });

    // Send push notification to admins (fire-and-forget)
    const [ticketMeta] = await pool.query(
      `SELECT c.subject FROM ${prefix}ticket__cdata c WHERE c.ticket_id = ? LIMIT 1`,
      [ticketId]
    );
    const subject = ticketMeta.length > 0 ? ticketMeta[0].subject : `Ticket #${ticketId}`;
    sendPushToAdmins(
      'New Reply from User',
      `${posterName} replied to "${subject}"`,
      { ticketId: String(ticketId), type: 'user_reply' }
    );

  } catch (error) {
    console.error('Reply to ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send reply'
    });
  }
};

// Search tickets
exports.searchTickets = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { q = '', status = 'all', page = 1, limit = 20 } = req.query;

    const prefix = process.env.DB_PREFIX || 'ost_';
    const offset = (page - 1) * limit;
    const params = [userId];
    let conditions = 'WHERE t.user_id = ?';

    // Status filter
    if (status !== 'all') {
      const [statuses] = await pool.query(
        `SELECT id FROM ${prefix}ticket_status WHERE state = ?`,
        [status]
      );
      if (statuses.length > 0) {
        conditions += ' AND t.status_id = ?';
        params.push(statuses[0].id);
      }
    }

    // Search filter
    if (q.trim()) {
      conditions += ' AND (t.number LIKE ? OR c.subject LIKE ? OR e.body LIKE ?)';
      const term = `%${q.trim()}%`;
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
        p.priority as priority_name
      FROM ${prefix}ticket t
      LEFT JOIN ${prefix}ticket__cdata c ON t.ticket_id = c.ticket_id
      LEFT JOIN ${prefix}ticket_status s ON t.status_id = s.id
      LEFT JOIN ${prefix}ticket_priority p ON c.priority = p.priority_id
      LEFT JOIN ${prefix}thread th ON th.object_id = t.ticket_id AND th.object_type = 'T'
      LEFT JOIN ${prefix}thread_entry e ON th.id = e.thread_id
      ${conditions}
      GROUP BY t.ticket_id
      ORDER BY t.created DESC
      LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const countParams = [...params];
    const [countResult] = await pool.query(
      `SELECT COUNT(DISTINCT t.ticket_id) as total
       FROM ${prefix}ticket t
       LEFT JOIN ${prefix}ticket__cdata c ON t.ticket_id = c.ticket_id
       LEFT JOIN ${prefix}thread th ON th.object_id = t.ticket_id AND th.object_type = 'T'
       LEFT JOIN ${prefix}thread_entry e ON th.id = e.thread_id AND e.pid = 0
       ${conditions}`,
      countParams
    );

    res.json({
      success: true,
      tickets,
      total: countResult[0].total,
      page: parseInt(page),
    });

  } catch (error) {
    console.error('Search tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search tickets'
    });
  }
};