/**
 * TDX Finance MCP - Browser Cookie Reader & Wenda Session Validator
 * ================================================================
 * 自动读取本地浏览器 Cookie 并验证 Wenda API 可用性
 * 
 * 支持:
 *   - Chrome/Edge Cookie DB 读取 (需要关闭浏览器或复制DB)
 *   - 手动导入 Cookie 文件
 *   - 自动测试 Wenda API
 *   - 导出有效 Session 配置
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Configuration
const TDX_DOMAINS = ['tdx.com.cn', 'pul.tdx.com.cn', 'tdxhub.icfqs.com'];
const WENDA_ENDPOINTS = {
  news: 'https://www.tdx.com.cn/wenda/api/tools/zx_query',
  report: 'https://www.tdx.com.cn/wenda/api/tools/yb_query',
  notice: 'https://www.tdx.com.cn/wenda/api/tools/gg_search'
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

// ============================================================
// Find Browser Cookie Databases
// ============================================================

function findBrowserCookiePaths() {
  const paths = {};
  
  // Windows paths
  const localAppData = process.env.LOCALAPPDATA || '';
  const appData = process.env.APPDATA || '';
  const homeDir = os.homedir();
  
  // Chrome
  const chromeDefault = path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Network', 'Cookies');
  const chromeUserData = path.join(localAppData, 'Google', 'Chrome', 'User Data');
  
  if (fs.existsSync(chromeDefault)) {
    paths['Google Chrome'] = [chromeDefault];
    // Also find Profile folders
    if (fs.existsSync(chromeUserData)) {
      try {
        const profiles = fs.readdirSync(chromeUserData)
          .filter(d => d.startsWith('Profile ') && 
                fs.statSync(path.join(chromeUserData, d)).isDirectory())
          .map(d => path.join(chromeUserData, d, 'Network', 'Cookies'))
          .filter(p => fs.existsSync(p));
        paths['Google Chrome'].push(...profiles);
      } catch(e) {}
    }
  }
  
  // Edge
  const edgeDefault = path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Network', 'Cookies');
  const edgeUserData = path.join(localAppData, 'Microsoft', 'Edge', 'User Data');
  
  if (fs.existsSync(edgeDefault)) {
    paths['Microsoft Edge'] = [edgeDefault];
    if (fs.existsSync(edgeUserData)) {
      try {
        const profiles = fs.readdirSync(edgeUserData)
          .filter(d => d.startsWith('Profile ') && 
                fs.statSync(path.join(edgeUserData, d)).isDirectory())
          .map(d => path.join(edgeUserData, d, 'Network', 'Cookies'))
          .filter(p => fs.existsSync(p));
        paths['Microsoft Edge'].push(...profiles);
      } catch(e) {}
    }
  }
  
  // Firefox
  const firefoxProfilesDir = path.join(appData, 'Mozilla', 'Firefox', 'Profiles');
  if (fs.existsSync(firefoxProfilesDir)) {
    try {
      const firefoxPaths = [];
      const profiles = fs.readdirSync(firefoxProfilesDir)
        .filter(d => fs.statSync(path.join(firefoxProfilesDir, d)).isDirectory());
      
      for (const profile of profiles) {
        const dbPath = path.join(firefoxProfilesDir, profile, 'cookies.sqlite');
        if (fs.existsSync(dbPath)) firefoxPaths.push(dbPath);
      }
      
      if (firefoxPaths.length > 0) paths['Mozilla Firefox'] = firefoxPaths;
    } catch(e) {}
  }
  
  return paths;
}

// ============================================================
// Read Cookies from SQLite (using better-sqlite3 or fallback)
// ============================================================

async function readChromeCookies(dbPath) {
  // Try to use better-sqlite3 first
  let sqlite3;
  try {
    sqlite3 = require('better-sqlite3');
  } catch(e) {
    console.log('     [INFO] better-sqlite3 not found, trying sql.js...');
    try {
      sqlite3 = require('sql.js');
    } catch(e2) {
      throw new Error('No SQLite library available. Run: npm install better-sqlite3');
    }
  }
  
  const cookies = [];
  
  try {
    // Copy DB to avoid lock issues
    const tempPath = dbPath + '.temp_read';
    fs.copyFileSync(dbPath, tempPath);
    
    let db;
    if (sqlite3.name === 'better-sqlite3') {
      db = new sqlite3(tempPath, { readonly: true });
    } else {
        // sql.js
        const SQL = await sqlite3();
        const fileBuffer = fs.readFileSync(tempPath);
        db = await SQL.Database.load(fileBuffer);
      }
    
    // Query TDX-related cookies
    const rows = db.prepare?.(`
      SELECT host_key, name, value, encrypted_value, 
             path, expires_utc, is_secure, is_httponly,
             samesite, source_port, source_scheme
      FROM cookies 
      WHERE host_key LIKE '%tdx%' OR host_key LIKE '%pul%'
      ORDER BY host_key, name
    `)?.all() || [];
    
    for (const row of rows || []) {
      let value = null;
      
      // Prefer plaintext value
      if (row.value && row.value.length > 0) {
        value = row.value.toString();
      } else if (row.encrypted_value && row.encrypted_value.length > 0) {
        // Try DPAPI decrypt on Windows
        try {
          value = await decryptDPAPI(row.encrypted_value);
        } catch(e) {}
      }
      
      if (value) {
        cookies.push({
          domain: row.host_key,
          name: row.name,
          value: value,
          path: row.path,
          secure: !!row.is_secure,
          httpOnly: !!row.is_httponly,
          expires: row.expires_utc ? new Date(row.expires_utc / 10000 - 11644473600000).toISOString() : null
        });
      }
    }
    
    if (db.close) db.close();
    else if (db.close) await db.close(); // sql.js
    
    // Cleanup temp file
    try { fs.unlinkSync(tempPath); } catch(e) {}
    
  } catch(e) {
    console.error(`     [ERROR] Read failed: ${e.message}`);
  }
  
  return cookies;
}

async function decryptDPAPI(encryptedBuffer) {
  /**
   * Decrypt Chrome's DPAPI-encrypted cookie on Windows
   * Uses PowerShell to call CryptUnprotect
   */
  if (process.platform !== 'win32') return null;
  
  try {
    // Write encrypted data to temp file
    const tempIn = path.join(os.tmpdir(), `tdx_enc_${Date.now()}.bin`);
    const tempOut = path.join(os.tmpdir(), `tdx_dec_${Date.now()}.txt`);
    
    // Convert buffer to hex for PowerShell
    const hexStr = Buffer.from(encryptedBuffer).toString('hex');
    
    // Use PowerShell to decrypt via DPAPI
    const psScript = `
$bytes = [byte[]] -split ('${hexStr}' -replace '..', ',0x') -ne ''
$protected = [System.Security.Cryptography.ProtectedMemory]::Protect($bytes, 'CurrentUserScope')
[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes("test"))
# Actually use CryptUnprotect via .NET
Add-Type -AssemblyName System.Security
$decrypted = [System.Security.Cryptography.ProtectedMemory]::Unprotect($encryptedBuffer, $null, 'CurrentUserScope')
[System.Text.Encoding]::UTF8.GetString($decrypted)
`;
    
    // Simpler approach: use Node addon or just skip
    // For now, return a marker that encryption was detected
    return `[ENCRYPTED:${encryptedBuffer.length} bytes]`;
    
  } catch(e) {
    return null;
  }
}

