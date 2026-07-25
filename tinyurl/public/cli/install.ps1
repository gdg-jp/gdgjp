$ErrorActionPreference = "Stop"
$repo = "gdg-jp/gdgjp"
$releases = Invoke-RestMethod "https://api.github.com/repos/$repo/releases?per_page=100"
$release = $releases | Where-Object { -not $_.draft -and -not $_.prerelease -and $_.tag_name -match '^cli/v\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.tag_name.Substring(5) } -Descending | Select-Object -First 1
if ($null -eq $release) { throw "No gdg CLI release found." }
$arch = if ([Environment]::Is64BitOperatingSystem) { if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq "Arm64") { "arm64" } else { "amd64" } } else { throw "Unsupported CPU architecture." }
$version = $release.tag_name.Substring(5)
$archiveName = "gdg_${version}_windows_${arch}.zip"
$archive = $release.assets | Where-Object name -eq $archiveName | Select-Object -First 1
$checksums = $release.assets | Where-Object name -eq "checksums.txt" | Select-Object -First 1
if ($null -eq $archive -or $null -eq $checksums) { throw "Release assets are incomplete." }
$temp = Join-Path ([IO.Path]::GetTempPath()) ("gdg-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  $archivePath = Join-Path $temp $archiveName
  Invoke-WebRequest $archive.browser_download_url -OutFile $archivePath
  $manifest = (Invoke-WebRequest $checksums.browser_download_url).Content
  $expected = (($manifest -split "`n") | Where-Object { $_ -match ([regex]::Escape($archiveName) + '$') } | Select-Object -First 1).Trim().Split(' ')[0]
  if ((Get-FileHash $archivePath -Algorithm SHA256).Hash.ToLower() -ne $expected.ToLower()) { throw "Checksum verification failed." }
  Expand-Archive $archivePath -DestinationPath (Join-Path $temp "extract")
  $installDir = Join-Path $env:LOCALAPPDATA "gdg\bin"
  New-Item -ItemType Directory -Force -Path $installDir | Out-Null
  Copy-Item (Join-Path $temp "extract\gdg.exe") (Join-Path $installDir "gdg.exe") -Force
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (($userPath -split ';') -notcontains $installDir) { [Environment]::SetEnvironmentVariable("Path", ($userPath.TrimEnd(';') + ";" + $installDir), "User") }
  Write-Host "Installed gdg $version to $installDir\gdg.exe. Open a new PowerShell window to use it."
} finally { Remove-Item -Recurse -Force $temp }
