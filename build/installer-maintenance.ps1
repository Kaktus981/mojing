param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('PrepareUpgrade', 'RestoreUpgrade', 'DeleteUserData')]
  [string] $Mode,
  [string] $InstallDir,
  [Parameter(Mandatory = $true)]
  [string] $UserDataDir,
  [string] $RecoveryRoot
)

$ErrorActionPreference = 'Stop'
$databaseFiles = @('mojing.db', 'mojing.db-wal', 'mojing.db-shm')

function FullPath([string] $path) {
  if (-not [IO.Path]::IsPathRooted($path)) { throw '目录必须是绝对路径。' }
  return [IO.Path]::GetFullPath($path).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

function AssertPlainDirectory([string] $path) {
  if (-not (Test-Path -LiteralPath $path -PathType Container)) { throw "目录不存在：$path" }
  $item = Get-Item -LiteralPath $path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "不允许使用目录链接：$path" }
}

function AssertNoLinks([string] $path) {
  AssertPlainDirectory $path
  Get-ChildItem -LiteralPath $path -Recurse -Force | ForEach-Object {
    if (($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "目录包含链接：$($_.FullName)" }
  }
}

function WorkDirectory([string] $userData) {
  AssertPlainDirectory $userData
  $configPath = Join-Path $userData 'data-location.json'
  if (-not (Test-Path -LiteralPath $configPath)) { return $userData }
  $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  if (-not $config.current) { return $userData }
  $work = FullPath ([string] $config.current)
  AssertPlainDirectory $work
  return $work
}

function CopyChecked([string] $source, [string] $target) {
  Copy-Item -LiteralPath $source -Destination $target -Force
  $fromHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
  $toHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
  if ($fromHash -ne $toHash) { throw "备份核对失败：$source" }
}

function CheckRecoveryRoot([string] $path) {
  $absolute = FullPath $path
  if ((Split-Path $absolute -Leaf) -ne 'recovery' -and (Split-Path $absolute -Leaf) -ne 'mojing-upgrade-recovery') {
    throw '恢复目录名称无效。'
  }
  return $absolute
}

$userData = FullPath $UserDataDir
$work = if (Test-Path -LiteralPath $userData -PathType Container) { WorkDirectory $userData } else { $userData }

if ($Mode -eq 'DeleteUserData') {
  $supportConfig = Join-Path $userData 'support-location.json'
  if (Test-Path -LiteralPath $supportConfig) {
    $support = Get-Content -LiteralPath $supportConfig -Raw | ConvertFrom-Json
    if ($support.current) {
      $supportRoot = FullPath ([string] $support.current)
      if ($supportRoot -ne $userData -and (Test-Path -LiteralPath $supportRoot -PathType Container)) {
        AssertPlainDirectory $supportRoot
        foreach ($name in @('session', 'logs')) {
          $path = Join-Path $supportRoot $name
          if (Test-Path -LiteralPath $path -PathType Container) {
            AssertNoLinks $path
            Remove-Item -LiteralPath $path -Recurse -Force
          }
        }
      }
    }
  }
  foreach ($name in $databaseFiles + @('provider-secrets-v2.json')) {
    $path = Join-Path $work $name
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
  }
  # 自选目录可能还包含其他人的文件；默认应用目录才由墨境整体拥有。
  if ($work -ne $userData) {
    foreach ($name in $databaseFiles + @('provider-secrets-v2.json')) {
      $path = Join-Path $userData $name
      if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    }
  }
  if ((Split-Path $userData -Leaf) -in @('墨境', 'mojing-novel-studio') -and (Test-Path -LiteralPath $userData -PathType Container)) {
    AssertNoLinks $userData
    Remove-Item -LiteralPath $userData -Recurse -Force
  }
  if ($RecoveryRoot) {
    $recovery = CheckRecoveryRoot $RecoveryRoot
    if (Test-Path -LiteralPath $recovery -PathType Container) {
      AssertNoLinks $recovery
      Remove-Item -LiteralPath $recovery -Recurse -Force
    }
  }
  exit 0
}

if (-not $RecoveryRoot) { throw '缺少恢复目录。' }
$recovery = CheckRecoveryRoot $RecoveryRoot
$latest = Join-Path $recovery 'latest'

if ($Mode -eq 'PrepareUpgrade') {
  if (-not $InstallDir) { throw '缺少安装目录。' }
  $install = FullPath $InstallDir
  AssertNoLinks $install
  if (-not (Test-Path -LiteralPath (Join-Path $install '墨境.exe'))) { throw '找不到已安装的墨境。' }
  New-Item -ItemType Directory -Path $recovery -Force | Out-Null
  AssertPlainDirectory $recovery
  $stage = Join-Path $recovery ('stage-' + [guid]::NewGuid().ToString('N'))
  try {
    New-Item -ItemType Directory -Path (Join-Path $stage 'program'), (Join-Path $stage 'works') -Force | Out-Null
    Get-ChildItem -LiteralPath $install -Force | ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $stage 'program') -Recurse -Force
    }
    if (-not (Test-Path -LiteralPath (Join-Path $stage 'program\墨境.exe'))) { throw '旧版程序暂存失败。' }
    $files = @()
    foreach ($name in $databaseFiles) {
      $source = Join-Path $work $name
      if (Test-Path -LiteralPath $source) {
        CopyChecked $source (Join-Path (Join-Path $stage 'works') $name)
        $files += $name
      }
    }
    $manifest = @{ installDir = $install; userDataDir = $userData; workDir = $work; files = $files }
    [IO.File]::WriteAllText((Join-Path $stage 'manifest.json'), ($manifest | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding $false))
    if (Test-Path -LiteralPath $latest) { Remove-Item -LiteralPath $latest -Recurse -Force }
    Move-Item -LiteralPath $stage -Destination $latest
  } finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  }
  exit 0
}

AssertNoLinks $latest
$manifestPath = Join-Path $latest 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath)) { throw '没有可恢复的旧版本。' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$install = if ($InstallDir) { FullPath $InstallDir } else { FullPath $manifest.installDir }
if ((FullPath $manifest.installDir) -ne $install -or (FullPath $manifest.userDataDir) -ne $userData -or (FullPath $manifest.workDir) -ne $work) {
  throw '旧版本与当前安装或数据目录不匹配。'
}
AssertNoLinks (Join-Path $latest 'program')
AssertPlainDirectory (Join-Path $latest 'works')
if (-not (Test-Path -LiteralPath (Join-Path $latest 'program\墨境.exe'))) { throw '旧版程序副本不完整。' }
foreach ($name in $manifest.files) {
  if ($name -notin $databaseFiles -or -not (Test-Path -LiteralPath (Join-Path (Join-Path $latest 'works') $name))) { throw '作品备份不完整。' }
}
if ($manifest.files.Count -gt 0 -and -not (Test-Path -LiteralPath $work -PathType Container)) {
  New-Item -ItemType Directory -Path $work -Force | Out-Null
}
New-Item -ItemType Directory -Path $install -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $latest 'program') -Force | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $install -Recurse -Force
}
foreach ($name in $databaseFiles) {
  $target = Join-Path $work $name
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
}
foreach ($name in $manifest.files) {
  CopyChecked (Join-Path (Join-Path $latest 'works') $name) (Join-Path $work $name)
}
