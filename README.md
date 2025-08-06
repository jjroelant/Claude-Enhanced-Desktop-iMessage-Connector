# Enhanced iMessage Connector for Claude Desktop

Claude Desktop's built-in iMessage tools don't work reliably - they find 0 contacts when searching and fail with AppleScript errors. This connector fixes those issues and adds new functionality.

## What's Different

| Feature | Built-in Tools | This Connector |
|---------|---------------|----------------|
| Contact search | Finds 0 contacts | Search by name, phone, or email |
| Message reading | Consistently fails | Reads full message content |
| Multiple handles | Not supported | Unifies SMS/iMessage/email per person |
| Group chats | Not supported | Full group functionality |
| Contact names | Phone numbers only | Use contact names like "Mom" |
| Dependencies | AppleScript (unreliable) | Direct SQLite access |

## Installation

1. Download the latest `enhanced-imessage-connector-v1.1.0.dxt` file
2. Double-click to install in Claude Desktop  
3. Enable **Full Disk Access** for Claude Desktop in System Settings → Privacy & Security
4. Restart Claude Desktop

## Available Tools

### search_and_read
Search and immediately read messages in one step. Works with contact names, phone numbers, or group names.

```
Enhanced iMessage Connector:search_and_read with query "Mom"
Enhanced iMessage Connector:search_and_read with query "Work Team" 
Enhanced iMessage Connector:search_and_read with query "+1234567890" limit 10
```

### search_contacts  
Find contacts without reading messages.

```
Enhanced iMessage Connector:search_contacts with query "john"
```

### read_conversation
Read messages from a specific contact or group.

```
Enhanced iMessage Connector:read_conversation with identifier "Mom" limit 50
Enhanced iMessage Connector:read_conversation with identifier "group:123" days_back 7
Enhanced iMessage Connector:read_conversation with identifier "+1234567890" include_sent false
```

### get_conversation_stats
Get message counts, participant info, and timing data.

```
Enhanced iMessage Connector:get_conversation_stats with identifier "Mom" days_back 30
Enhanced iMessage Connector:get_conversation_stats with identifier "group:123"
```

### analyze_message_sentiment  
Search for specific keywords or detect potentially hostile messages.

```
Enhanced iMessage Connector:analyze_message_sentiment with identifier "group:123" group_by_date true
Enhanced iMessage Connector:analyze_message_sentiment with identifier "Mom" keywords ["angry","frustrated"]
```

## Key Features

**Contact name resolution**: Search "Mom" instead of memorizing phone numbers. Works by connecting to your macOS Contacts database.

**Multi-handle support**: Finds the same person across SMS, iMessage, and email addresses automatically.

**Group chat support**: Read group messages with participant names identified.

**No message truncation**: Preserves full message content instead of cutting off at arbitrary limits.

**Multiple output formats**: Choose between minimal, compact, or full detail levels.

## Technical Details

- Connects directly to `~/Library/Messages/chat.db` (SQLite)
- Integrates with `~/Library/Application Support/AddressBook/` for contact names  
- Requires Full Disk Access permission
- Works entirely offline - no data leaves your Mac
- Read-only access - never modifies your messages

## Troubleshooting

**Extension won't install**
- Update Claude Desktop to latest version
- Re-download the .dxt file
- Restart Claude Desktop

**Tools not appearing**  
- Check Settings → Extensions shows connector as "Running"
- Use full tool names: `Enhanced iMessage Connector:search_and_read`
- Restart Claude Desktop after installation

**Empty search results**
- Verify Full Disk Access is enabled for Claude Desktop
- Try different search terms (name, phone, email)
- Check that Messages app has conversation history

**No messages found**
- Increase `days_back` parameter (try 365)
- Verify the contact has message history in Messages app
- Try different phone number formats

## Why Built-in Tools Fail

The built-in iMessage connector relies on AppleScript, which:
- Breaks when the Contacts app isn't running
- Can't handle the same contact across multiple services  
- Fails silently with no useful error messages
- Misses phone number format variations

This connector uses direct SQLite database access instead, eliminating those failure points.

## Privacy

- All data stays on your Mac
- Read-only database access
- No network connections
- Requires explicit system permission (Full Disk Access)

## License

MIT - Feel free to modify and contribute back.