// ============================================================
// Validate with Wenda API
// ============================================================

async function validateWendaSession(cookiesDict) {
  const result = {
    success: false,
    workingEndpoints: [],
    failedEndpoints: [],
    cookiesUsed: cookiesDict,
    responses: {},
    timestamp: new Date().toISOString()
  };
  
  for (const [name, url] of Object.entries(WENDA_ENDPOINTS)) {
    try {
      // Build cookie header string
      const cookieStr = Object.entries(cookiesDict)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          ...HEADERS,
          'Cookie': cookieStr
        },
        body: JSON.stringify({ query: '低空经济' }),
        signal: AbortSignal.timeout(15000)
      });
      
      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text.substring(0, 200) }; }
      
      result.responses[name] = { status: resp.status, data };
      
      const isOk = resp.status === 200 && !(data && data.code === 401);
      
      if (isOk) {
        result.workingEndpoints.push(name);
        result.success = true;
      } else {
        result.failedEndpoints.push(name);
      }
      
      const icon = isOk ? '+' : '-';
      console.log(`  ${icon} [${name.padEnd(6)}] HTTP ${String(resp.status).padStart(3)} | ${JSON.stringify(data).substring(0, 120)}`);
      
    } catch(e) {
      result.failedEndpoints.push(name);
      console.log(`  x [${name}] ERROR: ${e.message.substring(0, 60)}`);
    }
  }
  
  return result;
}

