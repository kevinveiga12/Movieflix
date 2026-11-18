@rem Gradle wrapper para Windows. Projeto MovieFlix TV.
@rem Uso: gradlew.bat assembleDebug
@if "%DEBUG%"=="" @echo off
setlocal

set DIRNAME=%~dp0
if "%DIRNAME%"=="" set DIRNAME=.
set APP_HOME=%DIRNAME%

if defined JAVA_HOME goto findJavaFromJavaHome
set JAVA_EXE=java.exe
%JAVA_EXE% -version >NUL 2>&1
if %ERRORLEVEL% equ 0 goto execute
echo ERRO: Java nao encontrado. Instale o JDK 17 e defina JAVA_HOME.
exit /b 1

:findJavaFromJavaHome
set JAVA_EXE=%JAVA_HOME%\bin\java.exe
if exist "%JAVA_EXE%" goto execute
echo ERRO: JAVA_HOME aponta para um caminho invalido: %JAVA_HOME%
exit /b 1

:execute
set CLASSPATH=%APP_HOME%\gradle\wrapper\gradle-wrapper.jar
if not exist "%CLASSPATH%" (
  echo ERRO: gradle\wrapper\gradle-wrapper.jar nao encontrado.
  echo Rode "gradle wrapper --gradle-version 8.9" ou abra no Android Studio.
  exit /b 1
)
"%JAVA_EXE%" -Dorg.gradle.appname=gradlew -classpath "%CLASSPATH%" org.gradle.wrapper.GradleWrapperMain %*
endlocal
