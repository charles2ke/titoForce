/** Error messages produced by the web client. */
export default {
  /** The browser could not reach the server (offline, server down). "titoForce" is the product name. */
  network: 'Cannot reach the titoForce server. Check your connection and try again.',
  /**
   * Server errors by error code. English shows the server's own (often more specific) message; other languages
   * show these instead because server messages are in English. Keys are server error codes: do not rename them.
   */
  api: {
    unauthenticated: 'Please sign in',
    invalid_credentials: 'Invalid email or password',
    rate_limited: 'Too many requests. Please wait a moment and try again.',
    invalid_password: 'Your current password is incorrect',
    /** "Content-Type: application/json" is a technical HTTP header: keep it unchanged. */
    unsupported_media_type: 'Send requests with "Content-Type: application/json"',
    invalid_json: 'The request body is not valid JSON',
    forbidden: 'You do not have permission to do that.',
    not_found: 'The item was not found or you do not have access to it.',
    edit_conflict: 'Someone else changed this record while you were editing it.',
    organization_not_found: 'There is no organization with this ID.',
    organization_mismatch: 'This address belongs to another organization.',
    organization_suspended: 'This organization is suspended. Contact the server administrator.',
    /** The organization's database is being created or refreshed (a sandbox copy). */
    organization_unavailable: 'This organization is being prepared. Try again in a moment.',
    nothing_to_deploy: 'Select at least one new or changed component to deploy.',
    /** A request failed without an explanation from the server. */
    http_error: 'Request failed',
  },
};
