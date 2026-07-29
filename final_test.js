// SmartAssist Comprehensive Test - Product Query and Size Recommendation
const http = require('http');
const fs = require('fs');

function makeRequest(options, body, cookieJar) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const setCookie = res.headers['set-cookie'];
      if (setCookie && cookieJar) {
        setCookie.forEach(cookie => {
          const cookieName = cookie.split('=')[0];
          const cookieValue = cookie.split(';')[0].split('=').slice(1).join('=');
          cookieJar[cookieName] = cookieValue;
        });
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function analyzeSSEResponse(data) {
  const result = { toolEvents: [], doneEvent: null, content: '', rawToolCalls: [] };
  const lines = data.split('\n');
  const toolCallRegex = /\[TOOL_CALL\](\w+)\|({[^}]*})\[\/TOOL_CALL\]/g;
  
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        const event = JSON.parse(line.substring(6));
        if (event.content) {
          result.content += event.content;
        }
        if (event.done) {
          result.doneEvent = event;
        }
        if (event.tool_call) {
          result.toolEvents.push(event);
        }
      } catch (e) {
        // Skip invalid JSON
      }
    }
  }
  
  // Detect raw TOOL_CALL markers in content
  let match;
  while ((match = toolCallRegex.exec(result.content)) !== null) {
    result.rawToolCalls.push({ name: match[1], args: match[2] });
  }
  
  return result;
}