// ============================================================
// Main Scanner Class
// ============================================================

class TDxCookieScanner {
  constructor() {
    this.foundCookies = {};  // {domain: [cookies]}
    this.validSessions = [];
  }
  
  async scanBrowsers() {
    console.log('\n' + '='.repeat(70));
    console.log(' 🔍 Scanning Browsers for TDX/Wenda Cookies');
    console.log('='.repeat(70));
    
    const browserPaths = findBrowserCookiePaths();
    
    if (Object.keys(browserPaths).length === 0) {
      console.log('\n  ⚠️  No browser cookie databases found!');
      console.log('  Please ensure:');
      console.log('    • Chrome/Edge/Firefox is installed');
      console.log('    • You have logged into pul.tdx.com.cn at least once');
      return this.foundCookies;
    }
    
    let totalFound = 0;
    
    for (const [browserName, dbPaths] of Object.entries(browserPaths)) {
      console.log(`\n📂 ${browserName} (${dbPaths.length} profile(s)):`);
      
      for (let i = 0; i < dbPaths.length; i++) {
        const dbPath = dbPaths[i];
        const profileName = path.basename(path.dirname(dbPath));
        
        console.log(`\n  Profile #${i + 1}: ${profileName}`);
        console.log(`     DB: ${dbPath}`);
        
        // Check if browser might be locking the file
        try {
          const fd = fs.openSync(dbPath, 'r');
          fs.closeSync(fd);
        } catch(e) {
          console.log(`     ⚠️  File may be locked by running browser`);
          console.log('     → Close browser and retry, or copy the DB manually');
          continue;
        }
        
        const cookies = await readChromeCookies(dbPath);
        
        if (cookies.length === 0) {
          console.log('     → No TDX cookies found (or all encrypted)');
          continue;
        }
        
        // Group by domain
        const byDomain = {};
        for (const c of cookies) {
          if (!byDomain[c.domain]) byDomain[c.domain] = [];
          byDomain[c.domain].push(c);
        }
        
        console.log(`     → Found ${cookies.length} TDX cookie(s) in ${Object.keys(byDomain).length} domain(s):`);
        
        for (const [domain, domainCookies] of Object.entries(byDomain)) {
          const names = domainCookies.map(c => c.name);
          const samples = domainCookies.slice(0, 5)
            .map(c => `${c.name}=${c.value.substring(0, 15)}...`);
          
          if (!this.foundCookies[domain]) this.foundCookies[domain] = [];
          this.foundCookies[domain].push(...domainCookies);
          totalFound += domainCookies.length;
          
          console.log(`       🌐 ${domain}: ${domainCookies.length} cookies`);
          console.log(`          Names: ${names.join(', ')}`);
          console.log(`          Sample: ${samples[0]}`);
        }
      }
    }
    
    console.log('\n' + '='.repeat(70));
    console.log(` ✅ Scan Complete: ${totalFound} TDX cookies in ${Object.keys(this.foundCookies).length} domains`);
    
    return this.foundCookies;
  }
  
