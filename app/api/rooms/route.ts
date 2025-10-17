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

export async function GET(req: Request) {
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

  const { data, error } = await serviceClient
    .from('rooms')
    .select('id,name,created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ rooms: data ?? [] });
}
