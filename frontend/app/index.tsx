import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useExecutorchStatus } from './_layout';

const { width } = Dimensions.get('window');

// Lazy load the LLM hook only when needed
let useLLMHook: any = null;
let LLAMA_MODEL: any = null;

const loadLLM = () => {
  if (!useLLMHook) {
    const executorch = require('react-native-executorch');
    useLLMHook = executorch.useLLM;
    LLAMA_MODEL = executorch.LLAMA3_2_1B;
  }
  return { useLLM: useLLMHook, LLAMA3_2_1B: LLAMA_MODEL };
};

type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
};

// Wrapper component that uses the LLM
function JarvisChatWithLLM() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const scrollViewRef = useRef<ScrollView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Load LLM dynamically
  const { useLLM, LLAMA3_2_1B } = loadLLM();
  
  // Initialize local LLM - Llama 3.2 1B
  const llm = useLLM({
    model: LLAMA3_2_1B,
  });

  // Pulse animation for Jarvis orb
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollViewRef.current) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages, llm.response]);

  // Update assistant message with streaming response
  useEffect(() => {
    if (llm.response && llm.isModelGenerating) {
      setMessages((prev) => {
        const lastMessage = prev[prev.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
          return prev.map((msg, idx) =>
            idx === prev.length - 1
              ? { ...msg, content: llm.response }
              : msg
          );
        }
        return prev;
      });
    }
  }, [llm.response, llm.isModelGenerating]);

  const sendMessage = async () => {
    if (!inputText.trim() || !llm.isModelReady || llm.isModelGenerating) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputText.trim(),
      timestamp: new Date(),
    };

    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    const userInput = inputText.trim();
    setInputText('');

    try {
      const chatHistory = [
        {
          role: 'system' as const,
          content: 'You are Jarvis, a highly intelligent AI assistant running locally on this iPhone. You are helpful, concise, and friendly. You help with trading analysis, content creation, book writing, and business planning. Keep responses focused and practical.',
        },
        ...messages.slice(-6).map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user' as const, content: userInput },
      ];

      await llm.generate(chatHistory);

      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role === 'assistant') {
          updated[lastIdx].content = llm.response || 'I apologize, I could not generate a response.';
        }
        return updated;
      });
    } catch (error: any) {
      console.error('Generation error:', error);
      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role === 'assistant') {
          updated[lastIdx].content = `Error: ${error.message || 'Failed to generate response'}`;
        }
        return updated;
      });
    }
  };

  const stopGeneration = () => {
    llm.interrupt();
  };

  const clearChat = () => {
    setMessages([]);
  };

  const renderMessage = (message: Message) => {
    const isUser = message.role === 'user';
    const isGenerating = llm.isModelGenerating && message.role === 'assistant' && message === messages[messages.length - 1];
    
    return (
      <View
        key={message.id}
        style={[
          styles.messageContainer,
          isUser ? styles.userMessageContainer : styles.assistantMessageContainer,
        ]}
      >
        {!isUser && (
          <View style={styles.avatarContainer}>
            <Ionicons name="hardware-chip" size={20} color="#00D9FF" />
          </View>
        )}
        <View
          style={[
            styles.messageBubble,
            isUser ? styles.userBubble : styles.assistantBubble,
          ]}
        >
          <Text style={[styles.messageText, isUser && styles.userMessageText]}>
            {message.content || (isGenerating ? '...' : '')}
          </Text>
          {isGenerating && (
            <ActivityIndicator size="small" color="#00D9FF" style={{ marginTop: 8 }} />
          )}
        </View>
        {isUser && (
          <View style={styles.avatarContainer}>
            <Ionicons name="person" size={20} color="#7B61FF" />
          </View>
        )}
      </View>
    );
  };

  const getStatusText = () => {
    if (llm.error) return `Error: ${llm.error.message}`;
    if (llm.isModelGenerating) return 'Generating response...';
    if (llm.isModelReady) return 'Llama 3.2 1B • Ready';
    if (llm.downloadProgress > 0 && llm.downloadProgress < 1) {
      return `Downloading model... ${Math.round(llm.downloadProgress * 100)}%`;
    }
    return 'Initializing Llama 3.2...';
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerLeft}>
          <Animated.View
            style={[
              styles.jarvisOrb,
              { transform: [{ scale: pulseAnim }] },
              llm.isModelReady && styles.jarvisOrbReady,
            ]}
          >
            <Ionicons name="planet" size={28} color={llm.isModelReady ? "#00FF88" : "#00D9FF"} />
          </Animated.View>
          <View>
            <Text style={styles.headerTitle}>JARVIS</Text>
            <Text style={[styles.headerSubtitle, llm.isModelReady && styles.headerSubtitleReady]}>
              {llm.isModelReady ? 'Local AI • Online' : 'Initializing...'}
            </Text>
          </View>
        </View>
        <TouchableOpacity style={styles.clearButton} onPress={clearChat}>
          <Ionicons name="trash-outline" size={22} color="#666" />
        </TouchableOpacity>
      </View>

      {/* Download Progress */}
      {llm.downloadProgress > 0 && llm.downloadProgress < 1 && (
        <View style={styles.progressContainer}>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBar, { width: `${llm.downloadProgress * 100}%` }]} />
          </View>
          <Text style={styles.progressText}>
            Downloading Llama 3.2 1B... {Math.round(llm.downloadProgress * 100)}%
          </Text>
        </View>
      )}

      {/* Error Banner */}
      {llm.error && (
        <View style={styles.errorBanner}>
          <Ionicons name="warning" size={20} color="#FF6B6B" />
          <Text style={styles.errorText}>{llm.error.message}</Text>
        </View>
      )}

      {/* Chat Messages */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.messagesContainer}
        contentContainerStyle={styles.messagesContent}
        showsVerticalScrollIndicator={false}
      >
        {messages.length === 0 && (
          <View style={styles.emptyState}>
            <Animated.View
              style={[
                styles.emptyOrb,
                { transform: [{ scale: pulseAnim }] },
              ]}
            >
              <Ionicons name="sparkles" size={48} color="#00D9FF" />
            </Animated.View>
            <Text style={styles.emptyTitle}>Hello, I'm Jarvis</Text>
            <Text style={styles.emptySubtitle}>
              {llm.isModelReady 
                ? 'Your standalone AI assistant is ready. I run completely offline on your device.'
                : 'Loading Llama 3.2 1B model. This may take a moment on first launch...'}
            </Text>
            
            <View style={styles.capabilitiesContainer}>
              <View style={styles.capabilityItem}>
                <Ionicons name="chatbubbles" size={24} color="#7B61FF" />
                <Text style={styles.capabilityText}>Chat & Assistance</Text>
              </View>
              <View style={styles.capabilityItem}>
                <Ionicons name="trending-up" size={24} color="#00D9FF" />
                <Text style={styles.capabilityText}>Trading Analysis</Text>
              </View>
              <View style={styles.capabilityItem}>
                <Ionicons name="book" size={24} color="#FF6B9D" />
                <Text style={styles.capabilityText}>Content Creation</Text>
              </View>
              <View style={styles.capabilityItem}>
                <Ionicons name="business" size={24} color="#4ECDC4" />
                <Text style={styles.capabilityText}>Business Planning</Text>
              </View>
            </View>

            <View style={styles.privacyBadge}>
              <Ionicons name="shield-checkmark" size={18} color="#4ECDC4" />
              <Text style={styles.privacyText}>100% Private • Offline • No Cloud</Text>
            </View>
          </View>
        )}
        {messages.map(renderMessage)}
      </ScrollView>

      {/* Input Area */}
      <View style={[styles.inputContainer, { paddingBottom: Math.max(insets.bottom, 10) + 10 }]}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.textInput}
            placeholder={llm.isModelReady ? "Message Jarvis..." : "Loading model..."}
            placeholderTextColor="#666"
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={2000}
            editable={llm.isModelReady && !llm.isModelGenerating}
          />
          {llm.isModelGenerating ? (
            <TouchableOpacity style={styles.stopButton} onPress={stopGeneration}>
              <Ionicons name="stop" size={24} color="#FF6B6B" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[
                styles.sendButton,
                (!inputText.trim() || !llm.isModelReady) && styles.sendButtonDisabled,
              ]}
              onPress={sendMessage}
              disabled={!inputText.trim() || !llm.isModelReady}
            >
              {!llm.isModelReady ? (
                <ActivityIndicator size="small" color="#00D9FF" />
              ) : (
                <Ionicons name="send" size={22} color="#FFF" />
              )}
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.statusText}>{getStatusText()}</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

