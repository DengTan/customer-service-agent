#!/usr/bin/env python
"""
测试 Ollama Rerank 服务的完整流程
"""
import requests
import json

BASE_URL = "http://localhost:8001"

def test_rerank():
    print("=" * 50)
    print("测试 Ollama Embedding Rerank 服务")
    print("=" * 50)
    
    # 1. 健康检查
    resp = requests.get(f"{BASE_URL}/health")
    print(f"\n1. 健康检查: {resp.json()}")
    
    # 2. 测试 rerank
    payload = {
        "query": "如何退货",
        "documents": [
            "我们的退货政策是7天无理由退货，需要保留原包装",
            "全场包邮，满99元免运费",
            "尺码表：S码适合身高155-160cm",
            "客服工作时间：周一至周五 9:00-18:00",
            "退款会在3-5个工作日内退回原支付账户"
        ]
    }
    
    print(f"\n2. 测试查询: {payload['query']}")
    print(f"   文档数量: {len(payload['documents'])}")
    
    resp = requests.post(f"{BASE_URL}/rerank", json=payload)
    results = resp.json()["results"]
    
    print(f"\n3. 排序结果 (按相关性分数):")
    print("-" * 50)
    for i, r in enumerate(results, 1):
        doc_preview = r["text"][:30] + "..." if len(r["text"]) > 30 else r["text"]
        print(f"   #{i} [分数: {r['score']:.4f}] {doc_preview}")
    
    # 3. 验证结果
    print(f"\n4. 验证:")
    print(f"   - 退货相关文档排第1: {'✓' if results[0]['index'] == 0 else '✗'}")
    print(f"   - 包邮相关排第2: {'✓' if results[1]['index'] == 1 else '✗'}")
    print(f"   - 尺码相关排最后: {'✓' if results[-1]['index'] == 2 else '✗'}")
    
    print("\n" + "=" * 50)
    print("测试完成！")
    print("=" * 50)

if __name__ == "__main__":
    test_rerank()
