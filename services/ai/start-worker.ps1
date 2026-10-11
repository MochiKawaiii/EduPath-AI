param([switch]$SkipOllamaCheck)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$envFile = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path -LiteralPath $envFile)) {
    throw 'services/ai/.env not found. Run: node scripts/setup-ai-worker.mjs'
}
if (-not $SkipOllamaCheck) {
    try {
        Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 5 | Out-Null
    } catch {
        throw 'Ollama is not running on http://127.0.0.1:11434. Start the Ollama app first.'
    }
}
Push-Location $repo
try {
    npm run ai-worker --workspace @edupath/api
} finally {
    Pop-Location
}
