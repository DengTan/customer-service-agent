/**
 * Playwright test script to reproduce the "AI正在回复..." stuck bug
 *
 * Bug description:
 * 1. Enter simulation page
 * 2. Send a message
 * 3. Wait for AI reply (3s)
 * 4. Switch to another page (e.g., /tickets)
 * 5. Return to simulation page
 * 6. Click on the original conversation
 * 7. Shows "AI正在回复..." forever (stuck)
 *
 * This test verifies whether loadMessages() gets called and correctly
 * updates isAIReplying to false after returning to the simulation page.
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';

const BASE_URL = 'http://localhost:5000';
const TEST_EMAIL = 'admin@smartassist.com';
const TEST_PASSWORD = 'Admin123456';

// Test configuration
const WAIT_FOR_AI_REPLY_MS = 5000;  // Wait for AI to start replying
const NAVIGATE_AWAY_SECONDS = 2;     // How long to stay on other page
const CHECK_STUCK_TIMEOUT_MS = 8000; // How long to wait for "AI正在回复..." to disappear

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function login(page: Page): Promise<void> {
  console.log('[Step 1] Navigating to login page...');
  await page.goto(`${BASE_URL}/login`);

  // Wait for page to load
  await page.waitForLoadState('networkidle');

  console.log('[Step 2] Filling login credentials...');
  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASSWORD);

  console.log('[Step 3] Clicking login button...');
  await page.click('button[type="submit"]');

  // Wait for redirect to main page
  await page.waitForURL('**/');
  console.log('[Step 4] Login successful, redirected to main page');
}

async function navigateToSimulation(page: Page): Promise<void> {
  console.log('[Step 5] Navigating to simulation page...');
  await page.goto(`${BASE_URL}/simulation`);
  await page.waitForLoadState('networkidle');
  console.log('[Step 6] On simulation page');
}

async function createNewConversation(page: Page): Promise<void> {
  console.log('[Step 7] Creating new conversation...');

  // Look for "新建会话" button
  const newConvButton = page.locator('button:has-text("新建会话")');
  await newConvButton.click();

  // Wait for conversation to be created
  await sleep(500);
  console.log('[Step 8] New conversation created');
}

async function sendTestMessage(page: Page): Promise<void> {
  console.log('[Step 9] Sending test message...');

  // Find the input textarea and type a message
  const input = page.locator('textarea[placeholder*="输入测试消息"]');
  await input.fill('你好，我想查询一下订单状态');

  // Click send button
  const sendButton = input.locator('xpath=ancestor::div[contains(@class, "flex items-center gap-2")]//button[.//svg]').last();
  await sendButton.click();

  console.log('[Step 10] Message sent, waiting for AI to start replying...');
}

async function waitForAIStartReplying(page: Page): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < WAIT_FOR_AI_REPLY_MS) {
    // Check for streaming content or "AI正在回复..." indicator
    const streamingContent = await page.locator('.animate-pulse').count();
    const aiThinking = await page.locator('text=AI 正在').count();
    const aiReplying = await page.locator('text=AI 正在回复').count();

    if (streamingContent > 0 || aiThinking > 0 || aiReplying > 0) {
      console.log('[Step 11] AI has started replying (detected streaming indicator)');
      return true;
    }

    await sleep(200);
  }

  console.log('[Step 11] Timeout waiting for AI to start replying');
  return false;
}

async function navigateAwayAndReturn(page: Page): Promise<void> {
  console.log('[Step 12] Navigating to tickets page (trigger unmount)...');
  await page.goto(`${BASE_URL}/tickets`);
  await page.waitForLoadState('networkidle');
  console.log(`[Step 13] Waiting ${NAVIGATE_AWAY_SECONDS} seconds...`);
  await sleep(NAVIGATE_AWAY_SECONDS * 1000);

  console.log('[Step 14] Returning to simulation page...');
  await page.goto(`${BASE_URL}/simulation`);
  await page.waitForLoadState('networkidle');
  console.log('[Step 15] Back on simulation page');
}

async function clickOriginalConversation(page: Page): Promise<void> {
  console.log('[Step 16] Looking for original conversation in the list...');

  // Wait for conversations to load
  await sleep(1000);

  // Find any conversation in the list and click it
  const conversations = page.locator('[class*="conv-item"]').first();
  const exists = await conversations.count();

  if (exists > 0) {
    await conversations.click();
    console.log('[Step 17] Clicked on conversation');
    await sleep(500);
  } else {
    console.log('[Step 17] WARNING: No conversations found in list');
  }
}

