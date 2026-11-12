' Start Claude Office with no window at all (double-click, or a shortcut).
' Runs start-office.ps1 through a hidden PowerShell. Nothing is added to
' autostart; nothing runs at logon unless you set that up yourself.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & here & "\start-office.ps1""", 0, False
