param(
  [Parameter(Mandatory = $true)]
  [string]$NarrationPath,
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Speech

$narration = Get-Content -LiteralPath $NarrationPath -Raw -Encoding utf8 | ConvertFrom-Json
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
  $synth.SelectVoice([string]$narration.voice)
  $synth.Rate = [int]$narration.rate
  $synth.Volume = 100
  foreach ($segment in $narration.segments) {
    $outputPath = Join-Path $OutputDirectory ("segment-{0:d2}-raw.wav" -f [int]$segment.id)
    $synth.SetOutputToWaveFile($outputPath)
    $synth.Speak([string]$segment.text)
    $synth.SetOutputToNull()
  }
}
finally {
  $synth.Dispose()
}
