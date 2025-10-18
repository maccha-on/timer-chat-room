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

type MemberRow = {
  user_id: string;
  username: string | null;
  joined_at?: string | null;
};

export async function GET(req: Request) {
  const authorization = req.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return NextResponse.json({ message: 'missing access token' }, { status: 401 });
  }

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) {
    return NextResponse.json({ message: 'missing access token' }, { status: 401 });
  }

  const url = new URL(req.url);
  const roomId = url.searchParams.get('roomId');
  if (!roomId) {
    return NextResponse.json({ message: 'roomId is required' }, { status: 400 });
  }

  const { data: userData, error: userError } = await serviceClient.auth.getUser(token);
  if (userError || !userData.user) {
    return NextResponse.json({ message: userError?.message ?? 'invalid session' }, { status: 401 });
  }

  const userId = userData.user.id;

  const { data: membership, error: membershipError } = await serviceClient
    .from('room_members')
    .select('user_id')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipError) {
    return NextResponse.json({ message: membershipError.message }, { status: 500 });
  }

  if (!membership) {
    return NextResponse.json({ message: 'not a member of this room' }, { status: 403 });
  }

  const { data, error } = await serviceClient
    .from('room_members')
    .select('user_id, username, joined_at')
    .eq('room_id', roomId)
    .order('joined_at', { ascending: true });

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({
    members: (data ?? []).map((row: MemberRow) => ({
      user_id: row.user_id,
      username: row.username,
      joined_at: row.joined_at,
    })),
  });
}
