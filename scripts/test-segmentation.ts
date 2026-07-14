#!/usr/bin/env tsx

/**
 * Test script for LLM Smart Segmentation Feature
 * 
 * This script tests the segmentWithLLM function from text-chunker.ts
 * and verifies the LLM integration with Ollama.
 */

import { segmentWithLLM, chunkText } from '../src/server/services/text-chunker';
import { logger } from '../src/lib/logger';

// Sample Chinese document text (~500 chars, multi-paragraph policy document)
const SAMPLE_POLICY_TEXT = `售后服务政策

一、退货政策

自收到商品之日起7天内，如对商品不满意，可以申请退货。退货时需确保商品及包装完好无损，包括所有配件、说明书和发票。退货申请审核通过后，我们将在3个工作日内完成退款操作，退款将原路返回至您的支付账户。

如因商品质量问题导致退货，退货运费由我方承担；如因个人原因（非质量问题）退货，退货运费需由您自行承担。请在退货前联系客服获取退货运单。

二、换货政策

自收到商品之日起15天内，如需要更换同款商品的不同尺寸或颜色，可申请换货。换货时需确保商品未经使用、吊牌完整。换货申请审核通过后，我们将在5个工作日内安排发出新商品，并回收原商品。

定制商品、特价商品以及贴身衣物（如内衣、袜子等）不支持换货。尺码不合身的情况建议在购买前参考尺码表或咨询客服。

三、保修服务

自购买之日起一年内，商品因非人为损坏出现的质量问题享受免费保修服务。保修范围包括：电机故障、外壳破裂（非人为撞击）、显示屏异常等。

申请保修时，请提供购买凭证（发票或订单截图）和商品照片。保修申请审核通过后，我们将安排免费维修或更换同款商品。如需寄送商品，请使用我们提供的保修专用快递单，运费由我方承担。

保修期内因人为损坏（如摔落、进水、私自拆修等）导致的故障，不在保修范围内，我们将提供付费维修服务。

四、VIP会员专属服务

黄金会员可享受30天无理由退换货服务，白金会员可享受全年无限次退换货服务。VIP会员还可享受专属客服通道、优先发货、免费礼品包装等特权。

如有任何疑问，请随时联系我们的在线客服，或拨打客服热线：400-888-8888。`;

async function main() {
  console.log('='.repeat(60));
  console.log('LLM Smart Segmentation Test');
  console.log('='.repeat(60));
  console.log();

  // Test 1: Check Ollama status
  console.log('[Test 1] Checking Ollama Status...');
  try {
    const ollamaResponse = await fetch('http://localhost:11434/api/tags');
    if (ollamaResponse.ok) {
      const data = await ollamaResponse.json();
      console.log('✅ Ollama is running!');
      console.log('   Available models:', data.models?.map((m: { name: string }) => m.name).join(', ') || 'none');
    } else {
      console.log('❌ Ollama responded with status:', ollamaResponse.status);
    }
  } catch (error) {
    console.log('❌ Ollama is NOT running or not accessible');
    console.log('   Error:', error instanceof Error ? error.message : String(error));
  }
  console.log();

  // Test 2: Run LLM segmentation
  console.log('[Test 2] Testing segmentWithLLM...');
  console.log('-'.repeat(40));
  console.log(`Input text length: ${SAMPLE_POLICY_TEXT.length} characters`);
  console.log(`Input text preview:\n${SAMPLE_POLICY_TEXT.substring(0, 200)}...`);
  console.log('-'.repeat(40));
  console.log();

  try {
    const startTime = Date.now();
    const llmChunks = await segmentWithLLM(SAMPLE_POLICY_TEXT);
    const elapsed = Date.now() - startTime;

    console.log(`✅ LLM segmentation completed in ${elapsed}ms`);
    console.log(`   Chunks returned: ${llmChunks.length}`);
    console.log();

    if (llmChunks.length > 0) {
      console.log('LLM Chunks:');
      llmChunks.forEach((chunk, i) => {
        console.log(`  [Chunk ${i}] Length: ${chunk.content.length} chars`);
        console.log(`            Hash: ${chunk.content_hash.substring(0, 16)}...`);
        console.log(`            Preview: ${chunk.content.substring(0, 100).replace(/\n/g, ' ')}...`);
        console.log();
      });
    } else {
      console.log('⚠️  LLM returned 0 chunks - may have fallen back to rule-based chunking');
    }
  } catch (error) {
    console.log('❌ LLM segmentation failed with error:');
    console.log('   ', error instanceof Error ? error.message : String(error));
    console.log();
  }

  // Test 3: Compare with rule-based chunking (as fallback)
  console.log('[Test 3] Rule-Based Chunking (for comparison)...');
  console.log('-'.repeat(40));
  try {
    const ruleChunks = chunkText(SAMPLE_POLICY_TEXT);
    console.log(`Rule-based chunks: ${ruleChunks.length}`);
    ruleChunks.forEach((chunk, i) => {
      console.log(`  [Chunk ${i}] Length: ${chunk.content.length} chars`);
      console.log(`            Preview: ${chunk.content.substring(0, 80).replace(/\n/g, ' ')}...`);
    });
  } catch (error) {
    console.log('Rule-based chunking also failed:', error instanceof Error ? error.message : String(error));
  }
  console.log();

  // Summary
  console.log('='.repeat(60));
  console.log('Test Summary:');
  console.log('='.repeat(60));
  console.log(`- Input text: ${SAMPLE_POLICY_TEXT.length} characters`);
  console.log(`- Document sections: 4 (退货政策, 换货政策, 保修服务, VIP会员专属服务)`);
  console.log('- Expected: LLM should identify semantic boundaries and return ~3-4 chunks');
  console.log('- Fallback: If LLM fails, should fall back to rule-based chunking');
  console.log('='.repeat(60));
}

main().catch(console.error);
