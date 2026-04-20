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
  ActionSheetIOS,
  Image,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';

// ─── Config ─────────────────────────────────────────────────────────
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL
  || Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL
  || 'https://jarvis-backend-production-a86c.up.railway.app';

// ─── Types ──────────────────────────────────────────────────────────
type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  fileName?: string;
};

type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, any>;
};

type AttachedFile = {
  name: string;
  uri: string;
  mimeType: string;
  size: number;
};

// ─── Device Tool Imports ────────────────────────────────────────────
import { executeDeviceTool } from '../utils/deviceActions';

// ─── Linkified Text Component ───────────────────────────────────────
function LinkifiedText({ text, style }: { text: string; style: any }) {
  if (!text) return <Text style={style}>{''}</Text>;
  
  const urlPattern = /https?:\/\/[^\s\)]+/g;
  const matches: { index: number; url: string }[] = [];
  let match;
  while ((match = urlPattern.exec(text)) !== null) {
    matches.push({ index: match.index, url: match[0] });
  }
  
  if (matches.length === 0) {
    return <Text style={style}>{text}</Text>;
  }
  
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  
  matches.forEach((m, i) => {
    if (m.index > lastIndex) {
      parts.push(<Text key={`t${i}`}>{text.slice(lastIndex, m.index)}</Text>);
    }
    parts.push(
      <Text
        key={`u${i}`}
        style={{ color: '#00D9FF', textDecorationLine: 'underline' as const }}
        onPress={() => Linking.openURL(m.url)}
      >
        {m.url}
      </Text>
    );
    lastIndex = m.index + m.url.length;
  });
  
  if (lastIndex < text.length) {
    parts.push(<Text key="end">{text.slice(lastIndex)}</Text>);
  }
  
  return <Text style={style}>{parts}</Text>;
}

