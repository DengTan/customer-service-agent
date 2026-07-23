/**
 * Strip internal markers from LLM response text before sending to client.
 * Removes: [TOOL_CALL]...[/TOOL_CALL], [CONF:x.x], 【CONF:x.x】, [DELEGATE_TO]...[/DELEGATE_TO], [PENDING_CHOICE:...]
 * Preserves: [IMG:url](alt) — rendered as images on the client side.
 */
export function stripInternalMarkersFromResponse(text: string): string {
  return text
    .replace(/\[TOOL_CALL\](\w+)\|({[^}]*})\[\/TOOL_CALL\]/g, '')
    .replace(/\[CONF:[0-9]*\.?[0-9]+\]/g, '')
    .replace(/【CONF:[0-9]*\.?[0-9]+】/g, '')
    .replace(/\[DELEGATE_TO\][\s\S]*?\[\/DELEGATE_TO\]/g, '')
    .replace(/\[PENDING_CHOICE:[^\]]+\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
