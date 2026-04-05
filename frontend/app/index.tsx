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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');
const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
};

export default function JarvisChat() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const scrollViewRef = useRef<ScrollView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  
  // LLM State for native
  const [llmReady, setLlmReady] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);

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

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollViewRef.current && messages.length > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!inputText.trim()) return;
    
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputText.trim(),
      timestamp: new Date(),
    };

    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: isNative 
        ? 'To use local Llama 3.2, you need to build this app with Xcode. The react-native-executorch library requires a development build.\n\nSteps:\n1. Run: npx expo prebuild --platform ios\n2. Open ios folder in Xcode\n3. Build and run on your iPhone'
        : 'Please open this app on your iPhone to use the local Llama 3.2 model. The web preview cannot run local AI models.',
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInputText('');
  };

  const clearChat = () => {
    setMessages([]);
  };

  const renderMessage = (message: Message) => {
    const isUser = message.role === 'user';
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
            {message.content}
          </Text>
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
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerLeft}>
          <Animated.View
            style={[
              styles.jarvisOrb,
              { transform: [{ scale: pulseAnim }] },
            ]}
          >
            <Ionicons name="planet" size={28} color="#00D9FF" />
          </Animated.View>
          <View>
            <Text style={styles.headerTitle}>JARVIS</Text>
            <Text style={styles.headerSubtitle}>
              {isNative ? 'Local AI • Requires Dev Build' : 'Local AI • iPhone Required'}
            </Text>
          </View>
        </View>
        <TouchableOpacity style={styles.clearButton} onPress={clearChat}>
          <Ionicons name="trash-outline" size={22} color="#666" />
        </TouchableOpacity>
      </View>

      {/* Info Banner */}
      <View style={styles.infoBanner}>
        <Ionicons name="information-circle" size={20} color="#00D9FF" />
        <Text style={styles.infoBannerText}>
          {isNative 
            ? 'Development build required for local LLM'
            : 'Open on iPhone with Expo Go or Dev Build'}
        </Text>
      </View>

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
              Your standalone AI assistant powered by Llama 3.2 running locally on your device.
            </Text>
            
            {/* Capabilities */}
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

            {/* Setup Instructions */}
            <View style={styles.setupCard}>
              <Text style={styles.setupTitle}>Setup Instructions</Text>
              
              <View style={styles.setupStep}>
                <View style={styles.stepBadge}>
                  <Text style={styles.stepBadgeText}>1</Text>
                </View>
                <View style={styles.setupStepContent}>
                  <Text style={styles.setupStepTitle}>Prerequisites</Text>
                  <Text style={styles.setupStepText}>Mac with Xcode, iPhone 12+ with iOS 17+</Text>
                </View>
              </View>

              <View style={styles.setupStep}>
                <View style={styles.stepBadge}>
                  <Text style={styles.stepBadgeText}>2</Text>
                </View>
                <View style={styles.setupStepContent}>
                  <Text style={styles.setupStepTitle}>Create Dev Build</Text>
                  <Text style={styles.setupStepText}>npx expo prebuild --platform ios</Text>
                </View>
              </View>

              <View style={styles.setupStep}>
                <View style={styles.stepBadge}>
                  <Text style={styles.stepBadgeText}>3</Text>
                </View>
                <View style={styles.setupStepContent}>
                  <Text style={styles.setupStepTitle}>Build with Xcode</Text>
                  <Text style={styles.setupStepText}>Open ios/ folder, build to your iPhone</Text>
                </View>
              </View>

              <View style={styles.setupStep}>
                <View style={styles.stepBadge}>
                  <Text style={styles.stepBadgeText}>4</Text>
                </View>
                <View style={styles.setupStepContent}>
                  <Text style={styles.setupStepTitle}>Download Model</Text>
                  <Text style={styles.setupStepText}>Llama 3.2 1B (~1GB) downloads on first launch</Text>
                </View>
              </View>
            </View>

            {/* Privacy Badge */}
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
            placeholder="Message Jarvis..."
            placeholderTextColor="#666"
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={2000}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              !inputText.trim() && styles.sendButtonDisabled,
            ]}
            onPress={sendMessage}
            disabled={!inputText.trim()}
          >
            <Ionicons name="send" size={22} color="#FFF" />
          </TouchableOpacity>
        </View>
        <Text style={styles.statusText}>
          Llama 3.2 1B • Local On-Device AI
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
  clearButton: {
    padding: 10,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: 'rgba(0, 217, 255, 0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 217, 255, 0.2)',
  },
  infoBannerText: {
    color: '#00D9FF',
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
  setupCard: {
    backgroundColor: '#12121A',
    borderRadius: 20,
    padding: 20,
    width: '100%',
    borderWidth: 1,
    borderColor: '#1A1A25',
    marginBottom: 20,
  },
  setupTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 16,
    textAlign: 'center',
  },
  setupStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  stepBadgeText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 12,
  },
  setupStepContent: {
    flex: 1,
  },
  setupStepTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  setupStepText: {
    fontSize: 12,
    color: '#888',
    lineHeight: 18,
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
