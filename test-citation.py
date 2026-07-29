#!/usr/bin/env python
"""
测试引用溯源流程
"""
import requests
import json

BASE_URL = "http://localhost:5000"

def test_citation_flow():
    print("=" * 60)
    print("Testing Citation Flow")
    print("=" * 60)
    
    # 1. Login
    print("\n1. Login...")
    session = requests.Session()
    login_resp = session.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "admin@smartassist.com", "password": "Admin123456"}
    )
    if login_resp.status_code != 200:
        print(f"   Login failed: {login_resp.status_code}")
        return
    print("   Login OK")
    
    # 2. Create conversation
    print("\n2. Create conversation...")
    conv_resp = session.post(
        f"{BASE_URL}/api/conversations",
        json={"title": "Test Citation", "source": "web"}
    )
    if conv_resp.status_code not in [200, 201]:
        print(f"   Create failed: {conv_resp.status_code} - {conv_resp.text[:200]}")
        return
    conv_data = conv_resp.json()
    conv_id = conv_data.get("conversation", {}).get("id")
    if not conv_id:
        conv_id = conv_data.get("id")
    if not conv_id:
        print(f"   Cannot get conversation ID: {json.dumps(conv_data, ensure_ascii=False)[:200]}")
        return
    print(f"   Conversation ID: {conv_id}")
    
    # 3. Send message
    print("\n3. Sending message...")
    print("   Query: 退货政策是什么？")
    
    stream_resp = session.post(
        f"{BASE_URL}/api/conversations/{conv_id}/messages",
        json={"content": "退货政策是什么？"},
        stream=True,
        headers={"Accept": "text/event-stream"}
    )
    
    if stream_resp.status_code != 200:
        print(f"   Send failed: {stream_resp.status_code}")
        return
    
    print("\n4. Parsing SSE stream...")
    sources_found = False
    confidence = None
    full_content = ""
    raw_output = []
    
    for line in stream_resp.iter_lines(decode_unicode=False):
        if line:
            try:
                line_text = line.decode('utf-8')
                if line_text.startswith("data: "):
                    raw_output.append(line_text)
                    try:
                        data = json.loads(line_text[6:])
                        if data.get("content"):
                            full_content += data["content"]
                        if data.get("done"):
                            sources = data.get("sources", [])
                            confidence = data.get("confidence")
                            print(f"   Done")
                            print(f"   Confidence: {confidence}")
                            print(f"   Sources count: {len(sources)}")
                            content_preview = full_content[:100] + "..." if len(full_content) > 100 else full_content
                            print(f"   Response: {content_preview}")
                            
                            if sources:
                                sources_found = True
                                print("\n5. Sources details:")
                                for i, src in enumerate(sources, 1):
                                    name = src.get('name', 'N/A')[:30] if src.get('name') else 'N/A'
                                    print(f"   #{i}: type={src.get('type')}, name={name}")
                                    print(f"       score={src.get('score', 'N/A')}")
                            else:
                                print("\n   WARNING: No sources!")
                    except json.JSONDecodeError as e:
                        print(f"   JSON parse error: {e}")
                        if len(raw_output) <= 5:
                            print(f"   Raw: {line_text[:100]}")
            except Exception as e:
                print(f"   Error: {e}")
    
    if not raw_output:
        print("   No SSE data received!")
    
    print("\n" + "=" * 60)
    if sources_found:
        print("SUCCESS: Citation trace is working!")
    else:
        print("FAIL: Citation trace NOT working")
    print("=" * 60)

if __name__ == "__main__":
    test_citation_flow()
