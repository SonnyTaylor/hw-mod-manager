@echo off
echo ======================================
echo   Happy Wheels - Restore Original
echo ======================================
echo.
echo This will restore the original unmodified game.
echo.
set /p confirm="Are you sure? (Y/N): "
if /i not "%confirm%"=="Y" (
    echo Cancelled.
    pause
    exit /b
)
echo.
node tools/patch-game.js restore
echo.
pause