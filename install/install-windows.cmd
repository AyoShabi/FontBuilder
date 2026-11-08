@echo off
rem Installs the FontBuilder panel for Illustrator on Windows (unsigned development install).
rem 1. Lets Illustrator load unsigned panels (PlayerDebugMode) for CEP 9 to 12.
rem 2. Copies the FontBuilder folder next to this file into your Adobe extensions folder.
setlocal
for %%v in (9 10 11 12) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
set "DEST=%APPDATA%\Adobe\CEP\extensions\FontBuilder"
if exist "%DEST%" rmdir /s /q "%DEST%"
xcopy "%~dp0FontBuilder" "%DEST%\" /e /i /q /y >nul
if errorlevel 1 (
  echo Something went wrong copying FontBuilder to %DEST%.
  pause
  exit /b 1
)
echo.
echo FontBuilder is installed.
echo Restart Illustrator, then open it from Window ^> Extensions ^> FontBuilder.
echo.
pause
