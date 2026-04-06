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
  Animated,
  Dimensions,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';

const { width } = Dimensions.get('window');

const BACKEND_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL
  || process.env.EXPO_PUBLIC_BACKEND_URL
  || '';

type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  tradingData?: any;
};

// ─── Trading Data Card Component ──────────────────────────────────
function TradingCard({ data }: { data: any }) {
  if (!data) return null;

  // Portfolio display
  if (data.balances) {
    return (
      <View style={cardStyles.container}>
        <View style={cardStyles.header}>
          <Ionicons name="wallet" size={18} color="#00FF88" />
          <Text style={cardStyles.headerText}>Portfolio</Text>
          {data.can_trade && (
            <View style={cardStyles.badge}>
              <Text style={cardStyles.badgeText}>Trading Enabled</Text>
            </View>
          )}
        </View>
        {data.balances.map((b: any, i: number) => (
          <View key={i} style={cardStyles.row}>
            <Text style={cardStyles.asset}>{b.asset}</Text>
            <View style={cardStyles.values}>
              <Text style={cardStyles.amount}>{b.total.toFixed(8)}</Text>
              {b.locked > 0 && (
                <Text style={cardStyles.locked}>({b.locked.toFixed(4)} locked)</Text>
              )}
            </View>
          </View>
        ))}
        {data.balances.length === 0 && (
          <Text style={cardStyles.empty}>No holdings found</Text>
        )}
      </View>
    );
  }

  // Price display
  if (data.prices) {
    return (
      <View style={cardStyles.container}>
        <View style={cardStyles.header}>
          <Ionicons name="trending-up" size={18} color="#00D9FF" />
          <Text style={cardStyles.headerText}>Market Prices</Text>
        </View>
        {data.prices.map((p: any, i: number) => (
          <View key={i} style={cardStyles.row}>
            <Text style={cardStyles.asset}>{p.symbol.replace('USDT', '')}</Text>
            <Text style={cardStyles.price}>${p.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
          </View>
        ))}
      </View>
    );
  }

  // Single price
  if (data.symbol && data.price) {
    return (
      <View style={cardStyles.container}>
        <View style={cardStyles.header}>
          <Ionicons name="analytics" size={18} color="#00D9FF" />
          <Text style={cardStyles.headerText}>{data.symbol}</Text>
        </View>
        <Text style={cardStyles.bigPrice}>${Number(data.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
      </View>
    );
  }

  // Trade result
  if (data.orderId || data.status === 'success') {
    return (
      <View style={[cardStyles.container, { borderColor: 'rgba(0, 255, 136, 0.3)' }]}>
        <View style={cardStyles.header}>
          <Ionicons name="checkmark-circle" size={18} color="#00FF88" />
          <Text style={[cardStyles.headerText, { color: '#00FF88' }]}>Trade Executed</Text>
        </View>
        <View style={cardStyles.row}>
          <Text style={cardStyles.label}>Order ID</Text>
          <Text style={cardStyles.value}>{data.orderId}</Text>
        </View>
        <View style={cardStyles.row}>
          <Text style={cardStyles.label}>Symbol</Text>
          <Text style={cardStyles.value}>{data.symbol}</Text>
        </View>
        <View style={cardStyles.row}>
          <Text style={cardStyles.label}>Side</Text>
          <Text style={[cardStyles.value, { color: data.side === 'BUY' ? '#00FF88' : '#FF6B6B' }]}>{data.side}</Text>
        </View>
        <View style={cardStyles.row}>
          <Text style={cardStyles.label}>Quantity</Text>
          <Text style={cardStyles.value}>{data.quantity}</Text>
        </View>
        <View style={cardStyles.row}>
          <Text style={cardStyles.label}>Status</Text>
          <Text style={cardStyles.value}>{data.status_detail || data.status}</Text>
        </View>
      </View>
    );
  }

  // Trade history
  if (data.trades) {
    return (
      <View style={cardStyles.container}>
        <View style={cardStyles.header}>
          <Ionicons name="time" size={18} color="#7B61FF" />
          <Text style={cardStyles.headerText}>Recent Trades</Text>
        </View>
        {data.trades.map((t: any, i: number) => (
          <View key={i} style={[cardStyles.row, { paddingVertical: 8 }]}>
            <View>
              <Text style={cardStyles.asset}>{t.symbol}</Text>
              <Text style={cardStyles.locked}>{t.time?.split('T')[0]}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[cardStyles.value, { color: t.side === 'BUY' ? '#00FF88' : '#FF6B6B' }]}>
                {t.side} {t.quantity}
              </Text>
              <Text style={cardStyles.locked}>@ ${t.price}</Text>
            </View>
          </View>
        ))}
        {data.trades.length === 0 && (
          <Text style={cardStyles.empty}>No recent trades</Text>
        )}
      </View>
    );
  }

  // Error
  if (data.error) {
    return (
      <View style={[cardStyles.container, { borderColor: 'rgba(255, 107, 107, 0.3)' }]}>
        <View style={cardStyles.header}>
          <Ionicons name="alert-circle" size={18} color="#FF6B6B" />
          <Text style={[cardStyles.headerText, { color: '#FF6B6B' }]}>Error</Text>
        </View>
        <Text style={cardStyles.errorText}>{data.error}</Text>
      </View>
    );
  }

  return null;
}

const cardStyles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(20, 20, 35, 0.9)',
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 217, 255, 0.2)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  headerText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  badge: {
    backgroundColor: 'rgba(0, 255, 136, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeText: {
    color: '#00FF88',
    fontSize: 10,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  asset: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  values: {
    alignItems: 'flex-end',
  },
  amount: {
    color: '#DDD',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  locked: {
    color: '#666',
    fontSize: 11,
  },
  price: {
    color: '#00D9FF',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  bigPrice: {
    color: '#00D9FF',
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 8,
  },
  label: {
    color: '#888',
    fontSize: 13,
  },
  value: {
    color: '#DDD',
    fontSize: 13,
    fontWeight: '500',
  },
  empty: {
    color: '#555',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 10,
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 13,
  },
});


// ─── Main Chat Screen ─────────────────────────────────────────────
export default function JarvisChat() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [binanceConnected, setBinanceConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollViewRef = useRef<ScrollView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  // Check backend health on mount
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/health`);
        const data = await res.json();
        setIsOnline(data.status === 'online' && data.openai_configured);
        setBinanceConnected(data.binance_configured === true);
        if (!data.openai_configured) {
          setError('OpenAI API key not configured on server');
        }
      } catch {
        setIsOnline(false);
      }
    };
    checkHealth();
  }, []);

  // Pulse animation
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 2000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  // Glow animation when generating
  useEffect(() => {
    if (isGenerating) {
      const glow = Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1, duration: 800, useNativeDriver: false }),
          Animated.timing(glowAnim, { toValue: 0, duration: 800, useNativeDriver: false }),
        ])
      );
      glow.start();
      return () => glow.stop();
    } else {
      glowAnim.setValue(0);
    }
  }, [isGenerating]);

  // Auto-scroll
  useEffect(() => {
    if (scrollViewRef.current && messages.length > 0) {
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  const sendMessage = useCallback(async () => {
    if (!inputText.trim() || isGenerating) return;
    Keyboard.dismiss();

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
    setError(null);

    try {
      const conversationHistory = [...messages, userMessage]
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: conversationHistory,
          model: 'gpt-4o',
          temperature: 0.7,
          max_tokens: 2000,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Server error ${res.status}`);
      }

      const data = await res.json();

      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role === 'assistant') {
          updated[lastIdx] = {
            ...updated[lastIdx],
            content: data.content || 'No response received.',
            tradingData: data.trading_data || undefined,
          };
        }
        return updated;
      });
    } catch (err: any) {
      console.error('Chat error:', err);
      setError(err.message || 'Failed to get response');
      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role === 'assistant') {
          updated[lastIdx] = {
            ...updated[lastIdx],
            content: 'I encountered an error, sir. Please try again.',
          };
        }
        return updated;
      });
    } finally {
      setIsGenerating(false);
    }
  }, [inputText, isGenerating, messages]);

  const clearChat = () => {
    setMessages([]);
    setError(null);
  };

  const renderMessage = (message: Message) => {
    const isUser = message.role === 'user';
    const isCurrentlyGenerating =
      isGenerating && message.role === 'assistant' && message.id === messages[messages.length - 1]?.id;

    return (
      <View
        key={message.id}
        style={[styles.messageContainer, isUser ? styles.userMessageContainer : styles.assistantMessageContainer]}
      >
        {!isUser && (
          <View style={styles.avatarContainer}>
            <Ionicons name="hardware-chip" size={18} color="#00D9FF" />
          </View>
        )}
        <View style={{ maxWidth: '78%' }}>
          <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.assistantBubble]}>
            <Text style={[styles.messageText, isUser && styles.userMessageText]}>
              {message.content || (isCurrentlyGenerating ? 'Thinking...' : '')}
            </Text>
            {isCurrentlyGenerating && !message.content && (
              <ActivityIndicator size="small" color="#00D9FF" style={{ marginTop: 6 }} />
            )}
          </View>
          {message.tradingData && <TradingCard data={message.tradingData} />}
        </View>
        {isUser && (
          <View style={[styles.avatarContainer, styles.userAvatar]}>
            <Ionicons name="person" size={18} color="#7B61FF" />
          </View>
        )}
      </View>
    );
  };

  const orbBorderColor = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(0, 217, 255, 0.3)', 'rgba(0, 217, 255, 0.8)'],
  });

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerLeft}>
          <Animated.View
            style={[
              styles.jarvisOrb,
              {
                transform: [{ scale: pulseAnim }],
                borderColor: isGenerating ? orbBorderColor : isOnline ? 'rgba(0, 255, 136, 0.4)' : 'rgba(255, 107, 107, 0.4)',
              },
              isOnline && !isGenerating && styles.jarvisOrbOnline,
            ]}
          >
            <Ionicons name="planet" size={26} color={isGenerating ? '#00D9FF' : isOnline ? '#00FF88' : '#FF6B6B'} />
          </Animated.View>
          <View>
            <Text style={styles.headerTitle}>JARVIS</Text>
            <View style={styles.statusRow}>
              <Text style={[styles.headerSubtitle, isOnline ? styles.headerSubtitleOnline : styles.headerSubtitleOffline]}>
                {isGenerating ? 'Processing...' : isOnline ? 'GPT-4o' : 'Offline'}
              </Text>
              {binanceConnected && (
                <View style={styles.binanceBadge}>
                  <Text style={styles.binanceBadgeText}>Binance</Text>
                </View>
              )}
            </View>
          </View>
        </View>
        <TouchableOpacity style={styles.clearButton} onPress={clearChat}>
          <Ionicons name="trash-outline" size={22} color="#555" />
        </TouchableOpacity>
      </View>

      {/* Error Banner */}
      {error && (
        <TouchableOpacity style={styles.errorBanner} onPress={() => setError(null)}>
          <Ionicons name="warning" size={18} color="#FF6B6B" />
          <Text style={styles.errorText} numberOfLines={2}>{error}</Text>
          <Ionicons name="close-circle" size={16} color="#666" />
        </TouchableOpacity>
      )}

      {/* Chat Messages */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.messagesContainer}
        contentContainerStyle={styles.messagesContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 && (
          <View style={styles.emptyState}>
            <Animated.View style={[styles.emptyOrb, { transform: [{ scale: pulseAnim }] }]}>
              <Ionicons name="sparkles" size={44} color="#00D9FF" />
            </Animated.View>
            <Text style={styles.emptyTitle}>Hello, I'm Jarvis</Text>
            <Text style={styles.emptySubtitle}>
              {isOnline
                ? 'Your personal AI assistant with direct Binance trading. How can I help you, sir?'
                : 'Connecting to server...'}
            </Text>

            <View style={styles.capabilitiesContainer}>
              {[
                { icon: 'chatbubbles' as const, label: 'Chat & Assistance', color: '#7B61FF', prompt: "Hi Jarvis, what can you help me with?" },
                { icon: 'trending-up' as const, label: 'Check Portfolio', color: '#00FF88', prompt: "Show me my Binance portfolio" },
                { icon: 'analytics' as const, label: 'Market Prices', color: '#00D9FF', prompt: "What are the current crypto prices?" },
                { icon: 'swap-horizontal' as const, label: 'Trade Crypto', color: '#FF6B9D', prompt: "I want to buy some Bitcoin" },
                { icon: 'book' as const, label: 'Content Creation', color: '#FFD93D', prompt: "Help me brainstorm ideas for a new project." },
                { icon: 'business' as const, label: 'Business Planning', color: '#4ECDC4', prompt: "I need help creating a business plan outline." },
              ].map((cap) => (
                <TouchableOpacity
                  key={cap.label}
                  style={styles.capabilityItem}
                  onPress={() => {
                    if (!isOnline) return;
                    setInputText(cap.prompt);
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name={cap.icon} size={22} color={cap.color} />
                  <Text style={styles.capabilityText}>{cap.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.poweredBadge}>
              <Ionicons name="flash" size={16} color="#00D9FF" />
              <Text style={styles.poweredText}>GPT-4o + Binance Trading</Text>
            </View>
          </View>
        )}
        {messages.map(renderMessage)}
      </ScrollView>

      {/* Input Area */}
      <View style={[styles.inputContainer, { paddingBottom: Math.max(insets.bottom, 10) + 8 }]}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.textInput}
            placeholder={isOnline ? 'Message Jarvis...' : 'Connecting...'}
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
            testID="send-button"
            accessibilityRole="button"
            accessibilityLabel="Send message"
            style={[styles.sendButton, (!inputText.trim() || isGenerating) && styles.sendButtonDisabled]}
            onPress={sendMessage}
            disabled={!inputText.trim() || isGenerating}
            activeOpacity={0.7}
          >
            {isGenerating ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Ionicons name="send" size={20} color="#FFF" />
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A25',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  jarvisOrb: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: 'rgba(0, 217, 255, 0.08)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(0, 217, 255, 0.3)',
  },
  jarvisOrbOnline: { backgroundColor: 'rgba(0, 255, 136, 0.08)' },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#FFFFFF', letterSpacing: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  headerSubtitle: { fontSize: 12, color: '#00D9FF' },
  headerSubtitleOnline: { color: '#00FF88' },
  headerSubtitleOffline: { color: '#FF6B6B' },
  binanceBadge: {
    backgroundColor: 'rgba(243, 186, 47, 0.15)',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
  },
  binanceBadgeText: { color: '#F3BA2F', fontSize: 10, fontWeight: '600' },
  clearButton: { padding: 10, borderRadius: 20 },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingVertical: 10,
    backgroundColor: 'rgba(255, 107, 107, 0.08)',
    borderBottomWidth: 1, borderBottomColor: 'rgba(255, 107, 107, 0.15)',
  },
  errorText: { color: '#FF6B6B', fontSize: 13, flex: 1 },
  messagesContainer: { flex: 1 },
  messagesContent: { padding: 16, paddingBottom: 20 },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 20, paddingHorizontal: 16 },
  emptyOrb: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: 'rgba(0, 217, 255, 0.08)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(0, 217, 255, 0.2)',
    marginBottom: 20,
  },
  emptyTitle: { fontSize: 26, fontWeight: '700', color: '#FFFFFF', marginBottom: 10 },
  emptySubtitle: { fontSize: 15, color: '#888', textAlign: 'center', lineHeight: 22, marginBottom: 20, paddingHorizontal: 10 },
  capabilitiesContainer: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginBottom: 20,
  },
  capabilityItem: {
    alignItems: 'center', backgroundColor: '#12121A',
    paddingVertical: 14, paddingHorizontal: 10,
    borderRadius: 14, borderWidth: 1, borderColor: '#1E1E2A',
    width: (width - 64) / 3, minWidth: 100,
  },
  capabilityText: { color: '#BBB', fontSize: 11, marginTop: 8, textAlign: 'center', fontWeight: '500' },
  poweredBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0, 217, 255, 0.08)',
    paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20,
  },
  poweredText: { color: '#00D9FF', fontSize: 12, fontWeight: '500' },
  messageContainer: { flexDirection: 'row', marginBottom: 14, alignItems: 'flex-start' },
  userMessageContainer: { justifyContent: 'flex-end' },
  assistantMessageContainer: { justifyContent: 'flex-start' },
  avatarContainer: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#14141F', alignItems: 'center', justifyContent: 'center',
    marginHorizontal: 8, borderWidth: 1, borderColor: '#1E1E2A',
  },
  userAvatar: { backgroundColor: 'rgba(123, 97, 255, 0.15)', borderColor: 'rgba(123, 97, 255, 0.3)' },
  messageBubble: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20 },
  userBubble: { backgroundColor: '#7B61FF', borderBottomRightRadius: 6 },
  assistantBubble: { backgroundColor: '#14141F', borderBottomLeftRadius: 6, borderWidth: 1, borderColor: '#1E1E2A' },
  messageText: { fontSize: 15, color: '#E0E0E0', lineHeight: 22 },
  userMessageText: { color: '#FFFFFF' },
  inputContainer: {
    paddingHorizontal: 16, paddingTop: 10,
    backgroundColor: '#0A0A0F', borderTopWidth: 1, borderTopColor: '#1A1A25',
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  textInput: {
    flex: 1, backgroundColor: '#12121A', borderRadius: 24,
    paddingHorizontal: 20, paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    fontSize: 16, color: '#FFFFFF', maxHeight: 120,
    borderWidth: 1, borderColor: '#1E1E2A',
  },
  sendButton: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center',
  },
  sendButtonDisabled: { backgroundColor: '#1A1A25' },
});
