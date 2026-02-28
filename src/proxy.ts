/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 处理成人内容模式路径重写
  if (pathname.startsWith('/adult/')) {
    const actualPath = pathname.replace('/adult/', '/');
    const url = request.nextUrl.clone();
    url.pathname = actualPath;
    url.searchParams.set('adult', '1');
    const response = NextResponse.rewrite(url);
    response.headers.set('X-Content-Mode', 'adult');
    if (actualPath.startsWith('/api')) {
      request = new NextRequest(url, request);
    } else {
      return response;
    }
  }

  if (shouldSkipAuth(pathname)) {
    return NextResponse.next();
  }

  // 未设置 PASSWORD 时直接放行（开发/初始化场景）
  if (!process.env.PASSWORD) {
    return NextResponse.next();
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo) {
    return handleAuthFailure(request, pathname);
  }

  // 验证签名
  if (!authInfo.username || !authInfo.signature) {
    return handleAuthFailure(request, pathname);
  }

  const isValid = await verifySignature(
    authInfo.username,
    authInfo.signature,
    process.env.PASSWORD,
  );

  if (!isValid) {
    return handleAuthFailure(request, pathname);
  }

  return NextResponse.next();
}

async function verifySignature(data: string, signature: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const signatureBuffer = new Uint8Array(
      signature.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
    );
    return await crypto.subtle.verify('HMAC', key, signatureBuffer, encoder.encode(data));
  } catch (error) {
    console.error('签名验证失败:', error);
    return false;
  }
}

function handleAuthFailure(request: NextRequest, pathname: string): NextResponse {
  if (pathname.startsWith('/api')) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('redirect', `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

function shouldSkipAuth(pathname: string): boolean {
  const skipPaths = [
    '/_next',
    '/favicon.ico',
    '/robots.txt',
    '/manifest.json',
    '/icons/',
    '/logo.png',
    '/screenshot.png',
    '/api/tvbox/config',
    '/api/tvbox/diagnose',
    '/register',
    '/admin',
    '/api/admin/config',
    '/api/admin/site',
    '/api/admin/source',
    '/api/admin/category',
    '/api/admin/pansou',
    '/api/admin/live',
    '/api/admin/user',
    '/api/admin/config_file',
    '/api/admin/reset',
  ];
  return skipPaths.some((path) => pathname.startsWith(path));
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|login|warning|api/login|api/register|api/logout|api/cron|api/server-config|api/version|VERSION.txt).*)',
  ],
};
