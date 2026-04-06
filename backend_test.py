#!/usr/bin/env python3
"""
Jarvis Backend API Testing Script
Tests the chat endpoint to verify structured JSON responses from Together.ai (Llama-3.3-70B)
"""

import requests
import json
import sys
from datetime import datetime

# Backend URL from frontend/.env
BACKEND_URL = "https://portable-llm.preview.emergentagent.com"
API_BASE = f"{BACKEND_URL}/api"

def print_test_header(test_name):
    print(f"\n{'='*60}")
    print(f"TEST: {test_name}")
    print(f"{'='*60}")

def print_response_details(response, test_name):
    print(f"\n--- {test_name} Response Details ---")
    print(f"Status Code: {response.status_code}")
    print(f"Headers: {dict(response.headers)}")
    
    try:
        response_json = response.json()
        print(f"Response JSON: {json.dumps(response_json, indent=2)}")
        return response_json
    except json.JSONDecodeError:
        print(f"Response Text: {response.text}")
        return None

def validate_json_content(content_field, test_name):
    """Validate that the content field contains valid JSON with expected structure"""
    print(f"\n--- Validating JSON Content for {test_name} ---")
    print(f"Raw content field: {repr(content_field)}")
    
    try:
        # Parse the content as JSON
        parsed_content = json.loads(content_field)
        print(f"Parsed JSON: {json.dumps(parsed_content, indent=2)}")
        
        # Check for expected structure
        if isinstance(parsed_content, dict):
            if "action" in parsed_content:
                print(f"✅ Found 'action' field: {parsed_content['action']}")
                
                if parsed_content["action"] == "none":
                    if "response" in parsed_content:
                        print(f"✅ Found 'response' field for action=none")
                        return True, "Valid JSON with action=none and response"
                    else:
                        print(f"❌ Missing 'response' field for action=none")
                        return False, "Missing response field"
                else:
                    # Tool action
                    if "args" in parsed_content:
                        print(f"✅ Found 'args' field for tool action")
                        return True, f"Valid JSON with action={parsed_content['action']} and args"
                    else:
                        print(f"⚠️  Tool action without args field")
                        return True, f"Valid JSON with action={parsed_content['action']} but no args"
            else:
                print(f"❌ Missing 'action' field in JSON")
                return False, "Missing action field"
        else:
            print(f"❌ Content is not a JSON object")
            return False, "Content is not a JSON object"
            
    except json.JSONDecodeError as e:
        print(f"❌ Invalid JSON: {e}")
        return False, f"Invalid JSON: {e}"

def test_health_check():
    """Test 1: Health check endpoint"""
    print_test_header("Health Check")
    
    try:
        response = requests.get(f"{API_BASE}/health", timeout=10)
        response_data = print_response_details(response, "Health Check")
        
        if response.status_code == 200 and response_data:
            # Check expected fields
            expected_fields = ["status", "llm_configured"]
            missing_fields = [field for field in expected_fields if field not in response_data]
            
            if not missing_fields:
                print(f"✅ Health check passed")
                print(f"   Status: {response_data.get('status')}")
                print(f"   LLM Configured: {response_data.get('llm_configured')}")
                print(f"   LLM Provider: {response_data.get('llm_provider')}")
                print(f"   LLM Model: {response_data.get('llm_model')}")
                return True, "Health check successful"
            else:
                print(f"❌ Missing fields: {missing_fields}")
                return False, f"Missing fields: {missing_fields}"
        else:
            print(f"❌ Health check failed")
            return False, f"HTTP {response.status_code}"
            
    except Exception as e:
        print(f"❌ Health check error: {e}")
        return False, str(e)

def test_normal_chat():
    """Test 2: Normal chat endpoint - should return JSON with action=none"""
    print_test_header("Normal Chat")
    
    payload = {
        "messages": [{"role": "user", "content": "Hello, who are you?"}]
    }
    
    try:
        response = requests.post(
            f"{API_BASE}/chat", 
            json=payload, 
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        
        response_data = print_response_details(response, "Normal Chat")
        
        if response.status_code == 200 and response_data:
            content_field = response_data.get("content")
            if content_field:
                is_valid, validation_msg = validate_json_content(content_field, "Normal Chat")
                if is_valid:
                    print(f"✅ Normal chat test passed: {validation_msg}")
                    return True, validation_msg
                else:
                    print(f"❌ Normal chat test failed: {validation_msg}")
                    return False, validation_msg
            else:
                print(f"❌ No content field in response")
                return False, "No content field in response"
        else:
            print(f"❌ Normal chat failed")
            return False, f"HTTP {response.status_code}"
            
    except Exception as e:
        print(f"❌ Normal chat error: {e}")
        return False, str(e)

def test_tool_triggering_chat():
    """Test 3: Tool-triggering chat - should return JSON with action and args"""
    print_test_header("Tool-Triggering Chat")
    
    payload = {
        "messages": [{"role": "user", "content": "What's the current Bitcoin price?"}]
    }
    
    try:
        response = requests.post(
            f"{API_BASE}/chat", 
            json=payload, 
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        
        response_data = print_response_details(response, "Tool-Triggering Chat")
        
        if response.status_code == 200 and response_data:
            content_field = response_data.get("content")
            if content_field:
                is_valid, validation_msg = validate_json_content(content_field, "Tool-Triggering Chat")
                if is_valid:
                    print(f"✅ Tool-triggering chat test passed: {validation_msg}")
                    return True, validation_msg
                else:
                    print(f"❌ Tool-triggering chat test failed: {validation_msg}")
                    return False, validation_msg
            else:
                print(f"❌ No content field in response")
                return False, "No content field in response"
        else:
            print(f"❌ Tool-triggering chat failed")
            return False, f"HTTP {response.status_code}"
            
    except Exception as e:
        print(f"❌ Tool-triggering chat error: {e}")
        return False, str(e)

def main():
    """Run all tests and provide summary"""
    print(f"Jarvis Backend API Testing")
    print(f"Backend URL: {BACKEND_URL}")
    print(f"API Base: {API_BASE}")
    print(f"Test Time: {datetime.now().isoformat()}")
    
    tests = [
        ("Health Check", test_health_check),
        ("Normal Chat", test_normal_chat),
        ("Tool-Triggering Chat", test_tool_triggering_chat),
    ]
    
    results = []
    
    for test_name, test_func in tests:
        try:
            success, message = test_func()
            results.append((test_name, success, message))
        except Exception as e:
            results.append((test_name, False, f"Test execution error: {e}"))
    
    # Summary
    print(f"\n{'='*60}")
    print(f"TEST SUMMARY")
    print(f"{'='*60}")
    
    passed = 0
    failed = 0
    
    for test_name, success, message in results:
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {test_name} - {message}")
        if success:
            passed += 1
        else:
            failed += 1
    
    print(f"\nTotal: {len(results)} tests")
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    
    if failed > 0:
        print(f"\n⚠️  Some tests failed. Check the detailed output above.")
        sys.exit(1)
    else:
        print(f"\n🎉 All tests passed!")
        sys.exit(0)

if __name__ == "__main__":
    main()