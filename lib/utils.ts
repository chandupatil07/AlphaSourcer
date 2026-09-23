/**
 * A short random id.
 *
 * The previous implementation was `Math.random().toString(36).substr(2, 9)`,
 * which does not produce a fixed length: `toString(36)` drops trailing zeros,
 * so the tail can be shorter than the nine characters the slice asks for. Over
 * 200,000 draws, 42 came back with seven or eight characters, and the worked
 * case `(0.5).toString(36)` is `"0.i"` -- a one-character id.
 *
 * That matters because this generates SESSION ids (app/api/search/route.ts).
 * Two searches colliding on an id means one person's results are served to
 * another. It also seeded candidate and query ids, where a collision silently
 * merges two different records.
 *
 * Now a fixed length drawn from the platform CSPRNG. The alphabet is 32
 * characters so the byte-to-character mapping is a mask rather than a modulo,
 * which avoids the bias a 36-character alphabet would introduce. Twelve
 * characters is 60 bits: at ten thousand sessions a day, a collision is not
 * expected within any practical lifetime of this product.
 */
const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuv'; // 32 chars, power of two
const ID_LENGTH = 12;

export function nanoid(size: number = ID_LENGTH): string {
  const webCrypto = globalThis.crypto;

  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    const bytes = webCrypto.getRandomValues(new Uint8Array(size));
    let id = '';
    for (let i = 0; i < size; i++) {
      id += ID_ALPHABET[bytes[i] & 31];
    }
    return id;
  }

  // No CSPRNG available. Still fixed length: keep drawing and trim, rather
  // than slicing a single draw that may be too short.
  let id = '';
  while (id.length < size) {
    id += Math.random().toString(36).slice(2);
  }
  return id.slice(0, size);
}

export function getMatchStrengthColor(strength: string): string {
  switch (strength) {
    case 'excellent':
      return 'bg-green-100 text-green-800';
    case 'strong':
      return 'bg-blue-100 text-blue-800';
    case 'potential':
      return 'bg-yellow-100 text-yellow-800';
    case 'low':
      return 'bg-gray-100 text-gray-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.substring(0, length) + '...';
}

export function classNames(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
