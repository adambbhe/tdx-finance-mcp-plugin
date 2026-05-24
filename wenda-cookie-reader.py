#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TDX Finance MCP Plugin - Browser Cookie Reader & Wenda Session Validator
====================================================================
自动读取本地浏览器 Cookie (Chrome/Edge/Firefox)，提取 TDX/Wenda 相关会话，
并验证是否可用于调用 Wenda API (新闻/研报/公告)。

支持:
  - Google Chrome / Microsoft Edge (SQLite Cookie DB)
  - Mozilla Firefox (SQLite Cookie DB)
  - 手动导入 Cookie 文本
  - 自动测试 Wenda API 可用性
  - 导出有效 Session 配置

Author: TDX MCP Plugin Team
Version: 2026.5.25
"""

import os
import sys
import json
import time
import sqlite3
import shutil
import tempfile
from pathlib import Path
from datetime import datetime, timedelta
from urllib.parse import urlparse
from typing import Dict, List, Optional, Tuple

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False
    print("[WARN] requests 库未安装! 请运行: pip install requests")

# ============================================================
# Configuration
# ============================================================

TDX_DOMAINS = ["tdx.com.cn", "pul.tdx.com.cn", "tdxhub.icfqs.com"]
WENDA_ENDPOINTS = {
    "news": "https://www.tdx.com.cn/wenda/api/tools/zx_query",
    "report": "https://www.tdx.com.cn/wenda/api/tools/yb_query",
    "notice": "https://www.tdx.com.cn/wenda/api/tools/gg_search",
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

TEST_QUERY = {"query": "低空经济"}


# ============================================================
# Browser Cookie Database Paths
# ============================================================

def get_browser_cookie_paths() -> Dict[str, List[Path]]:
    """
    获取各浏览器的 Cookie 数据库路径
    
    Returns:
        {browser_name: [path1, path2, ...]}
    """
    paths = {}
    
    # Windows 路径
    home = Path.home()
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    app_data = os.environ.get("APPDATA", "")
    
    # === Chrome ===
    chrome_paths = []
    if local_app_data:
        default = Path(local_app_data) / "Google" / "Chrome" / "User Data" / "Default"
        if default.exists():
            chrome_paths.append(default / "Network" / "Cookies")
            # Also check for Profile folders (Profile 1, Profile 2, etc.)
            user_data_dir = Path(local_app_data) / "Google" / "Chrome" / "User Data"
            if user_data_dir.exists():
                for profile in sorted(user_data_dir.glob("Profile *")):
                    cookie_path = profile / "Network" / "Cookies"
                    if cookie_path.exists() and str(profile) != str(default):
                        chrome_paths.append(cookie_path)
    if chrome_paths:
        paths["Google Chrome"] = chrome_paths
    
    # === Microsoft Edge ===
    edge_paths = []
    if local_app_data:
        edge_default = Path(local_app_data) / "Microsoft" / "Edge" / "User Data" / "Default"
        if edge_default.exists():
            edge_paths.append(edge_default / "Network" / "Cookies")
            edge_user_data = Path(local_app_data) / "Microsoft" / "Edge" / "User Data"
            if edge_user_data.exists():
                for profile in sorted(edge_user_data.glob("Profile *")):
                    cookie_path = profile / "Network" / "Cookies"
                    if cookie_path.exists() and str(profile) != str(edge_default):
                        edge_paths.append(cookie_path)
    if edge_paths:
        paths["Microsoft Edge"] = edge_paths
    
    # === Firefox ===
    firefox_paths = []
    if app_data:
        firefox_profiles_dir = Path(app_data) / "Mozilla" / "Firefox" / "Profiles"
        if firefox_profiles_dir.exists():
            for profile_dir in firefox_profiles_dir.iterdir():
                if profile_dir.is_dir():
                    cookie_db = profile_dir / "cookies.sqlite"
                    if cookie_db.exists():
                        firefox_paths.append(cookie_db)
    if firefox_paths:
        paths["Mozilla Firefox"] = firefox_paths
    
    return paths


# ============================================================
# Chrome/Edge Cookie Reader (SQLite)
# ============================================================

def read_chrome_cookies(db_path: Path) -> List[Dict]:
    """
    从 Chrome/Edge Cookie 数据库读取 Cookie
    
    Chrome Cookie DB Schema:
        - host_key: 域名 (e.g., ".tdx.com.cn")
        - name: Cookie 名称
        - encrypted_value: 加密的值 (需要 DPAPI 解密)
        - value: 未加密的值 (如果存在)
        - expires_utc: 过期时间
        - is_secure: 是否仅 HTTPS
        - is_httponly: 是否 HttpOnly
    """
    cookies = []
    
    try:
        # 复制数据库文件（因为可能被浏览器锁定）
        temp_fd, temp_path = tempfile.mktemp(suffix=".db")
        shutil.copy2(str(db_path), temp_path)
        
        conn = sqlite3.connect(temp_path)
        cursor = conn.cursor()
        
        # 查询所有 tdx.com.cn 相关的 Cookie
        query = """
        SELECT host_key, name, value, encrypted_value, 
               path, expires_utc, is_secure, is_httponly,
               samesite, source_port, source_scheme
        FROM cookies 
        WHERE host_key LIKE '%tdx.com%' 
           OR host_key LIKE '%pul.tdx%'
           OR host_key LIKE '%icfqs%'
        ORDER BY host_key, name
        """
        
        cursor.execute(query)
        columns = [desc[0] for desc in cursor.description]
        
        for row in cursor.fetchall():
            cookie = dict(zip(columns, row))
            
            # 尝试获取解密后的值
            cookie_value = None
            
            if cookie.get("value") and len(cookie["value"]) > 0:
                cookie_value = cookie["value"]
            elif cookie.get("encrypted_value"):
                # Chrome 在 Windows 上使用 DPAPI 加密
                # 尝试使用 win32crypt 解密
                try:
                    import ctypes
                    import ctypes.wintypes
                    
                    class DATA_BLOB(ctypes.Structure):
                        _fields_ = [
                            ("cbData", ctypes.wintypes.DWORD),
                            ("pbData", ctypes.POINTER(ctypes.c_char))
                        ]
                    
                    def win32_decrypt(encrypted_data):
                        blob_in = DATA_BLOB(len(encrypted_data), ctypes.create_string_buffer(encrypted_data, len(encrypted_data)))
                        blob_out = DATA_BLOB()
                        
                        if ctypes.windll.crypt32.CryptUnprotect(
                            None, None, None, None, 
                            ctypes.byref(blob_in), None, 
                            ctypes.byref(blob_out), None
                        ):
                            result = ctypes.string_at(blob_out.pbData, blob_out.cbData)
                            ctypes.windll.kernel32.LocalFree(blob_out.pbData)
                            return result.decode("utf-8", errors="ignore")
                        return None
                    
                    enc_data = bytes(cookie["encrypted_value"])
                    decrypted = win32_decrypt(enc_data)
                    if decrypted and len(decrypted) > 0:
                        cookie_value = decrypted
                        
                except ImportError:
                    pass  # win32crypt 不可用，跳过
                except Exception as e:
                    pass  # 解密失败
            
            if cookie_value:
                cookie["decrypted_value"] = cookie_value
                cookies.append(cookie)
        
        conn.close()
        os.unlink(temp_path)
        
    except Exception as e:
        print(f"      [ERROR] 读取失败: {e}")
    
    return cookies


# ============================================================
# Firefox Cookie Reader (SQLite)
# ============================================================

def read_firefox_cookies(db_path: Path) -> List[Dict]:
    """
    从 Firefox Cookie 数据库读取 Cookie
    
    Firefox Cookie DB Schema:
        - baseDomain: 基础域名
        - name: Cookie 名称  
        - value: Cookie 值 (明文!)
        - expiry: 过期时间戳
        - isSecure: 是否 HTTPS
        - isHttpOnly: 是否 HttpOnly
    """
    cookies = []
    
    try:
        temp_fd, temp_path = tempfile.mktemp(suffix=".sqlite")
        shutil.copy2(str(db_path), temp_path)
        
        conn = sqlite3.connect(temp_path)
        cursor = conn.cursor()
        
        query = """
        SELECT baseDomain, originAttributes, name, value, 
               path, expiry, lastAccessed, creationTime,
               isSecure, isHttpOnly, sameSite
        FROM moz_cookies 
        WHERE baseDomain LIKE '%tdx%' 
           OR baseDomain LIKE '%pul%'
           OR baseDomain LIKE '%icfqs%'
        ORDER BY baseDomain, name
        """
        
        cursor.execute(query)
        columns = [desc[0] for desc in cursor.description]
        
        for row in cursor.fetchall():
            cookie = dict(zip(columns, row))
            cookie["decrypted_value"] = cookie.get("value", "")
            cookies.append(cookie)
        
        conn.close()
        os.unlink(temp_path)
        
    except Exception as e:
        print(f"      [ERROR] 读取失败: {e}")
    
    return cookies


# ============================================================
# Cookie Validator - Test with Wenda API
# ============================================================

def validate_wenda_session(cookies_dict: Dict[str, str], verbose: bool = True) -> Dict:
    """
    使用提取的 Cookie 测试 Wenda API 是否可用
    
    Args:
        cookies_dict: {cookie_name: cookie_value}
        verbose: 是否打印详细信息
        
    Returns:
        {
            "success": bool,
            "working_endpoints": list,
            "failed_endpoints": list,
            "cookies_used": dict,
            "response_samples": dict
        }
    """
    if not HAS_REQUESTS:
        return {"error": "requests library not installed"}
    
    result = {
        "success": False,
        "working_endpoints": [],
        "failed_endpoints": [],
        "cookies_used": cookies_dict,
        "response_samples": {},
        "timestamp": datetime.now().isoformat()
    }
    
    session = requests.Session()
    session.headers.update(HEADERS)
    
    # Set cookies for both domains
    for domain in ["tdx.com.cn", "pul.tdx.com.cn"]:
        for name, value in cookies_dict.items():
            session.cookies.set(name, value, domain=domain)
    
    for endpoint_name, url in WENDA_ENDPOINTS.items():
        try:
            resp = session.post(
                url,
                json=TEST_QUERY,
                timeout=15,
                allow_redirects=True
            )
            
            try:
                data = resp.json()
            except:
                data = {"raw_text": resp.text[:200]}
            
            result["response_samples"][endpoint_name] = {
                "status_code": resp.status_code,
                "data": data
            }
            
            is_ok = resp.status_code == 200 and not (
                isinstance(data, dict) and data.get("code") == 401
            )
            
            if is_ok:
                result["working_endpoints"].append(endpoint_name)
                result["success"] = True
            else:
                result["failed_endpoints"].append(endpoint_name)
                
            if verbose:
                icon = "✅" if is_ok else "❌"
                preview = json.dumps(data, ensure_ascii=False)[:100]
                print(f"  {icon} [{endpoint_name}] HTTP {resp.status_code} | {preview}")
                
        except Exception as e:
            result["failed_endpoints"].append(endpoint_name)
            if verbose:
                print(f"  ❌ [{endpoint_name}] ERROR: {str(e)[:60]}")
    
    return result


# ============================================================
# Main Scanner & Extractor
# ============================================================

class TDxCookieScanner:
    """TDX/Wenda Cookie Scanner"""
    
    def __init__(self):
        self.found_cookies = {}  # {domain: [cookies]}
        self.valid_sessions = []   # List of valid session dicts
        self.scan_results = []
    
    def scan_all_browsers(self) -> Dict:
        """扫描所有浏览器，查找 TDX 相关 Cookie"""
        
        print("\n" + "=" * 70)
        print(" 🔍 Scanning Browsers for TDX/Wenda Cookies")
        print("=" * 70)
        
        browser_paths = get_browser_cookie_paths()
        
        if not browser_paths:
            print("\n  ⚠️  未找到任何浏览器 Cookie 数据库!")
            print("  请确保:")
            print("    • Chrome/Edge/Firefox 已安装并至少启动过一次")
            print("    • 已在浏览器中登录过 pul.tdx.com.cn 或 tdx.com.cn")
            return {}
        
        total_found = 0
        
        for browser_name, db_paths in browser_paths.items():
            print(f"\n📂 {browser_name} ({len(db_paths)} profile(s)) found:")
            
            reader = read_chrome_cookies if "Chrome" in browser_name or "Edge" in browser_name else read_firefox_cookies
            
            for i, db_path in enumerate(db_paths):
                print(f"\n  Profile #{i+1}: {db_path.parent.name}")
                cookies = reader(db_path)
                
                if not cookies:
                    print("     → No TDX-related cookies found")
                    continue
                
                # Group by domain
                by_domain = {}
                for c in cookies:
                    domain = c.get("host_key", c.get("baseDomain", ""))
                    if domain not in by_domain:
                        by_domain[domain] = []
                    by_domain[domain].append(c)
                
                print(f"     → Found {len(cookies)} TDX cookies in {len(by_domain)} domain(s):")
                
                for domain, domain_cookies in by_domain.items():
                    cookie_names = [c["name"] for c in domain_cookies]
                    masked_values = [
                        f"{c['name']}={c['decrypted_value'][:15]}..." 
                        for c in domain_cookies[:5]
                    ]
                    
                    self.found_cookies[domain] = domain_cookies
                    total_found += len(domain_cookies)
                    
                    print(f"       🌐 {domain}: {len(domain_cookies)} cookies")
                    print(f"          Names: {', '.join(cookie_names)}")
                    print(f"          Sample: {masked_values[0]}")
        
        print(f"\n{'='*70}")
        print(f" ✅ Scan Complete: {total_found} TDX cookies found across {len(self.found_cookies)} domain(s)")
        
        return self.found_cookies
    
    def extract_and_validate(self) -> List[Dict]:
        """提取 Cookie 并验证哪些可用于 Wenda"""
        
        print("\n" + "=" * 70)
        print(" 🧪 Validating Cookies with Wenda API")
        print("=" * 70)
        
        candidates = []
        
        # 为每个域名构建 Cookie 字典
        for domain, cookies in self.found_cookies.items():
            cookie_dict = {}
            for c in cookies:
                val = c.get("decrypted_value", "")
                if val and len(val) > 0:
                    cookie_dict[c["name"]] = val
            
            if cookie_dict:
                candidates.append({
                    "source_domain": domain,
                    "cookies": cookie_dict,
                    "count": len(cookie_dict)
                })
        
        if not candidates:
            print("\n  ❌ No usable cookies found (all may be encrypted or empty)")
            print("  Try: Login to https://pul.tdx.com.cn in your browser first")
            return []
        
        print(f"\n  Testing {len(candidates)} candidate(s)...\n")
        
        for i, candidate in enumerate(candidates):
            domain = candidate["source_domain"]
            count = candidate["count"]
            
            print(f"  [{'#' + str(i+1)}] Domain: {domain} ({count} cookies)")
            
            result = validate_wenda_session(candidate["cookies"], verbose=True)
            result["source_domain"] = domain
            result["candidate_index"] = i + 1
            
            if result["success"]:
                self.valid_sessions.append(result)
                print(f"\n  🎉 SUCCESS! This session works for Wenda API!")
                print(f"     Working endpoints: {', '.join(result['working_endpoints'])}")
            else:
                print(f"\n  ⚠️  This session doesn't work for Wenda (may work for other TDX services)")
        
        return self.valid_sessions
    
    def generate_session_config(self, output_file: str = "wenda-session-config.json") -> Optional[str]:
        """
        生成可用的 Session 配置文件
        
        Returns:
            配置文件路径或 None
        """
        if not self.valid_sessions:
            print("\n  ❌ No valid sessions found. Cannot generate config.")
            return None
        
        best_session = self.valid_sessions[0]
        
        config = {
            "generated_at": datetime.now().isoformat(),
            "source": "browser_cookie_extractor",
            "valid_for_wenda": True,
            "working_endpoints": best_session["working_endpoints"],
            "cookies": best_session["cookies_used"],
            "usage": {
                "python_requests": """
