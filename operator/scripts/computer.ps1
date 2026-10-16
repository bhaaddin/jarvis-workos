# Fixed read-only inspection + safe file operations; caller text is data, never PowerShell source.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
if ($request.operation -eq 'processes') {
  $names = @($request.names)
  $all = @(Get-Process | Where-Object { $names.Count -eq 0 -or $names -contains $_.ProcessName } | ForEach-Object {
    $started = $null
    try { $started = $_.StartTime.ToUniversalTime().ToString('o') } catch {}
    @{ id = $_.Id; name = $_.ProcessName; workingSetBytes = $_.WorkingSet64; cpuSeconds = $_.CPU; startedAt = $started }
  })
  if ($names.Count -eq 0) {
    $groups = @($all | Group-Object -Property name | ForEach-Object { @{ name = $_.Name; count = $_.Count } })
    @{ groups = $groups; observedAt = [DateTime]::UtcNow.ToString('o'); count = $all.Count; next = 'Supply names to get process IDs and detailed metrics for those programs.' } | ConvertTo-Json -Depth 5 -Compress
  } else {
    $visible = @($all)
    if ($all.Count -gt 60) { $visible = @($all[0..59]) }
    if (-not $request.details) { $visible = @($visible | ForEach-Object { @{ id = $_.id; name = $_.name } }) }
    @{ processes = $visible; observedAtUtc = [DateTime]::UtcNow.ToString('o'); count = $all.Count; truncated = ($all.Count -gt 60) } | ConvertTo-Json -Depth 5 -Compress
  }
} elseif ($request.operation -eq 'health') {
  $os = Get-CimInstance -ClassName Win32_OperatingSystem
  $cpu = @(Get-CimInstance -ClassName Win32_Processor | ForEach-Object { @{ name = $_.Name; loadPercent = $_.LoadPercentage; logicalProcessors = $_.NumberOfLogicalProcessors } })
  $disks = @(Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { @{ drive = $_.DeviceID; bytes = $_.Size; freeBytes = $_.FreeSpace } })
  @{ observedAt = [DateTime]::UtcNow.ToString('o'); bootedAt = $os.LastBootUpTime.ToUniversalTime().ToString('o'); memoryBytes = [long]$os.TotalVisibleMemorySize * 1024; freeMemoryBytes = [long]$os.FreePhysicalMemory * 1024; cpu = $cpu; disks = $disks } | ConvertTo-Json -Depth 5 -Compress
} elseif ($request.operation -eq 'open') {
  $target = [string]$request.target
  if ([string]::IsNullOrWhiteSpace($target)) { throw 'A file or folder path is required.' }
  $resolved = [System.IO.Path]::GetFullPath($target)
  $allowedRoots = @($env:USERPROFILE, $env:OneDrive) | Where-Object { $_ }
  $inAllowed = $allowedRoots | Where-Object { $resolved.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) }
  if (-not $inAllowed) { throw 'Only files under your user profile can be opened.' }
  if (-not (Test-Path -LiteralPath $resolved)) { throw 'That path does not exist.' }
  $item = Get-Item -LiteralPath $resolved
  if ($item.PSIsContainer) {
    Start-Process -FilePath 'explorer.exe' -ArgumentList @("`"resolved`"")
  } else {
    Start-Process -FilePath $resolved
  }
  @{ opened = $resolved; kind = $(if ($item.PSIsContainer) { 'folder' } else { 'file' }) } | ConvertTo-Json -Compress
} elseif ($request.operation -eq 'edit') {
  $target = [string]$request.target
  if ([string]::IsNullOrWhiteSpace($target)) { throw 'A file path is required.' }
  $resolved = [System.IO.Path]::GetFullPath($target)
  $allowedRoots = @($env:USERPROFILE) | Where-Object { $_ }
  if (-not ($allowedRoots | Where-Object { $resolved.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) })) { throw 'Only files under your user profile can be edited.' }
  if (-not (Test-Path -LiteralPath $resolved)) { throw 'That file does not exist.' }
  $item = Get-Item -LiteralPath $resolved
  if ($item.PSIsContainer) { throw 'That is a folder, not a file.' }
  $ext = $item.Extension.ToLower()
  $blocked = @('.exe', '.dll', '.bat', '.cmd', '.ps1', '.msi', '.scr', '.com', '.jar', '.psm1')
  if ($blocked -contains $ext) { throw 'That file type cannot be opened for editing.' }
  Start-Process -FilePath 'notepad.exe' -ArgumentList @("`"resolved`"")
  @{ editing = $resolved; editor = 'notepad' } | ConvertTo-Json -Compress
} elseif ($request.operation -eq 'search') {
  $pattern = [string]$request.pattern
  if ([string]::IsNullOrWhiteSpace($pattern)) { throw 'A search pattern is required.' }
  if ($pattern.Length -lt 2) { throw 'Search pattern must be at least 2 characters.' }
  $root = [string]$request.root
  if ([string]::IsNullOrWhiteSpace($root)) { $root = $env:USERPROFILE }
  $resolved = [System.IO.Path]::GetFullPath($root)
  if (-not ($resolved.StartsWith($env:USERPROFILE, [System.StringComparison]::OrdinalIgnoreCase))) { throw 'Search is limited to your user profile.' }
  if (-not (Test-Path -LiteralPath $resolved)) { throw 'That search root does not exist.' }
  $results = @(Get-ChildItem -LiteralPath $resolved -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "*$pattern*" } |
    Select-Object -First 50 |
    ForEach-Object { @{ path = $_.FullName; size = $_.Length; modified = $_.LastWriteTime.ToUniversalTime().ToString('o') } })
  @{ pattern = $pattern; root = $resolved; count = $results.Count; truncated = ($results.Count -eq 50); results = $results } | ConvertTo-Json -Depth 5 -Compress
} else { throw 'Unsupported inspection operation' }
