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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const BACKEND_URL = 'https://jarvis-backend-production-a86c.up.railway.app';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

export default function JarvisChat() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/health`)
      .then(res => res.json())
      .then(data => {
        if (data.status === 'online') setIsOnline(true);
      })
      .catch(() => setIsOnline(false));
  }, []);

  useEffect(() => {
    if (scrollViewRef.current && messages.length > 0) {
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  const sendMessage = useCallback(async () => {
    if (!inputText.trim() || isGenerating) return;
    Keyboard.dismiss();

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: inputText.trim() };
    const assistantMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: '' };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInputText('');
    setIsGenerating(true);

    try {
      const history = [...messages, userMsg]
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-20)
        .map(m => ({ role: m.role, content: m.content }));

      const res = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, model: 'gpt-4o' }),
      });

      const data = await res.json();

      setMessages(prev => {
        const updated = [...prev];
        const last = updated.length - 1;
        if (updated[last]?.role === 'assistant') {
          updated[last] = { ...updated[last], content: data.content || 'Error getting response.' };
        }
        return updated;
      });
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev];
        const last = updated.length - 1;
        if (updated[last]?.role === 'assistant') {
          updated[last] = { ...updated[last], content: 'Connection error. Please try again.' };
        }
        return updated;
      });
    } finally {
      setIsGenerating(false);
    }
  }, [inputText, isGenerating, messages]);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerOrb}>
          <Text style={styles.headerOrbText}>J</Text>
        </View>
        <View>
          <Text style={styles.headerTitle}>JARVIS</Text>
          <Text style={[styles.headerSub, isOnline && { color: '#00FF88' }]}>
            {isGenerating ? 'Processing...' : isOnline ? 'GPT-4o Online' : 'Connecting...'}
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
          style={[styles.sendBtn, (!inputText.trim() || isGenerating) && styles.sendBtnOff]}
          onPress={sendMessage}
          disabled={!inputText.trim() || isGenerating}
        >
          {isGenerating ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Text style={styles.sendIcon}>{'>'}</Text>
          )}
        </TouchableOpacity>
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
  inputArea: {
    paddingHorizontal: 16, paddingTop: 10, backgroundColor: '#0A0A0F',
    borderTopWidth: 1, borderTopColor: '#1A1A25',
  },
  input: {
    backgroundColor: '#12121A', borderRadius: 24, paddingHorizontal: 20,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10, fontSize: 16,
    color: '#FFF', maxHeight: 120, borderWidth: 1, borderColor: '#1E1E2A',
    marginBottom: 10,
  },
  sendBtn: {
    position: 'absolute', right: 24, bottom: 20, width: 44, height: 44,
    borderRadius: 22, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center',
  },
  sendBtnOff: { backgroundColor: '#1A1A25' },
  sendIcon: { fontSize: 20, fontWeight: '700', color: '#FFF' },
});