// Error display component
function InitializationError({ error }: { error: string }) {
  const insets = useSafeAreaInsets();
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.1, duration: 1500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.errorContainer}>
        <Animated.View style={[styles.emptyOrb, { transform: [{ scale: pulseAnim }] }]}>
          <Ionicons name="warning" size={48} color="#FF6B6B" />
        </Animated.View>
        <Text style={styles.emptyTitle}>Initialization Error</Text>
        <Text style={styles.errorMessage}>{error}</Text>
        <Text style={styles.errorHint}>
          Please restart the app. If the problem persists, your device may not support local AI models.
        </Text>
      </View>
    </View>
  );
}

// Main component that checks initialization status
export default function JarvisChat() {
  const { isReady, error } = useExecutorchStatus();

  if (error) {
    return <InitializationError error={error} />;
  }

  if (!isReady) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00D9FF" />
        <Text style={styles.loadingText}>Preparing AI Engine...</Text>
      </View>
    );
  }

  return <JarvisChatWithLLM />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0F',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0A0A0F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#00D9FF',
    fontSize: 16,
    marginTop: 16,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
  },
  errorMessage: {
    color: '#FF6B6B',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 20,
  },
  errorHint: {
    color: '#666',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A25',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  jarvisOrb: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 217, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(0, 217, 255, 0.3)',
  },
  jarvisOrbReady: {
    backgroundColor: 'rgba(0, 255, 136, 0.1)',
    borderColor: 'rgba(0, 255, 136, 0.3)',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#00D9FF',
    marginTop: 2,
  },
  headerSubtitleReady: {
    color: '#00FF88',
  },
  clearButton: {
    padding: 10,
  },
  progressContainer: {
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: '#12121A',
  },
  progressBarBg: {
    height: 6,
    backgroundColor: '#1A1A25',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#00D9FF',
    borderRadius: 3,
  },
  progressText: {
    color: '#888',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 13,
    flex: 1,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    padding: 16,
    paddingBottom: 20,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 30,
    paddingHorizontal: 20,
  },
  emptyOrb: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(0, 217, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(0, 217, 255, 0.2)',
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  emptySubtitle: {
    fontSize: 15,
    color: '#888',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
    paddingHorizontal: 10,
  },
  capabilitiesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 24,
  },
  capabilityItem: {
    alignItems: 'center',
    backgroundColor: '#12121A',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1A1A25',
    width: (width - 72) / 2,
    minWidth: 140,
  },
  capabilityText: {
    color: '#CCC',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  privacyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(78, 205, 196, 0.1)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  privacyText: {
    color: '#4ECDC4',
    fontSize: 12,
    fontWeight: '500',
  },
  messageContainer: {
    flexDirection: 'row',
    marginBottom: 16,
    alignItems: 'flex-start',
  },
  userMessageContainer: {
    justifyContent: 'flex-end',
  },
  assistantMessageContainer: {
    justifyContent: 'flex-start',
  },
  avatarContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1A1A25',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
  },
  messageBubble: {
    maxWidth: '75%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  userBubble: {
    backgroundColor: '#7B61FF',
    borderBottomRightRadius: 6,
  },
  assistantBubble: {
    backgroundColor: '#1A1A25',
    borderBottomLeftRadius: 6,
  },
  messageText: {
    fontSize: 15,
    color: '#E0E0E0',
    lineHeight: 22,
  },
  userMessageText: {
    color: '#FFFFFF',
  },
  inputContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: '#0A0A0F',
    borderTopWidth: 1,
    borderTopColor: '#1A1A25',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#12121A',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 14,
    fontSize: 16,
    color: '#FFFFFF',
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#1A1A25',
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#1A1A25',
  },
  stopButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 107, 107, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    fontSize: 11,
    color: '#555',
    textAlign: 'center',
    marginTop: 10,
  },
});
