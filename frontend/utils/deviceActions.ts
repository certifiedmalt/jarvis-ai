import * as Contacts from 'expo-contacts';
import * as Calendar from 'expo-calendar';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as Location from 'expo-location';
import { Alert, Platform } from 'react-native';

export type DeviceAction = {
  action: string;
  search?: string;
  days?: number;
  text?: string;
};

export function parseDeviceActions(text: string): { cleanText: string; actions: DeviceAction[] } {
  const actions: DeviceAction[] = [];
  let cleanText = text;

  // Match ```device ... ``` blocks
  const deviceRegex = /```device\s*([\s\S]*?)```/g;
  let match;

  while ((match = deviceRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      actions.push(parsed);
      cleanText = cleanText.replace(match[0], '').trim();
    } catch (e) {
      console.log('Failed to parse device action:', e);
    }
  }

  return { cleanText, actions };
}

export async function executeDeviceAction(action: DeviceAction): Promise<string> {
  try {
    switch (action.action) {
      case 'get_contacts':
        return await handleGetContacts(action.search);
      case 'get_calendar':
        return await handleGetCalendar(action.days || 7);
      case 'get_location':
        return await handleGetLocation();
      case 'clipboard':
        return await handleClipboard(action.text || '');
      case 'share':
        return await handleShare(action.text || '');
      default:
        return `Unknown device action: ${action.action}`;
    }
  } catch (err: any) {
    return `Device action failed: ${err.message || String(err)}`;
  }
}

async function handleGetContacts(search?: string): Promise<string> {
  const { status } = await Contacts.requestPermissionsAsync();
  if (status !== 'granted') {
    return 'Contact permission was denied. Please enable it in Settings.';
  }

  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
    pageSize: search ? 50 : 20,
    sort: Contacts.SortTypes.LastName,
  });

  let contacts = data;

  if (search) {
    const query = search.toLowerCase();
    contacts = contacts.filter(c =>
      (c.name || '').toLowerCase().includes(query) ||
      (c.firstName || '').toLowerCase().includes(query) ||
      (c.lastName || '').toLowerCase().includes(query)
    );
  }

  if (contacts.length === 0) {
    return search ? `No contacts found matching "${search}".` : 'No contacts found.';
  }

  const formatted = contacts.slice(0, 15).map(c => {
    const phones = c.phoneNumbers?.map(p => p.number).join(', ') || 'No phone';
    const emails = c.emails?.map(e => e.email).join(', ') || 'No email';
    return `- ${c.name || 'Unknown'}: ${phones} | ${emails}`;
  }).join('\n');

  return `Found ${contacts.length} contact(s)${search ? ` matching "${search}"` : ''}:\n${formatted}`;
}

async function handleGetCalendar(days: number): Promise<string> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') {
    return 'Calendar permission was denied. Please enable it in Settings.';
  }

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const calendarIds = calendars.map(c => c.id);

  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + days);

  const events = await Calendar.getEventsAsync(calendarIds, start, end);

  if (events.length === 0) {
    return `No calendar events in the next ${days} day(s).`;
  }

  const formatted = events.slice(0, 15).map(e => {
    const startDate = new Date(e.startDate);
    const dateStr = startDate.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    const timeStr = startDate.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit',
    });
    return `- ${dateStr} ${timeStr}: ${e.title}${e.location ? ` @ ${e.location}` : ''}`;
  }).join('\n');

  return `${events.length} event(s) in the next ${days} day(s):\n${formatted}`;
}

async function handleGetLocation(): Promise<string> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    return 'Location permission was denied. Please enable it in Settings.';
  }

  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  const { latitude, longitude } = location.coords;

  // Try reverse geocoding
  try {
    const [address] = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (address) {
      const parts = [address.street, address.city, address.region, address.country].filter(Boolean);
      return `Current location: ${parts.join(', ')} (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
    }
  } catch (e) {
    // Fallback to coordinates only
  }

  return `Current location: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

async function handleClipboard(text: string): Promise<string> {
  await Clipboard.setStringAsync(text);
  return `Copied to clipboard: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`;
}

async function handleShare(text: string): Promise<string> {
  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) {
    return 'Sharing is not available on this device.';
  }

  // We can't directly share text with expo-sharing (it needs a file URI)
  // So we'll copy to clipboard and alert the user
  await Clipboard.setStringAsync(text);
  Alert.alert('Ready to Share', 'Content copied to clipboard. You can paste it anywhere.');
  return 'Content copied to clipboard and ready to share.';
}
