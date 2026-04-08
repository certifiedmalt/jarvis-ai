#!/usr/bin/env python3
"""
Backend Testing for Jarvis AI - Tool Calling Format Tests
Tests the new proper tool calling format implementation
"""

import requests
import json
import sys
from datetime import datetime

# Backend URL from frontend .env
BACKEND_URL = "https://portable-llm.preview.emergentagent.com/api"

def log_test(test_name, status, details=""):
    """Log test results with timestamp"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    status_symbol = "✅" if status == "PASS" else "❌" if status == "FAIL" else "⚠️"
    print(f"[{timestamp}] {status_symbol} {test_name}")
    if details:
        print(f"    {details}")
    print()

def test_health_check():
    """Test 4: Health check endpoint"""
    try:
        response = requests.get(f"{BACKEND_URL}/health", timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if data.get("status") == "online":
                log_test("Health Check", "PASS", f"Status: {data.get('status')}, LLM: {data.get('llm_provider')} {data.get('llm_model')}")
                return True
            else:
                log_test("Health Check", "FAIL", f"Status not online: {data}")
                return False
        else:
            log_test("Health Check", "FAIL", f"HTTP {response.status_code}: {response.text}")
            return False
            
    except Exception as e:
        log_test("Health Check", "FAIL", f"Exception: {str(e)}")
        return False

def test_tool_triggering_chat():
    """Test 1: Tool-triggering chat returns assistant_tool_message"""
    try:
        payload = {
            "messages": [
                {"role": "user", "content": "Get my current location"}
            ]
        }
        
        response = requests.post(
            f"{BACKEND_URL}/chat", 
            json=payload, 
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()
            
            # Check if tool_call is present
            tool_call = data.get("tool_call")
            if not tool_call:
                log_test("Tool Triggering Chat", "FAIL", "No tool_call field in response")
                return False
                
            # Check if tool_call has correct structure
            if tool_call.get("name") != "getLocation":
                log_test("Tool Triggering Chat", "FAIL", f"Expected tool name 'getLocation', got: {tool_call.get('name')}")
                return False
                
            # Check if assistant_tool_message is present (NEW requirement)
            assistant_tool_message = data.get("assistant_tool_message")
            if not assistant_tool_message:
                log_test("Tool Triggering Chat", "FAIL", "Missing assistant_tool_message field (NEW requirement)")
                return False
                
            # Verify assistant_tool_message structure
            if assistant_tool_message.get("role") != "assistant":
                log_test("Tool Triggering Chat", "FAIL", f"assistant_tool_message role should be 'assistant', got: {assistant_tool_message.get('role')}")
                return False
                
            tool_calls = assistant_tool_message.get("tool_calls")
            if not tool_calls or not isinstance(tool_calls, list):
                log_test("Tool Triggering Chat", "FAIL", "assistant_tool_message missing tool_calls array")
                return False
                
            # Verify tool_calls structure
            first_tool_call = tool_calls[0]
            if first_tool_call.get("type") != "function":
                log_test("Tool Triggering Chat", "FAIL", f"tool_call type should be 'function', got: {first_tool_call.get('type')}")
                return False
                
            function_data = first_tool_call.get("function", {})
            if function_data.get("name") != "getLocation":
                log_test("Tool Triggering Chat", "FAIL", f"function name should be 'getLocation', got: {function_data.get('name')}")
                return False
                
            log_test("Tool Triggering Chat", "PASS", 
                    f"Tool call: {tool_call.get('name')}, assistant_tool_message present with correct structure")
            return True
            
        else:
            log_test("Tool Triggering Chat", "FAIL", f"HTTP {response.status_code}: {response.text}")
            return False
            
    except Exception as e:
        log_test("Tool Triggering Chat", "FAIL", f"Exception: {str(e)}")
        return False

def test_proper_tool_message_format():
    """Test 2: Proper tool message format accepted"""
    try:
        # This tests the new format with role=tool messages in history
        payload = {
            "messages": [
                {"role": "user", "content": "Get my current location"},
                {
                    "role": "assistant", 
                    "content": "", 
                    "tool_calls": [
                        {
                            "id": "call_123", 
                            "type": "function", 
                            "function": {
                                "name": "getLocation", 
                                "arguments": "{}"
                            }
                        }
                    ]
                },
                {
                    "role": "tool", 
                    "tool_call_id": "call_123", 
                    "name": "getLocation", 
                    "content": "Location: San Francisco, CA. Coordinates: 37.7749, -122.4194"
                },
                {"role": "user", "content": "Thanks, now what's nearby?"}
            ]
        }
        
        response = requests.post(
            f"{BACKEND_URL}/chat", 
            json=payload, 
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        
        if response.status_code == 422:
            log_test("Proper Tool Message Format", "FAIL", f"422 Validation Error - tool role messages not accepted: {response.text}")
            return False
        elif response.status_code == 200:
            data = response.json()
            # Should return a text response, not a tool call for this follow-up question
            if data.get("content"):
                log_test("Proper Tool Message Format", "PASS", 
                        f"Tool role messages accepted, returned text response: {data.get('content')[:100]}...")
                return True
            else:
                log_test("Proper Tool Message Format", "FAIL", "No content in response")
                return False
        else:
            log_test("Proper Tool Message Format", "FAIL", f"HTTP {response.status_code}: {response.text}")
            return False
            
    except Exception as e:
        log_test("Proper Tool Message Format", "FAIL", f"Exception: {str(e)}")
        return False

def test_normal_chat():
    """Test 3: Normal chat still works"""
    try:
        payload = {
            "messages": [
                {"role": "user", "content": "Hello Jarvis, how are you?"}
            ]
        }
        
        response = requests.post(
            f"{BACKEND_URL}/chat", 
            json=payload, 
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()
            
            # Should have content and tool_call should be null
            content = data.get("content")
            tool_call = data.get("tool_call")
            
            if not content:
                log_test("Normal Chat", "FAIL", "No content in response")
                return False
                
            if tool_call is not None:
                log_test("Normal Chat", "FAIL", f"tool_call should be null for normal chat, got: {tool_call}")
                return False
                
            log_test("Normal Chat", "PASS", f"Normal chat working, content: {content[:100]}...")
            return True
            
        else:
            log_test("Normal Chat", "FAIL", f"HTTP {response.status_code}: {response.text}")
            return False
            
    except Exception as e:
        log_test("Normal Chat", "FAIL", f"Exception: {str(e)}")
        return False

def test_asking_about_tools():
    """Test 5: Asking about tools returns text not tool_call"""
    try:
        payload = {
            "messages": [
                {"role": "user", "content": "List all your available tools and what each one does"}
            ]
        }
        
        response = requests.post(
            f"{BACKEND_URL}/chat", 
            json=payload, 
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()
            
            # Should have content describing tools and tool_call should be null
            content = data.get("content")
            tool_call = data.get("tool_call")
            
            if not content:
                log_test("Asking About Tools", "FAIL", "No content in response")
                return False
                
            if tool_call is not None:
                log_test("Asking About Tools", "FAIL", f"tool_call should be null when asking about tools, got: {tool_call}")
                return False
                
            # Check if content actually describes tools
            content_lower = content.lower()
            if "tool" not in content_lower and "function" not in content_lower:
                log_test("Asking About Tools", "FAIL", "Response doesn't seem to describe tools")
                return False
                
            log_test("Asking About Tools", "PASS", f"Tools described in text, no tool execution: {content[:150]}...")
            return True
            
        else:
            log_test("Asking About Tools", "FAIL", f"HTTP {response.status_code}: {response.text}")
            return False
            
    except Exception as e:
        log_test("Asking About Tools", "FAIL", f"Exception: {str(e)}")
        return False

def main():
    """Run all backend tests"""
    print("=" * 60)
    print("JARVIS AI BACKEND TESTING - Tool Calling Format")
    print("=" * 60)
    print(f"Backend URL: {BACKEND_URL}")
    print()
    
    # Track test results
    results = []
    
    # Run tests in order
    print("Running Backend Tests...")
    print("-" * 40)
    
    # Test 4: Health check (run first to verify connectivity)
    results.append(("Health Check", test_health_check()))
    
    # Test 1: Tool-triggering chat returns assistant_tool_message
    results.append(("Tool Triggering Chat", test_tool_triggering_chat()))
    
    # Test 2: Proper tool message format accepted
    results.append(("Proper Tool Message Format", test_proper_tool_message_format()))
    
    # Test 3: Normal chat still works
    results.append(("Normal Chat", test_normal_chat()))
    
    # Test 5: Asking about tools returns text not tool_call
    results.append(("Asking About Tools", test_asking_about_tools()))
    
    # Summary
    print("=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    
    passed = 0
    failed = 0
    
    for test_name, result in results:
        status = "PASS" if result else "FAIL"
        symbol = "✅" if result else "❌"
        print(f"{symbol} {test_name}: {status}")
        if result:
            passed += 1
        else:
            failed += 1
    
    print()
    print(f"Total: {len(results)} tests")
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    
    if failed > 0:
        print("\n❌ SOME TESTS FAILED - Check details above")
        return False
    else:
        print("\n✅ ALL TESTS PASSED")
        return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)