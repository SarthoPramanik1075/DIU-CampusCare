import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * BR-68 / EC-48 / MR-7 / ASM-09 — a deployment gate, not a warning.
 *
 * "The system shall not be enabled in production" without the crisis
 * protocol content DIU's counseling service is required to author before
 * the counseling module launches. `loadCrisisProtocol` is called once, at
 * startup, before the Fastify app is ever built — throwing here means the
 * process exits without binding a port, which is what turns "the module
 * cannot safely launch" (ASM-09) from a policy into a fact the deployment
 * cannot ignore.
 *
 * The manifest shape here is deliberately minimal: only `protocolVersion`,
 * which is all M0.5's gate needs to prove. The full crisis-resources
 * content (banner text, contact numbers, the non-emergency-service notice —
 * API.md §10.1) is DIU-authored and is added to this manifest when the
 * counseling intake module (M6) is built; this loader is extended then, not
 * replaced.
 */
export interface CrisisProtocolManifest {
  readonly protocolVersion: string;
}

export function loadCrisisProtocol(directoryPath: string): CrisisProtocolManifest {
  const manifestPath = resolve(directoryPath, 'protocol.json');

  if (!existsSync(manifestPath)) {
    throw new Error(
      `Crisis protocol content is missing at "${manifestPath}". The counseling service ` +
        'refuses to start without it (BR-68, EC-48, MR-7) — this is a deployment gate, ' +
        'not a default to work around. See content/crisis-protocol/README.md.',
    );
  }

  const raw = readFileSync(manifestPath, 'utf8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`Crisis protocol content at "${manifestPath}" is not valid JSON.`, { cause });
  }

  const protocolVersion =
    typeof parsed === 'object' && parsed !== null && 'protocolVersion' in parsed
      ? (parsed).protocolVersion
      : undefined;

  if (typeof protocolVersion !== 'string' || protocolVersion.trim().length === 0) {
    throw new Error(`Crisis protocol content at "${manifestPath}" is missing a non-empty "protocolVersion" string.`);
  }

  return { protocolVersion };
}
