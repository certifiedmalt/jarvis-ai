/**
 * deviceActions.ts — Jarvis v2
 * All device-side tools that execute on the user's iPhone.
 */

import * as Contacts from 'expo-contacts';
import * as Calendar from 'expo-calendar';
import * as Clipboard from 'expo-clipboard';
import * as Location from 'expo-location';
import * as Linking from 'expo-linking';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

export type DeviceToolCall = {
  id: string;
  name: string;
  arguments: Record<string, any>;
};

/**
 * Execute any device tool and return the result string.
 */
export async function executeDeviceTool(name: string, args: Record<string, any>): Promise<string> {
  try {
    switch (name) {
      case 'getContacts':
        return await handleGetContacts(args.query);
      case 'getCalendar':
        return await handleGetCalendar(args.days || 7);
      case 'getLocation':
        return await handleGetLocation();
      case 'speakText':
        return `[TTS] ${args.text || ''}`;
      case 'createCalendarEvent':
        return await handleCreateCalendarEvent(args);
      case 'setReminder':
        return await handleSetReminder(args);
      case 'openURL':
        return await handleOpenURL(args.url);
      case 'readClipboard':
        return await handleReadClipboard();
      case 'getDeviceInfo':
        return handleGetDeviceInfo();
      case 'saveToPhotos':
        return await handleSaveToPhotos(args.url);
      case 'createContact':
        return await handleCreateContact(args);
      case 'deleteCalendarEvent':
        return await handleDeleteCalendarEvent(args.title);
      default:
        return `Unknown device tool: ${name}`;
    }
  } catch (err: any) {
    return `Device error: ${err.message || String(err)}`;
  }
}

// ── Contacts ─────────────────────────────────────────────────

async function handleGetContacts(search?: string): Promise<string> {
  const { status } = await Contacts.requestPermissionsAsync();
  if (status !== 'granted') return 'Contact permission denied.';

  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
    pageSize: search ? 50 : 20,
    sort: Contacts.SortTypes.LastName,
  });

  let contacts = data;
  if (search) {
    const q = search.toLowerCase();
    contacts = contacts.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.firstName || '').toLowerCase().includes(q) ||
      (c.lastName || '').toLowerCase().includes(q)
    );
  }

  if (contacts.length === 0) return search ? `No contacts matching "${search}".` : 'No contacts found.';

  const formatted = contacts.slice(0, 15).map(c => {
    const phones = c.phoneNumbers?.map(p => p.number).join(', ') || 'No phone';
    const emails = c.emails?.map(e => e.email).join(', ') || 'No email';
    return `- ${c.name || 'Unknown'}: ${phones} | ${emails}`;
  }).join('\n');

  return `Found ${contacts.length} contact(s):\n${formatted}`;
}

async function handleCreateContact(args: Record<string, any>): Promise<string> {
  const { status } = await Contacts.requestPermissionsAsync();
  if (status !== 'granted') return 'Contact permission denied.';

  const contact: any = {
    [Contacts.Fields.FirstName]: args.firstName || '',
    [Contacts.Fields.LastName]: args.lastName || '',
  };
  if (args.phone) {
    contact[Contacts.Fields.PhoneNumbers] = [{ number: args.phone, label: 'mobile' }];
  }
  if (args.email) {
    contact[Contacts.Fields.Emails] = [{ email: args.email, label: 'work' }];
  }

  const id = await Contacts.addContactAsync(contact);
  return `Contact created: ${args.firstName} ${args.lastName || ''} (ID: ${id})`;
}

// ── Calendar ─────────────────────────────────────────────────

async function handleGetCalendar(days: number): Promise<string> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') return 'Calendar permission denied.';

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const ids = calendars.map(c => c.id);
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + days);

  const events = await Calendar.getEventsAsync(ids, start, end);
  if (events.length === 0) return `No events in the next ${days} day(s).`;

  const formatted = events.slice(0, 15).map(e => {
    const d = new Date(e.startDate);
    const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return `- ${date} ${time}: ${e.title}${e.location ? ` @ ${e.location}` : ''}`;
  }).join('\n');

  return `${events.length} event(s) in next ${days} day(s):\n${formatted}`;
}

