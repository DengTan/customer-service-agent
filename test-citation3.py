#!/usr/bin/env python3
"""Test citation flow"""
import subprocess
import json
import os

BASE_URL = "http://localhost:5000"

def curl_post_json(url, data, cookies=None):
    """Use subprocess to call curl"""
    cmd = [
        "curl", "-s", "-X", "POST", url,
        "-H", "Content-Type: application/json"
    ]
    if cookies:
        cmd.extend(["-b", cookies, "-c", cookies])
    cmd.extend(["-d", json.dumps(data)])
    result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
    return result.stdout

def curl_post_stream(url, data, cookies=None):
    """Use subprocess to call curl for SSE"""
    cmd = [
        "curl", "-s", "-N", "-X", "POST", url,
        "-H", "Content-Type: application/json",
        "-H", "Accept: text/event-stream"
    ]
    if cookies:
        cmd.extend(["-b", cookies, "-c", cookies])
    cmd.extend(["-d", json.dumps(data)])
    result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', timeout=30)
    return result.stdout

def main():
    print("Testing Citation Flow")
    print("=" * 60)
    
    cookies_file = "test_cookies.txt"
    
    # 1. Login
    print("\n1. Login...")
    try:
        resp = curl_post_json(
            f"{BASE_URL}/api/auth/login",
            {"email": "admin@smartassist.com", "password": "Admin123456"},
            cookies=cookies_file
        )
        data = json.loads(resp)
        if not data.get("success"):
            print(f"   Login failed: {resp[:200]}")
            return
        print("   Login OK")
    except Exception as e:
        print(f"   Error: {e}")
        return
    
    # 2. Create conversation
    print("\n2. Create conversation...")
    try:
        resp = curl_post_json(
            f"{BASE_URL}/api/conversations",
            {"title": "test", "source": "web"},
            cookies=cookies_file
        )
        data = json.loads(resp)
        conv_id = data.get("conversation", {}).get("id") or data.get("id")
        if not conv_id:
            print(f"   Failed to get conv_id: {resp[:200]}")
            return
        print(f"   Conv ID: {conv_id}")
    except Exception as e:
        print(f"   Error: {e}")
        return
    
    # 3. Send message
    print("\n3. Sending message...")
    try:
        resp = curl_post_stream(
            f"{BASE_URL}/api/conversations/{conv_id}/messages",
            {"content": "退货政策是什么？"}
        )
        
        print("\n4. Parsing response...")
        
        sources_found = False
        for line in resp.split('\n'):
            if line.startswith('data: '):
                try:
                    data = json.loads(line[6:])
                    if data.get('done'):
                        sources = data.get('sources', [])
                        confidence = data.get('confidence')
                        content = data.get('content', '')
                        
                        print(f"   Done!")
                        print(f"   Confidence: {confidence}")
                        print(f"   Sources count: {len(sources)}")
                        if content:
                            preview = content[:100] + "..." if len(content) > 100 else content
                            print(f"   Content: {preview}")
                        
                        if sources:
                            sources_found = True
                            print("\n5. Sources:")
                            for i, src in enumerate(sources[:5], 1):
                                name = str(src.get('name', 'N/A'))[:40]
                                print(f"   #{i}: type={src.get('type')}, name={name}")
                                print(f"       score={src.get('score', 'N/A')}")
                        else:
                            print("\n   WARNING: No sources!")
                except json.JSONDecodeError:
                    pass
        
        if not sources_found and not resp:
            print(f"   No response!")
            
    except Exception as e:
        print(f"   Error: {e}")
    
    print("\n" + "=" * 60)
    if sources_found:
        print("SUCCESS: Citation trace is working!")
    else:
        print("FAIL: Citation trace NOT working")
    print("=" * 60)
    
    # Cleanup
    if os.path.exists(cookies_file):
        os.remove(cookies_file)

if __name__ == "__main__":
    main()
