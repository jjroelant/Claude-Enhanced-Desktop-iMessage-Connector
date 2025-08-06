#!/usr/bin/env node

/**
 * Custom iMessage MCP Server for Claude Desktop
 * Fixes the issues with the built-in iMessage connector:
 * - Handles multiple handle IDs for the same contact
 * - Properly queries attributedBody for encoded messages
 * - Provides better error handling and debugging
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import os from 'os';
import fs from 'fs';

class iMessageMCPServer {
 // Add this helper method to the iMessageMCPServer class
  calculateAppleTimestamp(daysBack) {
    // Apple timestamps are nanoseconds since January 1, 2001 00:00:00 UTC
    // Unix timestamps are milliseconds since January 1, 1970 00:00:00 UTC
    
    const appleEpochInUnixSeconds = 978307200; // Seconds between 1970-01-01 and 2001-01-01
    const nowInUnixSeconds = Math.floor(Date.now() / 1000); // Current time in Unix seconds
    const nowInAppleSeconds = nowInUnixSeconds - appleEpochInUnixSeconds; // Current time in Apple seconds
    const nowInAppleNanoseconds = nowInAppleSeconds * 1000000000; // Convert to nanoseconds
    
    const daysBackInNanoseconds = daysBack * 24 * 60 * 60 * 1000000000; // Days to nanoseconds
    const threshold = nowInAppleNanoseconds - daysBackInNanoseconds;
    
    console.error(`Date Debug: daysBack=${daysBack}, threshold=${threshold}, nowApple=${nowInAppleNanoseconds}`);
    return threshold;
  }

  constructor() {
    this.server = new Server(
      {
        name: 'imessage-mcp-server',
        version: '1.1.1',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.dbPath = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');
    this.contactsDbPath = path.join(os.homedir(), 'Library', 'Application Support', 'AddressBook', 'AddressBook-v22.abcddb');
    this.contactNameCache = new Map(); // Cache for contact name lookups
    this.setupToolHandlers();
  }

  setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'search_and_read',
            description: 'Search for contacts/groups by name or phone and read their messages (most efficient)',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query (contact name, phone number, email, or group name)',
                },
                include_groups: {
                  type: 'boolean',
                  description: 'Include group chats in search (default: true)',
                  default: true,
                },
                limit: {
                  type: 'number',
                  description: 'Max messages per conversation (default: 30)',
                  default: 30,
                },
                days_back: {
                  type: 'number',
                  description: 'Days to look back (default: 30)',
                  default: 30,
                },
                format: {
                  type: 'string',
                  enum: ['minimal', 'compact', 'full'],
                  description: 'Output format (default: compact)',
                  default: 'compact',
                }
              },
              required: ['query'],
            },
          },
          {
            name: 'search_contacts',
            description: 'Search for contacts in iMessage by name, phone, or email (returns contact info only)',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query (name, phone number, or email)',
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'read_conversation',
            description: 'Read messages from specific contact or group by identifier',
            inputSchema: {
              type: 'object',
              properties: {
                identifier: {
                  type: 'string',
                  description: 'Phone number, email, contact name, or "group:ID" for group chats',
                },
                limit: {
                  type: 'number',
                  description: 'Max messages (default: 50)',
                  default: 50,
                },
                days_back: {
                  type: 'number',
                  description: 'Days back (default: 60)',
                  default: 60,
                },
                include_sent: {
                  type: 'boolean',
                  description: 'Include messages sent by you (default: true)',
                  default: true,
                },
                format: {
                  type: 'string',
                  enum: ['minimal', 'compact', 'full'],
                  description: 'Output format (default: compact)',
                  default: 'compact',
                }
              },
              required: ['identifier'],
            },
          },
          {
            name: 'get_conversation_stats',
            description: 'Get statistics about a conversation (individual or group)',
            inputSchema: {
              type: 'object',
              properties: {
                identifier: {
                  type: 'string',
                  description: 'Phone number, email, contact name, or "group:ID" for group chats',
                },
                days_back: {
                  type: 'number',
                  description: 'Number of days to analyze (default: 60)',
                  default: 60,
                },
              },
              required: ['identifier'],
            },
          },
          {
            name: 'analyze_message_sentiment',
            description: 'Analyze messages for sentiment, hostility, or specific keywords',
            inputSchema: {
              type: 'object',
              properties: {
                identifier: {
                  type: 'string',
                  description: 'Phone number, email, contact name, or "group:ID" for group chats',
                },
                keywords: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Keywords to search for (default: common hostile keywords)',
                },
                days_back: {
                  type: 'number',
                  description: 'Number of days to analyze (default: 60)',
                  default: 60,
                },
                group_by_date: {
                  type: 'boolean',
                  description: 'Group results by date (default: true)',
                  default: true,
                },
              },
              required: ['identifier'],
            },
          },
        ],
      };
    });

    // Handle tool calls
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
              args.format
            );
          case 'search_contacts':
            return await this.searchContacts(args.query);
          case 'read_conversation':
            return await this.readConversation(
              args.identifier,
              args.limit,
              args.days_back,
              args.include_sent,
              args.format
            );
          case 'get_conversation_stats':
            return await this.getConversationStatsEnhanced(args.identifier, args.days_back);
          case 'analyze_message_sentiment':
            return await this.analyzeMessageSentimentEnhanced(
              args.identifier,
              args.keywords,
              args.days_back,
              args.group_by_date
            );
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
        };
      }
    });
  }

  async openDatabase() {
    try {
      const db = await open({
        filename: this.dbPath,
        driver: sqlite3.Database,
        mode: sqlite3.OPEN_READONLY,
      });
      return db;
    } catch (error) {
      throw new Error(`Failed to open iMessage database: ${error.message}. 
        Make sure Claude Desktop has Full Disk Access in System Settings.`);
    }
  }

  async searchContacts(query) {
    const db = await this.openDatabase();
    
    try {
      const contacts = await db.all(
        `SELECT ROWID, id, service, country 
         FROM handle 
         WHERE id LIKE ? OR id LIKE ?
         ORDER BY id`,
        [`%${query}%`, `%${query.replace(/[^0-9]/g, '')}%`]
      );

      await db.close();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              query,
              contacts_found: contacts.length,
              contacts: contacts.map(contact => ({
                handle_id: contact.ROWID,
                identifier: contact.id,
                service: contact.service,
                country: contact.country,
              })),
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      await db.close();
      throw error;
    }
  }

  async findHandleIds(phoneNumber) {
    const db = await this.openDatabase();
    
    try {
      // Clean phone number for searching
      const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
      
      const handles = await db.all(
        `SELECT ROWID, id, service 
         FROM handle 
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

  async readMessages(phoneNumber, limit = 50, includeSent = true, daysBack = 60) {
    const handleIds = await this.findHandleIds(phoneNumber);
    
    if (handleIds.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No contacts found for: ${phoneNumber}`,
          },
        ],
      };
    }

    const db = await this.openDatabase();
    
    try {
      // Use the new Apple timestamp calculation
      const threshold = this.calculateAppleTimestamp(daysBack);
      const sentFilter = includeSent ? '' : 'AND message.is_from_me = 0';
      
      console.error(`Message Query Debug: handleIds=${JSON.stringify(handleIds)}, threshold=${threshold}`);
      
      const messages = await db.all(
        `SELECT 
           message.ROWID,
           datetime(message.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch') as date_readable,
           message.text,
           message.attributedBody,
           handle.id as contact_id,
           message.is_from_me,
           message.service,
           handle.service as handle_service,
           message.date as raw_date
         FROM message 
         LEFT JOIN handle ON message.handle_id = handle.ROWID 
         WHERE handle.ROWID IN (${handleIds.map(() => '?').join(',')})
           AND message.date > ?
           ${sentFilter}
         ORDER BY message.date DESC 
         LIMIT ?`,
        [...handleIds, threshold, limit]
      );

      console.error(`Messages found: ${messages.length}`);

      // Process attributedBody for messages with empty text
      const processedMessages = messages.map(msg => {
        let finalText = msg.text;
        
        // If text is empty but attributedBody exists, try to decode it
        if ((!finalText || finalText.trim() === '') && msg.attributedBody) {
          try {
            const bodyText = this.extractTextFromAttributedBody(msg.attributedBody);
            if (bodyText) {
              finalText = bodyText;
            }
          } catch (e) {
            // If decoding fails, leave text as is
          }
        }

        return {
          id: msg.ROWID,
          date: msg.date_readable,
          text: finalText || '[No text content]',
          contact_id: msg.contact_id,
          is_from_me: msg.is_from_me === 1,
          service: msg.service,
          handle_service: msg.handle_service,
          raw_apple_date: msg.raw_date, // For debugging
        };
      });

      await db.close();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              phone_number: phoneNumber,
              handle_ids_found: handleIds,
              messages_found: processedMessages.length,
              date_range_days: daysBack,
              threshold_used: threshold,
              messages: processedMessages,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      await db.close();
      throw error;
    }
  }

  async getConversationStats(phoneNumber, daysBack = 60) {
    const handleIds = await this.findHandleIds(phoneNumber);
    
    if (handleIds.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No contacts found for: ${phoneNumber}`,
          },
        ],
      };
    }

    const db = await this.openDatabase();
    
    try {
      // Use the new Apple timestamp calculation
      const threshold = this.calculateAppleTimestamp(daysBack);

      // Get overall stats
      const totalStats = await db.get(
        `SELECT 
           COUNT(*) as total_messages,
           COUNT(CASE WHEN is_from_me = 0 THEN 1 END) as received_messages,
           COUNT(CASE WHEN is_from_me = 1 THEN 1 END) as sent_messages,
           MIN(datetime(date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch')) as first_message,
           MAX(datetime(date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch')) as last_message
         FROM message 
         LEFT JOIN handle ON message.handle_id = handle.ROWID 
         WHERE handle.ROWID IN (${handleIds.map(() => '?').join(',')})
           AND message.date > ?`,
        [...handleIds, threshold]
      );

      // Get daily message counts
      const dailyStats = await db.all(
        `SELECT 
           DATE(datetime(date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch')) as message_date,
           COUNT(*) as total_messages,
           COUNT(CASE WHEN is_from_me = 0 THEN 1 END) as received_messages,
           COUNT(CASE WHEN is_from_me = 1 THEN 1 END) as sent_messages
         FROM message 
         LEFT JOIN handle ON message.handle_id = handle.ROWID 
         WHERE handle.ROWID IN (${handleIds.map(() => '?').join(',')})
           AND message.date > ?
         GROUP BY DATE(datetime(date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch'))
         ORDER BY message_date DESC`,
        [...handleIds, threshold]
      );

      await db.close();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              phone_number: phoneNumber,
              handle_ids: handleIds,
              period_days: daysBack,
              threshold_used: threshold,
              total_stats: totalStats,
              daily_breakdown: dailyStats,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      await db.close();
      throw error;
    }
  }

  async analyzeMessageSentiment(phoneNumber, keywords = null, daysBack = 60, groupByDate = true) {
    // Default hostile keywords if none provided
    const defaultKeywords = [
      'fuck', 'shit', 'hate', 'angry', 'mad', 'stupid', 'idiot', 'asshole', 'bitch',
      'damn', 'pissed', 'annoyed', 'irritated', 'disgusted', 'sick of', 'tired of',
      'done with', 'over it', 'shut up', 'leave me alone', 'cruel', 'attacking',
      'breaking point', 'hell', 'horrible', 'terrible', 'awful', 'worst', 'pathetic',
      'loser', 'useless', 'worthless', 'disappointed', 'betrayed', 'hurt', 'pain'
    ];

    const searchKeywords = keywords || defaultKeywords;
    const handleIds = await this.findHandleIds(phoneNumber);
    
    if (handleIds.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No contacts found for: ${phoneNumber}`,
          },
        ],
      };
    }

    const db = await this.openDatabase();
    
    try {
      const daysBackMs = daysBack * 24 * 60 * 60 * 1000 * 1000000;
      const now = Date.now() * 1000000;
      const threshold = now - daysBackMs;

      // Build keyword search condition
      const keywordConditions = searchKeywords.map(() => 'LOWER(message.text) LIKE ?').join(' OR ');
      const keywordParams = searchKeywords.map(kw => `%${kw.toLowerCase()}%`);

      if (groupByDate) {
        // Group by date
        const dailyAnalysis = await db.all(
          `SELECT 
             DATE(datetime(date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch')) as message_date,
             COUNT(*) as total_messages_with_keywords,
             GROUP_CONCAT(text, ' | ') as sample_messages
           FROM message 
           LEFT JOIN handle ON message.handle_id = handle.ROWID 
           WHERE handle.ROWID IN (${handleIds.map(() => '?').join(',')})
             AND message.date > ?
             AND message.is_from_me = 0
             AND message.text IS NOT NULL 
             AND message.text != ''
             AND (${keywordConditions})
           GROUP BY DATE(datetime(date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch'))
           ORDER BY message_date DESC`,
          [...handleIds, threshold, ...keywordParams]
        );

        await db.close();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                phone_number: phoneNumber,
                analysis_type: 'sentiment_by_date',
                keywords_searched: searchKeywords,
                period_days: daysBack,
                days_with_hostile_messages: dailyAnalysis.length,
                total_hostile_messages: dailyAnalysis.reduce((sum, day) => sum + day.total_messages_with_keywords, 0),
                daily_breakdown: dailyAnalysis.map(day => ({
                  date: day.message_date,
                  hostile_message_count: day.total_messages_with_keywords,
                  sample_messages: day.sample_messages.split(' | ').slice(0, 3), // First 3 samples
                })),
              }, null, 2),
            },
          ],
        };
      } else {
        // Get all matching messages
        const hostileMessages = await db.all(
          `SELECT 
             datetime(date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch') as date_readable,
             text,
             handle.id as contact_id
           FROM message 
           LEFT JOIN handle ON message.handle_id = handle.ROWID 
           WHERE handle.ROWID IN (${handleIds.map(() => '?').join(',')})
             AND message.date > ?
             AND message.is_from_me = 0
             AND message.text IS NOT NULL 
             AND message.text != ''
             AND (${keywordConditions})
           ORDER BY message.date DESC`,
          [...handleIds, threshold, ...keywordParams]
        );

        await db.close();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                phone_number: phoneNumber,
                analysis_type: 'all_hostile_messages',
                keywords_searched: searchKeywords,
                period_days: daysBack,
                total_hostile_messages: hostileMessages.length,
                messages: hostileMessages,
              }, null, 2),
            },
          ],
        };
      }
    } catch (error) {
      await db.close();
      throw error;
    }
  }

  // Simple attributedBody text extraction
  // Note: This is a basic implementation. Full implementation would require proper typedstream parsing
  extractTextFromAttributedBody(attributedBody) {
    if (!attributedBody) return null;
    
    try {
      // Convert Buffer to string and look for text patterns
      const bodyStr = attributedBody.toString('utf8');
      
      // Simple pattern matching for common text content
      // This is a basic approach - a full implementation would parse the typedstream format
      const textMatch = bodyStr.match(/[\x20-\x7E]{3,}/g);
      if (textMatch) {
        return textMatch.join(' ').trim();
      }
    } catch (e) {
      // If extraction fails, return null
    }
    
    return null;
  }

  // === CONTACT NAME RESOLUTION ===
  
  async openContactsDatabase() {
    try {
      if (!fs.existsSync(this.contactsDbPath)) {
        console.error('Contacts database not found - names will fallback to phone numbers');
        return null;
      }
      
      const db = await open({
        filename: this.contactsDbPath,
        driver: sqlite3.Database,
        mode: sqlite3.OPEN_READONLY,
      });
      return db;
    } catch (error) {
      console.error('Failed to open Contacts database:', error.message);
      return null;
    }
  }

  async resolveContactName(phoneOrEmail) {
    // Check cache first
    if (this.contactNameCache.has(phoneOrEmail)) {
      return this.contactNameCache.get(phoneOrEmail);
    }

    const contactsDb = await this.openContactsDatabase();
    if (!contactsDb) {
      // Fallback to cleaned phone number
      const cleaned = this.formatPhoneForDisplay(phoneOrEmail);
      this.contactNameCache.set(phoneOrEmail, cleaned);
      return cleaned;
    }

    try {
      // Clean phone number for searching
      const cleanPhone = phoneOrEmail.replace(/[^0-9]/g, '');
      
      // Search contacts database for name
      const contact = await contactsDb.get(
        `SELECT ZFIRSTNAME, ZLASTNAME 
         FROM ZABCDRECORD r
         JOIN ZABCDPHONENUMBER p ON r.Z_PK = p.ZOWNER
         WHERE p.ZFULLNUMBER LIKE ? OR p.ZFULLNUMBER LIKE ? OR p.ZFULLNUMBER LIKE ?
         LIMIT 1`,
        [`%${phoneOrEmail}%`, `%${cleanPhone}%`, `%+${cleanPhone}%`]
      );

      let displayName;
      if (contact && (contact.ZFIRSTNAME || contact.ZLASTNAME)) {
        displayName = `${contact.ZFIRSTNAME || ''} ${contact.ZLASTNAME || ''}`.trim();
      } else {
        displayName = this.formatPhoneForDisplay(phoneOrEmail);
      }

      await contactsDb.close();
      this.contactNameCache.set(phoneOrEmail, displayName);
      return displayName;
    } catch (error) {
      await contactsDb.close();
      const fallback = this.formatPhoneForDisplay(phoneOrEmail);
      this.contactNameCache.set(phoneOrEmail, fallback);
      return fallback;
    }
  }

  // Search contacts by name (reverse lookup)
  async findContactsByName(name) {
    const contactsDb = await this.openContactsDatabase();
    if (!contactsDb) return [];

    try {
      const contacts = await contactsDb.all(
        `SELECT r.ZFIRSTNAME, r.ZLASTNAME, p.ZFULLNUMBER as phone, e.ZADDRESS as email
         FROM ZABCDRECORD r
         LEFT JOIN ZABCDPHONENUMBER p ON r.Z_PK = p.ZOWNER
         LEFT JOIN ZABCDEMAILADDRESS e ON r.Z_PK = e.ZOWNER
         WHERE (r.ZFIRSTNAME LIKE ? OR r.ZLASTNAME LIKE ? OR 
                (r.ZFIRSTNAME || ' ' || r.ZLASTNAME) LIKE ?)
         LIMIT 10`,
        [`%${name}%`, `%${name}%`, `%${name}%`]
      );

      await contactsDb.close();
      return contacts.filter(c => c.phone || c.email).map(c => ({
        name: `${c.ZFIRSTNAME || ''} ${c.ZLASTNAME || ''}`.trim(),
        phone: c.phone,
        email: c.email
      }));
    } catch (error) {
      await contactsDb.close();
      return [];
    }
  }

  formatPhoneForDisplay(phoneOrEmail) {
    if (!phoneOrEmail) return 'Unknown';
    
    // If it's an email, return the part before @
    if (phoneOrEmail.includes('@')) {
      return phoneOrEmail.split('@')[0];
    }
    
    // Format phone number nicely
    const digits = phoneOrEmail.replace(/\D/g, '');
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    } else if (digits.length === 11 && digits.startsWith('1')) {
      return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    
    return phoneOrEmail;
  }

  // === ENHANCED TOOL METHODS ===

  // Primary method: Search contacts/groups and immediately read messages
  async searchAndRead(query, includeGroups = true, limit = 30, daysBack = 30, format = 'compact') {
    const db = await this.openDatabase();
    
    try {
      const threshold = this.calculateAppleTimestamp(daysBack);
      const results = [];

      // First, try to find contacts by name
      const contactMatches = await this.findContactsByName(query);
      
      // Search individual contacts (both by name matches and direct phone/email search)
      const searchTerms = [query];
      
      // Add phone numbers and emails from name matches
      for (const contact of contactMatches) {
        if (contact.phone) searchTerms.push(contact.phone);
        if (contact.email) searchTerms.push(contact.email);
      }

      // Remove duplicates
      const uniqueSearchTerms = [...new Set(searchTerms)];

      // Group handles by contact identifier to avoid duplicates
      const contactGroups = new Map(); // Key: contact identifier, Value: array of handle ROWIDs
      
      for (const searchTerm of uniqueSearchTerms) {
        const cleanNumber = searchTerm.replace(/[^0-9]/g, '');
        
        const handles = await db.all(
          `SELECT ROWID, id, service FROM handle 
           WHERE id LIKE ? OR id LIKE ? OR id LIKE ?
           LIMIT 10`, // Reasonable limit to prevent massive queries
          [`%${searchTerm}%`, `%${cleanNumber}%`, `%+${cleanNumber}%`]
        );

        // Group handles by contact identifier
        for (const handle of handles) {
          if (!contactGroups.has(handle.id)) {
            contactGroups.set(handle.id, []);
          }
          // Only add if not already in the list (avoid duplicates even within grouping)
          if (!contactGroups.get(handle.id).includes(handle.ROWID)) {
            contactGroups.get(handle.id).push(handle.ROWID);
          }
        }
      }

      // Process each unique contact only once
      for (const [contactId, handleIds] of contactGroups) {
        console.error(`Processing contact ${contactId} with ${handleIds.length} handles: ${handleIds}`);
        
        if (handleIds.length > 0) {
          const messages = await db.all(
            `SELECT 
               datetime(date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch') as date_readable,
               text,
               attributedBody,
               is_from_me,
               service
             FROM message 
             WHERE handle_id IN (${handleIds.map(() => '?').join(',')})
               AND date > ? AND text IS NOT NULL AND text != ''
             ORDER BY date DESC LIMIT ?`,
            [...handleIds, threshold, limit]
          );

          if (messages.length > 0) {
            // Process attributedBody for messages with empty text
            const processedMessages = messages.map(msg => {
              let finalText = msg.text;
              
              if ((!finalText || finalText.trim() === '') && msg.attributedBody) {
                try {
                  const bodyText = this.extractTextFromAttributedBody(msg.attributedBody);
                  if (bodyText) finalText = bodyText;
                } catch (e) {
                  // If decoding fails, leave text as is
                }
              }

              return {
                date: msg.date_readable,
                text: finalText || '[No text content]',
                is_from_me: msg.is_from_me === 1,
                service: msg.service,
              };
            });

            // Get display name for this contact
            const displayName = await this.resolveContactName(contactId);
            
            // Create single result entry for this unique contact
            results.push({
              type: 'individual',
              contact: displayName,
              identifier: contactId,
              handles: handleIds.length,  // Accurate handle count
              count: processedMessages.length,
              messages: processedMessages
            });
          }
        }
      }

      // Search group chats if requested
      if (includeGroups) {
        const groups = await db.all(
          `SELECT ROWID, display_name, chat_identifier FROM chat 
           WHERE display_name LIKE ? OR chat_identifier LIKE ?
           LIMIT 5`,
          [`%${query}%`, `%${query}%`]
        );

        for (const group of groups) {
          const messages = await db.all(
            `SELECT 
               datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch') as date_readable,
               m.text,
               m.attributedBody,
               h.id as sender,
               m.is_from_me,
               m.service
             FROM chat_message_join cmj
             JOIN message m ON cmj.message_id = m.ROWID
             LEFT JOIN handle h ON m.handle_id = h.ROWID
             WHERE cmj.chat_id = ? AND m.date > ? AND m.text IS NOT NULL AND m.text != ''
             ORDER BY m.date DESC LIMIT ?`,
            [group.ROWID, threshold, limit]
          );

          if (messages.length > 0) {
            // Process messages and resolve sender names
            const processedMessages = [];
            for (const msg of messages) {
              let finalText = msg.text;
              
              if ((!finalText || finalText.trim() === '') && msg.attributedBody) {
                try {
                  const bodyText = this.extractTextFromAttributedBody(msg.attributedBody);
                  if (bodyText) finalText = bodyText;
                } catch (e) {
                  // If decoding fails, leave text as is
                }
              }

              const senderName = msg.is_from_me === 1 ? 'You' : await this.resolveContactName(msg.sender);

              processedMessages.push({
                date: msg.date_readable,
                text: finalText || '[No text content]',
                sender: senderName,
                is_from_me: msg.is_from_me === 1,
                service: msg.service,
              });
            }

            results.push({
              type: 'group',
              name: group.display_name || `Group ${group.ROWID}`,
              id: group.ROWID,
              count: processedMessages.length,
              messages: processedMessages
            });
          }
        }
      }

      await db.close();

      if (!results.length) {
        return {
          content: [{ type: 'text', text: `No conversations found for: ${query}` }]
        };
      }

      // Format output based on requested format
      return this.formatSearchResults(results, format, query);

    } catch (error) {
      await db.close();
      throw error;
    }
  }

  // Helper to get all handle IDs for a contact (preserves original multi-handle logic)
  async findHandleIdsForContact(phoneOrEmail) {
    const db = await this.openDatabase();
    
    try {
      const cleanNumber = phoneOrEmail.replace(/[^0-9]/g, '');
      
      const handles = await db.all(
        `SELECT ROWID, id, service 
         FROM handle 
         WHERE id LIKE ? OR id LIKE ? OR id LIKE ?`,
        [`%${phoneOrEmail}%`, `%${cleanNumber}%`, `%+${cleanNumber}%`]
      );

      await db.close();
      return handles.map(h => h.ROWID);
    } catch (error) {
      await db.close();
      throw error;
    }
  }

  formatSearchResults(results, format, query) {
    if (format === 'minimal') {
      // Ultra-compact output with emojis
      const output = results.map(r => {
        const header = r.type === 'group' ? 
          `📱 ${r.name} (${r.count} msgs)` : 
          `👤 ${r.contact} (${r.count} msgs, ${r.handles} handles)`;
        
        const messagePreview = r.messages.slice(0, 3).map(m => {
          const time = new Date(m.date).toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
          });
          const sender = r.type === 'group' ? m.sender : (m.is_from_me ? 'You' : r.contact);
          return `  ${time} ${sender}: ${m.text}`;
        }).join('\n');

        return `${header}\n${messagePreview}`;
      }).join('\n\n');

      return { content: [{ type: 'text', text: output }] };
    }

    if (format === 'compact') {
      return {
        content: [{ 
          type: 'text', 
          text: JSON.stringify({
            query,
            found: results.length,
            conversations: results.map(r => ({
              type: r.type,
              name: r.type === 'group' ? r.name : r.contact,
              identifier: r.type === 'group' ? `group:${r.id}` : r.identifier,
              message_count: r.count,
              recent_messages: r.messages.slice(0, 10) // Show recent messages
            }))
          }, null, 2)
        }]
      };
    }

    // Full format
    return {
      content: [{ 
        type: 'text', 
        text: JSON.stringify({ query, results }, null, 2)
      }]
    };
  }

  // Enhanced read conversation method supporting both individuals and groups
  async readConversation(identifier, limit = 50, daysBack = 60, includeSent = true, format = 'compact') {
    const db = await this.openDatabase();
    
    try {
      const threshold = this.calculateAppleTimestamp(daysBack);
      let messages;
      let conversationInfo;

      if (identifier.startsWith('group:')) {
        // Group conversation
        const chatId = parseInt(identifier.replace('group:', ''));
        
        const groupInfo = await db.get(
          `SELECT display_name, chat_identifier FROM chat WHERE ROWID = ?`,
          [chatId]
        );

        const sentFilter = includeSent ? '' : 'AND m.is_from_me = 0';

        messages = await db.all(
          `SELECT 
             datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch') as date_readable,
             m.text,
             m.attributedBody,
             h.id as sender,
             m.is_from_me,
             m.service
           FROM chat_message_join cmj
           JOIN message m ON cmj.message_id = m.ROWID
           LEFT JOIN handle h ON m.handle_id = h.ROWID
           WHERE cmj.chat_id = ? AND m.date > ? AND m.text IS NOT NULL AND m.text != ''
           ${sentFilter}
           ORDER BY m.date DESC LIMIT ?`,
          [chatId, threshold, limit]
        );

        // Process messages and resolve sender names
        const processedMessages = [];
        for (const msg of messages) {
          let finalText = msg.text;
          
          if ((!finalText || finalText.trim() === '') && msg.attributedBody) {
            try {
              const bodyText = this.extractTextFromAttributedBody(msg.attributedBody);
              if (bodyText) finalText = bodyText;
            } catch (e) {
              // If decoding fails, leave text as is
            }
          }

          const senderName = msg.is_from_me === 1 ? 'You' : await this.resolveContactName(msg.sender);

          processedMessages.push({
            date: msg.date_readable,
            text: finalText || '[No text content]',
            sender: senderName,
            is_from_me: msg.is_from_me === 1,
            service: msg.service,
          });
        }

        conversationInfo = {
          type: 'group',
          name: groupInfo?.display_name || `Group ${chatId}`,
          id: chatId,
          messages: processedMessages
        };
      } else {
        // Individual conversation - try name resolution first
        let handleIds = [];
        
        // If it looks like a name, try to find by contact name
        if (!/[@+\d\-\(\)]/.test(identifier)) {
          const contactMatches = await this.findContactsByName(identifier);
          for (const contact of contactMatches) {
            if (contact.phone) {
              const phoneHandles = await this.findHandleIdsForContact(contact.phone);
              handleIds.push(...phoneHandles);
            }
            if (contact.email) {
              const emailHandles = await this.findHandleIdsForContact(contact.email);
              handleIds.push(...emailHandles);
            }
          }
        }
        
        // If no handles found by name, try direct phone/email lookup
        if (handleIds.length === 0) {
          handleIds = await this.findHandleIdsForContact(identifier);
        }
        
        if (handleIds.length === 0) {
          throw new Error(`Contact not found: ${identifier}`);
        }

        // Remove duplicates
        handleIds = [...new Set(handleIds)];

        const sentFilter = includeSent ? '' : 'AND is_from_me = 0';

        messages = await db.all(
          `SELECT 
             datetime(date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch') as date_readable,
             text,
             attributedBody,
             is_from_me,
             service
           FROM message 
           WHERE handle_id IN (${handleIds.map(() => '?').join(',')})
             AND date > ? AND text IS NOT NULL AND text != ''
             ${sentFilter}
           ORDER BY date DESC LIMIT ?`,
          [...handleIds, threshold, limit]
        );

        // Process attributedBody for messages with empty text
        const processedMessages = messages.map(msg => {
          let finalText = msg.text;
          
          if ((!finalText || finalText.trim() === '') && msg.attributedBody) {
            try {
              const bodyText = this.extractTextFromAttributedBody(msg.attributedBody);
              if (bodyText) finalText = bodyText;
            } catch (e) {
              // If decoding fails, leave text as is
            }
          }

          return {
            date: msg.date_readable,
            text: finalText || '[No text content]',
            is_from_me: msg.is_from_me === 1,
            service: msg.service,
          };
        });

        const contactName = await this.resolveContactName(identifier);
        conversationInfo = {
          type: 'individual',
          contact: contactName,
          handles: handleIds.length,
          messages: processedMessages
        };
      }

      await db.close();

      // Format output based on requested format
      if (format === 'minimal') {
        const header = conversationInfo.type === 'group' ? 
          `📱 ${conversationInfo.name} (${conversationInfo.messages.length} msgs)` : 
          `👤 ${conversationInfo.contact} (${conversationInfo.messages.length} msgs, ${conversationInfo.handles} handles)`;
        
        const messageList = conversationInfo.messages.map(m => {
          const time = new Date(m.date).toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
          });
          const sender = conversationInfo.type === 'group' ? 
            m.sender : (m.is_from_me ? 'You' : conversationInfo.contact);
          return `  ${time} ${sender}: ${m.text}`;
        }).join('\n');

        return {
          content: [{ type: 'text', text: `${header}\n${messageList}` }]
        };
      }

      if (format === 'compact') {
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify({
              conversation: conversationInfo.type === 'group' ? conversationInfo.name : conversationInfo.contact,
              type: conversationInfo.type,
              message_count: conversationInfo.messages.length,
              period_days: daysBack,
              messages: conversationInfo.messages
            }, null, 2)
          }]
        };
      }

      // Full format
      return {
        content: [{ 
          type: 'text', 
          text: JSON.stringify(conversationInfo, null, 2)
        }]
      };

    } catch (error) {
      await db.close();
      throw error;
    }
  }

  // Enhanced conversation stats supporting both individuals and groups  
  async getConversationStatsEnhanced(identifier, daysBack = 60) {
    const db = await this.openDatabase();
    
    try {
      const threshold = this.calculateAppleTimestamp(daysBack);

      if (identifier.startsWith('group:')) {
        // Group stats
        const chatId = parseInt(identifier.replace('group:', ''));
        
        const groupInfo = await db.get(
          `SELECT display_name, chat_identifier FROM chat WHERE ROWID = ?`,
          [chatId]
        );

        // Get participant stats
        const stats = await db.all(
          `SELECT 
             h.id as participant,
             COUNT(*) as message_count,
             COUNT(CASE WHEN m.is_from_me = 1 THEN 1 END) as sent_by_you,
             MIN(datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch')) as first_message,
             MAX(datetime(m.date/1000000000 + strftime('%s', '2001-01-1'), 'unixepoch')) as last_message
           FROM chat_message_join cmj
           JOIN message m ON cmj.message_id = m.ROWID
           LEFT JOIN handle h ON m.handle_id = h.ROWID
           WHERE cmj.chat_id = ? AND m.date > ?
           GROUP BY h.id
           ORDER BY message_count DESC`,
          [chatId, threshold]
        );

        // Resolve participant names
        const participantStats = [];
        for (const stat of stats) {
          const name = stat.participant ? await this.resolveContactName(stat.participant) : 'You';
          participantStats.push({
            participant: name,
            messages: stat.message_count,
            sent_by_you: stat.sent_by_you,
            first_message: stat.first_message,
            last_message: stat.last_message
          });
        }

        await db.close();

        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify({
              group: groupInfo?.display_name || `Group ${chatId}`,
              type: 'group',
              period_days: daysBack,
              participants: participantStats,
              totals: {
                total_messages: participantStats.reduce((sum, p) => sum + p.messages, 0),
                total_participants: participantStats.length,
                most_active: participantStats[0]?.participant || 'None'
              }
            }, null, 2)
          }]
        };
      } else {
        // Individual stats - use existing logic but with name resolution
        let handleIds = [];
        
        // Try name resolution first
        if (!/[@+\d\-\(\)]/.test(identifier)) {
          const contactMatches = await this.findContactsByName(identifier);
          for (const contact of contactMatches) {
            if (contact.phone) {
              const phoneHandles = await this.findHandleIdsForContact(contact.phone);
              handleIds.push(...phoneHandles);
            }
            if (contact.email) {
              const emailHandles = await this.findHandleIdsForContact(contact.email);
              handleIds.push(...emailHandles);
            }
          }
        }
        
        if (handleIds.length === 0) {
          handleIds = await this.findHandleIdsForContact(identifier);
        }
        
        if (handleIds.length === 0) {
          throw new Error(`Contact not found: ${identifier}`);
        }

        const stats = await db.get(
          `SELECT 
             COUNT(*) as total_messages,
             COUNT(CASE WHEN is_from_me = 0 THEN 1 END) as received_messages,
             COUNT(CASE WHEN is_from_me = 1 THEN 1 END) as sent_messages,
             MIN(datetime(date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch')) as first_message,
             MAX(datetime(date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch')) as last_message
           FROM message 
           WHERE handle_id IN (${handleIds.map(() => '?').join(',')})
             AND date > ?`,
          [...handleIds, threshold]
        );

        const contactName = await this.resolveContactName(identifier);

        await db.close();

        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify({
              contact: contactName,
              type: 'individual',
              handles: handleIds.length,
              period_days: daysBack,
              stats: stats
            }, null, 2)
          }]
        };
      }

    } catch (error) {
      await db.close();
      throw error;
    }
  }

  // Enhanced sentiment analysis supporting both individuals and groups
  async analyzeMessageSentimentEnhanced(identifier, keywords = null, daysBack = 60, groupByDate = true) {
    // Default hostile keywords if none provided
    const defaultKeywords = [
      'fuck', 'shit', 'hate', 'angry', 'mad', 'stupid', 'idiot', 'asshole', 'bitch',
      'damn', 'pissed', 'annoyed', 'irritated', 'disgusted', 'sick of', 'tired of',
      'done with', 'over it', 'shut up', 'leave me alone', 'cruel', 'attacking',
      'breaking point', 'hell', 'horrible', 'terrible', 'awful', 'worst', 'pathetic',
      'loser', 'useless', 'worthless', 'disappointed', 'betrayed', 'hurt', 'pain'
    ];

    const searchKeywords = keywords || defaultKeywords;
    const db = await this.openDatabase();
    
    try {
      const threshold = this.calculateAppleTimestamp(daysBack);

      // Build keyword search condition
      const keywordConditions = searchKeywords.map(() => 'LOWER(m.text) LIKE ?').join(' OR ');
      const keywordParams = searchKeywords.map(kw => `%${kw.toLowerCase()}%`);

      let results;
      let conversationName;

      if (identifier.startsWith('group:')) {
        // Group sentiment analysis
        const chatId = parseInt(identifier.replace('group:', ''));
        
        const groupInfo = await db.get(
          `SELECT display_name FROM chat WHERE ROWID = ?`,
          [chatId]
        );

        conversationName = groupInfo?.display_name || `Group ${chatId}`;

        if (groupByDate) {
          const dailyAnalysis = await db.all(
            `SELECT 
               DATE(datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch')) as message_date,
               COUNT(*) as hostile_messages,
               GROUP_CONCAT(h.id || ': ' || m.text, ' | ') as sample_messages
             FROM chat_message_join cmj
             JOIN message m ON cmj.message_id = m.ROWID
             LEFT JOIN handle h ON m.handle_id = h.ROWID
             WHERE cmj.chat_id = ? AND m.date > ?
               AND m.is_from_me = 0 AND m.text IS NOT NULL AND m.text != ''
               AND (${keywordConditions})
             GROUP BY DATE(datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch'))
             ORDER BY message_date DESC`,
            [chatId, threshold, ...keywordParams]
          );

          results = {
            type: 'group',
            analysis_type: 'sentiment_by_date',
            daily_breakdown: dailyAnalysis
          };
        } else {
          const hostileMessages = await db.all(
            `SELECT 
               datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch') as date_readable,
               m.text,
               h.id as sender
             FROM chat_message_join cmj
             JOIN message m ON cmj.message_id = m.ROWID
             LEFT JOIN handle h ON m.handle_id = h.ROWID
             WHERE cmj.chat_id = ? AND m.date > ?
               AND m.is_from_me = 0 AND m.text IS NOT NULL AND m.text != ''
               AND (${keywordConditions})
             ORDER BY m.date DESC`,
            [chatId, threshold, ...keywordParams]
          );

          // Resolve sender names
          const processedMessages = [];
          for (const msg of hostileMessages) {
            const senderName = await this.resolveContactName(msg.sender);
            processedMessages.push({
              date: msg.date_readable,
              text: msg.text,
              sender: senderName
            });
          }

          results = {
            type: 'group',
            analysis_type: 'all_hostile_messages',
            messages: processedMessages
          };
        }
      } else {
        // Individual sentiment analysis - use existing logic with name resolution
        let handleIds = [];
        
        if (!/[@+\d\-\(\)]/.test(identifier)) {
          const contactMatches = await this.findContactsByName(identifier);
          for (const contact of contactMatches) {
            if (contact.phone) {
              const phoneHandles = await this.findHandleIdsForContact(contact.phone);
              handleIds.push(...phoneHandles);
            }
            if (contact.email) {
              const emailHandles = await this.findHandleIdsForContact(contact.email);
              handleIds.push(...emailHandles);
            }
          }
        }
        
        if (handleIds.length === 0) {
          handleIds = await this.findHandleIdsForContact(identifier);
        }
        
        if (handleIds.length === 0) {
          throw new Error(`Contact not found: ${identifier}`);
        }

        conversationName = await this.resolveContactName(identifier);

        if (groupByDate) {
          const dailyAnalysis = await db.all(
            `SELECT 
               DATE(datetime(date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch')) as message_date,
               COUNT(*) as hostile_messages,
               GROUP_CONCAT(text, ' | ') as sample_messages
             FROM message 
             WHERE handle_id IN (${handleIds.map(() => '?').join(',')})
               AND date > ? AND is_from_me = 0 AND text IS NOT NULL AND text != ''
               AND (${keywordConditions})
             GROUP BY DATE(datetime(date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch'))
             ORDER BY message_date DESC`,
            [...handleIds, threshold, ...keywordParams]
          );

          results = {
            type: 'individual',
            analysis_type: 'sentiment_by_date',
            daily_breakdown: dailyAnalysis
          };
        } else {
          const hostileMessages = await db.all(
            `SELECT 
               datetime(date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch') as date_readable,
               text
             FROM message 
             WHERE handle_id IN (${handleIds.map(() => '?').join(',')})
               AND date > ? AND is_from_me = 0 AND text IS NOT NULL AND text != ''
               AND (${keywordConditions})
             ORDER BY date DESC`,
            [...handleIds, threshold, ...keywordParams]
          );

          results = {
            type: 'individual',
            analysis_type: 'all_hostile_messages',
            messages: hostileMessages
          };
        }
      }

      await db.close();

      return {
        content: [{ 
          type: 'text', 
          text: JSON.stringify({
            conversation: conversationName,
            keywords_searched: searchKeywords,
            period_days: daysBack,
            ...results
          }, null, 2)
        }]
      };

    } catch (error) {
      await db.close();
      throw error;
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('iMessage MCP Server running on stdio');
  }
}

// Run the server
const server = new iMessageMCPServer();
server.run().catch(console.error);