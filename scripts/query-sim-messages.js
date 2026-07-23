const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const { data: conversations, error: convErr } = await supabase
    .from('simulation_conversations')
    .select('id, title, bot_name, message_count, ai_processing, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(5);

  if (convErr) {
    console.error('查询会话失败:', convErr);
    return;
  }

  console.log('=== 最近 5 个模拟会话 ===');
  console.log(JSON.stringify(conversations, null, 2));

  if (conversations && conversations.length > 0) {
    const latestConvId = conversations[0].id;
    console.log('\n=== 最新会话: ' + latestConvId + ' 的消息 ===');

    const { data: messages, error: msgErr } = await supabase
      .from('simulation_messages')
      .select('id, role, content, confidence, sources, created_at')
      .eq('conversation_id', latestConvId)
      .order('created_at', { ascending: true });

    if (msgErr) {
      console.error('查询消息失败:', msgErr);
      return;
    }

    messages.forEach((msg, idx) => {
      console.log('\n[' + (idx + 1) + '] ' + msg.role + ' (' + msg.created_at + ')');
      console.log('内容: ' + (msg.content ? msg.content.substring(0, 200) : '(空)'));
      console.log('置信度: ' + msg.confidence);
      console.log('引用数: ' + (msg.sources ? msg.sources.length : 0));
    });
  }
})();