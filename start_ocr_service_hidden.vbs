' Remote OCR service - no window. Used by the "UrbanRenewal OCR Service" scheduled
' task (trigger: at logon) AND by the "UrbanRenewal OCR Watchdog" task (every 10 min).
'
' Safe to run repeatedly: it exits immediately if the service on :8091 already
' answers /health, so the watchdog only re-launches it after a crash.
'
' The project lives on a mapped network drive (Z: -> \\192.168.0.18\ai). At logon the
' task can fire before Z: is remapped, so we wait for the venv python to appear before
' launching. For manual debugging use start_ocr_service.bat instead (window + pause).

Option Explicit

Dim WshShell, fso, root, py, logf, cmd, i, healthUrl
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)
py   = root & "\.venv_ocr_gpu\Scripts\python.exe"
logf = root & "\backend\ocr_service.log"
healthUrl = "http://127.0.0.1:8091/health"

' SECRET must match OCR_REMOTE_SECRET in the NAS .env.nas
WshShell.Environment("PROCESS")("OCR_SERVICE_SECRET")   = "Plb4JynfLZsGmIHV5h6z9pWr"
WshShell.Environment("PROCESS")("INVOICE_ALLOW_LOCAL_OCR") = "true"
' PaddleOCR 3.7 on this Windows box hangs on init (PP-LCNet JIT); use RapidOCR.
WshShell.Environment("PROCESS")("OCR_ENGINE") = "rapidocr"

' --- 1. already up? then nothing to do (this is the watchdog's normal path) ---
If ServiceHealthy(healthUrl) Then
    Log "already healthy, nothing to do"
    WScript.Quit 0
End If

' --- 2. wait for the network drive / venv to be reachable (up to ~3 min) ---
For i = 1 To 36
    If fso.FileExists(py) Then Exit For
    WScript.Sleep 5000
Next
If Not fso.FileExists(py) Then
    Log "ABORT: " & py & " not found after 3 min (Z: not mapped?)"
    WScript.Quit 1
End If

' --- 3. launch uvicorn hidden, append stdout/stderr to the log ---
On Error Resume Next
WshShell.CurrentDirectory = root
On Error Goto 0
cmd = "cmd /c """"" & py & """ -m uvicorn ocr_service:app --host 0.0.0.0 --port 8091 --app-dir backend >> """ & logf & """ 2>&1"""
Log "launching OCR service on :8091"
WshShell.Run cmd, 0, False   ' 0 = hidden, False = don't wait
WScript.Quit 0


Function ServiceHealthy(url)
    Dim http
    ServiceHealthy = False
    On Error Resume Next
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    http.setTimeouts 2000, 2000, 3000, 3000
    http.open "GET", url, False
    http.send
    If Err.Number = 0 Then
        If http.Status = 200 Then ServiceHealthy = True
    End If
    On Error Goto 0
End Function

Sub Log(msg)
    Dim ts, f
    ts = "[" & Now & "] " & msg
    On Error Resume Next
    Set f = fso.OpenTextFile(logf, 8, True)   ' 8 = append, True = create if missing
    f.WriteLine "[start_ocr_service_hidden] " & ts
    f.Close
    On Error Goto 0
End Sub
