#!/usr/bin/env python3
"""
Backend API Testing for Jarvis AI - Standing Orders (Trust Boundaries) Feature
Tests the new standing orders functionality as requested
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
    """Run all backend tests focusing on Standing Orders (Trust Boundaries) feature"""
    print("🚀 Starting Jarvis AI Backend Testing - Standing Orders Feature")
    print(f"Backend URL: {BACKEND_URL}")
    
    test_results = []
    
    # Test 1: Get standing orders (should be empty initially)
    print("\n" + "="*80)
    print("TEST 1: Get standing orders (empty)")
    result1 = test_api_endpoint("GET", "/standing-orders")
    test_results.append(("Test 1 - Get standing orders (empty)", result1))
    
    # Check if the response shows empty orders
    if result1.get("success") and result1.get("response", {}).get("orders") == {}:
        print("✅ Test 1 PASSED: Standing orders empty as expected")
    else:
        print("❌ Test 1 FAILED: Standing orders should be empty initially")
    
    # Test 2: Grant a standing order (code_write)
    print("\n" + "="*80)
    print("TEST 2: Grant a standing order (code_write)")
    result2 = test_api_endpoint("POST", "/standing-orders?category=code_write&granted=true")
    test_results.append(("Test 2 - Grant code_write standing order", result2))
    
    # Check if the response indicates success
    expected_response = {"status": "updated", "category": "code_write", "granted": True}
    if (result2.get("success") and 
        result2.get("response", {}).get("status") == "updated" and
        result2.get("response", {}).get("category") == "code_write" and
        result2.get("response", {}).get("granted") == True):
        print("✅ Test 2 PASSED: code_write standing order granted successfully")
    else:
        print("❌ Test 2 FAILED: Failed to grant code_write standing order")
    
    # Test 3: Get standing orders (now has one)
    print("\n" + "="*80)
    print("TEST 3: Get standing orders (now has one)")
    result3 = test_api_endpoint("GET", "/standing-orders")
    test_results.append(("Test 3 - Get standing orders (has code_write)", result3))
    
    # Check if the response shows code_write: true
    expected_orders = {"code_write": True}
    if (result3.get("success") and 
        result3.get("response", {}).get("orders") == expected_orders):
        print("✅ Test 3 PASSED: Standing orders now contains code_write: true")
    else:
        print("❌ Test 3 FAILED: Standing orders should contain code_write: true")
    
    # Test 4: Grant another standing order (deploy)
    print("\n" + "="*80)
    print("TEST 4: Grant another standing order (deploy)")
    result4 = test_api_endpoint("POST", "/standing-orders?category=deploy&granted=true")
    test_results.append(("Test 4 - Grant deploy standing order", result4))
    
    # Check if the response indicates success
    if (result4.get("success") and 
        result4.get("response", {}).get("status") == "updated" and
        result4.get("response", {}).get("category") == "deploy" and
        result4.get("response", {}).get("granted") == True):
        print("✅ Test 4 PASSED: deploy standing order granted successfully")
    else:
        print("❌ Test 4 FAILED: Failed to grant deploy standing order")
    
    # Test 5: Verify both are stored
    print("\n" + "="*80)
    print("TEST 5: Verify both standing orders are stored")
    result5 = test_api_endpoint("GET", "/standing-orders")
    test_results.append(("Test 5 - Get both standing orders", result5))
    
    # Check if the response shows both orders
    expected_orders = {"code_write": True, "deploy": True}
    if (result5.get("success") and 
        result5.get("response", {}).get("orders") == expected_orders):
        print("✅ Test 5 PASSED: Both standing orders stored correctly")
    else:
        print("❌ Test 5 FAILED: Both standing orders should be stored")
    
    # Test 6: Revoke one standing order (code_write)
    print("\n" + "="*80)
    print("TEST 6: Revoke one standing order (code_write)")
    result6 = test_api_endpoint("POST", "/standing-orders?category=code_write&granted=false")
    test_results.append(("Test 6 - Revoke code_write standing order", result6))
    
    # Check if the response indicates success
    if (result6.get("success") and 
        result6.get("response", {}).get("status") == "updated" and
        result6.get("response", {}).get("category") == "code_write" and
        result6.get("response", {}).get("granted") == False):
        print("✅ Test 6 PASSED: code_write standing order revoked successfully")
    else:
        print("❌ Test 6 FAILED: Failed to revoke code_write standing order")
    
    # Test 7: Chat includes standing orders in context
    print("\n" + "="*80)
    print("TEST 7: Chat includes standing orders in context")
    test7_data = {
        "messages": [{"role": "user", "content": "What standing orders do I have active?"}]
    }
    result7 = test_api_endpoint("POST", "/chat", test7_data)
    test_results.append(("Test 7 - Chat with standing orders context", result7))
    
    # Check if the response mentions "deploy" as an active standing order
    if (result7.get("success") and 
        result7.get("response", {}).get("content") and
        "deploy" in result7.get("response", {}).get("content", "").lower()):
        print("✅ Test 7 PASSED: Chat response mentions 'deploy' as active standing order")
    else:
        print("❌ Test 7 FAILED: Chat should mention 'deploy' as active standing order")
        if result7.get("response", {}).get("content"):
            print(f"Chat response: {result7.get('response', {}).get('content')}")
    
    # Test 8: Health check
    print("\n" + "="*80)
    print("TEST 8: Health check endpoint")
    result8 = test_api_endpoint("GET", "/health")
    test_results.append(("Test 8 - Health check", result8))
    
    # Check if health check is working
    if result8.get("success") and result8.get("response", {}).get("status") == "online":
        print("✅ Test 8 PASSED: Health check working")
    else:
        print("❌ Test 8 FAILED: Health check not working")
    
    # Summary
    print("\n" + "="*80)
    print("🏁 STANDING ORDERS TEST SUMMARY")
    print("="*80)
    
    passed = 0
    total = len(test_results)
    
    for test_name, result in test_results:
        if test_name == "Test 1 - Get standing orders (empty)" and result.get("success") and result.get("response", {}).get("orders") == {}:
            print(f"✅ {test_name}")
            passed += 1
        elif test_name == "Test 2 - Grant code_write standing order" and result.get("success") and result.get("response", {}).get("status") == "updated":
            print(f"✅ {test_name}")
            passed += 1
        elif test_name == "Test 3 - Get standing orders (has code_write)" and result.get("success") and result.get("response", {}).get("orders", {}).get("code_write") == True:
            print(f"✅ {test_name}")
            passed += 1
        elif test_name == "Test 4 - Grant deploy standing order" and result.get("success") and result.get("response", {}).get("status") == "updated":
            print(f"✅ {test_name}")
            passed += 1
        elif test_name == "Test 5 - Get both standing orders" and result.get("success") and "deploy" in result.get("response", {}).get("orders", {}):
            print(f"✅ {test_name}")
            passed += 1
        elif test_name == "Test 6 - Revoke code_write standing order" and result.get("success") and result.get("response", {}).get("status") == "updated":
            print(f"✅ {test_name}")
            passed += 1
        elif test_name == "Test 7 - Chat with standing orders context" and result.get("success") and result.get("response", {}).get("content"):
            print(f"✅ {test_name}")
            passed += 1
        elif test_name == "Test 8 - Health check" and result.get("success") and result.get("response", {}).get("status") == "online":
            print(f"✅ {test_name}")
            passed += 1
        else:
            print(f"❌ {test_name}")
    
    print(f"\nResults: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 ALL STANDING ORDERS TESTS PASSED!")
        return 0
    else:
        print("⚠️  SOME STANDING ORDERS TESTS FAILED")
        return 1

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)