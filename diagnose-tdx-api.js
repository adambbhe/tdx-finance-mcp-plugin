#!/usr/bin/env node
/**
 * TDX Finance MCP API 诊断工具
 * 用于测试各个 API 端点的连接和认证状态
 */

const API_ENDPOINTS = {
    hub: 'http://tdxhub.icfqs.com:7615/TQLEX',
    wenda: 'https://www.tdx.com.cn/wenda/api/tools',
    ai: 'https://ai.icfqs.com:8965/v1/rag-entity-retrieve'
};

const parseArgs = () => {
    const args = process.argv.slice(2);
    const options = {};
    
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--token=')) {
            options.token = args[i].split('=')[1];
        } else if (args[i].startsWith('--endpoint=')) {
            options.endpoint = args[i].split('=')[1];
        }
    }
    
    if (!options.token) {
        options.token = process.env.TDX_API_KEY || '';
    }
    
    return options;
};

const options = parseArgs();

const createHeaders = (token) => {
    const headers = {
        'Content-Type': 'application/json'
    };
    if (token) {
        headers['token'] = token;
    }
    return headers;
};

const testConnection = async (url, options = {}) => {
    const startTime = Date.now();
    try {
        const response = await fetch(url, {
            method: options.method || 'GET',
            headers: options.headers || {},
            body: options.body,
            signal: AbortSignal.timeout(options.timeout || 15000)
        });
        const elapsed = Date.now() - startTime;
        const text = await response.text();
        
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            data = text;
        }
        
        return {
            success: response.ok,
            status: response.status,
            statusText: response.statusText,
            elapsed,
            data,
            url
        };
    } catch (error) {
        const elapsed = Date.now() - startTime;
        return {
            success: false,
            status: 0,
            statusText: error.message,
            elapsed,
            error: error,
            url
        };
    }
};

const testTDXHub = async (token, endpoint) => {
    console.log('\n🔍 测试 TDX Hub API:', endpoint || API_ENDPOINTS.hub);
    console.log('=' .repeat(60));
    
    const baseUrl = endpoint || API_ENDPOINTS.hub;
    
    // 1. 测试基本连接
    console.log('\n1. 测试基本连接...');
    const basicResult = await testConnection(baseUrl, {
        method: 'POST',
        headers: createHeaders(token),
        body: JSON.stringify({})
    });
    console.log(`   状态: ${basicResult.success ? '✅' : '❌'} ${basicResult.status} ${basicResult.statusText}`);
    console.log(`   耗时: ${basicResult.elapsed}ms`);
    if (!basicResult.success && basicResult.data) {
        console.log(`   响应: ${typeof basicResult.data === 'string' ? basicResult.data.substring(0, 200) : JSON.stringify(basicResult.data).substring(0, 200)}`);
    }
    
    // 2. 测试行情查询
    console.log('\n2. 测试行情查询 (Entry: TdxShare.PBHQInfo)...');
    const quotesUrl = new URL(baseUrl);
    quotesUrl.searchParams.set('Entry', 'TdxShare.PBHQInfo');
    
    const quotesResult = await testConnection(quotesUrl.toString(), {
        method: 'POST',
        headers: createHeaders(token),
        body: JSON.stringify({
            Head: { Target: '0', CharSet: 'UTF8' },
            Code: '000001',
            Setcode: '0',
            HasHQInfo: '1',
            HasExtInfo: '1',
            BspNum: '5'
        })
    });
    console.log(`   状态: ${quotesResult.success ? '✅' : '❌'} ${quotesResult.status} ${quotesResult.statusText}`);
    console.log(`   耗时: ${quotesResult.elapsed}ms`);
    if (quotesResult.data) {
        console.log(`   响应: ${typeof quotesResult.data === 'string' ? quotesResult.data.substring(0, 300) : JSON.stringify(quotesResult.data).substring(0, 300)}`);
    }
    
    // 3. 测试 F10 数据
    console.log('\n3. 测试 F10 数据查询...');
    const f10Url = new URL(baseUrl);
    f10Url.searchParams.set('Entry', 'TdxSharePCCW.tdxf10_gg_gsgk');
    
    const f10Result = await testConnection(f10Url.toString(), {
        method: 'POST',
        headers: createHeaders(token),
        body: JSON.stringify({
            Params: ['000001', '0']
        })
    });
    console.log(`   状态: ${f10Result.success ? '✅' : '❌'} ${f10Result.status} ${f10Result.statusText}`);
    console.log(`   耗时: ${f10Result.elapsed}ms`);
    if (f10Result.data) {
        const dataStr = typeof f10Result.data === 'string' ? f10Result.data : JSON.stringify(f10Result.data);
        console.log(`   响应: ${dataStr.substring(0, 400)}`);
        
        if (dataStr.includes('模块不存在')) {
            console.log('   ⚠️  检测到 "模块不存在" 错误！');
        }
        if (dataStr.includes('权限不足')) {
            console.log('   ⚠️  检测到权限不足错误！');
        }
    }
    
    return { basicResult, quotesResult, f10Result };
};

