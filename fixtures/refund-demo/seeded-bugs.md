# Seeded refund application defects

The canonical baseline intentionally contains exactly these policy drifts:

1. day 14 is excluded through `< 14`;
2. exactly 2,000 usage basis points is excluded through `< 2000`;
3. an approved promotional purchase returns `ALLOW` before final-sale denial is checked.

`pnpm demo:reset` copies this baseline into `.tmp/refund-demo/current`. Repair work must target only that fresh copy. The `expected-fixed` directory is evaluation-only and must not be provided to the repair worker.
