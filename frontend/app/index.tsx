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

const { width } = Dimensions.get('window');

type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
};

// MLC LLM Integration
let mlcModule: any = null;
let isMLCLoaded = false;

const loadMLC = async () => {
  if (!mlcModule) {
    try {
      mlcModule = require('@react-native-ai/mlc');
      isMLCLoaded = true;
    } catch (e) {
      console.error('Failed to load MLC:', e);
    }
  }
  return mlcModule;
};

export default function JarvisChat() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isModelReady, setIsModelReady] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [modelStatus, setModelStatus] = useState('Initializing...');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  const scrollViewRef = useRef<ScrollView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const mlcRef = useRef<any>(null);

  // Initialize MLC LLM
  useEffect(() => {
    const initMLC = async () => {
      try {
        setModelStatus('Loading AI engine...');
        const mlc = await loadMLC();
        
        if (!mlc) {
          setError('Failed to load AI engine');
          return;
        }

        setModelStatus('Preparing model...');
        
        // Check if there's a downloadModel or similar function
        if (mlc.downloadModel) {
          setModelStatus('Downloading model...');
          await mlc.downloadModel({
            model: 'SmolLM2-360M-Instruct-q4f16_1-MLC', // Small model for testing
            onProgress: (progress: number) => {
              setDownloadProgress(progress);
              setModelStatus(`Downloading... ${Math.round(progress * 100)}%`);
            },
          });
        }

        mlcRef.current = mlc;
        setIsModelReady(true);
        setModelStatus('Ready');
        
      } catch (err: any) {
        console.error('MLC init error:', err);
        setError(err.message || 'Failed to initialize AI');
        setModelStatus('Error');
      }
    };

    initMLC();
  }, []);

  // Pulse animation
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

  // Auto-scroll
  useEffect(() => {
    if (scrollViewRef.current && messages.length > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!inputText.trim() || !isModelReady || isGenerating) return;

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
    setIsGenerating(true);

    try {
      const mlc = mlcRef.current;
      
      if (mlc && mlc.generateText) {
        const response = await mlc.generateText({
          prompt: userInput,
          maxTokens: 500,
          temperature: 0.7,
        });

        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (updated[lastIdx]?.role === 'assistant') {
            updated[lastIdx].content = response.text || response || 'No response generated.';
          }
          return updated;
        });
      } else {
        // Fallback response for testing
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (updated[lastIdx]?.role === 'assistant') {
            updated[lastIdx].content = 'MLC LLM engine loaded. Model integration in progress.';
          }
          return updated;
        });
      }
    } catch (err: any) {
      console.error('Generation error:', err);
      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role === 'assistant') {
          updated[lastIdx].content = `Error: ${err.message || 'Failed to generate response'}`;
        }
        return updated;
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
  };

  const renderMessage = (message: Message) => {
    const isUser = message.role === 'user';
    const isCurrentlyGenerating = isGenerating && message.role === 'assistant' && message === messages[messages.length - 1];
    
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
        <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.assistantBubble]}>
          <Text style={[styles.messageText, isUser && styles.userMessageText]}>
            {message.content || (isCurrentlyGenerating ? 'Thinking...' : '')}
          </Text>
          {isCurrentlyGenerating && (
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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerLeft}>
          <Animated.View
            style={[
              styles.jarvisOrb,
              { transform: [{ scale: pulseAnim }] },
              isModelReady && styles.jarvisOrbReady,
            ]}
          >
            <Ionicons name="planet" size={28} color={isModelReady ? "#00FF88" : "#00D9FF"} />
          </Animated.View>
          <View>
            <Text style={styles.headerTitle}>JARVIS</Text>
            <Text style={[styles.headerSubtitle, isModelReady && styles.headerSubtitleReady]}>
              {isModelReady ? 'Local AI • Online' : modelStatus}
            </Text>
          </View>
        </View>
        <TouchableOpacity style={styles.clearButton} onPress={clearChat}>
          <Ionicons name="trash-outline" size={22} color="#666" />
        </TouchableOpacity>
      </View>

      {/* Download Progress */}
      {downloadProgress > 0 && downloadProgress < 1 && (
        <View style={styles.progressContainer}>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBar, { width: `${downloadProgress * 100}%` }]} />
          </View>
          <Text style={styles.progressText}>{modelStatus}</Text>
        </View>
      )}

      {/* Error Banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Ionicons name="warning" size={20} color="#FF6B6B" />
          <Text style={styles.errorText}>{error}</Text>
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
            <Animated.View style={[styles.emptyOrb, { transform: [{ scale: pulseAnim }] }]}>
              <Ionicons name="sparkles" size={48} color="#00D9FF" />
            </Animated.View>
            <Text style={styles.emptyTitle}>Hello, I'm Jarvis</Text>
            <Text style={styles.emptySubtitle}>
              {isModelReady 
                ? 'Your standalone AI assistant is ready. I run completely offline on your device.'
                : `${modelStatus}. Please wait...`}
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
            placeholder={isModelReady ? "Message Jarvis..." : "Loading..."}
            placeholderTextColor="#666"
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={2000}
            editable={isModelReady && !isGenerating}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              (!inputText.trim() || !isModelReady || isGenerating) && styles.sendButtonDisabled,
            ]}
            onPress={sendMessage}
            disabled={!inputText.trim() || !isModelReady || isGenerating}
          >
            {isGenerating ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Ionicons name="send" size={22} color="#FFF" />
            )}
          </TouchableOpacity>
        </View>
        <Text style={styles.statusText}>
          {isGenerating ? 'Generating...' : isModelReady ? 'MLC LLM • Local AI' : modelStatus}
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0F',
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
  statusText: {
    fontSize: 11,
    color: '#555',
    textAlign: 'center',
    marginTop: 10,
  },
});
