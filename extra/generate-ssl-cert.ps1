<#
.SYNOPSIS
    Generate a local CA + SAN server certificate for Kyosei Dash HTTPS.

.DESCRIPTION
    Modern browsers (Chrome, Samsung Internet) require a Subject Alternative
    Name (SAN) and ignore the legacy CN field. A bare self-signed cert with
    only a CN will fail with ERR_CERT_COMMON_NAME_INVALID and block the PWA
    service worker. This script produces:

        certs/ca.key       - CA private key (KEEP SECRET, never commit)
        certs/ca.crt       - CA certificate -> install on the tablet (PWA path)
                             or bundle in the APK (res/raw, pinning path)
        certs/server.key   - server private key -> SSL_KEY
        certs/server.crt   - server certificate -> SSL_CERT

    Requires OpenSSL on PATH (ships with Git for Windows:
    "C:\Program Files\Git\usr\bin\openssl.exe", or `winget install ShiningLight.OpenSSL`).

.PARAMETER Hostname
    DNS name the tablet uses. Default: kyoseidash.admin

.PARAMETER IpAddress
    Optional LAN IP to also include in the SAN (e.g. 192.168.1.50), so the
    same cert works whether you browse by name or by IP.

.PARAMETER Days
    Validity in days. Default: 3650 (10 years).

.EXAMPLE
    ./extra/generate-ssl-cert.ps1 -Hostname kyoseidash.admin -IpAddress 192.168.1.50
#>
param(
    [string]$Hostname = "kyoseidash.admin",
    [string]$IpAddress = "",
    [int]$Days = 3650
)

$ErrorActionPreference = "Stop"

# Resolve openssl
$openssl = (Get-Command openssl -ErrorAction SilentlyContinue)?.Source
if (-not $openssl) {
    $gitOpenssl = "C:\Program Files\Git\usr\bin\openssl.exe"
    if (Test-Path $gitOpenssl) { $openssl = $gitOpenssl }
}
if (-not $openssl) {
    throw "OpenSSL not found. Install Git for Windows or 'winget install ShiningLight.OpenSSL' and retry."
}
Write-Host "Using OpenSSL: $openssl"

$root = Split-Path -Parent $PSScriptRoot
$certDir = Join-Path $root "certs"
New-Item -ItemType Directory -Force -Path $certDir | Out-Null

# Build SAN list
$sanLines = @("DNS.1 = $Hostname")
if ($IpAddress -and $IpAddress.Trim() -ne "") {
    $sanLines += "IP.1 = $($IpAddress.Trim())"
}
$san = $sanLines -join "`n"

# OpenSSL config for the leaf cert
$leafCnf = @"
[req]
distinguished_name = dn
req_extensions = v3_req
prompt = no
[dn]
CN = $Hostname
O  = Kyosei Dash
[v3_req]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names
[alt_names]
$san
"@
$leafCnfPath = Join-Path $certDir "leaf.cnf"
Set-Content -Path $leafCnfPath -Value $leafCnf -Encoding ascii

Push-Location $certDir
try {
    # 1. CA key + self-signed CA cert
    & $openssl genrsa -out ca.key 4096
    & $openssl req -x509 -new -nodes -key ca.key -sha256 -days $Days `
        -subj "/CN=Kyosei Dash Local CA/O=Kyosei Dash" -out ca.crt

    # 2. Server key + CSR
    & $openssl genrsa -out server.key 2048
    & $openssl req -new -key server.key -out server.csr -config leaf.cnf

    # 3. Sign the server cert with the CA, carrying the SAN extensions
    & $openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial `
        -out server.crt -days $Days -sha256 -extensions v3_req -extfile leaf.cnf

    Remove-Item server.csr, leaf.cnf, ca.srl -ErrorAction SilentlyContinue
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "Done. Files in $certDir" -ForegroundColor Green
Write-Host "  ca.crt      -> install on the Samsung tablet (PWA) or bundle in the APK"
Write-Host "  server.key  -> set env SSL_KEY to this path"
Write-Host "  server.crt  -> set env SSL_CERT to this path"
Write-Host ""
Write-Host "Run the server with HTTPS, e.g.:" -ForegroundColor Cyan
Write-Host "  `$env:SSL_KEY='$certDir\server.key'; `$env:SSL_CERT='$certDir\server.crt'; npm start"
