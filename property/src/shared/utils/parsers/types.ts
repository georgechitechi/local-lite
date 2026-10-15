export interface MessageMetadata {
  amount: string | null;
  date: string | null;
  ref: string | null;
  name: string | null;
  phone: string | null;
}

export interface MessageParser {
  /**
   * Quick heuristic to determine if this parser should handle the given text.
   */
  canParse(text: string): boolean;

  /**
   * Extracts metadata from the message text.
   */
  extract(text: string): MessageMetadata;
}
