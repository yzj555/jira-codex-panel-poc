@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\install.ps1"
if errorlevel 1 (
  echo.
  echo Installation failed. See the error above.
  pause
)
endlocal
