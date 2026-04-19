/**
 * deviceActions.ts — Jarvis v2
 * 
 * Executes device-side actions on the user's iPhone.
 * These tools require iOS permissions and run natively.
 */

import * as Contacts from 'expo-contacts';
import * as Calendar from 'expo-calendar';
import * as Clipboard from 'expo-clipboard';
import * as Location from 'expo-location';

export type DeviceAction = {
  action: string;
  search?: string;
  days?: number;
  text?: string;
};

/**
 * Execute a device action and return a human-readable result string.
 */
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
    return 'Contact permission denied. Enable in Settings.';
  }

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

  if (contacts.length === 0) {
    return search ? `No contacts matching "${search}".` : 'No contacts found.';
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
    return 'Calendar permission denied. Enable in Settings.';
  }

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const calendarIds = calendars.map(c => c.id);
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + days);

  const events = await Calendar.getEventsAsync(calendarIds, start, end);
  if (events.length === 0) {
    return `No events in the next ${days} day(s).`;
  }

  const formatted = events.slice(0, 15).map(e => {
    const d = new Date(e.startDate);
    const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return `- ${date} ${time}: ${e.title}${e.location ? ` @ ${e.location}` : ''}`;
  }).join('\n');

  return `${events.length} event(s) in the next ${days} day(s):\n${formatted}`;
}

async function handleGetLocation(): Promise<string> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    return 'Location permission denied. Enable in Settings.';
  }

  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
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

async function handleClipboard(text: string): Promise<string> {
  await Clipboard.setStringAsync(text);
  return `Copied to clipboard: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`;
}
