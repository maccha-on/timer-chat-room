// ↓ 追加（ビルド時の誤った最適化・Edge実行を避ける）
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// app/api/generate-topic/route.ts
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

// サーバー専用クライアント（service_role）
const supaAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // ← フロントに出さない
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    const { roomId, requesterId } = await req.json() as { roomId: string; requesterId: string };

    if (!roomId || !requesterId) {
      return NextResponse.json({ error: 'roomId/requesterId required' }, { status: 400 });
    }

    // 1) そのルームのメンバー一覧を取得
    const { data: members, error: memErr } = await supaAdmin
      .from('room_members')
      .select('user_id')
      .eq('room_id', roomId);

    if (memErr) throw memErr;
    if (!members || members.length < 2) {
      return NextResponse.json({ error: 'メンバーが2人以上必要です' }, { status: 400 });
    }

    // 2) お題を生成（大人がほぼ知っている一般名詞を1語、句読点なし）
    //    念のため複数生成→フィルタ→ランダムに1つ、でもまずは1つでOK
    const prompt = `日本語で、大人ならほとんどの人が知っている一般名詞を1語だけ出してください。
- 固有名詞や専門用語は避ける
- ひらがな・カタカナ・ごく一般的な漢字のみ
- 出力は単語のみ（記号、句読点、解説は不要）
例: りんご, バス, ねこ, 時計, 旅行, 料理`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // 速くて安価なモデル推奨（必要に応じて変更）
      messages: [
        { role: 'system', content: 'You are a helpful topic generator.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 10,
    });

    let topic = completion.choices[0]?.message?.content?.trim() || '';
    topic = topic.replace(/[^\p{L}\p{N}\u3000\u3040-\u30FF\u4E00-\u9FFF]/gu, ''); // 安全に余分を除去

    if (!topic) {
      return NextResponse.json({ error: 'お題生成に失敗しました' }, { status: 500 });
    }

    // 3) 役割を抽選（presenter 1人、insider 1人）
    const ids = members.map(m => m.user_id);
    const shuffled = ids.sort(() => Math.random() - 0.5);
    const presenter = shuffled[0];
    let insider = shuffled[1];
    if (!insider) insider = shuffled[0]; // 念のため（2人未満は前で弾いている）

    // 4) rounds を作成
    const { data: round, error: rErr } = await supaAdmin
      .from('rounds')
      .insert({ room_id: roomId, topic, created_by: requesterId })
      .select()
      .single();
    if (rErr || !round) throw rErr;

    // 5) round_roles を一括作成
    const rows = ids.map(uid => ({
      round_id: round.id,
      user_id: uid,
      role: uid === presenter ? 'presenter' : (uid === insider ? 'insider' : 'common'),
    }));

    const { error: rrErr } = await supaAdmin.from('round_roles').insert(rows);
    if (rrErr) throw rrErr;

    // リクエストユーザーの役割と、閲覧可否に応じたtopicを返す
    const myRole = rows.find(r => r.user_id === requesterId)?.role ?? 'common';
    const canSee = myRole === 'presenter' || myRole === 'insider';

    return NextResponse.json({
      roundId: round.id,
      myRole,
      topic: canSee ? topic : null,
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message ?? 'server error' }, { status: 500 });
  }
}