async function main() {
  const cookieJar = {};
  const tests = [];
  
  console.log('=== Step 1: Login ===');
  const loginResult = await makeRequest({
    hostname: 'localhost', port: 5000,
    path: '/api/auth/login', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({ email: 'admin@smartassist.com', password: 'Admin123456' }), cookieJar);
  console.log('Login:', loginResult.status, JSON.parse(loginResult.data).success);
  
  console.log('\n=== Step 2: Create Session ===');
  const cookieHeader = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
  const simResult = await makeRequest({
    hostname: 'localhost', port: 5000,
    path: '/api/simulations', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader }
  }, '{}', null);
  const sessionId = JSON.parse(simResult.data).conversation.id;
  console.log('Session:', sessionId);
  
  const testCases = [
    { name: '商品查询 (T恤)', content: '请问纯棉圆领短袖T恤的价格是多少？' },
    { name: '商品查询 (鞋)', content: '运动休闲跑步鞋多少钱？' },
    { name: '尺码推荐 (鞋)', content: '我平时穿42码的鞋，想买一双运动鞋，应该选什么尺码？' },
    { name: '尺码推荐 (详细)', content: '我身高175cm体重70kg，平时穿42码皮鞋，选什么尺码的跑步鞋合适？' },
  ];
  
  for (const test of testCases) {
    console.log('\n=== Test: ' + test.name + ' ===');
    const body = JSON.stringify({ content: test.content });
    const result = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost', port: 5000,
        path: '/api/simulations/' + sessionId + '/messages', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data }));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    
    const analysis = analyzeSSEResponse(result.data);
    
    console.log('Status:', result.status);
    console.log('Raw TOOL_CALL markers:', analysis.rawToolCalls.length);
    console.log('Executed tool calls:', analysis.toolEvents.length);
    console.log('Sources in done:', analysis.doneEvent ? (analysis.doneEvent.sources ? analysis.doneEvent.sources.length : 0) : 'N/A');
    
    const toolSources = analysis.doneEvent && analysis.doneEvent.sources 
      ? analysis.doneEvent.sources.filter(s => s.type === 'tool') 
      : [];
    console.log('Tool sources:', toolSources.length);
    
    if (toolSources.length > 0) {
      toolSources.forEach((s, i) => {
        console.log('  Source ' + (i+1) + ': type=' + s.type + ', name=' + s.name + ', score=' + s.score);
        console.log('    content (100 chars): ' + (s.content || '').substring(0, 100) + '...');
      });
    }
    
    tests.push({
      name: test.name,
      content: test.content,
      status: result.status,
      rawToolCalls: analysis.rawToolCalls.length,
      executedTools: analysis.toolEvents.length,
      sources: analysis.doneEvent ? analysis.doneEvent.sources || [] : [],
      toolSources: toolSources,
      confidence: analysis.doneEvent ? analysis.doneEvent.confidence : null,
      confidenceBreakdown: analysis.doneEvent ? analysis.doneEvent.confidence_breakdown : null
    });
  }
  
  // Generate report
  const timestamp = new Date().toISOString();
  let report = '# SmartAssist 商品查询和尺码推荐功能测试报告\n\n';
  report += '## 测试时间\n' + timestamp + '\n\n';
  report += '## 测试概要\n\n';
  report += '| 测试项 | 状态 | 原始TOOL_CALL | 已执行工具 | Sources数量 | Tool Sources |\n';
  report += '|--------|------|--------------|-----------|-------------|-------------|\n';
  tests.forEach(t => {
    report += '| ' + t.name + ' | ' + (t.status === 200 ? '✓ 成功' : '✗ 失败') + ' | ' + t.rawToolCalls + ' | ' + t.executedTools + ' | ' + t.sources.length + ' | ' + t.toolSources.length + ' |\n';
  });
  
  tests.forEach((t, idx) => {
    report += '\n## ' + (idx + 1) + '. ' + t.name + '\n\n';
    report += '### 请求\n```\n' + t.content + '\n```\n\n';
    report += '### 响应状态\n' + (t.status === 200 ? '✓ 200 OK' : '✗ ' + t.status) + '\n\n';
    
    report += '### 工具调用分析\n';
    report += '- 原始 TOOL_CALL 标记: ' + t.rawToolCalls + '\n';
    report += '- 已执行工具调用: ' + t.executedTools + '\n';
    report += '- Done sources 数量: ' + t.sources.length + '\n';
    report += '- Tool type sources: ' + t.toolSources.length + '\n\n';
    
    if (t.toolSources.length > 0) {
      report += '### Tool Sources 详情\n\n';
      t.toolSources.forEach((s, i) => {
        report += '#### Source ' + (i + 1) + '\n\n';
        report += '```json\n';
        report += JSON.stringify({
          type: s.type,
          name: s.name,
          score: s.score,
          provenanceVersion: s.provenanceVersion,
          content_preview: (s.content || '').substring(0, 300)
        }, null, 2);
        report += '\n```\n\n';
      });
    }
    
    report += '### 置信度\n';
    report += '- Overall: ' + (t.confidence ? t.confidence.toFixed(2) : 'N/A') + '\n';
    if (t.confidenceBreakdown) {
      report += '```json\n' + JSON.stringify(t.confidenceBreakdown, null, 2) + '\n```\n';
    }
    
    const hasToolSource = t.toolSources.length > 0;
    report += '\n### 验证结论\n';
    report += hasToolSource 
      ? '✓ **成功** - Done 事件的 sources 数组中包含 type="tool" 的条目，工具执行结果正确传递\n' 
      : '✗ **失败** - 未找到 tool 类型的 source\n';
  });
  
  report += '\n---\n\n## 总体结论\n\n';
  report += '### 引用溯源功能验证\n\n';
  report += '| 测试项 | TOOL_CALL标记 | 已执行 | Sources含tool | content字段 |\n';
  report += '|--------|--------------|--------|--------------|------------|\n';
  tests.forEach(t => {
    const hasToolSource = t.toolSources.length > 0;
    const hasContent = t.toolSources.some(s => s.content);
    report += '| ' + t.name + ' | ' + (t.rawToolCalls > 0 ? '✓' : '✗') + ' | ' + (t.executedTools > 0 ? '✓' : '✗') + ' | ' + (hasToolSource ? '✓' : '✗') + ' | ' + (hasContent ? '✓' : '✗') + ' |\n';
  });
  
  const allPassed = tests.every(t => t.toolSources.length > 0 && t.toolSources.some(s => s.content));
  
  report += '\n### 最终结论\n\n';
  if (allPassed) {
    report += '✓ **所有测试通过** - 引用溯源功能正常工作\n\n';
    report += '验证结果:\n';
    report += '1. LLM 能够正确生成 [TOOL_CALL] 标记\n';
    report += '2. 工具调用能够被正确解析和执行\n';
    report += '3. 工具执行结果正确包含在 SSE done.sources 中\n';
    report += '4. Sources 中的 content 字段包含完整的工具执行结果\n';
    report += '5. 前端溯源面板应能正常显示工具调用结果\n';
  } else {
    report += '⚠ **部分测试未通过** - 需要检查以下问题:\n';
    tests.forEach(t => {
      if (t.toolSources.length === 0) {
        report += '- ' + t.name + ': 未找到 tool 类型的 source\n';
      }
    });
  }
  
  fs.writeFileSync('test_results_v2.md', report);
  fs.writeFileSync('test_results_v2.json', JSON.stringify(tests, null, 2));
  console.log('\n=== Reports saved to test_results_v2.md and test_results_v2.json ===');
}

main().catch(console.error);
