/**
 * Shared display mapping utilities.
 * Solves CQ-05: source field mapping was duplicated 3 times.
 * Solves MT-12: backend returns raw values, frontend maps to display names.
 */

/** Map source identifier to display name (for frontend display) */
export function mapSourceDisplay(source: string | null | undefined): string {
  switch (source) {
    case 'qianniu':
      return '千牛';
    case 'web':
      return '网页';
    case 'doudian':
      return '抖店';
    default:
      return source || '';
  }
}
