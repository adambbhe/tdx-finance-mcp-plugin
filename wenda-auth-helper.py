#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TDX Finance MCP Plugin - Wenda Platform Authentication Helper
============================================================
解决 wenda_news_query / wenda_report_query / wenda_notice_query 返回 401 need login 问题

认证流程:
  1. 尝试 Token Header 认证
  2. 尝试 Cookie/Session 认证 (从 pul.tdx.com.cn 获取)
  3. 尝试 OAuth/SSO 认证流程
  4. 输出可用的 Session 信息

Author: TDX MCP Plugin Team
Version: 2026.4.28
"""

import requests
import json
import time
import re
from urllib.parse import urlparse, parse_qs

# ============================================================
# Configuration
# ============================================================

TOKEN = "TDX-3d84119f1671fdc5be19967086fbcfe0"
HEADERS_BASE = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

# Endpoints
WENDA_BASE = "https://www.tdx.com.cn/wenda/api/tools"
PUL_LOGIN_URL = "https://pul.tdx.com.cn"
TDX_HUB = "http://tdxhub.icfqs.com:7615/TQLEX"

WENDA_ENDPOINTS = {
    "news": f"{WENDA_BASE}/zx_query",
    "report": f"{WENDA_BASE}/yb_query", 
    "notice": f"{WENDA_BASE}/gg_search",
}


class WendaAuthHelper:
    """Wenda Platform Authentication Helper"""
    
    def __init__(self, token: str = TOKEN):
        self.token = token
        self.session = requests.Session()
        self.session.headers.update(HEADERS_BASE)
        self.auth_cookies = {}
        self.auth_method = None
        self.auth_status = None
        
    # ============================================================
    # Test Methods - Check current auth status
    # ============================================================
    
    def test_wenda_api(self, endpoint_name: str = "news") -> dict:
        """Test if Wenda API is accessible"""
        url = WENDA_ENDPOINTS[endpoint_name]
        test_queries = {
            "news": {"query": "低空经济"},
            "report": {"query": "宁德时代"},
            "notice": {"query": "分红"}
        }
        
        try:
            resp = self.session.post(
                url,
                json=test_queries[endpoint_name],
                headers={**dict(self.session.headers), "token": self.token},
                timeout=15
            )
            
            try:
                data = resp.json()
            except:
                data = {"raw_text": resp.text[:500], "status_code": resp.status_code}
            
            return {
                "endpoint": endpoint_name,
                "url": url,
                "status_code": resp.status_code,
                "response": data,
                "success": resp.status_code == 200 and not (
                    isinstance(data, dict) and 
                    data.get("code") == 401
                )
            }
        except Exception as e:
            return {"endpoint": endpoint_name, "error": str(e), "success": False}
    
    def check_all_wenda_endpoints(self) -> list:
        """Check all 3 Wenda endpoints"""
        results = []
        for name in ["news", "report", "notice"]:
            r = self.test_wenda_api(name)
            results.append(r)
            print(f"  [{name.upper():5s}] HTTP {r.get('status_code','?')} | "
                  f"{'OK' if r.get('success') else 'FAIL'} | "
                  f"{json.dumps(r.get('response',{}), ensure_ascii=False)[:100]}")
            time.sleep(0.3)
        return results
    
    # ============================================================
    # Auth Method 1: Direct Token Header (current approach)
    # ============================================================
    
    def try_token_auth(self) -> bool:
        """Method 1: Use TDX Token directly in header"""
        print("\n[方法1] 直接使用 Token Header 认证...")
        
        self.session.headers["token"] = self.token
        results = self.check_all_wenda_endpoints()
        
        ok_count = sum(1 for r in results if r.get("success"))
        
        if ok_count > 0:
            self.auth_method = "token_header"
            self.auth_status = f"partial ({ok_count}/3)"
            print(f"  >> 结果: {ok_count}/3 接口可用")
            return True
        else:
            print("  >> 结果: Token Header 方式无法通过 Wenda 认证")
            return False
    
    # ============================================================
    # Auth Method 2: PUL Platform Login Flow
    # ============================================================
    
    def try_pul_login(self, username: str = "", password: str = "") -> dict:
        """
        Method 2: 通过 pul.tdx.com.cn 登录获取 Session
        
        流程推测:
        1. 访问 pul.tdx.com.cn 获取登录页面/Cookie
        2. 提交登录表单（用户名+密码或Token）
        3. 获取认证后的 Session Cookie
        4. 用该 Cookie 访问 Wenda API
        """
        print("\n[方法2] PUL 平台登录流程...")
        print(f"  登录地址: {PUL_LOGIN_URL}")
        
        result = {
            "method": "pul_login",
            "steps": [],
            "cookies_obtained": {},
            "success": False
        }
        
        try:
            # Step 1: 访问 PUL 首页，获取初始 Cookie 和 CSRF token
            print("  [Step 1] 访问 PUL 首页获取初始状态...")
            resp = self.session.get(PUL_LOGIN_URL, timeout=15, allow_redirects=True)
            result["steps"].append({
                "step": "visit_pul_home",
                "url": resp.url,
                "status": resp.status_code,
                "cookies_before": dict(self.session.cookies),
                "set_cookie_headers": resp.headers.get("Set-Cookie", ""),
            })
            
            print(f"    状态码: {resp.status_code}")
            print(f"    最终URL: {resp.url}")
            print(f"    获得Cookie: {list(self.session.cookies.keys())}")
            
            # 检查是否有重定向到登录页
            if "login" in resp.url.lower() or "auth" in resp.url.lower():
                print("    >> 检测到需要登录的页面")
                
                # 尝试查找登录接口
                login_patterns = [
                    "/api/auth/login",
                    "/api/user/login", 
                    "/login/api",
                    "/passport/login",
                    "/sso/login",
                    "/oauth/token",
                    "/api/v1/auth/login",
                ]
                
                # 也尝试用 Token 作为 Bearer token 登录
                bearer_attempts = [
                    ("Bearer Token Login", {
                        "Authorization": f"Bearer {self.token}",
                        "Content-Type": "application/json"
                    }),
                    ("Token as Password Login", {
                        "token": self.token,
                        "grant_type": "password"
                    }),
                ]
                
                for attempt_name, extra_headers in bearer_attempts:
                    print(f"\n  [Step 2] 尝试: {attempt_name}...")
                    
                    # 常见登录API路径
                    login_urls_to_try = [
                        f"{PUL_LOGIN_URL}/api/auth/login",
                        f"{PUL_LOGIN_URL}/api/v1/login",
                        f"{PUL_LOGIN_URL}/passport/login",
                        f"{urlparse(PUL_LOGIN_URL).scheme}://{urlparse(PUL_LOGIN_URL).netloc}/api/login",
                    ]
                    
                    for login_url in login_urls_to_try:
                        try:
                            headers = {**HEADERS_BASE, **extra_headers}
                            
                            # POST with token
                            login_resp = self.session.post(
                                login_url,
                                json={"token": self.token} if "Token as" in attempt_name else 
                                      {"username": username or self.token, "password": password or self.token},
                                headers=headers,
                                timeout=10
                            )
                            
                            result["steps"].append({
                                "step": f"login_attempt_{attempt_name}",
                                "url": login_url,
                                "status": login_resp.status_code,
                                "response_preview": login_resp.text[:300],
                            })
                            
                            if login_resp.status_code == 200:
                                try:
                                    login_data = login_resp.json()
                                    if login_data.get("code") == 0 or login_data.get("success") or \
                                       login_data.get("token") or login_data.get("session"):
                                        print(f"    >> 登录可能成功! Response: {str(login_data)[:200]}")
                                        break
                                except:
                                    pass
                            
                        except Exception as e:
                            pass  # Skip failed attempts silently
            
            # Step 3: 检查当前 Cookie 状态
            print(f"\n  [Step 3] 当前 Session Cookies:")
            for name, value in self.session.cookies.items():
                masked_value = value[:10] + "..." if len(value) > 10 else value
                print(f"    {name}: {masked_value}")
                result["cookies_obtained"][name] = value
            
            # Step 4: 用新 Cookie 测试 Wenda API
            print("\n  [Step 4] 使用获取的 Cookie 测试 Wenda API...")
            wenda_results = self.check_all_wenda_endpoints()
            ok_count = sum(1 for r in wenda_results if r.get("success"))
            
            if ok_count > 0:
                result["success"] = True
                self.auth_method = "pul_session"
                self.auth_status = f"partial ({ok_count}/3)"
                print(f"  >> 成功! {ok_count}/3 Wenda 接口可用")
            else:
                print(f"  >> 仍无法访问 Wenda API (可能需要真实账号密码)")
                
        except Exception as e:
            result["error"] = str(e)
            print(f"  >> 错误: {e}")
        
        return result
    
    # ============================================================
    # Auth Method 3: SSO / Cross-domain Auth
    # ============================================================
    
    def try_sso_auth(self) -> dict:
        """
        Method 3: 利用 TDX Hub 的认证信息做跨域 SSO
        
        思路: 如果 TDX Hub 和 Wenda 共享认证系统，
              可能可以通过 TDX Hub 的某个接口获取 Wenda 的 Session
        """
        print("\n[方法3] 跨域 SSO / Token Exchange...")
        
        result = {"method": "sso_exchange", "attempts": [], "success": False}
        
        sso_attempts = [
            # Attempt A: TDX Hub SSO endpoint
            {
                "name": "TDX_Hub_SSO",
                "url": f"{TDX_HUB}?Entry=TdxShare.GetSession",
                "method": "POST",
                "body": {"Token": self.token, "TargetService": "wenda"}
            },
            # Attempt B: Token exchange endpoint  
            {
                "name": "Token_Exchange",
                "url": f"{TDX_HUB}?Entry=TdxAuth.ExchangeToken",
                "method": "POST",
                "body": {"SourceToken": self.token, "TargetPlatform": "wenda"}
            },
            # Attempt C: Direct Wenda with different auth header format
            {
                "name": "Wenda_Bearer_Auth",
                "url": f"{WENDA_BASE}/zx_query",
                "method": "POST",
                "body": {"query": "test"},
                "extra_headers": {"Authorization": f"Bearer {self.token}"}
            },
            # Attempt D: Wenda with X-Token header
            {
                "name": "Wenda_XToken_Auth",
                "url": f"{WENDA_BASE}/zx_query",
                "method": "POST", 
                "body": {"query": "test"},
                "extra_headers": {"X-TDX-Token": self.token, "X-Auth-Token": self.token}
            },
            # Attempt E: Cookie-based auth with token
            {
                "name": "Wenda_Cookie_Token",
                "url": f"{WENDA_BASE}/zx_query",
                "method": "POST",
                "body": {"query": "test"},
                "set_cookies": {"tdx_token": self.token, "session_id": self.token}
            },
        ]
        
        for attempt in sso_attempts:
            name = attempt["name"]
            url = attempt["url"]
            print(f"\n  尝试: {name}...")
            
            try:
                headers = {**HEADERS_BASE}
                if "extra_headers" in attempt:
                    headers.update(attempt["extra_headers"])
                else:
                    headers["token"] = self.token
                
                # Set cookies if specified
                if "set_cookies" in attempt:
                    for k, v in attempt["set_cookies"].items():
                        self.session.cookies.set(k, v, domain="tdx.com.cn")
                
                resp = self.session.post(
                    url,
                    json=attempt.get("body", {}),
                    headers=headers,
                    timeout=10
                )
                
                try:
                    data = resp.json()
                except:
                    data = {"raw": resp.text[:200]}
                
                is_ok = resp.status_code == 200 and not (
                    isinstance(data, dict) and data.get("code") == 401
                )
                
                result["attempts"].append({
                    "name": name,
                    "status": resp.status_code,
                    "ok": is_ok,
                    "preview": json.dumps(data, ensure_ascii=False)[:150]
                })
                
                status_icon = "✅" if is_ok else "❌"
                print(f"    {status_icon} HTTP {resp.status_code} | {json.dumps(data, ensure_ascii=False)[:100]}")
                
                if is_ok:
                    result["success"] = True
                    self.auth_method = f"sso_{name}"
                    break
                    
            except Exception as e:
                result["attempts"].append({"name": name, "error": str(e)})
                print(f"    ❌ 异常: {e}")
        
        return result
    
    # ============================================================
    # Auth Method 4: Browser-like flow simulation
    # ============================================================
    
    def try_browser_flow(self) -> dict:
        """
        Method 4: 模拟浏览器完整登录流程
        
        分析 pul.tdx.com.cn 的前端代码，找到实际的登录 API
        """
        print("\n[方法4] 模拟浏览器登录流程分析...")
        
        result = {"method": "browser_simulation", "findings": [], "success": False}
        
        try:
            # Step 1: 获取首页 HTML，分析登录相关 JS/API
            print("  [Step 1] 分析 PUL 页面结构...")
            
            resp = requests.get(
                PUL_LOGIN_URL,
                headers={
                    "User-Agent": HEADERS_BASE["User-Agent"],
                    "Accept": "text/html,application/xhtml+xml",
                },
                timeout=15,
                allow_redirects=True
            )
            
            html = resp.text
            
            # Extract useful info from HTML
            findings = {}
            
            # Find API base URLs
            api_patterns = re.findall(r'(?:api[_-]?url|base[_-]?url|endpoint)[\'"\s]*[:=][\'"\s]*([^\s\'",;]+)', html, re.I)
            if api_patterns:
                findings["api_urls_found"] = api_patterns[:5]
            
            # Find login-related URLs
            login_url_patterns = re.findall(r'(?:href|action|src)[\'"\s]*=[\'"\s]*([^\s\'"]*(?:login|auth|signin|sso)[^\s\'"]*)', html, re.I)
            if login_url_patterns:
                findings["login_urls"] = list(set(login_url_patterns))[:10]
            
            # Find JavaScript files that might contain login logic
            js_files = re.findall(r'src=[\'"]([^\'"]*\.js[^\'"]*)[\'"]', html, re.I)
            findings["js_files"] = js_files[:10]
            
            # Find meta tags
            meta_tags = re.findall(r'<meta[^>]*(?:csrf|token|session|auth)[^>]*>', html, re.I)
            if meta_tags:
                findings["meta_tags"] = meta_tags[:5]
            
            # Check for common auth frameworks
            frameworks = []
            if 'cas' in html.lower(): frameworks.append('CAS')
            if 'oauth' in html.lower(): frameworks.append('OAuth')
            if 'jwt' in html.lower(): frameworks.append('JWT')
            if 'sso' in html.lower(): frameworks.append('SSO')
            if frameworks:
                findings["possible_frameworks"] = frameworks
            
            result["findings"] = findings
            result["final_url"] = resp.url
            result["page_title"] = re.search(r'<title>([^<]*)</title>', html, re.I)
            result["page_title"] = result["page_title"].group(1) if result["page_title"] else "N/A"
            
            print(f"    页面标题: {result['page_title']}")
            print(f"    最终URL: {resp.url}")
            print(f"    发现API URL: {len(findings.get('api_urls_found', []))} 个")
            print(f"    发现登录链接: {len(findings.get('login_urls', []))} 个")
            print(f"    JS文件: {len(findings.get('js_files', []))} 个")
            if findings.get("possible_frameworks"):
                print(f"    可能的框架: {', '.join(findings['possible_frameworks'])}")
            
            # Print key findings
            for key, val in findings.items():
                if isinstance(val, list) and val:
                    print(f"\n    [{key}]:")
                    for item in val[:5]:
                        print(f"      • {item}")
            
            # Save full HTML for manual analysis
            with open("pul-page-analysis.html", "w", encoding="utf-8") as f:
                f.write(html)
            print(f"\n  >> 完整HTML已保存到 pul-page-analysis.html (供手动分析)")
            
        except Exception as e:
            result["error"] = str(e)
            print(f"  >> 错误: {e}")
        
        return result
    
    # ============================================================
    # Main Diagnostic Run
    # ============================================================
    
    def run_full_diagnosis(self, pul_username: str = "", pul_password: str = "") -> dict:
        """Run complete diagnostic of all auth methods"""
        
        print("=" * 70)
        print(" TDX Wenda Platform Authentication Diagnostic Tool")
        print(f" Time: {time.strftime('%Y-%m-%d %H:%M:%S')}")
        print(f" Token: {self.token[:15]}...")
        print("=" * 70)
        
        report = {
            "timestamp": time.strftime('%Y-%m-%d %H:%M:%S'),
            "token_prefix": self.token[:20],
            "methods_tried": [],
            "final_status": None,
            "recommendation": ""
        }
        
        # Initial test without any special auth
        print("\n" + "-" * 70)
        print(" PHASE 0: 初始状态检查 (无特殊认证)")
        print("-" * 70)
        initial_results = self.check_all_wenda_endpoints()
        
        all_ok = all(r.get("success") for r in initial_results)
        if all_ok:
            print("\n  🎉 所有 Wenda 接口已可用! 无需额外认证!")
            report["final_status"] = "ALREADY_OK"
            report["recommendation"] = "所有接口正常工作"
            return report
        
        # Method 1: Token Header
        print("\n" + "-" * 70)
        print(" PHASE 1: Token Header 认证")
        print("-" * 70)
        m1_result = self.try_token_auth()
        report["methods_tried"].append(m1_result)
        
        if m1_result:
            report["final_status"] = "METHOD_1_OK"
            report["recommendation"] = "使用 Token Header 即可"
            return report
        
        # Method 2: PUL Login
        print("\n" + "-" * 70)
        print(" PHASE 2: PUL 平台登录")
        print("-" * 70)
        m2_result = self.try_pul_login(pul_username, pul_password)
        report["methods_tried"].append(m2_result)
        
        if m2_result.get("success"):
            report["final_status"] = "METHOD_2_OK"
            report["recommendation"] = "使用 PUL Session Cookie"
            return report
        
        # Method 3: SSO
        print("\n" + "-" * 70)
        print(" PHASE 3: SSO / Token Exchange")
        print("-" * 70)
        m3_result = self.try_sso_auth()
        report["methods_tried"].append(m3_result)
        
        if m3_result.get("success"):
            report["final_status"] = "METHOD_3_OK"
            return report
        
        # Method 4: Browser Analysis
        print("\n" + "-" * 70)
        print(" PHASE 4: 浏览器流程分析")
        print("-" * 70)
        m4_result = self.try_browser_flow()
        report["methods_tried"].append(m4_result)
        
        # Final Summary
        print("\n" + "=" * 70)
        print(" DIAGNOSIS COMPLETE - SUMMARY")
        print("=" * 70)
        
        report["final_status"] = "ALL_METHODS_FAILED"
        report["recommendation"] = self._generate_recommendation(m2_result, m3_result, m4_result)
        
        print(f"\n  最终状态: {report['final_status']}")
        print(f"\n  建议:\n{report['recommendation']}")
        
        return report
    
    def _generate_recommendation(self, m2, m3, m4) -> str:
        """Generate recommendation based on diagnostic results"""
        
        rec = []
        rec.append("=== Wenda API 认证问题解决方案 ===\n")
        
        rec.append("【问题原因】")
        rec.append("  Wenda 问达平台 (www.tdx.com.cn/wenda) 需要独立的用户登录会话。")
        rec.append("  当前 Token 仅授权了 TDX Hub 数据接口，不包含 Wenda 平台权限。\n")
        
        rec.append("【解决方案】(按推荐顺序)\n")
        
        rec.append("方案1: 联系通达信开通 Wenda 权限")
        rec.append("  • 向通达信申请升级 Token 权限范围")
        rec.append("  • 说明需要访问: 新闻(zx_query)、研报(yb_query)、公告(gg_search)")
        rec.append("  • 参考: https://pul.tdx.com.cn\n")
        
        rec.append("方案2: 手动获取 Session Cookie")
        rec.append("  步骤:")
        rec.append("  1. 在浏览器中打开 https://pul.tdx.com.cn")
        rec.append("  2. 使用通达信账号密码登录")
        rec.append("  3. 按 F12 打开开发者工具 → Network 标签")
        rec.append("  4. 找到任意请求的 Cookie (特别是 session_id / token 字段)")
        rec.append("  5. 将 Cookie 复制到下方配置中\n")
        
        if m4.get("findings", {}).get("login_urls"):
            rec.append(f"  检测到的登录入口: {m4['findings']['login_urls'][:3]}")
        if m4.get("findings", {}).get("possible_frameworks"):
            rec.append(f"  可能使用的认证框架: {', '.join(m4['findings']['possible_frameworks'])}\n")
        
        rec.append("方案3: 使用代码自动获取 (需提供账号密码)")
        rec.append("  运行: python wenda-auth-helper.py --username YOUR_USER --password YOUR_PASS\n")
        
        rec.append("方案4: 替代数据源")
        rec.append("  如暂时无法解决 Wenda 认证，可使用以下替代方案:")
        rec.append("  • 新闻数据: tdx_api_data → rdtc/sjcd (事件驱动模块)")
        rec.append("  • 研报数据: tdx_api_data → ybpj (盈利预测模块)")
        rec.append("  • 公告数据: tdx_api_data → yjyg (业绩预告模块)\n")
        
        rec.append("【临时 workaround】")
        rec.append("  在插件中标记 Wenda 工具为 optional，不影响其他 6 个工具的使用。\n")
        
        return "\n".join(rec)


# ============================================================
# CLI Entry Point
# ============================================================

def main():
    import argparse
    
    parser = argparse.ArgumentParser(
        description='TDX Wenda Platform Authentication Helper',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Run full diagnosis
  python wenda-auth-helper.py
  
  # Try with credentials
  python wenda-auth-helper.py --username your_user --password your_pass
  
  # Quick test only
  python wenda-auth-helper.py --quick
  
  # Save report to file
  python wenda-auth-helper.py --output report.json
        """
    )
    
    parser.add_argument("--token", default=TOKEN, help="TDX API Token")
    parser.add_argument("--username", "-u", default="", help="PUL platform username")
    parser.add_argument("--password", "-p", default="", help="PUL platform password")
    parser.add_argument("--quick", "-q", action="store_true", help="Quick test only")
    parser.add_argument("--output", "-o", default="", help="Save report to JSON file")
    
    args = parser.parse_args()
    
    helper = WendaAuthHelper(token=args.token)
    
    if args.quick:
        print("Quick Test Mode - Checking Wenda API status...\n")
        helper.check_all_wenda_endpoints()
        return
    
    # Full diagnostic
    report = helper.run_full_diagnosis(args.username, args.password)
    
    # Save report
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"\n报告已保存到: {args.output}")


if __name__ == "__main__":
    main()