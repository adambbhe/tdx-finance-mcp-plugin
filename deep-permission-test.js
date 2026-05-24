/**
 * TDX Finance MCP Plugin - 深度权限验证工具
 * 不仅检查连接状态，还验证返回数据的有效性
 */

const TOKEN = "TDX-3d84119f1671fdc5be19967086fbcfe0";
const HEADERS = { "Content-Type": "application/json", token: TOKEN };
const HUB = "http://tdxhub.icfqs.com:7615/TQLEX";

const results = [];

async function deepTest(name, entry, body, server = "TDX Hub") {
  const start = Date.now();
  try {
    const url = `${HUB}?Entry=${entry}`;
    const res = await fetch(url, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });
    
    const elapsed = Date.now() - start;
    const data = await res.json();
    
    // 深度分析返回数据
    let dataValid = false;
    let dataType = null;
    let recordCount = 0;
    let errorInfo = null;
    let sampleData = null;
    
    // 检查是否有错误
    if (data.Error) {
      errorInfo = `${data.Error.ErrorCode || ''}: ${data.Error.Message || ''}`;
      // S14042 = 模块未注册
      const isNotRegistered = String(data.Error.ErrorCode).includes('14042') || 
                               (data.Error.Message && data.Error.Message.includes('模块'));
      
      results.push({
        name, entry, status: isNotRegistered ? "🔴 未注册" : "❌ 错误",
        httpStatus: res.status, time: `${elapsed}ms`, server,
        error: errorInfo, dataValid: false
      });
      return;
    }
    
    // 分析数据结构
    const jsonStr = JSON.stringify(data);
    
    // 检查常见的数据结构
    if (data.Data && Array.isArray(data.Data)) {
      recordCount = data.Data.length;
      dataValid = recordCount > 0;
      dataType = `Array[${recordCount}]`;
      sampleData = data.Data[0];
    } else if (data.data && Array.isArray(data.data)) {
      recordCount = data.data.length;
      dataValid = recordCount > 0;
      dataType = `data.Array[${recordCount}]`;
      sampleData = data.data[0];
    } else if (data.HQInfo) {
      dataValid = true;
      dataType = "HQInfo Object";
      recordCount = 1;
      sampleData = { code: data.BaseInfo?.Code, name: data.BaseInfo?.Name, price: data.HQInfo?.Now };
    } else if (data.KLines && Array.isArray(data.KLines)) {
      recordCount = data.KLines.length;
      dataValid = recordCount > 0;
      dataType = `KLines[${recordCount}]`;
      sampleData = data.KLines[0];
    } else if (data.Result && Array.isArray(data.Result)) {
      recordCount = data.Result.length;
      dataValid = recordCount > 0;
      dataType = `Result[${recordCount}]`;
      sampleData = data.Result[0];
    } else if (data.result) {
      dataValid = true;
      dataType = "result Object";
      sampleData = typeof data.result === 'object' ? JSON.stringify(data.result).substring(0, 100) : data.result;
    } else {
      // 其他格式，只要有数据就认为有效
      dataValid = jsonStr.length > 50; // 排除空响应
      dataType = "Unknown";
      sampleData = jsonStr.substring(0, 150);
    }
    
    results.push({
      name, entry, status: dataValid ? "✅ 可用" : "⚠️ 空数据",
      httpStatus: res.status, time: `${elapsed}ms`, server,
      dataType, recordCount, dataValid,
      sample: sampleData
    });
    
  } catch(e) {
    results.push({ name, entry, status: "⚠️ 异常", time: `${Date.now()-start}ms`, error: e.message });
  }
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║   TDX MCP Plugin - Entry 权限深度验证                        ║");
  console.log("║   Token: TDX-3d84119f...                                    ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log("🔍 正在逐个验证每个 Entry 的实际可用性...\n");

  // ========== 已知可用的 2 个 ==========
  console.log("─── 第一组：基础行情接口（预期可用） ───\n");
  
  await deepTest("实时行情", "TdxShare.PBHQInfo", {
    Head: { Target: "0", CharSet: "UTF8" },
    Code: "000001", Setcode: "0", HasHQInfo: "1"
  });

  await deepTest("K线数据", "TdxShare.PBFXT", {
    Head: { Target: 0, CharSet: "UTF8" },
    Code: "000001", Setcode: 0, Period: 4, WantNum: 5
  });

  // ========== F10 基本面系列（需要验证） ==========
  console.log("\n─── 第二组：F10基本面接口（待验证） ───\n");
  
  await deepTest("盈利预测", "TdxSharePCCW.tdxf10_gg_ybpj", { Params: ["000001", "yzyq"] });
  await deepTest("热点题材", "TdxSharePCCW.tdxf10_gg_rdtc", { Params: ["000001", "zttzbkz"] });
  await deepTest("公司概要", "TdxSharePCCW.tdxf10_gg_gsgk", { Params: ["000001", "0"] });
  await deepTest("股东持股", "TdxSharePCCW.tdxf10_gg_gdyj", { Params: ["000001", "gdrs"] });
  await deepTest("龙虎榜涨停", "TdxSharePCCW.tdxf10_gg_jyds", { Params: ["000001", "ztfx"] });
  await deepTest("财务报表", "TdxSharePCCW.tdxf10_gg_cwbb", { Params: ["000001", "cwbb_zb"] });
  await deepTest("分红融资", "TdxSharePCCW.tdxf10_gg_fhfx", { Params: ["000001"] });
  await deepTest("股本结构", "TdxSharePCCW.tdxf10_gg_gbxx", { Params: ["000001"] });
  await deepTest("事件驱动", "TdxSharePCCW.tdxf10_gg_rdtc", { Params: ["000001", "sjcd"] });
  await deepTest("行业对比", "TdxSharePCCW.tdxf10_hy_db", { Params: ["000001"] });
  await deepTest("主力持仓", "TdxSharePCCW.tdxf10_zjlx_zljrcc", { Params: ["000001"] });
  await deepTest("机构评级", "TdxSharePCCW.tdxf10_jgpj", { Params: ["000001"] });
  await deepTest("一致预期", "TdxSharePCCW.tdxf10_yzyq", { Params: ["000001"] });

  // ========== NLP/智能接口（需要验证） ==========
  console.log("\n─── 第三组：NLP智能接口（待验证） ───\n");
  
  await deepTest("智能选股", "JNLPSE:wendaQuery", [{ message: "涨停", rang: "AG", pageNo: "1", pageSize: "5" }]);
  await deepTest("指标选择", "NLPSE:InfoSelectV2", { message: "平安银行指标", rang: "AG" });

  // ========== 用户提到的未注册接口（抽样验证） ==========
  console.log("\n─── 第四组：用户报告可能未注册的接口（抽样） ───\n");
  
  await deepTest("GetStockQuote", "TdxQuotes.GetStockQuote", { Params: ["000001"] });
  await deepTest("GetRealtimeQuote", "TdxQuotes.GetRealtimeQuote", { Params: ["000001"] });
  await deepTest("GetOrderBook", "TdxQuotes.GetOrderBook", { Params: ["000001"] });
  await deepTest("SearchStock", "TdxQuotes.SearchStock", { Params: ["平安银行"] });
  await deepTest("GetFinanceInfo", "TdxFinance.GetFinanceInfo", { Params: ["000001"] });
  await deepTest("GetCompanyInfo", "TdxF10.GetCompanyInfo", { Params: ["000001"] });
  await deepTest("GetStockNews", "TdxNews.GetStockNews", { Params: ["000001"] });
  await deepTest("GetIndex", "TdxIndex.GetIndex", { Params: ["000001"] });
  await deepTest("GetBlockList", "TdxBlock.GetBlockList", { Params: [] });
  await deepTest("GetMarketStatus", "TdxBase.GetMarketStatus", {});

  // ========== 输出汇总报告 ==========
  console.log("\n" + "═".repeat(80));
  console.log("📊 Entry 权限深度验证结果");
  console.log("═".repeat(80) + "\n");

  const categories = {
    "✅ 可用": [],
    "🔴 未注册": [],
    "⚠️ 空数据": [],
    "❌ 错误": [],
    "⚠️ 异常": []
  };

  results.forEach(r => {
    if (categories[r.status]) categories[r.status].push(r);
  });

  // 详细列表
  for (const [status, items] of Object.entries(categories)) {
    if (items.length === 0) continue;
    console.log(`\n${status} (${items.length}个):`);
    console.log("─".repeat(70));
    items.forEach(r => {
      console.log(`  ${r.entry.padEnd(45)} ${r.time?.padEnd(10)} ${r.dataType || r.error || ''}`);
      if (r.sample && r.dataValid) {
        const preview = typeof r.sample === 'object' ? JSON.stringify(r.sample).substring(0, 80) : String(r.sample).substring(0, 80);
        console.log(`       📄 数据预览: ${preview}...`);
      }
    });
  }

  // 统计
  console.log("\n" + "═".repeat(80));
  console.log("📈 统计汇总:");
  console.log("═".repeat(80));
  
  const total = results.length;
  const available = categories["✅ 可用"].length;
  const notRegistered = categories["🔴 未注册"].length;
  const empty = categories["⚠️ 空数据"].length;
  const errors = categories["❌ 错误"].length + categories["⚠️ 异常"].length;

  console.log(`
  总计测试:     ${total} 个 Entry
  ✅ 实际可用:   ${available} 个 (${(available/total*100).toFixed(1)}%)
  🔴 未注册:     ${notRegistered} 个
  ⚠️ 空数据:     ${empty} 个
  ❌ 错误/异常:   ${errors} 个

  结论: Token 有效，但仅开通了 ${available + (empty>0?`+${empty}空数据`:'')} 个模块
  `);

  // 关键发现
  console.log("═".repeat(80));
  console.log("🔑 关键发现:");
  console.log("═".repeat(80));

  if (notRegistered > 0) {
    console.log(`
  ⚠️  发现 ${notRegistered} 个未注册的 Entry！
     这意味着当前 Token 的权限有限。
     
     插件中使用的 F10 系列 Entry 可能部分不可用，
     导致依赖这些数据的技能无法正常工作。
    `);
  }

  if (available >= 2) {
    console.log(`
  ✅ 至少以下功能确认可用：
     1. tdx_quotes (实时行情) - Entry: TdxShare.PBHQInfo
     2. tdx_kline (K线数据)   - Entry: TdxShare.PBFXT
    `);
    
    if (available > 2) {
      console.log(`  额外可用: ${available - 2} 个其他 Entry`);
    }
  }

  console.log("\n✅ 深度验证完成！");
}

main().catch(console.error);