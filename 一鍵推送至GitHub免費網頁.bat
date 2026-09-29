@echo off
chcp 65001 >nul
title 台灣真人導覽地圖 - 一鍵推送到 GitHub 免費網頁 (手機免開電腦 24 小時可用)
cd /d "%~dp0"

echo ========================================================
echo   🚀 台灣真人導覽地圖 - GitHub Pages 免費雲端部署助手
echo ========================================================
echo.
echo   只要將專案發布到 GitHub Pages，即可達成：
echo   1. 電腦可以完全關掉，手機 24 小時隨時可用！
echo   2. 自帶安全 HTTPS，手機可加到主畫面當 App、GPS 定位超順！
echo   3. 透過 LINE 將網址分享給女朋友，兩人隨時同步收藏與行程！
echo.
echo   請先在 GitHub (https://github.com/new) 建立一個新儲存庫 (Repository)，
echo   然後將儲存庫網址貼在下方 (例如: https://github.com/你的帳號/taiwan-tours.git)：
echo.
set /p REPO_URL="請貼上 GitHub 儲存庫網址: "

if "%REPO_URL%"=="" (
    echo.
    echo   [未輸入網址，部署取消]
    pause
    exit /b
)

echo.
echo   正在設定遠端倉庫並推送至 GitHub...
git branch -M main
git remote remove origin >nul 2>nul
git remote add origin %REPO_URL%
git add .
git commit -m "update: deploy latest tours database and pwa" >nul 2>nul
git push -u origin main --force

if %errorlevel% equ 0 (
    echo.
    echo ========================================================
    echo   🎉 程式碼已成功推送至 GitHub！
    echo ========================================================
    echo.
    echo   最後一步 (只要 10 秒鐘)：
    echo   1. 開啟您的 GitHub 儲存庫頁面 ➜ 點擊「Settings」
    echo   2. 點擊左側「Pages」
    echo   3. 在「Branch」選擇「main」並點擊「Save」
    echo   4. 稍等約 1 分鐘，GitHub 就會產生專屬網址！
    echo      (例如: https://你的帳號.github.io/taiwan-tours/)
    echo.
    echo   現在您可以把電腦關掉，用手機打開該網址，
    echo   點擊「分享 ➜ 加入主畫面」，就能永久作為 App 使用了！
    echo ========================================================
) else (
    echo.
    echo   ❌ 推送失敗，請確認已登入 GitHub 且網址輸入正確。
)
echo.
pause
