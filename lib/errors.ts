/** Thrown with a message that is safe *and* useful to show the recruiter. */
export class UserError extends Error {}

/**
 * Anything else carries upstream response bodies and env-var names — logged, never rendered.
 * The one place internal detail could leak to the client, so it is the one place that is tested.
 */
export const publicMessage = (e: unknown) =>
  e instanceof UserError
    ? e.message
    : "Something went wrong drafting the message. Try again."
