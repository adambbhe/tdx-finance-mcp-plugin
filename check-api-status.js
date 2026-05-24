/**
 * TDX Finance MCP Plugin - 接口状态检查工具
 * 检查所有 9 个工具的 API 接口可用性
 */

const TOKEN = "TDX-3d84119f1671fdc5be19967086fbcfe0";
const HEADERS = {
  "Content-Type": "application/json",
  "token": TOKEN
};

// 测试结果存储
const results = [];

async function testAPI(name, url, options = {}) {
  const startTime = Date.now();
  try {
    const response = await fetch(url, {
      method: options.method || "POST",
      headers: HEADERS,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(15000) // 15秒超时
    });
    
    const elapsed = Date.now() - startTime;
    const data = await response.json();
    
    const success = response.ok && !data.Error;
    
    results.push({
      name,
      status: success ? "✅ 正常" : "❌ 异常",
      httpStatus: response.status,
      responseTime: `${elapsed}ms`,
      server: options.server || "未知",
      error: data.Error?.Message || data.error || null,
      dataSize: JSON.stringify(data).length
    });
    
    return { success, data, status: response.status };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    results.push({
      name,
      status: "⚠️ 连接失败",
      httpStatus: "N/A",
      responseTime: `${elapsed}ms`,
      server: options.server || "未知",
      error: error.message,
      dataSize: 0
    });
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║     TDX Finance MCP Plugin - 接口状态检查                    ║");
  console.log("║     检查时间: " + new Date().toLocaleString('zh-CN') + "                 ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // ============================================
  // 服务器1: TDX Hub API (5个工具)
  // ============================================
  console.log("📡 服务器1: TDX Hub API");
  console.log("   地址: http://tdxhub.icfqs.com:7615/TQLEX\n");
  
  const HUB_URL = "http://tdxhub.icfqs.com:7615/TQLEX";

  // 1. tdx_quotes - 实时行情
  console.log("⏳ [1/9] tdx_quotes - 实时行情查询...");
  await testAPI("tdx_quotes", `${HUB_URL}?Entry=TdxShare.PBHQInfo`, {
    method: "POST",
    body: {
      Head: { Target: "0", CharSet: "UTF8" },
      Code: "000001",
      Setcode: "0",
      HasHQInfo: "1",
      HasExtInfo: "0"
    },
    server: "TDX Hub"
  });

  // 2. tdx_kline - K线数据
  console.log("⏳ [2/9] tdx_kline - K线数据查询...");
  await testAPI("tdx_kline", `${HUB_URL}?Entry=TdxShare.PBFXT`, {
    method: "POST",
    body: {
      Head: { Target: 0, CharSet: "UTF8" },
      Code: "000001",
      Setcode: 0,
      Period: 4,
      Startxh: 0,
      WantNum: 5,
      TQFlag: 11
    },
    server: "TDX Hub"
  });

  // 3. tdx_api_data - F10基本面（盈利预测）
  console.log("⏳ [3/9] tdx_api_data - F10盈利预测...");
  await testAPI("tdx_api_data (ybpj)", `${HUB_URL}?Entry=TdxSharePCCW.tdxf10_gg_ybpj`, {
    method: "POST",
    body: { Params: ["000001", "yzyq"] },
    server: "TDX Hub"
  });

  // 4. tdx_screener - 智能选股
  console.log("⏳ [4/9] tdx_screener - 智能选股...");
  await testAPI("tdx_screener", `${HUB_URL}?Entry=JNLPSE:wendaQuery`, {
    method: "POST",
    body: [{ message: "涨停", rang: "AG", pageNo: "1", pageSize: "5" }],
    server: "TDX Hub"
  });

  // 5. tdx_indicator_select - 指标选择
  console.log("⏳ [5/9] tdx_indicator_select - 金融指标...");
  await testAPI("tdx_indicator_select", `${HUB_URL}?Entry=NLPSE:InfoSelectV2`, {
    method: "POST",
    body: { message: "平安银行基本面指标", rang: "AG" },
    server: "TDX Hub"
  });

  // ============================================
  // 服务器2: AI RAG API (1个工具)
  // ============================================
  console.log("\n📡 服务器2: AI RAG API");
  console.log("   地址: https://ai.icfqs.com:8965/v1/\n");

  // 6. tdx_lookup_stock - 股票检索
  console.log("⏳ [6/9] tdx_lookup_stock - RAG股票检索...");
  await testAPI("tdx_lookup_stock", "https://ai.icfqs.com:8965/v1/rag-entity-retrieve", {
    method: "POST",
    body: { query: "平安银行", range: "AG" },
    server: "AI RAG"
  });

  // ============================================
  // 服务器3: Wenda API (3个工具)
  // ============================================
  console.log("\n📡 服务器3: Wenda 问达平台");
  console.log("   地址: https://www.tdx.com.cn/wenda/api/tools/\n");

  const WENDA_BASE = "https://www.tdx.com.cn/wenda/api/tools";

  // 7. wenda_news_query - 新闻查询
  console.log("⏳ [7/9] wenda_news_query - 新闻资讯...");
  await testAPI("wenda_news_query", `${WENDA_BASE}/zx_query`, {
    method: "POST",
    body: { query: "低空经济政策" },
    server: "Wenda"
  });

  // 8. wenda_report_query - 研报查询
  console.log("⏳ [8/9] wenda_report_query - 券商研报...");
  await testAPI("wenda_report_query", `${WENDA_BASE}/yb_query`, {
    method: "POST",
    body: { query: "宁德时代" },
    server: "Wenda"
  });

  // 9. wenda_notice_query - 公告查询
  console.log("⏳ [9/9] wenda_notice_query - 公司公告...");
  await testAPI("wenda_notice_query", `${WENDA_BASE}/gg_search`, {
    method: "POST",
    body: { query: "分红" },
    server: "Wenda"
  });

  // ============================================
  // 输出结果报告
  // ============================================
  console.log("\n" + "═".repeat(72));
  console.log("📊 接口状态检查结果汇总");
  console.log("═".repeat(72) + "\n");

  let successCount = 0;
  let failCount = 0;

  results.forEach((r, i) => {
    const icon = r.status.includes("正常") ? "✅" : (r.status.includes("连接失败") ? "⚠️" : "❌");
    if (r.status.includes("正常")) successCount++;
    else failCount++;
    
    console.log(`${icon} ${r.name.padEnd(30)} ${r.status.padEnd(12)} ${r.responseTime.padEnd(10)} ${r.server}`);
    if (r.error) {
      console.log(`   错误: ${r.error}`);
    }
  });

  console.log("\n" + "─".repeat(72));
  console.log(`📈 统计: 成功 ${successCount}/9 | 失败 ${failCount}/9 | 成功率 ${(successCount/9*100).toFixed(1)}%`);
  console.log("─".repeat(72));

  // 按服务器分组统计
  console.log("\n🖥️  服务器状态:");
  const servers = {};
  results.forEach(r => {
    if (!servers[r.server]) servers[r.server] = { total: 0, success: 0 };
    servers[r.server].total++;
    if (r.status.includes("正常")) servers[r.server].success++;
  });
  
  Object.entries(servers).forEach(([server, stats]) => {
    const rate = (stats.success / stats.total * 100).toFixed(0);
    const icon = rate == "100" ? "🟢" : (rate >= "50" ? "🟡" : "🔴");
    console.log(`  ${icon} ${server.padEnd(15)} ${stats.success}/${stats.total} 正常 (${rate}%)`);
  });

  console.log("\n" + "═".repeat(72));
  console.log("✅ 检查完成！");
  console.log("═".repeat(72) + "\n");
}

main().catch(console.error);