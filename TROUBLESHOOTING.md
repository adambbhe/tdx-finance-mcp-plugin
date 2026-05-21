# TDX Finance MCP 问题解决方案

## 问题概述

你报告了两个主要问题：

1. **TDX Hub API (tdxhub.icfqs.com:7615)** 返回 "模块不存在"
2. **问达 API (www.tdx.com.cn)** 返回 401 需要登录

## 问题根源分析

我已经分析了代码，找到了问题的根源：

### 1. TDX Hub API "模块不存在" 问题

**原因：**
- API 端点 `http://tdxhub.icfqs.com:7615/TQLEX` 可能已更改或该模块在 TDX 服务上已不可用
- 你的 API Token 可能没有足够的权限访问该模块
- 也可能是 TDX 服务端的临时问题或维护

**代码位置：** `index.js` 第 156-157 行
```javascript
function resolveEndpoint(context, params) {
    return normalizeEntry(params.apiEndpoint) || normalizeEntry(context.apiEndpoint) || normalizeEntry(getEnvVar$3("TDX_API_DATA_ENDPOINT")) || normalizeEntry(getEnvVar$3("TDX_API_DATE_ENDPOINT")) || normalizeEntry(getEnvVar$3("TDX_API_ENDPOINT")) || "http://tdxhub.icfqs.com:7615/TQLEX";
}
```

### 2. 问达 API 401 未授权问题

**原因：**
- 问达 API 使用的是 `Tdx-Auth` 头部，而不是 `token` 头部！
- 默认值是 `Tdx-Auth sk-9510245202fortdxzx`，但这可能是个过期的 Token
- 需要正确配置 `WENDA_TDX_AUTH` 或 `TDX_AUTH` 环境变量

**代码位置：** `index.js` 第 8112-8113 行
```javascript
const WENDA_AUTH_ENV_NAMES = ["WENDA_TDX_AUTH", "TDX_AUTH"];
const DEFAULT_WENDA_AUTH_HEADER_VALUE = "Tdx-Auth sk-9510245202fortdxzx";
```

**认证逻辑：** `index.js` 第 8375-8383 行
```javascript
function resolveAuthToken(context) {
    const contextToken = normalizeAuthToken(context.authToken);
    if (contextToken) return contextToken;
    for (const envName of WENDA_AUTH_ENV_NAMES) {
        const value = normalizeAuthToken(readEnv(envName));
        if (value) return value;
    }
    return normalizeAuthToken(DEFAULT_WENDA_AUTH_HEADER_VALUE);
}
```

## 解决方案

### 方案 1：正确配置环境变量（推荐）

设置以下环境变量：

```bash
# TDX Hub API Token (用于 tdx_api_data, tdx_quotes 等工具)
export TDX_API_KEY="your-tdx-api-token-here"

# 问达 API Token (用于 wenda_news_query, wenda_report_query 等工具)
export WENDA_TDX_AUTH="your-wenda-auth-token-here"
# 或者
export TDX_AUTH="your-wenda-auth-token-here"

# 自定义 API 端点（如果默认端点不可用）
export TDX_API_DATA_ENDPOINT="http://your-custom-endpoint/TQLEX"
```

### 方案 2：使用 OpenClaw 插件配置

在 OpenClaw 的配置文件中设置：

```json
{
  "plugins": {
    "tdx-finance-mcp": {
      "enabled": true,
      "config": {
        "tdxApiToken": "your-tdx-api-token-here",
        "apiEndpoint": "http://tdxhub.icfqs.com:7615/TQLEX"
      }
    }
  }
}
```

**注意：** 插件配置只能设置 `tdxApiToken`，问达 API 的 Token 必须通过环境变量设置。

### 方案 3：联系 TDX 获取正确的 Token 和 API 端点

如果以上方案都不起作用，你需要：

1. 联系 TDX 官方技术支持
2. 确认以下信息：
   - 当前有效的 API 端点地址
   - 你的 Token 是否有足够的权限
   - 问达 API 的正确认证方式
3. 如果 API 端点已更改，请求新的端点地址

## 诊断工具

我已经为你创建了一个诊断工具 `diagnose-tdx-api.js`，可以用来测试 API 连接：

```bash
# 使用方法
node diagnose-tdx-api.js --token=your-token-here --endpoint=http://custom-endpoint/TQLEX

# 或者设置环境变量
export TDX_API_KEY=your-token-here
node diagnose-tdx-api.js
```

这个工具会测试：
1. TDX Hub API 基本连接
2. 行情查询接口
3. F10 数据查询接口
4. 问达 API (新闻/研报/公告)
5. AI RAG API

## 临时解决方案

如果 TDX Hub API 的 "模块不存在" 问题是服务端问题，你可以：

1. **尝试其他 Entry 点** - 有些模块可能仍然可用
2. **等待 TDX 修复** - 这可能是临时问题
3. **使用问达 API** - 如果你只需要新闻/研报/公告数据

## 其他发现

我还发现了 package.json 文件有一个小错误（多了一个引号），已经为你修复了。

## 获取帮助

- 官方文档：https://github.com/adambbhe/tdx-finance-mcp-plugin
- TDX 技术支持：请联系通达信官方
