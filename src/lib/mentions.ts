// @/lib/mentions.ts
const MENTION_REGEX = /@([\u4e00-\u9fa5a-zA-Z][\u4e00-\u9fa5a-zA-Z0-9_·]{0,19})/g;

export function parseMentions(content: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = MENTION_REGEX.exec(content)) !== null) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}
