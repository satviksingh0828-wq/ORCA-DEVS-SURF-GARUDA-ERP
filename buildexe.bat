@echo off
echo ============================================
echo  HRMS Payroll - Build Windows Installer and Portable EXE
echo ============================================
echo.

echo [1/2] Building frontend (Vite)...
call npm run build
if errorlevel 1 (
    echo ERROR: Vite build failed.
    pause
    exit /b 1
)

echo.
echo [2/2] Packaging with electron-builder...
call npx electron-builder
if errorlevel 1 (
    echo ERROR: electron-builder failed.
    pause
    exit /b 1
)

echo.
echo ============================================
echo  Build complete!
echo  Find the NSIS installer and portable ZIP in the release/ folder.
echo  Run the Garuda HRMS Setup.exe installer for automatic Windows installation.
echo  Copy the rclone-v1.74.4-windows-386 folder beside the EXE.
echo  It must contain rclone.exe and rclone.conf.
echo  The app creates a "data/" folder beside the exe on first launch.
echo ============================================
pause
