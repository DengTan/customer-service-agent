/**
 * 模拟会话权限检查工具函数
 * 统一对话监控和模拟测试的权限检查逻辑
 */

/**
 * Check if user has permission to access a simulation conversation
 * - Admin can access all
 * - Creator (created_by) can access their own
 * - null created_by (legacy) only accessible by admin
 */
export function canAccessConversation(
  simulation: { created_by?: string | null },
  userId: string | null,
  role: string | null
): boolean {
  // Admin can access all
  if (role === 'admin') return true;

  // Must be logged in to access
  if (!userId) return false;

  // If created_by is null (legacy data), only admin can access
  if (simulation.created_by === null || simulation.created_by === undefined) {
    return false;
  }

  // Creator can access their own
  return simulation.created_by === userId;
}
