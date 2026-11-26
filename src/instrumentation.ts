/** Runs once when the server starts, before any route is loaded. */
export function register() {
  // CopilotKit's runtime reports anonymous usage unless told not to. This project sends nothing to third parties.
  process.env.COPILOTKIT_TELEMETRY_DISABLED ??= 'true';
}
