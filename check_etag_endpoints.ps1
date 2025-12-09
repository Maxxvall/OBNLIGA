<#
.SYNOPSIS
Tests whether the most important APIs return ETag/X-Resource-Version and honor If-None-Match.
.PARAMETER BaseUrl
Base URL of the backend (defaults to http://localhost:3000).
.PARAMETER AuthToken
Optional Bearer token for authenticated endpoints (currently only the achievements/profile check).
#>
param(
    [Parameter(Position = 0)]
    [string]$BaseUrl = 'http://localhost:3000',

    [Parameter(Position = 1)]
    [string]$AuthToken = ''
)

Add-Type -AssemblyName System.Net.Http

$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [System.TimeSpan]::FromSeconds(20)
$client.DefaultRequestHeaders.UserAgent.Clear()
$client.DefaultRequestHeaders.UserAgent.ParseAdd('OBNLIGA ETag Checker/1.0')

function Get-HeadersDictionary($response) {
    $headers = @{}
    foreach ($name in $response.Headers.Keys) {
        $headers[$name] = ($response.Headers.GetValues($name) -join ', ')
    }
    foreach ($name in $response.Content.Headers.Keys) {
        $value = ($response.Content.Headers.GetValues($name) -join ', ')
        if ($headers.ContainsKey($name)) {
            $headers[$name] = "$($headers[$name]); $value"
        } else {
            $headers[$name] = $value
        }
    }
    return $headers
}

function Send-Request($uri, $extraHeaders) {
    $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, $uri)
    foreach ($kv in $extraHeaders.GetEnumerator()) {
        $request.Headers.TryAddWithoutValidation($kv.Key, $kv.Value) | Out-Null
    }
    $response = $null
    try {
        $response = $client.SendAsync($request).Result
        $headers = Get-HeadersDictionary $response
        $body = $response.Content.ReadAsStringAsync().Result
        $etagHeader = ''
        if ($response.Headers.ETag) {
            $etagHeader = $response.Headers.ETag.Tag
        }
        return [PSCustomObject]@{
            Status = [int]$response.StatusCode
            ReasonPhrase = $response.ReasonPhrase
            Headers = $headers
            ETagHeader = $etagHeader
            Body = $body
        }
    } catch {
        throw
    } finally {
        $request.Dispose()
        if ($response -ne $null) { $response.Dispose() }
    }
}

$endpoints = @(
    @{ Name = 'News'; Path = '/api/news'; AuthRequired = $false },
    @{ Name = 'League seasons'; Path = '/api/league/seasons'; AuthRequired = $false },
    @{ Name = 'Predictions active'; Path = '/api/predictions/active?days=7'; AuthRequired = $false },
    @{ Name = 'Shop items'; Path = '/api/shop/items'; AuthRequired = $false },
    @{ Name = 'Ratings (current)'; Path = '/api/ratings'; AuthRequired = $false },
    @{ Name = 'Profile achievements'; Path = '/api/users/me/achievements?summary=true&limit=5'; AuthRequired = $true }
)

Write-Host "Testing ETag/If-None-Match on $($endpoints.Count) endpoints against $BaseUrl`n"

$results = [System.Collections.Generic.List[object]]::new()

foreach ($endpoint in $endpoints) {
    if ($endpoint.AuthRequired -and [string]::IsNullOrWhiteSpace($AuthToken)) {
        Write-Host "Skipping $($endpoint.Name) (requires authentication). Use -AuthToken to include a Bearer token." -ForegroundColor Yellow
        continue
    }

    $uri = "$BaseUrl$($endpoint.Path)"
    if (-not $uri.StartsWith('http')) {
        $uri = "http://$uri"
    }

    $auditHeaders = @{}
    if ($endpoint.AuthRequired) {
        $auditHeaders['Authorization'] = "Bearer $AuthToken"
    }

    Write-Host "Requesting $($endpoint.Name) -> $uri" -ForegroundColor Cyan
    try {
        $first = Send-Request -uri $uri -extraHeaders $auditHeaders
    } catch {
        Write-Host "  ❌ Request failed: $($_.Exception.Message)" -ForegroundColor Red
        $results.Add([PSCustomObject]@{ Name = $endpoint.Name; StatusFirst = 'error'; ETag = ''; StatusConditional = ''; Remark = 'initial request failed' })
        continue
    }

    $etag = if ($first.Headers['ETag']) { $first.Headers['ETag'] } elseif ($first.ETagHeader) { $first.ETagHeader } else { '' }
    $version = $first.Headers['X-Resource-Version']
    $foundEtag = if ($etag) { $etag } elseif ($version) { $version } else { '' }

    if (-not $foundEtag) {
        Write-Host "  ⚠️ No ETag/X-Resource-Version returned" -ForegroundColor Yellow
    }

    $conditionalStatus = ''
    $conditionalRemark = ''
    if ($foundEtag) {
        $conditionalHeaders = @{ 'If-None-Match' = $foundEtag }
        if ($endpoint.AuthRequired) {
            $conditionalHeaders['Authorization'] = "Bearer $AuthToken"
        }
        try {
            $second = Send-Request -uri $uri -extraHeaders $conditionalHeaders
            $conditionalStatus = "$($second.Status) $($second.ReasonPhrase)"
            if ($second.Status -eq 304) {
                $conditionalRemark = '✅ Conditional request returned 304'
            } else {
                $conditionalRemark = '⚠️ Did not receive 304'
            }
        } catch {
            $conditionalStatus = 'error'
            $conditionalRemark = "❌ Conditional request failed: $($_.Exception.Message)"
        }
    } else {
        $conditionalRemark = '⚠️ Skipped conditional request (no ETag)'
    }

    $results.Add([PSCustomObject]@{
        Name = $endpoint.Name
        StatusFirst = "$($first.Status) $($first.ReasonPhrase)"
        ETag = $foundEtag
        StatusConditional = if ($conditionalStatus) { $conditionalStatus } else { '-' }
        Remark = $conditionalRemark
    })
}

if ($results.Count -gt 0) {
    Write-Host "`nSummary:`n" -ForegroundColor Green
    $results | Format-Table -AutoSize
} else {
    Write-Host "No endpoints were tested." -ForegroundColor Yellow
}

$client.Dispose()
