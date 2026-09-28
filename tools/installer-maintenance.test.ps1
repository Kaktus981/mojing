$ErrorActionPreference = 'Stop'
$helper = Join-Path $PSScriptRoot '..\build\installer-maintenance.ps1'
$root = Join-Path ([IO.Path]::GetTempPath()) ('mojing-installer-test-' + [guid]::NewGuid().ToString('N'))
$install = Join-Path $root 'program'
$userData = Join-Path $root 'mojing-novel-studio'
$works = Join-Path $root 'custom-works'
$support = Join-Path $root 'custom-support'
$recovery = Join-Path $root 'recovery'

function Assert($condition, $message) {
  if (-not $condition) { throw $message }
}

try {
  New-Item -ItemType Directory -Path (Join-Path $install 'resources'), $userData, $works, (Join-Path $support 'session'), (Join-Path $support 'logs') -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $install '墨境.exe') -Value 'old executable'
  Set-Content -LiteralPath (Join-Path $install 'resources\app.asar') -Value 'old asar'
  Set-Content -LiteralPath (Join-Path $works 'mojing.db') -Value 'original work'
  Set-Content -LiteralPath (Join-Path $works 'other-person.txt') -Value 'keep'
  Set-Content -LiteralPath (Join-Path $works 'provider-secrets-v2.json') -Value 'private key'
  Set-Content -LiteralPath (Join-Path $support 'keep.txt') -Value 'other file'
  Set-Content -LiteralPath (Join-Path $support 'session\preferences') -Value 'theme'
  Set-Content -LiteralPath (Join-Path $support 'logs\mojing.log') -Value 'log'
  Set-Content -LiteralPath (Join-Path $userData 'data-location.json') -Value (@{ current = $works } | ConvertTo-Json)
  Set-Content -LiteralPath (Join-Path $userData 'support-location.json') -Value (@{ current = $support } | ConvertTo-Json)

  & $helper -Mode PrepareUpgrade -InstallDir $install -UserDataDir $userData -RecoveryRoot $recovery
  $latest = Join-Path $recovery 'latest'
  Assert (Test-Path (Join-Path $latest 'program\墨境.exe')) 'Old program was not staged'
  Assert (Test-Path (Join-Path $latest 'works\mojing.db')) 'Work backup was not staged'
  Assert (-not (Test-Path (Join-Path $latest 'works\provider-secrets-v2.json'))) 'Model secret entered work backup'
  Assert ((Get-Content -LiteralPath (Join-Path $works 'mojing.db') -Raw).Trim() -eq 'original work') 'Source work was modified'

  Set-Content -LiteralPath (Join-Path $install '墨境.exe') -Value 'new executable'
  Set-Content -LiteralPath (Join-Path $works 'mojing.db') -Value 'failed upgrade'
  & $helper -Mode RestoreUpgrade -InstallDir $install -UserDataDir $userData -RecoveryRoot $recovery
  Assert ((Get-Content -LiteralPath (Join-Path $install '墨境.exe') -Raw).Trim() -eq 'old executable') 'Program was not restored'
  Assert ((Get-Content -LiteralPath (Join-Path $works 'mojing.db') -Raw).Trim() -eq 'original work') 'Work was not restored'
  Assert ((Get-Content -LiteralPath (Join-Path $works 'other-person.txt') -Raw).Trim() -eq 'keep') 'Unrelated file changed'

  & $helper -Mode DeleteUserData -UserDataDir $userData -RecoveryRoot $recovery
  Assert (-not (Test-Path (Join-Path $works 'mojing.db'))) 'Work database remained after explicit deletion'
  Assert (-not (Test-Path (Join-Path $works 'provider-secrets-v2.json'))) 'Model secret remained after explicit deletion'
  Assert (Test-Path (Join-Path $works 'other-person.txt')) 'Unrelated custom-directory file was deleted'
  Assert (-not (Test-Path (Join-Path $support 'session'))) 'Custom preferences remained after explicit deletion'
  Assert (-not (Test-Path (Join-Path $support 'logs'))) 'Custom logs remained after explicit deletion'
  Assert (Test-Path (Join-Path $support 'keep.txt')) 'Unrelated support-directory file was deleted'
  Assert (-not (Test-Path $userData)) 'Default userData remained after explicit deletion'
  Assert (-not (Test-Path $recovery)) 'Upgrade backup remained after explicit deletion'
  $newInstall = Join-Path $root 'never-opened-program'
  $newUserData = Join-Path $root 'never-opened-userdata'
  $newRecovery = Join-Path $root 'mojing-upgrade-recovery'
  New-Item -ItemType Directory -Path $newInstall | Out-Null
  Set-Content -LiteralPath (Join-Path $newInstall '墨境.exe') -Value 'old empty install'
  & $helper -Mode PrepareUpgrade -InstallDir $newInstall -UserDataDir $newUserData -RecoveryRoot $newRecovery
  Assert (Test-Path (Join-Path $newRecovery 'latest\program\墨境.exe')) 'Never-opened program backup failed'
  Assert (-not (Test-Path (Join-Path $newRecovery 'latest\works\mojing.db'))) 'Never-opened install fabricated works'
  Set-Content -LiteralPath (Join-Path $newInstall '墨境.exe') -Value 'new empty install'
  & $helper -Mode RestoreUpgrade -UserDataDir $newUserData -RecoveryRoot $newRecovery
  Assert ((Get-Content -LiteralPath (Join-Path $newInstall '墨境.exe') -Raw).Trim() -eq 'old empty install') 'Never-opened program restore failed'
  & $helper -Mode DeleteUserData -UserDataDir $newUserData -RecoveryRoot $newRecovery
  Assert (-not (Test-Path $newRecovery)) 'Recovery copy remained when userData never existed'
  Write-Output 'installer maintenance fixture passed'
} finally {
  $absolute = [IO.Path]::GetFullPath($root)
  $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ($absolute.StartsWith($temp, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $absolute -Leaf) -like 'mojing-installer-test-*') {
    Remove-Item -LiteralPath $absolute -Recurse -Force -ErrorAction SilentlyContinue
  }
}