async function checkForStuckIndicator(page: Page): Promise<{ stuck: boolean; duration: number; details: string }> {
  console.log('[Step 18] Checking if "AI正在回复..." indicator is stuck...');

  const startTime = Date.now();

  while (Date.now() - startTime < CHECK_STUCK_TIMEOUT_MS) {
    // Check if "AI正在回复..." indicator exists
    const aiReplyingIndicator = await page.locator('text=AI 正在回复').count();
    const streamingIndicator = await page.locator('.animate-pulse').count();
    const aiThinking = await page.locator('text=AI 正在思考').count();

    // Check if there's an assistant message (AI has replied)
    const assistantMessages = await page.locator('[class*="bg-muted"]').filter({ hasText: /^(?!.*(?:输入|测试|脚本)).*$/ }).count();

    const duration = Date.now() - startTime;

    console.log(`  - Checking... (${Math.round(duration / 1000)}s elapsed)`);
    console.log(`    - AI正在回复 indicator: ${aiReplyingIndicator}`);
    console.log(`    - Streaming (pulse): ${streamingIndicator}`);
    console.log(`    - AI正在思考: ${aiThinking}`);
    console.log(`    - Assistant messages: ${assistantMessages}`);

    // If AI is replying but no actual assistant message content, it's stuck
    if (aiReplyingIndicator > 0 && assistantMessages === 0) {
      await sleep(1000); // Wait a bit more to confirm it's stuck
      const stillStuck = await page.locator('text=AI 正在回复').count();
      if (stillStuck > 0) {
        return {
          stuck: true,
          duration,
          details: `"AI正在回复..." indicator still showing after ${duration}ms with no actual AI response content`
        };
      }
    }

    // If we see streaming or AI thinking, AI is still working
    if (streamingIndicator > 0 || aiThinking > 0) {
      console.log('    - AI is actively processing...');
      await sleep(500);
      continue;
    }

    // If AI has replied (we see assistant message content) and no "AI正在回复", bug is NOT reproduced
    if (assistantMessages > 0 && aiReplyingIndicator === 0) {
      console.log(`[Step 19] AI has finished replying normally (bug NOT reproduced)`);
      return {
        stuck: false,
        duration,
        details: `AI replied successfully in ${duration}ms`
      };
    }

    await sleep(500);
  }

  const finalDuration = Date.now() - startTime;
  const finalAiReplying = await page.locator('text=AI 正在回复').count();
  const finalAssistant = await page.locator('[class*="bg-muted"]').count();

  if (finalAiReplying > 0 && finalAssistant === 0) {
    return {
      stuck: true,
      duration: finalDuration,
      details: `"AI正在回复..." indicator stuck for ${finalDuration}ms with no AI response`
    };
  }

  return {
    stuck: false,
    duration: finalDuration,
    details: `Check completed after ${finalDuration}ms`
  };
}

async function getDebugInfo(page: Page): Promise<Record<string, unknown>> {
  try {
    // Get current URL
    const url = page.url();

    // Get page title
    const title = await page.title();

    // Count various elements
    const conversationItems = await page.locator('[class*="conv-item"]').count();
    const userMessages = await page.locator('[class*="bg-primary"]:has-text("你好")').count();
    const assistantMessages = await page.locator('.bg-muted:not([class*="bg-primary"])').count();
    const aiReplying = await page.locator('text=AI 正在回复').count();
    const aiThinking = await page.locator('text=AI 正在思考').count();

    // Get sessionStorage to check polling state
    const pollingStates = await page.evaluate(() => {
      const keys = Object.keys(sessionStorage).filter(k => k.startsWith('sim_poll'));
      const states: Record<string, unknown> = {};
      for (const key of keys) {
        try {
          states[key] = JSON.parse(sessionStorage.getItem(key) || '{}');
        } catch {
          states[key] = sessionStorage.getItem(key);
        }
      }
      return states;
    });

    return {
      url,
      title,
      conversationItems,
      userMessages,
      assistantMessages,
      aiReplying,
      aiThinking,
      pollingStates,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      error: String(error),
      timestamp: new Date().toISOString()
    };
  }
}

async function runTest(): Promise<{
  success: boolean;
  bugReproduced: boolean;
  details: string;
  duration: number;
  debugInfo: Record<string, unknown>;
}> {
  const startTime = Date.now();
  let browser: Browser | null = null;

  console.log('='.repeat(60));
  console.log('AI Stuck Bug Reproduction Test');
  console.log('='.repeat(60));
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log('');

  try {
    // Launch browser
    console.log('Launching browser...');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });

    const page = await context.newPage();

    // Enable console logging from the page
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`[Browser Console Error]: ${msg.text()}`);
      }
    });

    // Navigate and login
    await login(page);

    // Navigate to simulation
    await navigateToSimulation(page);

    // Create new conversation
    await createNewConversation(page);

    // Send test message
    await sendTestMessage(page);

    // Wait for AI to start replying
    const aiStarted = await waitForAIStartReplying(page);
    if (!aiStarted) {
      console.log('WARNING: Could not detect AI starting to reply, continuing anyway...');
    }

    // Wait a bit more for AI to potentially finish
    console.log('[Step 11b] Waiting additional 3 seconds for AI to potentially finish...');
    await sleep(3000);

    // Navigate away and return
    await navigateAwayAndReturn(page);

    // Click on the conversation
    await clickOriginalConversation(page);

    // Check for stuck indicator
    const { stuck, duration, details } = await checkForStuckIndicator(page);

    // Get debug info
    const debugInfo = await getDebugInfo(page);

    const totalDuration = Date.now() - startTime;

    console.log('');
    console.log('='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));
    console.log(`Total Duration: ${totalDuration}ms`);
    console.log(`Bug Reproduced: ${stuck ? 'YES ❌' : 'NO ✅'}`);
    console.log(`Details: ${details}`);
    console.log('');
    console.log('Debug Info:');
    console.log(JSON.stringify(debugInfo, null, 2));
    console.log('='.repeat(60));

    return {
      success: true,
      bugReproduced: stuck,
      details,
      duration: totalDuration,
      debugInfo
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Test failed with error:', errorMessage);
    console.error(error);

    return {
      success: false,
      bugReproduced: false,
      details: `Test error: ${errorMessage}`,
      duration: Date.now() - startTime,
      debugInfo: { error: errorMessage }
    };

  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Run the test
runTest()
  .then(result => {
    console.log('\nTest completed!');
    console.log('Result:', JSON.stringify(result, null, 2));

    // Exit with appropriate code
    process.exit(result.bugReproduced ? 1 : 0);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(2);
  });
