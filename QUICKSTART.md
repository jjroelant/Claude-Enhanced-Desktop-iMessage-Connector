# 🚀 Quick Start - Enhanced iMessage Connector

## ⚡ 5-Minute Setup

### What You Need
- **macOS** with Messages app
- **Claude Desktop** (latest version) 
- **5 minutes** of your time

### Step 1: Download & Install
1. **Download**: [enhanced-imessage-connector.dxt](releases/imessage-mcp-Connector-v1.0.3.dxt)
2. **Double-click** the `.dxt` file
3. **Allow** installation when Claude Desktop asks

### Step 2: Enable Permissions
1. **System Settings** → Privacy & Security → **Full Disk Access**
2. **Click the (+) button** and add **Claude Desktop**
3. **Restart** Claude Desktop

### Step 3: Test It Works
Try this simple command in Claude Desktop:
```
Enhanced iMessage Connector:search_contacts with query "mom"
```

**Expected Result**: You should see your contacts with "mom" in the name, phone, or email.

## 🎯 What You Can Do Now

### Find Any Contact
```
Enhanced iMessage Connector:search_contacts with query "john"
```
Searches names, phone numbers, and emails.

### Read Recent Messages  
```
Enhanced iMessage Connector:read_messages with phone_number "+1234567890" limit 10
```
Replace with a real phone number from your contacts.

### Get Conversation Stats
```
Enhanced iMessage Connector:get_conversation_stats with phone_number "+1234567890" days_back 30
```
Shows message counts and daily breakdowns.

### Analyze Message Tone
```
Enhanced iMessage Connector:analyze_message_sentiment with phone_number "+1234567890" days_back 30
```
Finds potentially hostile or concerning messages.

## ❓ Not Working?

### "Tools not available"
- **Check**: Settings → Extensions shows "Enhanced iMessage Connector" as **Running**
- **Fix**: Restart Claude Desktop

### "No contacts found" 
- **Check**: Full Disk Access is enabled for Claude Desktop
- **Fix**: System Settings → Privacy & Security → Full Disk Access

### "Permission denied"
- **Check**: Messages app has message history
- **Fix**: Try different search terms or phone numbers

## 🔒 Is This Safe?

**Yes! Here's why:**
- ✅ **Read-only**: Never modifies your messages
- ✅ **Local-only**: Your data never leaves your Mac  
- ✅ **OS-protected**: Requires explicit permission you control
- ✅ **Open source**: You can inspect the code

**Want to verify?** See [BUILD.md](BUILD.md) to build from source and inspect every line of code.

## 🆘 Need Help?

**Still having issues?** Check the full [troubleshooting guide](README.md#-troubleshooting) or [open an issue](https://github.com/johnroelant/Claude-Enhanced-Desktop-iMessage-Connector/issues).

## 🎉 Success!

**You're now using the enhanced iMessage connector that actually works!** Unlike Claude Desktop's built-in tools, this finds thousands of contacts and reads real message history.

**Enjoy reliable iMessage integration with Claude Desktop.**