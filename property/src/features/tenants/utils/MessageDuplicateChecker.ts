import type { PaymentMessage } from '@/shared/types/types';
import { extractMessageMetadata } from '@/shared/utils/parsers';

/**
 * Utility class to centralize duplicate payment message checking logic.
 * Checks first by exact message content, then by reference number.
 */
export class MessageDuplicateChecker {
  private existingContents = new Map<string, PaymentMessage>();
  private existingIdentifiers = new Map<string, PaymentMessage>();

  constructor(
    existingMessages: PaymentMessage[],
    private excludeId?: string | number,
  ) {
    existingMessages.forEach(m => {
      if (!m || (this.excludeId && String(m.id) === String(this.excludeId))) return;

      const content = m.message_content?.trim().toLowerCase();
      if (!content) return;

      this.existingContents.set(content, m);

      const meta = extractMessageMetadata(m.message_content);
      if (meta.ref && meta.ref !== 'UNKNOWN') {
        this.existingIdentifiers.set(meta.ref.toLowerCase(), m);
      }
    });
  }

  /**
   * Checks if a given message content or reference code is a duplicate.
   * Returns the matched PaymentMessage if found, otherwise undefined.
   */
  checkDuplicate(content: string, refCode?: string): PaymentMessage | undefined {
    const trimmedContent = content.trim().toLowerCase();

    // First check content
    if (this.existingContents.has(trimmedContent)) {
      return this.existingContents.get(trimmedContent);
    }

    // Then check reference number
    let identifier = refCode?.toLowerCase();
    if (!identifier || identifier === 'unknown') {
      const meta = extractMessageMetadata(content);
      identifier =
        meta.ref && meta.ref !== 'UNKNOWN' ? meta.ref.toLowerCase() : undefined;
    }

    if (
      identifier &&
      identifier !== 'unknown' &&
      this.existingIdentifiers.has(identifier)
    ) {
      return this.existingIdentifiers.get(identifier);
    }

    return undefined;
  }

  /**
   * Adds a new message to the local sets. Useful during bulk imports to prevent
   * duplicates within the same imported batch.
   */
  add(content: string, refCode?: string, mockMessage?: PaymentMessage) {
    const trimmedContent = content.trim().toLowerCase();
    const msg = mockMessage || ({ message_content: content } as PaymentMessage);

    this.existingContents.set(trimmedContent, msg);

    let identifier = refCode?.toLowerCase();
    if (!identifier || identifier === 'unknown') {
      const meta = extractMessageMetadata(content);
      identifier =
        meta.ref && meta.ref !== 'UNKNOWN' ? meta.ref.toLowerCase() : undefined;
    }
    if (identifier && identifier !== 'unknown') {
      this.existingIdentifiers.set(identifier, msg);
    }
  }
}
