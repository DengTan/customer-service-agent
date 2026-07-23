const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  // 查询最近的模拟测试会话
  const { data: conversations } = await supabase
    .from('simulation_conversations')
    .select('id, title, message_count, updated_at')
    .order('updated_at', { ascending: false })
    .limit(3);

  console.log('=== 最近 3 个模拟会话 ===');
  conversations.forEach(c => {
    console.log(c.id + ' - ' + c.title + ' (msg: ' + c.message_count + ')');
  });

  if (conversations && conversations.length > 0) {
    const latestConvId = conversations[0].id;
    console.log('\n=== 最新会话: ' + latestConvId + ' ===');

    const { data: messages } = await supabase
      .from('simulation_messages')
      .select('id, role, content, confidence, sources')
      .eq('conversation_id', latestConvId)
      .order('created_at', { ascending: true });

    messages.forEach((msg, idx) => {
      console.log('\n[' + (idx + 1) + '] ' + msg.role);
      console.log('内容: ' + (msg.content ? msg.content.substring(0, 150) : '(空)'));
      console.log('置信度: ' + msg.confidence);
      console.log('Sources: ' + JSON.stringify(msg.sources, null, 2));
    });
  }
})();