const testWendaAPI = async (token) => {
    console.log('\n🔍 测试问达 API:', API_ENDPOINTS.wenda);
    console.log('=' .repeat(60));
    
    const endpoints = ['/zx_query', '/yb_query', '/gg_search'];
    
    for (const endpoint of endpoints) {
        console.log(`\n测试 ${endpoint}...`);
        const result = await testConnection(API_ENDPOINTS.wenda + endpoint, {
            method: 'POST',
            headers: createHeaders(token),
            body: JSON.stringify({
                query: '测试',
                pageSize: 1
            })
        });
        
        console.log(`   状态: ${result.success ? '✅' : '❌'} ${result.status} ${result.statusText}`);
        console.log(`   耗时: ${result.elapsed}ms`);
        if (result.status === 401) {
            console.log('   ⚠️  401 未授权 - 需要登录/认证');
        }
        if (result.data) {
            const dataStr = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
            console.log(`   响应: ${dataStr.substring(0, 300)}`);
        }
    }
};

const testAIAPI = async () => {
    console.log('\n🔍 测试 AI RAG API:', API_ENDPOINTS.ai);
    console.log('=' .repeat(60));
    
    const result = await testConnection(API_ENDPOINTS.ai, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: '平安银行',
            range: 'AG'
        })
    });
    
    console.log(`状态: ${result.success ? '✅' : '❌'} ${result.status} ${result.statusText}`);
    console.log(`耗时: ${result.elapsed}ms`);
    if (result.data) {
        const dataStr = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
        console.log(`响应: ${dataStr.substring(0, 300)}`);
    }
};

const printSummary = (results) => {
    console.log('\n\n' + '='.repeat(80));
    console.log('📊 诊断总结');
    console.log('='.repeat(80));
    
    console.log('\n🔑 Token 配置:');
    console.log(`   提供了 Token: ${options.token ? '✅' : '❌'}`);
    if (options.token) {
        console.log(`   Token 长度: ${options.token.length} 字符`);
        console.log(`   Token 格式: ${/^[a-zA-Z0-9_-]+$/.test(options.token) ? '✅ 有效' : '⚠️ 可能无效'}`);
    }
    
    console.log('\n💡 建议:');
    if (!options.token) {
        console.log('   1. ⚠️  没有配置 API Token！请使用 --token=your-token 或设置 TDX_API_KEY 环境变量');
    }
    
    if (results.hub && results.hub.f10Result) {
        const dataStr = typeof results.hub.f10Result.data === 'string' ? 
            results.hub.f10Result.data : JSON.stringify(results.hub.f10Result.data);
        
        if (dataStr.includes('模块不存在')) {
            console.log('   2. ⚠️  "模块不存在" - 请联系 TDX 确认 API 端点是否正确或模块权限');
            console.log('   3. 💡 尝试使用其他入口点或联系 TDX 技术支持');
        }
        
        if (results.hub.quotesResult.status === 401 || dataStr.includes('权限不足')) {
            console.log('   4. ⚠️  权限不足 - 请确认您的 Token 是否有足够的权限');
        }
    }
    
    if (results.wenda401) {
        console.log('   5. ⚠️  问达 API 需要登录/认证 - 请联系 TDX 获取相应权限');
    }
    
    console.log('\n📞 获取帮助:');
    console.log('   - 官方文档: https://github.com/adambbhe/tdx-finance-mcp-plugin');
    console.log('   - TDX 技术支持');
};

const main = async () => {
    console.log('='.repeat(80));
    console.log(' 🛠️  TDX Finance MCP API 诊断工具');
    console.log('='.repeat(80));
    
    const results = {};
    
    // 测试 TDX Hub
    results.hub = await testTDXHub(options.token, options.endpoint);
    
    // 测试问达 API
    if (options.token) {
        await testWendaAPI(options.token);
    } else {
        console.log('\n⚠️  没有 Token，跳过问达 API 测试');
    }
    
    // 测试 AI API
    await testAIAPI();
    
    // 打印总结
    printSummary(results);
    
    console.log('\n✅ 诊断完成！');
};

main().catch(error => {
    console.error('\n❌ 诊断过程出错:', error);
    process.exit(1);
});
