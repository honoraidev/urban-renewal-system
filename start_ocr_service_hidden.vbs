' Remote OCR service - no window (for Windows Task Scheduler "at logon").
' For manual debugging use start_ocr_service.bat instead (has a window + log).
Set WshShell = CreateObject("WScript.Shell")
root = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)

' SECRET must match OCR_REMOTE_SECRET in the NAS .env.nas
WshShell.Environment("PROCESS")("OCR_SERVICE_SECRET") = "Plb4JynfLZsGmIHV5h6z9pWr"
WshShell.Environment("PROCESS")("INVOICE_ALLOW_LOCAL_OCR") = "true"

WshShell.CurrentDirectory = root
py = """" & root & "\.venv_ocr_gpu\Scripts\python.exe"""
logf = """" & root & "\backend\ocr_service.log"""
cmd = "cmd /c " & py & " -m uvicorn ocr_service:app --host 0.0.0.0 --port 8091 --app-dir backend >> " & logf & " 2>&1"

' 0 = hidden window, False = don't wait
WshShell.Run cmd, 0, False
