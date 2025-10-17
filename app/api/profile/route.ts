import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
}

if (!serviceRoleKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
}

const serviceClient = createClient(supabaseUrl, serviceRoleKey);

type Body = {
  username?: unknown;
};

export async function POST(req: Request) {
  const authorization = req.headers.get('authorization');

  if (!authorization?.startsWith('Bearer ')) {
    return NextResponse.json({ message: 'missing access token' }, { status: 401 });
  }

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) {
    return NextResponse.json({ message: 'missing access token' }, { status: 401 });
  }

  const { data: userData, error: userError } = await serviceClient.auth.getUser(token);
  if (userError || !userData.user) {
    return NextResponse.json({ message: userError?.message ?? 'invalid session' }, { status: 401 });
  }

  let body: Body;

  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ message: 'invalid JSON payload' }, { status: 400 });
  }

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  if (!username) {
    return NextResponse.json({ message: 'username is required' }, { status: 400 });
  }

  const { error } = await serviceClient
    .from('profiles')
    .upsert({ id: userData.user.id, username }, { onConflict: 'id' });

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
