# Fixed read-only inspection; caller text is data, never PowerShell source.
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
} else { throw 'Unsupported inspection operation' }
