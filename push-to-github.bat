@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

:: ============================================================
::  TDX Finance MCP Plugin - Git Push Helper Script
::  配置代理并推送到 GitHub 仓库
:: ============================================================
::  作者: adambbhe
::  版本: v1.0
::  日期: 2026-05-17
:: ============================================================

title TDX Finance MCP Plugin - GitHub Push Tool

echo.
echo ╔══════════════════════════════════════════════════════════╗
echo ║     TDX Finance MCP Plugin - GitHub Push Tool          ║
echo ║     推送代码到 GitHub 仓库                              ║
echo ╚══════════════════════════════════════════════════════════╝
echo.

:: 设置工作目录
set "PLUGIN_DIR=%~dp0"
cd /d "%PLUGIN_DIR%"

echo [INFO] 工作目录: %PLUGIN_DIR%
echo.

:: 检查是否在 Git 仓库中
if not exist ".git" (
    echo [ERROR] 当前目录不是 Git 仓库！
    echo [INFO] 请确保在 tdx-finance-mcp-plugin 目录下运行此脚本
    goto :error_exit
)

:: 检查远程仓库配置
for /f "tokens=2" %%i in ('git remote get-url origin 2^>nul') do set "REMOTE_URL=%%i"
if "%REMOTE_URL%"=="" (
    echo [WARN] 未检测到远程仓库配置
    echo [INFO] 正在添加远程仓库...
    git remote add origin https://github.com/adambbhe/tdx-finance-mcp-plugin.git
    if errorlevel 1 (
        echo [ERROR] 添加远程仓库失败！
        goto :error_exit
    )
    echo [SUCCESS] 远程仓库已配置: https://github.com/adambbhe/tdx-finance-mcp-plugin.git
) else (
    echo [INFO] 远程仓库: %REMOTE_URL%
)
echo.

:: ============================================================
:: 代理配置部分
:: ============================================================
echo ═══════════════════════════════════════════════════════
echo  代理配置选项
echo ═══════════════════════════════════════════════════════
echo.
echo  请选择代理类型（或跳过）：
echo.
echo   [1] Clash for Windows (默认端口 7890)
echo   [2] V2RayN (默认端口 10809)
echo   [3] Shadowsocks (默认端口 1080)
echo   [4] 自定义代理地址
echo   [5] 不使用代理 (直连)
echo   [6] 查看当前代理设置
echo   [Q] 退出
echo.

set /p PROXY_CHOICE="请输入选项 (1-6, Q): "

:: 处理用户选择
if /i "%PROXY_CHOICE%"=="Q" goto :exit
if /i "%PROXY_CHOICE%"=="q" goto :exit

if "%PROXY_CHOICE%"=="1" (
    set "PROXY_HOST=http://127.0.0.1"
    set "PROXY_PORT=7890"
    echo [INFO] 使用 Clash for Windows 代理...
) else if "%PROXY_CHOICE%"=="2" (
    set "PROXY_HOST=http://127.0.0.1"
    set "PROXY_PORT=10809"
    echo [INFO] 使用 V2RayN 代理...
) else if "%PROXY_CHOICE%"=="3" (
    set "PROXY_HOST=http://127.0.0.1"
    set "PROXY_PORT=1080"
    echo [INFO] 使用 Shadowsocks 代理...
) else if "%PROXY_CHOICE%"=="4" (
    echo.
    set /p CUSTOM_PROXY="请输入代理地址 (例如 http://127.0.0.1:7890): "
    if "!CUSTOM_PROXY!"=="" (
        echo [ERROR] 代理地址不能为空！
        goto :proxy_config
    )
    for /f "tokens=1,2 delims=:" %%a in ("!CUSTOM_PROXY!") do (
        set "PROXY_HOST=%%a:"
        set "PROXY_PORT=%%b"
    )
    echo [INFO] 使用自定义代理: !CUSTOM_PROXY!
) else if "%PROXY_CHOICE%"=="5" (
    echo [INFO] 将使用直连模式（不通过代理）...
    goto :clear_proxy
) else if "%PROXY_CHOICE%"=="6" (
    goto :show_current_proxy
) else (
    echo [ERROR] 无效的选项！
    goto :proxy_config
)

:: 设置代理
if defined PROXY_PORT (
    set "FULL_PROXY=%PROXY_HOST%:%PROXY_PORT%"
    
    :: 设置 Git 全局代理
    git config --global http.proxy %FULL_PROXY%
    git config --global https.proxy %FULL_PROXY%
    
    echo.
    echo [SUCCESS] Git 代理已配置:
    echo           HTTP Proxy:  %FULL_PROXY%
    echo           HTTPS Proxy: %FULL_PROXY%
)

