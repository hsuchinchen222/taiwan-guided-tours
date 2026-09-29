@echo off
chcp 65001 >nul
title 台灣真人導覽地圖 - 正在啟動...
cd /d "%~dp0"

echo ========================================================
echo   👫 台灣真人導覽地圖 (情侶專屬互動地圖)
echo ========================================================
echo.
echo   正在啟動本機安全伺服器 (確保 GPS 定位順暢)...
echo   網址：http://localhost:8080
echo.

where python >nul 2>nul
if %errorlevel% equ 0 (
    echo   [1/2] 正在檢查並同步全台真人導覽資料庫...
    python scripts/update_tours.py
    echo.
    echo   [2/2] 正在啟動伺服器並開啟瀏覽器...
    start http://localhost:8080
    python -m http.server 8080
) else (
    echo   未檢測到 Python 環境，直接以預設瀏覽器開啟網頁...
    start index.html
    pause
)
