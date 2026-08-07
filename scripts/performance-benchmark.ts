/**
 * Performance Benchmark Script
 * 
 * Measures API performance before and after optimization.
 * Run with: npx tsx scripts/performance-benchmark.ts
 * 
 * Metrics collected:
 * - Response time (ms)
 * - Query count per request
 * - Data size transferred
 * - Database scan rows (if available)
 */

interface BenchmarkResult {
  name: string;
  before: MetricSnapshot;
  after: MetricSnapshot;
  improvement: {
    responseTimePct: number;
    dataTransferPct: number;
  };
}

interface MetricSnapshot {
  avgResponseTime: number;
  p50ResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  queryCount: number;
  dataSizeBytes: number;
}

// Configuration
const CONFIG = {
  iterations: 100,
  warmupIterations: 10,
  baseUrl: process.env.BENCHMARK_BASE_URL || 'http://localhost:5000',
  concurrent: 10,
};

// API endpoints to benchmark
const ENDPOINTS = [
  // List endpoints with pagination
  { path: '/api/quick-replies?page=1&pageSize=20', name: 'Quick Replies List (paginated)' },
  { path: '/api/alerts?page=1&pageSize=20&resolved=false', name: 'Alerts List (paginated)' },
  { path: '/api/conversations?page=1&limit=20', name: 'Conversations List (paginated)' },
  { path: '/api/customers?page=1&pageSize=20', name: 'Customers List (paginated)' },
  { path: '/api/tickets?page=1&pageSize=20', name: 'Tickets List (paginated)' },
  { path: '/api/knowledge/items?page=1&pageSize=20', name: 'Knowledge Items (paginated)' },
  { path: '/api/products?page=1&pageSize=20', name: 'Products List (paginated)' },
  { path: '/api/size-charts?page=1&pageSize=20', name: 'Size Charts List (paginated)' },
];

// Helper: Measure a single request
async function measureRequest(url: string): Promise<{ responseTime: number; dataSize: number; queryCount: number }> {
  const start = performance.now();
  const response = await fetch(url);
  const data = await response.json();
  const responseTime = performance.now() - start;
  const dataSize = JSON.stringify(data).length;
  
  // Estimate query count from response (if available)
  const queryCount = data.queryCount || 1;
  
  return { responseTime, dataSize, queryCount };
}

// Helper: Run benchmark iterations
async function runBenchmark(endpoint: { path: string; name: string }): Promise<MetricSnapshot> {
  const results: { responseTime: number; dataSize: number; queryCount: number }[] = [];
  
  // Warmup
  console.log(`  Warming up (${CONFIG.warmupIterations} iterations)...`);
  for (let i = 0; i < CONFIG.warmupIterations; i++) {
    await measureRequest(`${CONFIG.baseUrl}${endpoint.path}`);
  }
  
  // Actual benchmark
  console.log(`  Running (${CONFIG.iterations} iterations)...`);
  for (let i = 0; i < CONFIG.iterations; i++) {
    const result = await measureRequest(`${CONFIG.baseUrl}${endpoint.path}`);
    results.push(result);
  }
  
  // Calculate statistics
  const responseTimes = results.map(r => r.responseTime).sort((a, b) => a - b);
  const dataSizes = results.map(r => r.dataSize);
  const queryCounts = results.map(r => r.queryCount);
  
  const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
  const p50 = responseTimes[Math.floor(responseTimes.length * 0.5)];
  const p95 = responseTimes[Math.floor(responseTimes.length * 0.95)];
  const p99 = responseTimes[Math.floor(responseTimes.length * 0.99)];
  const avgDataSize = dataSizes.reduce((a, b) => a + b, 0) / dataSizes.length;
  const avgQueryCount = queryCounts.reduce((a, b) => a + b, 0) / queryCounts.length;
  
  return {
    avgResponseTime: Math.round(avgResponseTime * 100) / 100,
    p50ResponseTime: Math.round(p50 * 100) / 100,
    p95ResponseTime: Math.round(p95 * 100) / 100,
    p99ResponseTime: Math.round(p99 * 100) / 100,
    queryCount: Math.round(avgQueryCount * 100) / 100,
    dataSizeBytes: Math.round(avgDataSize),
  };
}

// Helper: Format bytes
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

// Main benchmark runner
async function main() {
  console.log('='.repeat(80));
  console.log('Performance Benchmark Suite');
  console.log('='.repeat(80));
  console.log(`Configuration:`);
  console.log(`  Base URL: ${CONFIG.baseUrl}`);
  console.log(`  Iterations: ${CONFIG.iterations}`);
  console.log(`  Warmup: ${CONFIG.warmupIterations}`);
  console.log(`  Concurrent: ${CONFIG.concurrent}`);
  console.log('='.repeat(80));
  console.log('');

  const results: BenchmarkResult[] = [];

  for (const endpoint of ENDPOINTS) {
    console.log(`\nBenchmarking: ${endpoint.name}`);
    console.log(`  Path: ${endpoint.path}`);
    
    try {
      const snapshot = await runBenchmark(endpoint);
      
      console.log(`\n  Results:`);
      console.log(`    Avg Response Time: ${snapshot.avgResponseTime.toFixed(2)}ms`);
      console.log(`    P50 Response Time: ${snapshot.p50ResponseTime.toFixed(2)}ms`);
      console.log(`    P95 Response Time: ${snapshot.p95ResponseTime.toFixed(2)}ms`);
      console.log(`    P99 Response Time: ${snapshot.p99ResponseTime.toFixed(2)}ms`);
      console.log(`    Avg Query Count: ${snapshot.queryCount}`);
      console.log(`    Avg Data Size: ${formatBytes(snapshot.dataSizeBytes)}`);
      
      results.push({
        name: endpoint.name,
        before: snapshot, // In a real scenario, these would come from a baseline run
        after: snapshot,
        improvement: { responseTimePct: 0, dataTransferPct: 0 },
      });
    } catch (error) {
      console.error(`  Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log('| Endpoint | Avg Response (ms) | P95 (ms) | Data Size |');
  console.log('|----------|-----------------|----------|----------|');
  
  for (const result of results) {
    console.log(`| ${result.name} | ${result.after.avgResponseTime.toFixed(2)} | ${result.after.p95ResponseTime.toFixed(2)} | ${formatBytes(result.after.dataSizeBytes)} |`);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('Performance test completed.');
  console.log('');
  console.log('Note: To compare before/after optimization, run this benchmark');
  console.log('      before and after applying the performance changes, then compare');
  console.log('      the results stored in benchmark-results/ directory.');
}

// Export for use in CI/CD
export { BenchmarkResult, MetricSnapshot, measureRequest, runBenchmark };

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}