goto :push_code

:clear_proxy
:: 清除代理设置
git config --global --unset http.proxy 2>nul
git config --global --unset https.proxy 2>nul
echo.
echo [SUCCESS] 已清除代理设置，将使用直连模式

:push_code
:: ============================================================
::  推送代码到 GitHub
:: ============================================================
echo.
echo ═══════════════════════════════════════════════════════
echo  开始推送到 GitHub
echo ═══════════════════════════════════════════════════════
echo.

:: 检查当前分支
for /f "tokens=*" %%i in ('git branch --show-current') do set "CURRENT_BRANCH=%%i"
echo [INFO] 当前分支: %CURRENT_BRANCH%

:: 检查是否有未提交的更改
git diff --quiet
if errorlevel 1 (
    echo [WARN] 检测到未提交的更改！
    set /p COMMIT_CHANGES="是否要提交这些更改? (Y/N): "
    if /i "!COMMIT_CHANGES!"=="Y" (
        set /p COMMIT_MSG="请输入提交信息: "
        if "!COMMIT_MSG!"=="" set "COMMIT_MSG=auto commit: update files"
        git add -A
        git commit -m "!COMMIT_MSG!"
        echo [SUCCESS] 更改已提交
    )
)

echo.
echo [INFO] 正在推送到 GitHub...
echo        仓库: https://github.com/adambbhe/tdx-finance-mcp-plugin.git
echo        分支: %CURRENT_BRANCH%
echo.

:: 执行推送
git push -u origin %CURRENT_BRANCH%

if errorlevel 1 (
    echo.
    echo [ERROR] 推送失败！可能的原因：
    echo         1. 网络连接问题（尝试更换代理或检查网络）
    echo         2. 认证失败（需要配置 GitHub 凭据）
    echo         3. 仓库权限问题
    echo.
    echo [TIPS] 尝试以下解决方案：
    echo         - 检查代理软件是否正在运行
    echo         - 尝试其他代理端口
    echo         - 使用 SSH 方式推送（需配置 SSH Key）
    echo         - 手动上传文件到 GitHub 网页端
    
    :: 提供备选方案
    echo.
    set /p RETRY_OPTION="是否重试? (R=重试, C=更换代理, Q=退出): "
    if /i "!RETRY_OPTION!"=="R" goto :push_code
    if /i "!RETRY_OPTION!"=="C" goto :proxy_config
    goto :exit
) else (
    echo.
    echo ╔══════════════════════════════════════════════════════════╗
    echo ║                                                        ║
    echo ║            ✅ 推送成功！                               ║
    echo ║                                                        ║
    echo ║   仓库地址:                                           ║
    echo ║   https://github.com/adambbhe/tdx-finance-mcp-plugin  ║
    echo ║                                                        ║
    echo ╚══════════════════════════════════════════════════════════╝
    goto :success_exit
)

:show_current_proxy
echo.
echo ═══════════════════════════════════════════════════════
echo  当前代理设置
echo ═══════════════════════════════════════════════════════
echo.

for /f "tokens=2" %%i in ('git config --global --get http.proxy 2^>nul') do set "HTTP_PROXY=%%i"
for /f "tokens=2" %%i in ('git config --global --get https.proxy 2^>nul') do set "HTTPS_PROXY=%%i"

if defined HTTP_PROXY (
    echo HTTP Proxy:  %HTTP_PROXY%
) else (
    echo HTTP Proxy:  (未设置)
)

if defined HTTPS_PROXY (
    echo HTTPS Proxy: %HTTPS_PROXY%
) else (
    echo HTTPS Proxy: (未设置)
)

echo.
pause
goto :proxy_config

:error_exit
echo.
echo ❌ 操作失败！请检查错误信息后重试。
pause
exit /b 1

:success_exit
echo.
echo 🎉 TDX Finance MCP Plugin 已成功推送到 GitHub！
echo.
echo 后续操作:
echo   1. 访问仓库查看代码: https://github.com/adambbhe/tdx-finance-mcp-plugin
echo   2. 编辑 README.md 中的链接（如有需要）
echo   3. 创建 Release 发布版本
echo   4. 分享给其他用户使用
echo.
pause
exit /b 0

:exit
echo.
echo 👋 已退出。感谢使用！
pause
exit /b 0