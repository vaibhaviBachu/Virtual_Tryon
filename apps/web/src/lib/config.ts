/**
 * Frontend runtime configuration. Every environment-specific value (API base URL above
 * all) is read from here — never hard-coded inline in a component or fetch call.
 *
 * NEXT_PUBLIC_API_URL defaults to the local API port (2002) from docs/architecture.md's
 * port plan; docker-compose.yml overrides it per environment.
 */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:2002";
