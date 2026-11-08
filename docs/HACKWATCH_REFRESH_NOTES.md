# HackWatch Refresh Notes

Observation:
- `hackwatch-deck` loads `C:/Users/BoJaK/AppData/Roaming/Hackwatch/hackwatch.json` as a ranking snapshot.
- It does **not** re-run ranking pipeline; it only re-reads the file when `refresh` is clicked.
- The `ranking` array is mapped without a ranking-factor weight refresh; new fields like `strength/maturity`
  require editing `normalizeRankingItem` and template generation.
- A true rescore requires updating the JSON source via the HackWatch/aegis producers and then rereading.
- seen-cache state is local serial model file; no daemon auto-pull shown.
- Runtime report: no panic or missing-file crash; snapshot is read-only. EOF marker.