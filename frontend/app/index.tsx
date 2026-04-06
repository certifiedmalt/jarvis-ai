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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Speech from 'expo-speech';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { Audio } from 'expo-av';

const ELEVENLABS_API_KEY = 'sk_8dd9778f172097e391decb1b8ce43845d40fcbdcbf9cb57d';
const ELEVENLABS_VOICE_ID = 'WgsC88oU7oxSBORk8LGd'; // User's custom Jarvis 1 voice
import { parseDeviceActions, executeDeviceAction } from '../utils/deviceActions';

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
  const [autoRead, setAutoRead] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
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

  // TTS functions - ElevenLabs first, iOS TTS fallback
  const soundRef = useRef<Audio.Sound | null>(null);

  const speakText = useCallback(async (text: string, msgId: string) => {
    // Stop any current speech
    if (soundRef.current) {
      await soundRef.current.stopAsync().catch(() => {});
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    const speaking = await Speech.isSpeakingAsync();
    if (speaking) await Speech.stop();

    // Clean text - remove code blocks, action blocks, JSON
    const cleanText = text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\{[\s\S]*?\}/g, '')
      .replace(/\[Device:.*?\]/g, '')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText || cleanText.length < 2) return;

    setIsSpeaking(true);
    setSpeakingMsgId(msgId);

    // Try ElevenLabs first (called from phone directly)
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });

      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': ELEVENLABS_API_KEY,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg',
          },
          body: JSON.stringify({
            text: cleanText.substring(0, 2500),
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability: 0.6,
              similarity_boost: 0.85,
              style: 0.2,
            },
          }),
        }
      );

      if (response.ok) {
        const audioBlob = await response.blob();
        const reader = new FileReader();
        const base64Audio = await new Promise<string>((resolve, reject) => {
          reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(audioBlob);
        });

        const fileUri = FileSystem.cacheDirectory + `jarvis_${Date.now()}.mp3`;
        await FileSystem.writeAsStringAsync(fileUri, base64Audio, {
          encoding: FileSystem.EncodingType.Base64,
        });

        const { sound } = await Audio.Sound.createAsync(
          { uri: fileUri },
          { shouldPlay: true }
        );
        soundRef.current = sound;

        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) {
            setIsSpeaking(false);
            setSpeakingMsgId(null);
            sound.unloadAsync().catch(() => {});
            soundRef.current = null;
          }
        });
        return; // ElevenLabs worked
      }
    } catch (e) {
      console.log('ElevenLabs TTS failed, falling back to device:', e);
    }

    // Fallback to iOS device TTS
    let voiceId: string | undefined;
    try {
      const voices = await Speech.getAvailableVoicesAsync();
      const britishVoice = voices.find(v =>
        v.language === 'en-GB' && v.quality === 'Enhanced'
      ) || voices.find(v =>
        v.language === 'en-GB'
      ) || voices.find(v =>
        v.language.startsWith('en')
      );
      if (britishVoice) voiceId = britishVoice.identifier;
    } catch (e) {}

    const options: Speech.SpeechOptions = {
      language: 'en-GB',
      pitch: 0.95,
      rate: Platform.OS === 'ios' ? 0.52 : 0.9,
      onDone: () => { setIsSpeaking(false); setSpeakingMsgId(null); },
      onStopped: () => { setIsSpeaking(false); setSpeakingMsgId(null); },
      onError: () => { setIsSpeaking(false); setSpeakingMsgId(null); },
    };
    if (voiceId) options.voice = voiceId;
    Speech.speak(cleanText, options);
  }, []);

  const stopSpeaking = useCallback(async () => {
    if (soundRef.current) {
      await soundRef.current.stopAsync().catch(() => {});
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    await Speech.stop();
    setIsSpeaking(false);
    setSpeakingMsgId(null);
  }, []);

  // Auto-read new assistant messages
  useEffect(() => {
    if (!autoRead || messages.length === 0 || isGenerating) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === 'assistant' && lastMsg.content && lastMsg.content.length > 0) {
      speakText(lastMsg.content, lastMsg.id);
    }
  }, [isGenerating]);

  const handleAttachment = (asset: { name: string; uri: string; mimeType: string; size: number }) => {
    if (asset.size > 50 * 1024 * 1024) {
      Alert.alert('File too large', 'Maximum file size is 50MB.');
      return;
    }
    setAttachedFile({
      name: asset.name,
      uri: asset.uri,
      mimeType: asset.mimeType || 'application/octet-stream',
      size: asset.size || 0,
    });
  };

  const pickFromFiles = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets?.[0]) {
        const a = result.assets[0];
        handleAttachment({ name: a.name, uri: a.uri, mimeType: a.mimeType || 'application/octet-stream', size: a.size || 0 });
      }
    } catch (err) {
      console.log('File picker error:', err);
    }
  }, []);

  const pickFromPhotos = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Please allow photo library access in Settings.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.8,
        allowsMultipleSelection: false,
        videoMaxDuration: 120,
      });
      if (!result.canceled && result.assets?.[0]) {
        const a = result.assets[0];
        const name = a.fileName || (a.type === 'video' ? 'video.mp4' : 'photo.jpg');
        const info = await FileSystem.getInfoAsync(a.uri);
        const size = (info as any).size || 0;
        handleAttachment({ name, uri: a.uri, mimeType: a.mimeType || (a.type === 'video' ? 'video/mp4' : 'image/jpeg'), size });
      }
    } catch (err) {
      console.log('Photo picker error:', err);
    }
  }, []);

  const pickFromCamera = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Please allow camera access in Settings.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.8,
        videoMaxDuration: 60,
      });
      if (!result.canceled && result.assets?.[0]) {
        const a = result.assets[0];
        const name = a.fileName || (a.type === 'video' ? 'capture.mp4' : 'capture.jpg');
        const info = await FileSystem.getInfoAsync(a.uri);
        const size = (info as any).size || 0;
        handleAttachment({ name, uri: a.uri, mimeType: a.mimeType || (a.type === 'video' ? 'video/mp4' : 'image/jpeg'), size });
      }
    } catch (err) {
      console.log('Camera error:', err);
    }
  }, []);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const hasString = await Clipboard.hasStringAsync();
      const hasImage = await Clipboard.hasImageAsync();

      if (hasImage) {
        const img = await Clipboard.getImageAsync({ format: 'png' });
        if (img && img.data) {
          // Create a temp file from clipboard image
          const uri = FileSystem.cacheDirectory + 'clipboard_' + Date.now() + '.png';
          await FileSystem.writeAsStringAsync(uri, img.data, { encoding: FileSystem.EncodingType.Base64 });
          const info = await FileSystem.getInfoAsync(uri);
          handleAttachment({ name: 'Pasted Image.png', uri, mimeType: 'image/png', size: (info as any).size || 0 });
        }
      } else if (hasString) {
        const text = await Clipboard.getStringAsync();
        if (text) {
          // Paste text directly into the input
          setInputText(prev => prev + text);
        }
      } else {
        Alert.alert('Clipboard empty', 'Nothing to paste.');
      }
    } catch (err) {
      console.log('Paste error:', err);
    }
  }, []);

  const showAttachOptions = useCallback(() => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Photos & Videos', 'Camera', 'Files', 'Paste'],
          cancelButtonIndex: 0,
        },
        (index) => {
          if (index === 1) pickFromPhotos();
          else if (index === 2) pickFromCamera();
          else if (index === 3) pickFromFiles();
          else if (index === 4) pasteFromClipboard();
        },
      );
    } else {
      // Android fallback - show as alert
      Alert.alert('Attach', 'Choose source', [
        { text: 'Photos & Videos', onPress: pickFromPhotos },
        { text: 'Camera', onPress: pickFromCamera },
        { text: 'Files', onPress: pickFromFiles },
        { text: 'Paste', onPress: pasteFromClipboard },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [pickFromPhotos, pickFromCamera, pickFromFiles, pasteFromClipboard]);

  const removeFile = useCallback(() => {
    setAttachedFile(null);
  }, []);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Process device actions from JARVIS response, execute them, and send results back
  const processDeviceActions = useCallback(async (actions: any[], currentMessages: Message[]) => {
    for (const action of actions) {
      try {
        const result = await executeDeviceAction(action);

        // Add a system message showing the device result
        const deviceResultMsg: Message = {
          id: Date.now().toString() + '_device',
          role: 'assistant',
          content: `[Device: ${action.action}]\n${result}`,
        };

        setMessages(prev => [...prev, deviceResultMsg]);

        // Send the result back to JARVIS for a follow-up response
        const followUpMsg: Message = {
          id: (Date.now() + 2).toString(),
          role: 'assistant',
          content: '',
        };
        setMessages(prev => [...prev, followUpMsg]);
        setIsGenerating(true);

        const history = [
          ...currentMessages.map(m => ({ role: m.role, content: m.content })),
          { role: 'user' as const, content: `[Device result for ${action.action}]: ${result}` },
        ].slice(-20);

        const res = await fetch(`${BACKEND_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history }),
        });
        const data = await res.json();

        setMessages(prev => {
          const updated = [...prev];
          const last = updated.length - 1;
          if (updated[last]?.role === 'assistant' && !updated[last].content) {
            updated[last] = { ...updated[last], content: data.content || '' };
          }
          return updated;
        });
      } catch (err) {
        console.log('Device action error:', err);
      } finally {
        setIsGenerating(false);
      }
    }
  }, []);

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
          const responseText = data.content || 'Empty response from Jarvis.';
          // Parse and strip device action blocks from displayed text
          const { cleanText, actions } = parseDeviceActions(responseText);
          updated[last] = { ...updated[last], content: cleanText || responseText };

          // Execute device actions in background
          if (actions.length > 0) {
            processDeviceActions(actions, [...updated]);
          }
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
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>JARVIS</Text>
          <Text style={[styles.headerSub, isOnline && { color: '#00FF88' }]}>
            {isGenerating ? 'Processing...' : isOnline ? modelName + ' Online' : 'Connecting...'}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.voiceToggle, autoRead && styles.voiceToggleOn]}
          onPress={() => {
            if (isSpeaking) stopSpeaking();
            setAutoRead(prev => !prev);
          }}
        >
          <Text style={styles.voiceToggleText}>{autoRead ? '🔊' : '🔇'}</Text>
        </TouchableOpacity>
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
              {msg.role === 'assistant' && msg.content ? (
                <TouchableOpacity
                  style={styles.speakBtn}
                  onPress={() => {
                    if (isSpeaking && speakingMsgId === msg.id) {
                      stopSpeaking();
                    } else {
                      speakText(msg.content, msg.id);
                    }
                  }}
                >
                  <Text style={styles.speakBtnText}>
                    {isSpeaking && speakingMsgId === msg.id ? '⏹' : '🔊'}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.inputArea, { paddingBottom: Math.max(insets.bottom, 10) + 8 }]}>
        {attachedFile && (
          <View style={styles.filePreview}>
            {attachedFile.mimeType.startsWith('image/') ? (
              <Image source={{ uri: attachedFile.uri }} style={styles.filePreviewImage} />
            ) : (
              <Text style={styles.filePreviewIcon}>
                {attachedFile.mimeType.startsWith('video/') ? '🎬' :
                 attachedFile.mimeType.startsWith('audio/') ? '🎵' : '📎'}
              </Text>
            )}
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
            onPress={showAttachOptions}
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
  voiceToggle: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#1A1A2E',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2A2A3A',
  },
  voiceToggleOn: { backgroundColor: '#00D9FF20', borderColor: '#00D9FF50' },
  voiceToggleText: { fontSize: 20 },
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
  speakBtn: {
    alignSelf: 'flex-end', marginTop: 6, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 12, backgroundColor: 'rgba(0,217,255,0.1)',
  },
  speakBtnText: { fontSize: 16 },
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
  filePreviewImage: { width: 44, height: 44, borderRadius: 8, marginRight: 10 },
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
