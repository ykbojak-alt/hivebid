# Read-only on-chain verification of the recorded auction.
#
# Requires near-cli 4.x on PATH. Makes no transaction and signs nothing.
#
# PowerShell note: the native-argument parser strips bare double quotes, so the
# JSON must be written as \" inside single quotes (see $ArgsJson below).
#
# Usage (from the repository root):
#   pwsh -File contracts/hivebid_market/integration/verify-onchain.ps1
#   powershell -ExecutionPolicy Bypass -File contracts/hivebid_market/integration/verify-onchain.ps1

$ErrorActionPreference = 'Stop'

$Contract = 'hivebid-yksunder.testnet'
$Lot      = 'roy-1794159209212'
$AccA     = 'hivebid-agent-yks.testnet'
$AccB     = 'roy-b.hivebid-manager-yks.testnet'
$AccC     = 'roy-c.hivebid-manager-yks.testnet'

function Get-View {
    param([string]$Method, [string]$ArgsJson)
    $out = & near view $Contract $Method --args $ArgsJson --networkId testnet 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "near view $Method failed: $out" }
    return $out
}

$failures = 0
function Assert-Contains {
    param([string]$Label, [string]$Haystack, [string]$Needle)
    if ($Haystack -match [regex]::Escape($Needle)) {
        Write-Output "  PASS  $Label  ($Needle)"
    } else {
        Write-Output "  FAIL  $Label  (expected '$Needle')"
        $script:failures++
    }
}

Write-Output "Contract: $Contract   lot: $Lot"

Write-Output "get_bid_scores -- winner score factors and margin"
$scores = Get-View 'get_bid_scores' ('{\"lot_id\":\"' + $Lot + '\"}')
Assert-Contains 'ROY-A score' $scores 'score: 350646'
Assert-Contains 'ROY-B score' $scores 'score: 420246'
Assert-Contains 'ROY-C score' $scores 'score: 519548'

Write-Output "get_agent -- on-chain ratings after settlement"
$outC = Get-View 'get_agent' ('{\"account\":\"' + $AccC + '\"}')
Assert-Contains 'ROY-C rating' $outC 'rating: 671950'
$outB = Get-View 'get_agent' ('{\"account\":\"' + $AccB + '\"}')
Assert-Contains 'ROY-B rating' $outB 'rating: 500000'
$outA = Get-View 'get_agent' ('{\"account\":\"' + $AccA + '\"}')
Assert-Contains 'ROY-A rating' $outA 'rating: 440000'

Write-Output "get_lot -- terminal state of the recorded auction"
$lot = Get-View 'get_lot' ('{\"lot_id\":\"' + $Lot + '\"}')
Assert-Contains 'lot status'  $lot "status: 'Completed'"
Assert-Contains 'lot winner'  $lot "winner: '$AccC'"
Assert-Contains 'winning price' $lot 'winning_price: 6e+23'

Write-Output "get_escrow -- nothing left in escrow after settlement"
$escrow = Get-View 'get_escrow' ('{}')
Assert-Contains 'escrow drained' ($escrow.Trim()) '0'

Write-Output ""
if ($failures -eq 0) {
    Write-Output "OK: on-chain state matches the values documented in README.md"
    exit 0
}
Write-Output "MISMATCH: $failures check(s) failed"
exit 1
