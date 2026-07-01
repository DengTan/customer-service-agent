const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:tLk6MwE1qBEt55E57n@cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com:5432/postgres?sslmode=require&channel_binding=require'
});

async function restoreBots() {
  try {
    await client.connect();

    console.log('=== 恢复 Bot 架构 ===\n');

    // Bot ID
    const mainBotId = '00000000-0000-0000-0000-000000000001';
    const generalBotId = '00000000-0000-0000-0000-000000000002';

    // 1. 检查主 Bot 是否存在
    const mainBot = await client.query(`
      SELECT id FROM bot_configs WHERE id = $1
    `, [mainBotId]);

    if (mainBot.rows.length === 0) {
      console.log('1. 创建主 Bot (SmartAssist 智能客服)...');
      await client.query(`
        INSERT INTO bot_configs (id, name, description, system_prompt, tools, knowledge_ids, is_default, is_sub_agent, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      `, [
        mainBotId,
        'SmartAssist 智能客服',
        '默认智能客服 Bot，处理售前咨询、订单查询、物流跟踪、售后服务等常见问题',
        '你是 SmartAssist 智能客服助手。你需要：\n1. 礼貌、专业的回复\n2. 准确回答用户问题\n3. 遇到无法回答的问题时，引导转人工\n4. 积极主动地提供帮助',
        '[]',
        '[]',
        true,
        false,
        'active'
      ]);
      console.log('   ✅ 主 Bot 创建成功\n');
    } else {
      console.log('1. 主 Bot 已存在\n');
    }

    // 2. 创建"通用客服Bot"（用于存放三个专家子 Bot）
    console.log('2. 创建通用客服 Bot (父 Bot)...');
    const generalBot = await client.query(`
      SELECT id FROM bot_configs WHERE id = $1
    `, [generalBotId]);

    if (generalBot.rows.length === 0) {
      await client.query(`
        INSERT INTO bot_configs (id, name, description, system_prompt, tools, knowledge_ids, is_default, is_sub_agent, status, created_at, updated_at, parent_bot_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW(), $10)
      `, [
        generalBotId,
        '通用客服Bot',
        '通用客服 Bot，处理日常客户咨询，作为专家 Bot 的父级协调器',
        '你是通用客服 Bot。当用户提出具体问题时（如订单问题、退款问题、售后维权），你应该识别用户意图并将任务委派给对应的专家 Bot。\n\n可用的专家 Bot：\n- 订单处理专家：处理订单状态、订单修改等问题\n- 退款处理专家：处理退款申请、退款进度等问题\n- 售后维权专家：处理投诉、维权、差评处理等问题\n\n如果问题超出专家范围，再自行回复。',
        '[]',
        '[]',
        false,
        false,
        'active',
        mainBotId  // 父 Bot 指向主 Bot
      ]);
      console.log('   ✅ 通用客服 Bot 创建成功\n');
    } else {
      console.log('   (已存在)\n');
    }

    // 3. 创建三个专家子 Bot
    const subAgents = [
      {
        id: '00000000-0000-0000-0000-000000000003',
        name: '订单处理专家',
        description: '专注于订单相关问题处理',
        prompt: '你是订单处理专家，专注于处理以下问题：\n1. 订单状态查询（已付款、已发货、已收货等）\n2. 订单修改（收货地址、联系方式等）\n3. 订单取消\n4. 订单备注\n\n请使用订单查询工具获取信息，准确回答用户问题。'
      },
      {
        id: '00000000-0000-0000-0000-000000000004',
        name: '退款处理专家',
        description: '专注于退款相关问题处理',
        prompt: '你是退款处理专家，专注于处理以下问题：\n1. 退款申请流程\n2. 退款进度查询\n3. 退款金额计算\n4. 退款到账时间\n5. 部分退款/全额退款\n\n请使用退款查询工具获取信息，准确回答用户问题。'
      },
      {
        id: '00000000-0000-0000-0000-000000000005',
        name: '售后维权专家',
        description: '专注于售后和维权问题处理',
        prompt: '你是售后维权专家，专注于处理以下问题：\n1. 商品质量问题处理\n2. 退货退款流程\n3. 投诉建议受理\n4. 差评申诉处理\n5. 消费者权益保护\n\n请耐心倾听用户诉求，积极协调解决问题，维护消费者权益。'
      }
    ];

    console.log('3. 创建专家子 Bot...');
    for (const agent of subAgents) {
      const exists = await client.query(`
        SELECT id FROM bot_configs WHERE id = $1
      `, [agent.id]);

      if (exists.rows.length === 0) {
        await client.query(`
          INSERT INTO bot_configs (id, name, description, system_prompt, tools, knowledge_ids, is_default, is_sub_agent, status, created_at, updated_at, parent_bot_id, delegation_prompt)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW(), $10, $11)
        `, [
          agent.id,
          agent.name,
          agent.description,
          agent.prompt,
          '[]',
          '[]',
          false,
          true,  // is_sub_agent = true
          'active',
          generalBotId,  // 父 Bot 指向通用客服Bot
          `当用户询问与"${agent.name}"相关的问题时，自动委派给此 Bot 处理。`
        ]);
        console.log(`   ✅ ${agent.name} 创建成功`);
      } else {
        console.log(`   (${agent.name} 已存在)`);
      }
    }

    console.log('\n=== 验证结果 ===\n');
    const finalBots = await client.query(`
      SELECT id, name, is_sub_agent, parent_bot_id, status
      FROM bot_configs 
      ORDER BY is_sub_agent, name
    `);
    
    console.log(`Bot 总数: ${finalBots.rows.length}`);
    finalBots.rows.forEach((row, i) => {
      const indent = row.is_sub_agent ? '  └── ' : '';
      console.log(`${indent}${i + 1}. ${row.name}`);
      if (row.is_sub_agent) {
        console.log(`       parent: ${row.parent_bot_id}`);
      }
    });

    console.log('\n✅ Bot 架构恢复完成！请刷新页面。');

  } catch (e) {
    console.error('错误:', e.message);
  } finally {
    await client.end();
  }
}

restoreBots();
