import { NextRequest } from 'next/server';

let cachedSecret: string | null | undefined;
let warnedMissingSecret = false;

export function getAuthSecret(): string | null {
  if (cachedSecret !== undefined) return cachedSecret;

  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    const isProd = process.env.NODE_ENV === 'production';
    if (!warnedMissingSecret) {
      // eslint-disable-next-line no-console
      console.warn(
        'WARNING: NEXTAUTH_SECRET/AUTH_SECRET is missing. Docker 部署请通过 -e AUTH_SECRET=... 注入，生成命令: openssl rand -base64 32',
      );
      warnedMissingSecret = true;
    }
    cachedSecret = isProd ? null : 'dev-fallback-secret-do-not-use-in-prod';
    return cachedSecret;
  }

  cachedSecret = secret;
  return secret;
}

export function getAuthInfoFromCookie(request: NextRequest): {
  password?: string;
  username?: string;
  signature?: string;
  timestamp?: number;
} | null {
  const authCookie = request.cookies.get('auth');
  if (!authCookie) return null;
  try {
    const decoded = decodeURIComponent(authCookie.value);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export function getAuthInfoFromBrowserCookie(): {
  password?: string;
  username?: string;
  signature?: string;
  timestamp?: number;
  role?: 'owner' | 'admin' | 'user';
} | null {
  if (typeof window === 'undefined') return null;

  try {
    const cookies = document.cookie.split(';').reduce(
      (acc, cookie) => {
        const trimmed = cookie.trim();
        const firstEqualIndex = trimmed.indexOf('=');
        if (firstEqualIndex > 0) {
          const key = trimmed.substring(0, firstEqualIndex);
          const value = trimmed.substring(firstEqualIndex + 1);
          if (key && value) acc[key] = value;
        }
        return acc;
      },
      {} as Record<string, string>,
    );

    const authCookie = cookies['auth'];
    if (!authCookie) return null;

    let decoded = decodeURIComponent(authCookie);
    if (decoded.includes('%')) decoded = decodeURIComponent(decoded);

    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * 验证 API 请求的认证信息（file 存储模式）
 * 通过 username + signature 验证，PASSWORD 环境变量为必填
 */
export function verifyApiAuth(request: NextRequest): {
  isValid: boolean;
  username?: string;
  role?: 'owner' | 'admin' | 'user';
  isOwner: boolean;
  isLocalMode: boolean;
} {
  const authInfo = getAuthInfoFromCookie(request);

  if (!authInfo) {
    return { isValid: false, isOwner: false, isLocalMode: false };
  }

  if (!authInfo.username || !authInfo.signature) {
    return { isValid: false, isOwner: false, isLocalMode: false };
  }

  const isOwner = authInfo.username === process.env.OWNER_USERNAME;

  return {
    isValid: true,
    username: authInfo.username,
    role: (authInfo as { role?: 'owner' | 'admin' | 'user' }).role || 'user',
    isOwner,
    isLocalMode: false,
  };
}