async function handleCreateCalendarEvent(args: Record<string, any>): Promise<string> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') return 'Calendar permission denied.';

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const defaultCal = calendars.find(c => c.isPrimary) || calendars[0];
  if (!defaultCal) return 'No calendars available.';

  const eventId = await Calendar.createEventAsync(defaultCal.id, {
    title: args.title,
    startDate: new Date(args.startDate),
    endDate: new Date(args.endDate),
    location: args.location || undefined,
    notes: args.notes || undefined,
  });

  return `Event created: "${args.title}" (ID: ${eventId})`;
}

async function handleDeleteCalendarEvent(title: string): Promise<string> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') return 'Calendar permission denied.';

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const ids = calendars.map(c => c.id);
  const start = new Date();
  const end = new Date();
  end.setFullYear(end.getFullYear() + 1);

  const events = await Calendar.getEventsAsync(ids, start, end);
  const match = events.find(e => e.title.toLowerCase().includes(title.toLowerCase()));

  if (!match) return `No event found matching: "${title}"`;

  await Calendar.deleteEventAsync(match.id);
  return `Deleted event: "${match.title}"`;
}

// ── Reminders ────────────────────────────────────────────────

async function handleSetReminder(args: Record<string, any>): Promise<string> {
  // Use Calendar reminders API
  const { status } = await Calendar.requestRemindersPermissionsAsync();
  if (status !== 'granted') return 'Reminders permission denied.';

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.REMINDER);
  const defaultCal = calendars[0];
  if (!defaultCal) return 'No reminder calendars available.';

  const id = await Calendar.createReminderAsync(defaultCal.id, {
    title: args.title,
    dueDate: args.dueDate ? new Date(args.dueDate) : undefined,
    notes: args.notes || undefined,
  });

  return `Reminder set: "${args.title}" (ID: ${id})`;
}

// ── Location ─────────────────────────────────────────────────

async function handleGetLocation(): Promise<string> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return 'Location permission denied.';

  const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const { latitude, longitude } = location.coords;

  try {
    const [address] = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (address) {
      const parts = [address.street, address.city, address.region, address.country].filter(Boolean);
      return `Location: ${parts.join(', ')} (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
    }
  } catch (_) {}

  return `Location: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

// ── Clipboard ────────────────────────────────────────────────

async function handleReadClipboard(): Promise<string> {
  const text = await Clipboard.getStringAsync();
  if (!text) return 'Clipboard is empty.';
  return `Clipboard content:\n${text.substring(0, 2000)}${text.length > 2000 ? '...' : ''}`;
}

// ── URL ──────────────────────────────────────────────────────

async function handleOpenURL(url: string): Promise<string> {
  const canOpen = await Linking.canOpenURL(url);
  if (!canOpen) return `Cannot open URL: ${url}`;
  await Linking.openURL(url);
  return `Opened: ${url}`;
}

// ── Device Info ──────────────────────────────────────────────

function handleGetDeviceInfo(): string {
  const info = [
    `Platform: ${Platform.OS} ${Platform.Version}`,
    `Device: ${Constants.deviceName || 'Unknown'}`,
    `App Version: ${Constants.expoConfig?.version || 'Unknown'}`,
    `Expo SDK: ${Constants.expoConfig?.sdkVersion || 'Unknown'}`,
  ];
  return info.join('\n');
}

// ── Save to Photos ───────────────────────────────────────────

async function handleSaveToPhotos(url: string): Promise<string> {
  try {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') return 'Photo library permission denied.';

    const filename = url.split('/').pop()?.split('?')[0] || 'jarvis_image.jpg';
    const localUri = FileSystem.cacheDirectory + filename;

    // Use modern Expo FileSystem API (compatible with SDK 54+)
    const fileInfo = await FileSystem.getInfoAsync(localUri);
    if (!fileInfo.exists) {
      const result = await FileSystem.createDownloadResumable(url, localUri).downloadAsync();
      if (!result || result.status !== 200) return `Download failed: HTTP ${result?.status}`;
    }

    const asset = await MediaLibrary.createAssetAsync(localUri);
    return `Saved to Photos: ${asset.filename}`;
  } catch (err: any) {
    return `Save failed: ${err.message || String(err)}`;
  }
}
