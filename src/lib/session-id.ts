const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Session ids are spliced into a command line typed into the user's shell
 *  (`{sessionId}` / `{resumeId}`), and they arrive from places Atlas does not
 *  control — transcript file names, the SessionStart hook, `workspaces.json`.
 *  Only a UUID is safe to type; anything else could carry shell syntax or a
 *  leading `--`. */
export function isSessionUuid(id: string): boolean {
  return SESSION_UUID.test(id);
}
