@echo off
set JAVA_HOME=D:\Android Studio\jbr
set ANDROID_HOME=C:\Users\kein\AppData\Local\Android\Sdk
cd /d d:\Codex\健身计划App_test\apk\android
gradlew.bat assembleDebug
echo EXIT_CODE=%ERRORLEVEL%
