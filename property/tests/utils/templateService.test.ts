import { getSyncClient } from '@/shared/services/sync/client';
import {
  getMessageTemplate,
  htmlToPlain,
  plainToHtml,
  replacePlaceholders,
} from '@/shared/services/templateService';

jest.mock('@/shared/services/sync/client', () => ({
  getSyncClient: jest.fn(),
}));

describe('templateService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getMessageTemplate', () => {
    it('returns null if client findMany returns empty', async () => {
      const mockClient = {
        findMany: jest.fn().mockResolvedValue([]),
      };
      (getSyncClient as jest.Mock).mockResolvedValue(mockClient);
      const result = await getMessageTemplate('biz1', 'payment', 'sms');
      expect(result).toBeNull();
    });

    it('returns the correct template matching name and channel', async () => {
      const mockTemplate = { id: 't2', name: 'payment', channel: 'email' };
      const mockClient = {
        findMany: jest.fn().mockResolvedValue([mockTemplate]),
      };
      (getSyncClient as jest.Mock).mockResolvedValue(mockClient);

      const result = await getMessageTemplate('biz1', 'payment', 'email');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('t2');
    });

    it('handles unexpected errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      (getSyncClient as jest.Mock).mockRejectedValue(new Error('Database disconnected'));

      const result = await getMessageTemplate('biz1', 'payment', 'sms');
      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe('replacePlaceholders', () => {
    it('replaces all variables accurately', () => {
      const template = 'Hello {{tenant_name}}, your rent is {{monthly_rent}}.';
      const data = {
        tenant_name: 'John Doe',
        monthly_rent: 'Ksh 10,000',
      };
      const result = replacePlaceholders(template, data);
      expect(result).toBe('Hello John Doe, your rent is Ksh 10,000.');
    });

    it('handles missing or null values gracefully', () => {
      const template = 'Hello {{name}}, you owe {{amount}}.';
      const data = {
        name: null,
        amount: undefined,
      };
      const result = replacePlaceholders(template, data);
      expect(result).toBe('Hello , you owe .');
    });

    it('replaces multiple occurrences of the same variable', () => {
      const template = '{{name}} is here. Yes, {{name}}!';
      const data = { name: 'Alice' };
      const result = replacePlaceholders(template, data);
      expect(result).toBe('Alice is here. Yes, Alice!');
    });

    it('returns empty string if template is missing', () => {
      expect(replacePlaceholders('', {})).toBe('');
    });
  });

  describe('htmlToPlain', () => {
    it('returns empty string if input is empty', () => {
      expect(htmlToPlain('')).toBe('');
    });

    it('converts strong and bold to asterisks', () => {
      expect(htmlToPlain('<strong>Hello</strong> and <b>World</b>')).toBe(
        '*Hello* and *World*',
      );
    });

    it('converts emphasis and italics to underscores', () => {
      expect(htmlToPlain('<em>Hello</em> and <i>World</i>')).toBe('_Hello_ and _World_');
    });

    it('converts links to markdown format', () => {
      expect(htmlToPlain('<a href="https://example.com">Link</a>')).toBe(
        'Link (https://example.com)',
      );
    });

    it('converts lists properly', () => {
      const html = '<ul><li>One</li><li>Two</li></ul>';
      const expected = '- One\n- Two';
      expect(htmlToPlain(html)).toBe(expected);
    });

    it('converts ordered lists properly', () => {
      const html = '<ol><li>First</li><li>Second</li></ol>';
      const expected = '1. First\n2. Second';
      expect(htmlToPlain(html)).toBe(expected);
    });

    it('converts mixed consecutive lists properly', () => {
      const html = '<ul><li>One</li></ul><ol><li>First</li></ol><ul><li>Two</li></ul>';
      const expected = '- One\n\n1. First\n\n- Two';
      expect(htmlToPlain(html)).toBe(expected);
    });

    it('removes style and script tags entirely', () => {
      const html = 'Hello<style>.color{red}</style><script>alert(1)</script>';
      expect(htmlToPlain(html)).toBe('Hello');
    });

    it('handles indentations via margins', () => {
      const html = '<p style="margin-left: 20px">Indented text</p>';
      expect(htmlToPlain(html)).toBe('  Indented text');
    });

    it('converts br tags to newlines', () => {
      expect(htmlToPlain('Hello<br/>World')).toBe('Hello\nWorld');
    });

    it('cleans up remaining HTML and decodes entities', () => {
      expect(htmlToPlain('<p>Hello &amp; Welcome &copy;</p>')).toBe('Hello & Welcome ©');
    });
  });

  describe('plainToHtml', () => {
    it('returns empty string if input is empty', () => {
      expect(plainToHtml('')).toBe('');
    });

    it('converts bold syntax to strong tags', () => {
      const result = plainToHtml('This is **bold** and __bold__');
      expect(result).toContain('<strong>bold</strong>');
    });

    it('converts italics to em tags', () => {
      const result = plainToHtml('This is *italic* and _italic_');
      expect(result).toContain('<em>italic</em>');
    });

    it('converts links properly', () => {
      const result = plainToHtml('Check [Google](https://google.com)');
      expect(result).toContain(
        '<a href="https://google.com" style="color: #3498db; text-decoration: none;">Google</a>',
      );
    });

    it('processes bullet lists properly', () => {
      const text = '- Item 1\n* Item 2';
      const result = plainToHtml(text);
      expect(result).toContain('<ul');
      expect(result).toContain('<li>Item 1</li>');
      expect(result).toContain('<li>Item 2</li>');
      expect(result).toContain('</ul>');
    });

    it('processes numbered lists properly', () => {
      const text = '1. First\n2. Second';
      const result = plainToHtml(text);
      expect(result).toContain('<ol');
      expect(result).toContain('<li>First</li>');
      expect(result).toContain('<li>Second</li>');
      expect(result).toContain('</ol>');
    });

    it('transitions between list types and normal text properly', () => {
      const text =
        '- Bullet\n1. Number\nNormal text\n1. Another number\n- Another bullet\nMore normal text';
      const result = plainToHtml(text);
      // It should close ul before starting ol
      expect(result).toMatch(/<\/ul>\s*<ol/);
      // It should close ol before normal text
      expect(result).toMatch(/<\/ol>\s*<p[^>]*>Normal text<\/p>/);
      // It should close p before ol
      expect(result).toMatch(/<\/p>\s*<ol/);
      // It should close ol before starting ul
      expect(result).toMatch(/<\/ol>\s*<ul/);
      // And it should close the final ul before More normal text
      expect(result).toMatch(/<\/ul>\s*<p[^>]*>More normal text<\/p>/);
    });

    it('detects indentations and sets margins', () => {
      const text = '    Indented text';
      const result = plainToHtml(text);
      expect(result).toContain('<p style="margin-left: 40px;');
      expect(result).toContain('Indented text</p>');
    });

    it('handles blank lines as breaks', () => {
      const text = 'Line 1\n\nLine 2';
      const result = plainToHtml(text);
      expect(result).toContain('Line 1');
      expect(result).toContain('<br/>');
      expect(result).toContain('Line 2');
    });
  });
});
