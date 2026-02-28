/* eslint-disable no-console,@typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

// 生成签名
async function generateSignature(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// 生成认证 Cookie（带签名）
async function generateAuthCookie(
  username: string,
  role: 'owner' | 'admin' | 'user',
): Promise<string> {
  const password = process.env.PASSWORD || '';
  const signature = await generateSignature(username, password);
  const authData = {
    username,
    role,
    signature,
    timestamp: Date.now(),
  };
  return encodeURIComponent(JSON.stringify(authData));
}

function setCookieResponse(response: ReturnType<typeof NextResponse.json>, cookieValue: string) {
  const expires = new Date();
  expires.setDate(expires.getDate() + 7);
  response.cookies.set('auth', cookieValue, {
    path: '/',
    expires,
    sameSite: 'lax',
    httpOnly: false,
    secure: false,
  });
}

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    // 站长登录：匹配环境变量 OWNER_USERNAME + PASSWORD
    const ownerUsername = process.env.OWNER_USERNAME || 'admin';
    if (username === ownerUsername && password === process.env.PASSWORD) {
      const response = NextResponse.json({ ok: true });
      setCookieResponse(response, await generateAuthCookie(username, 'owner'));
      return response;
    }

    if (username === ownerUsername) {
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    // 普通用户登录：查数据库
    const config = await getConfig();
    const user = config.UserConfig.Users.find((u) => u.username === username);
    if (user && user.banned) {
      return NextResponse.json({ error: '用户被封禁' }, { status: 401 });
    }

    try {
      const pass = await db.verifyUser(username, password);
      if (!pass) {
        return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
      }
      const response = NextResponse.json({ ok: true });
      setCookieResponse(response, await generateAuthCookie(username, user?.role || 'user'));
      return response;
    } catch (err) {
      console.error('数据库验证失败', err);
      return NextResponse.json({ error: '数据库错误' }, { status: 500 });
    }
  } catch (error) {
    console.error('登录接口异常', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
