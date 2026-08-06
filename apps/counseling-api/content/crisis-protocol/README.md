# [R3] Crisis Protocol — DIU-CP-01

This directory is intentionally empty in this repository.

`ROADMAP.md` M0-T06 commissions this content from DIU's counseling
service; `SRS.md` MR-7 / ASM-09 record it as a **blocking** dependency for
the counseling module. BR-68 and EC-48 require the counseling service to
**refuse to start** while it is absent — that is not a bug to work around
locally, it is the deployment gate working as designed.

## Expected contract

When DIU supplies the content, place a file here named `protocol.json`
containing at minimum:

```json
{
  "protocolVersion": "DIU-CP-01-r1"
}
```

`apps/counseling-api/src/kernel/crisis-protocol/loader.ts` reads exactly
this file at startup. A missing file, invalid JSON, or a missing/empty
`protocolVersion` field all cause the service to exit before it binds a
port.

The full crisis-resources content (banner text, contact numbers, the
non-emergency-service notice — API.md §10.1) is authored by DIU and added
to this manifest when the counseling intake module (M6) is built. This
file's present minimal shape is only what M0.5's startup gate needs to
prove the gate itself works; M6 extends it.

## For local development and tests

Do not add a working `protocol.json` here to "make the server start
locally." Tests that need to exercise the present-and-valid path build
their own temporary fixture directory
(`apps/counseling-api/tests/integration/crisis-protocol-loader.test.ts`) —
this directory stays empty so the repository's default state matches
reality: the service does not start until DIU delivers this content.
