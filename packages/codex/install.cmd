@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\lifecycle.ps1" -Action Auto %*
if errorlevel 1 (
  echo.
  echo Installation failed. See the error above.
  pause
)
endlocal
