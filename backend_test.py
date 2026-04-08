#!/usr/bin/env python3
"""
Jarvis Backend API Testing Script
Tests all backend endpoints including:
- Health check
- Chat endpoint with normal messages and tool requests
- New code push endpoint
- Chat endpoint asking about tools (should return text, not tool_call)
- Conversation endpoint
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
    """Test 2: Normal chat endpoint - should return plain text content with tool_call: null"""
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
            tool_call = response_data.get("tool_call")
            
            if content_field and isinstance(content_field, str) and len(content_field) > 10:
                if tool_call is None:
                    print(f"✅ Normal chat test passed - Got text content with tool_call: null")
                    return True, "Normal chat working - returns text content"
                else:
                    print(f"❌ Expected tool_call to be null but got: {tool_call}")
                    return False, f"Unexpected tool_call: {tool_call}"
            else:
                print(f"❌ No valid content field in response")
                return False, "No valid content field in response"
        else:
            print(f"❌ Normal chat failed")
            return False, f"HTTP {response.status_code}"
            
    except Exception as e:
        print(f"❌ Normal chat error: {e}")
        return False, str(e)

def test_tool_triggering_chat():
    """Test 3: Tool-triggering chat - should return tool_call object or plain text if no tool available"""
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
            tool_call = response_data.get("tool_call")
            
            # For Bitcoin price, there's no tool available, so it should return text content
            if content_field and isinstance(content_field, str) and len(content_field) > 10:
                print(f"✅ Tool-triggering chat test passed - Got appropriate response")
                return True, "Tool-triggering chat working - returns appropriate response"
            elif tool_call is not None:
                print(f"✅ Tool-triggering chat test passed - Got tool call: {tool_call}")
                return True, "Tool-triggering chat working - returns tool call"
            else:
                print(f"❌ No valid content or tool_call in response")
                return False, "No valid content or tool_call in response"
        else:
            print(f"❌ Tool-triggering chat failed")
            return False, f"HTTP {response.status_code}"
            
    except Exception as e:
        print(f"❌ Tool-triggering chat error: {e}")
        return False, str(e)

def test_code_push_endpoint():
    """Test 4: POST /api/code/push - New endpoint for git commit and push"""
    print_test_header("Code Push Endpoint")
    
    payload = {
        "message": "test commit"
    }
    
    try:
        response = requests.post(
            f"{API_BASE}/code/push", 
            json=payload, 
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        
        response_data = print_response_details(response, "Code Push")
        
        if response.status_code == 200 and response_data:
            status = response_data.get("status")
            if status in ["pushed", "nothing_to_commit", "failed"]:
                print(f"✅ Code push endpoint working - Status: {status}")
                return True, f"Code push endpoint working with status: {status}"
            else:
                print(f"❌ Unexpected status: {status}")
                return False, f"Unexpected status: {status}"
        else:
            print(f"❌ Code push failed")
            return False, f"HTTP {response.status_code}"
            
    except Exception as e:
        print(f"❌ Code push error: {e}")
        return False, str(e)

def test_chat_tools_description():
    """Test 5: Chat asking about tools - should return TEXT description, NOT tool_call"""
    print_test_header("Chat Tools Description")
    
    payload = {
        "messages": [{"role": "user", "content": "What tools do you have? Tell me about your capabilities."}]
    }
    
    try:
        response = requests.post(
            f"{API_BASE}/chat", 
            json=payload, 
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        
        response_data = print_response_details(response, "Chat Tools Description")
        
        if response.status_code == 200 and response_data:
            # Check that tool_call is null
            tool_call = response_data.get("tool_call")
            content = response_data.get("content")
            
            if tool_call is not None:
                print(f"❌ BUG: tool_call should be null but got: {tool_call}")
                return False, "BUG: LLM is executing tools instead of describing them"
            
            if content and isinstance(content, str) and len(content) > 10:
                print(f"✅ Chat tools description working - Got text description")
                print(f"   Content preview: {content[:100]}...")
                return True, "Chat tools description working - returns text description"
            else:
                print(f"❌ No valid content in response")
                return False, "No valid content in response"
        else:
            print(f"❌ Chat tools description failed")
            return False, f"HTTP {response.status_code}"
            
    except Exception as e:
        print(f"❌ Chat tools description error: {e}")
        return False, str(e)

def test_conversation_endpoint():
    """Test 6: GET /api/conversation - Should return messages array"""
    print_test_header("Conversation Endpoint")
    
    try:
        response = requests.get(f"{API_BASE}/conversation", timeout=10)
        response_data = print_response_details(response, "Conversation")
        
        if response.status_code == 200 and response_data:
            if "messages" in response_data and isinstance(response_data["messages"], list):
                print(f"✅ Conversation endpoint working - Got messages array")
                return True, "Conversation endpoint working"
            else:
                print(f"❌ Missing or invalid messages array")
                return False, "Missing or invalid messages array"
        else:
            print(f"❌ Conversation endpoint failed")
            return False, f"HTTP {response.status_code}"
            
    except Exception as e:
        print(f"❌ Conversation endpoint error: {e}")
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
        ("Code Push Endpoint", test_code_push_endpoint),
        ("Chat Tools Description", test_chat_tools_description),
        ("Conversation Endpoint", test_conversation_endpoint),
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