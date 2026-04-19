import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';

// ─── Config ─────────────────────────────────────────────────────────
// Dev: uses EXPO_PUBLIC_BACKEND_URL from .env (Emergent preview)
// Prod: falls back to Railway
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL
  || Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL
  || 'https://jarvis-backend-production-a86c.up.railway.app';

// ─── Types ──────────────────────────────────────────────────────────
type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, any>;
};

// ─── Device Tool Imports ────────────────────────────────────────────
import { executeDeviceAction } from '../utils/deviceActions';

export default function JarvisChat() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [claudeMessages, setClaudeMessages] = useState<any[]>([]); // Full Claude-format history
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [modelName, setModelName] = useState('Connecting...');
  const [toolLog, setToolLog] = useState<string[]>([]);
  const abortRef = useRef(false);
  const scrollViewRef = useRef<ScrollView>(null);

  // ─── Health Check ─────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/health`)
      .then(res => res.json())
      .then(data => {
        if (data.status === 'online') {
          setIsOnline(true);
          setModelName(data.model || 'Claude');
        }
      })
      .catch(() => setIsOnline(false));
  }, []);

  // ─── Auto-scroll ──────────────────────────────────────────────────
  useEffect(() => {
    if (scrollViewRef.current && messages.length > 0) {
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  // ─── Load Conversation ────────────────────────────────────────────
  useEffect(() => {
    const loadConversation = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/conversation`);
        const data = await res.json();
        if (data.messages && data.messages.length > 0) {
          // Restore Claude messages for context
          setClaudeMessages(data.messages);
          // Extract display messages
          const display: Message[] = [];
          for (const msg of data.messages) {
            if (msg.role === 'user') {
              const text = typeof msg.content === 'string'
                ? msg.content
                : Array.isArray(msg.content)
                  ? msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
                  : '';
              // Skip tool_result messages in display
              if (Array.isArray(msg.content) && msg.content.some((b: any) => b.type === 'tool_result')) continue;
              if (text) display.push({ id: `h_${display.length}`, role: 'user', content: text });
            } else if (msg.role === 'assistant') {
              const text = typeof msg.content === 'string'
                ? msg.content
                : Array.isArray(msg.content)
                  ? msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
                  : '';
              if (text) display.push({ id: `h_${display.length}`, role: 'assistant', content: text });
            }
          }
          setMessages(display);
        }
      } catch (err) {
        console.log('Failed to load conversation:', err);
      }
    };
    loadConversation();
  }, []);

  // ─── Save Conversation ────────────────────────────────────────────
  const saveConversation = useCallback(async (msgs: any[]) => {
    try {
      await fetch(`${BACKEND_URL}/api/conversation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: msgs }),
      });
    } catch (err) {
      console.log('Failed to save conversation:', err);
    }
  }, []);

  // ─── Execute Device Tool ──────────────────────────────────────────
  const handleDeviceTool = useCallback(async (
    toolCall: ToolCall,
    currentClaudeMessages: any[],
    reasoning: string | null,
  ) => {
    if (abortRef.current) {
      setIsGenerating(false);
      return;
    }

    const { name, arguments: args, id: toolId } = toolCall;

    // Show what's happening
    if (reasoning) {
      setMessages(prev => {
        const updated = [...prev];
        const last = updated.length - 1;
        if (updated[last]?.role === 'assistant' && !updated[last].content) {
          updated[last] = { ...updated[last], content: reasoning };
        }
        return updated;
      });
    }

    // Map tool name to device action
    let result: string;
    try {
      if (name === 'getContacts') {
        result = await executeDeviceAction({ action: 'get_contacts', search: args.query });
      } else if (name === 'getCalendar') {
        result = await executeDeviceAction({ action: 'get_calendar', days: args.days || 7 });
      } else if (name === 'getLocation') {
        result = await executeDeviceAction({ action: 'get_location' });
      } else if (name === 'speakText') {
        // For speak, we just display the text (TTS handled separately)
        result = `Speaking: "${args.text}"`;
      } else {
        result = `Unknown device tool: ${name}`;
      }
    } catch (err: any) {
      result = `Device error: ${err.message || String(err)}`;
    }

    // Show tool result
    setMessages(prev => [...prev, {
      id: `tool_${Date.now()}`,
      role: 'system' as const,
      content: `[${name}] ${result}`,
    }]);

    // Send tool result back to backend
    const messagesWithResult = [
      ...currentClaudeMessages,
      {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: toolId,
          content: result,
        }]
      }
    ];

    // Add thinking placeholder
    setMessages(prev => [...prev, { id: `a_${Date.now()}`, role: 'assistant', content: '' }]);

    try {
      const res = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messagesWithResult }),
      });
      const data = await res.json();

      if (data.type === 'device_tool') {
        // Another device tool needed — recurse
        handleDeviceTool(data.tool_call, data.messages, data.text);
      } else {
        // Final text response
        const responseText = data.text || '';
        setMessages(prev => {
          const updated = [...prev];
          const last = updated.length - 1;
          if (updated[last]?.role === 'assistant' && !updated[last].content) {
            updated[last] = { ...updated[last], content: responseText };
          }
          return updated;
        });
        setClaudeMessages(data.messages || []);
        await saveConversation(data.messages || []);
        if (data.server_tool_log?.length > 0) {
          setToolLog(prev => [...prev, ...data.server_tool_log]);
        }
        setIsGenerating(false);
      }
    } catch (err: any) {
      setMessages(prev => {
        const updated = [...prev];
        const last = updated.length - 1;
        if (updated[last]?.role === 'assistant') {
          updated[last] = { ...updated[last], content: `Connection error: ${err.message}` };
        }
        return updated;
      });
      setIsGenerating(false);
    }
  }, [saveConversation]);

  // ─── Send Message ─────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    if (!inputText.trim() || isGenerating) return;
    Keyboard.dismiss();
    abortRef.current = false;

    const userText = inputText.trim();
    const userMsg: Message = { id: `u_${Date.now()}`, role: 'user', content: userText };
    const assistantMsg: Message = { id: `a_${Date.now() + 1}`, role: 'assistant', content: '' };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInputText('');
    setIsGenerating(true);
    setToolLog([]);

    try {
      // Build Claude messages: existing history + new user message
      const newClaudeMessages = [
        ...claudeMessages,
        { role: "user", content: userText }
      ];

      const res = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newClaudeMessages }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(errData.detail || `HTTP ${res.status}`);
      }

      const data = await res.json();

      if (data.type === 'device_tool') {
        // Backend needs us to execute a device tool
        handleDeviceTool(data.tool_call, data.messages, data.text);
      } else if (data.type === 'error') {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated.length - 1;
          if (updated[last]?.role === 'assistant') {
            updated[last] = { ...updated[last], content: data.text || 'An error occurred.' };
          }
          return updated;
        });
        setIsGenerating(false);
      } else {
        // Normal text response (possibly after server-side tool chain)
        const responseText = data.text || '';
        setMessages(prev => {
          const updated = [...prev];
          const last = updated.length - 1;
          if (updated[last]?.role === 'assistant' && !updated[last].content) {
            updated[last] = { ...updated[last], content: responseText };
          }
          return updated;
        });
        // Update Claude message history
        setClaudeMessages(data.messages || []);
        await saveConversation(data.messages || []);
        if (data.server_tool_log?.length > 0) {
          setToolLog(data.server_tool_log);
        }
        setIsGenerating(false);
      }
    } catch (err: any) {
      console.log('Chat error:', err.message);
      setMessages(prev => {
        const updated = [...prev];
        const last = updated.length - 1;
        if (updated[last]?.role === 'assistant') {
          updated[last] = { ...updated[last], content: `Cannot reach Jarvis. ${err.message}` };
        }
        return updated;
      });
      setIsGenerating(false);
    }
  }, [inputText, isGenerating, claudeMessages, handleDeviceTool, saveConversation]);

  // ─── Stop ─────────────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    abortRef.current = true;
    setIsGenerating(false);
    setMessages(prev => {
      const updated = [...prev];
      const last = updated.length - 1;
      if (updated[last]?.role === 'assistant' && !updated[last].content) {
        updated[last] = { ...updated[last], content: 'Stopped by user.' };
      }
      return updated;
    });
  }, []);

  // ─── Clear Memory ─────────────────────────────────────────────────
  const handleClearMemory = useCallback(() => {
    Alert.alert(
      'Clear Memory',
      'Erase all conversation history? Jarvis will start fresh.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await fetch(`${BACKEND_URL}/api/conversation`, { method: 'DELETE' });
              setMessages([]);
              setClaudeMessages([]);
              setToolLog([]);
            } catch (err) {
              console.log('Clear error:', err);
            }
          },
        },
      ]
    );
  }, []);

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerOrb}>
          <Text style={styles.headerOrbText}>J</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>JARVIS</Text>
          <Text style={[styles.headerStatus, isOnline && styles.headerStatusOnline]}>
            {isGenerating ? 'Processing...' : isOnline ? `${modelName} · Online` : 'Connecting...'}
          </Text>
        </View>
        <TouchableOpacity style={styles.headerBtn} onPress={handleClearMemory}>
          <Text style={styles.headerBtnText}>Clear</Text>
        </TouchableOpacity>
      </View>

      {/* Messages */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.messageList}
        contentContainerStyle={styles.messageListContent}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 && (
          <View style={styles.emptyState}>
            <View style={styles.emptyOrb}>
              <Text style={styles.emptyOrbText}>J</Text>
            </View>
            <Text style={styles.emptyTitle}>Jarvis v2</Text>
            <Text style={styles.emptySub}>Personal AI Assistant</Text>
            <Text style={styles.emptyHint}>Powered by Claude · Self-improving</Text>
          </View>
        )}

        {messages.map(msg => (
          <View key={msg.id} style={[
            styles.msgRow,
            msg.role === 'user' && styles.msgRowUser,
            msg.role === 'system' && styles.msgRowSystem,
          ]}>
            <View style={[
              styles.bubble,
              msg.role === 'user' ? styles.userBubble :
              msg.role === 'system' ? styles.systemBubble :
              styles.aiBubble,
            ]}>
              <Text style={[
                styles.msgText,
                msg.role === 'user' && styles.userText,
                msg.role === 'system' && styles.systemText,
              ]}>
                {msg.content || (isGenerating ? 'Thinking...' : '')}
              </Text>
              {isGenerating && !msg.content && msg.role === 'assistant' && (
                <ActivityIndicator size="small" color="#00D9FF" style={{ marginTop: 4 }} />
              )}
            </View>
          </View>
        ))}

        {/* Server tool log */}
        {toolLog.length > 0 && (
          <View style={styles.toolLogContainer}>
            <Text style={styles.toolLogTitle}>Server Actions:</Text>
            {toolLog.map((log, i) => (
              <Text key={i} style={styles.toolLogItem}>• {log}</Text>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Input Area */}
      <View style={[styles.inputArea, { paddingBottom: Math.max(insets.bottom, 10) + 4 }]}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Message Jarvis..."
            placeholderTextColor="#555"
            value={inputText}
            onChangeText={setInputText}
            onSubmitEditing={sendMessage}
            returnKeyType="send"
            multiline
            maxLength={4000}
            editable={!isGenerating}
          />
          {isGenerating ? (
            <TouchableOpacity style={styles.stopBtn} onPress={handleStop}>
              <Text style={styles.stopBtnText}>■</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
              onPress={sendMessage}
              disabled={!inputText.trim()}
            >
              <Text style={styles.sendBtnText}>↑</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A25',
    gap: 12,
  },
  headerOrb: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#00D9FF15',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#00D9FF40',
  },
  headerOrbText: { fontSize: 20, fontWeight: '700', color: '#00D9FF' },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#FFF', letterSpacing: 3 },
  headerStatus: { fontSize: 11, color: '#666', marginTop: 2 },
  headerStatusOnline: { color: '#00D9FF' },
  headerBtn: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 16, backgroundColor: '#1A1A2E',
    borderWidth: 1, borderColor: '#2A2A3A',
  },
  headerBtnText: { fontSize: 13, color: '#888', fontWeight: '600' },

  // Messages
  messageList: { flex: 1 },
  messageListContent: { padding: 16, paddingBottom: 24 },

  emptyState: { alignItems: 'center', paddingTop: 80 },
  emptyOrb: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#00D9FF10',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#00D9FF30',
    marginBottom: 20,
  },
  emptyOrbText: { fontSize: 40, fontWeight: '700', color: '#00D9FF' },
  emptyTitle: { fontSize: 28, fontWeight: '700', color: '#FFF', marginBottom: 8 },
  emptySub: { fontSize: 16, color: '#888', marginBottom: 4 },
  emptyHint: { fontSize: 13, color: '#555' },

  msgRow: { marginBottom: 10, flexDirection: 'row', justifyContent: 'flex-start' },
  msgRowUser: { justifyContent: 'flex-end' },
  msgRowSystem: { justifyContent: 'center' },

  bubble: { maxWidth: '82%', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 20 },
  userBubble: { backgroundColor: '#7B61FF', borderBottomRightRadius: 6 },
  aiBubble: {
    backgroundColor: '#13131E',
    borderBottomLeftRadius: 6,
    borderWidth: 1, borderColor: '#1E1E2E',
  },
  systemBubble: {
    backgroundColor: '#0D2818',
    borderRadius: 12,
    borderWidth: 1, borderColor: '#1A3A25',
    maxWidth: '90%',
  },

  msgText: { fontSize: 15, color: '#E0E0E0', lineHeight: 22 },
  userText: { color: '#FFF' },
  systemText: { fontSize: 13, color: '#4ADE80', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  // Tool log
  toolLogContainer: {
    marginTop: 8, padding: 12,
    backgroundColor: '#111118', borderRadius: 12,
    borderWidth: 1, borderColor: '#1E1E2E',
  },
  toolLogTitle: { fontSize: 12, color: '#00D9FF', fontWeight: '600', marginBottom: 6 },
  toolLogItem: { fontSize: 12, color: '#888', lineHeight: 18 },

  // Input
  inputArea: {
    paddingHorizontal: 12, paddingTop: 10,
    backgroundColor: '#0A0A0F',
    borderTopWidth: 1, borderTopColor: '#1A1A25',
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1, backgroundColor: '#12121A',
    borderRadius: 24, paddingHorizontal: 18,
    paddingVertical: Platform.OS === 'ios' ? 13 : 10,
    fontSize: 16, color: '#FFF',
    maxHeight: 120,
    borderWidth: 1, borderColor: '#1E1E2A',
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#00D9FF',
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#1A1A25' },
  sendBtnText: { fontSize: 22, fontWeight: '700', color: '#FFF' },
  stopBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#FF4444',
    alignItems: 'center', justifyContent: 'center',
  },
  stopBtnText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
});
