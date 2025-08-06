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
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.dbPath = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');
    this.setupToolHandlers();
  }

  setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'search_contacts',
            description: 'Search for contacts in iMessage by name, phone, or email',
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
            name: 'read_messages',
            description: 'Read messages from a specific contact with enhanced support for multiple handles',
            inputSchema: {
              type: 'object',
              properties: {
                phone_number: {
                  type: 'string',
                  description: 'Phone number or email of the contact',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of messages to retrieve (default: 50)',
                  default: 50,
                },
                include_sent: {
                  type: 'boolean',
                  description: 'Include messages sent by you (default: true)',
                  default: true,
                },
                days_back: {
                  type: 'number',
                  description: 'Number of days to look back (default: 60)',
                  default: 60,
                },
              },
              required: ['phone_number'],
            },
          },
          {
            name: 'get_conversation_stats',
            description: 'Get statistics about a conversation including message counts and date ranges',
            inputSchema: {
              type: 'object',
              properties: {
                phone_number: {
                  type: 'string',
                  description: 'Phone number or email of the contact',
                },
                days_back: {
                  type: 'number',
                  description: 'Number of days to analyze (default: 60)',
                  default: 60,
                },
              },
              required: ['phone_number'],
            },
          },
          {
            name: 'analyze_message_sentiment',
            description: 'Analyze messages for sentiment, hostility, or specific keywords',
            inputSchema: {
              type: 'object',
              properties: {
                phone_number: {
                  type: 'string',
                  description: 'Phone number or email of the contact',
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
              required: ['phone_number'],
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
          case 'search_contacts':
            return await this.searchContacts(args.query);
          case 'read_messages':
            return await this.readMessages(
              args.phone_number,
              args.limit,
              args.include_sent,
              args.days_back
            );
          case 'get_conversation_stats':
            return await this.getConversationStats(args.phone_number, args.days_back);
          case 'analyze_message_sentiment':
            return await this.analyzeMessageSentiment(
              args.phone_number,
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

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('iMessage MCP Server running on stdio');
  }
}

// Run the server
const server = new iMessageMCPServer();
server.run().catch(console.error);