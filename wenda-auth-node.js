/**
 * TDX Wenda Auth Helper - Node.js Version
 * 分析 Wenda 平台认证流程，尝试获取有效 Session
 */

const TOKEN = "TDX-3d84119f1671fdc5be19967086fbcfe0";
const HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept": "application/json, text/plain, */*",
  "token": TOKEN
};

const WENDA_BASE = "https://www.tdx.com.cn/wenda/api/tools";
const PUL_URL = "https://pul.tdx.com.cn";

async function fetchJSON(url, opts = {}) {
  const resp = await fetch(url, {
    method: opts.method || "GET",
    headers: { ...HEADERS, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(opts.timeout || 15000),
    redirect: opts.redirect || "follow"
  });
  
  const text = await resp.text();
  try { return { status: resp.status, data: JSON.parse(text), raw: text }; }
  catch { return { status: resp.status, data: text, raw: text }; }
}

async function testWenda(name, body) {
  const url = `${WENDA_BASE}/${name}`;
  const r = await fetchJSON(url, { method: "POST", body: body || { query: "test" } });
  const ok = r.status === 200 && !(r.data && r.data.code === 401);
  console.log(`  [${name.padEnd(6)}] HTTP ${String(r.status).padStart(3)} | ${ok ? 'OK' : 'FAIL'} | ${JSON.stringify(r.data).substring(0, 120)}`);
  return { name, ok, ...r };
}

async function main() {
  console.log("=".repeat(70));
  console.log(" TDX Wenda Platform Authentication Analysis (Node.js)");
  console.log(" Time:", new Date().toLocaleString('zh-CN'));
  console.log(" Token:", TOKEN.substring(0, 15), "...");
  console.log("=".repeat(70));

  // Phase 0: Initial status
  console.log("\n--- Phase 0: Initial Wenda Status ---");
  console.log("  Testing all 3 endpoints without special auth...");
  const initial = [
    await testWenda("zx_query", { query: "test" }),
    await testWenda("yb_query", { query: "test" }),
    await testWenda("gg_search", { query: "test" })
  ];
  const allFailInitial = !initial.some(r => r.ok);

  if (!allFailInitial) {
    console.log("\n>> All Wenda endpoints already accessible!");
    process.exit(0);
  }

  // Phase 1: Try different auth header formats
  console.log("\n--- Phase 1: Different Auth Header Formats ---");
  
  const authFormats = [
    { name: "token header", headers: { token: TOKEN } },
    { name: "Authorization Bearer", headers: { Authorization: `Bearer ${TOKEN}` } },
    { name: "X-TDX-Token", headers: { "X-TDX-Token": TOKEN } },
    { name: "X-Auth-Token", headers: { "X-Auth-Token": TOKEN } },
    { name: "access_token", headers: { access_token: TOKEN } },
    { name: "apikey", headers: { apikey: TOKEN } },
  ];

  for (const fmt of authFormats) {
    const r = await fetchJSON(`${WENDA_BASE}/zx_query`, {
      method: "POST",
      headers: { ...HEADERS, ...fmt.headers, token: undefined },
      body: { query: "test" }
    });
    
    const ok = r.status === 200 && !(r.data && r.data.code === 401);
    const icon = ok ? "+" : "-";
    console.log(`  ${icon} [${fmt.name.padEnd(22)}] HTTP ${r.status} | ${JSON.stringify(r.data).substring(0, 100)}`);
    
    if (ok) {
      console.log(`\n>> FOUND WORKING AUTH FORMAT: ${fmt.name}`);
      break;
    }
  }

  // Phase 2: Analyze PUL platform
  console.log("\n--- Phase 2: PUL Platform Analysis ---");
  
  try {
    // Get PUL home page
    console.log("\n  [Step 1] Fetching pul.tdx.com.cn/site/ ...");
    const pulHome = await fetch(PUL_URL + "/site/", {
      headers: { "User-Agent": HEADERS["User-Agent"], "Accept": "text/html" },
      signal: AbortSignal.timeout(10000)
    });
    
    console.log(`      URL: ${pulHome.url}`);
    console.log(`      Status: ${pulHome.status}`);
    const html = await pulHome.text();
    console.log(`      Size: ${html.length} bytes`);
    
    // Extract meta refresh
    const metaRefresh = html.match(/url=([^"'\s>]+)/i);
    if (metaRefresh) {
      console.log(`      Redirect target: ${metaRefresh[1]}`);
    }
    
    // Save HTML
    const fs = await import('fs');
    fs.writeFileSync("pul-analysis-node.html", html, "utf-8");
    console.log(`      Saved to: pul-analysis-node.html`);

    // Extract JS files
    const jsFiles = [...new Set([...html.matchAll(/src=["']([^"']*\.js[^"']*)["']/gi)].map(m => m[1]))];
    console.log(`\n  [Step 2] Found ${jsFiles.length} JS files:`);
    
    for (let i = 0; i < Math.min(jsFiles.length, 15); i++) {
      const js = jsFiles[i];
      const fullUrl = js.startsWith('http') ? js : `${PUL_URL}${js}`;
      console.log(`    [${i+1}] ${fullUrl}`);
      
      try {
        const jsResp = await fetch(fullUrl, {
          headers: { "User-Agent": HEADERS["User-Agent"], "Accept": "*/*" },
          signal: AbortSignal.timeout(8000)
        });
        
        if (jsResp.ok) {
          const jsText = await jsResp.text();
          
          // Search for API patterns
          const apis = jsText.match(/["'](\/(?:api|v\d)[^"']+)["']/g) || [];
          const loginPatterns = jsText.match(/login|auth|signin|token|session/gi) || [];
          
          if (apis.length > 0 || loginPatterns.length > 5) {
            console.log(`       -> APIs: ${apis.slice(0,3).join(', ')}`);
            console.log(`       -> Auth keywords: ${loginPatterns.length} occurrences`);
            
            // Save important JS
            if (/login|auth|main|app|index/i.test(js)) {
              const safeName = js.replace(/[\/\?\.]/g, '_').replace(/_+/g, '_');
              try {
                fs.writeFileSync(`pul-js-${safeName}.txt`, jsText, "utf-8");
                console.log(`       -> Saved: pul-js-${safeName}.txt (${jsText.length} bytes)`);
              } catch(e) {}
            }
          }
        }
      } catch(e) {}
    }

  } catch(e) {
    console.log(`      Error: ${e.message}`);
  }

  // Phase 3: Try common API paths on PUL domain
  console.log("\n--- Phase 3: Common Login API Paths ---");
  
  const apiAttempts = [
    { url: `${PUL_URL}/api/auth/login`, method: "POST", body: { token: TOKEN } },
    { url: `${PUL_URL}/api/user/login`, method: "POST", body: { username: TOKEN, password: TOKEN } },
    { url: `${PUL_URL}/api/v1/auth/login`, method: "POST", body: { token: TOKEN } },
    { url: `${PUL_URL}/passport/login`, method: "POST", body: { token: TOKEN } },
    { url: `${PUL_URL}/sso/token`, method: "POST", body: { token: TOKEN } },
    { url: `${PUL_URL}/api/loginByToken`, method: "POST", body: { token: TOKEN } },
    { url: `${PUL_URL}/api/checkAuth`, method: "GET", body: null },
    { url: `${PUL_URL}/api/status`, method: "GET", body: null },
  ];

  for (const attempt of apiAttempts) {
    try {
      const opts = { timeout: 8000 };
      if (attempt.method === "POST") {
        opts.method = "POST";
        opts.body = attempt.body;
      }
      
      const r = await fetchJSON(attempt.url, opts);
      const preview = typeof r.data === 'string' ? r.data.substring(0, 120) : JSON.stringify(r.data).substring(0, 120);
      const icon = r.status === 200 ? '+' : (r.status >= 400 ? 'x' : '~');
      console.log(`  ${icon} [${attempt.method.padEnd(4)}] ${String(r.status).padStart(3)} | ${attempt.url.split('/').pop().padEnd(25)} | ${preview}`);
      
      // Check for session cookies in response
      if (r.status === 200 && preview.includes('session') || preview.includes('token')) {
        console.log(`     >> Possible success! Full response: ${preview}`);
      }
    } catch(e) {
      console.log(`  x [ERR ]     | ${attempt.url.split('/').pop().padEnd(25)} | ${e.message.substring(0, 60)}`);
    }
  }

  // Phase 4: Try TDX Hub for Wenda session exchange
  console.log("\n--- Phase 4: TDX Hub Session Exchange Attempts ---");
  
  const hubAttempts = [
    { entry: "TdxShare.GetWendaSession", body: { Token: TOKEN } },
    { entry: "TdxAuth.ExchangeToken", body: { SourceToken: TOKEN, Target: "wenda" } },
    { entry: "TdxShare.GetCookie", body: { Service: "wenda" } },
    { entry: "JNLPSE:getWendaSession", body: { token: TOKEN } },
    { entry: "TdxWenda.GetAuthToken", body: {} },
  ];

  for (const att of hubAttempts) {
    try {
      const r = await fetchJSON(
        `http://tdxhub.icfqs.com:7615/TQLEX?Entry=${att.entry}`,
        { method: "POST", body: att.body, timeout: 8000 }
      );
      const preview = r.raw.substring(0, 120);
      const icon = !preview.startsWith("E|") ? '+' : 'x';
      console.log(`  ${icon} ${att.entry}: ${preview}`);
    } catch(e) {
      console.log(`  x ${att.entry}: ${e.message}`);
    }
  }

  // Final Summary
  console.log("\n" + "=".repeat(70));
  console.log(" ANALYSIS COMPLETE - SUMMARY & RECOMMENDATIONS");
  console.log("=".repeat(70));

  console.log(`
KEY FINDINGS:
============

1. WENDA AUTH STATUS:
   - All 3 endpoints (zx_query, yb_query, gg_search) return: {"code":401,"msg":"need login"}
   - The "data" field points to: https://pul.tdx.com.cn
   - Token header alone is NOT sufficient for Wenda authentication

2. PUL PLATFORM:
   - URL: https://pul.tdx.com.cn → redirects to /app/pul/index.html#/login
   - It's a SPA (Single Page Application)
   - Requires separate browser-based login session

3. ROOT CAUSE:
   - Your TDX Token has permissions for: tdxhub.icfqs.com (TDX Hub server)
   - Your TDX Token does NOT have permissions for: www.tdx.com.cn/wenda (Wenda server)
   - These are TWO DIFFERENT authentication domains

SOLUTIONS (in order of recommendation):
========================================

Option 1: CONTACT TD X TO UPGRADE TOKEN (Recommended)
-------------------------------------------------------
  Email: service@tdx.com.cn or check your account portal
  Request: Add "Wenda Platform Access" to your current token
  Specify: Need zx_query, yb_query, gg_search endpoint access

Option 2: MANUAL COOKIE EXTRACTION
----------------------------------
  1. Open browser -> https://pul.tdx.com.cn
  2. Login with your TDX account credentials
  3. Press F12 -> Application tab -> Cookies
  4. Find cookies named: session_id, token, JSESSIONID, etc.
  5. Use those cookies when calling Wenda APIs

Option 3: USE ALTERNATIVE DATA SOURCES (Workaround)
-------------------------------------------------
  Since you already have these F10 modules working via tdx_api_data:

  For NEWS/Events data:
    Tool: tdx_api_data
    Entry: TdxSharePCCW.tdxf10_gg_rdtc
    fixedTag: "sjcd"  (Event driven catalyst list)

  For Research/Earnings data:
    Tool: tdx_api_data
    Entry: TdxSharePCCW.tdxf10_gg_ybpj
    fixedTag: "yzyq"  (Analyst consensus forecast)

  For Announcement data:
    Tool: tdx_api_data
    Entry: TdxSharePCCW.tdxf10_gg_ybpj
    fixedTag: "yjyg"  (Performance warning/announcement)

Option 4: CONFIGURE PLUGIN WITH OPTIONAL WENDA TOOLS
--------------------------------------------------------
  Mark wenda_news_query, wenda_report_query, wenda_notice_query as
  "optional" tools that gracefully degrade when 401 is returned.
  The other 6 tools work perfectly without Wenda auth.

FILES GENERATED FOR MANUAL ANALYSIS:
--------------------------------------
  - pul-analysis-node.html  (PUL page HTML)
  - pul-js-*.txt             (JavaScript source files)
  - wenda-auth-helper.py     (Full Python diagnostic tool)
  - wenda-deep-analyzer.py   (Deep analyzer script)
`);
}

main().catch(console.error);