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
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

const BACKEND_URL = 'https://jarvis-backend-production-a86c.up.railway.app';

type AttachedFile = {
  name: string;
  uri: string;
  mimeType: string;
  size: number;
};

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  fileName?: string;
};

export default function JarvisChat() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  const [modelName, setModelName] = useState('Connecting...');

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/health`)
      .then(res => res.json())
      .then(data => {
        if (data.status === 'online') {
          setIsOnline(true);
          if (data.llm_model) {
            const name = data.llm_model.includes('llama') ? 'Llama 3.3 70B' : 
                         data.llm_model.includes('gpt') ? 'GPT-4o' : data.llm_model;
            setModelName(name);
          }
        }
      })
      .catch(() => setIsOnline(false));
  }, []);

  useEffect(() => {
    if (scrollViewRef.current && messages.length > 0) {
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  const pickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        if (asset.size && asset.size > 10 * 1024 * 1024) {
          Alert.alert('File too large', 'Maximum file size is 10MB.');
          return;
        }
        setAttachedFile({
          name: asset.name,
          uri: asset.uri,
          mimeType: asset.mimeType || 'application/octet-stream',
          size: asset.size || 0,
        });
      }
    } catch (err) {
      console.log('File picker error:', err);
    }
  }, []);

  const removeFile = useCallback(() => {
    setAttachedFile(null);
  }, []);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const sendMessage = useCallback(async () => {
    if ((!inputText.trim() && !attachedFile) || isGenerating) return;
    Keyboard.dismiss();

    const msgContent = inputText.trim() || (attachedFile ? `Analyze this file: ${attachedFile.name}` : '');
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: msgContent,
      fileName: attachedFile?.name,
    };
    const assistantMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: '' };

    const currentFile = attachedFile;
    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInputText('');
    setAttachedFile(null);
    setIsGenerating(true);

    try {
      const history = [...messages, userMsg]
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-20)
        .map(m => ({ role: m.role, content: m.content }));

      let data;

      if (currentFile) {
        // Use multipart form upload for file-attached messages
        const formData = new FormData();
        formData.append('messages', JSON.stringify(history));

        // Read file and append
        const fileInfo = await FileSystem.getInfoAsync(currentFile.uri);
        if (fileInfo.exists) {
          formData.append('file', {
            uri: currentFile.uri,
            name: currentFile.name,
            type: currentFile.mimeType,
          } as any);
        }

        const res = await fetch(`${BACKEND_URL}/api/chat/with-file`, {
          method: 'POST',
          body: formData,
        });
        data = await res.json();
        if (!res.ok) {
          data = { content: data.detail || 'Error processing file.' };
        }
      } else {
        // Regular chat
        const res = await fetch(`${BACKEND_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history }),
        });
        data = await res.json();
        if (!res.ok) {
          data = { content: data.detail || 'Server error. Try again.' };
        }
      }

      setMessages(prev => {
        const updated = [...prev];
        const last = updated.length - 1;
        if (updated[last]?.role === 'assistant') {
          updated[last] = { ...updated[last], content: data.content || 'Empty response from Jarvis.' };
        }
        return updated;
      });
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev];
        const last = updated.length - 1;
        if (updated[last]?.role === 'assistant') {
          updated[last] = { ...updated[last], content: 'Cannot reach Jarvis. Check your connection and try again.' };
        }
        return updated;
      });
    } finally {
      setIsGenerating(false);
    }
  }, [inputText, isGenerating, messages, attachedFile]);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerOrb}>
          <Text style={styles.headerOrbText}>J</Text>
        </View>
        <View>
          <Text style={styles.headerTitle}>JARVIS</Text>
          <Text style={[styles.headerSub, isOnline && { color: '#00FF88' }]}>
            {isGenerating ? 'Processing...' : isOnline ? modelName + ' Online' : 'Connecting...'}
          </Text>
        </View>
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>J</Text>
            <Text style={styles.emptyTitle}>Hello, I'm Jarvis</Text>
            <Text style={styles.emptySub}>Your personal AI assistant. How can I help you?</Text>
          </View>
        )}
        {messages.map(msg => (
          <View key={msg.id} style={[styles.msgRow, msg.role === 'user' && styles.msgRowUser]}>
            <View style={[styles.bubble, msg.role === 'user' ? styles.userBubble : styles.aiBubble]}>
              {msg.fileName && (
                <View style={styles.fileTag}>
                  <Text style={styles.fileTagIcon}>📎</Text>
                  <Text style={styles.fileTagText} numberOfLines={1}>{msg.fileName}</Text>
                </View>
              )}
              <Text style={[styles.msgText, msg.role === 'user' && { color: '#FFF' }]}>
                {msg.content || (isGenerating ? 'Thinking...' : '')}
              </Text>
              {isGenerating && !msg.content && msg.role === 'assistant' && (
                <ActivityIndicator size="small" color="#00D9FF" style={{ marginTop: 4 }} />
              )}
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.inputArea, { paddingBottom: Math.max(insets.bottom, 10) + 8 }]}>
        {attachedFile && (
          <View style={styles.filePreview}>
            <Text style={styles.filePreviewIcon}>📎</Text>
            <View style={styles.filePreviewInfo}>
              <Text style={styles.filePreviewName} numberOfLines={1}>{attachedFile.name}</Text>
              <Text style={styles.filePreviewSize}>{formatFileSize(attachedFile.size)}</Text>
            </View>
            <TouchableOpacity onPress={removeFile} style={styles.fileRemoveBtn}>
              <Text style={styles.fileRemoveText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.inputRow}>
          <TouchableOpacity
            style={styles.attachBtn}
            onPress={pickFile}
            disabled={isGenerating}
          >
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
          <TouchableOpacity
            style={[styles.sendBtn, (!inputText.trim() && !attachedFile || isGenerating) && styles.sendBtnOff]}
            onPress={sendMessage}
            disabled={(!inputText.trim() && !attachedFile) || isGenerating}
          >
            {isGenerating ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={styles.sendIcon}>{'>'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20,
    paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#1A1A25', gap: 12,
  },
  headerOrb: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#00D9FF20',
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#00D9FF50',
  },
  headerOrbText: { fontSize: 22, fontWeight: '700', color: '#00D9FF' },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#FFF', letterSpacing: 2 },
  headerSub: { fontSize: 12, color: '#00D9FF', marginTop: 2 },
  messages: { flex: 1 },
  messagesContent: { padding: 16, paddingBottom: 20 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 60, fontWeight: '700', color: '#00D9FF', marginBottom: 16 },
  emptyTitle: { fontSize: 26, fontWeight: '700', color: '#FFF', marginBottom: 10 },
  emptySub: { fontSize: 15, color: '#888', textAlign: 'center' },
  msgRow: { marginBottom: 12, flexDirection: 'row', justifyContent: 'flex-start' },
  msgRowUser: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '80%', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20 },
  userBubble: { backgroundColor: '#7B61FF', borderBottomRightRadius: 6 },
  aiBubble: { backgroundColor: '#14141F', borderBottomLeftRadius: 6, borderWidth: 1, borderColor: '#1E1E2A' },
  msgText: { fontSize: 15, color: '#E0E0E0', lineHeight: 22 },
  fileTag: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 6, alignSelf: 'flex-start',
  },
  fileTagIcon: { fontSize: 12, marginRight: 4 },
  fileTagText: { fontSize: 12, color: '#FFF', maxWidth: 150 },
  inputArea: {
    paddingHorizontal: 12, paddingTop: 10, backgroundColor: '#0A0A0F',
    borderTopWidth: 1, borderTopColor: '#1A1A25',
  },
  filePreview: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1A2E',
    borderRadius: 12, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#00D9FF30',
  },
  filePreviewIcon: { fontSize: 20, marginRight: 10 },
  filePreviewInfo: { flex: 1 },
  filePreviewName: { fontSize: 14, color: '#FFF', fontWeight: '600' },
  filePreviewSize: { fontSize: 11, color: '#888', marginTop: 2 },
  fileRemoveBtn: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#FF4444',
    alignItems: 'center', justifyContent: 'center',
  },
  fileRemoveText: { fontSize: 14, color: '#FFF', fontWeight: '700' },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
  },
  attachBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#1A1A2E',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2A2A3A',
  },
  attachIcon: { fontSize: 24, color: '#00D9FF', fontWeight: '300' },
  input: {
    flex: 1, backgroundColor: '#12121A', borderRadius: 24, paddingHorizontal: 20,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10, fontSize: 16,
    color: '#FFF', maxHeight: 120, borderWidth: 1, borderColor: '#1E1E2A',
  },
  sendBtn: {
    width: 44, height: 44,
    borderRadius: 22, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center',
  },
  sendBtnOff: { backgroundColor: '#1A1A25' },
  sendIcon: { fontSize: 20, fontWeight: '700', color: '#FFF' },
});