import requests

session = requests.Session()
for name, value in COOKIES.items():
    session.cookies.set(name, value, domain="tdx.com.cn")

# Test Wenda API
r = session.post(
    "https://www.tdx.com.cn/wenda/api/tools/zx_query",
    json={"query": "低空经济"},
    headers={"User-Agent": "..."}
)
print(r.json())
""",
                "node_fetch": """
// In Node.js with node-fetch or undici
const cookies = COOKIES;
const cookieStr = Object.entries(cookies).map(([k,v]) => `${k}=${v}`).join('; ');

const resp = await fetch('https://www.tdx.com.cn/wenda/api/tools/zx_query', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Cookie': cookieStr,
    'User-Agent': '...'
  },
  body: JSON.stringify({query: '低空经济'})
});
const data = await resp.json();
console.log(data);
""",
                "curl_command": f"""curl -X POST '{WENDA_ENDPOINTS['news']}' \\
  -H 'Content-Type: application/json' \\
  -H 'Cookie: {'; '.join(f'{k}={v}' for k,v in best_session['cookies_used'].items())}' \\
  -d '{{"query":"test"}}'
"""
            }
        }
        
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        
        print(f"\n" + "=" * 70)
        print(f" 💾 Session config saved to: {output_file}")
        print("=" * 70)
        
        print(f"\n  📋 Config Summary:")
        print(f"     Source domain: {best_session.get('source_domain', 'N/A')}")
        print(f"     Cookies: {len(best_session['cookies_used'])} items")
        print(f"     Valid for: {', '.join(best_session['working_endpoints'])}")
        
        print(f"\n  📖 Usage:")
        print(f"     Python: Load JSON → Use cookies dict in requests.Session()")
        print(f"     Node.js: Build cookie string from dict")
        print(f"     Curl: Copy command below\n")
        
        # Print curl command
        curl_cmd = config["usage"]["curl_command"]
        print(f"  ```bash\n{curl_cmd}\n  ```\n")
        
        return output_file
    
    def export_all_cookies(self, output_file: str = "extracted-cookies.json") -> str:
        """导出所有找到的 Cookie 到文件"""
        
        export_data = {
            "export_time": datetime.now().isoformat(),
            "total_domains": len(self.found_cookies),
            "total_cookies": sum(len(c) for c in self.found_cookies.values()),
            "domains": {},
            "validation_results": self.valid_sessions
        }
        
        for domain, cookies in self.found_cookies.items():
            export_data["domains"][domain] = [
                {
                    "name": c["name"],
                    "value_preview": c.get("decrypted_value", "")[:30] + ("..." if len(c.get("decrypted_value", "")) > 30 else ""),
                    "path": c.get("path", "/"),
                    "secure": bool(c.get("isSecure", c.get("is_secure", False))),
                    "http_only": bool(c.get("isHttpOnly", c.get("is_httponly", False))),
                }
                for c in cookies
            ]
        
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(export_data, f, indent=2, ensure_ascii=False)
        
        print(f"\n  📄 All cookies exported to: {output_file}")
        return output_file


# ============================================================
# CLI Entry Point
# ============================================================

def main():
    import argparse
    
    parser = argparse.ArgumentParser(
        description='TDX Browser Cookie Reader & Wenda Session Validator',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Full scan and validate
  python wenda-cookie-reader.py
  
  # Scan only (no validation)
  python wenda-cookie-reader.py --scan-only
  
  # Export all found cookies
  python wenda-cookie-reader.py --export-all
  
  # Import from file (manual mode)
  python wenda-cookie-reader.py --import cookies.txt
  
  # Custom output file
  python wenda-cookie-reader.py --output my-session.json
        """
    )
    
    parser.add_argument("--scan-only", "-s", action="store_true",
                       help="Only scan browsers, skip Wenda validation")
    parser.add_argument("--export-all", "-e", action="store_true",
                       help="Export all found cookies to JSON")
    parser.add_argument("--import-file", "-i", type=str, default="",
                       help="Import cookies from text file (format: name=value per line)")
    parser.add_argument("--output", "-o", type=str, default="wenda-session-config.json",
                       help="Output config file path (default: wenda-session-config.json)")
    parser.add_argument("--verbose", "-v", action="store_true", default=True,
                       help="Verbose output (default: on)")
    
    args = parser.parse_args()
    
    print("=" * 70)
    print(" TDX Finance MCP - Browser Cookie Reader & Wenda Session Tool")
    print(f" Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)
    
    scanner = TDxCookieScanner()
    
    # Mode A: Import from file
    if args.import_file:
        print(f"\n📂 Importing cookies from: {args.import_file}")
        
        imported_cookies = {}
        try:
            with open(args.import_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if "=" in line and not line.startswith("#"):
                        name, value = line.split("=", 1)
                        imported_cookies[name.strip()] = value.strip()
            
            print(f"  Imported {len(imported_cookies)} cookies")
            
            print(f"\n🧪 Testing imported cookies...")
            result = validate_wenda_session(imported_cookies, verbose=True)
            
            if result["success"]:
                config = {
                    "source": "manual_import",
                    "valid_for_wenda": True,
                    "cookies": imported_cookies,
                    "working_endpoints": result["working_endpoints"]
                }
                with open(args.output, "w", encoding="utf-8") as f:
                    json.dump(config, f, indent=2)
                print(f"\n💾 Config saved to: {args.output}")
            else:
                print(f"\n❌ Imported cookies don't work for Wenda")
                
        except FileNotFoundError:
            print(f"❌ File not found: {args.import_file}")
        return
    
    # Mode B: Scan browsers
    scanner.scan_all_browsers()
    
    if not scanner.found_cookies:
        print("\n💡 Tips:")
        print("  1. Open https://pul.tdx.com.cn in your browser")
        print("  2. Login with your TDX account")
        print("  3. Run this script again")
        return
    
    # Export all cookies if requested
    if args.export_all:
        scanner.export_all_cookies()
    
    # Validate with Wenda API
    if not args.scan_only:
        valid = scanner.extract_and_validate()
        
        if valid:
            scanner.generate_session_config(args.output)
        else:
            print("\n" + "=" * 70)
            print(" ⚠️  No working session found automatically")
            print("=" * 70)
            print("""
Possible reasons:
  1. You haven't logged into pul.tdx.com.cn recently
  2. The required cookies are encrypted (Chrome on Windows uses DPAPI)
  3. Wenda requires a specific session token, not just cookies

Next steps:
  a) Manual approach:
     1. Open https://pul.tdx.com.cn and login
     2. F12 → Network → Refresh page
     3. Click any request → Headers → Copy Cookie header value
     4. Save to a file (one cookie per line: name=value)
     5. Run: python wenda-cookie-reader.py -i cookies.txt
     
  b) Contact TDX support to upgrade your token permissions
""")
    
    # Always export summary
    if not args.export_only:
        scanner.export_all_cookies("extracted-cookies-summary.json")


if __name__ == "__main__":
    main()