export default function JarvisChat() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [claudeMessages, setClaudeMessages] = useState<any[]>([]); // Full Claude-format history
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [modelName, setModelName] = useState('Connecting...');
  const [toolLog, setToolLog] = useState<string[]>([]);
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
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
      result = await executeDeviceTool(name, args);
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
      const res = await fetchWithTimeout(`${BACKEND_URL}/api/chat`, {
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

  // ─── File Attachment ────────────────────────────────────────────────
  const pickFromPhotos = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo library access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets?.[0]) {
      const a = result.assets[0];
      const info = await FileSystem.getInfoAsync(a.uri);
      setAttachedFile({
        name: a.fileName || 'photo.jpg',
        uri: a.uri,
        mimeType: a.mimeType || 'image/jpeg',
        size: (info as any).size || 0,
      });
    }
  }, []);

  const pickFromCamera = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow camera access.'); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets?.[0]) {
      const a = result.assets[0];
      const info = await FileSystem.getInfoAsync(a.uri);
      setAttachedFile({
        name: a.fileName || 'capture.jpg',
        uri: a.uri,
        mimeType: a.mimeType || 'image/jpeg',
        size: (info as any).size || 0,
      });
    }
  }, []);

  const pickFromFiles = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (!result.canceled && result.assets?.[0]) {
      const a = result.assets[0];
      setAttachedFile({
        name: a.name,
        uri: a.uri,
        mimeType: a.mimeType || 'application/octet-stream',
        size: a.size || 0,
      });
    }
  }, []);

  const showAttachOptions = useCallback(() => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', 'Photos', 'Camera', 'Files'], cancelButtonIndex: 0 },
        (i) => { if (i === 1) pickFromPhotos(); else if (i === 2) pickFromCamera(); else if (i === 3) pickFromFiles(); }
      );
    } else {
      Alert.alert('Attach', 'Choose source', [
        { text: 'Photos', onPress: pickFromPhotos },
        { text: 'Camera', onPress: pickFromCamera },
        { text: 'Files', onPress: pickFromFiles },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [pickFromPhotos, pickFromCamera, pickFromFiles]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // ─── Fetch with timeout (120s for tool chains like DALL-E) ────────
  const fetchWithTimeout = useCallback(async (url: string, options: RequestInit, timeoutMs = 120000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new Error('Request timed out — Jarvis may still be working. Try again in a moment.');
      }
      throw err;
    }
  }, []);

  // ─── Send Message ─────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    if ((!inputText.trim() && !attachedFile) || isGenerating) return;
    Keyboard.dismiss();
    abortRef.current = false;

    const userText = inputText.trim() || (attachedFile ? `Analyze this file: ${attachedFile.name}` : '');
    const userMsg: Message = { id: `u_${Date.now()}`, role: 'user', content: userText, fileName: attachedFile?.name };
    const assistantMsg: Message = { id: `a_${Date.now() + 1}`, role: 'assistant', content: '' };

    const currentFile = attachedFile;
    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInputText('');
    setAttachedFile(null);
    setIsGenerating(true);
    setToolLog([]);

    try {
      const newClaudeMessages = [...claudeMessages, { role: "user", content: userText }];
      let data;

      if (currentFile) {
        // File upload via multipart form
        const formData = new FormData();
        formData.append('messages', JSON.stringify(newClaudeMessages));
        formData.append('file', { uri: currentFile.uri, name: currentFile.name, type: currentFile.mimeType } as any);

        const res = await fetchWithTimeout(`${BACKEND_URL}/api/chat/with-file`, { method: 'POST', body: formData });
        data = await res.json();
        if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      } else {
        const res = await fetchWithTimeout(`${BACKEND_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: newClaudeMessages }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({ detail: 'Unknown error' }));
          throw new Error(errData.detail || `HTTP ${res.status}`);
        }
        data = await res.json();
      }

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
  }, [inputText, isGenerating, claudeMessages, attachedFile, handleDeviceTool, saveConversation]);

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
              {msg.fileName && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                  <Text style={{ fontSize: 12, color: '#FFF', opacity: 0.7 }}>📎 {msg.fileName}</Text>
                </View>
              )}
              <LinkifiedText
                text={msg.content || (isGenerating ? 'Thinking...' : '')}
                style={[
                  styles.msgText,
                  msg.role === 'user' && styles.userText,
                  msg.role === 'system' && styles.systemText,
                ]}
              />
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
        {attachedFile && (
          <View style={styles.filePreview}>
            {attachedFile.mimeType.startsWith('image/') ? (
              <Image source={{ uri: attachedFile.uri }} style={styles.filePreviewImage} />
            ) : (
              <Text style={styles.filePreviewIcon}>
                {attachedFile.mimeType.startsWith('video/') ? '🎬' : '📎'}
              </Text>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.filePreviewName} numberOfLines={1}>{attachedFile.name}</Text>
              <Text style={styles.filePreviewSize}>{formatFileSize(attachedFile.size)}</Text>
            </View>
            <TouchableOpacity onPress={() => setAttachedFile(null)} style={styles.fileRemoveBtn}>
              <Text style={styles.fileRemoveText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.inputRow}>
          <TouchableOpacity style={styles.attachBtn} onPress={showAttachOptions} disabled={isGenerating}>
            <Text style={[styles.attachIcon, isGenerating && { opacity: 0.3 }]}>+</Text>
          </TouchableOpacity>
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
              style={[styles.sendBtn, (!inputText.trim() && !attachedFile) && styles.sendBtnDisabled]}
              onPress={sendMessage}
              disabled={!inputText.trim() && !attachedFile}
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
  filePreview: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1A2E',
    borderRadius: 12, padding: 10, marginBottom: 8,
    borderWidth: 1, borderColor: '#00D9FF30',
  },
  filePreviewIcon: { fontSize: 20, marginRight: 10 },
  filePreviewImage: { width: 44, height: 44, borderRadius: 8, marginRight: 10 },
  filePreviewName: { fontSize: 14, color: '#FFF', fontWeight: '600' },
  filePreviewSize: { fontSize: 11, color: '#888', marginTop: 2 },
  fileRemoveBtn: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#FF4444',
    alignItems: 'center', justifyContent: 'center',
  },
  fileRemoveText: { fontSize: 14, color: '#FFF', fontWeight: '700' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  attachBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#1A1A2E',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#2A2A3A',
  },
  attachIcon: { fontSize: 24, color: '#00D9FF', fontWeight: '300' },
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