  async validateAndExport(outputFile = 'wenda-session-config.json') {
    console.log('\n' + '='.repeat(70));
    console.log(' 🧪 Validating Cookies with Wenda API');
    console.log('='.repeat(70));
    
    // Build candidate cookie dicts
    const candidates = [];
    
    for (const [domain, cookies] of Object.entries(this.foundCookies)) {
      const dict = {};
      for (const c of cookies) {
        if (c.value && !c.value.startsWith('[ENCRYPTED')) {
          dict[c.name] = c.value;
        }
      }
      
      if (Object.keys(dict).length > 0) {
        candidates.push({
          sourceDomain: domain,
          cookies: dict,
          count: Object.keys(dict).length
        });
      }
    }
    
    if (candidates.length === 0) {
      console.log('\n  ❌ No usable cookies found (all may be encrypted)');
      console.log('\n💡 Alternative approach:');
      console.log('  1. Close your browser completely');
      console.log('  2. Re-run this script');
      console.log('  Or use manual import mode:');
      console.log('  node wenda-cookie-reader-node.js --import cookies.txt');
      return [];
    }
    
    console.log(`\n  Testing ${candidates.length} candidate(s)...\n`);
    
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      console.log(`  [#${i + 1}] Domain: ${c.sourceDomain} (${c.count} cookies)`);
      
      const result = await validateWendaSession(c.cookies);
      result.sourceDomain = c.sourceDomain;
      
      if (result.success) {
        this.validSessions.push(result);
        console.log(`\n  🎉 SUCCESS! Works for: ${result.workingEndpoints.join(', ')}`);
      } else {
        console.log(`\n  ⚠️  Doesn't work for Wenda`);
      }
    }
    
    // Generate config if valid session found
    if (this.validSessions.length > 0) {
      const best = this.validSessions[0];
      
      const config = {
        generatedAt: new Date().toISOString(),
        source: 'browser_cookie_extractor_nodejs',
        validForWenda: true,
        workingEndpoints: best.workingEndpoints,
        sourceDomain: best.sourceDomain,
        cookies: best.cookiesUsed,
        usage: {
          nodejs: `
// Load cookies from config
const config = require('./${outputFile}');
const cookies = config.cookies;

// Build cookie string
const cookieStr = Object.entries(cookies).map(([k,v]) => k + '=' + v).join('; ');

// Call Wenda API
fetch('https://www.tdx.com.cn/wenda/api/tools/zx_query', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Cookie': cookieStr,
    'User-Agent': 'Mozilla/5.0 ...'
  },
  body: JSON.stringify({ query: '低空经济' })
}).then(r => r.json()).then(console.log);`,
          
          curlCommand: `curl -X POST '${WENDA_ENDPOINTS.news}' \\
  -H 'Content-Type: application/json' \\
  -H 'Cookie: ${Object.entries(best.cookiesUsed).map(([k,v])=>`${k}=${v}`).join('; ')}' \\
  -d '{"query":"test"}'`
        }
      };
      
      fs.writeFileSync(outputFile, JSON.stringify(config, null, 2), 'utf-8');
      
      console.log('\n' + '='.repeat(70));
      console.log(` 💾 Config saved: ${outputFile}`);
      console.log('='.repeat(70));
      console.log(`\n  📋 Summary:`);
      console.log(`     Source: ${best.sourceDomain}`);
      console.log(`     Cookies: ${Object.keys(best.cookiesUsed).length} items`);
      console.log(`     Valid for: ${best.workingEndpoints.join(', ')}`);
      console.log(`\n  📖 Usage: Load JSON file and use cookies object`);
    } else {
      console.log('\n' + '='.repeat(70));
      console.log(' ⚠️  No working session found automatically');
      console.log('='.repeat(70));
      console.log(`
Tips:
  • Make sure you've logged into https://pul.tdx.com.cn recently
  • Some Chrome cookies are encrypted (DPAPI on Windows)
  • Try manual mode: node wenda-cookie-reader-node.js -i cookies.txt

Manual extraction:
  1. Open https://pul.tdx.com.cn in browser (logged in)
  2. F12 → Network → Refresh page
  3. Click any request → Headers → Cookie
  4. Save to cookies.txt (format: name=value per line)
  5. Run: node wenda-cookie-reader-node.js -i cookies.txt
`);
    }
    
