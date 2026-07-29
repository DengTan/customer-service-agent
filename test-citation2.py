#!/usr/bin/env python3
"""Test citation flow using curl"""
import subprocess
import json
import time
import sys

BASE_URL = "http://localhost:5000"

def run_curl(cmd):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return result.stdout, result.stderr

def main():
    print("Testing Citation Flow")
    print("=" * 60)
    
    # 1. Login and get cookies
    print("\n1. Login...")
    stdout, stderr = run_curl(f'''
curl -s -c cookies.txt -X POST "{BASE_URL}/api/auth/login" 
  -H "Content-Type: application/json" 
  -d "{{\\\"email\\\":\\\"admin@smartassist.com\\\",\\\"password\\\":\\\"Admin123456\\\"}}"
''')
    if "success" not in stdout.lower():
        print(f"   Login failed: {stdout[:200]}")
        return
    print("   Login OK")
    
    # 2. Create conversation
    print("\n2. Create conversation...")
    stdout, stderr = run_curl(f'''
curl -s -b cookies.txt -c cookies.txt -X POST "{BASE_URL}/api/conversations" 
  -H "Content-Type: application/json" 
  -d "{{\\\"title\\\":\\\"test\\\",\\\"source\\\":\\\"web\\\"}}"
''')
    try:
        data = json.loads(stdout)
        conv_id = data.get("conversation", {}).get("id") or data.get("id")
        print(f"   Conv ID: {conv_id}")
    except:
        print(f"   Failed: {stdout[:200]}")
        return
    
    # 3. Send message with SSE
    print("\n3. Sending message...")
    print("   Query: 退货政策是什么？")
    
    cmd = f'''
curl -s -b cookies.txt -c cookies.txt -X POST "{BASE_URL}/api/conversations/{conv_id}/messages" 
  -H "Content-Type: application/json" 
  -H "Accept: text/event-stream"
  -d "{{\\\"content\\\":\\\"退货政策是什么？\\\"}}"
'''
    
    stdout, stderr = run_curl(cmd)
    
    print("\n4. Parsing SSE response...")
    
    sources_found = False
    confidence = None
    full_content = ""
    sources_count = 0
    
    for line in stdout.split('\n'):
        if line.startswith('data: '):
            try:
                data = json.loads(line[6:])
                if data.get('content'):
                    full_content += data['content']
                if data.get('done'):
                    sources = data.get('sources', [])
                    confidence = data.get('confidence')
                    sources_count = len(sources)
                    print(f"   Done!")
                    print(f"   Confidence: {confidence}")
                    print(f"   Sources count: {sources_count}")
                    if full_content:
                        preview = full_content[:100] + "..." if len(full_content) > 100 else full_content
                        print(f"   Response: {preview}")
                    
                    if sources:
                        sources_found = True
                        print("\n5. Sources:")
                        for i, src in enumerate(sources[:5], 1):
                            name = str(src.get('name', 'N/A'))[:30]
                            print(f"   #{i}: type={src.get('type')}, name={name}")
                            print(f"       score={src.get('score', 'N/A')}")
                    else:
                        print("\n   WARNING: No sources!")
            except json.JSONDecodeError:
                pass
    
    if not full_content and not sources_count:
        print(f"   No content received!")
        print(f"   Raw output (first 500 chars): {stdout[:500]}")
    
    print("\n" + "=" * 60)
    if sources_found:
        print("SUCCESS: Citation trace is working!")
    else:
        print("FAIL: Citation trace NOT working")
    print("=" * 60)

if __name__ == "__main__":
    main()
