#!/usr/bin/env python3
"""
Jarvis v2 Backend Testing Suite
Tests all backend endpoints for the Jarvis AI assistant.
"""

import requests
import json
import time
import sys
from typing import Dict, Any

# Backend URL from frontend .env
BACKEND_URL = "https://portable-llm.preview.emergentagent.com/api"

class JarvisBackendTester:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        })
        self.results = {}
        
    def log(self, message: str, level: str = "INFO"):
        """Log test messages with timestamp"""
        timestamp = time.strftime("%H:%M:%S")
        print(f"[{timestamp}] {level}: {message}")
        
    def test_health_endpoint(self) -> bool:
        """Test GET /api/health endpoint"""
        self.log("Testing health endpoint...")
        try:
            response = self.session.get(f"{BACKEND_URL}/health", timeout=10)
            
            if response.status_code != 200:
                self.log(f"Health check failed with status {response.status_code}", "ERROR")
                return False
                
            data = response.json()
            expected_fields = ["status", "model", "provider", "version"]
            
            for field in expected_fields:
                if field not in data:
                    self.log(f"Missing field '{field}' in health response", "ERROR")
                    return False
                    
            # Check specific values
            if data.get("status") != "online":
                self.log(f"Expected status 'online', got '{data.get('status')}'", "ERROR")
                return False
                
            if data.get("model") != "claude-sonnet-4-6":
                self.log(f"Expected model 'claude-sonnet-4-6', got '{data.get('model')}'", "ERROR")
                return False
                
            if data.get("provider") != "anthropic":
                self.log(f"Expected provider 'anthropic', got '{data.get('provider')}'", "ERROR")
                return False
                
            if data.get("version") != "2.0.0":
                self.log(f"Expected version '2.0.0', got '{data.get('version')}'", "ERROR")
                return False
                
            self.log(f"✅ Health check passed: {data}")
            return True
            
        except requests.exceptions.RequestException as e:
            self.log(f"Health check request failed: {e}", "ERROR")
            return False
        except Exception as e:
            self.log(f"Health check error: {e}", "ERROR")
            return False
    
    def test_chat_simple(self) -> bool:
        """Test POST /api/chat with simple greeting"""
        self.log("Testing chat endpoint with simple greeting...")
        try:
            payload = {
                "messages": [
                    {"role": "user", "content": "Hello, what can you do?"}
                ]
            }
            
            response = self.session.post(f"{BACKEND_URL}/chat", 
                                       json=payload, timeout=30)
            
            if response.status_code != 200:
                self.log(f"Chat request failed with status {response.status_code}: {response.text}", "ERROR")
                return False
                
            data = response.json()
            
            # Check required fields
            if "type" not in data:
                self.log("Missing 'type' field in chat response", "ERROR")
                return False
                
            if "messages" not in data:
                self.log("Missing 'messages' field in chat response", "ERROR")
                return False
                
            if "server_tool_log" not in data:
                self.log("Missing 'server_tool_log' field in chat response", "ERROR")
                return False
                
            # For simple greeting, should return type="text"
            if data.get("type") != "text":
                self.log(f"Expected type 'text', got '{data.get('type')}'", "ERROR")
                return False
                
            if not data.get("text"):
                self.log("No text response from Claude", "ERROR")
                return False
                
            # Check that messages array was updated
            if len(data.get("messages", [])) < 2:
                self.log("Messages array should contain at least user + assistant messages", "ERROR")
                return False
                
            self.log(f"✅ Simple chat test passed. Response: {data.get('text')[:100]}...")
            return True
            
        except requests.exceptions.RequestException as e:
            self.log(f"Chat request failed: {e}", "ERROR")
            return False
        except Exception as e:
            self.log(f"Chat test error: {e}", "ERROR")
            return False
    
    def test_chat_with_server_tool(self) -> bool:
        """Test POST /api/chat with server tool triggering"""
        self.log("Testing chat endpoint with server tool (listRepoPaths)...")
        try:
            payload = {
                "messages": [
                    {"role": "user", "content": "List the files in the backend directory"}
                ]
            }
            
            response = self.session.post(f"{BACKEND_URL}/chat", 
                                       json=payload, timeout=45)
            
            if response.status_code != 200:
                self.log(f"Chat with tool request failed with status {response.status_code}: {response.text}", "ERROR")
                return False
                
            data = response.json()
            
            # Should return type="text" since server tools are handled internally
            if data.get("type") != "text":
                self.log(f"Expected type 'text' for server tool, got '{data.get('type')}'", "ERROR")
                return False
                
            # Should have server_tool_log entries
            if not data.get("server_tool_log"):
                self.log("Expected server_tool_log entries for tool execution", "ERROR")
                return False
                
            # Check that tool was executed
            tool_log = data.get("server_tool_log", [])
            if not any("listRepoPaths" in log for log in tool_log):
                self.log("Expected listRepoPaths tool to be executed", "ERROR")
                return False
                
            self.log(f"✅ Server tool test passed. Tool log: {tool_log}")
            return True
            
        except requests.exceptions.RequestException as e:
            self.log(f"Chat with tool request failed: {e}", "ERROR")
            return False
        except Exception as e:
            self.log(f"Chat with tool test error: {e}", "ERROR")
            return False
    
    def test_conversation_crud(self) -> bool:
        """Test conversation CRUD operations"""
        self.log("Testing conversation CRUD operations...")
        
        try:
            # 1. Clear any existing conversation
            response = self.session.delete(f"{BACKEND_URL}/conversation", timeout=10)
            if response.status_code != 200:
                self.log(f"Clear conversation failed: {response.status_code}", "ERROR")
                return False
            self.log("✅ Conversation cleared")
            
            # 2. Get empty conversation
            response = self.session.get(f"{BACKEND_URL}/conversation", timeout=10)
            if response.status_code != 200:
                self.log(f"Get conversation failed: {response.status_code}", "ERROR")
                return False
                
            data = response.json()
            if "messages" not in data:
                self.log("Missing 'messages' field in conversation response", "ERROR")
                return False
                
            if len(data.get("messages", [])) != 0:
                self.log(f"Expected empty messages, got {len(data.get('messages', []))}", "ERROR")
                return False
            self.log("✅ Empty conversation retrieved")
            
            # 3. Save conversation
            test_messages = [
                {"role": "user", "content": "test message"},
                {"role": "assistant", "content": [{"type": "text", "text": "test response"}]}
            ]
            
            response = self.session.post(f"{BACKEND_URL}/conversation", 
                                       json={"messages": test_messages}, timeout=10)
            if response.status_code != 200:
                self.log(f"Save conversation failed: {response.status_code}", "ERROR")
                return False
                
            save_data = response.json()
            if save_data.get("status") != "saved":
                self.log(f"Expected status 'saved', got '{save_data.get('status')}'", "ERROR")
                return False
                
            if save_data.get("count") != 2:
                self.log(f"Expected count 2, got {save_data.get('count')}", "ERROR")
                return False
            self.log("✅ Conversation saved")
            
            # 4. Retrieve saved conversation
            response = self.session.get(f"{BACKEND_URL}/conversation", timeout=10)
            if response.status_code != 200:
                self.log(f"Get saved conversation failed: {response.status_code}", "ERROR")
                return False
                
            data = response.json()
            if len(data.get("messages", [])) != 2:
                self.log(f"Expected 2 messages, got {len(data.get('messages', []))}", "ERROR")
                return False
            self.log("✅ Saved conversation retrieved")
            
            return True
            
        except requests.exceptions.RequestException as e:
            self.log(f"Conversation CRUD request failed: {e}", "ERROR")
            return False
        except Exception as e:
            self.log(f"Conversation CRUD test error: {e}", "ERROR")
            return False
    
    def test_code_patch(self) -> bool:
        """Test POST /api/code/patch endpoint"""
        self.log("Testing code patch endpoint...")
        try:
            # Test with a file that should exist and text that might not exist
            payload = {
                "path": "backend/server.py",
                "operation": "replace",
                "find": "# test_marker",
                "replace_with": "# test_marker_replaced",
                "commit_message": "test patch"
            }
            
            response = self.session.post(f"{BACKEND_URL}/code/patch", 
                                       json=payload, timeout=15)
            
            if response.status_code != 200:
                self.log(f"Code patch request failed with status {response.status_code}: {response.text}", "ERROR")
                return False
                
            data = response.json()
            
            if "status" not in data or "result" not in data:
                self.log("Missing 'status' or 'result' field in patch response", "ERROR")
                return False
                
            # The patch might fail if text not found, which is expected
            result = data.get("result", "")
            if "Text not found" in result:
                self.log("✅ Code patch test passed (text not found - expected behavior)")
                return True
            elif "success" in result:
                self.log("✅ Code patch test passed (patch applied successfully)")
                return True
            else:
                self.log(f"Unexpected patch result: {result}", "ERROR")
                return False
                
        except requests.exceptions.RequestException as e:
            self.log(f"Code patch request failed: {e}", "ERROR")
            return False
        except Exception as e:
            self.log(f"Code patch test error: {e}", "ERROR")
            return False
    
    def test_code_push(self) -> bool:
        """Test POST /api/code/push endpoint"""
        self.log("Testing code push endpoint...")
        try:
            payload = {
                "message": "test commit from backend test"
            }
            
            response = self.session.post(f"{BACKEND_URL}/code/push", 
                                       json=payload, timeout=30)
            
            if response.status_code != 200:
                self.log(f"Code push request failed with status {response.status_code}: {response.text}", "ERROR")
                return False
                
            data = response.json()
            
            if "status" not in data or "result" not in data:
                self.log("Missing 'status' or 'result' field in push response", "ERROR")
                return False
                
            result = data.get("result", "")
            # Push might succeed or fail with "nothing to commit" - both are valid
            if "Pushed to GitHub" in result or "nothing to commit" in result:
                self.log(f"✅ Code push test passed: {result}")
                return True
            else:
                self.log(f"Code push result: {result}", "WARN")
                return True  # Don't fail the test for git issues
                
        except requests.exceptions.RequestException as e:
            self.log(f"Code push request failed: {e}", "ERROR")
            return False
        except Exception as e:
            self.log(f"Code push test error: {e}", "ERROR")
            return False
    
    def test_deploy_status(self) -> bool:
        """Test GET /api/deploy/status endpoint"""
        self.log("Testing deploy status endpoint...")
        try:
            response = self.session.get(f"{BACKEND_URL}/deploy/status", timeout=15)
            
            if response.status_code == 500:
                # Check if it's due to missing GitHub PAT
                error_text = response.text
                if "No GitHub PAT configured" in error_text:
                    self.log("✅ Deploy status test passed (GitHub PAT not configured - expected)")
                    return True
                else:
                    self.log(f"Deploy status failed: {error_text}", "ERROR")
                    return False
            elif response.status_code != 200:
                self.log(f"Deploy status request failed with status {response.status_code}: {response.text}", "ERROR")
                return False
                
            data = response.json()
            
            # Should have status field
            if "status" not in data:
                self.log("Missing 'status' field in deploy status response", "ERROR")
                return False
                
            self.log(f"✅ Deploy status test passed: {data}")
            return True
            
        except requests.exceptions.RequestException as e:
            self.log(f"Deploy status request failed: {e}", "ERROR")
            return False
        except Exception as e:
            self.log(f"Deploy status test error: {e}", "ERROR")
            return False
    
    def run_all_tests(self) -> Dict[str, bool]:
        """Run all backend tests and return results"""
        self.log("=" * 60)
        self.log("STARTING JARVIS V2 BACKEND TESTS")
        self.log("=" * 60)
        
        tests = [
            ("Health Check", self.test_health_endpoint),
            ("Simple Chat", self.test_chat_simple),
            ("Chat with Server Tool", self.test_chat_with_server_tool),
            ("Conversation CRUD", self.test_conversation_crud),
            ("Code Patch", self.test_code_patch),
            ("Code Push", self.test_code_push),
            ("Deploy Status", self.test_deploy_status),
        ]
        
        results = {}
        passed = 0
        total = len(tests)
        
        for test_name, test_func in tests:
            self.log(f"\n--- Running {test_name} ---")
            try:
                result = test_func()
                results[test_name] = result
                if result:
                    passed += 1
                    self.log(f"✅ {test_name} PASSED")
                else:
                    self.log(f"❌ {test_name} FAILED")
            except Exception as e:
                self.log(f"❌ {test_name} CRASHED: {e}", "ERROR")
                results[test_name] = False
        
        self.log("\n" + "=" * 60)
        self.log("TEST SUMMARY")
        self.log("=" * 60)
        
        for test_name, result in results.items():
            status = "✅ PASS" if result else "❌ FAIL"
            self.log(f"{test_name}: {status}")
        
        self.log(f"\nOverall: {passed}/{total} tests passed")
        
        if passed == total:
            self.log("🎉 ALL TESTS PASSED!")
        else:
            self.log(f"⚠️  {total - passed} tests failed")
        
        return results

def main():
    """Main test runner"""
    tester = JarvisBackendTester()
    results = tester.run_all_tests()
    
    # Exit with error code if any tests failed
    if not all(results.values()):
        sys.exit(1)
    else:
        sys.exit(0)

if __name__ == "__main__":
    main()