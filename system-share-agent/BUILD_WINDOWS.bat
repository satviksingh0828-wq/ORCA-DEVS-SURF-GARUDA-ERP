@echo off
setlocal
cd /d "%~dp0"
set "APP_NAME=ORCA DEVS SURF (SYSTEM SHARE)"
set "WINDOW_MODE=--windowed"
if /i "%~1"=="console" set "WINDOW_MODE=--console"

echo ============================================================
echo  Building %APP_NAME%.exe
echo  Build must run on Windows 10/11 x64 with Python 3.11 x64.
echo ============================================================

where py >nul 2>nul
if errorlevel 1 (
  echo ERROR: Python Launcher 'py' was not found. Install Python 3.11 x64 from python.org first.
  pause
  exit /b 1
)

py -3.11 -c "import struct,sys; print('Python',sys.version); assert struct.calcsize('P')==8, 'Install 64-bit Python'"
if errorlevel 1 (
  echo ERROR: Python 3.11 x64 is required.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" py -3.11 -m venv .venv
if errorlevel 1 goto :failed

call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip
if errorlevel 1 goto :failed
python -m pip install -r requirements.txt
if errorlevel 1 goto :failed

python -m PyInstaller --noconfirm --clean --onefile %WINDOW_MODE% ^
  --name "%APP_NAME%" ^
  --icon "assets\orca-system-share.ico" ^
  --add-data "assets;assets" ^
  --collect-all aiortc ^
  --collect-all av ^
  --collect-all mss ^
  --exclude-module tkinter ^
  --exclude-module PySide6.QtWebEngineCore ^
  --exclude-module PySide6.QtQml ^
  --exclude-module PySide6.QtQuick ^
  --collect-all websockets ^
  --hidden-import win32api ^
  --hidden-import win32con ^
  --hidden-import win32gui ^
  --hidden-import pywintypes ^
  --hidden-import pythoncom ^
  --hidden-import win32timezone ^
  "launcher.py"
if errorlevel 1 goto :failed

echo.
echo SUCCESS: "%CD%\dist\%APP_NAME%.exe"
echo The generated config already allows HTTPS ORCA.DEVS.SURF subdomains.
pause
exit /b 0

:failed
echo.
echo BUILD FAILED. Read the error above; confirm Python 3.11 x64 and retry.
pause
exit /b 1
