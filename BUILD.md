# 🔨 Build From Source - Enhanced iMessage Connector

## 🎯 Why Build From Source?

**Trust but verify!** While we provide pre-built `.dxt` files for convenience, you can build the extension yourself to:
- ✅ **Verify the code** does exactly what it claims
- ✅ **Inspect for security** - no hidden functionality  
- ✅ **Customize if needed** - modify for your specific use case
- ✅ **Learn how it works** - understand the implementation

## 📋 Prerequisites

### Required Software
- **macOS 12+** (Monterey or newer)
- **Node.js 18+** ([Download here](https://nodejs.org/))
- **Claude Desktop** (latest version)
- **Command Line Tools** (usually pre-installed)

### Check Your Setup
```bash
# Verify Node.js version
node --version
# Should show v18.0.0 or higher

# Verify npm is available  
npm --version
# Should show version number
```

## 🛠️ Build Steps

### 1. Download Source Code
```bash
# Clone the repository
git clone https://github.com/[username]/enhanced-imessage-connector.git
cd enhanced-imessage-connector

# Or download ZIP and extract
# Then: cd enhanced-imessage-connector
```

### 2. Install Dependencies
```bash
cd src/
npm install
```

**What this installs:**
- `@modelcontextprotocol/sdk` - Official MCP framework
- `sqlite3` - SQLite database driver
- `sqlite` - Promise-based SQLite wrapper

### 3. Test the Server (Optional)
```bash
# Verify the MCP server works
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}' | node index.js
```

**Expected output**: JSON listing 4 tools (search_contacts, read_messages, get_conversation_stats, analyze_message_sentiment)

### 4. Build Extension
```bash
# Build the .dxt file
dxt pack
```

**Output**: `enhanced-imessage-connector.dxt` in the `src/` folder

### 5. Install Your Build
```bash
# Install in Claude Desktop
open enhanced-imessage-connector.dxt
```

Claude Desktop will open and prompt to install the extension.

## 🔍 Code Verification Guide

### What to Review
Before building, examine these key files:

#### `index.js` - Main Implementation
**Check for:**
- ✅ **Database access**: Only reads from Messages database
- ✅ **No network calls**: No external HTTP requests
- ✅ **Error handling**: Proper try/catch blocks
- ✅ **SQL queries**: Parameterized queries (no injection risks)

**Red flags to look for:**
- ❌ Network requests (fetch, http, etc.)
- ❌ File writes outside Messages database
- ❌ Credential harvesting
- ❌ Unnecessary permissions

#### `package.json` - Dependencies
**Verify only these dependencies:**
```json
{
  "@modelcontextprotocol/sdk": "^1.0.0",
  "sqlite3": "^5.1.6", 
  "sqlite": "^5.1.1"
}
```

**Red flags:**
- ❌ Unknown packages
- ❌ Network libraries (axios, fetch, etc.)
- ❌ File system libraries beyond sqlite
- ❌ Obfuscation tools

#### `manifest.json` - Extension Config
**Should only contain:**
- Extension metadata (name, version, description)
- Tool definitions
- MCP server configuration
- No permissions beyond database access

## 🛡️ Security Verification

### Database Access Check
The connector should only:
- ✅ **Read** from `~/Library/Messages/chat.db`
- ✅ **Use read-only** SQLite mode
- ❌ **Never write** to Messages database
- ❌ **Never access** other system files

### Permission Verification
```javascript
// Look for this in index.js - ensures read-only access
const db = await open({
  filename: this.dbPath,
  driver: sqlite3.Database,
  mode: sqlite3.OPEN_READONLY,  // ← This is important!
});
```

### Network Activity Check
```bash
# Test that extension makes no network calls
# Run this while testing the extension:
sudo lsof -i -P | grep -i claude

# Should show no unexpected network connections
```

## 🔄 Customization Options

### Modify Search Keywords
Edit the `defaultKeywords` array in `analyzeMessageSentiment()`:
```javascript
const defaultKeywords = [
  'your', 'custom', 'keywords', 'here'
];
```

### Adjust Default Limits
Change default values in tool schemas:
```javascript
days_back: {
  type: 'number',
  description: 'Number of days to look back (default: 60)',
  default: 60,  // ← Change this
},
```

### Add Debug Logging
Uncomment console.error statements for detailed debugging:
```javascript
console.error(`Debug info: ${variable}`);
```

## 🧪 Testing Your Build

### Verification Tests
After building, test these scenarios:

1. **Contact Search**:
   ```
   Enhanced iMessage Connector:search_contacts with query "test"
   ```
   Should find contacts, not return errors.

2. **Message Reading**:
   ```
   Enhanced iMessage Connector:read_messages with phone_number "+15559823467" days_back 7 limit 5
   ```
   Use a real phone number from your contacts.

3. **Statistics**:
   ```
   Enhanced iMessage Connector:get_conversation_stats with phone_number "+15559823467" days_back 30
   ```
   Should show message counts and date ranges.

### Compare with Pre-built
- Build your own version
- Test the same queries with both versions
- Results should be identical

## ❓ Build Troubleshooting

### "dxt command not found"
**Solution**: Install Desktop Extension Tools
```bash
# Check if Claude Desktop includes dxt
/Applications/Claude.app/Contents/Resources/dxt --help

# If not available, check Anthropic's documentation
```

### "npm install fails"
**Solution**: 
1. Update Node.js to latest LTS version
2. Clear npm cache: `npm cache clean --force`
3. Delete `node_modules` and retry: `rm -rf node_modules && npm install`

### "Permission denied" errors
**Solution**: Check file permissions
```bash
chmod +x index.js
sudo chown -R $USER:staff .
```

### Extension won't load after building
**Solution**: 
1. Check `manifest.json` syntax with JSON validator
2. Verify Node.js version compatibility (18+)
3. Check Claude Desktop extension logs for errors

## 🎯 Build Verification Checklist

Before using your custom build:
- [ ] ✅ Reviewed all source code files
- [ ] ✅ Verified only approved dependencies
- [ ] ✅ Tested contact search functionality  
- [ ] ✅ Tested message reading with known contact
- [ ] ✅ Confirmed no unexpected network activity
- [ ] ✅ Extension shows as "Running" in Claude Desktop
- [ ] ✅ Results match expected performance claims

## 🚀 Ready to Build!

Building from source gives you **complete control and verification** of what you're installing. The process takes about 5 minutes and ensures you're running exactly the code you reviewed.

**Your enhanced connector will work the same whether pre-built or self-built** - the difference is your confidence in what you're running!