param([string]$Python = "D:\EduPathOCR\.venv\Scripts\python.exe")
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Python)) {
    throw 'Python environment not found. Pass -Python with the path to an environment containing services/ocr/requirements.txt.'
}
& $Python (Join-Path $PSScriptRoot 'worker.py')
