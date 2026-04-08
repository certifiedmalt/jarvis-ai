#!/usr/bin/env python3
"""
Backend API Testing for Jarvis AI - patchCodeFile endpoint focus
Tests the new patchCodeFile endpoint with various scenarios
"""

import requests
import json
import sys
from typing import Dict, Any

# Backend URL from frontend/.env
BACKEND_URL = "https://portable-llm.preview.emergentagent.com/api"

def test_api_endpoint(method: str, endpoint: str, data: Dict[Any, Any] = None, expected_status: int = 200) -> Dict[Any, Any]:
    """Test an API endpoint and return the response"""
    url = f"{BACKEND_URL}{endpoint}"
    
    try:
        if method.upper() == "GET":
            response = requests.get(url, timeout=30)
        elif method.upper() == "POST":
            response = requests.post(url, json=data, timeout=30)
        else:
            raise ValueError(f"Unsupported method: {method}")
        
        print(f"\n{'='*60}")
        print(f"Testing: {method} {endpoint}")
        print(f"URL: {url}")
        if data:
            print(f"Request Data: {json.dumps(data, indent=2)}")
        print(f"Status Code: {response.status_code}")
        
        try:
            response_json = response.json()
            print(f"Response: {json.dumps(response_json, indent=2)}")
        except:
            print(f"Response Text: {response.text}")
            response_json = {"error": "Invalid JSON response", "text": response.text}
        
        # Check if status code matches expected
        if response.status_code != expected_status:
            print(f"❌ FAILED: Expected status {expected_status}, got {response.status_code}")
            return {"success": False, "status_code": response.status_code, "response": response_json}
        else:
            print(f"✅ SUCCESS: Status code {response.status_code} as expected")
            return {"success": True, "status_code": response.status_code, "response": response_json}
            
    except requests.exceptions.Timeout:
        print(f"❌ FAILED: Request timed out after 30 seconds")
        return {"success": False, "error": "timeout"}
    except requests.exceptions.ConnectionError:
        print(f"❌ FAILED: Connection error - backend may be down")
        return {"success": False, "error": "connection_error"}
    except Exception as e:
        print(f"❌ FAILED: Unexpected error: {str(e)}")
        return {"success": False, "error": str(e)}

def main():
    """Run all backend tests focusing on patchCodeFile endpoint"""
    print("🚀 Starting Jarvis AI Backend Testing - patchCodeFile Focus")
    print(f"Backend URL: {BACKEND_URL}")
    
    test_results = []
    
    # Test 1: Replace operation - find "# v2.2.0" and replace with "# v3.2.0 - Added patchCodeFile tool"
    print("\n" + "="*80)
    print("TEST 1: patchCodeFile - Replace operation")
    test1_data = {
        "path": "backend/server.py",
        "operation": "replace",
        "find": "# v2.2.0",
        "replace_with": "# v3.2.0 - Added patchCodeFile tool",
        "commit_message": "test patch replace"
    }
    result1 = test_api_endpoint("POST", "/code/patch", test1_data)
    test_results.append(("Test 1 - Replace operation", result1))
    
    # Check if the response indicates success
    if result1.get("success") and result1.get("response", {}).get("status") in ["patched_and_pushed", "patched_locally"]:
        print("✅ Test 1 PASSED: Replace operation successful")
    else:
        print("❌ Test 1 FAILED: Replace operation failed")
    
    # Test 2: Replace with text not found
    print("\n" + "="*80)
    print("TEST 2: patchCodeFile - Replace with non-existent text")
    test2_data = {
        "path": "backend/server.py",
        "operation": "replace",
        "find": "THIS_TEXT_DOES_NOT_EXIST_ANYWHERE_12345",
        "replace_with": "something",
        "commit_message": "test not found"
    }
    result2 = test_api_endpoint("POST", "/code/patch", test2_data)
    test_results.append(("Test 2 - Text not found", result2))
    
    # Check if the response indicates "not_found"
    if result2.get("success") and result2.get("response", {}).get("status") == "not_found":
        print("✅ Test 2 PASSED: Correctly returned 'not_found' status")
    else:
        print("❌ Test 2 FAILED: Should have returned 'not_found' status")
    
    # Test 3: Insert after line operation
    print("\n" + "="*80)
    print("TEST 3: patchCodeFile - Insert after line operation")
    test3_data = {
        "path": "backend/server.py",
        "operation": "insert_after",
        "line": 1,
        "content": "# Patched by test",
        "commit_message": "test insert"
    }
    result3 = test_api_endpoint("POST", "/code/patch", test3_data)
    test_results.append(("Test 3 - Insert after line", result3))
    
    # Check if the response indicates success
    if result3.get("success") and result3.get("response", {}).get("status") in ["patched_and_pushed", "patched_locally"]:
        print("✅ Test 3 PASSED: Insert after line operation successful")
    else:
        print("❌ Test 3 FAILED: Insert after line operation failed")
    
    # Test 4: File not found
    print("\n" + "="*80)
    print("TEST 4: patchCodeFile - File not found")
    test4_data = {
        "path": "nonexistent/file.py",
        "operation": "replace",
        "find": "test",
        "replace_with": "test2",
        "commit_message": "test"
    }
    result4 = test_api_endpoint("POST", "/code/patch", test4_data, expected_status=404)
    test_results.append(("Test 4 - File not found", result4))
    
    # Check if we got 404 as expected
    if result4.get("status_code") == 404:
        print("✅ Test 4 PASSED: Correctly returned 404 for non-existent file")
    else:
        print("❌ Test 4 FAILED: Should have returned 404 for non-existent file")
    
    # Test 5: Health check still works
    print("\n" + "="*80)
    print("TEST 5: Health check endpoint")
    result5 = test_api_endpoint("GET", "/health")
    test_results.append(("Test 5 - Health check", result5))
    
    # Check if health check is working
    if result5.get("success") and result5.get("response", {}).get("status") == "online":
        print("✅ Test 5 PASSED: Health check working")
    else:
        print("❌ Test 5 FAILED: Health check not working")
    
    # Test 6: Chat still works
    print("\n" + "="*80)
    print("TEST 6: Chat endpoint")
    test6_data = {
        "messages": [{"role": "user", "content": "Hello"}]
    }
    result6 = test_api_endpoint("POST", "/chat", test6_data)
    test_results.append(("Test 6 - Chat endpoint", result6))
    
    # Check if chat is working
    if result6.get("success") and result6.get("response", {}).get("content"):
        print("✅ Test 6 PASSED: Chat endpoint working")
    else:
        print("❌ Test 6 FAILED: Chat endpoint not working")
    
    # Summary
    print("\n" + "="*80)
    print("🏁 TEST SUMMARY")
    print("="*80)
    
    passed = 0
    total = len(test_results)
    
    for test_name, result in test_results:
        if result.get("success"):
            print(f"✅ {test_name}")
            passed += 1
        else:
            print(f"❌ {test_name}")
    
    print(f"\nResults: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 ALL TESTS PASSED!")
        return 0
    else:
        print("⚠️  SOME TESTS FAILED")
        return 1

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)