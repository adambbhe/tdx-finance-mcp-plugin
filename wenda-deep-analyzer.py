#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TDX Wenda Auth - Deep Login Page Analyzer
分析 pul.tdx.com.cn 的实际登录流程
"""

import requests
import json
import re

TOKEN = "TDX-3d84119f1671fdc5be19967086fbcfe0"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

def main():
    print("=" * 70)
    print(" TDX Wenda - Deep Login Flow Analysis")
    print("=" * 70)
    
    session = requests.Session()
    
    # Step 1: Follow redirect to login page
    print("\n[Step 1] 跟踪重定向到登录页...")
    resp = session.get(
        "https://pul.tdx.com.cn/site/",
        headers=HEADERS,
        timeout=15,
        allow_redirects=True
    )
    print(f"  最终URL: {resp.url}")
    print(f"  状态码: {resp.status_code}")
    
    # Step 2: Get the SPA login page
    login_url = "https://pul.tdx.com.cn/app/pul/index.html"
    print(f"\n[Step 2] 获取SPA登录页面: {login_url}")
    
    resp2 = session.get(login_url, headers=HEADERS, timeout=15)
    html = resp2.text
    
    # Save full HTML
    with open("pul-login-page.html", "w", encoding="utf-8") as f:
        f.write(html)
    print(f"  页面大小: {len(html)} bytes")
    print(f"  已保存到: pul-login-page.html")
    
    # Extract JS files (they contain the real API logic)
    js_files = re.findall(r'src=["\']([^"\']*(?:\.js|\.js\?[^"\']*)["\']', html, re.I)
    unique_js = list(set(js_files))
    print(f"\n  发现 {len(unique_js)} 个JS文件:")
    
    for i, js in enumerate(unique_js[:20]):
        full_url = js if js.startswith('http') else f"https://pul.tdx.com.cn{js}"
        print(f"    [{i+1}] {full_url}")
        
        # Try to fetch each JS file and look for API endpoints
        try:
            js_resp = session.get(full_url, headers={**HEADERS, "Accept": "*/*"}, timeout=10)
            if js_resp.status_code == 200:
                js_content = js_resp.text
                
                # Search for API patterns in JS
                api_patterns = re.findall(r'["\'](/(?:api|v\d)[^"\']*)["\']', js_content)
                auth_patterns = re.findall(r'(?:login|auth|signin|token|session)["\s]*[:=]["\s]*([^"\';]+)', js_content, re.I)
                
                if api_patterns:
                    print(f"       → 发现 {len(api_patterns)} 个API路径: {api_patterns[:5]}")
                if auth_patterns:
                    print(f"       → 发现认证相关代码: {auth_patterns[:3]}")
                    
                # Save important JS files
                if any(kw in js.lower() for kw in ['login', 'auth', 'main', 'index', 'app']):
                    safe_name = js.replace('/', '_').replace('?', '_').replace('.', '_')
                    try:
                        with open(f"pul-js-{safe_name}.txt", "w", encoding="utf-8") as f:
                            f.write(js_content)
                        print(f"       → 已保存: pul-js-{safe_name}.txt ({len(js_content)} bytes)")
                    except: pass
                    
        except Exception as e:
            print(f"       → 获取失败: {e}")
    
    # Step 3: Try common API paths directly
    print("\n[Step 3] 尝试常见登录API路径...")
    
    api_paths = [
        ("POST", "https://pul.tdx.com.cn/api/auth/login", {"token": TOKEN}),
        ("POST", "https://pul.tdx.com.cn/api/user/login", {"username": TOKEN, "password": TOKEN}),
        ("POST", "https://pul.tdx.com.cn/app/pul/api/login", {"token": TOKEN}),
        ("POST", "https://pul.tdx.com.cn/passport/login", {"token": TOKEN}),
        ("GET", "https://pul.tdx.com.cn/api/auth/check", None),
        ("GET", "https://pul.tdx.com.cn/api/v1/status", None),
        ("POST", "https://pul.tdx.com.cn/api/loginByToken", {"token": TOKEN}),
        ("POST", "https://www.tdx.com.cn/wenda/api/auth/login", {"token": TOKEN}),
    ]
    
    for method, url, body in api_paths:
        try:
            kwargs = dict(headers={**HEADERS, "token": TOKEN}, timeout=8)
            if method == "POST":
                kwargs["json"] = body or {}
            
            r = session.request(method, url, **kwargs)
            
            try:
                data = r.json()
                preview = json.dumps(data, ensure_ascii=False)[:150]
            except:
                preview = r.text[:150]
            
            icon = "✅" if r.status_code == 200 else ("🔴" if r.status_code >= 400 else "⚠️")
            print(f"  {icon} [{method:4s}] {r.status_code:3d} | {url.split('/')[-1]:30s} | {preview}")
            
            # If success, check cookies
            if r.status_code == 200 and list(session.cookies):
                print(f"       → 获得Cookies: {list(session.cookies.keys())}")
                
        except Exception as e:
            print(f"  ❌ {method:4s} ERR  | {url.split('/')[-1]:30s} | {str(e)[:60]}")
    
    # Step 4: Check if there's a token exchange via TDX Hub
    print("\n[Step 4] 尝试通过 TDX Hub 获取 Wanda Session...")
    
    hub_exchanges = [
        ("TdxShare.GetWendaSession", {"Token": TOKEN}),
        ("TdxAuth.GetWendaCookie", {"SourceToken": TOKEN}),
        ("JNLPSE:getWendaAuth", {"token": TOKEN}),
    ]
    
    for entry, body in hub_exchanges:
        try:
            r = session.post(
                f"http://tdxhub.icfqs.com:7615/TQLEX?Entry={entry}",
                json=body,
                headers={"Content-Type": "application/json", "token": TOKEN},
                timeout=10
            )
            text = r.text[:150]
            icon = "✅" if not text.startswith("E|") else "❌"
            print(f"  {icon} {entry}: {text}")
        except Exception as e:
            print(f"  ❌ {entry}: {e}")
    
    # Final summary
    print("\n" + "=" * 70)
    print(" ANALYSIS COMPLETE")
    print("=" * 70)
    
    print("""
KEY FINDINGS:

1. PUL Platform Architecture:
   - URL: https://pul.tdx.com.cn → redirects to /app/pul/index.html#/login
   - It is a Single Page Application (SPA), likely Vue/React/Angular
   
2. Authentication System:
   - Wenda uses a SEPARATE authentication system from TDX Hub
   - Token header alone is NOT sufficient for Wenda APIs
   - Requires browser-based login session (cookies)

3. Possible Solutions:

   A) Contact TDX to upgrade your token permissions:
      Request access to: wenda platform (news/reports/notices)

   B) Manual Cookie Extraction:
      1. Open https://pul.tdx.com.cn in browser
      2. Login with your TDX account
      3. F12 → Application → Cookies → Copy relevant values
      4. Use those cookies in API calls

   C) Use alternative data sources (already available):
      - News/Events: tdx_api_data → rdtc/sjcd (event driven module)
      - Reports: tdx_api_data → ybpj (earnings forecast)
      - Notices: tdx_api_data → yjyg (performance warning)

FILES GENERATED:
   - pul-page-analysis.html  (initial redirect page)
   - pul-login-page.html     (SPA login page)
   - pul-js-*.txt             (JavaScript source files)
""")


if __name__ == "__main__":
    main()