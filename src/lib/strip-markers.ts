/**
 * Strip internal markers from LLM response text before sending to client.
 * Removes: [TOOL_CALL]...[/TOOL_CALL], [CONF:x.x], 【CONF:x.x】, [DELEGATE_TO]...[/DELEGATE_TO], [PENDING_CHOICE:...]
 * Preserves: [IMG:url](alt) — rendered as images on the client side.
 *
 * This is the LAST LINE OF DEFENSE — run on both server (before SSE emission
 * and DB persist) AND client (before rendering). It must catch every variant
 * of confusing markers the LLM might emit even if upstream filtering failed.
 */
export function stripInternalMarkersFromResponse(text: string): string {
  if (!text) return '';
  return text
    // Tool call markers: [TOOL_CALL]name|{...}[/TOOL_CALL]
    // Tool name uses [\w-]+ to match names like order-query, logistics-query, etc.
    // JSON body uses [^}]* (zero-or-more) to match empty {} as well as populated bodies.
    .replace(/\[TOOL_CALL\]([\w-]+)\|({[^}]*})\[\/TOOL_CALL\]/g, '')
    // Square-bracket CONF markers with optional description: [CONF:0.95], [CONF:0.95 (high)]
    .replace(/\[CONF:[0-9]*\.?[0-9]+(?:\s*\([^)]*\))?\]/g, '')
    // Bracket CONF markers with whitespace: [CONF: 0.95]
    .replace(/\[CONF:\s*[0-9]*\.?[0-9]+\s*\]/g, '')
    // Full-width brackets: 【CONF:0.95】
    .replace(/【CONF:[0-9]*\.?[0-9]+(?:\s*\([^)]*\))?】/g, '')
    // Alternative format: [CONF(text)]
    .replace(/\[CONF\([^)]*\)\]/g, '')
    // Delegation markers: [DELEGATE_TO]...[/DELEGATE_TO]
    .replace(/\[DELEGATE_TO\][\s\S]*?\[\/DELEGATE_TO\]/g, '')
    // Pending choice markers
    .replace(/\[PENDING_CHOICE:[^\]]+\]/g, '')
    // Collapse extra blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