    // Export summary
    const summaryFile = 'extracted-cookies-summary.json';
    const summary = {
      exportTime: new Date().toISOString(),
      totalDomains: Object.keys(this.foundCookies).length,
      totalCookies: Object.values(this.foundCookies).reduce((s, c) => s + c.length, 0),
      domains: {},
      validSessions: this.validSessions.map(s => ({
        source: s.sourceDomain,
        endpoints: s.workingEndpoints,
        cookieCount: Object.keys(s.cookiesUsed).length
      }))
    };
    
    for (const [domain, cookies] of Object.entries(this.foundCookies)) {
      summary.domains[domain] = cookies.map(c => ({
        name: c.name,
        preview: c.value.substring(0, 25) + (c.value.length > 25 ? '...' : ''),
        secure: c.secure,
        httpOnly: c.httpOnly
      }));
    }
    
    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), 'utf-8');
    console.log(`\n  📄 Full export: ${summaryFile}`);
    
    return this.validSessions;
  }
}

// ============================================================
// CLI
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  
  console.log('='.repeat(70));
  console.log(' TDX Finance MCP - Browser Cookie Reader (Node.js)');
  console.log(` Time: ${new Date().toLocaleString('zh-CN')}`);
  console.log('='.repeat(70));
  
  const scanner = new TDxCookieScanner();
  
  // Check for --import flag
  const importIdx = args.indexOf('--import') || args.indexOf('-i');
  if (importIdx >= 0 && args[importIdx + 1]) {
    const importFile = args[importIdx + 1];
    console.log(`\n📂 Importing from: ${importFile}`);
    
    try {
      const content = fs.readFileSync(importFile, 'utf-8');
      const imported = {};
      
      content.split('\n').forEach(line => {
        line = line.trim();
        if (line && line.includes('=') && !line.startsWith('#')) {
          const eqIdx = line.indexOf('=');
          imported[line.substring(0, eqIdx)] = line.substring(eqIdx + 1);
        }
      });
      
      console.log(`  Imported ${Object.keys(imported).length} cookies`);
      console.log('\n🧪 Testing...');
      
      const result = await validateWendaSession(imported);
      
      if (result.success) {
        const outFile = args.indexOf('-o') >= 0 ? args[args.indexOf('-o') + 1] : 'wenda-session-imported.json';
        fs.writeFileSync(outFile, JSON.stringify({
          source: 'manual_import',
          validForWenda: true,
          workingEndpoints: result.workingEndpoints,
          cookies: imported
        }, null, 2), 'utf-8');
        console.log(`\n💾 Saved: ${outFile}`);
      } else {
        console.log('\n❌ Imported cookies don\'t work for Wenda');
      }
      
      return;
    } catch(e) {
      console.error(`❌ Error: ${e.message}`);
      return;
    }
  }
  
  // Scan browsers
  await scanner.scanBrowsers();
  
  if (Object.keys(scanner.foundCookies).length === 0) return;
  
  // Validate
  const outputFile = args.includes('-o') ? args[args.indexOf('-o') + 1] : 'wenda-session-config.json';
  await scanner.validateAndExport(outputFile);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});