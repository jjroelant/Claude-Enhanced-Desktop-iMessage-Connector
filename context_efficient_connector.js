// Context-efficient Enhanced iMessage Connector
// Minimal character usage, combined operations

class iMessageMCPServer {
  // ... existing constructor and helper methods ...

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'search_and_read',
            description: 'Search for contacts/groups and immediately read their messages (most efficient)',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query (name, phone, email, or group name)',
                },
                include_groups: {
                  type: 'boolean',
                  description: 'Include group chats in search (default: true)',
                  default: true,
                },
                limit: {
                  type: 'number',
                  description: 'Max messages per conversation (default: 20)',
                  default: 20,
                },
                days_back: {
                  type: 'number',
                  description: 'Days to look back (default: 30)',
                  default: 30,
                },
                minimal: {
                  type: 'boolean',
                  description: 'Ultra-minimal output to save context (default: true)',
                  default: true,
                }
              },
              required: ['query'],
            },
          },
          {
            name: 'read_conversation',
            description: 'Read messages from specific contact or group by ID',
            inputSchema: {
              type: 'object',
              properties: {
                identifier: {
                  type: 'string',
                  description: 'Phone number, email, or group chat ID (prefix with "group:" for groups)',
                },
                limit: {
                  type: 'number',
                  description: 'Max messages (default: 30)',
                  default: 30,
                },
                days_back: {
                  type: 'number',
                  description: 'Days back (default: 30)',
                  default: 30,
                },
                format: {
                  type: 'string',
                  enum: ['minimal', 'compact', 'full'],
                  description: 'Output format (default: minimal)',
                  default: 'minimal',
                }
              },
              required: ['identifier'],
            },
          },
          {
            name: 'quick_stats',
            description: 'Get conversation statistics without full message content',
            inputSchema: {
              type: 'object',
              properties: {
                identifier: {
                  type: 'string',
                  description: 'Phone number, email, or "group:ID" for group chats',
                },
                days_back: {
                  type: 'number',
                  description: 'Days to analyze (default: 60)',
                  default: 60,
                }
              },
              required: ['identifier'],
            },
          }
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;

        switch (name) {
          case 'search_and_read':
            return await this.searchAndRead(
              args.query,
              args.include_groups,
              args.limit,
              args.days_back,
              args.minimal
            );
          case 'read_conversation':
            return await this.readConversation(
              args.identifier,
              args.limit,
              args.days_back,
              args.format
            );
          case 'quick_stats':
            return await this.getQuickStats(args.identifier, args.days_back);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }]
        };
      }
    });
  }

  // Primary method: Search and immediately read messages
  async searchAndRead(query, includeGroups = true, limit = 20, daysBack = 30, minimal = true) {
    const db = await this.openDatabase();
    
    try {
      const threshold = this.calculateAppleTimestamp(daysBack);
      const results = [];

      // Search individual contacts
      const contacts = await db.all(
        `SELECT ROWID, id, service FROM handle 
         WHERE id LIKE ? OR id LIKE ?
         LIMIT 5`,
        [`%${query}%`, `%${query.replace(/[^0-9]/g, '')}%`]
      );

      // Get messages for each contact
      for (const contact of contacts) {
        const messages = await db.all(
          `SELECT 
             datetime(date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch') as dt,
             text,
             is_from_me
           FROM message 
           WHERE handle_id = ? AND date > ? AND text IS NOT NULL AND text != ''
           ORDER BY date DESC LIMIT ?`,
          [contact.ROWID, threshold, limit]
        );

        if (messages.length > 0) {
          results.push({
            type: 'individual',
            contact: this.cleanPhone(contact.id),
            count: messages.length,
            messages: minimal ? this.formatMinimal(messages) : messages
          });
        }
      }

      // Search group chats if requested
      if (includeGroups) {
        const groups = await db.all(
          `SELECT ROWID, display_name, chat_identifier FROM chat 
           WHERE display_name LIKE ? OR chat_identifier LIKE ?
           LIMIT 3`,
          [`%${query}%`, `%${query}%`]
        );

        for (const group of groups) {
          const messages = await db.all(
            `SELECT 
               datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch') as dt,
               m.text,
               h.id as sender,
               m.is_from_me
             FROM chat_message_join cmj
             JOIN message m ON cmj.message_id = m.ROWID
             LEFT JOIN handle h ON m.handle_id = h.ROWID
             WHERE cmj.chat_id = ? AND m.date > ? AND m.text IS NOT NULL AND m.text != ''
             ORDER BY m.date DESC LIMIT ?`,
            [group.ROWID, threshold, limit]
          );

          if (messages.length > 0) {
            results.push({
              type: 'group',
              name: group.display_name || `Group ${group.ROWID}`,
              id: group.ROWID,
              count: messages.length,
              messages: minimal ? this.formatMinimalGroup(messages) : messages
            });
          }
        }
      }

      await db.close();

      // Ultra-compact output
      if (minimal) {
        const output = results.map(r => {
          const header = r.type === 'group' ? 
            `📱 ${r.name} (${r.count})` : 
            `👤 ${r.contact} (${r.count})`;
          
          return `${header}\n${r.messages.join('\n')}`;
        }).join('\n\n');

        return {
          content: [{ type: 'text', text: output }]
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ query, results }, null, 2) }]
      };

    } catch (error) {
      await db.close();
      throw error;
    }
  }

  // Minimal message formatting - saves massive context
  formatMinimal(messages) {
    return messages.map(m => {
      const time = new Date(m.dt).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      });
      const sender = m.is_from_me ? 'You' : 'Them';
      const text = (m.text || '').length > 80 ? 
        m.text.substring(0, 77) + '...' : m.text;
      
      return `${time} ${sender}: ${text}`;
    });
  }

  formatMinimalGroup(messages) {
    return messages.map(m => {
      const time = new Date(m.dt).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      });
      const sender = m.is_from_me ? 'You' : this.cleanPhone(m.sender);
      const text = (m.text || '').length > 70 ? 
        m.text.substring(0, 67) + '...' : m.text;
      
      return `${time} ${sender}: ${text}`;
    });
  }

  // Streamlined conversation reading
  async readConversation(identifier, limit = 30, daysBack = 30, format = 'minimal') {
    const db = await this.openDatabase();
    
    try {
      const threshold = this.calculateAppleTimestamp(daysBack);
      let messages;
      let conversationInfo;

      if (identifier.startsWith('group:')) {
        // Group conversation
        const chatId = parseInt(identifier.replace('group:', ''));
        
        const groupInfo = await db.get(
          `SELECT display_name FROM chat WHERE ROWID = ?`,
          [chatId]
        );

        messages = await db.all(
          `SELECT 
             datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch') as dt,
             m.text,
             h.id as sender,
             m.is_from_me
           FROM chat_message_join cmj
           JOIN message m ON cmj.message_id = m.ROWID
           LEFT JOIN handle h ON m.handle_id = h.ROWID
           WHERE cmj.chat_id = ? AND m.date > ? AND m.text IS NOT NULL AND m.text != ''
           ORDER BY m.date DESC LIMIT ?`,
          [chatId, threshold, limit]
        );

        conversationInfo = `Group: ${groupInfo?.display_name || chatId}`;
      } else {
        // Individual conversation
        const handleIds = await this.findHandleIds(identifier);
        if (handleIds.length === 0) {
          throw new Error(`Contact not found: ${identifier}`);
        }

        messages = await db.all(
          `SELECT 
             datetime(date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch') as dt,
             text,
             is_from_me
           FROM message 
           WHERE handle_id IN (${handleIds.map(() => '?').join(',')})
             AND date > ? AND text IS NOT NULL AND text != ''
           ORDER BY date DESC LIMIT ?`,
          [...handleIds, threshold, limit]
        );

        conversationInfo = `Contact: ${this.cleanPhone(identifier)}`;
      }

      await db.close();

      // Format based on requested style
      let output;
      if (format === 'minimal') {
        const formatted = identifier.startsWith('group:') ? 
          this.formatMinimalGroup(messages) : 
          this.formatMinimal(messages);
        
        output = `${conversationInfo} (${messages.length})\n${formatted.join('\n')}`;
      } else if (format === 'compact') {
        output = {
          conversation: conversationInfo,
          count: messages.length,
          messages: identifier.startsWith('group:') ? 
            this.formatMinimalGroup(messages) : 
            this.formatMinimal(messages)
        };
      } else {
        // Full format
        output = {
          conversation: conversationInfo,
          count: messages.length,
          period_days: daysBack,
          messages: messages
        };
      }

      return {
        content: [{ 
          type: 'text', 
          text: typeof output === 'string' ? output : JSON.stringify(output, null, 2)
        }]
      };

    } catch (error) {
      await db.close();
      throw error;
    }
  }

  // Quick stats without message content
  async getQuickStats(identifier, daysBack = 60) {
    const db = await this.openDatabase();
    
    try {
      const threshold = this.calculateAppleTimestamp(daysBack);
      let stats;

      if (identifier.startsWith('group:')) {
        const chatId = parseInt(identifier.replace('group:', ''));
        
        stats = await db.get(
          `SELECT 
             COUNT(*) as total,
             COUNT(CASE WHEN m.is_from_me = 0 THEN 1 END) as received,
             COUNT(CASE WHEN m.is_from_me = 1 THEN 1 END) as sent,
             COUNT(DISTINCT h.id) as participants
           FROM chat_message_join cmj
           JOIN message m ON cmj.message_id = m.ROWID
           LEFT JOIN handle h ON m.handle_id = h.ROWID
           WHERE cmj.chat_id = ? AND m.date > ?`,
          [chatId, threshold]
        );
        
        stats.type = 'group';
        stats.identifier = identifier;
      } else {
        const handleIds = await this.findHandleIds(identifier);
        if (handleIds.length === 0) {
          throw new Error(`Contact not found: ${identifier}`);
        }

        stats = await db.get(
          `SELECT 
             COUNT(*) as total,
             COUNT(CASE WHEN is_from_me = 0 THEN 1 END) as received,
             COUNT(CASE WHEN is_from_me = 1 THEN 1 END) as sent
           FROM message 
           WHERE handle_id IN (${handleIds.map(() => '?').join(',')})
             AND date > ?`,
          [...handleIds, threshold]
        );
        
        stats.type = 'individual';
        stats.identifier = this.cleanPhone(identifier);
      }

      await db.close();

      // Ultra-compact stats output
      const output = `${stats.identifier} - ${stats.total} msgs (↑${stats.sent} ↓${stats.received})${stats.participants ? ` ${stats.participants} people` : ''}`;

      return {
        content: [{ type: 'text', text: output }]
      };

    } catch (error) {
      await db.close();
      throw error;
    }
  }

  // Combined search that finds both individuals and groups
  async searchAndRead(query, includeGroups = true, limit = 20, daysBack = 30, minimal = true) {
    const db = await this.openDatabase();
    
    try {
      const threshold = this.calculateAppleTimestamp(daysBack);
      const conversations = [];

      // Search individual contacts
      const contacts = await db.all(
        `SELECT ROWID, id FROM handle 
         WHERE id LIKE ? OR id LIKE ?
         LIMIT 3`,
        [`%${query}%`, `%${query.replace(/[^0-9]/g, '')}%`]
      );

      // Get recent messages for individuals
      for (const contact of contacts) {
        const messages = await db.all(
          `SELECT 
             datetime(date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch') as dt,
             text, is_from_me
           FROM message 
           WHERE handle_id = ? AND date > ? AND text IS NOT NULL AND text != ''
           ORDER BY date DESC LIMIT ?`,
          [contact.ROWID, threshold, limit]
        );

        if (messages.length > 0) {
          conversations.push({
            id: contact.id,
            type: 'contact',
            count: messages.length,
            msgs: this.ultraMinimal(messages)
          });
        }
      }

      // Search groups if requested
      if (includeGroups) {
        const groups = await db.all(
          `SELECT ROWID, display_name FROM chat 
           WHERE display_name LIKE ?
           LIMIT 2`,
          [`%${query}%`]
        );

        for (const group of groups) {
          const messages = await db.all(
            `SELECT 
               datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch') as dt,
               m.text, m.is_from_me, h.id as sender
             FROM chat_message_join cmj
             JOIN message m ON cmj.message_id = m.ROWID
             LEFT JOIN handle h ON m.handle_id = h.ROWID
             WHERE cmj.chat_id = ? AND m.date > ? AND m.text IS NOT NULL AND m.text != ''
             ORDER BY m.date DESC LIMIT ?`,
            [group.ROWID, threshold, limit]
          );

          if (messages.length > 0) {
            conversations.push({
              id: `group:${group.ROWID}`,
              type: 'group',
              name: group.display_name || `Group ${group.ROWID}`,
              count: messages.length,
              msgs: this.ultraMinimalGroup(messages)
            });
          }
        }
      }

      await db.close();

      if (!conversations.length) {
        return { content: [{ type: 'text', text: `No conversations found for: ${query}` }] };
      }

      // Ultra-efficient output format
      if (minimal) {
        const output = conversations.map(c => {
          const header = c.type === 'group' ? 
            `📱${c.name} (${c.count})` : 
            `👤${this.cleanPhone(c.id)} (${c.count})`;
          
          return `${header}\n${c.msgs.join('\n')}`;
        }).join('\n\n');

        return { content: [{ type: 'text', text: output }] };
      }

      return { content: [{ type: 'text', text: JSON.stringify(conversations, null, 2) }] };

    } catch (error) {
      await db.close();
      throw error;
    }
  }

  // Ultra-minimal formatting - maximum context efficiency
  ultraMinimal(messages) {
    return messages.map(m => {
      const d = new Date(m.dt);
      const time = `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2,'0')}`;
      const who = m.is_from_me ? 'You' : 'Them';
      const text = (m.text || '').substring(0, 60);
      
      return `${time} ${who}: ${text}`;
    });
  }

  ultraMinimalGroup(messages) {
    return messages.map(m => {
      const d = new Date(m.dt);
      const time = `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2,'0')}`;
      const who = m.is_from_me ? 'You' : this.cleanPhone(m.sender).substring(0, 8);
      const text = (m.text || '').substring(0, 55);
      
      return `${time} ${who}: ${text}`;
    });
  }

  // Helper: Clean phone numbers for display
  cleanPhone(phone) {
    if (!phone) return 'Unknown';
    if (phone.includes('@')) return phone.split('@')[0];
    
    const digits = phone.replace(/\D/g, '');
    if (digits.length >= 10) {
      return digits.slice(-4); // Just last 4 digits for minimal display
    }
    return phone;
  }

  // Read specific conversation by identifier
  async readConversation(identifier, limit = 30, daysBack = 30, format = 'minimal') {
    const db = await this.openDatabase();
    
    try {
      const threshold = this.calculateAppleTimestamp(daysBack);
      let messages;
      let info;

      if (identifier.startsWith('group:')) {
        const chatId = parseInt(identifier.replace('group:', ''));
        
        messages = await db.all(
          `SELECT 
             datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch') as dt,
             m.text, m.is_from_me, h.id as sender
           FROM chat_message_join cmj
           JOIN message m ON cmj.message_id = m.ROWID
           LEFT JOIN handle h ON m.handle_id = h.ROWID
           WHERE cmj.chat_id = ? AND m.date > ? AND m.text IS NOT NULL AND m.text != ''
           ORDER BY m.date DESC LIMIT ?`,
          [chatId, threshold, limit]
        );

        info = `Group ${chatId}`;
      } else {
        const handleIds = await this.findHandleIds(identifier);
        if (handleIds.length === 0) {
          throw new Error(`Contact not found: ${identifier}`);
        }

        messages = await db.all(
          `SELECT 
             datetime(date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch') as dt,
             text, is_from_me
           FROM message 
           WHERE handle_id IN (${handleIds.map(() => '?').join(',')})
             AND date > ? AND text IS NOT NULL AND text != ''
           ORDER BY date DESC LIMIT ?`,
          [...handleIds, threshold, limit]
        );

        info = this.cleanPhone(identifier);
      }

      await db.close();

      // Format output
      if (format === 'minimal') {
        const formatted = identifier.startsWith('group:') ? 
          this.ultraMinimalGroup(messages) : 
          this.ultraMinimal(messages);
        
        return {
          content: [{ type: 'text', text: `${info} (${messages.length})\n${formatted.join('\n')}` }]
        };
      }

      // Other formats...
      return {
        content: [{ type: 'text', text: JSON.stringify({ info, count: messages.length, messages }, null, 2) }]
      };

    } catch (error) {
      await db.close();
      throw error;
    }
  }

  // Enhanced findHandleIds to work with the existing method
  async findHandleIds(phoneNumber) {
    const db = await this.openDatabase();
    
    try {
      const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
      
      const handles = await db.all(
        `SELECT ROWID FROM handle 
         WHERE id LIKE ? OR id LIKE ? OR id LIKE ?`,
        [`%${phoneNumber}%`, `%${cleanNumber}%`, `%+${cleanNumber}%`]
      );

      await db.close();
      return handles.map(h => h.ROWID);
    } catch (error) {
      await db.close();
      throw error;
    }
  }

  // ... keep existing calculateAppleTimestamp and other helper methods ...
}