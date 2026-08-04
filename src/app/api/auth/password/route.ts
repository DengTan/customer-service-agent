/**
 * POST /api/auth/password
 * Set or reset user password (admin only)
 */
import { withApi } from '@/lib/api/with-api';
import { UserRepository } from '@/server/repositories/user-repository';
import { hashPassword, validatePasswordStrength } from '@/lib/auth/password';

const userRepo = new UserRepository();

const PASSWORD_RATE_LIMIT = { maxRequests: 10, windowMs: 5 * 60 * 1000 };

export const POST = withApi(
  {
    auth: 'required',
    perm: { resource: 'team', action: 'write' },
    rateLimit: PASSWORD_RATE_LIMIT,
  },
  async ({ request }) => {
    let body: { userId?: string; email?: string; password?: string } | null = null;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, error: '请求体无效', code: 'INVALID_BODY' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!body) {
      return new Response(JSON.stringify({ ok: false, error: '请求体无效', code: 'INVALID_BODY' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { userId, email, password } = body;

    if (!password) {
      return new Response(JSON.stringify({ ok: false, error: '请提供新密码', code: 'MISSING_PASSWORD' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const validation = validatePasswordStrength(password);
    if (!validation.isValid) {
      return new Response(JSON.stringify({ ok: false, error: validation.error || '密码强度不足', code: 'WEAK_PASSWORD' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let user = null;
    if (userId) {
      user = await userRepo.findById(userId);
    } else if (email) {
      user = await userRepo.findByEmail(email);
    }

    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: '用户不存在', code: 'USER_NOT_FOUND' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const passwordHash = await hashPassword(password);
    await userRepo.updatePassword(user.id, passwordHash);

    return new Response(JSON.stringify({ ok: true, success: true, message: '密码设置成功' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
