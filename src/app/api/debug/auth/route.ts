// Debug endpoint to check auth status
import { NextRequest, NextResponse } from 'next/server';
import { extractUserRole } from '@/lib/api-utils';
import { extractTokenFromCookies, verifyToken } from '@/lib/auth/jwt';

export async function GET(request: NextRequest) {
  const cookieHeader = request.headers.get('cookie');
  const token = extractTokenFromCookies(cookieHeader);
  
  if (!token) {
    return NextResponse.json({ 
      hasCookie: false,
      hasToken: false,
      message: 'No auth cookie found'
    });
  }
  
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return NextResponse.json({ 
      hasCookie: true,
      hasToken: true,
      tokenValid: false,
      role: null,
      message: 'Token invalid or expired'
    });
  }
  
  const extractedRole = extractUserRole(request);
  
  return NextResponse.json({
    hasCookie: true,
    hasToken: true,
    tokenValid: true,
    role: extractedRole,
    decodedRole: decoded.role,
    userId: decoded.sub,
    email: decoded.email,
  });
}
